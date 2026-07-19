import hashlib
import json
import logging
import os
import time
import asyncio
from typing import Optional, List, Dict, Any
from urllib.parse import unquote
from datetime import datetime, timedelta

import httpx

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String, Text, Float, Integer, BigInteger, DateTime, Boolean, ForeignKey, select, update, delete, func, Column, case, or_, Index
from sqlalchemy.dialects.postgresql import JSONB, ARRAY
try:
    from pgvector.sqlalchemy import Vector
    HAS_PGVECTOR = True
except ImportError:
    HAS_PGVECTOR = False
    from sqlalchemy import Float as Vector

from ..core.config import DATABASE_URL, log

def build_assistant_filter_conditions(column, assistant_filter: Optional[str]):
    raw_value = str(assistant_filter or '').strip()
    if not raw_value or raw_value == 'all':
        return []

    parts = []
    for part in raw_value.split(','):
        normalized = str(part or '').strip()
        if normalized and normalized not in parts:
            parts.append(normalized)
    if not parts or 'all' in parts:
        return []

    include_main = 'main' in parts
    assistant_ids = [part for part in parts if part != 'main']
    if include_main and 'main' not in assistant_ids:
        assistant_ids.append('main')

    conditions = []
    if assistant_ids:
        conditions.append(column.in_(assistant_ids))
    if include_main:
        conditions.append(column.is_(None))
    return conditions


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
    tariff_name: Mapped[str] = mapped_column(String(50), default="start")
    is_personal_tariff: Mapped[bool] = mapped_column(Boolean, default=False)
    messages_consumed: Mapped[int] = mapped_column(Integer, default=0)
    start_trial_messages_used: Mapped[int] = mapped_column(Integer, default=0)
    extra_messages_purchased: Mapped[int] = mapped_column(Integer, default=0)
    extra_messages_used: Mapped[int] = mapped_column(Integer, default=0)
    extra_assistants_purchased: Mapped[int] = mapped_column(Integer, default=0)
    extra_storage_purchased_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    storage_plan_pack_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    extra_messages_limit: Mapped[int] = mapped_column(Integer, default=0)
    extra_storage_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    extra_context_limit: Mapped[int] = mapped_column(Integer, default=0)

    extra_index_pages: Mapped[int] = mapped_column(Integer, default=0)
    extra_assistants_hard_cap: Mapped[int] = mapped_column(Integer, default=0)
    messages_period_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    verification_token: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    verification_token_created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    tariff_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    tariff_billing_period: Mapped[str] = mapped_column(String(16), default="month")
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


class ClientCustomCondition(Base):
    __tablename__ = "client_custom_conditions"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(100), index=True)
    extra_messages: Mapped[int] = mapped_column(Integer, default=0)
    extra_assistants: Mapped[int] = mapped_column(Integer, default=0)
    extra_messages_limit: Mapped[int] = mapped_column(Integer, default=0)
    extra_storage_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    extra_context_limit: Mapped[int] = mapped_column(Integer, default=0)
    extra_index_pages: Mapped[int] = mapped_column(Integer, default=0)
    extra_assistants_hard_cap: Mapped[int] = mapped_column(Integer, default=0)
    extend_days: Mapped[int] = mapped_column(Integer, default=0)
    expires_at_override: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    reason_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[Optional[str]] = mapped_column(String(100), index=True, nullable=True)
    category: Mapped[str] = mapped_column(String(50), default="system", index=True)
    type: Mapped[str] = mapped_column(String(100), default="system", index=True)
    severity: Mapped[str] = mapped_column(String(20), default="info", index=True)
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(50), default="system", index=True)
    channel_scope: Mapped[str] = mapped_column(String(20), default="in_app")
    action_url: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    action_label: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    dedupe_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), index=True)


class ClientConfig(Base):
    __tablename__ = "client_configs"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(100), ForeignKey("users.client_id"), unique=True, index=True)
    config_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())


class Assistant(Base):
    __tablename__ = "assistants"
    __table_args__ = (
        Index("ix_assistants_client_assistant", "client_id", "assistant_id", unique=True),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(100), ForeignKey("users.client_id"), index=True)
    assistant_id: Mapped[str] = mapped_column(String(100), index=True)
    name: Mapped[str] = mapped_column(String(255), default="Митя")
    role: Mapped[str] = mapped_column(String(255), default="ИИ-ассистент")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)


class AssistantConfig(Base):
    __tablename__ = "assistant_configs"
    __table_args__ = (
        Index("ix_assistant_configs_client_assistant", "client_id", "assistant_id", unique=True),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    assistant_id: Mapped[str] = mapped_column(String(100), index=True)
    client_id: Mapped[str] = mapped_column(String(100), ForeignKey("users.client_id"), index=True)
    config_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())


class ChatSession(Base):
    __tablename__ = "chat_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    client_id: Mapped[str] = mapped_column(String(100), index=True)
    assistant_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
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
    assistant_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
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
    assistant_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
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
    assistant_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
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
    assistant_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
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
    assistant_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
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

async def _apply_startup_schema_migrations():
    """Минимальные встроенные миграции для существующих PostgreSQL баз.
    Нужны, чтобы старые инсталляции переживали добавление assistant-aware колонок.
    """
    from sqlalchemy import text

    migration_sql = [
        "ALTER TABLE assistants ADD COLUMN IF NOT EXISTS assistant_id VARCHAR(100)",
        "ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS assistant_id VARCHAR(100)",
        "ALTER TABLE session_cases ADD COLUMN IF NOT EXISTS assistant_id VARCHAR(100)",
        "ALTER TABLE leads ADD COLUMN IF NOT EXISTS assistant_id VARCHAR(100)",
        "ALTER TABLE site_pages ADD COLUMN IF NOT EXISTS assistant_id VARCHAR(100)",
        "ALTER TABLE storage_items ADD COLUMN IF NOT EXISTS assistant_id VARCHAR(100)",
        "ALTER TABLE ai_cache ADD COLUMN IF NOT EXISTS assistant_id VARCHAR(100)",
        "ALTER TABLE assistant_configs ADD COLUMN IF NOT EXISTS client_id VARCHAR(100)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_personal_tariff BOOLEAN DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS start_trial_messages_used INTEGER DEFAULT 0",
        "UPDATE users SET start_trial_messages_used = messages_consumed WHERE tariff_name = 'start' AND start_trial_messages_used = 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_messages_purchased INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_messages_used INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_assistants_purchased INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_storage_purchased_bytes BIGINT DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS storage_plan_pack_id VARCHAR(64)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_messages_limit INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_storage_bytes BIGINT DEFAULT 0",

        "ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_context_limit INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_index_pages INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_assistants_hard_cap INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS messages_period_started_at TIMESTAMP",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS tariff_billing_period VARCHAR(16) DEFAULT 'month'",
        "CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, client_id VARCHAR(100), category VARCHAR(50) DEFAULT 'system', type VARCHAR(100) DEFAULT 'system', severity VARCHAR(20) DEFAULT 'info', title VARCHAR(255) NOT NULL, body TEXT NOT NULL, source VARCHAR(50) DEFAULT 'system', channel_scope VARCHAR(20) DEFAULT 'in_app', action_url VARCHAR(255), action_label VARCHAR(100), dedupe_key VARCHAR(255), is_read BOOLEAN DEFAULT FALSE, is_archived BOOLEAN DEFAULT FALSE, expires_at TIMESTAMP NULL, created_at TIMESTAMP DEFAULT NOW())",
        "CREATE INDEX IF NOT EXISTS ix_notifications_client_id ON notifications (client_id)",
        "CREATE INDEX IF NOT EXISTS ix_notifications_type ON notifications (type)",
        "CREATE INDEX IF NOT EXISTS ix_notifications_created_at ON notifications (created_at)",
        "CREATE INDEX IF NOT EXISTS ix_notifications_dedupe_key ON notifications (dedupe_key)",
        "UPDATE assistant_configs ac SET client_id = a.client_id FROM assistants a WHERE ac.client_id IS NULL AND ac.assistant_id = a.assistant_id",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_assistant_configs_client_assistant ON assistant_configs (client_id, assistant_id)",
        "ALTER TABLE assistant_configs DROP CONSTRAINT IF EXISTS assistant_configs_assistant_id_fkey",
        "DROP INDEX IF EXISTS ix_assistant_configs_assistant_id",
        "DROP INDEX IF EXISTS ix_assistants_assistant_id",
        "DROP INDEX IF EXISTS ix_assistants_assistant_id_unique",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_assistants_client_assistant ON assistants (client_id, assistant_id)",
        "CREATE INDEX IF NOT EXISTS ix_chat_sessions_assistant_id ON chat_sessions (assistant_id)",
        "CREATE INDEX IF NOT EXISTS ix_session_cases_assistant_id ON session_cases (assistant_id)",
        "CREATE INDEX IF NOT EXISTS ix_leads_assistant_id ON leads (assistant_id)",
        "CREATE INDEX IF NOT EXISTS ix_site_pages_assistant_id ON site_pages (assistant_id)",
        "CREATE INDEX IF NOT EXISTS ix_storage_items_assistant_id ON storage_items (assistant_id)",
        "CREATE INDEX IF NOT EXISTS ix_ai_cache_assistant_id ON ai_cache (assistant_id)",
        "CREATE TABLE IF NOT EXISTS client_custom_conditions (id SERIAL PRIMARY KEY, client_id VARCHAR(100), extra_messages INTEGER DEFAULT 0, extra_assistants INTEGER DEFAULT 0, extra_messages_limit INTEGER DEFAULT 0, extra_storage_bytes BIGINT DEFAULT 0, extra_context_limit INTEGER DEFAULT 0, extra_index_pages INTEGER DEFAULT 0, extra_assistants_hard_cap INTEGER DEFAULT 0, extend_days INTEGER DEFAULT 0, expires_at_override TIMESTAMP NULL, reason_comment TEXT NULL, created_by VARCHAR(255) NULL, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())",
        "ALTER TABLE client_custom_conditions ADD COLUMN IF NOT EXISTS extra_messages_limit INTEGER DEFAULT 0",
        "ALTER TABLE client_custom_conditions ADD COLUMN IF NOT EXISTS extra_storage_bytes BIGINT DEFAULT 0",
        "ALTER TABLE client_custom_conditions ADD COLUMN IF NOT EXISTS extra_context_limit INTEGER DEFAULT 0",
        "ALTER TABLE client_custom_conditions ADD COLUMN IF NOT EXISTS extra_index_pages INTEGER DEFAULT 0",
        "ALTER TABLE client_custom_conditions ADD COLUMN IF NOT EXISTS extra_assistants_hard_cap INTEGER DEFAULT 0",
        "CREATE INDEX IF NOT EXISTS ix_client_custom_conditions_client_id ON client_custom_conditions (client_id)",
        "CREATE INDEX IF NOT EXISTS ix_client_custom_conditions_active ON client_custom_conditions (is_active)",
        "ALTER TABLE balance_transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()",
        "CREATE INDEX IF NOT EXISTS ix_balance_transactions_created_at ON balance_transactions (created_at)"
    ]

    for sql in migration_sql:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(sql))
        except Exception as e:
            log.warning(f"Startup migration skipped for SQL '{sql}': {e}")


async def init_db():
    """Инициализация таблиц в базе данных."""
    last_error = None
    for attempt in range(1, 6):
        try:
            await _apply_startup_schema_migrations()
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            log.info("Database schema is ready")
            return
        except Exception as e:
            last_error = e
            log.warning(f"init_db attempt {attempt}/5 failed: {e}")
            await asyncio.sleep(2 * attempt)
    raise RuntimeError(f"Failed to initialize database after retries: {last_error}")

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


async def ensure_messages_period(
    user: User,
    session: AsyncSession,
    reset_days: int = 30,
    commit_changes: bool = True,
) -> User:
    now = datetime.now()
    changed = False
    period_days = max(int(reset_days or 0), 0)

    # On the free Start plan the 30 AI messages are a one-time trial,
    # so there is no recurring reset date.
    if period_days == 0:
        if user.messages_reset_at is not None:
            user.messages_reset_at = None
            changed = True
        if changed:
            session.add(user)
            if commit_changes:
                await session.commit()
                await session.refresh(user)
        return user

    if user.messages_period_started_at is None:
        user.messages_period_started_at = now
        changed = True
    if user.messages_reset_at is None:
        user.messages_reset_at = user.messages_period_started_at + timedelta(days=period_days)
        changed = True

    while user.messages_reset_at and user.messages_reset_at <= now:
        user.messages_period_started_at = user.messages_reset_at
        user.messages_reset_at = user.messages_period_started_at + timedelta(days=period_days)
        user.messages_consumed = 0
        # Purchased message packs are not a monthly allowance and remain
        # available until they are actually used.
        changed = True

    if changed:
        session.add(user)
        if commit_changes:
            await session.commit()
            await session.refresh(user)
    return user


def get_message_quota_state(user: User, base_limit: int) -> dict:
    base_limit = max(int(base_limit or 0), 0)
    if str(getattr(user, 'tariff_name', 'start') or 'start').lower() == 'start':
        used_base = max(int(getattr(user, 'start_trial_messages_used', user.messages_consumed) or 0), 0)
    else:
        used_base = max(int(user.messages_consumed or 0), 0)
    extra_purchased = max(int(user.extra_messages_purchased or 0), 0)
    extra_used = max(int(user.extra_messages_used or 0), 0)
    base_remaining = max(base_limit - used_base, 0)
    extra_remaining = max(extra_purchased - extra_used, 0)
    total_remaining = base_remaining + extra_remaining
    quota_state = 'ok'
    if base_remaining <= 0 and extra_remaining > 0:
        quota_state = 'using_extra'
    elif total_remaining <= 0:
        quota_state = 'operator_mode_only'
    return {
        'base_limit': base_limit,
        'base_used': used_base,
        'base_remaining': base_remaining,
        'extra_purchased': extra_purchased,
        'extra_used': extra_used,
        'extra_remaining': extra_remaining,
        'total_remaining': total_remaining,
        'quota_state': quota_state,
    }


async def consume_message_quota(client_id: str, base_limit: int, reset_days: int = 30) -> dict:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(User).where(User.client_id == client_id).with_for_update()
        )
        user = result.scalar_one_or_none()
        if not user:
            raise ValueError('Пользователь не найден')

        user = await ensure_messages_period(
            user,
            session,
            reset_days=reset_days,
            commit_changes=False,
        )
        quota = get_message_quota_state(user, base_limit)
        if quota['base_remaining'] > 0:
            user.messages_consumed = int(user.messages_consumed or 0) + 1
            if reset_days == 0:
                user.start_trial_messages_used = int(
                    getattr(user, 'start_trial_messages_used', 0) or 0
                ) + 1
        elif quota['extra_remaining'] > 0:
            user.extra_messages_used = int(user.extra_messages_used or 0) + 1
        else:
            session.add(user)
            await session.commit()
            return quota

        session.add(user)
        await session.commit()
        await session.refresh(user)
        return get_message_quota_state(user, base_limit)


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


async def credit_balance_once(
    client_id: str,
    amount: float,
    source: str,
    external_id: str,
    description: Optional[str] = None,
) -> bool:
    """Атомарно зачисляет баланс один раз для уникального внешнего платежа."""
    async with AsyncSessionLocal() as session:
        user_result = await session.execute(
            select(User).where(User.client_id == client_id).with_for_update()
        )
        user = user_result.scalar_one_or_none()
        if not user:
            raise ValueError('Пользователь не найден')

        existing = await session.execute(
            select(BalanceTransaction.id).where(
                BalanceTransaction.client_id == client_id,
                BalanceTransaction.source == source,
                BalanceTransaction.external_id == external_id,
            )
        )
        if existing.scalar_one_or_none() is not None:
            return False

        user.balance = float(user.balance or 0) + float(amount)
        session.add(BalanceTransaction(
            client_id=client_id,
            amount=amount,
            source=source,
            description=description,
            external_id=external_id,
        ))
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


async def get_or_create_session(session_id: str, client_id: str, metadata: Optional[dict] = None, assistant_id: Optional[str] = None):
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(ChatSession).where(ChatSession.session_id == session_id))
        sess = result.scalar_one_or_none()

        if sess:
            sess.last_time = func.now()
            sess.is_deleted = False
            if assistant_id and not sess.assistant_id:
                sess.assistant_id = assistant_id
            if metadata:
                if not sess.metadata_json:
                    sess.metadata_json = metadata
                else:
                    new_meta = dict(sess.metadata_json)
                    new_meta.update(metadata)
                    sess.metadata_json = new_meta
        else:
            new_sess = ChatSession(session_id=session_id, client_id=client_id, assistant_id=assistant_id, metadata_json=metadata)
            session.add(new_sess)
            session.add(SessionCase(
                session_id=session_id,
                client_id=client_id,
                assistant_id=assistant_id,
                case_number=1,
                is_active=True,
                open_reason="new_session"
            ))
        await session.commit()

async def save_chat_message(session_id: str, role: str, content: str, attachments: Optional[List[Dict]] = None, author_role: Optional[str] = None, **kwargs):
    async with AsyncSessionLocal() as session:
        timestamp = kwargs.get('timestamp')
        is_sync = kwargs.get('is_sync', False)

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
            select(ChatMessage.id, ChatMessage.content, ChatMessage.role, ChatMessage.timestamp, ChatMessage.attachments, ChatMessage.author_role)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.id.desc())
            .limit(limit)
        )
        rows = result.all()
        return [{"id": r.id, "content": r.content, "role": r.role, "timestamp": r.timestamp, "attachments": r.attachments, "author_role": r.author_role} for r in reversed(rows)]

async def get_metrics_summary(client_id: str, assistant_id: Optional[str] = None):
    async with AsyncSessionLocal() as session:
        dialogs_conditions = [ChatSession.client_id == client_id, ChatSession.is_deleted == False]
        leads_conditions = [Lead.client_id == client_id]

        dialogs_assistant_conditions = build_assistant_filter_conditions(ChatSession.assistant_id, assistant_id)
        leads_assistant_conditions = build_assistant_filter_conditions(Lead.assistant_id, assistant_id)
        if dialogs_assistant_conditions:
            dialogs_conditions.append(or_(*dialogs_assistant_conditions))
        if leads_assistant_conditions:
            leads_conditions.append(or_(*leads_assistant_conditions))

        res_dialogs = await session.execute(
            select(func.count()).select_from(ChatSession).where(*dialogs_conditions)
        )
        total_dialogs = res_dialogs.scalar() or 0

        res_leads = await session.execute(
            select(func.count()).select_from(Lead).where(*leads_conditions)
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
            assistant_id=payload.get('assistant_id'),
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
    file_type: Optional[str] = None,
    assistant_id: Optional[str] = None
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
            assistant_id=assistant_id,
            category=category,
            file_type=file_type or detect_file_type(file_name or ""),
            file_path=file_path,
            file_name=file_name,
            file_size=safe_file_size,
            session_id=session_id,
            message_id=message_id
        )
        db.add(item)

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


def _best_name_from_path(file_path: Optional[str]) -> Optional[str]:
    raw = str(file_path or "").strip()
    if not raw:
        return None

    normalized = unquote(raw).replace("\\", "/")
    candidate = normalized.rsplit("/", 1)[-1].split("?", 1)[0].split("#", 1)[0].strip()
    if not candidate:
        return None

    lower = candidate.lower()
    if lower.startswith(("file_", "temp_", "downloaded_")) and "." in candidate:
        ext = candidate.rsplit(".", 1)[-1]
        if ext:
            return f"file.{ext}"

    return candidate


def _storage_display_name(
    file_name: Optional[str],
    file_path: Optional[str],
    category: Optional[str] = None,
    knowledge_file_name: Optional[str] = None,
) -> str:
    raw = (file_name or file_path or "").strip()
    if not raw:
        return "file"

    normalized = raw.replace("\\", "/")
    base_name = normalized.rsplit("/", 1)[-1]
    if not base_name:
        return "file"

    field_labels = {
        "knowledge_file_url": "База знаний",
        "widget_img": "Изображение виджета",
        "window_bg_img": "Фон окна",
        "chat_window_bg_img": "Фон чата",
        "header_logo": "Логотип",
        "welcome_img": "Изображение приветствия",
        "profile_avatar": "Аватар профиля",
        "msg_bot_avatar": "Аватар бота",
        "msg_user_avatar": "Аватар пользователя",
        "msg_operator_avatar": "Аватар оператора",
        "inline_btn_accent_img": "Иконка акцентной кнопки",
        "inline_btn_neutral_img": "Иконка нейтральной кнопки",
        "inline_btn_info_img": "Иконка инфо-кнопки",
        "bot_avatar": "Аватар бота",
        "user_avatar": "Аватар пользователя",
        "operator_avatar": "Аватар оператора",
    }

    technical_name = base_name.lower()
    ext = ""
    if "." in base_name:
        ext = "." + base_name.rsplit(".", 1)[-1]

    if technical_name.startswith("file_") or technical_name.startswith("temp_"):
        stem = technical_name.rsplit(".", 1)[0]

        if "_knowledge_file_url" in stem and knowledge_file_name:
            k_raw = str(knowledge_file_name).strip().replace("\\", "/")
            k_name = k_raw.rsplit("/", 1)[-1].strip()
            if k_name:
                return k_name

        for field_id, label in field_labels.items():
            marker = f"_{field_id}"
            if stem.endswith(marker) or marker in stem:
                path_name = _best_name_from_path(file_path)
                if path_name and not path_name.lower().startswith(("file_", "temp_", "downloaded_")):
                    return path_name
                return f"{label}{ext}"

    return base_name


async def _get_knowledge_file_name_for_client(db: AsyncSession, client_id: str) -> Optional[str]:
    cfg = (await db.execute(select(ClientConfig).where(ClientConfig.client_id == client_id))).scalar_one_or_none()
    if not cfg:
        return None

    bot_settings = (cfg.config_json or {}).get("bot_settings") or {}
    value = bot_settings.get("knowledge_file_name")
    return str(value).strip() if value else None


async def _serialize_storage_items(
    db: AsyncSession,
    client_id: str,
    items: List[StorageItem],
    include_download_url: bool,
) -> List[Dict[str, Any]]:
    knowledge_file_name = await _get_knowledge_file_name_for_client(db, client_id)

    return [
        {
            "id": i.id,
            "object_kind": "file",
            "category": i.category,
            "file_type": i.file_type,
            "file_name": _storage_display_name(i.file_name, i.file_path, i.category, knowledge_file_name),
            "file_path": i.file_path,
            "download_url": f"/api/chat/admin/storage-file/{i.id}/download?client_id={client_id}" if include_download_url else None,
            "file_size": int(i.file_size or 0),
            "session_id": i.session_id,
            "created_at": i.created_at.isoformat() if i.created_at else None,
            "can_open": bool(i.file_path)
        }
        for i in items
    ]

async def get_storage_items(
    client_id: str,
    category: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    include_download_url: bool = False
) -> List[Dict[str, Any]]:
    """Возвращает список физически сохранённых файлов (Files only)."""
    async with AsyncSessionLocal() as db:
        items = await _collect_storage_files(db, client_id, category=category, limit=limit, offset=offset)
        return await _serialize_storage_items(db, client_id, items, include_download_url)


async def get_storage_file_by_id(client_id: str, item_id: int) -> Optional[StorageItem]:
    """Возвращает физический файл StorageItem по id в рамках tenant."""
    async with AsyncSessionLocal() as db:
        conditions = _storage_file_conditions(client_id)
        conditions.append(StorageItem.id == item_id)
        result = await db.execute(select(StorageItem).where(*conditions).limit(1))
        return result.scalar_one_or_none()

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
    file_path: Optional[str] = None,
    assistant_id: Optional[str] = None
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
        if assistant_id:
            conditions.append(StorageItem.assistant_id == assistant_id)

        result = await db.execute(
            select(func.coalesce(func.sum(StorageItem.file_size), 0))
            .where(*conditions)
        )
        total = result.scalar() or 0

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
    max_size: int = 50 * 1024 * 1024,
    assistant_id: Optional[str] = None
) -> Optional[str]:
    """Скачивает файл по URL, сохраняет на диск и записывает в StorageItem.
    Возвращает локальный URL для подстановки в текст сообщения.
    Если файл уже существует на диске — не перезаписывает."""
    from ..core.config import BASE_DIR

    if not file_name:
        file_name = url.split("/")[-1].split("?")[0] or "file"

    ext = file_name.split('.')[-1].lower() if '.' in file_name else ''
    forbidden = {'json', 'exe', 'php', 'py', 'sh', 'bat', 'js', 'html', 'htm'}
    if ext in forbidden:
        log.warning(f"[DOWNLOAD] Blocked forbidden file type: {file_name}")
        return None

    safe_name = "".join(c for c in file_name if c.isalnum() or c in "._- ")[:100]
    if not safe_name:
        safe_name = f"file_{int(time.time())}"

    dest_dir = os.path.join(BASE_DIR, "uploads", client_id, "chat_files", str(session_id or "external"))
    os.makedirs(dest_dir, exist_ok=True)

    local_filename = f"downloaded_{int(time.time())}_{safe_name}"
    save_path = os.path.join(dest_dir, local_filename)

    if os.path.exists(save_path):
        existing_size = os.path.getsize(save_path)
        local_url = f"/api/chat/uploads/{client_id}/chat_files/{session_id or 'external'}/{local_filename}"
        asyncio.create_task(save_storage_item(
            client_id=client_id,
            assistant_id=assistant_id,
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
                assistant_id=assistant_id,
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
