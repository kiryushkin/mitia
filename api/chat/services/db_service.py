import hashlib
import json
import logging
import os
import time
import asyncio
from typing import Optional, List, Dict, Any
from datetime import datetime

import httpx

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String, Text, Float, Integer, BigInteger, DateTime, Boolean, ForeignKey, select, update, delete, func, Column, case, or_
from sqlalchemy.dialects.postgresql import JSONB, ARRAY
try:
    from pgvector.sqlalchemy import Vector
    HAS_PGVECTOR = True
except ImportError:
    HAS_PGVECTOR = False
    from sqlalchemy import Float as Vector

from ..core.config import DATABASE_URL, log

engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    balance: Mapped[float] = mapped_column(Float, default=0.0)
    tariff_name: Mapped[str] = mapped_column(String(50), default="Старт")
    messages_consumed: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    verification_token: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    verification_token_created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    tariff_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    auto_renew: Mapped[bool] = mapped_column(Boolean, default=False)
    messages_reset_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    used_storage: Mapped[int] = mapped_column(BigInteger, default=0) # в байтах
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())


class BalanceTransaction(Base):
    __tablename__ = "balance_transactions"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(100), index=True)
    amount: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(50), index=True)
    description: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    external_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), index=True)


class ClientConfig(Base):
    __tablename__ = "client_configs"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(100), ForeignKey("users.client_id"), unique=True, index=True)
    config_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

class ChatSession(Base):
    __tablename__ = "chat_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    client_id: Mapped[str] = mapped_column(String(100), index=True)
    start_time: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    last_time: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    status: Mapped[str] = mapped_column(String(50), default="new")
    is_operator_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    metadata_json: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

class SessionCase(Base):
    __tablename__ = "session_cases"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[str] = mapped_column(String(100), index=True)
    client_id: Mapped[str] = mapped_column(String(100), index=True)
    case_number: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    open_reason: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    close_reason: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), index=True)
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)


class UserCloseReason(Base):
    __tablename__ = "user_close_reasons"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(100), index=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[str] = mapped_column(String(100), index=True)
    role: Mapped[str] = mapped_column(String(50))
    author_role: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    content: Mapped[str] = mapped_column(Text)
    attachments: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=func.now())

class Lead(Base):
    __tablename__ = "leads"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(100), index=True)
    name: Mapped[Optional[str]] = mapped_column(String(255))
    contact: Mapped[Optional[str]] = mapped_column(String(255))
    message: Mapped[Optional[str]] = mapped_column(Text)
    source_url: Mapped[Optional[str]] = mapped_column(Text)
    page_title: Mapped[Optional[str]] = mapped_column(Text)
    intent: Mapped[Optional[str]] = mapped_column(String(100))
    token: Mapped[Optional[str]] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())

class GlobalToken(Base):
    __tablename__ = "global_tokens"
    id: Mapped[int] = mapped_column(primary_key=True)
    scope: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    token: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[float] = mapped_column(Float)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

class UserScenario(Base):
    __tablename__ = "user_scenarios"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(100), index=True)
    scenario_id: Mapped[str] = mapped_column(String(100), index=True)
    config_json: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())

class ScenarioTemplate(Base):
    __tablename__ = "scenario_templates"
    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    config_json: Mapped[dict] = mapped_column(JSONB)

class ActiveScenario(Base):
    __tablename__ = "active_scenarios"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    client_id: Mapped[str] = mapped_column(String(100), index=True)
    state_json: Mapped[dict] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

class SitePage(Base):
    __tablename__ = "site_pages"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(100), index=True)
    url: Mapped[str] = mapped_column(Text, index=True)
    title: Mapped[Optional[str]] = mapped_column(String(255))
    content: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[Optional[str]] = mapped_column(String(64))
    doc_length: Mapped[int] = mapped_column(Integer, default=0)
    priority: Mapped[float] = mapped_column(Float, default=1.0)
    if HAS_PGVECTOR:
        embedding: Mapped[Optional[list[float]]] = mapped_column(Vector(1024))
    else:
        embedding: Mapped[Optional[list[float]]] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

class SiteTerm(Base):
    __tablename__ = "site_terms"
    id: Mapped[int] = mapped_column(primary_key=True)
    page_id: Mapped[int] = mapped_column(ForeignKey("site_pages.id", ondelete="CASCADE"))
    term: Mapped[str] = mapped_column(String(100), index=True)
    tf: Mapped[int] = mapped_column(Integer)
    in_title: Mapped[bool] = mapped_column(Boolean, default=False)

class StorageItem(Base):
    __tablename__ = "storage_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(100), ForeignKey("users.client_id"), index=True)
    category: Mapped[str] = mapped_column(String(50), index=True)
    file_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, default=None, index=True)
    file_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    file_name: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    file_size: Mapped[int] = mapped_column(BigInteger, default=0)
    session_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    message_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())

class AICache(Base):
    __tablename__ = "ai_cache"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(100), index=True)
    cache_key: Mapped[str] = mapped_column(String(255), index=True, nullable=True)
    question_hash: Mapped[str] = mapped_column(String(64), index=True, nullable=True, default="")
    answer: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default=None)
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())

async def get_ai_cache(client_id: str, cache_key: str) -> Optional[str]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(AICache.content)
            .where(AICache.client_id == client_id, AICache.cache_key == cache_key)
            .order_by(AICache.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

async def save_ai_cache(client_id: str, cache_key: str, content: str, question_hash: str = ""):
    async with AsyncSessionLocal() as session:
        new_cache = AICache(client_id=client_id, cache_key=cache_key, content=content, question_hash=question_hash)
        session.add(new_cache)
        await session.commit()

async def init_db():
    """Инициализация таблиц в базе данных."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def get_db():
    """Генератор сессий для FastAPI Depends."""
    async with AsyncSessionLocal() as session:
        yield session

async def get_user_by_client_id(client_id: str):
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.client_id == client_id))
        user = result.scalar_one_or_none()
        return user

async def update_user_balance(client_id: str, amount: float, consumed_increment: int = 0):
    async with AsyncSessionLocal() as session:
        await session.execute(
            update(User)
            .where(User.client_id == client_id)
            .values(
                balance=User.balance - amount,
                messages_consumed=User.messages_consumed + consumed_increment
            )
        )
        await session.commit()


async def add_balance_transaction(
    client_id: str,
    amount: float,
    source: str,
    description: Optional[str] = None,
    external_id: Optional[str] = None
) -> bool:
    async with AsyncSessionLocal() as session:
        if external_id:
            existing = await session.execute(
                select(BalanceTransaction.id).where(
                    BalanceTransaction.client_id == client_id,
                    BalanceTransaction.source == source,
                    BalanceTransaction.external_id == external_id
                )
            )
            if existing.scalar_one_or_none() is not None:
                return False

        tx = BalanceTransaction(
            client_id=client_id,
            amount=amount,
            source=source,
            description=description,
            external_id=external_id
        )
        session.add(tx)
        await session.commit()
        return True


async def get_balance_transactions(client_id: str, limit: int = 50) -> List[BalanceTransaction]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(BalanceTransaction)
            .where(
                BalanceTransaction.client_id == client_id,
                BalanceTransaction.amount > 0
            )
            .order_by(BalanceTransaction.created_at.desc(), BalanceTransaction.id.desc())
            .limit(limit)
        )
        return result.scalars().all()


async def get_or_create_session(session_id: str, client_id: str, metadata: Optional[dict] = None):
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(ChatSession).where(ChatSession.session_id == session_id))
        sess = result.scalar_one_or_none()

        if sess:
            sess.last_time = func.now()
            sess.is_deleted = False
            if metadata:
                if not sess.metadata_json:
                    sess.metadata_json = metadata
                else:
                    new_meta = dict(sess.metadata_json)
                    new_meta.update(metadata)
                    sess.metadata_json = new_meta
        else:
            new_sess = ChatSession(session_id=session_id, client_id=client_id, metadata_json=metadata)
            session.add(new_sess)
            session.add(SessionCase(
                session_id=session_id,
                client_id=client_id,
                case_number=1,
                is_active=True,
                open_reason="new_session"
            ))
        await session.commit()

async def save_chat_message(session_id: str, role: str, content: str, attachments: Optional[List[Dict]] = None, author_role: Optional[str] = None, **kwargs):
    async with AsyncSessionLocal() as session:
        timestamp = kwargs.get('timestamp')
        is_sync = kwargs.get('is_sync', False)  # флаг фоновой синхронизации — не сбрасывать is_read

        # Проверяем дубликат: если сообщение с таким session_id, role, content и timestamp уже есть — не вставляем
        if timestamp:
            dup_check = await session.execute(
                select(ChatMessage.id)
                .where(ChatMessage.session_id == session_id)
                .where(ChatMessage.role == role)
                .where(ChatMessage.content == content)
                .where(ChatMessage.timestamp == timestamp)
                .limit(1)
            )
            if dup_check.scalar_one_or_none() is not None:
                # Сообщение уже существует — обновляем только last_time сессии
                last_time = timestamp if timestamp else func.now()
                await session.execute(
                    update(ChatSession)
                    .where(ChatSession.session_id == session_id)
                    .values(last_time=last_time)
                )
                await session.commit()
                return

        msg = ChatMessage(
            session_id=session_id,
            role=role,
            content=content,
            attachments=attachments,
            author_role=author_role,
            timestamp=timestamp if timestamp else func.now()
        )
        session.add(msg)

        last_time = timestamp if timestamp else func.now()

        if role == 'user' and not is_sync:
            # Проверяем, пришло ли сообщение в архивный кейс
            sess_row = await session.execute(
                select(ChatSession.is_archived, ChatSession.status, ChatSession.client_id)
                .where(ChatSession.session_id == session_id)
            )
            sess = sess_row.first()
            was_archived = bool(sess and (sess[0] or sess[1] == 'archive'))
            cid = sess[2] if sess else None

            await session.execute(
                update(ChatSession)
                .where(ChatSession.session_id == session_id)
                .values(
                    is_read=False,
                    last_time=last_time,
                    is_archived=False,
                    status=case(
                        (
                            or_(ChatSession.is_archived == True, ChatSession.status == 'archive'),
                            'new'
                        ),
                        else_=ChatSession.status
                    ),
                    is_operator_mode=case(
                        (
                            or_(ChatSession.is_archived == True, ChatSession.status == 'archive'),
                            False
                        ),
                        else_=ChatSession.is_operator_mode
                    )
                )
            )

            # Реактивация: закрываем прошлый кейс и открываем новый
            if was_archived and cid:
                active_case = await session.execute(
                    select(SessionCase)
                    .where(SessionCase.session_id == session_id, SessionCase.client_id == cid, SessionCase.is_active == True)
                    .order_by(SessionCase.id.desc())
                    .limit(1)
                )
                active_case_row = active_case.scalar_one_or_none()
                if active_case_row:
                    active_case_row.is_active = False
                    active_case_row.close_reason = active_case_row.close_reason or 'auto_reopened'
                    active_case_row.closed_at = last_time

                last_case_num_q = await session.execute(
                    select(func.max(SessionCase.case_number))
                    .where(SessionCase.session_id == session_id, SessionCase.client_id == cid)
                )
                last_case_num = last_case_num_q.scalar() or 0
                session.add(SessionCase(
                    session_id=session_id,
                    client_id=cid,
                    case_number=last_case_num + 1,
                    is_active=True,
                    open_reason='reopened_by_user_message',
                    opened_at=last_time
                ))
        else:
            await session.execute(
                update(ChatSession)
                .where(ChatSession.session_id == session_id)
                .values(last_time=last_time)
            )

        await session.commit()

async def get_chat_history(session_id: str, limit: int = 20):
    async with AsyncSessionLocal() as session:
        res_sess = await session.execute(select(ChatSession.is_deleted).where(ChatSession.session_id == session_id))
        is_deleted = res_sess.scalar_one_or_none()
        if is_deleted:
            return []

        result = await session.execute(
            select(ChatMessage.content, ChatMessage.role, ChatMessage.timestamp, ChatMessage.attachments, ChatMessage.author_role)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.id.desc())
            .limit(limit)
        )
        rows = result.all()
        return [{"content": r.content, "role": r.role, "timestamp": r.timestamp, "attachments": r.attachments, "author_role": r.author_role} for r in reversed(rows)]

async def get_metrics_summary(client_id: str):
    async with AsyncSessionLocal() as session:
        res_dialogs = await session.execute(
            select(func.count()).select_from(ChatSession).where(ChatSession.client_id == client_id, ChatSession.is_deleted == False)
        )
        total_dialogs = res_dialogs.scalar() or 0
        
        res_leads = await session.execute(
            select(func.count()).select_from(Lead).where(Lead.client_id == client_id)
        )
        total_leads = res_leads.scalar() or 0
            
        return {
            "total_dialogs": total_dialogs,
            "total_leads": total_leads
        }

async def save_lead(payload: dict):
    async with AsyncSessionLocal() as session:
        new_lead = Lead(
            client_id=payload.get('client_id'),
            name=payload.get('name'),
            contact=payload.get('contact'),
            message=payload.get('message'),
            source_url=payload.get('source_url'),
            page_title=payload.get('page_title'),
            intent=payload.get('intent'),
            token=payload.get('token')
        )
        session.add(new_lead)
        await session.commit()

async def is_operator_mode(session_id: str) -> bool:
    """Проверяет, включен ли режим оператора для сессии."""
    from sqlalchemy import select
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(ChatSession.is_operator_mode).where(
                ChatSession.session_id == session_id
            )
        )
        return bool(res.scalar_one_or_none())


async def search_site_pages(client_id: str, query_embedding: list[float], limit: int = 5):
    """Семантический поиск страниц сайта по вектору."""
    async with AsyncSessionLocal() as session:
        if HAS_PGVECTOR:
            result = await session.execute(
                select(SitePage)
                .where(SitePage.client_id == client_id)
                .order_by(SitePage.embedding.cosine_distance(query_embedding))
                .limit(limit)
            )
        else:
            log.warning("pgvector не установлен. Семантический поиск ограничен.")
            result = await session.execute(
                select(SitePage)
                .where(SitePage.client_id == client_id)
                .order_by(SitePage.updated_at.desc())
                .limit(limit)
            )
        return result.scalars().all()

async def get_global_token(scope: str) -> Optional[dict]:
    from .db_service import GlobalToken
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(GlobalToken).where(GlobalToken.scope == scope))
        row = result.scalar_one_or_none()
        if row:
            return {"token": row.token, "expires_at": row.expires_at}
        return None

def detect_file_type(file_name: str) -> str:
    """Определяет тип файла по расширению."""
    name = file_name.lower() if file_name else ""
    if name.endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.ico', '.heic', '.heif', '.tiff')):
        return 'image'
    if name.endswith(('.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v', '.3gp')):
        return 'video'
    if name.endswith(('.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma', '.opus', '.oga')):
        return 'audio'
    if name.endswith(('.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
                       '.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm', '.rtf', '.zip', '.rar', '.7z', '.tar', '.gz')):
        return 'document'
    return 'other'


async def save_storage_item(
    client_id: str,
    category: str,
    file_size: int,
    file_path: Optional[str] = None,
    file_name: Optional[str] = None,
    session_id: Optional[str] = None,
    message_id: Optional[int] = None,
    file_type: Optional[str] = None
):
    """Создаёт запись в StorageItem.

    В used_storage учитываются только физически сохранённые объекты
    (есть file_path и размер > 0).
    """
    safe_file_size = max(0, int(file_size or 0))
    is_physical_file = bool(file_path and str(file_path).strip()) and safe_file_size > 0

    async with AsyncSessionLocal() as db:
        item = StorageItem(
            client_id=client_id,
            category=category,
            file_type=file_type or detect_file_type(file_name or ""),
            file_path=file_path,
            file_name=file_name,
            file_size=safe_file_size,
            session_id=session_id,
            message_id=message_id
        )
        db.add(item)

        # Обновляем used_storage только для реально сохранённых файлов
        if is_physical_file:
            user = (await db.execute(select(User).where(User.client_id == client_id))).scalar_one_or_none()
            if user:
                user.used_storage = (user.used_storage or 0) + safe_file_size

        await db.commit()


def _storage_file_conditions(client_id: str):
    """Фильтр для физически сохранённых файлов в StorageItem."""
    return [
        StorageItem.client_id == client_id,
        StorageItem.is_deleted == False,
        StorageItem.file_size > 0,
        StorageItem.file_path.is_not(None),
        StorageItem.file_path != ''
    ]


def _storage_text_objects(text_breakdown: Dict[str, int]) -> List[Dict[str, Any]]:
    """Псевдо-объекты Text Data для UI (не открываются как файлы)."""
    mapping = [
        ("dialogs", "Тексты диалогов"),
        ("prompt_and_kb", "Промпт и база знаний"),
        ("site_pages", "Страницы сайта")
    ]
    items: List[Dict[str, Any]] = []
    for key, label in mapping:
        size = int(text_breakdown.get(key, 0) or 0)
        if size <= 0:
            continue
        items.append({
            "id": f"text:{key}",
            "object_kind": "text_data",
            "category": "text_data",
            "file_type": "text",
            "file_name": label,
            "file_path": None,
            "file_size": size,
            "session_id": None,
            "created_at": None,
            "can_open": False
        })
    return items


async def _collect_text_breakdown(db: AsyncSession, client_id: str) -> Dict[str, int]:
    """Считает объём текстовых данных (в байтах UTF-8, приближенно)."""
    result = await db.execute(
        select(func.coalesce(func.sum(func.length(ChatMessage.content)), 0))
        .select_from(ChatMessage)
        .join(ChatSession, ChatMessage.session_id == ChatSession.session_id)
        .where(ChatSession.client_id == client_id)
    )
    text_size = int(result.scalar() or 0)

    result = await db.execute(
        select(func.coalesce(func.sum(func.length(ClientConfig.config_json['prompt'].astext)), 0))
        .where(ClientConfig.client_id == client_id)
    )
    prompt_size = int(result.scalar() or 0)

    result = await db.execute(
        select(func.coalesce(func.sum(func.length(ClientConfig.config_json['knowledge_base'].astext)), 0))
        .where(ClientConfig.client_id == client_id)
    )
    kb_size = int(result.scalar() or 0)

    result = await db.execute(
        select(func.coalesce(func.sum(func.length(SitePage.content)), 0))
        .where(SitePage.client_id == client_id)
    )
    site_size = int(result.scalar() or 0)

    return {
        "dialogs": text_size,
        "prompt_and_kb": prompt_size + kb_size,
        "site_pages": site_size
    }


async def _collect_storage_files(db: AsyncSession, client_id: str, category: Optional[str], limit: int, offset: int) -> List[StorageItem]:
    conditions = _storage_file_conditions(client_id)
    if category and category != "text_data":
        conditions.append(StorageItem.category == category)

    result = await db.execute(
        select(StorageItem)
        .where(*conditions)
        .order_by(StorageItem.created_at.desc(), StorageItem.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return result.scalars().all()


async def get_storage_usage(client_id: str) -> Dict[str, Any]:
    """Возвращает детализацию хранилища: Files + Text Data отдельно."""
    async with AsyncSessionLocal() as db:
        file_conditions = _storage_file_conditions(client_id)

        # 1. Files: суммарно по категориям
        result = await db.execute(
            select(
                StorageItem.category,
                func.count().label('count'),
                func.coalesce(func.sum(StorageItem.file_size), 0).label('total_size')
            )
            .where(*file_conditions)
            .group_by(StorageItem.category)
        )
        rows = result.all()
        by_category = [
            {"category": r.category, "count": int(r.count or 0), "total_size": int(r.total_size or 0)}
            for r in rows
        ]

        # 2. Files: детализация по file_type
        result = await db.execute(
            select(
                StorageItem.file_type,
                func.count().label('count'),
                func.coalesce(func.sum(StorageItem.file_size), 0).label('total_size')
            )
            .where(*file_conditions)
            .group_by(StorageItem.file_type)
        )
        rows = result.all()
        by_type = [
            {"file_type": r.file_type, "count": int(r.count or 0), "total_size": int(r.total_size or 0)}
            for r in rows
        ]

        result = await db.execute(
            select(func.coalesce(func.sum(StorageItem.file_size), 0))
            .where(*file_conditions)
        )
        files_total = int(result.scalar() or 0)

        # 3. Text Data (не файлы)
        text_breakdown = await _collect_text_breakdown(db, client_id)
        text_total = int(sum(text_breakdown.values()))

        return {
            "by_category": by_category,
            "by_type": by_type,
            "files_total": files_total,
            "text_total": text_total,
            "text_breakdown": text_breakdown,
            "text_items": _storage_text_objects(text_breakdown)
        }


async def get_storage_items(
    client_id: str,
    category: Optional[str] = None,
    limit: int = 50,
    offset: int = 0
) -> List[Dict[str, Any]]:
    """Возвращает список физически сохранённых файлов (Files only)."""
    async with AsyncSessionLocal() as db:
        items = await _collect_storage_files(db, client_id, category=category, limit=limit, offset=offset)
        return [
            {
                "id": i.id,
                "object_kind": "file",
                "category": i.category,
                "file_type": i.file_type,
                "file_name": i.file_name,
                "file_path": i.file_path,
                "file_size": int(i.file_size or 0),
                "session_id": i.session_id,
                "created_at": i.created_at.isoformat() if i.created_at else None,
                "can_open": bool(i.file_path)
            }
            for i in items
        ]


async def get_storage_objects(
    client_id: str,
    category: Optional[str] = None,
    limit: int = 50,
    offset: int = 0
) -> List[Dict[str, Any]]:
    """Возвращает объединённый список Files + Text Data для UI."""
    files = await get_storage_items(client_id, category=category, limit=limit, offset=offset)
    usage = await get_storage_usage(client_id)
    text_items = usage.get("text_items", []) if category in (None, "text_data") else []
    return files + text_items


async def mark_storage_items_deleted(
    client_id: Optional[str] = None,
    session_id: Optional[str] = None,
    message_id: Optional[int] = None,
    file_path: Optional[str] = None
):
    """Помечает StorageItem как удалённые по фильтру.
    Возвращает сумму освобождённых байт."""
    async with AsyncSessionLocal() as db:
        conditions = [StorageItem.is_deleted == False]
        if client_id:
            conditions.append(StorageItem.client_id == client_id)
        if session_id:
            conditions.append(StorageItem.session_id == session_id)
        if message_id:
            conditions.append(StorageItem.message_id == message_id)
        if file_path:
            conditions.append(StorageItem.file_path == file_path)

        # Сначала считаем сумму
        result = await db.execute(
            select(func.coalesce(func.sum(StorageItem.file_size), 0))
            .where(*conditions)
        )
        total = result.scalar() or 0

        # Помечаем удалёнными
        await db.execute(
            update(StorageItem)
            .where(*conditions)
            .values(is_deleted=True)
        )
        await db.commit()
        return total

async def download_and_save_file(
    url: str,
    client_id: str,
    session_id: Optional[str] = None,
    file_name: Optional[str] = None,
    category: str = "chat_file",
    max_size: int = 50 * 1024 * 1024
) -> Optional[str]:
    """Скачивает файл по URL, сохраняет на диск и записывает в StorageItem.
    Возвращает локальный URL для подстановки в текст сообщения.
    Если файл уже существует на диске — не перезаписывает."""
    from ..core.config import BASE_DIR

    if not file_name:
        file_name = url.split("/")[-1].split("?")[0] or "file"

    # Проверка расширения (безопасность)
    ext = file_name.split('.')[-1].lower() if '.' in file_name else ''
    forbidden = {'json', 'exe', 'php', 'py', 'sh', 'bat', 'js', 'html', 'htm'}
    if ext in forbidden:
        log.warning(f"[DOWNLOAD] Blocked forbidden file type: {file_name}")
        return None

    # Безопасное имя файла
    safe_name = "".join(c for c in file_name if c.isalnum() or c in "._- ")[:100]
    if not safe_name:
        safe_name = f"file_{int(time.time())}"

    # Директория для сохранения
    dest_dir = os.path.join(BASE_DIR, "uploads", client_id, "chat_files", str(session_id or "external"))
    os.makedirs(dest_dir, exist_ok=True)

    local_filename = f"downloaded_{int(time.time())}_{safe_name}"
    save_path = os.path.join(dest_dir, local_filename)

    # Если файл уже существует — не перезаписываем
    if os.path.exists(save_path):
        existing_size = os.path.getsize(save_path)
        local_url = f"/api/chat/uploads/{client_id}/chat_files/{session_id or 'external'}/{local_filename}"
        asyncio.create_task(save_storage_item(
            client_id=client_id,
            category=category,
            file_size=existing_size,
            file_path=local_url,
            file_name=file_name,
            session_id=session_id
        ))
        return local_url

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                log.warning(f"[DOWNLOAD] Failed to download {url}: HTTP {resp.status_code}")
                return None

            content = resp.content
            if len(content) > max_size:
                log.warning(f"[DOWNLOAD] File too large ({len(content)} bytes) from {url}")
                return None

            if len(content) == 0:
                log.warning(f"[DOWNLOAD] Empty file from {url}")
                return None

            with open(save_path, "wb") as f:
                f.write(content)

            log.info(f"[DOWNLOAD] Saved {len(content)} bytes to {save_path}")

            local_url = f"/api/chat/uploads/{client_id}/chat_files/{session_id or 'external'}/{local_filename}"

            asyncio.create_task(save_storage_item(
                client_id=client_id,
                category=category,
                file_size=len(content),
                file_path=local_url,
                file_name=file_name,
                session_id=session_id
            ))

            return local_url

    except Exception as e:
        log.error(f"[DOWNLOAD] Error downloading {url}: {e}")
        return None


async def save_global_token(scope: str, token: str, expires_at: float):
    from .db_service import GlobalToken
    from sqlalchemy.dialects.postgresql import insert
    async with AsyncSessionLocal() as session:
        stmt = insert(GlobalToken).values(
            scope=scope,
            token=token,
            expires_at=expires_at
        ).on_conflict_do_update(
            index_elements=['scope'],
            set_={'token': token, 'expires_at': expires_at, 'updated_at': func.now()}
        )
        await session.execute(stmt)
        await session.commit()
