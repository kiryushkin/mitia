from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from ...services.db_service import AsyncSessionLocal
from .deps import verify_token
from .analytics_shared import apply_assistant_filter_sql

router = APIRouter()


@router.get("/dialog-case-history")
async def get_dialog_case_history(
    client_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    mode: Optional[str] = None,
    assistant_id: Optional[str] = None,
    limit_dialogs: int = 20,
    limit_cases: int = 3,
    token_data: dict = Depends(verify_token)
):
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    selected_mode = (mode or "").strip().lower()
    if selected_mode not in {"assistant", "operator"}:
        selected_mode = ""

    limit_dialogs = max(1, min(limit_dialogs, 100))
    limit_cases = max(1, min(limit_cases, 10))

    params: dict = {
        "client_id": client_id,
        "limit_dialogs": limit_dialogs,
        "limit_cases": limit_cases,
    }
    where_parts = [
        "cs.client_id = :client_id",
        "cs.is_deleted = false",
    ]

    if selected_mode == "operator":
        where_parts.append("cs.is_operator_mode = true")
    elif selected_mode == "assistant":
        where_parts.append("cs.is_operator_mode = false")

    where_parts, params = apply_assistant_filter_sql(where_parts, params, assistant_id, "cs.assistant_id")

    if date_from and date_to:
        try:
            d_from = datetime.strptime(date_from, '%Y-%m-%d').date()
            d_to = datetime.strptime(date_to, '%Y-%m-%d').date()
            if d_from > d_to:
                d_from, d_to = d_to, d_from
            params.update({"date_from": d_from, "date_to": d_to})
            where_parts.append("sc.opened_at::date >= :date_from")
            where_parts.append("sc.opened_at::date <= :date_to")
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date range format")

    where_sql = " AND ".join(where_parts)
    query = text("""
        WITH ranked_cases AS (
            SELECT
                sc.id,
                sc.session_id,
                sc.case_number,
                sc.is_active,
                sc.open_reason,
                sc.close_reason,
                sc.opened_at,
                sc.closed_at,
                ROW_NUMBER() OVER (PARTITION BY sc.session_id ORDER BY sc.case_number DESC, sc.id DESC) AS case_rank,
                MAX(sc.opened_at) OVER (PARTITION BY sc.session_id) AS latest_case_opened
            FROM session_cases sc
            JOIN chat_sessions cs ON cs.session_id = sc.session_id
            WHERE """ + where_sql + """
        ),
        filtered_cases AS (
            SELECT *
            FROM ranked_cases
            WHERE case_rank <= :limit_cases
        ),
        ranked_dialogs AS (
            SELECT
                session_id,
                latest_case_opened,
                ROW_NUMBER() OVER (ORDER BY latest_case_opened DESC, session_id) AS dialog_rank
            FROM (
                SELECT DISTINCT session_id, latest_case_opened
                FROM filtered_cases
            ) d
        )
        SELECT
            fc.session_id,
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
            ) AS platform,
            fc.case_number,
            fc.is_active,
            fc.open_reason,
            fc.close_reason,
            fc.opened_at,
            fc.closed_at,
            rd.latest_case_opened,
            rd.dialog_rank
        FROM filtered_cases fc
        JOIN ranked_dialogs rd ON rd.session_id = fc.session_id
        JOIN chat_sessions cs ON cs.session_id = fc.session_id
        WHERE rd.dialog_rank <= :limit_dialogs
        ORDER BY rd.dialog_rank ASC, fc.case_number ASC
    """)

    async with AsyncSessionLocal() as db:
        result = await db.execute(query, params)
        rows = result.mappings().all()

    dialogs_map: dict[str, dict] = {}
    for row in rows:
        session_id = row.get("session_id")
        if not session_id:
            continue
        if session_id not in dialogs_map:
            latest_case_opened = row.get("latest_case_opened")
            dialogs_map[session_id] = {
                "session_id": session_id,
                "platform": row.get("platform") or "web",
                "latest_case_opened": latest_case_opened.isoformat() if latest_case_opened else None,
                "cases": [],
            }
        opened_at = row.get("opened_at")
        closed_at = row.get("closed_at")
        dialogs_map[session_id]["cases"].append({
            "case_number": row.get("case_number"),
            "is_active": bool(row.get("is_active")),
            "open_reason": row.get("open_reason"),
            "close_reason": row.get("close_reason"),
            "opened_at": opened_at.isoformat() if opened_at else None,
            "closed_at": closed_at.isoformat() if closed_at else None,
        })

    dialogs = sorted(dialogs_map.values(), key=lambda d: d.get("latest_case_opened") or "", reverse=True)
    return {
        "status": "success",
        "dialogs": dialogs,
        "limit_dialogs": limit_dialogs,
        "limit_cases": limit_cases,
    }


@router.get("/close-reasons-analytics")
async def get_close_reasons_analytics(
    client_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    mode: Optional[str] = None,
    assistant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token)
):
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    selected_mode = (mode or "").strip().lower()
    if selected_mode not in {"assistant", "operator"}:
        selected_mode = ""

    params = {"client_id": client_id}
    where_parts = [
        "cs.client_id = :client_id",
        "cs.is_deleted = false",
        "sc.closed_at IS NOT NULL",
    ]

    if selected_mode == "operator":
        where_parts.append("cs.is_operator_mode = true")
    elif selected_mode == "assistant":
        where_parts.append("cs.is_operator_mode = false")

    where_parts, params = apply_assistant_filter_sql(where_parts, params, assistant_id, "cs.assistant_id")

    if date_from and date_to:
        try:
            d_from = datetime.strptime(date_from, '%Y-%m-%d').date()
            d_to = datetime.strptime(date_to, '%Y-%m-%d').date()
            if d_from > d_to:
                d_from, d_to = d_to, d_from
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date range format")
    else:
        bounds_query = text("""
            SELECT
                MIN(sc.closed_at::date) AS min_date,
                MAX(sc.closed_at::date) AS max_date
            FROM session_cases sc
            JOIN chat_sessions cs ON cs.session_id = sc.session_id AND cs.client_id = sc.client_id
            WHERE """ + " AND ".join(where_parts) + """
        """)
        async with AsyncSessionLocal() as db:
            bounds_row = (await db.execute(bounds_query, params)).mappings().first() or {}
        min_date = bounds_row.get("min_date")
        max_date = bounds_row.get("max_date")
        if not min_date or not max_date:
            today = datetime.utcnow().date()
            d_from = today
            d_to = today
        else:
            d_from = min_date
            d_to = max_date

    params["date_from"] = d_from
    params["date_to"] = d_to
    where_parts.append("sc.closed_at::date >= :date_from")
    where_parts.append("sc.closed_at::date <= :date_to")
    where_sql = " AND ".join(where_parts)

    base_cte_sql = """
        WITH base AS (
            SELECT
                sc.close_reason,
                sc.closed_at::date AS closed_date,
                CASE
                    WHEN sc.close_reason IN ('manual_archive', 'auto_reopened') THEN 'system'
                    WHEN sc.close_reason IS NULL OR btrim(sc.close_reason) = '' THEN 'unknown'
                    ELSE 'user'
                END AS reason_type
            FROM session_cases sc
            JOIN chat_sessions cs ON cs.session_id = sc.session_id AND cs.client_id = sc.client_id
            WHERE """ + where_sql + """
        )
    """

    summary_query = text(base_cte_sql + """
        SELECT
            COUNT(*)::int AS total_closed,
            COUNT(*) FILTER (WHERE reason_type = 'user')::int AS total_user,
            COUNT(*) FILTER (WHERE reason_type = 'system')::int AS total_system,
            COUNT(*) FILTER (WHERE reason_type = 'unknown')::int AS total_unknown
        FROM base
    """)
    top_query = text(base_cte_sql + """
        SELECT
            close_reason AS reason,
            COUNT(*)::int AS cnt
        FROM base
        WHERE reason_type = 'user'
        GROUP BY close_reason
        ORDER BY cnt DESC, reason ASC
        LIMIT 10
    """)
    trend_query = text(base_cte_sql + """
        , daily AS (
            SELECT
                closed_date,
                COUNT(*) FILTER (WHERE reason_type = 'user')::int AS user_count,
                COUNT(*) FILTER (WHERE reason_type = 'system')::int AS system_count,
                COUNT(*) FILTER (WHERE reason_type = 'unknown')::int AS unknown_count,
                COUNT(*)::int AS total_count
            FROM base
            GROUP BY closed_date
        )
        SELECT
            gs.d::date AS date,
            COALESCE(d.user_count, 0)::int AS user_count,
            COALESCE(d.system_count, 0)::int AS system_count,
            COALESCE(d.unknown_count, 0)::int AS unknown_count,
            COALESCE(d.total_count, 0)::int AS total_count
        FROM generate_series(CAST(:date_from AS date), CAST(:date_to AS date), interval '1 day') AS gs(d)
        LEFT JOIN daily d ON d.closed_date = gs.d::date
        ORDER BY gs.d ASC
    """)
    system_breakdown_query = text(base_cte_sql + """
        SELECT close_reason AS reason, COUNT(*)::int AS cnt
        FROM base
        WHERE reason_type = 'system'
        GROUP BY close_reason
        ORDER BY cnt DESC, reason ASC
    """)

    async with AsyncSessionLocal() as db:
        summary_row = (await db.execute(summary_query, params)).mappings().first() or {}
        top_rows = (await db.execute(top_query, params)).mappings().all()
        trend_rows = (await db.execute(trend_query, params)).mappings().all()
        system_rows = (await db.execute(system_breakdown_query, params)).mappings().all()

    total_user = int(summary_row.get("total_user") or 0)
    top_user_reasons = []
    for row in top_rows:
        cnt = int(row.get("cnt") or 0)
        reason = row.get("reason") or "—"
        share = round((cnt / total_user) * 100, 2) if total_user > 0 else 0.0
        top_user_reasons.append({"reason": reason, "count": cnt, "share_percent": share})

    trend = []
    for row in trend_rows:
        dt = row.get("date")
        trend.append({
            "date": dt.isoformat() if dt else None,
            "user_count": int(row.get("user_count") or 0),
            "system_count": int(row.get("system_count") or 0),
            "unknown_count": int(row.get("unknown_count") or 0),
            "total_count": int(row.get("total_count") or 0),
        })

    system_breakdown = [{"reason": r.get("reason") or "—", "count": int(r.get("cnt") or 0)} for r in system_rows]
    return {
        "status": "success",
        "range": {"from": d_from.isoformat(), "to": d_to.isoformat()},
        "summary": {
            "total_closed": int(summary_row.get("total_closed") or 0),
            "total_user": total_user,
            "total_system": int(summary_row.get("total_system") or 0),
            "total_unknown": int(summary_row.get("total_unknown") or 0),
        },
        "top_user_reasons": top_user_reasons,
        "system_breakdown": system_breakdown,
        "trend": trend,
    }
