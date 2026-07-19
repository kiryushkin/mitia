"""Integration with Odnoklassniki Group Messages (OK Bot API)."""
import hashlib
from typing import Optional

import httpx

from .stt_service import transcribe_voice

from ..core.config import log
from ..services.clients import list_clients
from ..services.integrations_service import get_integration_settings, list_integration_settings
from sqlalchemy import select

from ..services.db_service import AsyncSessionLocal, ChatSession, get_or_create_session, save_chat_message, is_operator_mode, download_and_save_file
from ..services.chat_service import chat_service, extract_response_text, AskData
from .cache_service import cache_service

OK_GRAPH_API = "https://api.ok.ru/graph"


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()[:16]


async def find_client_by_ok_group_id(group_id: str) -> Optional[dict]:
    """Find the account and assistant owning an OK group."""
    normalized_group_id = str(group_id or "").replace("group:", "")
    if not normalized_group_id:
        return None

    cache_key = f"ok_group_client:{normalized_group_id}"
    cached = cache_service.get(cache_key)
    if cached:
        return cached

    try:
        for client in await list_clients():
            client_id = client.get("client_id") or client.get("id") if isinstance(client, dict) else client
            if not client_id:
                continue
            for assistant_id, settings in await list_integration_settings(client_id, "ok"):
                configured_group_id = str(settings.get("group_id") or "").replace("group:", "")
                if configured_group_id == normalized_group_id and settings.get("enabled"):
                    result = {"client_id": client_id, "assistant_id": assistant_id}
                    cache_service.set(cache_key, result)
                    return result
    except Exception as exc:
        log.error("[OK SEARCH] Could not find group %s: %s", normalized_group_id, exc)
    return None


async def check_ok_token(access_token: str) -> dict:
    """Verify a group Bot API token and return its group identity."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{OK_GRAPH_API}/me/info", params={"access_token": access_token})
            data = response.json()
        group_id = str(data.get("group_id") or "").replace("group:", "")
        if response.is_success and group_id:
            return {"status": "ok", "group_id": group_id, "group_name": data.get("name", "")}
        error = data.get("error", {}) if isinstance(data, dict) else {}
        message = error.get("message") or error.get("error_message") or "Не удалось проверить токен группы Одноклассников."
        return {"status": "error", "error": message}
    except Exception as exc:
        log.warning("[OK] Token validation failed: %s", exc)
        return {"status": "error", "error": "Не удалось подключиться к API Одноклассников."}


async def subscribe_ok_webhook(access_token: str, webhook_url: str) -> dict:
    """Register the Mitia webhook for incoming messages from an OK group."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{OK_GRAPH_API}/me/subscribe",
                params={"access_token": access_token},
                json={"url": webhook_url},
                headers={"Content-Type": "application/json;charset=utf-8"},
            )
            data = response.json()
        if response.is_success and data.get("success") is True:
            return {"status": "ok"}
        error = data.get("error", {}) if isinstance(data, dict) else {}
        message = error.get("message") or error.get("error_message") or "OK API не подтвердил webhook."
        return {"status": "error", "error": message}
    except Exception as exc:
        log.warning("[OK] Webhook subscription failed: %s", exc)
        return {"status": "error", "error": "Не удалось зарегистрировать webhook в Одноклассниках."}


async def get_ok_webhook_subscriptions(access_token: str) -> dict:
    """Return registered OK Bot API webhooks for connection diagnostics."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{OK_GRAPH_API}/me/subscriptions",
                params={"access_token": access_token},
            )
            data = response.json()
        if response.is_success and not data.get("error"):
            return {"status": "ok", "subscriptions": data}
        error = data.get("error", {}) if isinstance(data, dict) else {}
        return {"status": "error", "error": error.get("message") or "OK API не вернул список webhook."}
    except Exception as exc:
        log.warning("[OK] Could not read webhook subscriptions: %s", exc)
        return {"status": "error", "error": "Не удалось проверить webhook в Одноклассниках."}


async def get_or_create_ok_session(
    client_id: str, ok_user_id: str, chat_id: str, metadata: Optional[dict] = None,
    assistant_id: str | None = None,
) -> str:
    """Create or update the shared inbox session for an OK user."""
    session_id = f"ok-{client_id}-{assistant_id or 'main'}-{ok_user_id}"
    user_info = {
        "platform": "ok",
        "source": "ok",
        "ok_user_id": ok_user_id,
        "ok_chat_id": chat_id,
    }
    if metadata:
        user_info.update(metadata)
    async with AsyncSessionLocal() as db:
        await get_or_create_session(session_id, client_id, metadata=user_info, assistant_id=assistant_id)
    cache_service.set(f"ok_session:{client_id}:{assistant_id or 'main'}:{ok_user_id}", session_id)
    return session_id


async def send_ok_message(access_token: str, chat_id: str, text: str) -> bool:
    """Send plain text to an existing OK group chat."""
    if not chat_id or not text:
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{OK_GRAPH_API}/me/messages/{chat_id}",
                params={"access_token": access_token},
                json={"recipient": {"chat_id": chat_id}, "message": {"text": text}},
                headers={"Content-Type": "application/json;charset=utf-8"},
            )
            data = response.json()
        if response.is_success and not data.get("error"):
            return True
        log.error("[OK] Message delivery failed: %s", data)
    except Exception as exc:
        log.error("[OK] Message delivery error: %s", exc)
    return False


async def send_ok_typing(access_token: str, chat_id: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(
                f"{OK_GRAPH_API}/me/messages/{chat_id}",
                params={"access_token": access_token},
                json={"recipient": {"chat_id": chat_id}, "sender_action": "typing_on"},
                headers={"Content-Type": "application/json;charset=utf-8"},
            )
    except Exception:
        pass


async def _download_ok_attachments(
    attachments: list, client_id: str, session_id: str, assistant_id: str | None
) -> tuple[list[str], list[dict]]:
    lines, stored = [], []
    for attachment in attachments or []:
        kind = str(attachment.get("type") or "").upper()
        payload = attachment.get("payload") or {}
        url = payload.get("url")
        if kind == "AUDIO" and url:
            local_url = await download_and_save_file(
                url, client_id, session_id=session_id, file_name="ok-audio.mp4",
                category="chat_file", assistant_id=assistant_id,
            )
            lines.append(f"🎵 Аудио: {local_url or url}")
            if local_url:
                stored.append({"name": "ok-audio.mp4", "content_type": "audio/mp4", "local_url": local_url})
                transcript = await transcribe_voice(local_url)
                if transcript:
                    lines.append(f"📝 Расшифровка аудио: {transcript}")
        elif kind == "IMAGE":
            lines.append(f"🖼 Изображение: {url}" if url else "🖼 Изображение")
        elif kind == "FILE":
            lines.append(f"📄 Файл: {url}" if url else "📄 Файл")
        elif kind:
            lines.append(f"📎 Вложение OK: {kind}")
    return lines, stored


async def handle_ok_message(
    client_id: str, access_token: str, ok_user_id: str, chat_id: str, user_text: str,
    attachments: list | None = None, assistant_id: str | None = None,
) -> bool:
    """Process an incoming OK message in operator or assistant mode."""
    session_id = await get_or_create_ok_session(client_id, ok_user_id, chat_id, assistant_id=assistant_id)
    attachment_lines, stored_attachments = await _download_ok_attachments(
        attachments or [], client_id, session_id, assistant_id
    )
    attachment_text = "\n".join(attachment_lines)
    user_text = f"{user_text}\n\n{attachment_text}".strip() if attachment_text else user_text.strip()
    if not user_text:
        return True

    settings = await get_integration_settings(client_id, "ok", assistant_id=assistant_id)
    if not settings.get("enabled"):
        return False

    is_operator = await is_operator_mode(session_id)
    if is_operator or not settings.get("assistant_enabled", False):
        await save_chat_message(session_id, "user", user_text, attachments=stored_attachments or None)
        from .operator_notification_service import build_incoming_message_notification, notify_operators
        await notify_operators(
            client_id,
            build_incoming_message_notification(source="ok", sender=f"OK ID: {ok_user_id}", message=user_text, is_operator=bool(is_operator)),
            assistant_id=assistant_id,
        )
        return True

    await send_ok_typing(access_token, chat_id)
    try:
        result = await chat_service.process_ask(AskData(
            client_id=client_id, assistant_id=assistant_id, session_id=session_id,
            message=user_text, token=session_id, context=None, voice_output=False, stream=False,
            attachments=stored_attachments or None,
        ), files=None, stream=False, is_admin=False)
        response_text = extract_response_text(result)
        if not response_text or response_text == "None":
            response_text = "Извините, я не смог сформировать ответ. Попробуйте перефразировать вопрос."
        for start in range(0, len(response_text), 4000):
            await send_ok_message(access_token, chat_id, response_text[start:start + 4000])
        return True
    except Exception as exc:
        log.error("[OK] Message handling error: %s", exc)
        return False


async def send_operator_message_to_ok(client_id: str, session_id: str, message: str, operator_name: str = "Оператор") -> bool:
    """Deliver an operator reply from Inbox to an OK chat."""
    if not session_id.startswith(f"ok-{client_id}-") or not message:
        return False
    parts = session_id.split("-")
    if len(parts) < 4:
        return False
    assistant_id, ok_user_id = parts[2], parts[-1]
    settings = await get_integration_settings(client_id, "ok", assistant_id=assistant_id)
    if not settings.get("enabled") or not settings.get("access_token"):
        return False
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ChatSession.metadata_json).where(ChatSession.session_id == session_id)
        )
        metadata = result.scalar_one_or_none() or {}
    chat_id = metadata.get("ok_chat_id")
    if not chat_id:
        return False
    return await send_ok_message(settings["access_token"], chat_id, f"{operator_name}: {message}")
