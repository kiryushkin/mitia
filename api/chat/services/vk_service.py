"""
VK Messenger Integration Service.
Обрабатывает входящие вебхуки от ВК, маршрутизирует сообщения в chat_service,
отправляет ответы ИИ обратно в ВК.
"""
import hashlib
import random
from typing import Optional

import httpx

from ..core.config import log
from ..services.clients import list_clients, get_client_config
from ..services.integrations_service import get_integration_settings
from ..services.db_service import (
    AsyncSessionLocal, get_or_create_session, save_chat_message, is_operator_mode,
    download_and_save_file
)
from ..services.chat_service import chat_service, extract_response_text, AskData
from .cache_service import cache_service

VK_API = "https://api.vk.com/method"
VK_VERSION = "5.131"


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()[:16]


async def find_client_by_group_id(group_id: int) -> Optional[str]:
    """Ищет client_id по ID группы ВК."""
    cache_key = f"vk_group_client:{group_id}"
    
    try:
        clients = await list_clients()
        log.info(f"[VK SEARCH] Searching for group_id {group_id} among {len(clients)} clients")
        
        for c in clients:
            # Определяем client_id (может быть в разных полях)
            cid = None
            if isinstance(c, dict):
                cid = c.get("client_id") or c.get("id")
            elif isinstance(c, str):
                cid = c
            
            if not cid:
                continue
                
            log.info(f"[VK SEARCH] Checking client: {cid}")
            settings = await get_integration_settings(cid, "vk")
            
            # Декодируем настройки, если они пришли строкой
            if isinstance(settings, str):
                try:
                    import json
                    settings = json.loads(settings)
                except:
                    continue
            
            if not isinstance(settings, dict):
                continue

            conf_group_id = settings.get("group_id")
            log.info(f"[VK SEARCH] Client {cid} has group_id: {conf_group_id}")
            
            if str(conf_group_id) == str(group_id) and settings.get("enabled"):
                log.info(f"[VK SEARCH] FOUND MATCH: {cid}")
                cache_service.set(cache_key, cid)
                return cid
    except Exception as e:
        log.error(f"[VK SEARCH] Critical error: {e}")
    
    return None


async def get_vk_user_info(access_token: str, user_id: int) -> dict:
    """Получает информацию о пользователе ВК."""
    url = f"{VK_API}/users.get"
    params = {
        "access_token": access_token,
        "user_ids": user_id,
        "fields": "photo_50,screen_name",
        "v": VK_VERSION
    }
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(url, data=params)
            data = resp.json()
            log.info(f"VK users.get response for {user_id}: {data}")
            if "response" in data and len(data["response"]) > 0:
                user = data["response"][0]
                return {
                    "first_name": user.get("first_name"),
                    "last_name": user.get("last_name"),
                    "username": user.get("screen_name"),
                    "photo": user.get("photo_50")
                }
    except Exception as e:
        log.error(f"VK get_user_info error: {e}")
    return {}


async def get_or_create_vk_session(client_id: str, vk_user_id: int, metadata: Optional[dict] = None) -> str:
    """Создает или получает существующую сессию для пользователя ВК."""
    session_id = f"vk-{client_id}-{vk_user_id}"
    
    # Проверяем кэш только если нет метаданных для обновления
    if not metadata:
        cache_key = f"vk_session:{client_id}:{vk_user_id}"
        cached_id = cache_service.get(cache_key)
        if cached_id:
            return cached_id
        
    user_info = {
        "platform": "vk",
        "vk_user_id": vk_user_id,
        "source": "vk"
    }
    if metadata:
        user_info.update(metadata)

    async with AsyncSessionLocal() as db:
        await get_or_create_session(session_id, client_id, metadata=user_info)
    
    cache_key = f"vk_session:{client_id}:{vk_user_id}"
    cache_service.set(cache_key, session_id)
    return session_id


async def send_vk_message(access_token: str, peer_id: int, text: str) -> bool:
    """Отправляет сообщение в ВК."""
    url = f"{VK_API}/messages.send"
    
    params = {
        "access_token": access_token,
        "peer_id": peer_id,
        "message": text,
        "random_id": random.randint(1, 2**31),
        "v": VK_VERSION
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, data=params)
            data = resp.json()
            if "error" in data:
                log.error(f"VK sendMessage fail: {data['error']}")
                return False
            log.info(f"VK message sent to {peer_id}")
            return True
    except Exception as e:
        log.error(f"VK sendMessage error: {e}")
        return False


async def send_vk_typing(access_token: str, peer_id: int) -> bool:
    """Показывает статус 'печатает' в ВК."""
    url = f"{VK_API}/messages.setActivity"
    params = {
        "access_token": access_token,
        "peer_id": peer_id,
        "type": "typing",
        "v": VK_VERSION
    }
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(url, data=params)
            return True
    except Exception:
        return False


async def handle_vk_message(
    client_id: str, access_token: str, vk_user_id: int, user_text: str,
    attachments: list = None
) -> bool:
    """Основная логика обработки сообщения от ВК."""
    # Получаем инфо о пользователе
    vk_user_info = await get_vk_user_info(access_token, vk_user_id)
    session_id = await get_or_create_vk_session(client_id, vk_user_id, metadata=vk_user_info)

    # Обработка вложений — скачиваем файлы
    attachment_links = []
    if attachments:
        for att in attachments:
            att_type = att.get("type")
            if att_type == "photo":
                photo = att.get("photo", {})
                sizes = photo.get("sizes", [])
                if sizes:
                    largest = max(sizes, key=lambda s: s.get("width", 0) * s.get("height", 0))
                    photo_url = largest.get("url")
                    if photo_url:
                        local_url = await download_and_save_file(
                            photo_url, client_id, session_id=session_id,
                            file_name="photo.jpg", category="chat_file"
                        )
                        attachment_links.append(f"🖼 Фото: {local_url or photo_url}")
            elif att_type == "doc":
                doc = att.get("doc", {})
                doc_url = doc.get("url")
                doc_name = doc.get("title", "файл")
                if doc_url:
                    local_url = await download_and_save_file(
                        doc_url, client_id, session_id=session_id,
                        file_name=doc_name, category="chat_file"
                    )
                    attachment_links.append(f"📄 Файл {doc_name}: {local_url or doc_url}")
            elif att_type == "video":
                video = att.get("video", {})
                # VK может не давать прямую ссылку на скачивание видео
                video_title = video.get("title", "видео")
                owner_id = video.get("owner_id")
                video_id = video.get("id")
                if owner_id and video_id:
                    video_url = f"https://vk.com/video{owner_id}_{video_id}"
                    attachment_links.append(f"🎥 Видео: {video_title} ({video_url})")
            elif att_type == "audio":
                audio = att.get("audio", {})
                audio_url = audio.get("url")
                audio_name = f"{audio.get('artist', '')} - {audio.get('title', 'аудио')}".strip(" -")
                if audio_url:
                    local_url = await download_and_save_file(
                        audio_url, client_id, session_id=session_id,
                        file_name=audio_name or "audio.mp3", category="chat_file"
                    )
                    attachment_links.append(f"🎵 Аудио: {audio_name} ({local_url or audio_url})")

    if attachment_links:
        extra_text = "\n".join(attachment_links)
        user_text = f"{user_text}\n\n{extra_text}".strip()

    is_operator = await is_operator_mode(session_id)

    settings = await get_integration_settings(client_id, "vk")
    if not settings.get("enabled"):
        return False

    assistant_enabled = settings.get("assistant_enabled", True)

    if is_operator or not assistant_enabled:
        await save_chat_message(session_id, "user", user_text)

        autoreply_enabled = settings.get("autoreply_enabled", False)
        autoreply_message = (settings.get("autoreply_message") or "").strip()

        if is_operator and autoreply_enabled and autoreply_message:
            await send_vk_message(access_token, vk_user_id, autoreply_message)
            await save_chat_message(session_id, "assistant", autoreply_message)

        return True

    await send_vk_typing(access_token, vk_user_id)

    data = AskData(
        client_id=client_id,
        session_id=session_id,
        message=user_text,
        token=session_id,
        context=None,
        voice_output=False,
        stream=False,
    )

    try:
        result = await chat_service.process_ask(data, files=None, stream=False, is_admin=False)

        response_text = extract_response_text(result)

        if not response_text or response_text == "None" or response_text.strip() == "":
            response_text = "Извините, я не смог сформировать текстовый ответ. Попробуйте перефразировать вопрос."

        import re
        response_text = re.sub('<[^<]+?>', '', response_text)

        max_len = 4000
        if len(response_text) > max_len:
            for i in range(0, len(response_text), max_len):
                await send_vk_message(access_token, vk_user_id, response_text[i:i+max_len])
        else:
            await send_vk_message(access_token, vk_user_id, response_text)

        return True

    except Exception as e:
        log.error(f"VK message handling error: {e}")
        return False

async def send_operator_message_to_vk(
    client_id: str, session_id: str, message: str, operator_name: str = "Оператор"
) -> bool:
    """Отправка сообщения от оператора в ВК."""
    if not session_id.startswith(f"vk-{client_id}-"):
        return False
    try:
        vk_user_id = int(session_id.split("-")[-1])
    except (ValueError, IndexError):
        return False
        
    settings = await get_integration_settings(client_id, "vk")
    access_token = settings.get("access_token")
    if not access_token or not settings.get("enabled"):
        return False
    
    display_message = f"👤 {operator_name}: {message}" if message else ""
    if display_message:
        return await send_vk_message(access_token, vk_user_id, display_message)
    return False


def _translate_vk_error(err_msg: str) -> str:
    """Переводит ошибки VK API в понятные пользователю сообщения."""
    err_lower = err_msg.lower()
    
    if "access denied" in err_lower or "no access" in err_lower:
        return "У этого токена нет доступа к указанному сообществу."
    if "group auth" in err_lower or "unavailable with group auth" in err_lower:
        return None
    if "invalid access token" in err_lower:
        return "Неверный токен. Проверьте, что токен скопирован целиком и не истёк."
    if "invalid group id" in err_lower or "group not found" in err_lower:
        return "Сообщество с таким ID не найдено. Проверьте ID сообщества в настройках VK."
    if "permission" in err_lower:
        return "У токена недостаточно прав. В настройках токена отметьте 'Управление сообществом' и 'Сообщения'."
    
    return f"Ошибка VK: {err_msg}"


async def check_vk_token(access_token: str, group_id: str) -> dict:
    """Проверяет валидность токена и привязку к группе."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(f"{VK_API}/groups.getById", data={
                "access_token": access_token,
                "group_ids": group_id,
                "v": VK_VERSION
            })
            data = resp.json()
            if "error" in data:
                err_msg = data["error"].get("error_msg", "")
                translated = _translate_vk_error(err_msg)
                return {"status": "error", "error": translated or err_msg or "Ошибка авторизации — неверный токен"}
            
            groups = data.get("response", [])
            if not groups:
                return {"status": "error", "error": "Сообщество с таким ID не найдено. Проверьте ID сообщества."}
            
            group = groups[0]

            members_resp = await client.post(f"{VK_API}/groups.getMembers", data={
                "access_token": access_token,
                "group_id": group_id,
                "v": VK_VERSION
            })
            members_data = members_resp.json()
            if "error" in members_data:
                err_msg = members_data["error"].get("error_msg", "")
                translated = _translate_vk_error(err_msg)
                if translated is None:
                    conv_resp = await client.post(f"{VK_API}/messages.getConversations", data={
                        "access_token": access_token,
                        "group_id": group_id,
                        "v": VK_VERSION
                    })
                    conv_data = conv_resp.json()
                    if "error" in conv_data:
                        err2 = conv_data["error"].get("error_msg", "")
                        translated = _translate_vk_error(err2)
                        return {"status": "error", "error": translated or f"Токен не может работать с сообществом {group_id}. Создайте новый токен в настройках этого сообщества."}
                else:
                    return {"status": "error", "error": translated}
            
            return {
                "status": "ok",
                "group_name": group.get("name"),
                "group_id": group.get("id")
            }
    except Exception as e:
        return {"status": "error", "error": str(e)}
