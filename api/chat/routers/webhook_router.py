from fastapi import APIRouter, Request, HTTPException
from ..services.chat_service import chat_service
from .chat_router import AskRequest
import hashlib
import json
from ..core.config import log

router = APIRouter(prefix="/api/chat/webhook", tags=["webhook"])

@router.post("/email")
async def email_webhook(request: Request, client_id: str, token: str):
    """
    Принимает вебхук от почтового сервиса.
    Ожидаемый формат JSON:
    {
        "from": "sender@example.com",
        "subject": "Тема письма",
        "body": "Текст письма"
    }
    """
    try:
        # 1. Проверка токена безопасности
        from ..services.clients import get_client_config
        config = await get_client_config(client_id)
        
        # Получаем настройки email интеграции
        email_settings = config.raw.get('integrations', {}).get('email', {})
        stored_token = email_settings.get('webhook_token')

        if not stored_token or token != stored_token:
            log.warning(f"[EMAIL WEBHOOK] Unauthorized access attempt for client {client_id}. Invalid token.")
            raise HTTPException(status_code=403, detail="Invalid webhook token")

        if not email_settings.get('enabled'):
            log.warning(f"[EMAIL WEBHOOK] Integration disabled for client {client_id}")
            raise HTTPException(status_code=403, detail="Integration disabled")

        # 2. Парсинг данных
        try:
            data = await request.json()
        except:
            # Если это не JSON, возможно это FormData от некоторых сервисов
            form_data = await request.form()
            data = dict(form_data)

        log.info(f"[EMAIL WEBHOOK] Received for client {client_id}: {data}")

        sender = data.get("from", "unknown")
        recipient = data.get("to", "unknown")
        subject = data.get("subject", "No Subject")
        body = data.get("body") or data.get("text") or data.get("plain") or ""
        
        if not body:
            return {"status": "error", "message": "Empty body"}

        # 3. Проверка белого списка ящиков (если он настроен)
        allowed_emails_str = email_settings.get('allowed_emails', '')
        mailbox_name = "Email"
        
        if allowed_emails_str:
            allowed_list = allowed_emails_str.split(',')
            found = False
            for item in allowed_list:
                if ':' in item:
                    name, email = item.split(':', 1)
                    if recipient.lower().strip() == email.lower().strip():
                        mailbox_name = name
                        found = True
                        break
            
            if not found:
                log.warning(f"[EMAIL WEBHOOK] Recipient {recipient} not in allowed list for client {client_id}")
                raise HTTPException(status_code=403, detail="Recipient not allowed")

        # Генерируем session_id на основе email отправителя, чтобы сохранять историю переписки
        session_id = f"email_{hashlib.md5(sender.encode()).hexdigest()}"
        
        # Сохраняем информацию о ящике в метаданные сессии
        try:
            from ..services.db_service import AsyncSessionLocal, ChatSession
            from sqlalchemy import update
            async with AsyncSessionLocal() as db:
                await db.execute(
                    update(ChatSession)
                    .where(ChatSession.session_id == session_id)
                    .values(metadata_json={"source": "email", "mailbox": mailbox_name, "recipient": recipient})
                )
                await db.commit()
        except Exception as db_err:
            log.error(f"[EMAIL WEBHOOK] DB Metadata error: {db_err}")

        # Формируем сообщение для ассистента
        message = f"Входящее письмо от: {sender}\nКому: {recipient} ({mailbox_name})\nТема: {subject}\n\n{body}"
        
        ask_data = AskRequest(
            message=message,
            client_id=client_id,
            session_id=session_id
        )
        
        # Обрабатываем через ChatService (без стриминга)
        result = await chat_service.process_ask(ask_data, stream=False)
        
        log.info(f"[EMAIL WEBHOOK] Response generated for {sender}")
        return result
    except Exception as e:
        log.error(f"[EMAIL WEBHOOK] Error: {e}")
        return {"status": "error", "message": str(e)}
