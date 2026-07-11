import asyncio
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends, Request, Form, File, UploadFile
from sqlalchemy import select, update, delete, func, desc, text, case

from ...core.config import log
from ...services.db_service import (
    AsyncSessionLocal, ChatSession, ChatMessage, Lead, SessionCase, UserCloseReason,
    save_chat_message, save_storage_item, mark_storage_items_deleted
)
from .deps import verify_token

router = APIRouter()

@router.get("/leads")
async def get_leads(client_id: str, token_data: dict = Depends(verify_token)):
    """Получение списка заявок (лидов) клиента."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Lead)
            .where(Lead.client_id == client_id)
            .order_by(Lead.id.desc())
        )
        rows = result.scalars().all()
        return {"status": "success", "leads": [
            {
                "id": r.id,
                "client_id": r.client_id,
                "name": r.name,
                "contact": r.contact,
                "message": r.message,
                "source_url": r.source_url,
                "page_title": r.page_title,
                "intent": r.intent,
                "token": r.token,
                "created_at": r.created_at
            } for r in rows
        ]}


@router.get("/leads-all")
async def get_leads_all(client_id: str, token_data: dict = Depends(verify_token)):
    """Получение списка всех заявок клиента из PostgreSQL."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Lead)
            .where(Lead.client_id == client_id)
            .order_by(Lead.id.desc())
        )
        rows = result.scalars().all()
        return {"status": "success", "leads": [
            {
                "id": r.id,
                "client_id": r.client_id,
                "name": r.name,
                "contact": r.contact,
                "message": r.message,
                "source_url": r.source_url,
                "page_title": r.page_title,
                "intent": r.intent,
                "token": r.token,
                "created_at": r.created_at
            } for r in rows
        ]}


@router.post("/leads/{lead_id}/status")
async def update_lead_status(lead_id: int, client_id: str, request: Request, token_data: dict = Depends(verify_token)):
    """Обновление статуса заявки."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    data = await request.json()
    status = data.get('status', 'read')

    async with AsyncSessionLocal() as db:
        await db.execute(
            update(Lead)
            .where(Lead.id == lead_id, Lead.client_id == client_id)
            .values(intent=status)
        )
        await db.commit()
    return {"status": "success"}


@router.get("/history")
async def get_all_history(client_id: str, token_data: dict = Depends(verify_token)):
    """Получение списка всех диалогов (сессий) клиента."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    async with AsyncSessionLocal() as db:
        user_msg_count = (
            select(func.count(ChatMessage.id))
            .where(ChatMessage.session_id == ChatSession.session_id, ChatMessage.role == 'user')
            .scalar_subquery()
        )

        last_msg_content = (
            select(ChatMessage.content)
            .where(ChatMessage.session_id == ChatSession.session_id)
            .order_by(desc(ChatMessage.id))
            .limit(1)
            .scalar_subquery()
        )

        query = (
            select(
                ChatSession,
                ChatSession.session_id.label("token"),
                user_msg_count.label("user_messages_count"),
                last_msg_content.label("last_message")
            )
            .where(ChatSession.client_id == client_id, ChatSession.is_deleted == False)
            .order_by(desc(ChatSession.last_time))
        )

        result = await db.execute(query)
        rows = result.all()

        history_list = []
        for row in rows:
            sess_dict = {
                "id": row.ChatSession.id,
                "session_id": row.ChatSession.session_id,
                "client_id": row.ChatSession.client_id,
                "start_time": row.ChatSession.start_time,
                "last_time": row.ChatSession.last_time,
                "status": row.ChatSession.status,
                "is_operator_mode": row.ChatSession.is_operator_mode,
                "is_read": row.ChatSession.is_read,
                "is_archived": row.ChatSession.is_archived,
                "token": row.token,
                "user_messages_count": row.user_messages_count,
                "last_message": row.last_message
            }
            history_list.append(sess_dict)

        return {"status": "success", "history": history_list}


@router.post("/history/{token}/status")
async def update_dialog_status(token: str, request: Request, token_data: dict = Depends(verify_token)):
    """Обновление статуса диалога."""
    client_id = token_data['sub']
    data = await request.json()
    status = data.get('status', 'new')

    async with AsyncSessionLocal() as db:
        await db.execute(
            update(ChatSession)
            .where(ChatSession.session_id == token, ChatSession.client_id == client_id)
            .values(
                status=status,
                is_archived=(status == 'archive'),
                is_operator_mode=case((status == 'application', True), else_=ChatSession.is_operator_mode)
            )
        )
        await db.commit()
    return {"status": "success"}


@router.post("/sessions/{session_id}/metadata")
async def update_session_metadata(session_id: str, request: Request, token_data: dict = Depends(verify_token)):
    """Обновление метаданных сессии."""
    data = await request.json()
    metadata = data.get("metadata")
    if metadata is None:
        raise HTTPException(status_code=400, detail="Metadata is required")

    client_id = token_data.get("sub")

    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(ChatSession).where(ChatSession.session_id == session_id, ChatSession.client_id == client_id)
        )
        sess = res.scalar_one_or_none()
        if not sess:
            raise HTTPException(status_code=404, detail="Session not found")

        sess.metadata_json = metadata
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(sess, "metadata_json")
        await db.commit()

    return {"status": "success"}

@router.post("/sessions/{session_id}/archive")
async def archive_session(session_id: str, request: Request, token_data: dict = Depends(verify_token)):
    """Архивация или разархивация сессии."""
    client_id = token_data['sub']
    data = await request.json()
    is_archived = data.get('is_archived', True)
    user_close_reason_id = data.get('user_close_reason_id')

    async with AsyncSessionLocal() as db:
        selected_reason = None
        if is_archived and user_close_reason_id is not None:
            selected_reason_q = await db.execute(
                select(UserCloseReason)
                .where(
                    UserCloseReason.id == user_close_reason_id,
                    UserCloseReason.client_id == client_id,
                    UserCloseReason.is_active == True,
                )
                .limit(1)
            )
            selected_reason = selected_reason_q.scalar_one_or_none()
            if not selected_reason:
                raise HTTPException(status_code=400, detail="Invalid close reason")

        await db.execute(
            update(ChatSession)
            .where(ChatSession.session_id == session_id, ChatSession.client_id == client_id)
            .values(
                is_archived=is_archived,
                status='archive' if is_archived else case((ChatSession.status == 'archive', 'new'), else_=ChatSession.status),
                is_operator_mode=False if is_archived else ChatSession.is_operator_mode
            )
        )

        # Закрываем активный кейс при ручной архивации
        if is_archived:
            active_case_q = await db.execute(
                select(SessionCase)
                .where(SessionCase.session_id == session_id, SessionCase.client_id == client_id, SessionCase.is_active == True)
                .order_by(SessionCase.id.desc())
                .limit(1)
            )
            active_case = active_case_q.scalar_one_or_none()
            if active_case:
                active_case.is_active = False
                active_case.close_reason = selected_reason.title if selected_reason else 'manual_archive'
                active_case.closed_at = func.now()

        await db.commit()
    return {"status": "success"}


@router.get("/close-reasons")
async def get_close_reasons(client_id: str, include_inactive: bool = False, token_data: dict = Depends(verify_token)):
    """Справочник пользовательских причин закрытия диалога."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    async with AsyncSessionLocal() as db:
        query = (
            select(UserCloseReason)
            .where(UserCloseReason.client_id == client_id)
            .order_by(UserCloseReason.is_active.desc(), UserCloseReason.title.asc(), UserCloseReason.id.asc())
        )
        if not include_inactive:
            query = query.where(UserCloseReason.is_active == True)

        result = await db.execute(query)
        reasons = result.scalars().all()

    return {
        "status": "success",
        "reasons": [
            {
                "id": r.id,
                "title": r.title,
                "is_active": bool(r.is_active),
                "created_at": r.created_at,
            }
            for r in reasons
        ],
    }


@router.post("/close-reasons")
async def create_close_reason(request: Request, token_data: dict = Depends(verify_token)):
    """Создание пользовательской причины закрытия."""
    data = await request.json()
    client_id = (data.get('client_id') or '').strip()
    title = (data.get('title') or '').strip()

    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")

    async with AsyncSessionLocal() as db:
        duplicate_q = await db.execute(
            select(UserCloseReason.id)
            .where(
                UserCloseReason.client_id == client_id,
                func.lower(UserCloseReason.title) == func.lower(title),
            )
            .limit(1)
        )
        duplicate_id = duplicate_q.scalar_one_or_none()
        if duplicate_id is not None:
            existing_q = await db.execute(select(UserCloseReason).where(UserCloseReason.id == duplicate_id).limit(1))
            existing = existing_q.scalar_one_or_none()
            if existing and not existing.is_active:
                existing.is_active = True
                existing.title = title
                await db.commit()
                return {
                    "status": "success",
                    "reason": {
                        "id": existing.id,
                        "title": existing.title,
                        "is_active": bool(existing.is_active),
                        "created_at": existing.created_at,
                    },
                }
            raise HTTPException(status_code=409, detail="Reason already exists")

        row = UserCloseReason(client_id=client_id, title=title, is_active=True)
        db.add(row)
        await db.commit()
        await db.refresh(row)

    return {
        "status": "success",
        "reason": {
            "id": row.id,
            "title": row.title,
            "is_active": bool(row.is_active),
            "created_at": row.created_at,
        },
    }


@router.patch("/close-reasons/{reason_id}")
async def update_close_reason(reason_id: int, request: Request, token_data: dict = Depends(verify_token)):
    """Редактирование/деактивация пользовательской причины закрытия."""
    data = await request.json()
    client_id = (data.get('client_id') or '').strip()
    title = data.get('title')
    is_active = data.get('is_active')

    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    async with AsyncSessionLocal() as db:
        reason_q = await db.execute(
            select(UserCloseReason)
            .where(UserCloseReason.id == reason_id, UserCloseReason.client_id == client_id)
            .limit(1)
        )
        reason = reason_q.scalar_one_or_none()
        if not reason:
            raise HTTPException(status_code=404, detail="Reason not found")

        if title is not None:
            next_title = str(title).strip()
            if not next_title:
                raise HTTPException(status_code=400, detail="Title is required")

            duplicate_q = await db.execute(
                select(UserCloseReason.id)
                .where(
                    UserCloseReason.client_id == client_id,
                    func.lower(UserCloseReason.title) == func.lower(next_title),
                    UserCloseReason.id != reason_id,
                )
                .limit(1)
            )
            if duplicate_q.scalar_one_or_none() is not None:
                raise HTTPException(status_code=409, detail="Reason already exists")
            reason.title = next_title

        if is_active is not None:
            reason.is_active = bool(is_active)

        await db.commit()
        await db.refresh(reason)

    return {
        "status": "success",
        "reason": {
            "id": reason.id,
            "title": reason.title,
            "is_active": bool(reason.is_active),
            "created_at": reason.created_at,
        },
    }


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, token_data: dict = Depends(verify_token)):
    """Полное удаление сессии, сообщений и освобождение места."""
    client_id = token_data['sub']
    async with AsyncSessionLocal() as db:
        # 0. Если это email-сессия — получаем message_id для удаления из ящика
        email_message_id = None
        if session_id.startswith("email_"):
            res_meta = await db.execute(
                select(ChatSession.metadata_json).where(ChatSession.session_id == session_id)
            )
            session_meta = res_meta.scalar_one_or_none() or {}
            email_message_id = session_meta.get("message_id")

        # 1. Получаем все вложения сообщений этой сессии, чтобы освободить место
        result = await db.execute(
            select(ChatMessage.attachments)
            .where(ChatMessage.session_id == session_id)
        )
        attachments_list = result.scalars().all()
        
        total_freed_size = 0
        for attachments in attachments_list:
            if attachments and isinstance(attachments, list):
                for att in attachments:
                    total_freed_size += att.get('size', 0)

        # 2. Удаляем все сообщения сессии
        await db.execute(
            delete(ChatMessage)
            .where(ChatMessage.session_id == session_id)
        )

        # 3. Удаляем саму сессию
        await db.execute(
            delete(ChatSession)
            .where(ChatSession.session_id == session_id, ChatSession.client_id == client_id)
        )

        # 4. Обновляем used_storage пользователя
        if total_freed_size > 0:
            from ...services.db_service import User as DBUser
            await db.execute(
                update(DBUser)
                .where(DBUser.client_id == client_id)
                .values(used_storage=func.greatest(0, DBUser.used_storage - total_freed_size))
            )

        await db.commit()

    # 4.5. Помечаем StorageItem как удалённые для этой сессии
    asyncio.create_task(mark_storage_items_deleted(
        client_id=client_id, session_id=session_id
    ))

    # 5. Удаляем письмо из почтового ящика (вне транзакции)
    if email_message_id:
        try:
            from ...services.email_service import email_service
            from ...services.integrations_service import get_integration_settings
            settings = await get_integration_settings(client_id, "email")
            if settings and settings.get("enabled"):
                await email_service.delete_email(client_id, email_message_id, settings)
        except Exception as e:
            log.error(f"Failed to delete email from mailbox: {e}")

    return {"status": "success"}



@router.get("/history/{token}/messages")
async def get_dialog_messages(token: str, client_id: str, token_data: dict = Depends(verify_token)):
    """Получение всех сообщений конкретного диалога."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ChatMessage.content, ChatMessage.role, ChatMessage.timestamp, ChatMessage.attachments)
            .where(ChatMessage.session_id == token)
            .order_by(ChatMessage.id)
        )
        rows = result.all()
        return {
            "status": "success",
            "messages": [{"content": r.content, "role": r.role, "timestamp": r.timestamp, "attachments": r.attachments} for r in rows]
        }


@router.get("/sessions")
async def get_sessions(client_id: str, search: Optional[str] = None, token_data: dict = Depends(verify_token)):
    """Список всех диалогов клиента с поддержкой поиска по тексту."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    async with AsyncSessionLocal() as db:
        sql = """
            SELECT 
                s.session_id, 
                s.start_time as created_at, 
                s.last_time as updated_at,
                (SELECT content FROM chat_messages WHERE session_id = s.session_id ORDER BY id DESC LIMIT 1) as last_message,
                (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.session_id) as message_count,
                (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.session_id AND role = 'user') as user_messages_count,
                (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.session_id AND role = 'assistant' AND (author_role IS NULL OR author_role != 'operator')) as ai_messages_count,
                (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.session_id AND author_role = 'operator') as operator_messages_count,
                (
                    SELECT sc.close_reason
                    FROM session_cases sc
                    WHERE sc.session_id = s.session_id AND sc.client_id = :client_id
                    ORDER BY sc.id DESC
                    LIMIT 1
                ) as close_reason,
                s.status,
                s.status as ai_intent,
                s.is_archived,
                s.is_operator_mode,
                s.is_read,
                s.is_deleted,
                s.metadata_json,
                l.name as client_name,
                l.contact as client_contact
            FROM chat_sessions s
            LEFT JOIN leads l ON l.token = s.session_id
            WHERE s.client_id = :client_id AND s.is_deleted = false
        """


        params = {"client_id": client_id}

        if search:
            sql += """ AND (
                s.session_id ILIKE :search OR 
                EXISTS (SELECT 1 FROM chat_messages WHERE session_id = s.session_id AND content ILIKE :search)
            )"""
            params["search"] = f"%{search}%"

        sql += " ORDER BY s.last_time DESC"

        result = await db.execute(text(sql), params)
        rows = result.mappings().all()
        history = [dict(r) for r in rows]
        # log.info(f"[DEBUG] Sending {len(history)} sessions. First status: {history[0].get('status') if history else 'N/A'}")
        return history


@router.post("/sessions/{session_id}/read")
async def mark_session_read(session_id: str, token_data: dict = Depends(verify_token)):
    """Пометка диалога как прочитанного."""
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(ChatSession)
            .where(ChatSession.session_id == session_id)
            .values(is_read=True)
        )
        await db.commit()
    return {"status": "success"}


@router.post("/operator/send")
async def send_operator_message(
    session_id: str = Form(...),
    message: str = Form(""),
    files: Optional[List[UploadFile]] = File(None),
    token_data: dict = Depends(verify_token)
):
    """Отправка сообщения от имени оператора с поддержкой файлов."""
    attachments = []

    if files:
        import base64
        total_upload_size = 0
        for file in files:
            content = await file.read()
            total_upload_size += len(content)
            encoded = base64.b64encode(content).decode('utf-8')
            attachments.append({
                "name": file.filename,
                "content_type": file.content_type,
                "data": encoded,
                "size": len(content)
            })

        if total_upload_size > 0:
            async with AsyncSessionLocal() as db:
                from ...services.db_service import User as DBUser
                from ...core.config import TARIFF_RULES
                
                client_id = token_data['sub']
                res_user = await db.execute(select(DBUser).where(DBUser.client_id == client_id))
                user = res_user.scalar_one_or_none()
                
                if user:
                    tariff = TARIFF_RULES.get(user.tariff_name.lower(), TARIFF_RULES['start'])
                    storage_limit = tariff.get('storage_limit', 1 * 1024 * 1024 * 1024)
                    
                    if user.used_storage + total_upload_size > storage_limit:
                        raise HTTPException(status_code=403, detail="Storage limit exceeded")

                    # Запись в StorageItem (used_storage обновится в save_storage_item)
                    for att in attachments:
                        asyncio.create_task(save_storage_item(
                            client_id=client_id,
                            category="operator_file",
                            file_size=att.get('size', 0),
                            file_name=att.get('name'),
                            session_id=session_id
                        ))

    async with AsyncSessionLocal() as db:
        from ...services.db_service import ClientConfig as DBClientConfig

        client_id = token_data['sub']

        res_cfg = await db.execute(select(DBClientConfig.config_json).where(DBClientConfig.client_id == client_id))
        client_config = res_cfg.scalar_one_or_none() or {}
        theme = client_config.get('theme', {})

        operator_name = theme.get('msg_operator_name', 'Оператор')
        if not operator_name or operator_name.strip() == "":
            operator_name = "Оператор"

        if message:
            display_msg = f"{operator_name}: {message}"
        else:
            display_msg = f"{operator_name} прислал файл"

        await save_chat_message(session_id, 'assistant', display_msg, attachments=attachments, author_role='operator')

        # Если это сессия Telegram, отправляем сообщение в мессенджер
        if session_id.startswith(f"tg-{client_id}-"):
            try:
                from ...services.telegram_service import send_operator_message_to_tg
                await send_operator_message_to_tg(client_id, session_id, message, attachments=attachments, operator_name=operator_name)
            except Exception as e:
                log.error(f"Failed to send operator message to TG: {e}")

        # Если это сессия MAX, отправляем сообщение в мессенджер
        if session_id.startswith(f"max-{client_id}-"):
            try:
                from ...services.max_service import send_operator_message_to_max
                await send_operator_message_to_max(client_id, session_id, message, attachments=attachments, operator_name=operator_name)
            except Exception as e:
                log.error(f"Failed to send operator message to MAX: {e}")

        # Если это сессия VK, отправляем сообщение в мессенджер
        if session_id.startswith(f"vk-{client_id}-"):
            try:
                from ...services.vk_service import send_operator_message_to_vk
                await send_operator_message_to_vk(client_id, session_id, message, operator_name=operator_name)
            except Exception as e:
                log.error(f"Failed to send operator message to VK: {e}")

        # Если это сессия Avito, отправляем сообщение в мессенджер
        if session_id.startswith(f"avito-{client_id}-"):
            try:
                from ...services.avito_service import send_operator_message_to_avito
                await send_operator_message_to_avito(client_id, session_id, message, operator_name=operator_name)
            except Exception as e:
                log.error(f"Failed to send operator message to Avito: {e}")

        # Если это сессия Email, отправляем ответ на почту
        if session_id.startswith("email_"):
            try:
                from ...services.email_service import email_service
                from ...services.integrations_service import get_integration_settings
                
                # Получаем email отправителя из метаданных сессии
                res_session = await db.execute(
                    select(ChatSession.metadata_json).where(ChatSession.session_id == session_id)
                )
                session_meta = res_session.scalar_one_or_none() or {}
                sender_email = session_meta.get("sender")
                
                if sender_email:
                    settings = await get_integration_settings(client_id, "email")
                    if settings and settings.get("enabled"):
                        subject = session_meta.get("subject", "Re: Сообщение")
                        await email_service.send_reply(client_id, sender_email, f"Re: {subject}", message, settings)
                        log.info(f"[OPERATOR] Email reply sent to {sender_email}")
                    else:
                        log.warning(f"[OPERATOR] Email integration not enabled for {client_id}")
                else:
                    log.warning(f"[OPERATOR] No sender email in session metadata for {session_id}")
            except Exception as e:
                log.error(f"Failed to send operator message to Email: {e}")

        try:
            from ..ws_router import manager
            await manager.broadcast(session_id, {
                "type": "message",
                "session_id": session_id,
                "author_role": "operator",
                "role": "assistant",
                "content": display_msg,
                "attachments": attachments
            })
        except Exception as e:
            log.error(f"WS broadcast error: {e}")

        return {"status": "success"}


@router.post("/sessions/{session_id}/takeover")
async def takeover_session(session_id: str, token_data: dict = Depends(verify_token)):
    """Перехват диалога оператором (отключение ИИ)."""
    async with AsyncSessionLocal() as db:
        from ...services.db_service import ClientConfig as DBClientConfig

        res_cfg = await db.execute(select(DBClientConfig.config_json).where(DBClientConfig.client_id == token_data['sub']))
        client_config = res_cfg.scalar_one_or_none() or {}
        theme = client_config.get('theme', {})

        operator_name = theme.get('msg_operator_name') or 'Оператор'

        bot_settings = client_config.get('bot_settings', {})
        ai_name = bot_settings.get('bot_name') or client_config.get('bot_name') or 'ИИ-ассистент'
        ai_role = bot_settings.get('bot_role')

        template = theme.get('msg_system_join_template') or "К диалогу подключился {name}. {ai_name} временно отключен."

        ai_display_name = f"{ai_name} ({ai_role})" if ai_role and ai_role.strip() else ai_name

        system_msg = template.replace("{name}", operator_name).replace("{ai_name}", ai_display_name)

        await db.execute(
            update(ChatSession)
            .where(ChatSession.session_id == session_id)
            .values(is_operator_mode=True)
        )
        await db.commit()

    return {"status": "success"}


@router.post("/sessions/{session_id}/release")
async def release_session(session_id: str, token_data: dict = Depends(verify_token)):
    """Возврат диалога ИИ."""
    async with AsyncSessionLocal() as db:
        from ...services.db_service import ClientConfig as DBClientConfig

        res_cfg = await db.execute(select(DBClientConfig.config_json).where(DBClientConfig.client_id == token_data['sub']))
        client_config = res_cfg.scalar_one_or_none() or {}
        theme = client_config.get('theme', {})

        operator_name = theme.get('msg_operator_name') or 'Оператор'

        bot_settings = client_config.get('bot_settings', {})
        ai_name = bot_settings.get('bot_name') or client_config.get('bot_name') or 'ИИ-ассистент'
        ai_role = bot_settings.get('bot_role')

        template = theme.get('msg_system_leave_template') or "{name} вышел из чата. {ai_name} снова на связи."

        ai_display_name = f"{ai_name} ({ai_role})" if ai_role and ai_role.strip() else ai_name

        system_msg = template.replace("{name}", operator_name).replace("{ai_name}", ai_display_name)

        await db.execute(
            update(ChatSession)
            .where(ChatSession.session_id == session_id)
            .values(is_operator_mode=False)
        )
        await db.commit()

        await save_chat_message(session_id, 'assistant', system_msg)

        # Отправляем уведомление в мессенджеры
        client_id = token_data['sub']
        if session_id.startswith(f"tg-{client_id}-"):
            try:
                from ...services.telegram_service import send_telegram_message, get_integration_settings
                settings = await get_integration_settings(client_id, "telegram")
                bot_token = settings.get("bot_token")
                tg_chat_id = int(session_id.split("-")[-1])
                if bot_token and settings.get("enabled"):
                    await send_telegram_message(bot_token, tg_chat_id, f"🤖 {system_msg}")
            except Exception as e:
                log.error(f"Failed to send release notify to TG: {e}")

        if session_id.startswith(f"max-{client_id}-"):
            try:
                from ...services.max_service import send_max_message, get_integration_settings
                settings = await get_integration_settings(client_id, "max")
                bot_token = settings.get("bot_token")
                max_chat_id = int(session_id.split("-")[-1])
                if bot_token and settings.get("enabled"):
                    await send_max_message(bot_token, max_chat_id, f"🤖 {system_msg}")
            except Exception as e:
                log.error(f"Failed to send release notify to MAX: {e}")

    return {"status": "success"}
