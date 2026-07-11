import os
import shutil
import time
import glob
from io import BytesIO
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends, File, UploadFile, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

try:
    from PIL import Image
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

from ...core.config import log, BASE_DIR
from ...services.db_service import (
    AsyncSessionLocal,
    save_storage_item,
    mark_storage_items_deleted
)
from ...services.clients import reload_client_config
from .deps import verify_token


def _normalize_url_for_compare(url: Optional[str]) -> str:
    if not url or not isinstance(url, str):
        return ""
    return url.split("?")[0].split("#")[0].strip()


def _extract_client_id_from_file_url(file_url: Optional[str]) -> Optional[str]:
    if not file_url or not isinstance(file_url, str):
        return None

    normalized = _normalize_url_for_compare(file_url)
    if "/api/chat/uploads/" in normalized:
        tail = normalized.split("/api/chat/uploads/")[-1]
        parts = tail.split("/")
        return parts[0] if parts and parts[0] else None
    if "/api/chat/img/" in normalized:
        tail = normalized.split("/api/chat/img/")[-1]
        parts = tail.split("/")
        return parts[0] if parts and parts[0] else None
    return None


async def _clear_file_references_in_config(client_id: str, file_url: str):
    """Удаляет ссылки на удалённый файл из config_json клиента."""
    if not client_id or not file_url:
        return

    normalized_target = _normalize_url_for_compare(file_url)
    if not normalized_target:
        return

    from ...services.db_service import ClientConfig as DBClientConfig

    theme_file_keys = [
        "widget_img",
        "msg_bot_avatar",
        "msg_user_avatar",
        "msg_operator_avatar",
        "profile_avatar",
        "window_bg_img",
        "chat_window_bg_img",
        "header_logo",
        "welcome_img",
        "inline_btn_accent_img",
        "inline_btn_neutral_img",
        "inline_btn_info_img",
        "bot_avatar",
        "user_avatar",
        "operator_avatar"
    ]

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(DBClientConfig).where(DBClientConfig.client_id == client_id))
        cfg_obj = res.scalar_one_or_none()
        if not cfg_obj:
            return

        config = dict(cfg_obj.config_json or {})
        theme = dict(config.get("theme") or {})
        bot_settings = dict(config.get("bot_settings") or {})

        changed = False

        for key in theme_file_keys:
            current = theme.get(key)
            if _normalize_url_for_compare(current) == normalized_target:
                theme[key] = None
                changed = True

        current_knowledge_url = bot_settings.get("knowledge_file_url")
        if _normalize_url_for_compare(current_knowledge_url) == normalized_target:
            bot_settings["knowledge_file_url"] = ""
            bot_settings["knowledge_file_name"] = ""
            changed = True

        if not changed:
            return

        config["theme"] = theme
        config["bot_settings"] = bot_settings
        cfg_obj.config_json = config
        flag_modified(cfg_obj, "config_json")
        await db.commit()

    await reload_client_config(client_id)


router = APIRouter()


async def _update_user_storage(client_id: str, delta: int):
    """Обновляет used_storage пользователя на delta байт (может быть отрицательным)."""
    from ...services.db_service import User as DBUser
    from sqlalchemy import update as sql_update
    from sqlalchemy.sql import func
    async with AsyncSessionLocal() as db:
        await db.execute(
            sql_update(DBUser)
            .where(DBUser.client_id == client_id)
            .values(used_storage=func.greatest(0, DBUser.used_storage + delta))
        )
        await db.commit()


def delete_old_file(file_url: Optional[str]):
    """Удаляет файл с диска по его URL, учитывая подпапки клиентов и новую структуру uploads."""
    if not file_url or not isinstance(file_url, str):
        return

    file_path = None
    client_id = None
    if "/api/chat/uploads/" in file_url:
        parts = file_url.split("/api/chat/uploads/")[-1].split("/")
        client_id = parts[0] if parts else None
        file_path = os.path.join(BASE_DIR, "uploads", *parts)
    elif "/api/chat/img/" in file_url:
        parts = file_url.split("/api/chat/img/")[-1].split("/")
        client_id = parts[0] if parts else None
        file_path = os.path.join(BASE_DIR, "img", *parts)

    if file_path:
        try:
            if os.path.exists(file_path):
                file_size = os.path.getsize(file_path)
                os.remove(file_path)
                log.info(f"[CLEANUP] Deleted old file: {file_path} ({file_size} bytes)")
                if client_id and file_size > 0:
                    import asyncio
                    asyncio.create_task(_update_user_storage(client_id, -file_size))
                    asyncio.create_task(mark_storage_items_deleted(
                        client_id=client_id, file_path=file_url
                    ))
            else:
                log.warning(f"[CLEANUP] File not found for deletion: {file_path}")
        except Exception as e:
            log.error(f"[CLEANUP] Error deleting file {file_path}: {e}")


def process_image(content: bytes, max_width: int = 1200) -> bytes:
    """Сжимает изображение и конвертирует в WebP."""
    if not HAS_PILLOW:
        return content

    try:
        img = Image.open(BytesIO(content))

        if img.mode in ('RGBA', 'P'):
            img = img.convert('RGB')

        if img.width > max_width:
            ratio = max_width / float(img.width)
            new_height = int(float(img.height) * ratio)
            img = img.resize((max_width, new_height), Image.Resampling.LANCZOS)

        output = BytesIO()
        img.save(output, format='WEBP', quality=80, optimize=True)
        return output.getvalue()
    except Exception as e:
        log.error(f"[IMAGE_PROC] Error processing image: {e}")
        return content


def move_temp_file(temp_url: str, client_id: str, subfolder: str, field_id: str) -> str:
    """Переносит файл из временной папки в постоянную с уникальной структурой папок."""
    if not temp_url or "/uploads/temp/" not in temp_url:
        return temp_url

    try:
        clean_url = temp_url.split('?')[0]
        filename = clean_url.split("/")[-1]
        temp_path = os.path.join(BASE_DIR, "uploads", "temp", filename)

        if not os.path.exists(temp_path):
            log.warning(f"Move Temp: File not found at {temp_path}")
            return temp_url

        file_size = os.path.getsize(temp_path)

        folder_map = {
            'widget_img': 'widget',
            'header_logo': 'header',
            'welcome_img': 'welcome',
            'window_bg_img': 'window',
            'msg_bot_avatar': 'bot',
            'msg_user_avatar': 'user',
            'msg_operator_avatar': 'operator',
            'profile_avatar': 'profile',
            'knowledge_file_url': 'knowledge'
        }

        target_folder = folder_map.get(field_id, subfolder)

        ext = os.path.splitext(filename)[1]
        new_filename = f"file_{client_id}_{field_id}{ext}"

        dest_dir = os.path.join(BASE_DIR, "uploads", client_id, target_folder)
        os.makedirs(dest_dir, exist_ok=True)
        dest_path = os.path.join(dest_dir, new_filename)

        shutil.copy2(temp_path, dest_path)
        os.remove(temp_path)

        final_url = f"/api/chat/uploads/{client_id}/{target_folder}/{new_filename}"

        log.info(f"[STORAGE] Moved temp file to permanent: {dest_path} ({file_size} bytes)")

        if file_size > 0:
            import asyncio
            category = "knowledge" if field_id == "knowledge_file_url" else "appearance"
            asyncio.create_task(save_storage_item(
                client_id=client_id,
                category=category,
                file_size=file_size,
                file_path=final_url,
                file_name=new_filename
            ))

        return final_url
    except Exception as e:
        log.error(f"Error moving temp file: {e}")
        return temp_url


@router.post("/delete-file")
async def delete_file_api(request: Request, token_data: dict = Depends(verify_token)):
    """Удаление файла с диска по его URL."""
    data = await request.json()
    file_url = data.get("file_url")
    if not file_url:
        return {"status": "error", "message": "No URL provided"}

    delete_old_file(file_url)

    target_client_id = _extract_client_id_from_file_url(file_url)
    token_sub = token_data.get("sub")

    if token_sub != "admin":
        if not target_client_id or target_client_id != token_sub:
            raise HTTPException(status_code=403, detail="Access denied")

    if target_client_id:
        await _clear_file_references_in_config(target_client_id, file_url)

    return {"status": "success"}


@router.post("/upload-avatar")
async def upload_avatar(client_id: str, file: UploadFile = File(...), token_data: dict = Depends(verify_token)):
    """Загрузка аватара клиента."""
    log.info(f"Avatar upload request for {client_id}")
    try:
        if token_data['sub'] != client_id and token_data['sub'] != 'admin':
            raise HTTPException(status_code=403, detail="Access denied")

        if not file.content_type.startswith('image/'):
            raise HTTPException(status_code=400, detail="File must be an image")

        content = await file.read()
        file_size = len(content)

        ext = os.path.splitext(file.filename)[1]
        filename = f"avatar_{client_id}{ext}"

        img_dir = os.path.join(BASE_DIR, "img", client_id)
        os.makedirs(img_dir, exist_ok=True)

        save_path = os.path.join(img_dir, filename)

        # Check if old avatar exists and account for its size
        old_avatar_size = 0
        old_avatar_url = None
        from ...services.db_service import ClientConfig as DBClientConfig
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(DBClientConfig).where(DBClientConfig.client_id == client_id))
            cfg_obj = res.scalar_one_or_none()
            if cfg_obj:
                config = dict(cfg_obj.config_json or {})
                old_avatar_url = config.get('theme', {}).get('profile_avatar')
                if old_avatar_url:
                    old_path = None
                    if "/api/chat/img/" in old_avatar_url:
                        parts = old_avatar_url.split("/api/chat/img/")[-1].split("/")
                        old_path = os.path.join(BASE_DIR, "img", *parts)
                    if old_path and os.path.exists(old_path):
                        old_avatar_size = os.path.getsize(old_path)

        # Check storage limit
        from ...core.config import TARIFF_RULES as _TARIFF_RULES
        from ...services.db_service import User as DBUser
        async with AsyncSessionLocal() as db:
            user = (await db.execute(select(DBUser).where(DBUser.client_id == client_id))).scalar_one_or_none()
            if user:
                tariff = _TARIFF_RULES.get(user.tariff_name.lower(), _TARIFF_RULES['start'])
                storage_limit = tariff.get('storage_limit', 1 * 1024 * 1024 * 1024)
                net_increase = file_size - old_avatar_size
                if user.used_storage + net_increase > storage_limit:
                    raise HTTPException(status_code=403, detail="Storage limit exceeded")

        with open(save_path, "wb") as buffer:
            buffer.write(content)

        avatar_url = f"/api/chat/img/{client_id}/{filename}"

        async with AsyncSessionLocal() as db:
            res = await db.execute(select(DBClientConfig).where(DBClientConfig.client_id == client_id))
            cfg_obj = res.scalar_one_or_none()
            if cfg_obj:
                config = dict(cfg_obj.config_json or {})
                if 'theme' not in config:
                    config['theme'] = {}
                config['theme']['profile_avatar'] = avatar_url
                cfg_obj.config_json = config
                flag_modified(cfg_obj, "config_json")
                await db.commit()
                await reload_client_config(client_id)

        # Update used_storage: удаляем старый, новый добавит save_storage_item
        if old_avatar_size > 0 or file_size > 0:
            import asyncio
            if old_avatar_url and old_avatar_size > 0:
                asyncio.create_task(_update_user_storage(client_id, -old_avatar_size))
                asyncio.create_task(mark_storage_items_deleted(
                    client_id=client_id, file_path=old_avatar_url
                ))
            asyncio.create_task(save_storage_item(
                client_id=client_id,
                category="avatar",
                file_size=file_size,
                file_path=avatar_url,
                file_name=filename
            ))

        # Delete old avatar file
        if old_avatar_url and old_avatar_url != avatar_url:
            if old_avatar_url:
                parts = old_avatar_url.split("/api/chat/img/")[-1].split("/")
                old_path = os.path.join(BASE_DIR, "img", *parts)
                if os.path.exists(old_path):
                    os.remove(old_path)
                    log.info(f"[CLEANUP] Deleted old avatar: {old_path}")

        return {"status": "success", "avatar_url": avatar_url}
    except Exception as e:
        import traceback
        log.error(f"Avatar upload error: {e}\n{traceback.format_exc()}")
        return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})


@router.post("/upload-file")
async def upload_file(client_id: str, file: UploadFile = File(...), field_id: str = "default", token_data: dict = Depends(verify_token)):
    """Загрузка файла во временную папку с перезаписью для конкретного поля."""
    try:
        if token_data['sub'] != client_id and token_data['sub'] != 'admin':
            raise HTTPException(status_code=403, detail="Access denied")

        content = await file.read()

        temp_dir = os.path.join(BASE_DIR, "uploads", "temp")
        os.makedirs(temp_dir, exist_ok=True)

        pattern = os.path.join(temp_dir, f"temp_{client_id}_{field_id}.*")
        for old_temp in glob.glob(pattern):
            try:
                os.remove(old_temp)
                log.info(f"[CLEANUP] Overwriting: deleted old temp file {old_temp}")
            except:
                pass

        ext = os.path.splitext(file.filename)[1].lower()
        is_image = file.content_type and file.content_type.startswith('image/') and not file.filename.endswith('.svg')

        if is_image:
            content = process_image(content)
            filename = f"temp_{client_id}_{field_id}.webp"
        else:
            filename = f"temp_{client_id}_{field_id}{ext}"

        save_path = os.path.join(temp_dir, filename)

        with open(save_path, "wb") as buffer:
            buffer.write(content)

        file_url = f"/api/chat/uploads/temp/{filename}"
        return {
            "status": "success",
            "file_url": file_url,
            "original_name": file.filename,
            "is_temp": True
        }
    except Exception as e:
        log.error(f"Upload Error: {e}")
        return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})


@router.delete("/upload/temp/{filename}")
async def delete_temp_file_endpoint(filename: str, token_data: dict = Depends(verify_token)):
    """Удаление временного файла с диска."""
    try:
        if not filename.startswith("temp_"):
            raise HTTPException(status_code=400, detail="Invalid filename")

        client_id = token_data.get('sub')
        if client_id != 'admin' and not filename.startswith(f"temp_{client_id}_"):
            raise HTTPException(status_code=403, detail="Access denied")

        temp_path = os.path.join(BASE_DIR, "uploads", "temp", filename)
        if os.path.exists(temp_path):
            os.remove(temp_path)
            log.info(f"[CLEANUP] Deleted temp file: {temp_path}")
            return {"status": "success", "message": "File deleted"}
        else:
            log.warning(f"[CLEANUP] Temp file not found: {temp_path}")
            return {"status": "success", "message": "File already deleted or not found"}
    except Exception as e:
        log.error(f"Delete Temp Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/delete-temp-file")
async def delete_temp_file(client_id: str, field_id: str, token_data: dict = Depends(verify_token)):
    """Безопасное удаление временного файла по ID поля."""
    try:
        if token_data['sub'] != client_id and token_data['sub'] != 'admin':
            raise HTTPException(status_code=403, detail="Access denied")

        temp_dir = os.path.join(BASE_DIR, "uploads", "temp")

        pattern = os.path.join(temp_dir, f"temp_{client_id}_{field_id}.*")
        deleted_count = 0
        for f in glob.glob(pattern):
            try:
                os.remove(f)
                deleted_count += 1
                log.info(f"[CLEANUP] Deleted temp file: {f}")
            except:
                pass

        return {"status": "success", "deleted": deleted_count}
    except Exception as e:
        log.error(f"Delete Temp Error: {e}")
        return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})
