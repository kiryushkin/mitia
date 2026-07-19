import httpx
import json
import logging
import random
import asyncio
import time
import traceback
import re
from datetime import datetime
from typing import Optional

from ..core.config import log
from ..services.integrations_service import get_integration_settings, save_integration_settings
from ..services.db_service import (
    AsyncSessionLocal, get_or_create_session, save_chat_message, is_operator_mode,
    download_and_save_file
)
from ..services.chat_service import chat_service, extract_response_text, AskData
from .base_polling_service import base_polling_service

logger = logging.getLogger(__name__)

AVITO_API = "https://api.avito.ru"

avito_sync_progress = {}  # client_id -> {"total": 0, "current": 0, "status": "..."}


def _mask_secret(value: object, visible_tail: int = 4) -> str:
    raw = str(value or "")
    if not raw:
        return ""
    if len(raw) <= visible_tail:
        return "*" * len(raw)
    return "***" + raw[-visible_tail:]


def _redact_text(text: object) -> str:
    raw = str(text or "")
    if not raw:
        return ""

    patterns = [
        (r"(?i)(access_token\s*[=:]\s*)([^\s\",}]+)", r"\1***"),
        (r"(?i)(client_secret\s*[=:]\s*)([^\s\",}]+)", r"\1***"),
        (r"(?i)(authorization\s*[=:]\s*bearer\s+)([^\s\",}]+)", r"\1***"),
        (r"(?i)(bearer\s+)([A-Za-z0-9._\-]+)", r"\1***"),
    ]

    redacted = raw
    for pattern, repl in patterns:
        redacted = re.sub(pattern, repl, redacted)
    return redacted


def _sanitize_avito_settings(settings: dict) -> dict:
    if not isinstance(settings, dict):
        return {}

    safe = dict(settings)
    for key in ("client_secret", "access_token", "refresh_token", "token", "authorization"):
        if key in safe and safe.get(key):
            safe[key] = _mask_secret(safe.get(key))
    return safe


def extract_avito_text(payload: dict) -> str:
    """Пытается извлечь текст сообщения Avito из разных возможных структур payload."""
    if not isinstance(payload, dict):
        return str(payload or "")

    candidates = [
        payload.get("text"),
        payload.get("message"),
        payload.get("body", {}).get("text") if isinstance(payload.get("body"), dict) else None,
        payload.get("content", {}).get("text") if isinstance(payload.get("content"), dict) else None,
        payload.get("content", {}).get("value") if isinstance(payload.get("content"), dict) else None,
        payload.get("value", {}).get("text") if isinstance(payload.get("value"), dict) else None,
        payload.get("value", {}).get("content", {}).get("text") if isinstance(payload.get("value"), dict) and isinstance(payload.get("value", {}).get("content"), dict) else None,
    ]

    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
        if isinstance(candidate, dict):
            nested = candidate.get("text") or candidate.get("message") or candidate.get("value")
            if isinstance(nested, str) and nested.strip():
                return nested.strip()

    return ""


async def get_avito_voice_file_url(client_id: str, client_secret: str, account_id: str, voice_id: str) -> str | None:
    """Resolve a temporary Avito voice URL by voice_id."""
    token = await get_access_token(client_id, client_secret)
    if not token or not account_id or not voice_id:
        return None
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                f"{AVITO_API}/messenger/v1/accounts/{account_id}/getVoiceFiles",
                params={"voice_ids": voice_id},
                headers={"Authorization": f"Bearer {token}"},
            )
        if response.status_code == 200:
            return (response.json().get("voices_urls") or {}).get(voice_id)
        log.warning("[AVITO] Voice URL request failed: HTTP %s", response.status_code)
    except Exception as exc:
        log.warning("[AVITO] Voice URL request error: %s", exc)
    return None


async def extract_avito_attachments(
    msg: dict, client_id: str, session_id: str, assistant_id: str | None = None,
    avito_client_id: str = "", avito_client_secret: str = "", account_id: str = "",
) -> tuple[list[str], list[dict]]:
    """Извлекает и скачивает вложения из сообщения Avito.
    Возвращает список строк-ссылок для подстановки в текст."""
    content = msg.get("content", {})
    if not isinstance(content, dict):
        return [], []

    links = []
    stored_attachments = []

    # Изображения
    image = content.get("image", {})
    if isinstance(image, dict):
        sizes = image.get("sizes", {})
        if isinstance(sizes, dict):
            best_url = sizes.get("1280x960") or sizes.get("640x480") or (list(sizes.values())[-1] if sizes else None)
            if best_url:
                local_url = await download_and_save_file(
                    best_url, client_id, session_id=session_id,
                    file_name="photo.jpg", category="chat_file", assistant_id=assistant_id
                )
                links.append(f"🖼 Фото: {local_url or best_url}")
                if local_url:
                    stored_attachments.append({"name": "photo.jpg", "content_type": "image/jpeg", "local_url": local_url})

    # Voice URLs are short-lived, so download the actual file immediately.
    voice = content.get("voice", {})
    if isinstance(voice, dict) and voice.get("voice_id"):
        voice_id = str(voice["voice_id"])
        voice_url = await get_avito_voice_file_url(
            avito_client_id, avito_client_secret, account_id, voice_id
        )
        if voice_url:
            local_url = await download_and_save_file(
                voice_url, client_id, session_id=session_id, file_name="avito-voice.mp4",
                category="chat_file", assistant_id=assistant_id,
            )
            links.append(f"🎤 Голосовое: {local_url or voice_url}")
            if local_url:
                stored_attachments.append({"name": "avito-voice.mp4", "content_type": "audio/mp4", "local_url": local_url})
                from .stt_service import transcribe_voice
                transcript = await transcribe_voice(local_url)
                if transcript:
                    links.append(f"📝 Расшифровка голосового: {transcript}")
        else:
            links.append("🎤 Голосовое сообщение")

    # Ссылка с preview
    link = content.get("link", {})
    if isinstance(link, dict):
        preview = link.get("preview", {})
        if isinstance(preview, dict):
            preview_images = preview.get("images", {})
            if isinstance(preview_images, dict):
                best_url = preview_images.get("1280x960") or preview_images.get("640x480") or (list(preview_images.values())[-1] if preview_images else None)
                if best_url:
                    local_url = await download_and_save_file(
                        best_url, client_id, session_id=session_id,
                        file_name="preview.jpg", category="chat_file", assistant_id=assistant_id
                    )
                    links.append(f"🖼 Превью: {local_url or best_url}")

    # Объявление
    item = content.get("item", {})
    if isinstance(item, dict):
        item_url = item.get("item_url", "")
        item_title = item.get("title", "Объявление")
        if item_url:
            links.append(f"📦 Объявление: {item_title} ({item_url})")

    return links, stored_attachments


async def get_access_token(client_id: str, client_secret: str) -> Optional[str]:
    """Получает access token для API Avito."""
    url = f"{AVITO_API}/token/"
    data = {
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": "messenger:read messenger:write"
    }
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(url, data=data)
            res_json = response.json()
            if response.status_code == 200 and "access_token" in res_json:
                return res_json["access_token"]
        except Exception as e:
            logger.error(f"Avito get_access_token error: {e}")
    return None


async def check_avito_credentials(client_id: str, client_secret: str) -> dict:
    """Проверяет валидность Client ID и Client Secret."""
    url = f"{AVITO_API}/token/"
    data = {
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": "messenger:read messenger:write"
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(url, data=data)
            res_json = response.json()

            if response.status_code == 200 and "access_token" in res_json:
                return {"status": "ok", "access_token": res_json["access_token"]}
            else:
                error_code = res_json.get("error")
                error_desc = res_json.get("error_description", "")

                translations = {
                    "invalid_client": "Неверный Client ID или Client Secret",
                    "unauthorized_client": "Приложение не авторизовано для получения токена этим методом",
                    "access_denied": "Доступ запрещен",
                    "server_error": "Ошибка на стороне сервера Avito"
                }

                msg = translations.get(error_code) or translations.get(error_desc) or "Неверные учетные данные (проверьте Client ID и Secret)"
                return {"status": "error", "error": msg}
        except Exception as e:
            logger.error(f"Avito auth error: {e}")
            return {"status": "error", "error": "Ошибка подключения к API Avito"}


async def setup_avito_webhook(client_id: str, client_secret: str, webhook_url: str) -> dict:
    """Регистрирует вебхук в Avito."""
    token = await get_access_token(client_id, client_secret)
    if not token:
        return {"status": "error", "error": "Не удалось получить access token"}

    url = f"{AVITO_API}/messenger/v3/webhook"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    data = {"url": webhook_url}

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(url, headers=headers, json=data)
            if response.status_code == 200:
                return {"status": "ok"}
            else:
                return {"status": "error", "error": f"Ошибка регистрации вебхука: {response.text}"}
        except Exception as e:
            return {"status": "error", "error": str(e)}


async def delete_avito_webhook(client_id: str, client_secret: str):
    """Удаляет вебхук Avito."""
    token = await get_access_token(client_id, client_secret)
    if not token:
        return

    url = f"{AVITO_API}/messenger/v3/webhook"
    headers = {"Authorization": f"Bearer {token}"}

    async with httpx.AsyncClient() as client:
        try:
            await client.delete(url, headers=headers)
        except Exception as e:
            logger.error(f"Avito delete webhook error: {e}")


async def send_avito_message(client_id: str, client_secret: str, chat_id: str, text: str, user_id: str = "") -> bool:
    """Отправляет сообщение в чат Avito."""
    token = await get_access_token(client_id, client_secret)
    if not token:
        return False

    # v1 API требует accounts/{user_id}/chats/{chat_id}/messages
    if user_id:
        url = f"{AVITO_API}/messenger/v1/accounts/{user_id}/chats/{chat_id}/messages"
    else:
        url = f"{AVITO_API}/messenger/v3/chat/{chat_id}/messages"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    payload = {
        "message": {
            "text": text
        },
        "type": "text"
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code == 402:
                logger.error(f"[AVITO] Payment Required (402): {_redact_text(resp.text)}. Please enable Messenger API subscription in Avito.")
            elif resp.status_code != 200:
                logger.warning(f"Avito send message failed: {resp.status_code} {_redact_text(resp.text)}")
            return resp.status_code == 200
    except Exception as e:
        logger.error(f"Avito send message error: {e}")
        return False


def _extract_avito_profile(user: dict) -> dict:
    """Extracts card-friendly Avito user metadata from chat users payload."""
    if not isinstance(user, dict):
        return {}

    name = user.get("name") or user.get("public_name") or user.get("display_name") or ""
    profile = user.get("public_user_profile") or user.get("profile") or {}
    if isinstance(profile, dict):
        name = name or profile.get("name") or ""

    avatar_url = ""
    avatar_sources = [
        user.get("avatar"),
        user.get("images"),
        profile.get("avatar") if isinstance(profile, dict) else None,
    ]
    for source in avatar_sources:
        if isinstance(source, str):
            avatar_url = source
        elif isinstance(source, dict):
            images = source.get("images") if isinstance(source.get("images"), dict) else source
            avatar_url = (
                images.get("256x256") or images.get("192x192") or images.get("128x128")
                or images.get("60x60") or images.get("50x50") or images.get("default")
                or source.get("default", "")
            )
        if avatar_url:
            break

    phone = user.get("phone") or user.get("phone_number") or user.get("contact_phone") or ""
    contact = phone or user.get("email") or user.get("contact") or ""
    profile_url = profile.get("url", "") if isinstance(profile, dict) else ""

    result = {}
    if name:
        result["name"] = name
        result["first_name"] = name
    if avatar_url:
        result["avatar_url"] = avatar_url
    if profile_url:
        result["profile_url"] = profile_url
    if phone:
        result["phone"] = phone
    if contact:
        result["contact"] = contact
    return result


async def get_avito_user_info(client_id: str, client_secret: str, account_id: str, chat_id: str, target_user_id: str = "") -> dict:
    """Gets Avito interlocutor metadata (name, avatar, contacts) for dialog cards."""
    token = await get_access_token(client_id, client_secret)
    if not token:
        return {}

    url = f"{AVITO_API}/messenger/v2/accounts/{account_id}/chats/{chat_id}"
    headers = {"Authorization": f"Bearer {token}"}

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, headers=headers)
            if response.status_code != 200:
                logger.warning(f"Avito get user info failed: {response.status_code} {_redact_text(response.text)[:200]}")
                return {}

            data = response.json()
            users = data.get("users", []) or []
            target_user = None

            if target_user_id:
                for user in users:
                    if str(user.get("id", "")) == str(target_user_id):
                        target_user = user
                        break

            if not target_user:
                for user in users:
                    uid = str(user.get("id", ""))
                    if uid and uid != str(account_id):
                        target_user = user
                        break

            if not target_user and users:
                target_user = users[0]

            metadata = _extract_avito_profile(target_user or {})
            if target_user_id:
                metadata.setdefault("user_id", str(target_user_id))
                metadata.setdefault("avito_user_id", str(target_user_id))
            if not metadata.get("name"):
                metadata["name"] = f"Avito Пользователь {target_user_id or chat_id}"
                metadata["first_name"] = metadata["name"]
            return metadata
        except Exception as e:
            logger.error(f"Avito get user info error: {e}")
    return {}


async def get_or_create_avito_session(client_id: str, user_id: str, metadata: Optional[dict] = None, assistant_id: str | None = None) -> str:
    """Создает или получает существующую сессию для пользователя Avito."""
    session_id = f"avito-{client_id}-{assistant_id or 'main'}-{user_id}"

    user_info = {
        "platform": "avito",
        "avito_user_id": user_id,
        "source": "avito"
    }
    if metadata:
        user_info.update(metadata)

    async with AsyncSessionLocal() as db:
        await get_or_create_session(session_id, client_id, metadata=user_info, assistant_id=assistant_id)

    return session_id


async def handle_avito_message(
    client_id: str, client_secret: str, chat_id: str, user_id: str, user_text: str,
    item_id: Optional[str] = None, author_id: str = "", item_context: Optional[dict] = None,
    timestamp=None, skip_ai=False, account_id: str = "", assistant_id: str | None = None,
    attachments: list[dict] | None = None,
) -> bool:
    """Основная логика обработки сообщения от Avito."""
    metadata = {}
    if item_id:
        metadata["item_id"] = item_id
    if chat_id:
        metadata["avito_chat_id"] = chat_id
    if author_id:
        metadata["author_id"] = author_id

    settings = await get_integration_settings(client_id, "avito", assistant_id=assistant_id)
    if isinstance(settings, str):
        try:
            import json
            settings = json.loads(settings)
        except Exception:
            return False
    if not settings.get("enabled"):
        return False

    avito_client_id = settings.get("client_id", "")
    avito_client_secret = settings.get("client_secret", client_secret)

    avito_account_id = account_id or user_id
    target_user_id = user_id
    if author_id and author_id != str(avito_account_id):
        target_user_id = author_id

    user_info = await get_avito_user_info(avito_client_id, avito_client_secret, avito_account_id, chat_id, target_user_id=target_user_id)
    if user_info:
        metadata.update(user_info)

    session_id = await get_or_create_avito_session(client_id, target_user_id, metadata=metadata, assistant_id=assistant_id)

    is_operator = await is_operator_mode(session_id)
    assistant_enabled = bool(settings.get("assistant_enabled", False))
    if is_operator or not assistant_enabled:
        await save_chat_message(session_id, "user", user_text, attachments=attachments or None)
        from .operator_notification_service import (
            build_incoming_message_notification,
            notify_operators,
        )
        await notify_operators(
            client_id,
            build_incoming_message_notification(
                source="avito",
                sender=metadata.get("name") or metadata.get("first_name") or str(target_user_id),
                message=user_text,
                is_operator=bool(is_operator),
            ),
            assistant_id=assistant_id,
        )
        return True

    context = {}
    if item_id:
        context["item_id"] = item_id
        context["avito_item_id"] = item_id
    if item_context:
        context.update(item_context)

    data = AskData(
        client_id=client_id,
        assistant_id=assistant_id,
        session_id=session_id,
        message=user_text,
        token=session_id,
        context=context,
        voice_output=False,
        stream=False,
        timestamp=timestamp,
        attachments=attachments or None,
    )

    try:
        result = await chat_service.process_ask(data, files=None, stream=False, is_admin=False, skip_ai=skip_ai)

        if skip_ai:
            return True

        response_text = extract_response_text(result)
        if not response_text or response_text == "None" or response_text.strip() == "":
            response_text = "Извините, я не смог сформировать ответ. Попробуйте перефразировать вопрос."

        import re
        response_text = re.sub('<[^<]+?>', '', response_text)

        await send_avito_message(avito_client_id, avito_client_secret, chat_id, response_text, user_id=user_id)
        return True

    except Exception as e:
        log.error(f"Avito message handling error: {e}")
        return False


async def send_operator_message_to_avito(
    client_id: str, session_id: str, message: str, operator_name: str = "Оператор"
) -> bool:
    """Отправка сообщения от оператора в Avito."""
    if not session_id.startswith(f"avito-{client_id}-"):
        return False

    user_id = session_id.split(f"avito-{client_id}-", 1)[-1]
    assistant_id = None
    parts = session_id.split("-")
    if len(parts) >= 4:
        assistant_id = parts[2]
        user_id = "-".join(parts[3:])

    settings = await get_integration_settings(client_id, "avito", assistant_id=assistant_id)
    if isinstance(settings, str):
        try:
            import json
            settings = json.loads(settings)
        except Exception:
            return False
    avito_client_id = settings.get("client_id", "")
    avito_client_secret = settings.get("client_secret", "")

    from ..services.db_service import AsyncSessionLocal, ChatSession
    from sqlalchemy import select
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(ChatSession.metadata_json).where(ChatSession.session_id == session_id)
        )
        session_meta = res.scalar_one_or_none() or {}
    avito_chat_id = session_meta.get("avito_chat_id", "") if session_meta else ""

    if not avito_client_id or not avito_client_secret or not settings.get("enabled"):
        return False

    if not avito_chat_id:
        logger.warning(f"[AVITO_OPERATOR] No avito_chat_id found for session {session_id}")
        return False

    display_message = f"{operator_name}: {message}" if message else ""
    if display_message:
        return await send_avito_message(avito_client_id, avito_client_secret, avito_chat_id, display_message, user_id=user_id)
    return False


# ─── POLLING ──────────────────────────────────────────────────────────────────────


async def get_avito_user_id(token: str) -> Optional[str]:
    """Получает ID текущего пользователя Avito."""
    url = f"{AVITO_API}/core/v1/accounts/self"
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 200:
                return str(resp.json().get("id", ""))
        except Exception as e:
            logger.error(f"Avito get_user_id error: {e}")
    return None

async def get_avito_chats(client_id: str, client_secret: str, user_id: str = "", unread_only: bool = True) -> list:
    """Получает список чатов Avito."""
    token = await get_access_token(client_id, client_secret)
    if not token:
        return []

    if not user_id:
        user_id = await get_avito_user_id(token)

    headers = {"Authorization": f"Bearer {token}"}
    request_specs = []
    if user_id:
        request_specs.append((f"{AVITO_API}/messenger/v2/accounts/{user_id}/chats", {"unread_only": "true"} if unread_only else {}))
        request_specs.append((f"{AVITO_API}/messenger/v2/accounts/{user_id}/chats", {}))
    
    request_specs.append((f"{AVITO_API}/messenger/v3/chats", {"unread_only": "true"} if unread_only else {}))

    async with httpx.AsyncClient(timeout=10) as client:
        for url, params in request_specs:
            try:
                resp = await client.get(url, headers=headers, params=params)
                if resp.status_code == 200:
                    data = resp.json()
                    chats = data.get("chats", [])
                    logger.info(f"[AVITO_POLL] Got {len(chats)} chats from {url} (unread_only={params.get('unread_only', False)})")
                    return chats
                else:
                    if resp.status_code in (404, 405):
                        logger.debug(f"[AVITO_POLL] chats fallback {url}: {resp.status_code}")
                    else:
                        logger.warning(f"[AVITO_POLL] chats failed {url}: {resp.status_code} {_redact_text(resp.text)[:200]}")
            except Exception as e:
                logger.error(f"[AVITO_POLL] chats error {url}: {e}")

    return []


async def get_avito_chat_messages(client_id: str, client_secret: str, chat_id: str, user_id: str = "", limit: int = 5) -> list:
    """Получает последние сообщения из чата Avito."""
    token = await get_access_token(client_id, client_secret)
    if not token:
        return []

    headers = {"Authorization": f"Bearer {token}"}
    request_specs = []
    
    # Сначала пробуем v3, так как он более современный
    request_specs.append((f"{AVITO_API}/messenger/v3/chats/{chat_id}/messages", {"limit": limit}))
    
    # Пробуем v2 без account_id (часто работает для u2i)
    request_specs.append((f"{AVITO_API}/messenger/v2/chats/{chat_id}/messages", {"limit": limit}))
    
    # Пробуем v1 без account_id
    request_specs.append((f"{AVITO_API}/messenger/v1/chats/{chat_id}/messages", {"limit": limit}))

    # Если есть user_id, пробуем v2 и v1 с account_id
    if user_id:
        request_specs.append((f"{AVITO_API}/messenger/v2/accounts/{user_id}/chats/{chat_id}/messages", {"limit": limit}))
        request_specs.append((f"{AVITO_API}/messenger/v1/accounts/{user_id}/chats/{chat_id}/messages", {"limit": limit}))

    async with httpx.AsyncClient(timeout=10) as client:
        for url, params in request_specs:
            try:
                resp = await client.get(url, headers=headers, params=params)
                if resp.status_code == 200:
                    data = resp.json()
                    messages = data.get("messages", [])
                    logger.info(f"[AVITO_POLL] Got {len(messages)} messages from {url}")
                    return messages
                else:
                    if resp.status_code in (404, 405):
                        logger.debug(f"[AVITO_POLL] messages fallback {url}: {resp.status_code}")
                    else:
                        logger.warning(f"[AVITO_POLL] messages failed {url}: {resp.status_code} {_redact_text(resp.text)[:200]}")
            except Exception as e:
                logger.error(f"[AVITO_POLL] messages error {url}: {e}")

    return []


async def get_avito_chat_info(client_id: str, client_secret: str, chat_id: str, user_id: str = "") -> dict:
    """Получает информацию о чате (включая context.value с данными объявления)."""
    token = await get_access_token(client_id, client_secret)
    if not token:
        return {}

    headers = {"Authorization": f"Bearer {token}"}
    url = f"{AVITO_API}/messenger/v3/chats/{chat_id}"

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                logger.info(f"[AVITO_POLL] Chat info for {chat_id}: type={data.get('chat_type')}")
                return data
            else:
                if resp.status_code in (404, 405):
                    logger.debug(f"[AVITO_POLL] v3 chat info fallback: {resp.status_code}")
                else:
                    logger.warning(f"[AVITO_POLL] v3 chat info failed: {resp.status_code} {_redact_text(resp.text)[:200]}")
        except Exception as e:
            logger.error(f"[AVITO_POLL] v3 chat info error: {e}")

    if user_id:
        url = f"{AVITO_API}/messenger/v2/accounts/{user_id}/chats/{chat_id}"
        async with httpx.AsyncClient(timeout=10) as client:
            try:
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    logger.info(f"[AVITO_POLL] v2 fallback chat info for {chat_id}")
                    return data
            except Exception as e:
                logger.error(f"[AVITO_POLL] v2 chat info error: {e}")

    return {}


async def mark_avito_chat_as_read(client_id: str, client_secret: str, chat_id: str, user_id: str) -> bool:
    """Помечает чат как прочитанный."""
    token = await get_access_token(client_id, client_secret)
    if not token:
        return False

    url = f"{AVITO_API}/messenger/v1/accounts/{user_id}/chats/{chat_id}/read"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.post(url, headers=headers)
            if resp.status_code == 402:
                logger.error(f"[AVITO] Mark as read failed: Payment Required (402). Please enable Messenger API subscription in Avito.")
            return resp.status_code == 200
        except Exception as e:
            logger.error(f"Avito mark as read error: {e}")
            return False


async def sync_avito_history(client_id: str, settings: dict, force: bool = False):
    """Синхронизирует историю сообщений Avito (тихий импорт)."""
    if client_id in avito_sync_progress and avito_sync_progress[client_id]["status"] == "syncing":
        logger.info(f"[AVITO_SYNC] Sync already in progress for {client_id}")
        return

    avito_sync_progress[client_id] = {"total": 0, "current": 0, "status": "syncing"}
    
    try:
        avito_client_id = settings.get("client_id")
        avito_client_secret = settings.get("client_secret")
        
        token = await get_access_token(avito_client_id, avito_client_secret)
        if not token:
            raise Exception("Failed to get access token")
            
        my_user_id = await get_avito_user_id(token)
        
        # Получаем все чаты (не только непрочитанные)
        chats = await get_avito_chats(avito_client_id, avito_client_secret, user_id=my_user_id, unread_only=False)
        avito_sync_progress[client_id]["total"] = len(chats)
        
        for i, chat in enumerate(chats):
            chat_id = str(chat.get("id", ""))
            if not chat_id:
                continue
                
            avito_sync_progress[client_id]["current"] = i + 1

            # Оборачиваем обработку каждого чата в try/except, чтобы один упавший чат не валил всю синхронизацию
            try:
                # Определяем ID клиента (собеседника)
                chat_user_id = None
                client_name = None
                client_avatar = None

                users = chat.get("users", [])
                for u in users:
                    uid = str(u.get("id", ""))
                    if uid and uid != str(my_user_id):
                        chat_user_id = uid
                        client_name = u.get("name", None)
                        # Пытаемся достать фото
                        images = u.get("images", {})
                        if isinstance(images, dict):
                            client_avatar = images.get("60x60") or images.get("default")
                        break

                if not chat_user_id:
                    # Пробуем взять из последнего сообщения
                    last_msg = chat.get("last_message", {})
                    author_id = str(last_msg.get("author_id", ""))
                    if author_id and author_id != str(my_user_id):
                        chat_user_id = author_id

                if not chat_user_id:
                    logger.warning(f"[AVITO_SYNC] Could not determine client user_id for chat {chat_id}, using chat_id as fallback")
                    chat_user_id = f"unknown_{chat_id}"

                # Получаем контекст чата и более полные данные собеседника
                chat_info = await get_avito_chat_info(avito_client_id, avito_client_secret, chat_id, user_id=my_user_id)
                item_id = str(chat_info.get("item_id", ""))

                # Собираем метаданные сессии один раз для всего чата
                session_metadata = {
                    "platform": "avito",
                    "avito_user_id": chat_user_id,
                    "avito_chat_id": chat_id,
                    "source": "avito",
                }

                for u in chat_info.get("users", []) or []:
                    uid = str(u.get("id", ""))
                    if uid and uid != str(my_user_id):
                        chat_user_id = uid
                        profile_meta = _extract_avito_profile(u)
                        if profile_meta.get("name"):
                            client_name = profile_meta["name"]
                        if profile_meta.get("avatar_url"):
                            client_avatar = profile_meta["avatar_url"]
                        session_metadata.update(profile_meta)
                        break

                if client_name:
                    session_metadata["name"] = client_name
                    session_metadata["first_name"] = client_name
                elif not session_metadata.get("name"):
                    # Если профиль удалён/недоступен — используем fallback с user_id
                    session_metadata["name"] = f"Avito пользователь"
                    session_metadata["first_name"] = session_metadata["name"]
                if client_avatar:
                    session_metadata["avatar_url"] = client_avatar

                if item_id:
                    session_metadata["item_id"] = item_id

                # Создаём/обновляем сессию ДО обработки сообщений
                session_id = f"avito-{client_id}-{chat_user_id}"
                async with AsyncSessionLocal() as db:
                    await get_or_create_session(session_id, client_id, metadata=session_metadata)

                # Получаем сообщения из чата
                messages = await get_avito_chat_messages(avito_client_id, avito_client_secret, chat_id, user_id=my_user_id, limit=50)
                logger.info(f"[AVITO_SYNC] Chat {chat_id}: {len(messages)} messages")

                # Fallback: если API не вернуло сообщений, пробуем last_message из chat_info
                if not messages:
                    last_msg = chat_info.get('last_message')
                    if last_msg:
                        messages = [last_msg]
                        logger.info(f"[AVITO_SYNC] Using last_message from chat_info for {chat_id}")

                for msg in reversed(messages):
                    msg_id = str(msg.get("id", ""))
                    author_id = str(msg.get("author_id", ""))
                    text = extract_avito_text(msg)

                    if not text:
                        continue

                    # Avito передаёт created в секундах (unix timestamp), но может быть строка ISO
                    created_at = msg.get("created")
                    msg_timestamp = None
                    if created_at is not None:
                        try:
                            if isinstance(created_at, (int, float)):
                                # Если это миллисекунды (>1e12 в unix), делим на 1000
                                if created_at > 100000000000:
                                    created_at = created_at / 1000.0
                                msg_timestamp = datetime.fromtimestamp(created_at)
                            elif isinstance(created_at, str):
                                msg_timestamp = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                        except Exception:
                            pass

                    # Роль: если автор — мы, то assistant, иначе user
                    msg_role = "assistant" if author_id == str(my_user_id) else "user"

                    # Сохраняем напрямую, минуя handle_avito_message, с is_sync=True
                    await save_chat_message(
                        session_id, msg_role, text,
                        timestamp=msg_timestamp,
                        is_sync=True
                    )

                logger.info(f"[AVITO_SYNC] Chat {chat_id} synced (user={chat_user_id})")

            except Exception as chat_err:
                logger.error(f"[AVITO_SYNC] Error processing chat {chat_id}: {chat_err}")
                traceback.print_exc()
                continue

        avito_sync_progress[client_id]["status"] = "completed"
        logger.info(f"[AVITO_SYNC] Sync completed for {client_id}")
        
    except Exception as e:
        logger.error(f"[AVITO_SYNC] Sync error for {client_id}: {e}")
        avito_sync_progress[client_id]["status"] = "error"
        avito_sync_progress[client_id]["error"] = str(e)


async def poll_avito_updates(client_id: str, avito_client_id: str, avito_client_secret: str, settings: dict = None):
    """Опрос новых сообщений Avito для одного клиента."""
    logger.info(f"[AVITO_POLL] Starting polling for client {client_id}")

    _poll_processed = {}
    _POLL_DEDUP_TTL = 600

    logger.info(f"[AVITO_POLL] Initializing for client {client_id}...")
    
    user_id = None
    try:
        token = await get_access_token(avito_client_id, avito_client_secret)
        if token:
            user_id = await get_avito_user_id(token)
            logger.info(f"[AVITO_POLL] Initialized user_id: {user_id}")
        else:
            logger.error(f"[AVITO_POLL] Failed to get token for client {client_id}")
    except Exception as e:
        logger.exception(f"[AVITO_POLL] Initialization error for {client_id}")

    while True:
        try:
            chats = await get_avito_chats(avito_client_id, avito_client_secret, user_id=user_id, unread_only=True)

            for chat in chats:
                chat_id = str(chat.get("id", ""))
                if not chat_id:
                    continue

                chat_info = await get_avito_chat_info(avito_client_id, avito_client_secret, chat_id, user_id=user_id)
                chat_type = chat_info.get("chat_type", "")
                context_value = chat_info.get("context", {}).get("value", {}) if chat_info.get("context") else {}

                # Улучшенное извлечение item_id
                item_id = str(context_value.get("id", "") or chat.get("item_id", "") or "")
                
                # Если это сообщение по объявлению, но item_id пуст, попробуем найти его в других местах
                if not item_id and chat_info.get("context", {}).get("type") == "item":
                    item_id = str(chat_info.get("context", {}).get("id", ""))

                item_context = {}
                if context_value:
                    item_context = {
                        "item_id": item_id,
                        "title": context_value.get("title", ""),
                        "price": context_value.get("price_string", ""),
                        "url": context_value.get("url", ""),
                        "images": context_value.get("images", []),
                    }

                messages = await get_avito_chat_messages(avito_client_id, avito_client_secret, chat_id, user_id=user_id)
                
                if not messages and chat_info:
                    logger.debug(f"[AVITO_POLL] No messages found for chat {chat_id}. Chat info keys: {list(chat_info.keys())}")
                    # В некоторых версиях API последнее сообщение лежит в chat_info['last_message']
                    if 'last_message' in chat_info:
                        messages = [chat_info['last_message']]
                        logger.info(f"[AVITO_POLL] Using last_message from chat_info for {chat_id}")

                processed_any = False
                for msg in messages:
                    msg_id = str(msg.get("id", ""))
                    if not msg_id:
                        continue

                    now = time.time()
                    stale = [k for k, v in list(_poll_processed.items()) if now - v > _POLL_DEDUP_TTL]
                    for k in stale:
                        _poll_processed.pop(k, None)
                    if msg_id in _poll_processed:
                        continue
                    _poll_processed[msg_id] = now

                    author_id = str(msg.get("author_id", ""))
                    text = extract_avito_text(msg)

                    created_at = msg.get("created")
                    msg_timestamp = None
                    if created_at:
                        try:
                            if isinstance(created_at, (int, float)):
                                if created_at > 100000000000:
                                    created_at = created_at / 1000.0
                                msg_timestamp = datetime.fromtimestamp(created_at)
                            else:
                                msg_timestamp = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                        except:
                            pass

                    # Определяем, кто отправил сообщение
                    current_user_id = str(user_id or chat.get("user_id", "") or chat_info.get("user_id", ""))

                    if author_id == current_user_id:
                        continue

                    # Извлекаем и скачиваем вложения из сообщения Avito
                    resolved_assistant_id = settings.get("assistant_id")
                    session_id = f"avito-{client_id}-{resolved_assistant_id or 'main'}-{author_id}"
                    attachment_links, stored_attachments = await extract_avito_attachments(
                        msg, client_id, session_id, resolved_assistant_id,
                        avito_client_id, avito_client_secret, current_user_id,
                    )

                    if attachment_links:
                        extra_text = "\n".join(attachment_links)
                        text = f"{text}\n\n{extra_text}".strip()

                    if not text and not attachment_links:
                        logger.info(f"[AVITO_POLL] Skipped empty message payload chat={chat_id} type={chat_type} raw_keys={list(msg.keys())}")
                        continue

                    logger.info(f"[AVITO_POLL] New msg chat={chat_id} type={chat_type} author={author_id} text_len={len(text or '')}")

                    success = await handle_avito_message(
                        client_id, avito_client_secret, chat_id, author_id, text or "",
                        item_id=item_id, author_id=author_id, item_context=item_context,
                        timestamp=msg_timestamp, account_id=current_user_id,
                        assistant_id=resolved_assistant_id, attachments=stored_attachments,
                    )
                    if success:
                        processed_any = True

                if processed_any:
                    await mark_avito_chat_as_read(avito_client_id, avito_client_secret, chat_id, user_id)

            await asyncio.sleep(15)
        except Exception:
            logger.exception(f"[AVITO_POLL] Loop error for {client_id}")
            await asyncio.sleep(30)


async def run_avito_polling():
    """Запускает Polling для всех клиентов, у которых включён Avito."""
    logger.info("Starting Avito Polling service...")

    # Используем локальный набор для отслеживания запущенных задач в рамках текущего процесса
    _running_tasks = set()

    async def _list_clients():

        try:
            from ..services.clients import list_clients
            clients = await list_clients()
            logger.info(f"[AVITO_POLL] Found {len(clients)} clients")
            return clients
        except Exception as e:
            logger.exception("[AVITO_POLL] Error listing clients")
            return []

    async def _get_settings(client_id: str):
        settings = await get_integration_settings(client_id, "avito")
        logger.info(f"[AVITO_POLL] Raw settings for {client_id}: {_sanitize_avito_settings(settings)}")
        return settings

    async def _process_client(client_id: str, settings: dict):
        logger.info(f"[AVITO_POLL] Checking settings for {client_id}: enabled={settings.get('enabled')}, has_id={bool(settings.get('client_id'))}")
        if settings.get("enabled") and settings.get("client_id") and settings.get("client_secret"):
            if client_id not in _running_tasks:
                logger.info(f"!!! ACTIVATING AVITO POLLING FOR {client_id} !!!")
                asyncio.create_task(
                    poll_avito_updates(
                        client_id,
                        settings["client_id"],
                        settings["client_secret"],
                        settings=settings
                    )
                )
                _running_tasks.add(client_id)
            else:
                logger.debug(f"[AVITO_POLL] Task for {client_id} already running")

    await base_polling_service.run_manager_loop(
        service_name="AVITO_POLL",
        list_clients_fn=_list_clients,
        get_settings_fn=_get_settings,
        process_client_fn=_process_client,
        sleep_seconds=30,
        error_sleep_seconds=10,
    )

