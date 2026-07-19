import pytest

from api.chat.services.assistants_service import _sanitize_new_assistant_config, build_assistant_filter_conditions, DEFAULT_ASSISTANT_ID


@pytest.mark.parametrize(
    ("raw_filter", "expected_count"),
    [
        (None, 0),
        ("all", 0),
        ("main", 2),
        ("assistant-a", 1),
        ("assistant-a,assistant-b", 1),
        ("main,assistant-a", 2),
    ],
)
def test_build_assistant_filter_conditions_shapes(raw_filter, expected_count):
    class FakeColumn:
        def in_(self, values):
            return ("in", tuple(values))

        def is_(self, value):
            return ("is", value)

    conditions = build_assistant_filter_conditions(FakeColumn(), raw_filter)
    assert len(conditions) == expected_count


def test_sanitize_new_assistant_config_clears_assistant_specific_fields():
    cfg = _sanitize_new_assistant_config(
        {
            "site_url": "https://old.example.com",
            "sitemap_url": "https://old.example.com/sitemap.xml",
            "indexed_pages": [{"url": "https://old.example.com/page"}],
            "working_hours": {"mon": {"enabled": True}},
            "theme": {"widget_bg_color": "#000000"},
            "integrations": {"telegram": {"enabled": True}},
            "knowledge_file_url": "/uploads/root-knowledge.pdf",
            "knowledge_file_name": "root-knowledge.pdf",
            "ai_unavailable_message": "root fallback",
            "bot_settings": {
                "bot_name": "Old",
                "bot_role": "Role",
                "knowledge_file_url": "/uploads/knowledge.pdf",
                "knowledge_file_name": "knowledge.pdf",
                "fallback_message": "legacy fallback",
                "reserve_answer": "legacy reserve",
                "ai_unavailable_message": "assistant fallback",
            },
        }
    )

    assert cfg["theme"] == {"widget_bg_color": "#000000"}
    assert cfg["integrations"] == {"telegram": {"enabled": True}}
    assert cfg["bot_settings"]["bot_name"] == "Old"
    assert cfg["bot_settings"]["bot_role"] == "Role"
    assert "knowledge_file_url" not in cfg["bot_settings"]
    assert "knowledge_file_name" not in cfg["bot_settings"]
    assert "fallback_message" not in cfg["bot_settings"]
    assert "reserve_answer" not in cfg["bot_settings"]
    assert "ai_unavailable_message" not in cfg["bot_settings"]
    assert cfg["indexed_pages"] == []
    assert cfg["welcome_msg"] == ""
    assert "site_url" not in cfg
    assert "sitemap_url" not in cfg
    assert "working_hours" not in cfg
    assert "knowledge_file_url" not in cfg
    assert "knowledge_file_name" not in cfg
    assert "ai_unavailable_message" not in cfg


def test_default_assistant_id_constant_is_main():
    assert DEFAULT_ASSISTANT_ID == "main"
