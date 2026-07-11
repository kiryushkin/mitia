"""
MAX (TamTam) Bot Integration Service.
Обрабатывает входящие вебхуки, маршрутизирует сообщения в chat_service,
отправляет ответы ИИ обратно в MAX.
"""
import hashlib
import asyncio
import json
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

MAX_API = "https://platform-api2.max.ru"


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()[:16]


async def register_max_token(client_id: str, bot_token: str):
    if bot_token:
        cache_service.set(f"max_bot_token:{_token_hash(bot_token)}", client_id)


async def find_client_by_token(bot_token: str) -> Optional[str]:
    client_id = cache_service.get(f"max_bot_token:{_token_hash(bot_token)}")
    if client_id:
        return client_id
    try:
        clients = await list_clients()
        for c in clients:
            cid = c
            if not cid:
                continue
            settings = await get_integration_settings(cid, "max")
            if settings.get("bot_token") == bot_token and settings.get("enabled"):
                cache_service.set(f"max_bot_token:{_token_hash(bot_token)}", cid)
                return cid
    except Exception as e:
        log.error(f"Fallback client search failed: {e}")
    return None


async def get_or_create_max_session(client_id: str, max_chat_id: int, from_user: dict = None) -> str:
    cache_key = f"max_session:{client_id}:{max_chat_id}"
    session_id = cache_service.get(cache_key)
    if session_id:
        return session_id
    session_id = f"max-{client_id}-{max_chat_id}"
    
    user_info = {}
    if from_user:
        user_info = {
            "first_name": from_user.get("name"),
            "username": from_user.get("username"),
            "platform": "max"
        }

    async with AsyncSessionLocal() as db:
        await get_or_create_session(session_id, client_id, metadata=user_info)
    cache_service.set(cache_key, session_id)
    return session_id


async def send_max_message(bot_token: str, chat_id: int, text: str) -> bool:
    url = f"{MAX_API}/messages"
    
    try:
        async with httpx.AsyncClient(timeout=10, verify=False) as client:
            resp = await client.post(
                url, 
                params={"chat_id": chat_id, "access_token": bot_token}, 
                headers={"Authorization": bot_token},
                json={
                    "text": text,
                    "format": "markdown"
                }
            )
            if resp.status_code != 200:
                log.error(f"MAX sendMessage fail: {resp.status_code} {resp.text}")
                return False
            return True
    except Exception as e:
        log.error(f"MAX sendMessage error: {e}")
        return False


async def get_max_user_info(bot_token: str, user_id: int) -> dict:
    """Получает полную информацию о пользователе MAX (TamTam)."""
    url = f"{MAX_API}/users/{user_id}"
    headers = {"Authorization": bot_token}
    try:
        async with httpx.AsyncClient(timeout=5, verify=False) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 200:
                return resp.json()
            log.error(f"MAX get_user_info failed: {resp.status_code} {resp.text}")
    except Exception as e:
        log.error(f"Error getting MAX user info: {e}")
    return {}

async def get_max_chat_info(bot_token: str, chat_id: int) -> dict:
    """Получает информацию о чате."""
    url = f"{MAX_API}/chats/{chat_id}"
    headers = {"Authorization": bot_token}
    try:
        async with httpx.AsyncClient(timeout=5, verify=False) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 200:
                return resp.json()
    except Exception as e:
        log.error(f"Error getting MAX chat info: {e}")
    return {}

async def get_max_members(bot_token: str, chat_id: int) -> list:
    """Получает список участников чата."""
    url = f"{MAX_API}/chats/{chat_id}/members"
    headers = {"Authorization": bot_token}
    try:
        async with httpx.AsyncClient(timeout=5, verify=False) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 200:
                return resp.json().get("members", [])
    except Exception as e:
        log.error(f"Error getting MAX members: {e}")
    return []



async def handle_max_message(
    client_id: str, bot_token: str, max_chat_id: int,
    user_text: str, from_user: dict,
) -> bool:
    log.info("="*50)
    log.info(f"[MAX DEEP DEBUG] FROM_USER: {json.dumps(from_user, ensure_ascii=False)}")
    log.info(f"[MAX DEEP DEBUG] CHAT_ID: {max_chat_id}")

    user_id = from_user.get("user_id") or from_user.get("id")
    avatar_url = from_user.get("avatar_url") or from_user.get("avatar")

    if not avatar_url and max_chat_id:
        members = await get_max_members(bot_token, max_chat_id)
        for m in members:
            if m.get("user_id") == user_id:
                log.info(f"[MAX DEBUG] Found user in members! Data: {m}")
                avatar_url = m.get("avatar_url") or m.get("avatar")
                break

    if not avatar_url and max_chat_id:
        chat_info = await get_max_chat_info(bot_token, max_chat_id)
        log.info(f"[MAX DEBUG] Chat info: {chat_info}")
        
        dialog_user = chat_info.get("dialog_with_user")
        if dialog_user:
            avatar_url = dialog_user.get("full_avatar_url") or dialog_user.get("avatar_url")
        
        if not avatar_url and chat_info.get("icon"):
            avatar_url = chat_info["icon"].get("url")

    photo_meta = None
    if avatar_url:
        photo_meta = f"/api/chat/proxy/avatar?platform=max&client_id={client_id}&url={avatar_url}"
    log.info(f"[MAX DEBUG] FINAL AVATAR URL: {photo_meta}")
    log.info("="*50)

    user_info = {
        "first_name": from_user.get("name") or from_user.get("first_name"),
        "username": from_user.get("username"),
        "user_id": user_id,
        "photo": photo_meta,
        "platform": "max"
    }

    if from_user.get("phone_number"):
        user_info["phone"] = from_user.get("phone_number")
    session_id = f"max-{client_id}-{max_chat_id}"
    
    async with AsyncSessionLocal() as db:
        await get_or_create_session(session_id, client_id, metadata=user_info)

    cache_key = f"max_session:{client_id}:{max_chat_id}"
    cache_service.set(cache_key, session_id)

    settings = await get_integration_settings(client_id, "max")
    if not settings.get("enabled"):
        log.warning(f"MAX message ignored: integration disabled for client {client_id}")
        return False

    assistant_enabled = settings.get("assistant_enabled", True)

    from sqlalchemy import select
    from ..services.db_service import ChatSession

    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(ChatSession.is_operator_mode).where(
                ChatSession.session_id == session_id
            )
        )
        is_operator = res.scalar_one_or_none()

    if is_operator or not assistant_enabled:
        await save_chat_message(session_id, "user", user_text)

        autoreply_enabled = settings.get("autoreply_enabled", False)
        autoreply_message = (settings.get("autoreply_message") or "").strip()

        operator_fallback = ""
        try:
            client_config = await get_client_config(client_id)
            operator_fallback = (client_config.raw.get("bot_settings", {}).get("ai_unavailable_message") or "").strip()
        except Exception as e:
            log.warning(f"[MAX] Failed to get ai_unavailable_message for {client_id}: {e}")

        # В ручном режиме (is_operator) отвечаем только явным текстом из интеграции.
        # Если текст не задан — ничего клиенту не отправляем.
        if is_operator:
            reply_text = autoreply_message if (autoreply_enabled and autoreply_message) else ""
        else:
            # Для выключенного ассистента (но без явного takeover) допускаем fallback из Интеллекта.
            reply_text = autoreply_message if (autoreply_enabled and autoreply_message) else operator_fallback

        if reply_text:
            await send_max_message(bot_token, max_chat_id, reply_text)
            await save_chat_message(session_id, "assistant", reply_text)

        return True

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
        
        while isinstance(response_text, dict):
            response_text = extract_response_text(response_text)

        response_text = str(response_text) if response_text is not None else ""

        if result and isinstance(result, dict) and result.get("status") == "function_call":
            log.info(f"[MAX] AI requested function call, waiting for final response...")
            if not response_text.strip() or response_text == "None":
                return True

        if not response_text.strip() or response_text == "None":
            response_text = "Извините, я не смог сформировать текстовый ответ. Попробуйте перефразировать вопрос."

        await send_max_message(bot_token, max_chat_id, response_text)
        return True

    except Exception as e:
        log.error(f"MAX message handling error: {e}")
        await send_max_message(
            bot_token, max_chat_id,
            "Произошла ошибка при обработке сообщения."
        )
        return False


async def set_webhook(bot_token: str, webhook_url: str) -> bool:
    url = f"{MAX_API}/subscriptions"
    try:
        async with httpx.AsyncClient(timeout=3, verify=False) as client:
            resp = await client.post(
                url, 
                params={"access_token": bot_token}, 
                headers={"Authorization": bot_token},
                json={"url": webhook_url}
            )
            if resp.status_code == 200:
                log.info(f"MAX Webhook set: {webhook_url}")
                return True
            log.error(f"Failed to set MAX webhook: {resp.text}")
            return False
    except Exception as e:
        log.error(f"MAX setWebhook error: {e}")
        return False


async def delete_webhook(bot_token: str) -> bool:
    url = f"{MAX_API}/subscriptions"
    try:
        async with httpx.AsyncClient(timeout=3, verify=False) as client:
            resp = await client.delete(url, params={"access_token": bot_token})
            return resp.status_code == 200
    except Exception as e:
        log.error(f"MAX deleteWebhook error: {e}")
        return False


async def validate_bot_token(bot_token: str) -> bool:
    url = f"{MAX_API}/me"
    try:
        async with httpx.AsyncClient(timeout=3, verify=False) as client:
            resp = await client.get(
                url, 
                params={"access_token": bot_token}, 
                headers={"Authorization": bot_token}
            )
            return resp.status_code == 200
    except Exception as e:
        log.error(f"MAX token validation error: {e}")
        return False


async def poll_max_updates(client_id: str, bot_token: str):
    """Опрос обновлений MAX (аналог Polling в Telegram) для работы на localhost."""
    await delete_webhook(bot_token)
    
    async with httpx.AsyncClient(timeout=3, verify=False) as client:
        me_resp = await client.get(f"{MAX_API}/me", params={"access_token": bot_token}, headers={"Authorization": bot_token})
        if me_resp.status_code == 200:
            me_data = me_resp.json()
            log.info(f"[MAX] Polling started for bot: {me_data.get('name')} (@{me_data.get('username')})")
        else:
            log.error(f"[MAX] Failed to get bot info: {me_resp.text}")

    marker = None
    url = f"{MAX_API}/updates"
    
    log.info(f"Starting MAX Polling for {client_id}...")
    
    async with httpx.AsyncClient(timeout=30, verify=False) as client:
        while True:
            try:
                params = {
                    "access_token": bot_token, 
                    "timeout": 20,
                    "types": "message_created,message_callback,chat_title_changed,message_construction,message_removed,bot_added,bot_removed,user_added,user_removed,bot_started"
                }
                if marker:
                    params["marker"] = marker
                
                resp = await client.get(url, params=params, headers={"Authorization": bot_token})
                
                if resp.status_code == 200:
                    data = resp.json()
                    marker = data.get("marker")
                    updates = data.get("updates", [])
                    
                    if updates:
                        log.info(f"[MAX] RAW UPDATES RECEIVED: {json.dumps(data, ensure_ascii=False)}")
                    
                    for update in updates:
                        u_type = update.get("update_type")
                        log.info(f"[MAX] Update type: {u_type}")
                        
                        if u_type == "message_created":
                            message = update.get("message", {})
                            recipient = message.get("recipient", {})
                            sender = message.get("sender", {})
                            
                            max_chat_id = recipient.get("chat_id") or sender.get("user_id")
                            user_text = message.get("body", {}).get("text") or ""
                            
                            attachments = message.get("body", {}).get("attachments", [])
                            attachment_links = []
                            found_phone = None
                            session_id = f"max-{client_id}-{max_chat_id}"

                            for att in attachments:
                                att_type = att.get("type")
                                payload = att.get("payload", {})
                                
                                if att_type == "contact":
                                    vcf = payload.get("vcf_info", "")
                                    if "TEL;" in vcf:
                                        import re
                                        match = re.search(r"TEL;.*?:(.*?)(?:\r|\n|$)", vcf)
                                        if match:
                                            found_phone = match.group(1).strip()
                                            attachment_links.append(f"📱 Контакт: {found_phone}")

                                url = payload.get("url")
                                if not url:
                                    url = payload.get("download_url") or payload.get("file_url")
                                
                                if url:
                                    if att_type == "image":
                                        local_url = await download_and_save_file(
                                            url, client_id, session_id=session_id,
                                            file_name="photo.jpg", category="chat_file"
                                        )
                                        attachment_links.append(f"🖼 Фото: {local_url or url}")
                                    elif att_type == "video":
                                        local_url = await download_and_save_file(
                                            url, client_id, session_id=session_id,
                                            file_name="video.mp4", category="chat_file"
                                        )
                                        attachment_links.append(f"🎥 Видео: {local_url or url}")
                                    elif att_type == "file":
                                        local_url = await download_and_save_file(
                                            url, client_id, session_id=session_id,
                                            file_name=payload.get("file_name", "file"), category="chat_file"
                                        )
                                        attachment_links.append(f"📄 Файл: {local_url or url}")
                            
                            if attachment_links:
                                extra_text = "\n".join(attachment_links)
                                user_text = f"{user_text}\n\n{extra_text}".strip()
                            
                            if max_chat_id and (user_text or found_phone):
                                log.info(f"[MAX] New message from {max_chat_id}")
                                if found_phone:
                                    sender["phone_number"] = found_phone
                                
                                await handle_max_message(
                                    client_id, bot_token, max_chat_id, user_text, sender
                                )
                elif resp.status_code == 401:
                    log.error(f"[MAX] 401 Unauthorized. Check token.")
                    break
                else:
                    log.error(f"[MAX] Error {resp.status_code}: {resp.text}")
                    await asyncio.sleep(5)
                    
            except Exception as e:
                log.error(f"[MAX] Loop error: {e}")
                await asyncio.sleep(5)


async def send_max_file(bot_token: str, chat_id: int, file_data: str, filename: str, content_type: str) -> bool:
    """Отправка файла в MAX через URL или загрузку."""
    url = f"{MAX_API}/messages"
    try:
        text = f"📎 Оператор прислал файл: {filename}"
        return await send_max_message(bot_token, chat_id, text)
    except Exception as e:
        log.error(f"MAX sendFile error: {e}")
        return False


async def send_operator_message_to_max(
    client_id: str, session_id: str, message: str, attachments: list = None, operator_name: str = "Оператор"
) -> bool:
    if not session_id.startswith(f"max-{client_id}-"):
        return False
    try:
        max_chat_id = int(session_id.split("-")[-1])
    except (ValueError, IndexError):
        return False
    settings = await get_integration_settings(client_id, "max")
    bot_token = settings.get("bot_token")
    if not bot_token or not settings.get("enabled"):
        return False
    
    display_message = f"👤 *{operator_name}*: {message}" if message else ""
    
    success = True
    if display_message:
        success = await send_max_message(bot_token, max_chat_id, display_message)
    
    if attachments:
        for att in attachments:
            await send_max_file(bot_token, max_chat_id, att.get("data"), att.get("name"), att.get("content_type"))
            
    return success


async def run_max_polling():
    """Запускает Polling для всех клиентов, у которых включен MAX."""
    log.info("Starting MAX Polling service...")
    clients = await list_clients()
    for c in clients:
        client_id = c if isinstance(c, str) else (c.get("client_id") or c.get("id"))
        if client_id:
            cache_service.delete(f"max_polling_task:{client_id}")

    while True:
        try:
            clients = await list_clients()
            for c in clients:
                client_id = c if isinstance(c, str) else (c.get("client_id") or c.get("id"))
                if not client_id:
                    continue
                
                settings = await get_integration_settings(client_id, "max")
                if settings.get("enabled") and settings.get("bot_token"):
                    task_key = f"max_polling_task:{client_id}"
                    if not cache_service.get(task_key):
                        log.info(f"!!! ACTIVATING MAX POLLING FOR {client_id} !!!")
                        asyncio.create_task(poll_max_updates(client_id, settings["bot_token"]))
                        cache_service.set(task_key, True, expire=3600)
            
            await asyncio.sleep(30) 
        except Exception as e:
            log.error(f"MAX run_polling error: {e}")
            await asyncio.sleep(10)
