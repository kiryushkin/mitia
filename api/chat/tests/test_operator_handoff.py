"""Regression tests for operator handoff notifications in a dialog."""
from pathlib import Path


SESSIONS_SOURCE = Path("api/chat/routers/admin/sessions.py")


def test_takeover_and_release_use_the_dialog_assistant_configuration():
    source = SESSIONS_SOURCE.read_text(encoding="utf-8")
    helper = source[source.index("async def _set_operator_mode"):source.index('@router.post("/sessions/{session_id}/takeover")')]

    assert "select(ChatSession).where(" in helper
    assert "assistant_id = chat_session.assistant_id or 'main'" in helper
    assert "get_client_config(client_id, assistant_id=assistant_id)" in helper


def test_takeover_and_release_both_persist_and_broadcast_a_system_message():
    source = SESSIONS_SOURCE.read_text(encoding="utf-8")
    helper = source[source.index("async def _set_operator_mode"):source.index('@router.post("/sessions/{session_id}/takeover")')]

    assert "await save_chat_message(session_id, 'assistant', system_msg, author_role='system')" in helper
    assert '"author_role": "system"' in helper
    assert '"type": "message"' in helper
    assert "msg_system_join_template" in helper
    assert "msg_system_leave_template" in helper


def test_takeover_and_release_call_the_shared_notification_flow():
    source = SESSIONS_SOURCE.read_text(encoding="utf-8")
    takeover = source[source.index("async def takeover_session"):source.index('@router.post("/sessions/{session_id}/release")')]
    release = source[source.index("async def release_session"):]

    assert "await _set_operator_mode(session_id, token_data, enabled=True)" in takeover
    assert "system_msg = await _set_operator_mode(session_id, token_data, enabled=False)" in release
