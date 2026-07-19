import html
import json
import re
from datetime import date, datetime, timedelta
from typing import Optional

from bs4 import BeautifulSoup

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import or_, select, text

from ...core.config import log
from ...services.ai_service import generate_faq
from ...services.assistants_service import build_assistant_filter_conditions
from ...services.cache_service import cache_service
from ...services.clients import get_client_config, list_clients
from ...services.db_service import AICache, AsyncSessionLocal, ChatMessage, ChatSession, get_ai_cache, save_ai_cache
from .analytics_shared import (
    analytics_scope_key,
    day_cache_key,
    empty_snapshot_payload,
    extract_client_analytics_time,
    parse_cache_json,
    rolling_24h_cache_key,
    safe_int,
    snapshot_matches_assistant_filter,
    apply_assistant_filter_sql,
)
from .deps import verify_token

router = APIRouter()


async def get_database_today() -> date:
    async with AsyncSessionLocal() as db:
        clock = (await db.execute(text("SELECT CURRENT_DATE AS today"))).mappings().one()
    return clock["today"]


async def run_ai_analysis_task(
    target_id: str,
    scope_key: str,
    cache_key: str,
    assistant_filter: Optional[str] = None,
):
    try:
        tick_time = datetime.now().replace(second=0, microsecond=0)
        payload = await generate_rolling_24h_payload(target_id, tick_time, assistant_filter=assistant_filter)
        await save_ai_cache(target_id, cache_key, json.dumps(payload))
        await save_ai_cache(target_id, day_cache_key(scope_key, tick_time.date()), json.dumps(payload))
        log.info(f"Background AI analysis completed for {scope_key}")
    except Exception as e:
        log.error(f"Error in background AI analysis: {e}")


async def generate_payload_for_window(
    target_id: str,
    window_from: datetime,
    window_to: datetime,
    range_from: Optional[date] = None,
    range_to: Optional[date] = None,
    assistant_filter: Optional[str] = None,
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
                "generated_at": datetime.now().isoformat(),
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

        return {
            "status": "success",
            "frequent_requests": filtered_requests[:10],
            "date_from": str(from_dt),
            "date_to": str(to_dt),
            "window_from": window_from.isoformat(),
            "window_to": window_to.isoformat(),
            "range_mode": True,
            "generated_at": datetime.now().isoformat(),
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
            "generated_at": datetime.now().isoformat(),
        }


async def generate_range_payload(target_id: str, from_dt: date, to_dt: date, assistant_filter: Optional[str] = None) -> dict:
    window_from = datetime.combine(from_dt, datetime.min.time())
    window_to = datetime.combine(to_dt, datetime.max.time())
    return await generate_payload_for_window(target_id, window_from, window_to, from_dt, to_dt, assistant_filter=assistant_filter)


async def generate_rolling_24h_payload(target_id: str, tick_time: datetime, assistant_filter: Optional[str] = None) -> dict:
    window_to = tick_time.replace(second=0, microsecond=0)
    window_from = window_to - timedelta(hours=24)
    payload = await generate_payload_for_window(
        target_id=target_id,
        window_from=window_from,
        window_to=window_to,
        range_from=window_from.date(),
        range_to=window_to.date(),
        assistant_filter=assistant_filter,
    )
    payload["snapshot_type"] = "rolling_24h"
    payload["cache_day"] = window_to.date().isoformat()
    payload["assistant_filter"] = str(assistant_filter or 'all')
    payload["generated_at"] = datetime.now().isoformat()
    return payload


async def get_day_snapshot(target_id: str, day_dt: date) -> Optional[dict]:
    return parse_cache_json(await get_ai_cache(target_id, day_cache_key(target_id, day_dt)))


def aggregate_day_payloads(payloads: list[dict], from_dt: date, to_dt: date, missing_days: Optional[list[str]] = None) -> dict:
    missing_days = missing_days or []
    if not payloads:
        payload = empty_snapshot_payload(from_dt, to_dt)
        payload["missing_days"] = missing_days
        payload["is_partial"] = bool(missing_days)
        return payload

    freq_totals: dict[str, int] = {}
    for payload in payloads:
        daily_questions: dict[str, int] = {}
        day_freq = payload.get("frequent_requests") if isinstance(payload, dict) else None
        if isinstance(day_freq, list):
            for item in day_freq:
                q = str(item.get("q") or item.get("question") or "").strip()
                if not q:
                    continue
                c = safe_int(item.get("count"), 0)
                if c <= 0:
                    continue
                daily_questions[q] = daily_questions.get(q, 0) + c
        for q, c in daily_questions.items():
            freq_totals[q] = freq_totals.get(q, 0) + c

    return {
        "status": "success",
        "frequent_requests": [{"q": q, "count": c} for q, c in sorted(freq_totals.items(), key=lambda it: it[1], reverse=True)[:10]],
        "date_from": str(from_dt),
        "date_to": str(to_dt),
        "range_mode": True,
        "generated_at": datetime.now().isoformat(),
        "aggregated_from_cache": True,
        "missing_days": missing_days,
        "is_partial": bool(missing_days),
    }


async def precompute_daily_ai_snapshots_for_all_clients(tick_time: Optional[datetime] = None, only_clients: Optional[list[str]] = None):
    tick_dt = (tick_time or datetime.now()).replace(second=0, microsecond=0)
    clients = only_clients or await list_clients()
    for cid in clients:
        try:
            payload = await generate_rolling_24h_payload(cid, tick_dt)
            rolling_key = rolling_24h_cache_key(cid, tick_dt)
            day_key = day_cache_key(cid, tick_dt.date())
            await save_ai_cache(cid, rolling_key, json.dumps(payload))
            await save_ai_cache(cid, day_key, json.dumps(payload))
        except Exception as e:
            log.error(f"Failed to precompute daily AI snapshot for {cid} ({tick_dt.isoformat()}): {e}")


async def collect_due_clients_by_time(now: datetime) -> list[str]:
    due_clients: list[str] = []
    clients = await list_clients()
    for cid in clients:
        try:
            cfg = await get_client_config(cid)
            run_time = extract_client_analytics_time(getattr(cfg, "raw", {}) or {})
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
            due_clients = await collect_due_clients_by_time(tick_time)
            if due_clients:
                await precompute_daily_ai_snapshots_for_all_clients(tick_time, only_clients=due_clients)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.error(f"Daily AI snapshot scheduler error: {e}")
            await asyncio.sleep(300)


_REQUEST_INTENTS = (
    ("Оплата и счета", ("оплат", "платеж", "карт", "счет")),
    ("Доступ к аккаунту", ("аккаунт", "вход", "войти", "доступ")),
    ("Регистрация", ("регистрац", "зарегистр")),
    ("Восстановление пароля", ("парол", "восстанов")),
    ("Настройки аккаунта", ("настрой", "измен")),
    ("Интеграции и API", ("интеграц", "api", "мессенджер")),
    ("Тарифы и стоимость", ("цен", "стоим", "тариф", "скольк")),
    ("Письма и подтверждение", ("письм", "подтвержд", "код")),
)


_REQUEST_STOP_WORDS = {
    "а", "без", "бы", "в", "во", "для", "до", "и", "из", "или", "как", "к", "ли",
    "мне", "мой", "мы", "на", "не", "но", "о", "об", "от", "по", "под", "при", "с",
    "со", "у", "что", "это", "я",
}


def _request_tokens(value: str) -> set[str]:
    words = re.findall(r"[a-zа-яё0-9]+", str(value or "").lower())
    tokens: set[str] = set()
    for word in words:
        if len(word) < 3 or word in _REQUEST_STOP_WORDS:
            continue
        normalized = word
        for suffix in (
            "иями", "ями", "ами", "ого", "ему", "ому", "ыми", "ими", "ией", "ей", "ий",
            "ый", "ой", "ая", "яя", "ое", "ее", "ые", "ие", "ов", "ев", "ам", "ям", "ах",
            "ях", "ом", "ем", "ую", "юю", "ить", "ать", "ять", "ться", "ть", "ы", "и", "а",
            "я", "у", "ю", "е", "о",
        ):
            if len(normalized) - len(suffix) >= 4 and normalized.endswith(suffix):
                normalized = normalized[:-len(suffix)]
                break
        tokens.add(normalized)
    return tokens


def _requests_are_similar(left: set[str], right: set[str]) -> bool:
    if not left or not right:
        return False
    intersection = len(left & right)
    union = len(left | right)
    smaller = min(len(left), len(right))
    return (intersection / union >= 0.55) or (intersection / smaller >= 0.75 and intersection >= 2)


def _request_intent(tokens: set[str]) -> Optional[str]:
    for label, stems in _REQUEST_INTENTS:
        if any(token.startswith(stem) for token in tokens for stem in stems):
            return label
    return None


def _extract_customer_request(content: str) -> str:
    raw = str(content or "").strip()
    if not raw:
        return ""
    if raw.startswith("<"):
        soup = BeautifulSoup(raw, "html.parser")
        email_body = soup.select_one(".email-body")
        raw = (email_body or soup).get_text(" ", strip=True)
    raw = html.unescape(raw)
    raw = re.sub(r"\s+", " ", raw).strip()
    return raw[:2000]


def _normalized_request_key(content: str) -> str:
    normalized = re.sub(r"[^a-zа-яё0-9\s]+", " ", content.lower())
    return re.sub(r"\s+", " ", normalized).strip()


async def get_exact_frequent_requests(
    target_id: str,
    from_dt: date,
    to_dt: date,
    assistant_filter: Optional[str] = None,
) -> list[dict]:
    where_parts = [
        "cs.client_id = :client_id",
        "cs.is_deleted = false",
        "cm.role = 'user'",
        "COALESCE(cm.author_role, '') NOT IN ('spam', 'bulk', 'operator')",
        "cm.timestamp::date BETWEEN :date_from AND :date_to",
        "LENGTH(BTRIM(cm.content)) >= 3",
    ]
    params = {
        "client_id": target_id,
        "date_from": from_dt,
        "date_to": to_dt,
    }
    where_parts, params = apply_assistant_filter_sql(
        where_parts,
        params,
        assistant_filter,
        "cs.assistant_id",
    )
    query = text(f"""
        SELECT cm.session_id, cm.content
        FROM chat_messages cm
        JOIN chat_sessions cs ON cs.session_id = cm.session_id
        WHERE {' AND '.join(where_parts)}
        ORDER BY cm.timestamp ASC, cm.id ASC
    """)
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(query, params)).mappings().all()

    grouped_requests: dict[str, dict] = {}
    ignored_requests = {
        "привет", "здравствуйте", "добрый день", "добрый вечер",
        "спасибо", "благодарю", "ок", "окей", "как дела", "что нового",
        "ты кто", "кто ты",
    }
    for row in rows:
        representative = _extract_customer_request(row.get("content"))
        request_key = _normalized_request_key(representative)
        if len(request_key) < 3 or request_key in ignored_requests:
            continue
        group = grouped_requests.setdefault(request_key, {
            "representative": representative,
            "session_ids": set(),
            "message_count": 0,
        })
        group["session_ids"].add(str(row.get("session_id")))
        group["message_count"] += 1
        if len(representative) < len(group["representative"]):
            group["representative"] = representative

    grouped_requests = {
        key: group for key, group in grouped_requests.items()
        if group["message_count"] <= len(group["session_ids"]) * 20
    }
    source_groups = sorted(
        grouped_requests.items(),
        key=lambda item: (-len(item[1]["session_ids"]), -item[1]["message_count"], item[0]),
    )[:300]

    clusters: list[dict] = []
    intent_clusters: dict[str, dict] = {}
    for request_key, group in source_groups:
        representative = group["representative"]
        tokens = _request_tokens(request_key)
        if len(tokens) < 2:
            continue
        session_ids = set(group["session_ids"])
        message_count = int(group["message_count"])

        intent = _request_intent(tokens)
        if intent:
            cluster = intent_clusters.setdefault(intent, {
                "representative": intent,
                "tokens": set(),
                "session_ids": set(),
                "message_count": 0,
                "is_intent": True,
            })
            cluster["tokens"].update(tokens)
            cluster["session_ids"].update(session_ids)
            cluster["message_count"] += message_count
            continue

        matching_cluster = next(
            (cluster for cluster in clusters if _requests_are_similar(tokens, cluster["tokens"])),
            None,
        )
        if matching_cluster is None:
            clusters.append({
                "representative": representative,
                "tokens": set(tokens),
                "session_ids": session_ids,
                "message_count": message_count,
                "is_intent": False,
            })
            continue

        matching_cluster["tokens"].update(tokens)
        matching_cluster["session_ids"].update(session_ids)
        matching_cluster["message_count"] += message_count
        if len(representative) < len(matching_cluster["representative"]):
            matching_cluster["representative"] = representative

    clusters.extend(intent_clusters.values())
    clusters = [
        cluster for cluster in clusters
        if cluster.get("is_intent") or len(cluster["session_ids"]) >= 2
    ]
    clusters.sort(key=lambda cluster: (
        -len(cluster["session_ids"]),
        -cluster["message_count"],
        cluster["representative"].lower(),
    ))

    result = []
    for cluster in clusters[:10]:
        representative = cluster["representative"]
        if len(representative) > 180:
            representative = representative[:177].rstrip() + "..."
        dialog_count = len(cluster["session_ids"])
        result.append({
            "question": representative,
            "count": dialog_count,
            "dialog_count": dialog_count,
            "message_count": cluster["message_count"],
            "count_unit": "unique_dialogs",
        })
    return result


@router.get("/ai-recommendations")
async def get_ai_recommendations(
    client_id: str,
    background_tasks: BackgroundTasks,
    force: str = "false",
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    assistant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token),
):
    is_force = force.lower() == "true"
    target_id = token_data['sub'] if token_data['sub'] != 'admin' else (client_id if client_id != 'default' else 'mitia_assistant')
    assistant_scope = str(assistant_id or 'all').strip() or 'all'

    today = await get_database_today()

    if date_from and date_to:
        try:
            from_dt = datetime.strptime(date_from, "%Y-%m-%d").date()
            to_dt = datetime.strptime(date_to, "%Y-%m-%d").date()
            if from_dt > to_dt:
                from_dt, to_dt = to_dt, from_dt
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date range format")
    else:
        to_dt = today
        from_dt = to_dt - timedelta(days=29)

    if from_dt > today:
        return {
            "status": "empty",
            "frequent_requests": [],
            "message": "Для выбранной даты данные пока недоступны. Выберите более ранний период.",
            "future_range": True,
            "date_from": str(from_dt),
            "date_to": str(to_dt),
            "count_unit": "unique_dialogs",
            "deterministic": True,
        }
    effective_to_dt = min(to_dt, today)
    frequent_requests = await get_exact_frequent_requests(
        target_id,
        from_dt,
        effective_to_dt,
        assistant_filter=assistant_scope,
    )
    return {
        "status": "success",
        "frequent_requests": frequent_requests,
        "date_from": str(from_dt),
        "date_to": str(effective_to_dt),
        "range_mode": True,
        "generated_at": datetime.now().isoformat(),
        "count_unit": "unique_dialogs",
        "deterministic": True,
        "method": "deterministic_intents_and_token_similarity",
        "excluded_author_roles": ["spam", "bulk", "operator"],
        "future_range": False,
        "missing_days": [],
        "is_partial": False,
        "manual_recalc": is_force,
    }


@router.post("/reindex-site")
async def reindex_site_background(client_id: str, background_tasks: BackgroundTasks, token_data: dict = Depends(verify_token)):
    target_id = token_data['sub'] if token_data['sub'] != 'admin' else client_id
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
    target_id = token_data['sub'] if token_data['sub'] != 'admin' else client_id
    if not cache_service.client:
        return {"status": "success", "count": 0}
    pattern = cache_service._get_key(f"ai_cache:{target_id}:*")
    keys = cache_service.client.keys(pattern)
    return {"status": "success", "count": len(keys)}


@router.post("/cache/clear")
async def clear_ai_cache_admin(client_id: str, token_data: dict = Depends(verify_token)):
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")
    target_id = client_id if client_id != 'default' else 'mitia_assistant'
    cache_service.clear_pattern(f"ai_cache:{target_id}:*")
    log.info(f"AI Cache cleared in Redis for client: {target_id}")
    return {"status": "success", "message": "Кэш успешно очищен"}
