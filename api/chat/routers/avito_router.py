import time
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from ..services.avito_service import (
    check_avito_credentials, setup_avito_webhook, delete_avito_webhook,
    handle_avito_message, get_avito_chat_info, extract_avito_attachments
)
from .admin_router import verify_token
from ..services.integrations_service import get_integration_settings, list_integration_settings, save_integration_settings
from pydantic import BaseModel
from ..core.config import log

router = APIRouter(prefix="/api/chat/avito", tags=["avito"])

# Кэш для дедупликации сообщений Avito (message_id -> timestamp)
_avito_processed = {}
_AVITO_DEDUP_TTL = 300  # 5 минут

class AvitoCheckRequest(BaseModel):
    client_id: str
    client_secret: str
    webhook_url: str = None


@router.post("/check-token")
async def check_token(req: AvitoCheckRequest, client_id: str, request: Request, token_data: dict = Depends(verify_token)):
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    result = await check_avito_credentials(req.client_id, req.client_secret)
    return result


@router.post("/setup")
async def setup_avito(request: Request, client_id: str = None, assistant_id: str | None = None, user_data: dict = Depends(verify_token)):
    """Настройка интеграции Avito."""
    target_client_id = client_id or user_data.get("sub")
    if not target_client_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    data = await request.json()
    settings = await get_integration_settings(target_client_id, "avito", assistant_id=assistant_id)
    # Keep existing credentials when the form did not intentionally provide new ones.
    avito_client_id = data.get("client_id", "").strip() or settings.get("client_id", "")
    avito_client_secret = data.get("client_secret", "").strip() or settings.get("client_secret", "")
    enabled = data.get("enabled", False)

    if enabled and avito_client_id and avito_client_secret:
        try:
            check_res = await check_avito_credentials(avito_client_id, avito_client_secret)
            if check_res.get("status") == "error":
                return JSONResponse(status_code=400, content={"error": check_res.get("error", "Невалидные данные Avito")})
        except Exception as e:
            log.warning(f"[AVITO_CHECK] Could not validate: {e}")
            pass

    settings.update({
        "client_id": avito_client_id,
        "client_secret": avito_client_secret,
        "enabled": enabled,
        "assistant_enabled": bool(data.get("assistant_enabled", False)),
        "autoreply_enabled": False,
        "autoreply_message": ""
    })
    await save_integration_settings(target_client_id, "avito", settings, assistant_id=assistant_id)

    if enabled and avito_client_id and avito_client_secret:
        # Используем webhook_url, присланный с фронтенда (там знают реальный публичный адрес)
        # Если не прислали — определяем из заголовка host как раньше
        webhook_url = data.get("webhook_url", "").strip()
        if not webhook_url:
            host = request.headers.get("host")
            protocol = "https" if host and ("loca.lt" in host or "ngrok" in host) else "http"
            webhook_url = f"{protocol}://{host}/api/chat/avito/webhook"
        log.info(f"[AVITO_SETUP] Registering webhook at: {webhook_url}")
        setup_res = await setup_avito_webhook(avito_client_id, avito_client_secret, webhook_url)
        if setup_res.get("status") != "ok":
            log.error(f"Failed to set Avito webhook for {target_client_id}: {setup_res.get('error')}")
    elif not enabled and avito_client_id and avito_client_secret:
        await delete_avito_webhook(avito_client_id, avito_client_secret)

    return {"status": "success"}


@router.post("/webhook")
async def avito_webhook(request: Request):
    """Прием уведомлений от Avito."""
    try:
        data = await request.json()
        log.info(f"[AVITO_WEBHOOK] Received: {data}")

        # Avito v3.0.0: data = {"payload": {"type": "message", "value": {...}}}
        # Также поддерживаем старые форматы
        payload = data.get("payload") or data.get("message", {})

        # Определяем тип события: может быть в data["type"] или data["payload"]["type"]
        event_type = data.get("type", "") or payload.get("type", "")

        # В v3.0.0 данные внутри payload.value
        event_value = payload.get("value", payload)

        # Дедупликация: если message_id уже обрабатывали — пропускаем
        message_id = event_value.get("id") or ""
        now = time.time()
        if message_id:
            # Чистим старые записи
            stale_keys = [k for k, v in list(_avito_processed.items()) if now - v > _AVITO_DEDUP_TTL]
            for k in stale_keys:
                _avito_processed.pop(k, None)
            if message_id in _avito_processed:
                log.info(f"[AVITO_WEBHOOK] Skipped — duplicate message_id={message_id}")
                return {"status": "ok"}
            _avito_processed[message_id] = now

        if event_type == "message" or ("chat_id" in event_value or "chat_id" in payload):
            # Извлекаем chat_id (сначала из value, потом из payload, потом из data)
            chat_id = str(event_value.get("chat_id") or payload.get("chat_id") or data.get("chat_id") or "")

            # Извлекаем user_id
            user_id = str(event_value.get("user_id") or payload.get("user_id") or event_value.get("author_id") or "")

            # Извлекаем author_id — кто отправил сообщение (для определения эхо)
            author_id = str(event_value.get("author_id") or "")

            # Извлекаем текст
            from ..services.avito_service import extract_avito_text
            text = extract_avito_text(event_value) or extract_avito_text(payload) or extract_avito_text(data)

            # Извлекаем item_id
            item_id = str(event_value.get("item_id") or payload.get("item_id") or "")

            # Извлекаем chat_type
            chat_type = event_value.get("chat_type") or payload.get("chat_type") or ""

            log.info(f"[AVITO_WEBHOOK] Parsed: chat_id={chat_id}, user_id={user_id}, author_id={author_id}, chat_type={chat_type}, text_len={len(text)}, item_id={item_id}")

            if not chat_id:
                log.info(f"[AVITO_WEBHOOK] Skipped — missing chat_id")
                return {"status": "ok"}

            # Пропускаем свои же сообщения (эхо от Avito)
            # Для u2u: author_id == user_id — наше сообщение
            # Для item-чатов в объявлениях: author_id может совпадать с user_id когда пишет продавец
            # Пропускаем только если это u2u чат (личные сообщения)
            if chat_type == "u2u" and author_id and author_id == user_id:
                log.info(f"[AVITO_WEBHOOK] Skipped — our own message (author_id={author_id})")
                return {"status": "ok"}
            elif not chat_type and author_id and author_id == user_id:
                # Если chat_type не указан — действуем консервативно: пропускаем
                log.info(f"[AVITO_WEBHOOK] Skipped — own message (unknown chat_type, author_id={author_id})")
                return {"status": "ok"}

            # Ищем клиента по всем настройкам
            import json
            from ..services.clients import list_clients
            clients = await list_clients()
            found = False
            for cid in clients:
                if not cid:
                    continue
                matches = await list_integration_settings(cid, "avito")
                for assistant_id, settings in matches:
                    if not settings.get("enabled"):
                        continue
                    log.info(f"[AVITO_WEBHOOK] Routing to client {cid}:{assistant_id}")
                    # Пробуем получить контекст объявления (title, price, url) из API
                    item_context = {}
                    try:
                        ci = await get_avito_chat_info(
                            settings.get("client_id", ""),
                            settings.get("client_secret", ""),
                            chat_id
                        )
                        ctx_val = ci.get("context", {}).get("value", {}) if ci.get("context") else {}
                        if ctx_val:
                            item_context = {
                                "item_id": str(ctx_val.get("id", "")),
                                "title": ctx_val.get("title", ""),
                                "price": ctx_val.get("price_string", ""),
                                "url": ctx_val.get("url", ""),
                                "images": ctx_val.get("images", []),
                            }
                    except Exception as e:
                        log.warning(f"[AVITO_WEBHOOK] Failed to fetch chat info: {e}")

                    # Извлекаем и скачиваем вложения (функция возвращает кортеж
                    # (тексты-ссылки, сохранённые вложения)).
                    session_id = f"avito-{cid}-{assistant_id}-{author_id or user_id}"
                    attachment_links, stored_attachments = await extract_avito_attachments(
                        event_value, cid, session_id, assistant_id=assistant_id
                    )
                    if not attachment_links:
                        attachment_links, stored_attachments = await extract_avito_attachments(
                            payload, cid, session_id, assistant_id=assistant_id
                        )

                    if attachment_links:
                        extra_text = "\n".join(attachment_links)
                        text = f"{text}\n\n{extra_text}".strip()

                    await handle_avito_message(
                        cid, settings.get("client_secret", ""), chat_id, author_id or user_id, text or "",
                        item_id=item_id, author_id=author_id, item_context=item_context,
                        account_id=user_id, assistant_id=assistant_id,
                        attachments=stored_attachments or None
                    )
                    found = True
                    break
                if found:
                    break
            if not found:
                log.warning(f"[AVITO_WEBHOOK] No enabled Avito integration found")
            else:
                log.info(f"[AVITO_WEBHOOK] Message processed successfully")

        return {"status": "ok"}
    except Exception as e:
        log.error(f"Avito webhook error: {e}")
        return {"status": "ok"}
