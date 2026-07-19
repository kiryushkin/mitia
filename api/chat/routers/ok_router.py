import asyncio
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from ..core.config import log
from ..services.integrations_service import get_integration_settings, save_integration_settings
from ..services.ok_service import (
    check_ok_token,
    find_client_by_ok_group_id,
    handle_ok_message,
    subscribe_ok_webhook,
    get_ok_webhook_subscriptions,
)
from .admin_router import verify_token

router = APIRouter(prefix="/api/chat/ok", tags=["ok"])


@router.post("/webhook/{webhook_secret}")
async def ok_webhook(webhook_secret: str, request: Request):
    """Receive group-message events from the OK Bot API."""
    try:
        payload = await request.json()
        event_type = payload.get("webhookType")
        log.info(
            "[OK WEBHOOK] Received event=%s secret=%s sender=%s recipient=%s",
            event_type,
            webhook_secret[:8],
            (payload.get("sender") or {}).get("user_id"),
            (payload.get("recipient") or {}).get("chat_id"),
        )
        if event_type != "MESSAGE_CREATED":
            log.info("[OK WEBHOOK] Ignored non-message event: %s", event_type)
            return PlainTextResponse("ok")

        sender = payload.get("sender") or {}
        recipient = payload.get("recipient") or {}
        message = payload.get("message") or {}
        ok_user_id = str(sender.get("user_id") or "").replace("user:", "")
        chat_id = recipient.get("chat_id")
        if not ok_user_id or not chat_id:
            log.warning("[OK WEBHOOK] Ignored event without sender or chat ID")
            return PlainTextResponse("ok")

        # A webhook secret belongs to exactly one assistant integration.
        # Resolve it through the configured group ID, supplied by setup.
        group_id = str(payload.get("group_id") or "").replace("group:", "")
        resolved = await find_client_by_ok_group_id(group_id) if group_id else None
        if not resolved:
            # The event payload normally has no group_id, so scan enabled OK integrations
            # by their unguessable webhook secret in the callback path.
            from ..services.clients import list_clients
            from ..services.integrations_service import list_integration_settings
            for client in await list_clients():
                client_id = client.get("client_id") or client.get("id") if isinstance(client, dict) else client
                if not client_id:
                    continue
                for assistant_id, settings in await list_integration_settings(client_id, "ok"):
                    if settings.get("enabled") and settings.get("webhook_secret") == webhook_secret:
                        resolved = {"client_id": client_id, "assistant_id": assistant_id}
                        break
                if resolved:
                    break
        if not resolved:
            log.warning("[OK WEBHOOK] No enabled integration matched secret=%s", webhook_secret[:8])
            return PlainTextResponse("ok")

        settings = await get_integration_settings(resolved["client_id"], "ok", assistant_id=resolved["assistant_id"])
        if settings.get("webhook_secret") != webhook_secret or not settings.get("access_token"):
            log.warning("[OK WEBHOOK] Integration credentials mismatch for %s:%s", resolved["client_id"], resolved["assistant_id"])
            return PlainTextResponse("ok")

        log.info(
            "[OK WEBHOOK] Routed to %s:%s chat=%s text_len=%s",
            resolved["client_id"], resolved["assistant_id"], chat_id, len(message.get("text") or ""),
        )
        # OK requires HTTP 200 within five seconds; AI processing may take longer.
        asyncio.create_task(handle_ok_message(
            resolved["client_id"], settings["access_token"], ok_user_id, chat_id,
            message.get("text") or "", message.get("attachments") or [],
            assistant_id=resolved["assistant_id"],
        ))
    except Exception as exc:
        log.error("[OK] Webhook error: %s", exc)
    return PlainTextResponse("ok")


@router.post("/setup")
async def setup_ok(
    request: Request,
    client_id: str | None = None,
    assistant_id: str | None = None,
    user_data: dict = Depends(verify_token),
):
    """Validate an OK group token and subscribe its Bot API to Mitia."""
    target_client_id = client_id or user_data.get("sub")
    if not target_client_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    data = await request.json()
    settings = await get_integration_settings(target_client_id, "ok", assistant_id=assistant_id)
    submitted_token = (data.get("access_token") or "").strip()
    # The browser does not re-populate password inputs after a reload. Keep the
    # stored token when saving a non-token setting or when merely disabling OK.
    access_token = submitted_token or (settings.get("access_token") or "")
    enabled = bool(data.get("enabled", False))

    verified = None
    if enabled:
        if not access_token:
            return JSONResponse(status_code=400, content={"error": "Укажите токен группы Одноклассников."})
        verified = await check_ok_token(access_token)
        if verified.get("status") != "ok":
            return JSONResponse(status_code=400, content={"error": verified.get("error")})

    import secrets
    webhook_secret = settings.get("webhook_secret") or secrets.token_urlsafe(32)
    group_id = (verified or {}).get("group_id") or str(data.get("group_id") or "").replace("group:", "")
    settings.update({
        "access_token": access_token,
        "group_id": group_id,
        "group_name": (verified or {}).get("group_name", settings.get("group_name", "")),
        "webhook_secret": webhook_secret,
        "assistant_enabled": bool(data.get("assistant_enabled", False)),
        "autoreply_enabled": False,
        "autoreply_message": "",
        "enabled": enabled,
        "webhook_subscribed": False,
    })

    if enabled:
        public_base_url = os.environ.get("SITE_URL", "https://mitia.pro").rstrip("/")
        webhook_url = f"{public_base_url}/api/chat/ok/webhook/{webhook_secret}"
        subscription = await subscribe_ok_webhook(access_token, webhook_url)
        if subscription.get("status") != "ok":
            return JSONResponse(status_code=400, content={"error": subscription.get("error")})
        settings["webhook_subscribed"] = True

    await save_integration_settings(target_client_id, "ok", settings, assistant_id=assistant_id)
    return {"status": "success", "group_id": group_id, "group_name": settings["group_name"]}


@router.get("/status")
async def ok_status(
    client_id: str | None = None,
    assistant_id: str | None = None,
    user_data: dict = Depends(verify_token),
):
    """Check that the token is valid and the currently configured webhook is registered."""
    target_client_id = client_id or user_data.get("sub")
    if not target_client_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    settings = await get_integration_settings(target_client_id, "ok", assistant_id=assistant_id)
    access_token = settings.get("access_token")
    secret = settings.get("webhook_secret")
    if not access_token or not secret:
        return {"status": "not_configured", "webhook_registered": False}
    subscriptions = await get_ok_webhook_subscriptions(access_token)
    if subscriptions.get("status") != "ok":
        return {"status": "error", "webhook_registered": False, "error": subscriptions.get("error")}
    expected_url = f"{os.environ.get('SITE_URL', 'https://mitia.pro').rstrip('/')}/api/chat/ok/webhook/{secret}"
    raw_subscriptions = subscriptions.get("subscriptions")
    registered = expected_url in str(raw_subscriptions)
    return {
        "status": "ok" if registered else "webhook_missing",
        "enabled": bool(settings.get("enabled")),
        "webhook_registered": registered,
        "expected_webhook_url": expected_url,
    }


@router.post("/check-token")
async def ok_check_token(request: Request, user_data: dict = Depends(verify_token)):
    data = await request.json()
    access_token = (data.get("access_token") or "").strip()
    if not access_token:
        return JSONResponse(status_code=400, content={"status": "error", "error": "Укажите токен."})
    return await check_ok_token(access_token)
