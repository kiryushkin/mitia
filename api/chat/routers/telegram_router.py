from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import JSONResponse
from ..services.telegram_service import (
    handle_telegram_message, find_client_by_token, set_webhook, delete_webhook, validate_bot_token,
    get_telegram_file_url
)
from ..core.config import log
from .admin_router import verify_token
from ..services.integrations_service import get_integration_settings, save_integration_settings
from ..services.db_service import download_and_save_file

router = APIRouter(prefix="/api/chat/telegram", tags=["telegram"])

@router.post("/webhook/{bot_token}")
async def telegram_webhook(bot_token: str, request: Request):
    """Принимает входящие сообщения от Telegram."""
    try:
        update = await request.json()
        # log.info(f"TG Webhook received update for token ...{bot_token[-8:]}")
        
        if "message" not in update:
            return {"status": "ignored"}
            
        message = update["message"]
        tg_chat_id = message.get("chat", {}).get("id")
        user_text = message.get("text") or ""
        from_user = message.get("from", {})
        
        # Ищем клиента по токену
        client_id = await find_client_by_token(bot_token)
        if not client_id:
            log.error(f"Client not found for bot token ...{bot_token[-8:]}")
            return JSONResponse(status_code=404, content={"error": "Client not found"})

        # Обработка вложений — скачиваем файлы
        attachment_links = []
        session_id = f"tg-{client_id}-{tg_chat_id}"

        if "photo" in message:
            photo = message["photo"][-1]
            file_url = await get_telegram_file_url(bot_token, photo["file_id"])
            if file_url:
                local_url = await download_and_save_file(
                    file_url, client_id, session_id=session_id,
                    file_name="photo.jpg", category="chat_file"
                )
                attachment_links.append(f"🖼 Фото: {local_url or file_url}")
        if "document" in message:
            doc = message["document"]
            file_url = await get_telegram_file_url(bot_token, doc["file_id"])
            name = doc.get("file_name", "файл")
            if file_url:
                local_url = await download_and_save_file(
                    file_url, client_id, session_id=session_id,
                    file_name=name, category="chat_file"
                )
                attachment_links.append(f"📄 Файл {name}: {local_url or file_url}")
        if "video" in message:
            video = message["video"]
            file_url = await get_telegram_file_url(bot_token, video["file_id"])
            if file_url:
                local_url = await download_and_save_file(
                    file_url, client_id, session_id=session_id,
                    file_name="video.mp4", category="chat_file"
                )
                attachment_links.append(f"🎥 Видео: {local_url or file_url}")

        if attachment_links:
            extra_text = "\n".join(attachment_links)
            user_text = f"{user_text}\n\n{extra_text}".strip()

        if not tg_chat_id:
            return {"status": "no_content"}
        if not user_text and not attachment_links:
            return {"status": "no_content"}
            
        # Обрабатываем сообщение
        success = await handle_telegram_message(
            client_id, bot_token, tg_chat_id, user_text or "", from_user
        )
        
        return {"status": "ok" if success else "error"}
        
    except Exception as e:
        log.error(f"TG Webhook error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

@router.post("/setup")
async def setup_telegram(request: Request, client_id: str = None, user_data: dict = Depends(verify_token)):
    """Настройка вебхука для Telegram бота."""
    target_client_id = client_id or user_data.get("sub")
    if not target_client_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    data = await request.json()
    bot_token = data.get("bot_token", "").strip()
    enabled = data.get("enabled")
    if enabled is None:
        enabled = False
    else:
        enabled = bool(enabled)
    
    log.info(f"[TG_SETUP] client={target_client_id}, bot_token_present={bool(bot_token)}, enabled={enabled}")
    
    if enabled and bot_token:
        # Проверяем токен ПЕРЕД сохранением
        is_valid = await validate_bot_token(bot_token)
        if not is_valid:
            return JSONResponse(status_code=400, content={"error": "Невалидный токен. Интеграция не может быть включена."})
    
    # Сохраняем настройки
    settings = await get_integration_settings(target_client_id, "telegram")
    settings.update({
        "bot_token": bot_token,
        "enabled": enabled,
        "assistant_enabled": bool(data.get("assistant_enabled", False)),
        "autoreply_enabled": bool(data.get("autoreply_enabled", False)),
        "autoreply_message": data.get("autoreply_message", "")
    })
    settings.pop("admin_id", None)  # Перенесено в integrations.notifications.admin_id
    await save_integration_settings(target_client_id, "telegram", settings)
    
    # Активируем или деактивируем вебхук
    if enabled and bot_token:
        webhook_url = f"{request.base_url}api/chat/telegram/webhook/{bot_token}"
        # Убираем двойные слеши если base_url закончился на /
        webhook_url = webhook_url.replace(":///", "://").replace("//api", "/api")
        success = await set_webhook(bot_token, webhook_url)
        if not success:
            log.error(f"Failed to set webhook for {target_client_id}")
    elif not enabled and bot_token:
        await delete_webhook(bot_token)
    
    return {"status": "success"}

@router.post("/check-token")
async def check_telegram_token(request: Request, user_data: dict = Depends(verify_token)):
    """Мгновенная проверка токена без сохранения."""
    try:
        data = await request.json()
        bot_token = data.get("bot_token")
        
        if not bot_token or len(bot_token) < 10 or ":" not in bot_token:
            return JSONResponse(status_code=400, content={"error": "Введите корректный API токен"})
        
        is_valid = await validate_bot_token(bot_token)
        if is_valid:
            return {"status": "ok"}
        else:
            return JSONResponse(status_code=400, content={"error": "Telegram API отклонил этот токен"})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

