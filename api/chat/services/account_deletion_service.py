"""Shared irreversible tenant cleanup for self-service and super-admin deletion."""
import asyncio
import os
import shutil
from pathlib import Path

from sqlalchemy import delete, select

from ..core.config import BASE_DIR, log
from .cache_service import cache_service
from .db_service import (
    ActiveScenario,
    AICache,
    Assistant,
    AssistantConfig,
    AsyncSessionLocal,
    BalanceTransaction,
    ChatMessage,
    ChatSession,
    ClientConfig,
    ClientCustomCondition,
    Lead,
    Notification,
    SessionCase,
    SitePage,
    StorageItem,
    User,
    UserCloseReason,
    UserScenario,
)


async def delete_client_account(client_id: str) -> None:
    """Delete all database records and local artifacts belonging to one client."""
    async with AsyncSessionLocal() as db:
        session_ids = select(ChatSession.session_id).where(ChatSession.client_id == client_id)
        await db.execute(delete(ChatMessage).where(ChatMessage.session_id.in_(session_ids)))
        await db.execute(delete(SessionCase).where(SessionCase.client_id == client_id))
        await db.execute(delete(ActiveScenario).where(ActiveScenario.client_id == client_id))
        await db.execute(delete(UserScenario).where(UserScenario.client_id == client_id))
        await db.execute(delete(ChatSession).where(ChatSession.client_id == client_id))
        await db.execute(delete(Lead).where(Lead.client_id == client_id))
        await db.execute(delete(SitePage).where(SitePage.client_id == client_id))
        await db.execute(delete(StorageItem).where(StorageItem.client_id == client_id))
        await db.execute(delete(AICache).where(AICache.client_id == client_id))
        await db.execute(delete(AssistantConfig).where(AssistantConfig.client_id == client_id))
        await db.execute(delete(Assistant).where(Assistant.client_id == client_id))
        await db.execute(delete(Notification).where(Notification.client_id == client_id))
        await db.execute(delete(BalanceTransaction).where(BalanceTransaction.client_id == client_id))
        await db.execute(delete(ClientCustomCondition).where(ClientCustomCondition.client_id == client_id))
        await db.execute(delete(UserCloseReason).where(UserCloseReason.client_id == client_id))
        await db.execute(delete(ClientConfig).where(ClientConfig.client_id == client_id))
        await db.execute(delete(User).where(User.client_id == client_id))
        await db.commit()

    cache_service.clear_pattern(f"client_cfg:{client_id}:*")
    cache_service.clear_pattern(f"ai_cache:{client_id}:*")

    uploads_path = Path(BASE_DIR) / "uploads" / client_id
    legacy_config_path = Path(__file__).parent / "clients" / f"{client_id}.json"
    await asyncio.to_thread(shutil.rmtree, uploads_path, ignore_errors=True)
    try:
        legacy_config_path.unlink(missing_ok=True)
    except OSError as exc:
        log.warning("[ACCOUNT_DELETE] Could not remove legacy config for %s: %s", client_id, exc)

    log.info("[ACCOUNT_DELETE] Deleted account and local artifacts for %s", client_id)
