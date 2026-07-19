import json
from datetime import date, datetime
from typing import Optional


def day_cache_key(target_id: str, day_dt: date) -> str:
    return f"dashboard_recs_day_{target_id}_{day_dt.isoformat()}"


def rolling_24h_cache_key(target_id: str, tick_time: datetime) -> str:
    return f"dashboard_recs_24h_{target_id}_{tick_time.strftime('%Y%m%dT%H%M')}"


def safe_int(value, default=0) -> int:
    try:
        return int(float(value))
    except Exception:
        return default


def normalize_assistant_filter_values(
    assistant_filter: Optional[str] = None,
    assistant_filter_list: Optional[list[str]] = None,
) -> list[str]:
    parts: list[str] = []
    if isinstance(assistant_filter_list, list):
        source = assistant_filter_list
    else:
        source = str(assistant_filter or "").split(",")

    for part in source:
        normalized = str(part or "").strip()
        if normalized and normalized not in parts and normalized != "all":
            parts.append(normalized)
    return parts


def analytics_scope_key(client_id: str, assistant_filter: Optional[str]) -> str:
    normalized = sorted(normalize_assistant_filter_values(assistant_filter))
    if not normalized:
        return client_id
    return f"{client_id}::{'|'.join(normalized)}"


def snapshot_matches_assistant_filter(payload: Optional[dict], assistant_filter: Optional[str]) -> bool:
    if not isinstance(payload, dict):
        return False
    expected = sorted(normalize_assistant_filter_values(assistant_filter))
    if not expected:
        return True
    actual = sorted(normalize_assistant_filter_values(payload.get("assistant_filter")))
    return actual == expected


def extract_client_analytics_settings(cfg_raw: Optional[dict]) -> dict:
    base = {
        "mode": None,
        "period": None,
        "faq_view_mode": "summary",
        "assistant_filter": [],
    }
    if not isinstance(cfg_raw, dict):
        return base

    analytics = cfg_raw.get("analytics") or {}
    if not isinstance(analytics, dict):
        return base

    mode_raw = analytics.get("mode")
    mode = str(mode_raw).strip().lower() if mode_raw is not None else ""
    if mode not in {"assistant", "operator"}:
        mode = None

    period_raw = analytics.get("period")
    period = str(period_raw).strip().lower() if period_raw is not None else ""
    if period not in {"today", "yesterday", "week", "month", "quarter", "year"}:
        period = None

    assistant_filter_raw = analytics.get("assistant_filter")
    assistant_filter = []
    if isinstance(assistant_filter_raw, list):
        assistant_filter = normalize_assistant_filter_values(assistant_filter_list=assistant_filter_raw)

    return {
        "mode": mode,
        "period": period,
        "faq_view_mode": "summary",
        "assistant_filter": assistant_filter,
    }


def extract_client_analytics_time(cfg_raw: Optional[dict]) -> str:
    if not isinstance(cfg_raw, dict):
        return "03:10"
    analytics = cfg_raw.get("analytics") or {}
    return str(analytics.get("analysis_time") or "03:10")


def normalize_business_data(data: Optional[dict]) -> dict:
    base = {
        "lost_profit": "Недостаточно данных для расчета упущенной выгоды.",
        "barriers": "Соберите больше диалогов для точной аналитики.",
        "strategy": "Расширьте период анализа и накопите обращения.",
        "sentiment": 70,
        "hot_leads_count": 0,
    }
    if isinstance(data, dict):
        base["lost_profit"] = str(data.get("lost_profit") or base["lost_profit"])
        base["barriers"] = str(data.get("barriers") or base["barriers"])
        base["strategy"] = str(data.get("strategy") or base["strategy"])
        base["sentiment"] = safe_int(data.get("sentiment"), base["sentiment"])
        base["hot_leads_count"] = safe_int(data.get("hot_leads_count"), base["hot_leads_count"])

    base["sentiment"] = max(0, min(100, base["sentiment"]))
    base["hot_leads_count"] = max(0, base["hot_leads_count"])
    return base


def empty_snapshot_payload(from_dt: date, to_dt: date, status: str = "empty") -> dict:
    return {
        "status": status,
        "frequent_requests": [],
        "date_from": str(from_dt),
        "date_to": str(to_dt),
        "range_mode": True,
        "generated_at": datetime.now().isoformat(),
        "aggregated_from_cache": True,
        "missing_days": [],
    }


def parse_cache_json(raw: Optional[str]) -> Optional[dict]:
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def extract_snapshot_date_to(payload: Optional[dict]) -> Optional[date]:
    if not isinstance(payload, dict):
        return None

    date_to_raw = payload.get("date_to")
    if isinstance(date_to_raw, str):
        try:
            return datetime.strptime(date_to_raw, "%Y-%m-%d").date()
        except Exception:
            pass

    window_to_raw = payload.get("window_to")
    if isinstance(window_to_raw, str):
        try:
            return datetime.fromisoformat(window_to_raw).date()
        except Exception:
            pass

    return None


def apply_assistant_filter_sql(
    where_parts: list[str],
    params: dict,
    assistant_id: Optional[str],
    field_name: str,
) -> tuple[list[str], dict]:
    normalized_assistant_filter = normalize_assistant_filter_values(assistant_id)
    if not normalized_assistant_filter:
        return where_parts, params

    include_main = "main" in normalized_assistant_filter
    filtered_parts = [part for part in normalized_assistant_filter if part != "main"]
    if filtered_parts and include_main:
        where_parts.append(f"({field_name} = ANY(:assistant_ids) OR {field_name} IS NULL)")
        params["assistant_ids"] = filtered_parts + ["main"]
    elif filtered_parts:
        where_parts.append(f"{field_name} = ANY(:assistant_ids)")
        params["assistant_ids"] = filtered_parts
    elif include_main:
        where_parts.append(f"({field_name} = 'main' OR {field_name} IS NULL)")
    return where_parts, params
