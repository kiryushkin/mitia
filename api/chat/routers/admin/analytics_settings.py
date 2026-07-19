from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import or_, select

from ...services.assistants_service import get_assistant_config, save_assistant_config
from ...services.clients import get_client_config, save_client_config
from ...services.db_service import AICache, AsyncSessionLocal, User
from .deps import verify_token
from .analytics_shared import (
    analytics_scope_key,
    extract_client_analytics_settings,
    extract_snapshot_date_to,
    normalize_assistant_filter_values,
    parse_cache_json,
)

router = APIRouter()


@router.get("/analytics-settings")
async def get_analytics_settings(client_id: str, assistant_id: Optional[str] = None, active_assistant_id: Optional[str] = None, token_data: dict = Depends(verify_token)):
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    target_id = client_id if client_id != 'default' else 'mitia_assistant'
    assistant_scope = str(assistant_id or 'all').strip() or 'all'
    cfg = await get_client_config(target_id)
    settings = extract_client_analytics_settings(getattr(cfg, "raw", {}) or {})

    settings_scope_assistant_id = str(active_assistant_id or '').strip()
    if settings_scope_assistant_id:
        assistant_cfg = await get_assistant_config(target_id, settings_scope_assistant_id)
        assistant_analytics = (assistant_cfg or {}).get('analytics') or {}
        if isinstance(assistant_analytics, dict):
            saved_filter = assistant_analytics.get('assistant_filter')
            if isinstance(saved_filter, list):
                settings['assistant_filter'] = normalize_assistant_filter_values(assistant_filter_list=saved_filter)

    today = datetime.now().date()
    min_date = today
    max_date = today
    max_source = "today"

    async with AsyncSessionLocal() as db:
        user_row = await db.execute(select(User.created_at).where(User.client_id == target_id))
        user_created_at = user_row.scalar_one_or_none()
        if isinstance(user_created_at, datetime):
            min_date = user_created_at.date()

        scope_key = analytics_scope_key(target_id, assistant_scope)
        latest_snapshot_row = await db.execute(
            select(AICache.content)
            .where(
                AICache.client_id == target_id,
                or_(
                    AICache.cache_key.like(f"dashboard_recs_24h_{scope_key}_%"),
                    AICache.cache_key.like(f"dashboard_recs_day_{scope_key}_%")
                )
            )
            .order_by(AICache.created_at.desc())
            .limit(1)
        )
        latest_snapshot_raw = latest_snapshot_row.scalar_one_or_none()

    snapshot_payload = parse_cache_json(latest_snapshot_raw)
    snapshot_date_to = extract_snapshot_date_to(snapshot_payload)
    if isinstance(snapshot_date_to, date):
        if snapshot_date_to < max_date:
            max_date = snapshot_date_to
            max_source = "snapshot"

    if min_date > max_date:
        min_date = max_date

    return {
        "status": "success",
        "settings": settings,
        "calendar_bounds": {
            "min_date": min_date.isoformat(),
            "max_date": max_date.isoformat(),
            "max_source": max_source
        }
    }


@router.post("/analytics-settings")
async def save_analytics_settings(request: Request, client_id: str, assistant_id: Optional[str] = None, active_assistant_id: Optional[str] = None, token_data: dict = Depends(verify_token)):
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    target_id = client_id if client_id != 'default' else 'mitia_assistant'
    payload = await request.json()

    mode_raw = (payload or {}).get("mode")
    mode = str(mode_raw).strip().lower() if mode_raw is not None else ""
    if mode not in {"assistant", "operator"}:
        mode = None

    period_raw = (payload or {}).get("period")
    period = str(period_raw).strip().lower() if period_raw is not None else ""
    if period not in {"today", "yesterday", "week", "month", "quarter", "year"}:
        period = None

    assistant_filter_raw = (payload or {}).get("assistant_filter")
    assistant_filter = []
    if isinstance(assistant_filter_raw, list):
        assistant_filter = normalize_assistant_filter_values(assistant_filter_list=assistant_filter_raw)

    cfg = await get_client_config(target_id)
    raw = dict(getattr(cfg, "raw", {}) or {})
    analytics = dict(raw.get("analytics") or {})
    analytics["mode"] = mode
    analytics["period"] = period
    raw["analytics"] = analytics

    await save_client_config(target_id, raw)

    settings_scope_assistant_id = str(active_assistant_id or '').strip()
    if settings_scope_assistant_id:
        await save_assistant_config(target_id, settings_scope_assistant_id, {
            "analytics": {
                "assistant_filter": assistant_filter
            }
        })

    return {
        "status": "success",
        "settings": {
            "mode": mode,
            "period": period,
            "assistant_filter": assistant_filter
        }
    }
