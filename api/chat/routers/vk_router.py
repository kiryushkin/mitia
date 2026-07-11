from typing import Optional
from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import PlainTextResponse, JSONResponse
from ..services.vk_service import handle_vk_message, find_client_by_group_id, check_vk_token
from ..core.config import log
from .admin_router import verify_token
from ..services.integrations_service import get_integration_settings, save_integration_settings

router = APIRouter(prefix="/api/chat/vk", tags=["vk"])

@router.post("/webhook")
@router.post("/webhook/{client_id}")
async def vk_webhook(request: Request, client_id: Optional[str] = None):
    """Принимает входящие события от VK Callback API."""
    try:
        data = await request.json()
        log.info(f"VK Webhook received: {data}")
        type = data.get("type")
        group_id = data.get("group_id")

        if not type or not group_id:
            return PlainTextResponse("ok")

        # 1. Подтверждение адреса сервера
        if type == "confirmation":
            # Если client_id передан в URL, используем его приоритетно
            if not client_id:
                client_id = await find_client_by_group_id(group_id)
            
            log.info(f"[VK_CONFIRM] Processing confirmation for group {group_id}, client_id: {client_id}")
            
            if client_id:
                settings = await get_integration_settings(client_id, "vk")
                if isinstance(settings, str):
                    try:
                        import json
                        settings = json.loads(settings)
                    except: settings = {}
                
                code = settings.get("confirmation_code", "")
                
                # Если код подтверждения совпал — сохраняем флаг confirmed
                if code and not settings.get("confirmed"):
                    settings["confirmed"] = True
                    await save_integration_settings(client_id, "vk", settings)
                    log.info(f"[VK_CONFIRM] VK webhook confirmed for {client_id}")
                
                log.info(f"VK Confirmation request for {client_id}, returning: {code}")
                return PlainTextResponse(code)
            
            log.warning(f"VK Confirmation: client not found for group_id {group_id}")
            return PlainTextResponse("ok")

        # Ищем клиента и его настройки для остальных событий
        if not client_id:
            client_id = await find_client_by_group_id(group_id)
            
        if not client_id:
            return PlainTextResponse("ok")

        settings = await get_integration_settings(client_id, "vk")
        if not settings or not settings.get("enabled"):
            return PlainTextResponse("ok")

        # 2. Новое сообщение
        if type == "message_new":
            message_obj = data.get("object", {}).get("message", {})
            vk_user_id = message_obj.get("from_id")
            user_text = message_obj.get("text")
            secret = data.get("secret")

            # Проверка секретного ключа, если он задан
            expected_secret = (settings.get("secret_key") or "").strip()
            incoming_secret = (secret or "").strip()
            
            # Логируем для отладки, если секреты не совпадают
            if expected_secret and incoming_secret != expected_secret:
                log.warning(
                    f"VK Webhook: invalid secret for client {client_id} "
                    f"(got='{incoming_secret}', expected='{expected_secret}')"
                )
                # Если секрет не совпал, но он задан - игнорируем сообщение
                return PlainTextResponse("ok")

            if vk_user_id and (user_text or message_obj.get("attachments")):
                access_token = settings.get("access_token")
                if access_token:
                    vk_attachments = message_obj.get("attachments", [])
                    await handle_vk_message(client_id, access_token, vk_user_id, user_text or "", vk_attachments)

        return PlainTextResponse("ok")

    except Exception as e:
        log.error(f"VK Webhook error: {e}")
        return PlainTextResponse("ok")

@router.post("/setup")
async def setup_vk(request: Request, client_id: str = None, user_data: dict = Depends(verify_token)):
    """Настройка интеграции ВК."""
    target_client_id = client_id or user_data.get("sub")
    if not target_client_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    data = await request.json()
    access_token = data.get("access_token", "").strip()
    group_id = data.get("group_id", "").strip()
    enabled = data.get("enabled", False)

    if enabled and access_token and group_id:
        # Проверяем токен ПЕРЕД сохранением
        try:
            check_res = await check_vk_token(access_token, group_id)
            if check_res.get("status") == "error":
                return JSONResponse(status_code=400, content={"error": check_res.get("error", "Невалидный токен ВК")})
        except Exception as e:
            log.warning(f"[VK_CHECK] Could not validate token due to network error: {e}")
            # Не блокируем сохранение при ошибке сети
            pass

    settings = await get_integration_settings(target_client_id, "vk")
    settings.update({
        "access_token": data.get("access_token", "").strip(),
        "group_id": data.get("group_id", "").strip(),
        "confirmation_code": data.get("confirmation_code", "").strip(),
        "secret_key": data.get("secret_key", "").strip(),
        "assistant_enabled": bool(data.get("assistant_enabled", True)),
        "autoreply_enabled": bool(data.get("autoreply_enabled", False)),
        "autoreply_message": data.get("autoreply_message", ""),
        "enabled": data.get("enabled", False),
        "confirmed": data.get("enabled", False)
    })
    await save_integration_settings(target_client_id, "vk", settings)
    
    return {"status": "success"}

@router.post("/check-token")
async def vk_check_token(request: Request, client_id: str = None, user_data: dict = Depends(verify_token)):
    """Проверка токена ВК."""
    data = await request.json()
    access_token = data.get("access_token")
    group_id = data.get("group_id")

    if not access_token or not group_id:
        return JSONResponse(status_code=400, content={"status": "error", "error": "Missing access_token or group_id"})

    result = await check_vk_token(access_token, group_id)
    return result


@router.get("/status")
async def vk_status(client_id: str = None, user_data: dict = Depends(verify_token)):
    """Возвращает статус VK-интеграции: подтверждён ли вебхук."""
    target_client_id = client_id or user_data.get("sub")
    if not target_client_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    settings = await get_integration_settings(target_client_id, "vk")
    if isinstance(settings, str):
        try:
            import json
            settings = json.loads(settings)
        except:
            settings = {}

    return {
        "status": "ok",
        "enabled": settings.get("enabled", False),
        "confirmed": settings.get("confirmed", False),
        "has_token": bool(settings.get("access_token")),
        "has_group_id": bool(settings.get("group_id")),
        "has_confirmation_code": bool(settings.get("confirmation_code")),
        "has_secret_key": bool(settings.get("secret_key"))
    }
