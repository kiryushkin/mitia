from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import JSONResponse
from ..services.max_service import (
    handle_max_message, find_client_by_token, register_max_token, set_webhook, delete_webhook, validate_bot_token
)
from ..core.config import log
from .admin_router import verify_token
from ..services.integrations_service import get_integration_settings, save_integration_settings

router = APIRouter(prefix="/api/chat/max", tags=["max"])

@router.post("/webhook/{bot_token}")
async def max_webhook(bot_token: str, request: Request):
    """Принимает входящие сообщения от MAX."""
    try:
        update = await request.json()
        log.info(f"[MAX_WEBHOOK] Received update: {update}")
        
        # В MAX событие сообщения имеет тип 'message_created'
        if update.get("update_type") != "message_created":
            return {"status": "ignored"}
            
        message = update.get("message", {})
        max_chat_id = message.get("recipient", {}).get("chat_id") or message.get("sender", {}).get("user_id")
        user_text = message.get("body", {}).get("text") or ""
        from_user = message.get("sender", {})

        # Обработка вложений в вебхуке
        attachments = message.get("body", {}).get("attachments", [])
        attachment_links = []
        for att in attachments:
            att_type = att.get("type")
            payload = att.get("payload", {})
            url = payload.get("url") or payload.get("download_url")
            
            if url:
                if att_type == "image":
                    attachment_links.append(f"🖼 Фото: {url}")
                elif att_type == "video":
                    attachment_links.append(f"🎥 Видео: {url}")
                elif att_type == "file":
                    attachment_links.append(f"📄 Файл: {url}")
            elif att_type == "file" and "token" in payload:
                file_token = payload.get("token")
                attachment_links.append(f"📄 Файл (скачать): https://platform-api2.max.ru/files/{file_token}?access_token={bot_token}")

        if attachment_links:
            extra_text = "\n".join(attachment_links)
            user_text = f"{user_text}\n\n{extra_text}".strip()

        if not max_chat_id or not user_text:
            return {"status": "no_content"}
            
        resolved = await find_client_by_token(bot_token)
        if not resolved:
            log.error(f"Client not found for MAX bot token ...{bot_token[-8:]}")
            return JSONResponse(status_code=404, content={"error": "Client not found"})
        client_id = resolved["client_id"]
        assistant_id = resolved.get("assistant_id")

        success = await handle_max_message(
            client_id, bot_token, max_chat_id, user_text, from_user,
            assistant_id=assistant_id
        )
        
        return {"status": "ok" if success else "error"}
        
    except Exception as e:
        log.error(f"MAX Webhook error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

@router.post("/setup")
async def setup_max(request: Request, client_id: str = None, assistant_id: str | None = None, user_data: dict = Depends(verify_token)):
    """Настройка вебхука для MAX бота."""
    target_client_id = client_id or user_data.get("sub")
    if not target_client_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    data = await request.json()
    settings = await get_integration_settings(target_client_id, "max", assistant_id=assistant_id)
    submitted_token = data.get("bot_token", "").strip()
    # Do not erase a stored secret when a browser submits an empty password field.
    bot_token = submitted_token or settings.get("bot_token", "")
    enabled = data.get("enabled", False)
    
    if enabled and bot_token:
        is_valid = await validate_bot_token(bot_token)
        if not is_valid:
            return JSONResponse(status_code=400, content={"error": "Невалидный токен MAX. Интеграция не может быть включена."})
    
    settings.update({
        "bot_token": bot_token,
        "enabled": enabled,
        "assistant_enabled": bool(data.get("assistant_enabled", False)),
        "autoreply_enabled": False,
        "autoreply_message": ""
    })
    await save_integration_settings(target_client_id, "max", settings, assistant_id=assistant_id)
    await register_max_token(target_client_id, bot_token, assistant_id=assistant_id)
    
    if enabled and bot_token:
        webhook_url = f"{request.base_url}api/chat/max/webhook/{bot_token}"
        webhook_url = webhook_url.replace(":///", "://").replace("//api", "/api")
        success = await set_webhook(bot_token, webhook_url)
        if not success:
            log.error(f"Failed to set MAX webhook for {target_client_id}")
    elif not enabled and bot_token:
        await delete_webhook(bot_token)
    
    return {"status": "success"}

@router.post("/check-token")
async def check_max_token(request: Request, user_data: dict = Depends(verify_token)):
    """Мгновенная проверка токена MAX."""
    try:
        data = await request.json()
        bot_token = data.get("bot_token")
        
        if not bot_token:
            return JSONResponse(status_code=400, content={"error": "Введите API токен"})
        
        is_valid = await validate_bot_token(bot_token)
        if is_valid:
            return {"status": "ok"}
        else:
            return JSONResponse(status_code=400, content={"error": "MAX API отклонил этот токен"})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
