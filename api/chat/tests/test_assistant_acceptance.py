"""Acceptance tests for an assistant before enabling customer-facing channels.

These tests never call an AI provider or a real messenger.  They verify the
platform guarantees around context, factual contacts, operator handoff,
tenant isolation, and inbound channel routing.
"""
import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch


MAIN = Path("api/chat/main_async.py")
AI_SERVICE = Path("api/chat/services/ai_service.py")
WIDGET_MESSAGES = Path("api/chat/widget_src/src/ui/messages.js")
INTEGRATIONS_TEMPLATE = Path("api/chat/templates/integrations.html")
INTEGRATIONS_JS = Path("api/chat/static/js/integrations.js")
TELEGRAM_SERVICE = Path("api/chat/services/telegram_service.py")

import pytest

from api.chat.services.chat_service import chat_service


@pytest.mark.asyncio
async def test_ok_bot_api_uses_documented_graph_endpoints_and_payloads():
    from api.chat.services.ok_service import (
        check_ok_token,
        send_ok_message,
        subscribe_ok_webhook,
    )

    class MockResponse:
        def __init__(self, payload):
            self.payload = payload
            self.is_success = True

        def json(self):
            return self.payload

    class MockClient:
        def __init__(self):
            self.calls = []

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url, **kwargs):
            self.calls.append(("get", url, kwargs))
            return MockResponse({"group_id": "group:404", "name": "Test group"})

        async def post(self, url, **kwargs):
            self.calls.append(("post", url, kwargs))
            if url.endswith("/subscribe"):
                return MockResponse({"success": True})
            return MockResponse({"success": [True]})

    mock_client = MockClient()
    with patch("api.chat.services.ok_service.httpx.AsyncClient", return_value=mock_client):
        assert (await check_ok_token("ok-token"))["group_id"] == "404"
        assert (await subscribe_ok_webhook("ok-token", "https://mitia.pro/api/chat/ok/webhook/secret"))["status"] == "ok"
        assert await send_ok_message("ok-token", "chat:C404", "Тест")

    assert mock_client.calls[0] == (
        "get", "https://api.ok.ru/graph/me/info", {"params": {"access_token": "ok-token"}}
    )
    method, url, kwargs = mock_client.calls[1]
    assert (method, url) == ("post", "https://api.ok.ru/graph/me/subscribe")
    assert kwargs["json"] == {"url": "https://mitia.pro/api/chat/ok/webhook/secret"}
    method, url, kwargs = mock_client.calls[2]
    assert (method, url) == ("post", "https://api.ok.ru/graph/me/messages/chat:C404")
    assert kwargs["json"] == {
        "recipient": {"chat_id": "chat:C404"},
        "message": {"text": "Тест"},
    }


def test_operator_attachments_are_available_to_the_chat_session_and_rendered_by_extension():
    main = MAIN.read_text(encoding="utf-8")
    messages = WIDGET_MESSAGES.read_text(encoding="utf-8")
    modal = Path("api/chat/static/js/dialogs/ui/modal.js").read_text(encoding="utf-8")

    assert 'folder in ("chat_files", "operator_files")' in main
    assert "await _is_valid_chat_session(client_id, session_id)" in main
    assert "const isImage = fileType.startsWith('image/')" in messages
    assert "/\\.(png|jpe?g|gif|webp|svg)$/i.test(fileName)" in messages
    assert "contentType.startsWith('audio/')" in modal
    assert "<audio controls" in modal


def test_messenger_audio_is_saved_and_transcribed_for_inbox_and_ai():
    telegram_router = Path("api/chat/routers/telegram_router.py").read_text(encoding="utf-8")
    telegram_service = TELEGRAM_SERVICE.read_text(encoding="utf-8")
    max_service = Path("api/chat/services/max_service.py").read_text(encoding="utf-8")
    vk_service = Path("api/chat/services/vk_service.py").read_text(encoding="utf-8")

    ok_service = Path("api/chat/services/ok_service.py").read_text(encoding="utf-8")
    avito_service = Path("api/chat/services/avito_service.py").read_text(encoding="utf-8")
    for source in (telegram_router, telegram_service, max_service, vk_service, ok_service, avito_service):
        assert '"content_type"' in source
        assert "transcribe_voice" in source
    assert "attachments=attachments or None" in max_service
    assert "attachments=stored_attachments or None" in vk_service
    assert "getVoiceFiles" in avito_service
    assert "_download_ok_attachments" in ok_service
    chat_service_source = Path("api/chat/services/chat_service.py").read_text(encoding="utf-8")
    assert "Расшифровка аудиофайла" in chat_service_source
    assert "message_row.attachments = email_attachments" in chat_service_source


def test_account_deletion_is_shared_and_removes_database_and_files():
    deletion = Path("api/chat/services/account_deletion_service.py").read_text(encoding="utf-8")
    auth = Path("api/chat/routers/auth_router.py").read_text(encoding="utf-8")
    superadmin = Path("api/chat/routers/superadmin_router.py").read_text(encoding="utf-8")

    assert "async def delete_client_account" in deletion
    assert "delete(AssistantConfig)" in deletion
    assert "delete(Assistant)" in deletion
    assert "delete(User)" in deletion
    assert "shutil.rmtree" in deletion
    assert "await delete_client_account(client_id)" in auth
    assert "await delete_client_account(client_id)" in superadmin


def test_integration_mode_buttons_default_to_operator_and_hh_disconnect_is_saved_only():
    template = INTEGRATIONS_TEMPLATE.read_text(encoding="utf-8")
    source = INTEGRATIONS_JS.read_text(encoding="utf-8")

    assert template.count('data-integration-mode-value="assistant"') == 8
    assert template.count('data-integration-mode-value="operator"') == 8
    assert "if (settings.assistant_enabled === undefined) settings.assistant_enabled = false;" in source
    assert "/api/chat/hh/disconnect" in source
    assert "this.state.dirtyIntegrations.has('hh')" in source


def test_operator_name_is_account_wide_and_assistant_mode_releases_channel_dialogs():
    config_router = Path("api/chat/routers/admin/config.py").read_text(encoding="utf-8")
    clients = Path("api/chat/services/clients.py").read_text(encoding="utf-8")
    integrations = Path("api/chat/services/integrations_service.py").read_text(encoding="utf-8")

    assert "The operator name is account-wide" in config_router
    assert "Operator identity is shared by the whole account" in clients
    assert "A channel switched back to Assistant" in integrations
    assert ".values(is_operator_mode=False)" in integrations


def test_telegram_token_validation_uses_configured_proxy_client():
    source = TELEGRAM_SERVICE.read_text(encoding="utf-8")

    assert 'client_kwargs["proxy"] = TG_PROXY' in source
    validation = source[source.index("async def validate_bot_token"):]
    assert "async with get_tg_client(timeout=3, verify=False)" in validation


def test_operator_can_play_incoming_audio_inside_dialog():
    modal = Path("api/chat/static/js/dialogs/ui/modal.js").read_text(encoding="utf-8")

    assert "operator-message-audio" in modal
    assert "<audio controls" in modal


def test_telegram_polling_transcribes_and_preserves_voice_attachment():
    source = Path("api/chat/services/telegram_service.py").read_text(encoding="utf-8")

    assert "from .stt_service import transcribe_voice" in source
    assert 'is_voice = "voice" in message' in source
    assert 'attachments.append({"name": file_name' in source
    assert "attachments=attachments," in source


def test_gigachat_receives_current_image_as_vision_attachment():
    source = AI_SERVICE.read_text(encoding="utf-8")
    giga = Path("api/chat/services/gigachat_service.py").read_text(encoding="utf-8")

    assert "for attachment in attachments or []:" in source
    assert "messages[-1]['attachments'] = vision_file_ids" in source
    assert "target_model = 'GigaChat-Pro'" in source
    assert "async def upload_gigachat_file" in giga


def test_assistant_cannot_be_instructed_to_invent_business_facts():
    source = AI_SERVICE.read_text(encoding="utf-8")

    assert "творческий подход и фантазию" not in source
    assert "min(max(float(bot_settings.get('temperature', 0.3)), 0.0), 0.3)" in source
    assert "if file_content: registry_parts.append(file_content)" in source
from api.chat.services.clients import ClientConfig
from api.chat.services.data_guard import apply_data_guard


TENANT_A = "usr_quality_a"
TENANT_B = "usr_quality_b"
ASSISTANT_A = "sales"


def make_config(client_id: str, assistant_id: str) -> ClientConfig:
    return ClientConfig(
        client_id=client_id,
        raw={
            "updated_at": 0,
            "contacts": {
                "phone": "+7 495 123-45-67",
                "email": "hello@quality-a.example",
            },
            "bot_settings": {
                "bot_name": "Алексей",
                "bot_role": "Консультант",
                "ai_model": "gigachat",
                "temperature": 0.2,
            },
        },
    )


@pytest.mark.asyncio
async def test_follow_up_receives_same_session_history_and_assistant_config():
    """A follow-up must reach the model with prior turns from its own session."""
    config = make_config(TENANT_A, ASSISTANT_A)
    history = [
        {"role": "user", "content": "Мне нужна настройка CRM"},
        {"role": "assistant", "content": "Уточните число пользователей."},
        {"role": "user", "content": "Нас десять"},
    ]

    with patch("api.chat.services.chat_service.get_client_config", AsyncMock(return_value=config)) as get_config, \
         patch("api.chat.services.chat_service.get_chat_history", AsyncMock(return_value=history)), \
         patch("api.chat.services.chat_service.ask_ai", AsyncMock(return_value="Подготовлю предложение для 10 пользователей.")) as ask_ai:
        response = await chat_service._get_ai_response(
            TENANT_A,
            ASSISTANT_A,
            "web-quality-session",
            "А сколько это займёт?",
            None,
            {"context_limit": 10},
        )

    assert response == "Подготовлю предложение для 10 пользователей."
    get_config.assert_awaited_once_with(TENANT_A, assistant_id=ASSISTANT_A)
    messages = ask_ai.await_args.args[0]
    assert [message["content"] for message in messages[-4:]] == [
        "Мне нужна настройка CRM",
        "Уточните число пользователей.",
        "Нас десять",
        "А сколько это займёт?",
    ]


def test_data_guard_removes_unconfigured_contacts_but_keeps_configured_ones():
    """The response cannot expose a phone or email absent from this tenant's config."""
    answer = (
        "Напишите на hello@quality-a.example или позвоните +7 495 123-45-67. "
        "Резервный номер +7 999 000-00-00 и почта secret@other-tenant.example."
    )

    filtered = apply_data_guard(answer, ["hello@quality-a.example", "+7 495 123-45-67"])

    assert "hello[telegram удален]-a.example" in filtered
    assert "+7 495 123-45-67" in filtered
    assert "secret@other-tenant.example" not in filtered
    assert "+7 999 000-00-00" not in filtered


def test_operator_handoff_is_guarded_before_ai_generation():
    """Once an operator takes over, the service must not invoke the model."""
    source = open("api/chat/services/chat_service.py", encoding="utf-8").read()
    operator_gate = source[source.index("if is_operator:"):source.index("audio_url = None")]

    assert "AI response skipped" in operator_gate
    assert "waiting_for_operator" in operator_gate
    assert "Manual operator mode does not send a canned reply" in operator_gate


@pytest.mark.asyncio
async def test_telegram_webhook_keeps_resolved_tenant_and_assistant():
    from api.chat.routers.telegram_router import telegram_webhook

    request = MagicMock()
    request.json = AsyncMock(return_value={
        "message": {"chat": {"id": 101}, "text": "Нужна консультация", "from": {"id": 1}},
    })
    with patch("api.chat.routers.telegram_router.find_client_by_token", AsyncMock(return_value={"client_id": TENANT_A, "assistant_id": ASSISTANT_A})), \
         patch("api.chat.routers.telegram_router.handle_telegram_message", AsyncMock(return_value=True)) as handle:
        response = await telegram_webhook("test-token", request)

    assert response == {"status": "ok"}
    assert handle.await_args.args[:4] == (TENANT_A, "test-token", 101, "Нужна консультация")
    assert handle.await_args.kwargs["assistant_id"] == ASSISTANT_A


@pytest.mark.asyncio
async def test_max_webhook_keeps_resolved_tenant_and_assistant():
    from api.chat.routers.max_router import max_webhook

    request = MagicMock()
    request.json = AsyncMock(return_value={
        "update_type": "message_created",
        "message": {"recipient": {"chat_id": "202"}, "sender": {"user_id": "2"}, "body": {"text": "Нужна помощь"}},
    })
    with patch("api.chat.routers.max_router.find_client_by_token", AsyncMock(return_value={"client_id": TENANT_A, "assistant_id": ASSISTANT_A})), \
         patch("api.chat.routers.max_router.handle_max_message", AsyncMock(return_value=True)) as handle:
        response = await max_webhook("test-token", request)

    assert response == {"status": "ok"}
    assert handle.await_args.args[:4] == (TENANT_A, "test-token", "202", "Нужна помощь")
    assert handle.await_args.kwargs["assistant_id"] == ASSISTANT_A


@pytest.mark.asyncio
async def test_vk_webhook_keeps_resolved_tenant_and_assistant():
    from api.chat.routers.vk_router import vk_webhook

    request = MagicMock()
    request.json = AsyncMock(return_value={
        "type": "message_new",
        "group_id": 303,
        "object": {"message": {"from_id": 3, "text": "Есть вопрос"}},
    })
    settings = {"enabled": True, "access_token": "vk-token"}
    with patch("api.chat.routers.vk_router.find_client_by_group_id", AsyncMock(return_value={"client_id": TENANT_A, "assistant_id": ASSISTANT_A})), \
         patch("api.chat.routers.vk_router.get_integration_settings", AsyncMock(return_value=settings)), \
         patch("api.chat.routers.vk_router.handle_vk_message", AsyncMock()) as handle:
        response = await vk_webhook(request)

    assert response.body == b"ok"
    assert handle.await_args.args[:4] == (TENANT_A, "vk-token", 3, "Есть вопрос")
    assert handle.await_args.kwargs["assistant_id"] == ASSISTANT_A


@pytest.mark.asyncio
async def test_ok_webhook_keeps_resolved_tenant_and_assistant():
    from api.chat.routers.ok_router import ok_webhook

    request = MagicMock()
    request.json = AsyncMock(return_value={
        "webhookType": "MESSAGE_CREATED",
        "group_id": "group:404",
        "sender": {"user_id": "user:4"},
        "recipient": {"chat_id": "chat:C404"},
        "message": {"text": "Есть вопрос"},
    })
    settings = {"enabled": True, "access_token": "ok-token", "webhook_secret": "safe-secret"}
    with patch("api.chat.routers.ok_router.find_client_by_ok_group_id", AsyncMock(return_value={"client_id": TENANT_A, "assistant_id": ASSISTANT_A})), \
         patch("api.chat.routers.ok_router.get_integration_settings", AsyncMock(return_value=settings)), \
         patch("api.chat.routers.ok_router.handle_ok_message", AsyncMock()) as handle:
        response = await ok_webhook("safe-secret", request)
        await asyncio.sleep(0)

    assert response.body == b"ok"
    assert handle.await_args.args[:5] == (TENANT_A, "ok-token", "4", "chat:C404", "Есть вопрос")
    assert handle.await_args.kwargs["assistant_id"] == ASSISTANT_A


@pytest.mark.asyncio
async def test_email_webhook_keeps_tenant_and_assistant():
    from api.chat.routers.webhook_router import email_webhook

    request = MagicMock()
    request.json = AsyncMock(return_value={
        "from": "buyer@example.com", "to": "support@quality-a.example", "subject": "Вопрос", "body": "Помогите",
    })
    config = SimpleNamespace(raw={"integrations": {"email": {"enabled": True, "webhook_token": "safe-token"}}})
    with patch("api.chat.services.clients.get_client_config", AsyncMock(return_value=config)), \
         patch("api.chat.routers.webhook_router.chat_service.process_ask", AsyncMock(return_value={"status": "ok"})) as process:
        response = await email_webhook(request, TENANT_A, "safe-token", ASSISTANT_A)

    assert response["status"] == "ok"
    ask_data = process.await_args.args[0]
    assert ask_data.client_id == TENANT_A
    assert ask_data.assistant_id == ASSISTANT_A
    assert ask_data.session_id.startswith(f"email_{ASSISTANT_A}_")
