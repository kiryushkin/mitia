from datetime import date, datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select, text

from ...services.assistants_service import build_assistant_filter_conditions
from ...services.db_service import AsyncSessionLocal, ChatSession, User, get_metrics_summary
from .deps import verify_token
from .analytics_shared import apply_assistant_filter_sql

router = APIRouter()


@router.get("/metrics")
async def get_metrics(client_id: str, days: int = 7, assistant_id: Optional[str] = None, token_data: dict = Depends(verify_token)):
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    target_id = client_id if client_id != 'default' else 'mitia_assistant'
    metrics = await get_metrics_summary(target_id, assistant_id=assistant_id)
    total_dialogs = metrics["total_dialogs"]
    total_leads = metrics["total_leads"]
    conversion_rate = round((total_leads / total_dialogs * 100), 1) if total_dialogs > 0 else 0
    return {
        "status": "success",
        "total_dialogs": total_dialogs,
        "total_leads": total_leads,
        "conversion_rate": conversion_rate,
    }


@router.get("/visitor-stats")
async def get_visitor_stats(client_id: str, days: int = 7, assistant_id: Optional[str] = None, token_data: dict = Depends(verify_token)):
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    async with AsyncSessionLocal() as db:
        assistant_session_conditions = build_assistant_filter_conditions(ChatSession.assistant_id, assistant_id)
        dates_query = text("""
            WITH RECURSIVE dates AS (
                SELECT CURRENT_DATE - (:days - 1) * INTERVAL '1 day' as date
                UNION ALL
                SELECT date + INTERVAL '1 day'
                FROM dates
                WHERE date < CURRENT_DATE
            )
            SELECT d.date::date as date
            FROM dates d
            ORDER BY d.date ASC
        """)
        date_rows = (await db.execute(dates_query, {"days": days})).mappings().all()

        dialogs_query = (
            select(func.date(ChatSession.start_time).label("date"), func.count().label("dialogs"))
            .where(ChatSession.client_id == client_id, ChatSession.is_deleted == False)
            .group_by(func.date(ChatSession.start_time))
        )
        if assistant_session_conditions:
            dialogs_query = dialogs_query.where(or_(*assistant_session_conditions))
        dialog_rows = (await db.execute(dialogs_query)).mappings().all()
        dialog_map = {str(row.get("date")): int(row.get("dialogs") or 0) for row in dialog_rows}

        lead_params = {"client_id": client_id}
        lead_where_parts = ["client_id = :client_id"]
        lead_where_parts, lead_params = apply_assistant_filter_sql(lead_where_parts, lead_params, assistant_id, "assistant_id")
        lead_sql = "SELECT created_at::date AS date, COUNT(*) AS leads FROM leads WHERE " + " AND ".join(lead_where_parts) + " GROUP BY created_at::date"
        lead_rows = (await db.execute(text(lead_sql), lead_params)).mappings().all()
        lead_map = {str(row.get("date")): int(row.get("leads") or 0) for row in lead_rows}

        stats = []
        for row in date_rows:
            date_key = str(row.get("date"))
            dialogs = dialog_map.get(date_key, 0)
            leads = lead_map.get(date_key, 0)
            stats.append({
                "date": row.get("date"),
                "dialogs": dialogs,
                "leads": leads,
                "humans": dialogs,
                "bots": 0,
            })

    return {"status": "success", "stats": stats}


def _parse_date(value: Optional[str], field_name: str) -> Optional[date]:
    if value is None:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{field_name} must be YYYY-MM-DD") from exc


def _sum_stats(stats: list[Dict[str, Any]]) -> Dict[str, int]:
    fields = (
        "user_msgs", "bot_msgs", "operator_msgs", "total_msgs", "spam_msgs", "bulk_msgs",
        "total_dialogs", "qualified_dialogs", "assistant_dialogs", "operator_dialogs",
        "web_dialogs", "tg_dialogs", "max_dialogs", "vk_dialogs", "email_dialogs", "avito_dialogs",
        "leads", "assistant_leads", "operator_leads", "applications", "handoffs",
    )
    return {field: sum(int(row.get(field) or 0) for row in stats) for field in fields}


def _definitions() -> Dict[str, str]:
    return {
        "date_basis": "Dates are computed by PostgreSQL casts in the reported database timezone.",
        "user_msgs": "User-role messages excluding author_role spam, bulk, and operator; this is demand.",
        "spam_msgs": "User-authored messages whose author_role is spam (excluded from demand).",
        "bulk_msgs": "User-authored messages whose author_role is bulk (excluded from demand).",
        "bot_msgs": "Messages authored as role bot/assistant, excluding author_role operator.",
        "operator_msgs": "Messages with role operator or author_role operator.",
        "total_msgs": "Sum of the actor message classes exposed for the selected mode.",
        "total_dialogs": "Sessions started in the date bucket; in a mode, only sessions participating in that mode.",
        "assistant_dialogs": "Sessions containing at least one actual bot/assistant-authored message.",
        "operator_dialogs": "Sessions containing an operator-authored message or is_operator_mode handoff fact.",
        "leads": "Non-archived lead sessions in total_dialogs; therefore mode leads are participation-scoped.",
        "applications": "Compatibility field: sessions with observed operator involvement (same predicate as operator_dialogs).",
        "handoffs": "Sessions with observed operator involvement: operator message or is_operator_mode handoff fact.",
        "hourly_demand": "User demand excluding spam, bulk, and operator-authored messages, by message time; weekday is ISO Monday=0 through Sunday=6.",
    }


@router.get("/activity-stats")
async def get_activity_stats(
    client_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    statuses: Optional[str] = None,
    platforms: Optional[str] = None,
    mode: Optional[str] = None,
    assistant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token),
):
    if token_data["sub"] != client_id and token_data["sub"] != "admin":
        raise HTTPException(status_code=403, detail="Access denied")

    allowed_statuses = {"unread", "read", "lead", "application", "spam", "archive"}
    allowed_platforms = {"web", "telegram", "max", "vk", "email", "avito"}
    selected_statuses = [value for value in (s.strip().lower() for s in (statuses or "").split(",")) if value in allowed_statuses]
    selected_platforms = [value for value in (p.strip().lower() for p in (platforms or "").split(",")) if value in allowed_platforms]
    selected_mode = (mode or "").strip().lower()
    if selected_mode not in {"assistant", "operator"}:
        selected_mode = ""

    status_predicates = {
        "unread": "cs.is_read = false",
        "read": "cs.is_read = true AND (cs.status = 'new' OR cs.status IS NULL) AND COALESCE(cs.is_archived, false) = false AND cs.is_operator_mode = false",
        "lead": "cs.status = 'lead' AND COALESCE(cs.is_archived, false) = false",
        "application": "cs.is_operator_mode = true AND COALESCE(cs.is_archived, false) = false AND cs.status IS DISTINCT FROM 'archive' AND cs.status IS DISTINCT FROM 'lead'",
        "spam": "cs.status = 'spam'",
        "archive": "COALESCE(cs.is_archived, false) = true OR cs.status = 'archive'",
    }
    platform_expr = """
        COALESCE(NULLIF(cs.metadata_json->>'platform', ''), CASE
            WHEN cs.session_id LIKE 'tg-%' THEN 'telegram'
            WHEN cs.session_id LIKE 'max-%' THEN 'max'
            WHEN cs.session_id LIKE 'vk-%' THEN 'vk'
            WHEN cs.session_id LIKE 'email_%' THEN 'email'
            WHEN cs.session_id LIKE 'avito-%' THEN 'avito'
            ELSE 'web'
        END)
    """
    session_filter_parts = ["cs.client_id = :client_id", "cs.is_deleted = false"]
    if selected_statuses:
        session_filter_parts.append("((" + ") OR (".join(status_predicates[s] for s in selected_statuses) + "))")

    params: dict = {"client_id": client_id}
    session_filter_parts, params = apply_assistant_filter_sql(
        session_filter_parts, params, assistant_id, "cs.assistant_id"
    )
    if selected_platforms:
        placeholders = []
        for index, platform in enumerate(selected_platforms):
            key = f"platform_{index}"
            params[key] = platform
            placeholders.append(f":{key}")
        session_filter_parts.append(f"({platform_expr}) IN ({', '.join(placeholders)})")

    requested_from = _parse_date(date_from, "date_from")
    requested_to = _parse_date(date_to, "date_to")
    if (requested_from is None) != (requested_to is None):
        raise HTTPException(status_code=422, detail="date_from and date_to must be provided together")
    if requested_from and requested_to and requested_from > requested_to:
        requested_from, requested_to = requested_to, requested_from

    mode_session_predicate = {
        "assistant": "sf.has_assistant",
        "operator": "sf.has_operator",
    }.get(selected_mode, "TRUE")
    message_user_predicate = "TRUE" if not selected_mode else "FALSE"
    message_bot_predicate = "TRUE" if selected_mode in {"", "assistant"} else "FALSE"
    message_operator_predicate = "TRUE" if selected_mode in {"", "operator"} else "FALSE"
    session_filters_sql = " AND ".join(session_filter_parts)

    async with AsyncSessionLocal() as db:
        clock = (await db.execute(text(
            "SELECT CURRENT_DATE AS today, CURRENT_TIMESTAMP AS now, current_setting('TIMEZONE') AS timezone"
        ))).mappings().one()
        today = clock["today"]
        if requested_from is None:
            created_date = (await db.execute(
                select(func.date(User.created_at)).where(User.client_id == client_id)
            )).scalar_one_or_none()
            d_from = created_date if isinstance(created_date, date) else today
            d_to = today
        else:
            d_from, d_to = requested_from, min(requested_to, today)

        metadata = {
            "timezone": clock["timezone"],
            "database_now": clock["now"].isoformat(),
            "date_from": d_from.isoformat(),
            "date_to": d_to.isoformat() if d_from <= d_to else None,
            "requested_date_from": requested_from.isoformat() if requested_from else None,
            "requested_date_to": requested_to.isoformat() if requested_to else None,
            "assistant_id": assistant_id,
            "mode": selected_mode or "all",
            "statuses": selected_statuses,
            "platforms": selected_platforms,
            "definitions": _definitions(),
        }
        if d_from > d_to:
            return {
                "status": "success", "stats": [], "totals": _sum_stats([]),
                "hourly_demand": [], "metadata": metadata, "future_range": True,
            }

        params.update({"date_from": d_from, "date_to": d_to})
        ctes = f"""
            WITH dates AS (
                SELECT generate_series(CAST(:date_from AS DATE), CAST(:date_to AS DATE), INTERVAL '1 day')::date AS date
            ),
            filtered_sessions AS (
                SELECT cs.session_id, cs.start_time, cs.status, cs.is_archived, cs.is_operator_mode,
                       {platform_expr} AS platform
                FROM chat_sessions cs
                WHERE {session_filters_sql}
            ),
            session_facts AS (
                SELECT fs.*,
                       EXISTS (
                           SELECT 1 FROM chat_messages am
                           WHERE am.session_id = fs.session_id
                             AND am.role IN ('assistant', 'bot')
                             AND am.author_role IS DISTINCT FROM 'operator'
                       ) AS has_assistant,
                       (COALESCE(fs.is_operator_mode, false) OR EXISTS (
                           SELECT 1 FROM chat_messages om
                           WHERE om.session_id = fs.session_id
                             AND (om.role = 'operator' OR om.author_role = 'operator')
                       )) AS has_operator
                FROM filtered_sessions fs
            )
        """
        daily_query = text(ctes + f"""
            SELECT d.date,
                   COALESCE(m.user_msgs, 0) AS user_msgs,
                   COALESCE(m.bot_msgs, 0) AS bot_msgs,
                   COALESCE(m.operator_msgs, 0) AS operator_msgs,
                   COALESCE(m.total_msgs, 0) AS total_msgs,
                   COALESCE(m.spam_msgs, 0) AS spam_msgs,
                   COALESCE(m.bulk_msgs, 0) AS bulk_msgs,
                   COALESCE(s.total_dialogs, 0) AS total_dialogs,
                   COALESCE(s.qualified_dialogs, 0) AS qualified_dialogs,
                   COALESCE(s.assistant_dialogs, 0) AS assistant_dialogs,
                   COALESCE(s.operator_dialogs, 0) AS operator_dialogs,
                   COALESCE(s.web_dialogs, 0) AS web_dialogs,
                   COALESCE(s.tg_dialogs, 0) AS tg_dialogs,
                   COALESCE(s.max_dialogs, 0) AS max_dialogs,
                   COALESCE(s.vk_dialogs, 0) AS vk_dialogs,
                   COALESCE(s.email_dialogs, 0) AS email_dialogs,
                   COALESCE(s.avito_dialogs, 0) AS avito_dialogs,
                   COALESCE(s.leads, 0) AS leads,
                   COALESCE(s.assistant_leads, 0) AS assistant_leads,
                   COALESCE(s.operator_leads, 0) AS operator_leads,
                   COALESCE(s.applications, 0) AS applications,
                   COALESCE(s.handoffs, 0) AS handoffs
            FROM dates d
            LEFT JOIN (
                SELECT cm.timestamp::date AS date,
                    COUNT(*) FILTER (WHERE {message_user_predicate} AND cm.role = 'user' AND COALESCE(cm.author_role, '') NOT IN ('spam', 'bulk', 'operator')) AS user_msgs,
                    COUNT(*) FILTER (WHERE {message_bot_predicate} AND cm.role IN ('assistant', 'bot') AND cm.author_role IS DISTINCT FROM 'operator') AS bot_msgs,
                    COUNT(*) FILTER (WHERE {message_operator_predicate} AND (cm.role = 'operator' OR cm.author_role = 'operator')) AS operator_msgs,
                    COUNT(*) FILTER (WHERE
                        ({message_user_predicate} AND cm.role = 'user' AND COALESCE(cm.author_role, '') NOT IN ('spam', 'bulk', 'operator')) OR
                        ({message_bot_predicate} AND cm.role IN ('assistant', 'bot') AND cm.author_role IS DISTINCT FROM 'operator') OR
                        ({message_operator_predicate} AND (cm.role = 'operator' OR cm.author_role = 'operator'))
                    ) AS total_msgs,
                    COUNT(*) FILTER (WHERE cm.role = 'user' AND cm.author_role = 'spam') AS spam_msgs,
                    COUNT(*) FILTER (WHERE cm.role = 'user' AND cm.author_role = 'bulk') AS bulk_msgs
                FROM chat_messages cm
                JOIN filtered_sessions fs ON fs.session_id = cm.session_id
                WHERE cm.timestamp::date BETWEEN :date_from AND :date_to
                GROUP BY cm.timestamp::date
            ) m ON m.date = d.date
            LEFT JOIN (
                SELECT sf.start_time::date AS date,
                    COUNT(*) FILTER (WHERE {mode_session_predicate}) AS total_dialogs,
                    COUNT(*) FILTER (WHERE {mode_session_predicate} AND NOT COALESCE(sf.is_archived, false) AND sf.status IS DISTINCT FROM 'spam' AND sf.status IS DISTINCT FROM 'archive') AS qualified_dialogs,
                    COUNT(*) FILTER (WHERE sf.has_assistant) AS assistant_dialogs,
                    COUNT(*) FILTER (WHERE sf.has_operator) AS operator_dialogs,
                    COUNT(*) FILTER (WHERE {mode_session_predicate} AND sf.platform = 'web') AS web_dialogs,
                    COUNT(*) FILTER (WHERE {mode_session_predicate} AND sf.platform = 'telegram') AS tg_dialogs,
                    COUNT(*) FILTER (WHERE {mode_session_predicate} AND sf.platform = 'max') AS max_dialogs,
                    COUNT(*) FILTER (WHERE {mode_session_predicate} AND sf.platform = 'vk') AS vk_dialogs,
                    COUNT(*) FILTER (WHERE {mode_session_predicate} AND sf.platform = 'email') AS email_dialogs,
                    COUNT(*) FILTER (WHERE {mode_session_predicate} AND sf.platform = 'avito') AS avito_dialogs,
                    COUNT(*) FILTER (WHERE {mode_session_predicate} AND sf.status = 'lead' AND NOT COALESCE(sf.is_archived, false)) AS leads,
                    COUNT(*) FILTER (WHERE sf.has_assistant AND sf.status = 'lead' AND NOT COALESCE(sf.is_archived, false)) AS assistant_leads,
                    COUNT(*) FILTER (WHERE sf.has_operator AND sf.status = 'lead' AND NOT COALESCE(sf.is_archived, false)) AS operator_leads,
                    COUNT(*) FILTER (WHERE {mode_session_predicate} AND sf.has_operator AND NOT COALESCE(sf.is_archived, false) AND sf.status IS DISTINCT FROM 'spam' AND sf.status IS DISTINCT FROM 'archive') AS applications,
                    COUNT(*) FILTER (WHERE {mode_session_predicate} AND sf.has_operator AND NOT COALESCE(sf.is_archived, false) AND sf.status IS DISTINCT FROM 'spam' AND sf.status IS DISTINCT FROM 'archive') AS handoffs
                FROM session_facts sf
                WHERE sf.start_time::date BETWEEN :date_from AND :date_to
                GROUP BY sf.start_time::date
            ) s ON s.date = d.date
            ORDER BY d.date
        """)
        hourly_query = text(ctes + """
            SELECT (EXTRACT(ISODOW FROM cm.timestamp)::int - 1) AS weekday,
                   EXTRACT(HOUR FROM cm.timestamp)::int AS hour,
                   COUNT(*) AS user_messages,
                   COUNT(DISTINCT cm.session_id) AS unique_dialogs
            FROM chat_messages cm
            JOIN filtered_sessions fs ON fs.session_id = cm.session_id
            WHERE cm.timestamp::date BETWEEN :date_from AND :date_to
              AND cm.role = 'user'
              AND COALESCE(cm.author_role, '') NOT IN ('spam', 'bulk', 'operator')
            GROUP BY 1, 2
            ORDER BY 1, 2
        """)
        stats = [dict(row) for row in (await db.execute(daily_query, params)).mappings().all()]
        hourly_demand = [dict(row) for row in (await db.execute(hourly_query, params)).mappings().all()]

    return {
        "status": "success",
        "stats": stats,
        "totals": _sum_stats(stats),
        "hourly_demand": hourly_demand,
        "metadata": metadata,
    }
