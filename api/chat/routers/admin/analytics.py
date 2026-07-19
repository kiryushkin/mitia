import asyncio
import json
import re
from typing import Optional
from datetime import datetime, timedelta, date

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select, update, text, or_

from ...core.config import (
    TARIFF_RULES,
    MESSAGE_PACK_RULES,
    ASSISTANT_SLOT_PACK_RULES,
    STORAGE_PACK_RULES,
    ASSISTANT_SLOTS_SOFT_CAP,
    ASSISTANT_SLOTS_HARD_CAP,
    ASSISTANT_SLOTS_AVAILABLE_ON_START,
    get_message_pack,
    get_assistant_slot_pack,
    get_storage_pack,
    log,
)
from ...services.assistants_service import get_effective_account_limits

from ...services.db_service import (
    AsyncSessionLocal, ChatSession, ChatMessage, SessionCase, Lead, User, SitePage,
    AICache, get_ai_cache, save_ai_cache, get_user_by_client_id, update_user_balance,
    add_balance_transaction, ensure_messages_period, get_message_quota_state,
    get_storage_usage, get_storage_items, get_storage_file_by_id,
)

from ...services.ai_service import ask_ai, generate_faq
from ...services.cache_service import cache_service
from ...services.clients import list_clients, get_client_config, save_client_config
from ...services.security.access_control import ensure_client_access
from ...services.storage_access import build_storage_file_response
from ...services.assistants_service import build_assistant_filter_conditions, get_assistant_config, save_assistant_config
from ...services.notification_service import notify_tariff_changed, notify_tariff_downgraded, notify_message_pack_purchased, notify_assistant_pack_purchased, notify_storage_pack_purchased
from .deps import verify_token
from .analytics_shared import (
    analytics_scope_key as _analytics_scope_key,
    day_cache_key as _day_cache_key,
    empty_snapshot_payload as _empty_snapshot_payload,
    extract_client_analytics_time as _extract_client_analytics_time,
    extract_snapshot_date_to as _extract_snapshot_date_to,
    normalize_business_data as _normalize_business_data,
    parse_cache_json as _parse_cache_json,
    rolling_24h_cache_key as _rolling_24h_cache_key,
    safe_int as _safe_int,
)
from .analytics_settings import router as analytics_settings_router
from .analytics_activity import router as analytics_activity_router
from .analytics_cases import router as analytics_cases_router
from .analytics_snapshots import router as analytics_snapshots_router

router = APIRouter()
router.include_router(analytics_settings_router)
router.include_router(analytics_activity_router)
router.include_router(analytics_cases_router)
router.include_router(analytics_snapshots_router)


async def run_ai_analysis_task(target_id: str, cache_key: str):
    """Legacy manual analysis task for compatibility."""
    try:
        tick_time = datetime.now().replace(second=0, microsecond=0)
        payload = await _generate_rolling_24h_payload(target_id, tick_time)
        await save_ai_cache(target_id, cache_key, json.dumps(payload))
        await save_ai_cache(target_id, _day_cache_key(target_id, tick_time.date()), json.dumps(payload))
        log.info(f"Background AI analysis completed for {target_id}")
    except Exception as e:
        log.error(f"Error in background AI analysis: {e}")




async def _generate_payload_for_window(
    target_id: str,
    window_from: datetime,
    window_to: datetime,
    range_from: Optional[date] = None,
    range_to: Optional[date] = None,
    assistant_filter: Optional[str] = None
) -> dict:
    try:
        async with AsyncSessionLocal() as db:
            query = (
                select(ChatMessage.role, ChatMessage.content, ChatMessage.timestamp)
                .join(ChatSession, ChatSession.session_id == ChatMessage.session_id)
                .where(
                    ChatSession.client_id == target_id,
                    ChatSession.is_deleted == False,
                    ChatMessage.timestamp >= window_from,
                    ChatMessage.timestamp <= window_to,
                )
                .order_by(ChatMessage.timestamp.asc(), ChatMessage.id.asc())
            )
            assistant_conditions = build_assistant_filter_conditions(ChatSession.assistant_id, assistant_filter)
            if assistant_conditions:
                query = query.where(or_(*assistant_conditions))
            result = await db.execute(query)
            rows = result.all()

        user_only_history = ""
        for r in rows:
            if r.role == 'user' and r.content:
                user_only_history += r.content + "\n"

        user_only_history = user_only_history.strip()
        if len(user_only_history) > 12000:
            user_only_history = user_only_history[-12000:]
            user_only_history = f"...(усечено до последних сообщений)\n{user_only_history}"

        from_dt = range_from or window_from.date()
        to_dt = range_to or window_to.date()

        if len(user_only_history) < 10:
            return {
                "status": "success",
                "frequent_requests": [],
                "date_from": str(from_dt),
                "date_to": str(to_dt),
                "window_from": window_from.isoformat(),
                "window_to": window_to.isoformat(),
                "range_mode": True,
                "generated_at": datetime.now().isoformat()
            }

        frequent_requests, _, _ = await generate_faq(target_id, user_only_history)

        stop_patterns = ['привет', 'здравствуй', 'добрый день', 'добрый вечер', 'спасибо', 'благодарю', 'как дела', 'что нового', 'ты кто', 'кто ты', 'о платформе']
        business_keywords = ['цена', 'стоимость', 'сколько', 'как', 'где', 'когда', 'купить', 'заказать', 'услуг', 'срок', 'доставк', 'оплат', 'гарант']

        filtered_requests = []
        for item in frequent_requests or []:
            q = (item.get('question') or item.get('q') or '').strip()
            q_lower = q.lower()
            if any(p in q_lower for p in stop_patterns) and len(q) < 30:
                continue
            if len(q) < 10 and not any(bk in q_lower for bk in business_keywords):
                continue
            filtered_requests.append(item)

        filtered_top = filtered_requests[:10]

        return {
            "status": "success",
            "frequent_requests": filtered_top,
            "date_from": str(from_dt),
            "date_to": str(to_dt),
            "window_from": window_from.isoformat(),
            "window_to": window_to.isoformat(),
            "range_mode": True,
            "generated_at": datetime.now().isoformat()
        }
    except Exception as e:
        log.error(f"Date-range FAQ analytics failed for {target_id}: {e}")
        return {
            "status": "success",
            "frequent_requests": [],
            "date_from": str(range_from or window_from.date()),
            "date_to": str(range_to or window_to.date()),
            "window_from": window_from.isoformat(),
            "window_to": window_to.isoformat(),
            "range_mode": True,
            "generated_at": datetime.now().isoformat()
        }

async def _generate_range_payload(target_id: str, from_dt: date, to_dt: date, assistant_filter: Optional[str] = None) -> dict:
    window_from = datetime.combine(from_dt, datetime.min.time())
    window_to = datetime.combine(to_dt, datetime.max.time())
    return await _generate_payload_for_window(target_id, window_from, window_to, from_dt, to_dt, assistant_filter=assistant_filter)


async def _generate_rolling_24h_payload(target_id: str, tick_time: datetime, assistant_filter: Optional[str] = None) -> dict:
    window_to = tick_time.replace(second=0, microsecond=0)
    window_from = window_to - timedelta(hours=24)
    payload = await _generate_payload_for_window(
        target_id=target_id,
        window_from=window_from,
        window_to=window_to,
        range_from=window_from.date(),
        range_to=window_to.date(),
        assistant_filter=assistant_filter
    )
    payload["snapshot_type"] = "rolling_24h"
    payload["cache_day"] = window_to.date().isoformat()
    payload["assistant_filter"] = str(assistant_filter or 'all')
    payload["generated_at"] = datetime.now().isoformat()
    return payload


async def _get_day_snapshot(target_id: str, day_dt: date) -> Optional[dict]:
    day_key = _day_cache_key(target_id, day_dt)
    return _parse_cache_json(await get_ai_cache(target_id, day_key))


def _aggregate_day_payloads(payloads: list[dict], from_dt: date, to_dt: date, missing_days: Optional[list[str]] = None) -> dict:
    missing_days = missing_days or []
    if not payloads:
        payload = _empty_snapshot_payload(from_dt, to_dt)
        payload["missing_days"] = missing_days
        payload["is_partial"] = bool(missing_days)
        return payload

    business_by_day = []
    freq_totals: dict[str, int] = {}

    for payload in payloads:
        day_label = payload.get("cache_day") or payload.get("date_from") or payload.get("date_to") or "день"
        
        daily_questions: dict[str, int] = {}

        day_freq = payload.get("frequent_requests") if isinstance(payload, dict) else None
        if isinstance(day_freq, list):
            for item in day_freq:
                q = str(item.get("q") or item.get("question") or "").strip()
                if not q:
                    continue
                c = _safe_int(item.get("count"), 0)
                if c <= 0:
                    continue
                daily_questions[q] = daily_questions.get(q, 0) + c

        for q, c in daily_questions.items():
            freq_totals[q] = freq_totals.get(q, 0) + c

    frequent_requests = [
        {"q": q, "count": c}
        for q, c in sorted(freq_totals.items(), key=lambda it: it[1], reverse=True)[:10]
    ]

    return {
        "status": "success",
        "frequent_requests": frequent_requests,
        "date_from": str(from_dt),
        "date_to": str(to_dt),
        "range_mode": True,
        "generated_at": datetime.now().isoformat(),
        "aggregated_from_cache": True,
        "missing_days": missing_days,
        "is_partial": bool(missing_days)
    }

    return {
        "status": "success",
        "business_data": business_data,
        "business_by_day": business_by_day,
        "date_from": str(from_dt),
        "date_to": str(to_dt),
        "range_mode": True,
        "generated_at": datetime.now().isoformat(),
        "aggregated_from_cache": True,
        "missing_days": missing_days,
        "is_partial": bool(missing_days)
    }


async def precompute_daily_ai_snapshots_for_all_clients(tick_time: Optional[datetime] = None, only_clients: Optional[list[str]] = None):
    tick_dt = (tick_time or datetime.now()).replace(second=0, microsecond=0)
    clients = only_clients or await list_clients()
    for cid in clients:
        try:
            payload = await _generate_rolling_24h_payload(cid, tick_dt)
            rolling_key = _rolling_24h_cache_key(cid, tick_dt)
            day_key = _day_cache_key(cid, tick_dt.date())
            await save_ai_cache(cid, rolling_key, json.dumps(payload))
            await save_ai_cache(cid, day_key, json.dumps(payload))
        except Exception as e:
            log.error(f"Failed to precompute daily AI snapshot for {cid} ({tick_dt.isoformat()}): {e}")


async def _collect_due_clients_by_time(now: datetime) -> list[str]:
    due_clients: list[str] = []
    clients = await list_clients()

    for cid in clients:
        try:
            cfg = await get_client_config(cid)
            run_time = _extract_client_analytics_time(getattr(cfg, "raw", {}) or {})
            hh, mm = run_time.split(":")
            if int(hh) == now.hour and int(mm) == now.minute:
                due_clients.append(cid)
        except Exception as e:
            log.error(f"Failed to resolve analytics time for {cid}: {e}")

    return due_clients


async def daily_ai_snapshot_scheduler_loop(run_initial: bool = True):
    if run_initial:
        try:
            await precompute_daily_ai_snapshots_for_all_clients(datetime.now())
        except Exception as e:
            log.error(f"Daily AI snapshot initial run failed: {e}")

    while True:
        try:
            now = datetime.now()
            next_tick = (now + timedelta(minutes=1)).replace(second=0, microsecond=0)
            sleep_for = max(1, int((next_tick - now).total_seconds()))
            await asyncio.sleep(sleep_for)

            tick_time = datetime.now().replace(second=0, microsecond=0)
            due_clients = await _collect_due_clients_by_time(tick_time)
            if due_clients:
                await precompute_daily_ai_snapshots_for_all_clients(
                    tick_time,
                    only_clients=due_clients
                )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.error(f"Daily AI snapshot scheduler error: {e}")
            await asyncio.sleep(300)


@router.post("/history/{token}/analyze")
async def analyze_conversation(token: str, client_id: str, token_data: dict = Depends(verify_token)):
    """Анализ диалога с помощью ИИ."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ChatMessage.content, ChatMessage.role)
            .where(ChatMessage.session_id == token)
            .order_by(ChatMessage.id)
        )
        rows = result.all()

    if not rows:
        return {"status": "error", "message": "Диалог пуст"}

    history_text = "\n".join([f"{r.role}: {r.content}" for r in rows])

    analysis = await ask_ai([
        {"role": "system", "content": "Ты — эксперт-аналитик. Проанализируй диалог и дай краткое резюме намерений клиента."},
        {"role": "user", "content": history_text}
    ])

    async with AsyncSessionLocal() as db:
        await db.execute(
            update(ChatSession)
            .where(ChatSession.session_id == token, ChatSession.client_id == client_id)
            .values(status='analyzed')
        )
        await db.commit()

    return {"status": "success", "analysis": analysis}


@router.get("/tariffs-pricing")
async def get_tariffs_pricing(token_data: dict = Depends(verify_token)):
    """Единый источник цен тарифов и пакетов для фронтенда.

    Возвращает данные из TARIFF_RULES/*_PACK_RULES, чтобы цены не приходилось
    дублировать в tariffs.js — фронт берёт их отсюда.
    """
    def _fmt(amount) -> str:
        value = float(amount or 0)
        return "Бесплатно" if value <= 0 else f"{int(value):,}".replace(",", "\u00a0") + "\u00a0\u20bd"

    tariffs = {}
    for tariff_id, info in TARIFF_RULES.items():
        month_price = float(info.get('price', 0) or 0)
        year_price = float(info.get('year_price') or month_price * 12)
        tariffs[tariff_id] = {
            'name': info.get('name', tariff_id),
            'month_price': month_price,
            'year_price': year_price,
            'month_label': _fmt(month_price),
            'year_label': _fmt(year_price),
        }

    return {
        'tariffs': tariffs,
        'message_packs': MESSAGE_PACK_RULES,
        'assistant_slot_packs': ASSISTANT_SLOT_PACK_RULES,
        'storage_packs': STORAGE_PACK_RULES,
    }


@router.get("/balance")
async def get_balance(client_id: str, token_data: dict = Depends(verify_token)):
    """Получение текущего баланса, тарифа и остатков сообщений."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.client_id == client_id))
        user = result.scalar_one_or_none()

        if user:
            tariff_key = str(user.tariff_name or 'start').strip().lower() or 'start'
            tariff_info = TARIFF_RULES.get(tariff_key, TARIFF_RULES.get('start'))
            limits = get_effective_account_limits(user)
            messages_limit = limits['messages_limit']
            display_name = tariff_info.get('name', user.tariff_name)
            # Название «Персональный» назначается только суперадмином через флаг
            # is_personal_tariff. Самостоятельные докупки пользователя (сообщения,
            # слоты, хранилище) не меняют название тарифа.
            if bool(getattr(user, 'is_personal_tariff', False)):
                display_name = 'Персональный'
            tariff_assistants_limit = limits['tariff_assistants_limit']
            extra_assistants_purchased = limits['extra_assistants_purchased']
            total_assistants_limit = limits['assistants_limit']
            reset_days = tariff_info.get('reset_period_days', 0)
            user = await ensure_messages_period(user, db, reset_days=reset_days)
            quota = get_message_quota_state(user, messages_limit)
            subscription_expired = bool(
                tariff_key != 'start' and user.tariff_expires_at and user.tariff_expires_at < datetime.now()
            )
            quota_state = 'subscription_expired' if subscription_expired else quota['quota_state']

            return {
                "status": "success",
                "balance": user.balance,
                "tariff": tariff_key,
                "tariff_name": display_name,
                "tariff_expires_at": user.tariff_expires_at.isoformat() if user.tariff_expires_at else None,
                "tariff_billing_period": getattr(user, 'tariff_billing_period', 'month'),
                "messages_consumed": user.messages_consumed,
                "messages_limit": messages_limit,
                "base_messages_limit": int(tariff_info.get('base_limit', 30) or 0),
                "messages_reset_at": user.messages_reset_at.isoformat() if user.messages_reset_at else None,
                "messages_period_started_at": user.messages_period_started_at.isoformat() if user.messages_period_started_at else None,
                "monthly_messages_remaining": quota['base_remaining'],
                "extra_messages_purchased": quota['extra_purchased'],
                "extra_messages_used": quota['extra_used'],
                "extra_messages_remaining": quota['extra_remaining'],
                "messages_total_remaining": quota['total_remaining'],
                "quota_state": quota_state,
                "subscription_active": not subscription_expired,
                "tariff_assistants_limit": tariff_assistants_limit,
                "extra_assistants_purchased": extra_assistants_purchased,
                "assistants_limit": total_assistants_limit,
                "assistants_soft_cap": ASSISTANT_SLOTS_SOFT_CAP,
                "assistants_hard_cap": limits['assistants_hard_cap'],
                "extra_messages_limit": limits['extra_messages_limit'],
                "extra_storage_bytes": limits['extra_storage_bytes'],
                "extra_context_limit": limits['extra_context_limit'],
                "extra_index_pages": limits['extra_index_pages'],
                "extra_assistants_hard_cap": limits['extra_assistants_hard_cap'],
                "assistant_slots_available_on_start": ASSISTANT_SLOTS_AVAILABLE_ON_START,
                "available_message_packs": MESSAGE_PACK_RULES,
                "available_assistant_slot_packs": ASSISTANT_SLOT_PACK_RULES,
                "available_storage_packs": STORAGE_PACK_RULES,
                "auto_renew": user.auto_renew,
                "is_active": user.is_active,
                "created_at": user.created_at.isoformat() if getattr(user, 'created_at', None) else None,
                "used_storage": user.used_storage,
                "storage_limit": limits['storage_limit'],
                "storage_plan_pack_id": limits['storage_plan_pack_id'],
                "context_limit": limits['context_limit'],
                "max_index_pages": limits['max_index_pages']
            }

    return {
        "status": "success",
        "balance": 0,
        "tariff": "start",
        "tariff_name": "Старт",
        "messages_consumed": 0,
        "is_active": True,
        "created_at": None,
        "tariff_assistants_limit": TARIFF_RULES['start'].get('assistants_limit', 1),
        "extra_assistants_purchased": 0,
        "assistants_limit": TARIFF_RULES['start'].get('assistants_limit', 1),
        "assistants_soft_cap": ASSISTANT_SLOTS_SOFT_CAP,
        "assistants_hard_cap": ASSISTANT_SLOTS_HARD_CAP,
        "assistant_slots_available_on_start": ASSISTANT_SLOTS_AVAILABLE_ON_START,
        "available_message_packs": MESSAGE_PACK_RULES,
        "available_assistant_slot_packs": ASSISTANT_SLOT_PACK_RULES,
        "available_storage_packs": STORAGE_PACK_RULES,
        "storage_plan_pack_id": None,
    }


@router.get("/storage-usage")
async def get_storage_usage_endpoint(
    client_id: str,
    category: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    token_data: dict = Depends(verify_token)
):
    """Детализация хранилища: по категориям, по типам, текст, список файлов."""
    target_client_id = ensure_client_access(token_data, client_id)

    usage = await get_storage_usage(target_client_id)
    files = await get_storage_items(
        target_client_id,
        category=category,
        limit=limit,
        offset=offset,
        include_download_url=True
    )
    items = files

    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.client_id == target_client_id))).scalar_one_or_none()
        limits = get_effective_account_limits(user) if user else {"storage_limit": 1 * 1024 * 1024 * 1024}

    return {
        "status": "success",
        "summary": usage["by_category"],
        "by_type": usage["by_type"],
        "files_total": usage["files_total"],
        "text_total": usage["text_total"],
        "text_breakdown": usage["text_breakdown"],
        "storage_limit": limits['storage_limit'],
        "files": files,
        "items": items
    }


@router.get("/storage-file/{item_id}/download")
async def download_storage_file(
    item_id: int,
    client_id: str,
    token_data: dict = Depends(verify_token)
):
    token_sub = token_data.get("sub")
    try:
        target_client_id = ensure_client_access(token_data, client_id)
    except HTTPException:
        log.warning(
            "[STORAGE_AUDIT] download denied: reason=forbidden tenant=%s user=%s item=%s",
            client_id,
            token_sub,
            item_id
        )
        raise

    file_item = await get_storage_file_by_id(target_client_id, item_id)
    if not file_item:
        log.warning(
            "[STORAGE_AUDIT] download denied: reason=not_found tenant=%s user=%s item=%s",
            target_client_id,
            token_sub,
            item_id
        )
        raise HTTPException(status_code=404, detail="File not found")

    try:
        response = build_storage_file_response(file_item.file_path or "", file_item.file_name)
        log.info(
            "[STORAGE_AUDIT] download success tenant=%s user=%s item=%s path=%s",
            target_client_id,
            token_sub,
            item_id,
            file_item.file_path
        )
        return response
    except HTTPException as exc:
        log.warning(
            "[STORAGE_AUDIT] download denied: reason=%s tenant=%s user=%s item=%s",
            exc.status_code,
            target_client_id,
            token_sub,
            item_id
        )
        raise


@router.post("/change-tariff")
async def change_tariff(client_id: str, request: Request, token_data: dict = Depends(verify_token)):
    """Смена тарифного плана клиента."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    data = await request.json()
    new_tariff = data.get('tariff')
    billing_period = str(data.get('billing_period') or 'month').strip().lower()

    if new_tariff not in TARIFF_RULES:
        raise HTTPException(status_code=400, detail="Invalid tariff name")
    if billing_period not in {'month', 'year'}:
        raise HTTPException(status_code=400, detail="Invalid billing period")

    tariff_info = TARIFF_RULES[new_tariff]
    base_tariff_price = tariff_info.get('price', 0)
    # Годовая цена берётся из тарифа (со скидкой, как показано в интерфейсе),
    # а не price*12. Fallback на price*12, если year_price не задан.
    if new_tariff != 'start' and billing_period == 'year':
        tariff_price = tariff_info.get('year_price') or base_tariff_price * 12
    else:
        tariff_price = base_tariff_price
    tariff_name_ru = tariff_info.get('name', new_tariff)

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.client_id == client_id))
        user = result.scalar_one_or_none()

        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        current_period = str(getattr(user, 'tariff_billing_period', 'month') or 'month')
        if user.tariff_name == new_tariff and (new_tariff == 'start' or current_period == billing_period):
            return {"status": "error", "message": f"Этот тариф уже активен, менять ничего не нужно."}

        if tariff_price > 0:
            if user.balance < tariff_price:
                return JSONResponse(
                    status_code=400,
                    content={"status": "error", "message": f"Недостаточно средств. На балансе не хватает денег для смены тарифа «{tariff_name_ru}»."}
                )
            user.balance -= tariff_price
            period_days = 365 if billing_period == 'year' else 30
            user.tariff_expires_at = datetime.now() + timedelta(days=period_days)
        else:
            user.tariff_expires_at = None

        previous_tariff = str(user.tariff_name or 'start').lower()
        if previous_tariff == 'start' and new_tariff != 'start':
            user.start_trial_messages_used = max(
                int(getattr(user, 'start_trial_messages_used', 0) or 0),
                int(user.messages_consumed or 0),
            )
        user.tariff_name = new_tariff
        user.tariff_billing_period = billing_period if new_tariff != 'start' else 'month'
        user.is_personal_tariff = False
        # Leaving a paid tariff burns its included-period remainder. The one-time
        # Start trial and separately purchased packs remain available.
        user.messages_consumed = (
            int(getattr(user, 'start_trial_messages_used', 0) or 0)
            if new_tariff == 'start' and previous_tariff != 'start'
            else 0
        )
        # Extra message packs are paid separately and survive tariff changes.
        user.messages_period_started_at = datetime.now()
        reset_days = int(tariff_info.get('reset_period_days', 0) or 0)
        user.messages_reset_at = (
            datetime.now() + timedelta(days=reset_days)
            if reset_days > 0 else None
        )
        await db.commit()

    if tariff_price > 0:
        period_label = 'год' if billing_period == 'year' else 'месяц'
        await add_balance_transaction(
            client_id=client_id,
            amount=-float(tariff_price),
            source='tariff',
            description=f"Смена тарифа на «{tariff_name_ru}» ({period_label})"
        )

    if new_tariff == 'start' and previous_tariff != 'start':
        await notify_tariff_downgraded(client_id, previous_tariff, manual=True)
    else:
        await notify_tariff_changed(
            client_id,
            tariff_name_ru,
            billing_period=billing_period,
            expires_at=user.tariff_expires_at,
        )

    return {
        "status": "success",
        "message": "Новый тариф сохранён и уже активен.",
        "tariff": new_tariff,
        "billing_period": billing_period,
        "charged_amount": tariff_price,
        "balance": user.balance,
        "tariff_expires_at": user.tariff_expires_at.isoformat() if user.tariff_expires_at else None,
    }


@router.post("/purchase-message-pack")
async def purchase_message_pack(client_id: str, request: Request, token_data: dict = Depends(verify_token)):
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    data = await request.json()
    pack_id = str(data.get('pack_id') or '').strip()
    if not pack_id:
        raise HTTPException(status_code=400, detail="pack_id is required")

    pack = get_message_pack(pack_id)
    if not pack:
        return JSONResponse(
            status_code=400,
            content={"status": "error", "message": "Этот вариант докупки больше недоступен. Обновите страницу и выберите другой пакет."}
        )

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.client_id == client_id))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        tariff_info = TARIFF_RULES.get(user.tariff_name, TARIFF_RULES['start'])
        user = await ensure_messages_period(user, db, reset_days=tariff_info.get('reset_period_days', 0))
        pack_price = float(pack.get('price') or 0)
        pack_messages = int(pack.get('messages') or 0)

        if user.balance < pack_price:
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "Для покупки этого пакета нужно пополнить баланс."}
            )

        user.balance -= pack_price
        user.extra_messages_purchased = int(user.extra_messages_purchased or 0) + pack_messages
        await db.commit()
        await db.refresh(user)
        quota = get_message_quota_state(user, tariff_info.get('base_limit', 30))

    await add_balance_transaction(
        client_id=client_id,
        amount=-pack_price,
        source='message_pack',
        description=f"Покупка пакета «{pack.get('label')}»"
    )
    await notify_message_pack_purchased(client_id, str(pack.get('label') or 'Пакет сообщений'))

    return {
        "status": "success",
        "message": "Дополнительные сообщения уже добавлены к вашему лимиту.",
        "pack_id": pack_id,
        "balance": user.balance,
        "extra_messages_purchased": quota['extra_purchased'],
        "extra_messages_used": quota['extra_used'],
        "extra_messages_remaining": quota['extra_remaining'],
        "messages_total_remaining": quota['total_remaining']
    }


@router.post("/purchase-storage-pack")
async def purchase_storage_pack(client_id: str, request: Request, token_data: dict = Depends(verify_token)):
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    data = await request.json()
    pack_id = str(data.get('pack_id') or '').strip()
    if not pack_id:
        raise HTTPException(status_code=400, detail="pack_id is required")

    pack = get_storage_pack(pack_id)
    if not pack:
        return JSONResponse(status_code=400, content={"status": "error", "message": "Этот пакет хранилища больше недоступен. Обновите страницу и выберите другой вариант."})

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.client_id == client_id))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        monthly_price = float(pack.get('monthly_price') or 0)
        if monthly_price <= 0:
            return JSONResponse(status_code=400, content={"status": "error", "message": "Некорректный пакет хранилища."})

        user.extra_storage_purchased_bytes = int(pack.get('bytes') or 0)
        user.storage_plan_pack_id = str(pack.get('pack_id') or '') or None
        await db.commit()
        await db.refresh(user)
        limits = get_effective_account_limits(user)

    await notify_storage_pack_purchased(client_id, str(pack.get('label') or 'Пакет хранилища'))

    return {
        "status": "success",
        "message": "Расширение хранилища уже включено и будет учитываться при следующем ежемесячном продлении.",
        "pack_id": pack_id,
        "monthly_price": monthly_price,
        "balance": user.balance,
        "storage_limit": limits['storage_limit'],
        "extra_storage_purchased_bytes": limits['extra_storage_purchased_bytes'],
        "storage_plan_pack_id": limits['storage_plan_pack_id'],
    }


@router.post("/cancel-storage-pack")
async def cancel_storage_pack(client_id: str, token_data: dict = Depends(verify_token)):
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.client_id == client_id))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        user.extra_storage_purchased_bytes = 0
        user.storage_plan_pack_id = None
        await db.commit()
        await db.refresh(user)
        limits = get_effective_account_limits(user)

    return {
        "status": "success",
        "message": "Расширение хранилища отключено. Если текущее использование выше тарифного лимита, новые файлы и вложения будут заблокированы, пока вы не освободите место или не подключите новое расширение.",
        "storage_limit": limits['storage_limit'],
        "extra_storage_purchased_bytes": limits['extra_storage_purchased_bytes'],
        "storage_plan_pack_id": limits['storage_plan_pack_id'],
    }


@router.post("/purchase-assistant-pack")
async def purchase_assistant_pack(client_id: str, request: Request, token_data: dict = Depends(verify_token)):
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    data = await request.json()
    pack_id = str(data.get('pack_id') or '').strip()
    if not pack_id:
        raise HTTPException(status_code=400, detail="pack_id is required")

    pack = get_assistant_slot_pack(pack_id)
    if not pack:
        return JSONResponse(
            status_code=400,
            content={"status": "error", "message": "Этот пакет ассистентов больше недоступен. Обновите страницу и выберите другой вариант."}
        )

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.client_id == client_id))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        tariff_key = str(user.tariff_name or 'start').strip().lower() or 'start'
        if tariff_key == 'start' and not ASSISTANT_SLOTS_AVAILABLE_ON_START:
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "На тарифе «Старт» покупка дополнительных слотов пока недоступна."}
            )

        tariff_info = TARIFF_RULES.get(tariff_key, TARIFF_RULES['start'])
        limits = get_effective_account_limits(user)
        tariff_assistants_limit = limits['tariff_assistants_limit']
        current_extra = int(getattr(user, 'extra_assistants_purchased', 0) or 0)
        current_total = limits['assistants_limit']
        assistants_hard_cap = limits['assistants_hard_cap']
        slots_to_add = int(pack.get('slots') or 0)
        target_total = current_total + slots_to_add
        pack_price = float(pack.get('price') or 0)

        if current_total >= assistants_hard_cap:
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": f"Для этого аккаунта уже достигнут технический предел — {assistants_hard_cap} ассистентов."}
            )

        if target_total > assistants_hard_cap:
            available_to_hard_cap = max(assistants_hard_cap - current_total, 0)
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": f"Этот пакет превышает технический предел аккаунта. Сейчас можно добавить ещё только {available_to_hard_cap} ассистентов."}
            )

        if user.balance < pack_price:
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "Для покупки этого пакета ассистентов нужно пополнить баланс."}
            )

        user.balance -= pack_price
        user.extra_assistants_purchased = current_extra + slots_to_add
        await db.commit()
        await db.refresh(user)
        total_limit = min(tariff_assistants_limit + int(user.extra_assistants_purchased or 0), assistants_hard_cap)

    await add_balance_transaction(
        client_id=client_id,
        amount=-pack_price,
        source='assistant_slot_pack',
        description=f"Покупка пакета слотов «{pack.get('label')}»"
    )
    await notify_assistant_pack_purchased(client_id, str(pack.get('label') or 'Пакет слотов'))

    message = "Постоянные слоты ассистентов уже добавлены к вашему аккаунту."
    if total_limit >= ASSISTANT_SLOTS_SOFT_CAP:
        message = f"Постоянные слоты уже добавлены. У аккаунта высокий лимит ({total_limit}), при росте списка ассистентов может понадобиться дополнительная настройка UX."

    return {
        "status": "success",
        "message": message,
        "pack_id": pack_id,
        "balance": user.balance,
        "tariff_assistants_limit": tariff_assistants_limit,
        "extra_assistants_purchased": int(user.extra_assistants_purchased or 0),
        "assistants_limit": total_limit,
        "assistants_soft_cap": ASSISTANT_SLOTS_SOFT_CAP,
        "assistants_hard_cap": assistants_hard_cap,
    }




@router.get("/ai-recommendations")
async def get_ai_recommendations(
    client_id: str,
    background_tasks: BackgroundTasks,
    force: str = "false",
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    assistant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token)
):
    is_force = force.lower() == "true"

    if token_data['sub'] != 'admin':
        target_id = token_data['sub']
    else:
        target_id = client_id if client_id != 'default' else 'mitia_assistant'

    assistant_scope = str(assistant_id or 'all').strip() or 'all'
    scope_key = _analytics_scope_key(target_id, assistant_scope)

    async def get_last_cached_snapshot() -> Optional[dict]:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
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
            raw = result.scalar_one_or_none()
        return _parse_cache_json(raw)

    if is_force:
        cache_key = _rolling_24h_cache_key(scope_key, datetime.now())
        background_tasks.add_task(run_ai_analysis_task, target_id, cache_key)
        return {
            "status": "processing",
            "message": "Анализ запущен. Дождитесь завершения фоновой задачи.",
            "manual_recalc": True
        }

    if date_from and date_to:
        try:
            from_dt = datetime.strptime(date_from, "%Y-%m-%d").date()
            to_dt = datetime.strptime(date_to, "%Y-%m-%d").date()
            if from_dt > to_dt:
                from_dt, to_dt = to_dt, from_dt
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date range format")

        today = datetime.now().date()
        if from_dt > today:
            return {
                "status": "empty",
                "message": "Для выбранной даты данные пока недоступны. Выберите более ранний период.",
                "future_range": True,
                "missing_days": [],
                "is_partial": False
            }

        effective_to_dt = to_dt if to_dt <= today else today
        if from_dt > effective_to_dt:
            return {
                "status": "empty",
                "message": "Для выбранной даты данные пока недоступны. Выберите более ранний период.",
                "future_range": True,
                "missing_days": [],
                "is_partial": False
            }

        payloads: list[dict] = []
        missing_days: list[str] = []
        day_dt = from_dt
        while day_dt <= effective_to_dt:
            day_payload = await _get_day_snapshot(scope_key, day_dt)
            if isinstance(day_payload, dict):
                payloads.append(day_payload)
            else:
                missing_days.append(day_dt.isoformat())
            day_dt += timedelta(days=1)

        if not payloads:
            last_snapshot = await get_last_cached_snapshot()
            empty_payload = _empty_snapshot_payload(from_dt, effective_to_dt, status="processing" if last_snapshot else "empty")
            empty_payload["missing_days"] = missing_days
            empty_payload["is_partial"] = bool(missing_days)
            empty_payload["future_range"] = False
            if isinstance(last_snapshot, dict):
                empty_payload["last_ready_snapshot_at"] = last_snapshot.get("generated_at")
                if last_snapshot.get("window_from"):
                    empty_payload["last_window_from"] = last_snapshot.get("window_from")
                if last_snapshot.get("window_to"):
                    empty_payload["last_window_to"] = last_snapshot.get("window_to")
            return empty_payload

        payload = _aggregate_day_payloads(payloads, from_dt, effective_to_dt, missing_days=missing_days)
        payload["future_range"] = False
        return payload

    latest_snapshot = await get_last_cached_snapshot()
    if isinstance(latest_snapshot, dict):
        latest_snapshot["aggregated_from_cache"] = True
        latest_snapshot.setdefault("missing_days", [])
        latest_snapshot.setdefault("is_partial", False)
        latest_snapshot.setdefault("future_range", False)
        return latest_snapshot

    return {
        "status": "empty",
        "message": "Срез аналитики пока не подготовлен. Данные появятся после плановой обработки.",
        "aggregated_from_cache": True,
        "missing_days": [],
        "is_partial": False,
        "future_range": False
    }


@router.post("/reindex-site")
async def reindex_site_background(client_id: str, background_tasks: BackgroundTasks, token_data: dict = Depends(verify_token)):
    """Запуск переиндексации сайта в фоновом режиме."""
    target_id = token_data['sub'] if token_data['sub'] != 'admin' else client_id

    from ...services.clients import get_client_config
    from ...services.site_indexer import run_indexer_async

    cfg = await get_client_config(target_id)
    site_url = cfg.raw.get('site_url') or cfg.raw.get('contacts', {}).get('website')

    if not site_url:
        return {"status": "error", "message": "URL сайта не настроен в профиле"}

    if not site_url.startswith('http'):
        site_url = f"https://{site_url}"

    background_tasks.add_task(run_indexer_async, target_id, site_url)

    return {"status": "success", "message": "Индексация запущена в фоновом режиме"}


@router.get("/cache/stats")
async def get_cache_stats(client_id: str, token_data: dict = Depends(verify_token)):
    """Получение статистики кэша из Redis."""
    target_id = token_data['sub'] if token_data['sub'] != 'admin' else client_id

    if not cache_service.client:
        return {"status": "success", "count": 0}

    pattern = cache_service._get_key(f"ai_cache:{target_id}:*")
    keys = cache_service.client.keys(pattern)
    return {"status": "success", "count": len(keys)}


@router.post("/cache/clear")
async def clear_ai_cache_admin(client_id: str, token_data: dict = Depends(verify_token)):
    """Очистка кэша ответов ИИ в Redis."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    target_id = client_id if client_id != 'default' else 'mitia_assistant'
    cache_service.clear_pattern(f"ai_cache:{target_id}:*")
    log.info(f"AI Cache cleared in Redis for client: {target_id}")
    return {"status": "success", "message": "Кэш успешно очищен"}


@router.get("/activity-stats")
async def get_activity_stats(
    client_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    statuses: Optional[str] = None,
    platforms: Optional[str] = None,
    mode: Optional[str] = None,
    assistant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token)
):
    """Единая статистика активности по дням.

    Фильтрация синхронизирована с разделом Диалоги:
    - statuses: unread, read, lead, application, spam, archive (через запятую)
    - platforms: web, telegram, max, vk, email, avito (через запятую)
    - mode: assistant | operator
    """
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    allowed_statuses = {"unread", "read", "lead", "application", "spam", "archive"}
    allowed_platforms = {"web", "telegram", "max", "vk", "email", "avito"}
    allowed_modes = {"assistant", "operator"}

    selected_statuses = [s.strip().lower() for s in (statuses or "").split(",") if s.strip()]
    selected_statuses = [s for s in selected_statuses if s in allowed_statuses]

    selected_platforms = [p.strip().lower() for p in (platforms or "").split(",") if p.strip()]
    selected_platforms = [p for p in selected_platforms if p in allowed_platforms]

    selected_mode = (mode or "").strip().lower()
    if selected_mode not in allowed_modes:
        selected_mode = ""

    status_predicates = {
        "unread": "(cs.is_read = false)",
        "read": "(cs.is_read = true AND (cs.status = 'new' OR cs.status IS NULL) AND COALESCE(cs.is_archived, false) = false AND cs.is_operator_mode = false)",
        "lead": "(cs.status = 'lead' AND COALESCE(cs.is_archived, false) = false)",
        "application": "(cs.is_operator_mode = true AND COALESCE(cs.is_archived, false) = false AND cs.status IS DISTINCT FROM 'archive' AND cs.status IS DISTINCT FROM 'lead')",
        "spam": "(cs.status = 'spam')",
        "archive": "(COALESCE(cs.is_archived, false) = true OR cs.status = 'archive')",
    }

    platform_expr = """
        COALESCE(
            NULLIF(cs.metadata_json->>'platform', ''),
            CASE
                WHEN cs.session_id LIKE 'tg-%' THEN 'telegram'
                WHEN cs.session_id LIKE 'max-%' THEN 'max'
                WHEN cs.session_id LIKE 'vk-%' THEN 'vk'
                WHEN cs.session_id LIKE 'email_%' THEN 'email'
                WHEN cs.session_id LIKE 'avito-%' THEN 'avito'
                ELSE 'web'
            END
        )
    """

    session_filter_parts = ["cs.client_id = :client_id", "cs.is_deleted = false"]

    if selected_mode == "operator":
        session_filter_parts.append("cs.is_operator_mode = true")
    elif selected_mode == "assistant":
        session_filter_parts.append("cs.is_operator_mode = false")

    if selected_statuses:
        session_filter_parts.append("(" + " OR ".join(status_predicates[s] for s in selected_statuses) + ")")

    params: dict = {"client_id": client_id}

    normalized_assistant_filter = _normalize_assistant_filter_values(assistant_id)
    if normalized_assistant_filter:
        include_main = 'main' in normalized_assistant_filter
        filtered_parts = [part for part in normalized_assistant_filter if part != 'main']
        if filtered_parts and include_main:
            session_filter_parts.append("(cs.assistant_id = ANY(:assistant_ids) OR cs.assistant_id IS NULL)")
            params["assistant_ids"] = filtered_parts + ['main']
        elif filtered_parts:
            session_filter_parts.append("cs.assistant_id = ANY(:assistant_ids)")
            params["assistant_ids"] = filtered_parts
        elif include_main:
            session_filter_parts.append("(cs.assistant_id = 'main' OR cs.assistant_id IS NULL)")

    if selected_platforms:
        platform_placeholders = []
        for i, p in enumerate(selected_platforms):
            key = f"platform_{i}"
            params[key] = p
            platform_placeholders.append(f":{key}")
        session_filter_parts.append(f"({platform_expr}) IN (" + ", ".join(platform_placeholders) + ")")

    session_filters_sql = " AND ".join(session_filter_parts)

    async with AsyncSessionLocal() as db:
        today = datetime.now().date()

        if date_from and date_to:
            # Конвертируем строки в объекты date для asyncpg
            try:
                d_from = datetime.strptime(date_from, '%Y-%m-%d').date()
                d_to = datetime.strptime(date_to, '%Y-%m-%d').date()
            except Exception:
                d_from = date_from
                d_to = date_to

            if d_from > d_to:
                d_from, d_to = d_to, d_from

            # Будущие даты не должны возвращать синтетический ряд.
            if d_from > today:
                return {"status": "success", "stats": [], "future_range": True}

            # Для диапазона, который частично в будущем, обрезаем до сегодня.
            if d_to > today:
                d_to = today

            if d_from > d_to:
                return {"status": "success", "stats": [], "future_range": True}

            date_condition_msgs = "cm.timestamp::date >= :date_from AND cm.timestamp::date <= :date_to"
            date_condition_sessions = "fs.start_time::date >= :date_from AND fs.start_time::date <= :date_to"
            date_condition_leads = "l.created_at::date >= :date_from AND l.created_at::date <= :date_to"
            dates_cte = """
                WITH RECURSIVE dates AS (
                    SELECT CAST(:date_from AS DATE) as date
                    UNION ALL
                    SELECT (date + INTERVAL '1 day')::DATE
                    FROM dates
                    WHERE date < CAST(:date_to AS DATE)
                ),
                filtered_sessions AS (
                    SELECT cs.session_id, cs.start_time, cs.last_time, cs.is_read, cs.status, cs.is_archived, cs.is_operator_mode,
                           """ + platform_expr + """ AS platform
                    FROM chat_sessions cs
                    WHERE """ + session_filters_sql + """
                )
            """
            params.update({"date_from": d_from, "date_to": d_to})
        else:
            created_row = await db.execute(
                select(User.created_at).where(User.client_id == client_id)
            )
            created_at = created_row.scalar_one_or_none()
            if isinstance(created_at, datetime):
                d_from = created_at.date()
            else:
                d_from = today
            d_to = today

            date_condition_msgs = "cm.timestamp::date >= :date_from AND cm.timestamp::date <= :date_to"
            date_condition_sessions = "fs.start_time::date >= :date_from AND fs.start_time::date <= :date_to"
            date_condition_leads = "l.created_at::date >= :date_from AND l.created_at::date <= :date_to"

            dates_cte = """
                WITH RECURSIVE dates AS (
                    SELECT CAST(:date_from AS DATE) as date
                    UNION ALL
                    SELECT (date + INTERVAL '1 day')::DATE
                    FROM dates
                    WHERE date < CAST(:date_to AS DATE)
                ),
                filtered_sessions AS (
                    SELECT cs.session_id, cs.start_time, cs.last_time, cs.is_read, cs.status, cs.is_archived, cs.is_operator_mode,
                           """ + platform_expr + """ AS platform
                    FROM chat_sessions cs
                    WHERE """ + session_filters_sql + """
                )
            """
            params.update({"date_from": d_from, "date_to": d_to})

        query = text(dates_cte + """
            SELECT
                d.date::date as date,
                COALESCE(m.user_msgs, 0) as user_msgs,
                COALESCE(m.bot_msgs, 0) as bot_msgs,
                COALESCE(m.operator_msgs, 0) as operator_msgs,
                COALESCE(m.total_msgs, 0) as total_msgs,
                COALESCE(m.spam_msgs, 0) as spam_msgs,
                COALESCE(m.bulk_msgs, 0) as bulk_msgs,
                COALESCE(s.total_dialogs, 0) as total_dialogs,
                COALESCE(s.qualified_dialogs, 0) as qualified_dialogs,
                COALESCE(s.web_dialogs, 0) as web_dialogs,
                COALESCE(s.tg_dialogs, 0) as tg_dialogs,
                COALESCE(s.max_dialogs, 0) as max_dialogs,
                COALESCE(s.vk_dialogs, 0) as vk_dialogs,
                COALESCE(s.email_dialogs, 0) as email_dialogs,
                COALESCE(s.avito_dialogs, 0) as avito_dialogs,
                COALESCE(l.leads, 0) as leads,
                COALESCE(l.applications, 0) as applications
            FROM dates d
            LEFT JOIN (
                SELECT
                    cm.timestamp::date as date,
                    COUNT(*) FILTER (WHERE cm.role = 'user') as user_msgs,
                    COUNT(*) FILTER (WHERE (cm.role = 'assistant' OR cm.role = 'bot') AND (cm.author_role IS NULL OR cm.author_role != 'operator')) as bot_msgs,
                    COUNT(*) FILTER (WHERE cm.author_role = 'operator' OR cm.role = 'operator') as operator_msgs,
                    COUNT(*) FILTER (
                        WHERE cm.role = 'user'
                           OR ((cm.role = 'assistant' OR cm.role = 'bot') AND (cm.author_role IS NULL OR cm.author_role != 'operator'))
                           OR cm.author_role = 'operator' OR cm.role = 'operator'
                    ) as total_msgs,
                    COUNT(*) FILTER (WHERE cm.role = 'user' AND cm.author_role = 'spam') as spam_msgs,
                    COUNT(*) FILTER (WHERE cm.role = 'user' AND cm.author_role = 'bulk') as bulk_msgs,
                    -- Сообщения по платформам (общие)
                    COUNT(*) FILTER (WHERE fs.platform = 'web') as web_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'telegram') as tg_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'max') as max_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'vk') as vk_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'email') as email_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'avito') as avito_msgs,
                    -- Детальные сообщения (Актор + Платформа)
                    -- WEB
                    COUNT(*) FILTER (WHERE fs.platform = 'web' AND cm.role = 'user') as web_user_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'web' AND (cm.role = 'assistant' OR cm.role = 'bot') AND (cm.author_role IS NULL OR cm.author_role != 'operator')) as web_bot_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'web' AND (cm.author_role = 'operator' OR cm.role = 'operator')) as web_operator_msgs,
                    -- TG
                    COUNT(*) FILTER (WHERE fs.platform = 'telegram' AND cm.role = 'user') as tg_user_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'telegram' AND (cm.role = 'assistant' OR cm.role = 'bot') AND (cm.author_role IS NULL OR cm.author_role != 'operator')) as tg_bot_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'telegram' AND (cm.author_role = 'operator' OR cm.role = 'operator')) as tg_operator_msgs,
                    -- AVITO
                    COUNT(*) FILTER (WHERE fs.platform = 'avito' AND cm.role = 'user') as avito_user_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'avito' AND (cm.role = 'assistant' OR cm.role = 'bot') AND (cm.author_role IS NULL OR cm.author_role != 'operator')) as avito_bot_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'avito' AND (cm.author_role = 'operator' OR cm.role = 'operator')) as avito_operator_msgs,
                    -- EMAIL
                    COUNT(*) FILTER (WHERE fs.platform = 'email' AND cm.role = 'user') as email_user_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'email' AND (cm.role = 'assistant' OR cm.role = 'bot') AND (cm.author_role IS NULL OR cm.author_role != 'operator')) as email_bot_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'email' AND (cm.author_role = 'operator' OR cm.role = 'operator')) as email_operator_msgs,
                    -- VK
                    COUNT(*) FILTER (WHERE fs.platform = 'vk' AND cm.role = 'user') as vk_user_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'vk' AND (cm.role = 'assistant' OR cm.role = 'bot') AND (cm.author_role IS NULL OR cm.author_role != 'operator')) as vk_bot_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'vk' AND (cm.author_role = 'operator' OR cm.role = 'operator')) as vk_operator_msgs,
                    -- MAX
                    COUNT(*) FILTER (WHERE fs.platform = 'max' AND cm.role = 'user') as max_user_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'max' AND (cm.role = 'assistant' OR cm.role = 'bot') AND (cm.author_role IS NULL OR cm.author_role != 'operator')) as max_bot_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'max' AND (cm.author_role = 'operator' OR cm.role = 'operator')) as max_operator_msgs
                FROM chat_messages cm
                JOIN filtered_sessions fs ON cm.session_id = fs.session_id
                WHERE cm.timestamp::date >= CAST(:date_from AS DATE) AND cm.timestamp::date <= CAST(:date_to AS DATE)
                GROUP BY cm.timestamp::date
            ) m ON d.date = m.date
            LEFT JOIN (
                SELECT
                    fs.start_time::date as date,
                    COUNT(*) as total_dialogs,
                    COUNT(*) FILTER (
                        WHERE COALESCE(fs.is_archived, false) = false
                          AND fs.status IS DISTINCT FROM 'spam'
                          AND fs.status IS DISTINCT FROM 'archive'
                    ) as qualified_dialogs,
                    COUNT(*) FILTER (WHERE fs.platform = 'web') as web_dialogs,
                    COUNT(*) FILTER (WHERE fs.platform = 'telegram') as tg_dialogs,
                    COUNT(*) FILTER (WHERE fs.platform = 'max') as max_dialogs,
                    COUNT(*) FILTER (WHERE fs.platform = 'vk') as vk_dialogs,
                    COUNT(*) FILTER (WHERE fs.platform = 'email') as email_dialogs,
                    COUNT(*) FILTER (WHERE fs.platform = 'avito') as avito_dialogs,
                    COUNT(*) FILTER (WHERE fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as leads,
                    COUNT(*) FILTER (WHERE fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as applications,
                    -- Лиды по платформам
                    COUNT(*) FILTER (WHERE fs.platform = 'web' AND fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as web_leads,
                    COUNT(*) FILTER (WHERE fs.platform = 'telegram' AND fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as tg_leads,
                    COUNT(*) FILTER (WHERE fs.platform = 'max' AND fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as max_leads,
                    COUNT(*) FILTER (WHERE fs.platform = 'vk' AND fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as vk_leads,
                    COUNT(*) FILTER (WHERE fs.platform = 'email' AND fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as email_leads,
                    COUNT(*) FILTER (WHERE fs.platform = 'avito' AND fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as avito_leads,
                    -- Заявки по платформам
                    COUNT(*) FILTER (WHERE fs.platform = 'web' AND fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as web_applications,
                    COUNT(*) FILTER (WHERE fs.platform = 'telegram' AND fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as tg_applications,
                    COUNT(*) FILTER (WHERE fs.platform = 'max' AND fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as max_applications,
                    COUNT(*) FILTER (WHERE fs.platform = 'vk' AND fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as vk_applications,
                    COUNT(*) FILTER (WHERE fs.platform = 'email' AND fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as email_applications,
                    COUNT(*) FILTER (WHERE fs.platform = 'avito' AND fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as avito_applications
                FROM filtered_sessions fs
                WHERE fs.start_time::date >= :date_from AND fs.start_time::date <= :date_to
                GROUP BY fs.start_time::date
            ) s ON d.date = s.date
            LEFT JOIN (
                SELECT
                    fs.start_time::date as date,
                    COUNT(*) FILTER (WHERE fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as leads,
                    COUNT(*) FILTER (WHERE fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as applications,
                    -- Лиды по платформам
                    COUNT(*) FILTER (WHERE fs.platform = 'web' AND fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as web_leads,
                    COUNT(*) FILTER (WHERE fs.platform = 'telegram' AND fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as tg_leads,
                    COUNT(*) FILTER (WHERE fs.platform = 'max' AND fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as max_leads,
                    COUNT(*) FILTER (WHERE fs.platform = 'vk' AND fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as vk_leads,
                    COUNT(*) FILTER (WHERE fs.platform = 'email' AND fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as email_leads,
                    COUNT(*) FILTER (WHERE fs.platform = 'avito' AND fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as avito_leads,
                    -- Заявки по платформам
                    COUNT(*) FILTER (WHERE fs.platform = 'web' AND fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as web_applications,
                    COUNT(*) FILTER (WHERE fs.platform = 'telegram' AND fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as tg_applications,
                    COUNT(*) FILTER (WHERE fs.platform = 'max' AND fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as max_applications,
                    COUNT(*) FILTER (WHERE fs.platform = 'vk' AND fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as vk_applications,
                    COUNT(*) FILTER (WHERE fs.platform = 'email' AND fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as email_applications,
                    COUNT(*) FILTER (WHERE fs.platform = 'avito' AND fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as avito_applications
                FROM filtered_sessions fs
                WHERE fs.start_time::date >= :date_from AND fs.start_time::date <= :date_to
                GROUP BY fs.start_time::date
            ) l ON d.date = l.date
            LEFT JOIN (
                SELECT
                    fs.last_time::date as date,
                    COUNT(*) FILTER (WHERE fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as leads,
                    COUNT(*) FILTER (WHERE fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as applications
                FROM filtered_sessions fs
                WHERE fs.last_time::date >= :date_from AND fs.last_time::date <= :date_to
                GROUP BY fs.last_time::date
            ) l_last ON d.date = l_last.date
            ORDER BY d.date ASC
        """)

        result = await db.execute(query, params)
        rows = result.mappings().all()
        stats = [dict(r) for r in rows]

    return {"status": "success", "stats": stats}
