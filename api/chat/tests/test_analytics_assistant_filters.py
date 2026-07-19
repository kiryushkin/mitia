from datetime import date
from pathlib import Path


from unittest.mock import AsyncMock, patch

import pytest
from fastapi import BackgroundTasks

from api.chat.routers.admin.analytics_shared import (
    analytics_scope_key as _analytics_scope_key,
    apply_assistant_filter_sql as _apply_assistant_filter_sql,
    extract_client_analytics_settings as _extract_client_analytics_settings,
    normalize_assistant_filter_values as _normalize_assistant_filter_values,
    snapshot_matches_assistant_filter as _snapshot_matches_assistant_filter,
)
from api.chat.routers.admin import analytics_snapshots


def test_extract_client_analytics_settings_reads_assistant_filter():
    payload = _extract_client_analytics_settings(
        {
            "analytics": {
                "mode": "assistant",
                "period": "week",
                "assistant_filter": ["main", "assistant-a", "assistant-a", "all", ""],
            }
        }
    )

    assert payload["mode"] == "assistant"
    assert payload["period"] == "week"
    assert payload["assistant_filter"] == ["main", "assistant-a"]


def test_normalize_assistant_filter_values_deduplicates_and_drops_all():
    assert _normalize_assistant_filter_values("assistant-b,main,assistant-b,all,") == ["assistant-b", "main"]


@pytest.mark.parametrize(
    ("assistant_filter", "expected"),
    [
        (None, "client-1"),
        ("all", "client-1"),
        ("assistant-a", "client-1::assistant-a"),
        ("assistant-b,assistant-a", "client-1::assistant-a|assistant-b"),
        ("assistant-b,main,assistant-a,assistant-b", "client-1::assistant-a|assistant-b|main"),
    ],
)
def test_analytics_scope_key_is_stable(assistant_filter, expected):
    assert _analytics_scope_key("client-1", assistant_filter) == expected


def test_empty_assistant_filter_keeps_all_sessions():
    where_parts, params = _apply_assistant_filter_sql(
        ["cs.client_id = :client_id"],
        {"client_id": "client-1"},
        "all",
        "cs.assistant_id",
    )

    assert where_parts == ["cs.client_id = :client_id"]
    assert params == {"client_id": "client-1"}


def test_selected_assistant_filter_limits_sessions():
    where_parts, params = _apply_assistant_filter_sql([], {}, "assistant-new", "cs.assistant_id")

    assert where_parts == ["cs.assistant_id = ANY(:assistant_ids)"]
    assert params == {"assistant_ids": ["assistant-new"]}


def test_activity_chart_request_includes_assistant_filter():
    source = Path("api/chat/static/js/modules/profile-activity-chart.js").read_text()

    assert "qp.set('assistant_id', assistantIds.length ? assistantIds.join(',') : 'all');" in source


def test_activity_contract_uses_authors_and_real_hourly_demand():
    source = Path("api/chat/routers/admin/analytics_activity.py").read_text()

    assert "cm.author_role IS DISTINCT FROM 'operator'" in source
    assert "cm.role = 'operator' OR cm.author_role = 'operator'" in source
    assert "COALESCE(cm.author_role, '') NOT IN ('spam', 'bulk', 'operator')" in source
    assert "EXTRACT(ISODOW FROM cm.timestamp)" in source
    assert "sf.has_operator AND NOT COALESCE(sf.is_archived, false)" in source
    assert "cs.is_operator_mode = true" not in source[source.index("session_filter_parts ="):source.index("params: dict")]


def test_frontend_uses_labeled_noninteractive_demo_charts_and_escapes_faq_html():
    profile_source = Path("api/chat/static/js/modules/profile-activity-chart.js").read_text()
    funnel_source = Path("api/chat/static/js/modules/analytics-funnel.js").read_text()
    shared_source = Path("api/chat/static/js/modules/analytics-shared.js").read_text()

    assert "buildPlaceholderValues" in profile_source
    assert "buildDemoSeries" in funnel_source
    assert "tooltip: isPlaceholder ? { enabled: false }" in funnel_source
    assert "Данные появятся после первых диалогов" in profile_source
    assert "Данные появятся после первых диалогов" in funnel_source
    assert "activity-demand-heatmap" in profile_source
    assert "const isDetailed = Boolean(card?.classList.contains('is-expanded'));" in profile_source
    assert "window.setTimeout(rerender, 180);" in profile_source
    assert "if (!isCurrent()) return;" in profile_source
    assert "_analyticsRequestGeneration" in Path("api/chat/static/js/analytics.js").read_text()
    assert ".replace(/</g, '<')" in shared_source
    assert ".replace(/>/g, '>')" in shared_source


def test_exact_voice_of_customer_contract_excludes_noise_and_ai_counts():
    source = Path("api/chat/routers/admin/analytics_snapshots.py").read_text()
    endpoint_source = source[source.index("@router.get(\"/ai-recommendations\")"):]

    assert "BeautifulSoup(raw, \"html.parser\")" in source
    assert "group[\"message_count\"] <= len(group[\"session_ids\"]) * 20" in source
    assert "len(cluster[\"session_ids\"]) >= 2" in source
    assert "_request_intent" in source
    assert "_requests_are_similar" in source
    assert "COALESCE(cm.author_role, '') NOT IN ('spam', 'bulk', 'operator')" in source
    assert "generate_faq(" not in endpoint_source
    assert "get_day_snapshot(" not in endpoint_source


def test_scoped_snapshot_rejects_previously_misfiled_global_payload():
    assert not _snapshot_matches_assistant_filter(
        {"assistant_filter": "all", "frequent_requests": [{"q": "Общий вопрос", "count": 5}]},
        "assistant-new",
    )
    assert _snapshot_matches_assistant_filter(
        {"assistant_filter": "assistant-new"},
        "assistant-new",
    )
    assert _snapshot_matches_assistant_filter({"frequent_requests": []}, "all")


@pytest.mark.asyncio
async def test_force_recommendations_uses_same_exact_count_without_background_task():
    background_tasks = BackgroundTasks()
    exact_rows = [{
        "question": "Какая стоимость?",
        "count": 2,
        "dialog_count": 2,
        "message_count": 3,
        "count_unit": "unique_dialogs",
    }]

    with patch.object(analytics_snapshots, "get_database_today", AsyncMock(return_value=date(2026, 1, 2))):
        with patch.object(
            analytics_snapshots,
            "get_exact_frequent_requests",
            AsyncMock(return_value=exact_rows),
        ) as get_exact:
            response = await analytics_snapshots.get_ai_recommendations(
                client_id="client-1",
                background_tasks=background_tasks,
                force="true",
                date_from="2026-01-01",
                date_to="2026-01-02",
                assistant_id="assistant-new",
                token_data={"sub": "client-1"},
            )

    get_exact.assert_awaited_once_with(
        "client-1",
        date(2026, 1, 1),
        date(2026, 1, 2),
        assistant_filter="assistant-new",
    )
    assert background_tasks.tasks == []
    assert response["frequent_requests"] == exact_rows
    assert response["deterministic"] is True
    assert response["count_unit"] == "unique_dialogs"
    assert response["manual_recalc"] is True


@pytest.mark.asyncio
async def test_recommendations_do_not_read_legacy_ai_cache():
    with patch.object(analytics_snapshots, "get_database_today", AsyncMock(return_value=date(2026, 1, 2))):
        with patch.object(
            analytics_snapshots,
            "get_exact_frequent_requests",
            AsyncMock(return_value=[]),
        ) as get_exact:
            with patch.object(analytics_snapshots, "get_day_snapshot", AsyncMock()) as legacy_cache:
                response = await analytics_snapshots.get_ai_recommendations(
                    client_id="client-1",
                    background_tasks=BackgroundTasks(),
                    date_from="2026-01-01",
                    date_to="2026-01-02",
                    assistant_id="assistant-new",
                    token_data={"sub": "client-1"},
                )

    get_exact.assert_awaited_once_with(
        "client-1",
        date(2026, 1, 1),
        date(2026, 1, 2),
        assistant_filter="assistant-new",
    )
    legacy_cache.assert_not_awaited()
    assert response["status"] == "success"
    assert response["frequent_requests"] == []
    assert response["missing_days"] == []
    assert response["is_partial"] is False
