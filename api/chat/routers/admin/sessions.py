import asyncio
import base64
import mimetypes
import os
import time
import uuid
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends, Request, Form, File, UploadFile
from sqlalchemy import select, update, delete, func, desc, text, case, or_

from ...core.config import log, BASE_DIR
from ...services.db_service import (
    AsyncSessionLocal, ChatSession, ChatMessage, Lead, SessionCase, UserCloseReason, StorageItem,
    save_chat_message, save_storage_item, mark_storage_items_deleted
)
from ...services.assistants_service import build_assistant_filter_conditions
from ...services.upload_limits import read_upload_limited
from .deps import verify_token

router = APIRouter()


def _apply_assistant_filter(query, model_field, assistant_id: Optional[str]):
    conditions = build_assistant_filter_conditions(model_field, assistant_id)
    if not conditions:
        return query
    return query.where(or_(*conditions))


def _append_sql_assistant_filter(sql: str, params: dict, column_name: str, assistant_id: Optional[str]) -> tuple[str, dict]:
    raw_value = str(assistant_id or '').strip()
    if not raw_value or raw_value == 'all':
        return sql, params

    parts = []
    for part in raw_value.split(','):
        normalized = str(part or '').strip()
        if normalized and normalized not in parts:
            parts.append(normalized)
    if not parts or 'all' in parts:
        return sql, params

    include_main = 'main' in parts
    assistant_ids = [part for part in parts if part != 'main']
    if include_main:
        assistant_ids.append('main')

    if assistant_ids and include_main:
        sql += f" AND ({column_name} = ANY(:assistant_ids) OR {column_name} IS NULL)"
        params['assistant_ids'] = assistant_ids
    elif assistant_ids:
        sql += f" AND {column_name} = ANY(:assistant_ids)"
        params['assistant_ids'] = assistant_ids
    elif include_main:
        sql += f" AND ({column_name} = 'main' OR {column_name} IS NULL)"
    return sql, params


@router.get("/leads")
async def get_leads(client_id: str, assistant_id: Optional[str] = None, token_data: dict = Depends(verify_token)):
    """Получение списка заявок (лидов) клиента."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    async with AsyncSessionLocal() as db:
        query = select(Lead).where(Lead.client_id == client_id)
        query = _apply_assistant_filter(query, Lead.assistant_id, assistant_id)
        result = await db.execute(query.order_by(Lead.id.desc()))
        rows = result.scalars().all()
        return {"status": "success", "leads": [
            {
                "id": r.id,
                "client_id": r.client_id,
                "assistant_id": r.assistant_id,
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
async def get_leads_all(client_id: str, assistant_id: Optional[str] = None, token_data: dict = Depends(verify_token)):
    """Получение списка всех заявок клиента из PostgreSQL."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    async with AsyncSessionLocal() as db:
        query = select(Lead).where(Lead.client_id == client_id)
        query = _apply_assistant_filter(query, Lead.assistant_id, assistant_id)
        result = await db.execute(query.order_by(Lead.id.desc()))
        rows = result.scalars().all()
        return {"status": "success", "leads": [
            {
                "id": r.id,
                "client_id": r.client_id,
                "assistant_id": r.assistant_id,
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
async def get_all_history(client_id: str, assistant_id: Optional[str] = None, token_data: dict = Depends(verify_token)):
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
        )
        query = _apply_assistant_filter(query, ChatSession.assistant_id, assistant_id)
        query = query.order_by(desc(ChatSession.last_time))

        result = await db.execute(query)
        rows = result.all()

        history_list = []
        for row in rows:
            sess_dict = {
                "id": row.ChatSession.id,
                "session_id": row.ChatSession.session_id,
                "client_id": row.ChatSession.client_id,
                "assistant_id": row.ChatSession.assistant_id,
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
        scoped_session = (await db.execute(
            select(ChatSession).where(ChatSession.session_id == session_id, ChatSession.client_id == client_id)
        )).scalar_one_or_none()
        if scoped_session is None:
            raise HTTPException(status_code=404, detail="Session not found")

        # 0. Если это email-сессия — получаем message_id для удаления из ящика
        email_message_id = None
        if session_id.startswith("email_"):
            session_meta = scoped_session.metadata_json or {}
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


@router.delete("/sessions/{session_id}/messages/{message_id}")
async def delete_session_message(
    session_id: str,
    message_id: int,
    token_data: dict = Depends(verify_token),
):
    """Безвозвратно удаляет сообщение диалога и принадлежащие ему локальные вложения."""
    client_id = token_data['sub']
    uploads_root = os.path.abspath(os.path.join(BASE_DIR, 'uploads', client_id))

    async with AsyncSessionLocal() as db:
        message_result = await db.execute(
            select(ChatMessage).join(ChatSession, ChatSession.session_id == ChatMessage.session_id).where(
                ChatMessage.id == message_id,
                ChatMessage.session_id == session_id,
                ChatSession.client_id == client_id,
            )
        )
        message = message_result.scalar_one_or_none()
        if message is None:
            raise HTTPException(status_code=404, detail='Message not found')

        attachment_urls = {
            attachment.get('local_url')
            for attachment in (message.attachments or [])
            if isinstance(attachment, dict) and attachment.get('local_url')
        }
        storage_rows = []
        if attachment_urls:
            storage_result = await db.execute(
                select(StorageItem).where(
                    StorageItem.client_id == client_id,
                    StorageItem.session_id == session_id,
                    StorageItem.file_path.in_(attachment_urls),
                )
            )
            storage_rows = storage_result.scalars().all()

        freed_size = sum(int(item.file_size or 0) for item in storage_rows if not item.is_deleted)
        if storage_rows:
            await db.execute(delete(StorageItem).where(StorageItem.id.in_([item.id for item in storage_rows])))
        await db.delete(message)
        if freed_size:
            from ...services.db_service import User as DBUser
            await db.execute(
                update(DBUser)
                .where(DBUser.client_id == client_id)
                .values(used_storage=func.greatest(0, DBUser.used_storage - freed_size))
            )
        await db.commit()

    for file_url in attachment_urls:
        relative_path = file_url.split('/api/chat/uploads/', 1)[-1] if '/api/chat/uploads/' in file_url else ''
        local_path = os.path.abspath(os.path.join(BASE_DIR, 'uploads', relative_path)) if relative_path else ''
        if not local_path or os.path.commonpath([uploads_root, local_path]) != uploads_root:
            continue
        try:
            if os.path.isfile(local_path):
                os.remove(local_path)
        except OSError as error:
            log.error('Failed to delete message attachment %s: %s', local_path, error)

    return {"status": "success"}


@router.get("/history/{token}/messages")
async def get_dialog_messages(token: str, client_id: str, token_data: dict = Depends(verify_token)):
    """Получение всех сообщений конкретного диалога."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    async with AsyncSessionLocal() as db:
        # Проверяем, что диалог действительно принадлежит клиенту (защита от IDOR).
        # Админ (общая операторская панель) может смотреть любые диалоги.
        if token_data['sub'] != 'admin':
            owns_session = (await db.execute(
                select(ChatSession.id).where(
                    ChatSession.session_id == token,
                    ChatSession.client_id == client_id,
                )
            )).scalar_one_or_none()
            if owns_session is None:
                raise HTTPException(status_code=404, detail="Dialog not found")

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
async def get_sessions(client_id: str, search: Optional[str] = None, assistant_id: Optional[str] = None, token_data: dict = Depends(verify_token)):
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
                s.assistant_id,
                l.name as client_name,
                l.contact as client_contact
            FROM chat_sessions s
            LEFT JOIN leads l ON l.token = s.session_id
            WHERE s.client_id = :client_id AND s.is_deleted = false
        """

        params = {"client_id": client_id}
        sql, params = _append_sql_assistant_filter(sql, params, 's.assistant_id', assistant_id)

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
        return history


@router.post("/sessions/{session_id}/read")
async def mark_session_read(session_id: str, token_data: dict = Depends(verify_token)):
    """Пометка диалога как прочитанного."""
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(ChatSession)
            .where(ChatSession.session_id == session_id, ChatSession.client_id == token_data['sub'])
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
    client_id = token_data['sub']
    async with AsyncSessionLocal() as db:
        chat_session = (await db.execute(
            select(ChatSession).where(ChatSession.session_id == session_id, ChatSession.client_id == client_id)
        )).scalar_one_or_none()
        if chat_session is None:
            raise HTTPException(status_code=404, detail="Session not found")
        session_assistant_id = chat_session.assistant_id or 'main'

    if files:
        total_upload_size = 0
        pending_files = []
        client_id = token_data['sub']
        user_chat_dir = os.path.join(BASE_DIR, "uploads", client_id, "operator_files", session_id)
        os.makedirs(user_chat_dir, exist_ok=True)

        for file in files:
            content = await read_upload_limited(file)
            file_size = len(content)
            if file_size <= 0:
                continue

            total_upload_size += file_size
            original_name = file.filename or "file"
            safe_name = "".join(c for c in original_name if c.isalnum() or c in "._- ").strip() or "file"
            local_filename = f"operator_{uuid.uuid4().hex}_{safe_name}"
            content_type = file.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"
            save_path = os.path.join(user_chat_dir, local_filename)

            with open(save_path, "wb") as f:
                f.write(content)

            local_url = f"/api/chat/uploads/{client_id}/operator_files/{session_id}/{local_filename}"
            encoded = base64.b64encode(content).decode('utf-8')
            attachment = {
                "name": original_name,
                "content_type": content_type,
                "data": encoded,
                "size": file_size,
                "local_url": local_url
            }
            attachments.append(attachment)
            pending_files.append(attachment)

        if total_upload_size > 0:
            async with AsyncSessionLocal() as db:
                from ...services.db_service import User as DBUser
                from ...core.config import TARIFF_RULES

                res_user = await db.execute(select(DBUser).where(DBUser.client_id == client_id))
                user = res_user.scalar_one_or_none()

                if user:
                    tariff = TARIFF_RULES.get(user.tariff_name.lower(), TARIFF_RULES['start'])
                    from ...services.assistants_service import get_effective_account_limits
                    limits = get_effective_account_limits(user)
                    storage_limit = limits.get('storage_limit', 1 * 1024 * 1024 * 1024)

                    if user.used_storage + total_upload_size > storage_limit:
                        try:
                            from ...services.notification_service import notify_storage_limit_exceeded
                            await notify_storage_limit_exceeded(client_id, dedupe_key=f"storage-limit-sessions:{client_id}:{storage_limit}")
                        except Exception:
                            pass
                        for att in pending_files:
                            try:
                                parts = att.get("local_url", "").split("/api/chat/uploads/")[-1].split("/")
                                if parts and len(parts) >= 4:
                                    local_path = os.path.join(BASE_DIR, "uploads", *parts)
                                    if os.path.exists(local_path):
                                        os.remove(local_path)
                            except Exception:
                                pass
                        raise HTTPException(status_code=403, detail="Storage limit exceeded")

                    for att in pending_files:
                        asyncio.create_task(save_storage_item(
                            client_id=client_id,
                            category="operator_file",
                            file_size=att.get('size', 0),
                            file_name=att.get('name'),
                            file_path=att.get('local_url'),
                            session_id=session_id
                        ))

    async with AsyncSessionLocal() as db:
        from ...services.clients import get_client_config
        from ...services.assistants_service import get_account_config
        client_config = await get_client_config(client_id, assistant_id=session_assistant_id)
        account_config = await get_account_config(client_id)
        operator_name = (account_config.get('theme') or {}).get(
            'msg_operator_name', client_config.raw.get('theme', {}).get('msg_operator_name', 'Оператор')
        )
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

        # Если это сессия Одноклассников, отправляем сообщение в мессенджер
        if session_id.startswith(f"ok-{client_id}-"):
            try:
                from ...services.ok_service import send_operator_message_to_ok
                await send_operator_message_to_ok(client_id, session_id, message, operator_name=operator_name)
            except Exception as e:
                log.error(f"Failed to send operator message to OK: {e}")

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


async def _set_operator_mode(session_id: str, token_data: dict, enabled: bool) -> str:
    """Переключает ИИ в диалоге и сохраняет системное уведомление его участникам."""
    client_id = token_data['sub']
    async with AsyncSessionLocal() as db:
        session_result = await db.execute(
            select(ChatSession).where(
                ChatSession.session_id == session_id,
                ChatSession.client_id == client_id,
            )
        )
        chat_session = session_result.scalar_one_or_none()
        if chat_session is None:
            raise HTTPException(status_code=404, detail="Session not found")
        if chat_session.is_operator_mode == enabled:
            return ''

        assistant_id = chat_session.assistant_id or 'main'

        from ...services.clients import get_client_config
        from ...services.assistants_service import get_account_config
        client_config = await get_client_config(client_id, assistant_id=assistant_id)
        account_config = await get_account_config(client_id)
        theme = dict(client_config.raw.get('theme', {}))
        account_operator_name = (account_config.get('theme') or {}).get('msg_operator_name')
        if account_operator_name is not None:
            theme['msg_operator_name'] = account_operator_name
        bot_settings = client_config.raw.get('bot_settings', {})

        operator_name = (theme.get('msg_operator_name') or 'Оператор').strip() or 'Оператор'
        ai_name = (bot_settings.get('bot_name') or 'ИИ-ассистент').strip() or 'ИИ-ассистент'
        ai_role = (bot_settings.get('bot_role') or '').strip()
        ai_display_name = f"{ai_name} ({ai_role})" if ai_role else ai_name
        template_key = 'msg_system_join_template' if enabled else 'msg_system_leave_template'
        default_template = (
            "К диалогу подключился {name}. {ai_name} временно отключен."
            if enabled else
            "{name} вышел из чата. {ai_name} снова на связи."
        )
        template = theme.get(template_key) or default_template
        system_msg = template.replace("{name}", operator_name).replace("{ai_name}", ai_display_name)

        await db.execute(
            update(ChatSession)
            .where(ChatSession.session_id == session_id, ChatSession.client_id == client_id)
            .values(is_operator_mode=enabled)
        )
        await db.commit()

    await save_chat_message(session_id, 'assistant', system_msg, author_role='system')
    try:
        from ..ws_router import manager
        await manager.broadcast(session_id, {
            "type": "message",
            "session_id": session_id,
            "author_role": "system",
            "role": "assistant",
            "content": system_msg,
            "attachments": []
        })
    except Exception as e:
        log.error(f"WS operator mode broadcast error: {e}")

    return system_msg


@router.post("/sessions/{session_id}/takeover")
async def takeover_session(session_id: str, token_data: dict = Depends(verify_token)):
    """Перехват диалога оператором (отключение ИИ)."""
    await _set_operator_mode(session_id, token_data, enabled=True)
    return {"status": "success"}


@router.post("/sessions/{session_id}/release")
async def release_session(session_id: str, token_data: dict = Depends(verify_token)):
    """Возврат диалога ИИ."""
    system_msg = await _set_operator_mode(session_id, token_data, enabled=False)
    if not system_msg:
        return {"status": "success"}

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
