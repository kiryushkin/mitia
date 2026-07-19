"""Regression tests for safe default response modes in integration cards."""
from pathlib import Path


TEMPLATE = Path("api/chat/templates/integrations.html")
INTEGRATIONS_JS = Path("api/chat/static/js/integrations.js")
AVITO_ROUTER = Path("api/chat/routers/avito_router.py")
EMAIL_ROUTER = Path("api/chat/routers/email_router.py")
EMAIL_SERVICE = Path("api/chat/services/email_service.py")
OPERATOR_NOTIFICATIONS = Path("api/chat/services/operator_notification_service.py")
SUPERADMIN_ROUTER = Path("api/chat/routers/superadmin_router.py")
DIALOG_MODAL = Path("api/chat/static/js/dialogs/ui/modal.js")
DIALOG_STYLES = Path("api/chat/static/css/settings.css")
CHAT_SERVICE = Path("api/chat/services/chat_service.py")
WIDGET_SOURCE = Path("api/chat/widget_src/src/index.js")
SESSION_ROUTER = Path("api/chat/routers/admin/sessions.py")


def test_headhunter_has_the_same_response_mode_controls_as_other_channels():
    source = TEMPLATE.read_text(encoding="utf-8")

    assert 'data-integration="hh" data-field="assistant_enabled"' in source
    assert 'autoreply_message' not in source
    assert 'autoreply_enabled' not in source


def test_avito_history_sync_controls_and_routes_are_removed():
    template = TEMPLATE.read_text(encoding="utf-8")
    router = AVITO_ROUTER.read_text(encoding="utf-8")

    assert 'avito-sync-history-checkbox' not in template
    assert '@router.post("/sync")' not in router
    assert '"sync_history"' not in router


def test_integration_load_preserves_existing_settings_and_only_saves_dirty_cards():
    source = INTEGRATIONS_JS.read_text(encoding="utf-8")

    assert 'loadedIntegrations: new Set()' in source
    assert 'dirtyIntegrations: new Set()' in source
    assert '...this.state.integrations,' in source
    assert '...receivedIntegrations' in source
    assert 'this.state.dirtyIntegrations.has(name)' in source
    assert 'this.state.dirtyIntegrations.clear();' in source
    assert 'settings.assistant_enabled = false;' in source
    assert 'settings.autoreply_enabled = false;' in source
    assert "settings.autoreply_message = '';" in source


def test_email_history_sync_is_removed_and_monitoring_starts_from_connection_time():
    template = TEMPLATE.read_text(encoding="utf-8")
    integrations = INTEGRATIONS_JS.read_text(encoding="utf-8")
    email_router = EMAIL_ROUTER.read_text(encoding="utf-8")
    email_service = EMAIL_SERVICE.read_text(encoding="utf-8")

    assert 'email-sync-history-checkbox' not in template
    assert 'startEmailSyncPolling' not in integrations
    assert '@router.post("/sync")' not in email_router
    assert "mail.search(None, 'UNSEEN')" in email_service
    assert "import asyncio" in email_router
    assert "await asyncio.to_thread(_check_imap)" in email_router
    assert 'email_monitor_initialized:' in email_service
    assert 'sync_historical_emails' not in email_service
    assert '_list_folders' not in email_service
    assert '/folders/{client_id}' not in email_router


def test_inbound_channels_use_the_unified_operator_notifier():
    notifier = OPERATOR_NOTIFICATIONS.read_text(encoding="utf-8")

    assert 'async def notify_operators' in notifier
    assert 'assistant_id: str | None = None' in notifier
    for service_name in ['telegram_service.py', 'vk_service.py', 'max_service.py', 'avito_service.py', 'email_service.py']:
        source = Path('api/chat/services', service_name).read_text(encoding="utf-8")
        assert 'notify_operators' in source


def test_dialog_platform_filter_only_renders_enabled_integrations():
    template = Path("api/chat/templates/dialogs.html").read_text(encoding="utf-8")
    source = Path("api/chat/static/js/dialogs/index.js").read_text(encoding="utf-8")

    platform_buttons = template[template.index('id="platform-buttons"'):template.index('id="platform-buttons"') + 120]
    assert 'data-platform=' not in platform_buttons
    assert 'id="dialog-channels-filter"' in template
    assert '>Каналы<' in template
    assert "const PLATFORM_FILTERS" in source
    assert "filterSection.style.display = enabledPlatforms.length ? '' : 'none'" in source
    assert "integrations?.[integration]?.enabled" in source
    assert "fetchIntegrations(state.activeClientId)" in source
    assert "{ integration: 'hh', platform: 'hh', label: 'HeadHunter' }" in source


def test_dialog_mode_filter_uses_empty_selection_for_all_dialogs():
    template = Path("api/chat/templates/dialogs.html").read_text(encoding="utf-8")
    filters = Path("api/chat/static/js/dialogs/ui/filters.js").read_text(encoding="utf-8")
    state = Path("api/chat/static/js/dialogs/state.js").read_text(encoding="utf-8")

    mode_buttons = template[template.index('id="mode-buttons"'):template.index('id="mode-buttons"') + 400]
    assert 'data-mode="all"' not in mode_buttons
    assert 'data-mode="assistant"' in mode_buttons
    assert 'data-mode="operator"' in mode_buttons
    assert 'state.activeModes.clear();' in filters
    assert "if (state.activeModes.size === 1)" in state


def test_compact_dialog_layout_uses_sidebar_avatar_and_two_step_back_navigation():
    modal = DIALOG_MODAL.read_text(encoding="utf-8")
    styles = DIALOG_STYLES.read_text(encoding="utf-8")

    assert "function renderSidebarClientAvatar()" in modal
    assert "window.handleDialogBack" in modal
    assert "is-dialog-profile" in modal
    assert ".appearance-grid.dialog-active #dialogs-filter-column,.appearance-grid.dialog-active #dialogs-list-column,.appearance-grid.dialog-active #dialogs-profile-column{display:none!important;flex:0 0 0!important;width:0!important;min-width:0!important;margin:0!important;padding:0!important}" in styles
    assert ".appearance-grid.dialog-active.is-dialog-profile #dialogs-profile-column{display:flex!important" in styles
    assert "border-radius:50%" in styles


def test_dialogs_notification_only_tracks_unread_messages():
    source = Path("api/chat/static/js/dialogs/index.js").read_text(encoding="utf-8")

    assert "newData.some(d => !d.is_read)" in source
    assert "!d.is_read || d.is_operator_mode" not in source


def test_site_dialog_operator_mode_does_not_change_global_widget_assistant_switch():
    """A client-card handoff must affect one session, never integrations.widget.assistant_enabled."""
    modal = DIALOG_MODAL.read_text(encoding="utf-8")
    chat_service = CHAT_SERVICE.read_text(encoding="utf-8")
    sessions = SESSION_ROUTER.read_text(encoding="utf-8")

    save_profile = modal[modal.index("export async function saveClientProfile"):modal.index("export function renderDialogSidebar")]
    set_operator_mode = sessions[sessions.index("async def _set_operator_mode"):sessions.index('@router.post("/sessions/{session_id}/takeover")')]

    assert "toggleOperatorMode(state.activeSessionId, isOperatorMode)" in save_profile
    assert "assistant_enabled" not in save_profile
    assert ".where(ChatSession.session_id == session_id, ChatSession.client_id == client_id)" in set_operator_mode
    assert ".values(is_operator_mode=enabled)" in set_operator_mode
    assert "widget_settings.get('assistant_enabled') is False" in chat_service
    assert ".values(assistant_enabled" not in chat_service


def test_site_widget_session_id_is_scoped_to_client():
    source = WIDGET_SOURCE.read_text(encoding="utf-8")

    assert "const sessionKey = `mitya_session_id_${storageScope}`;" in source
    assert "localStorage.setItem(`mitya_session_id_${getWidgetStorageScope(CONFIG)}`, window.sessionId);" in source
    assert "localStorage.getItem('mitya_session_id')" not in source


def test_superadmin_personal_tariff_and_custom_conditions_use_distinct_notifications():
    source = SUPERADMIN_ROUTER.read_text(encoding="utf-8")

    assert 'title = "Индивидуальные условия обновлены"' in source
    assert 'if is_personal:' in source
    assert '"Для вас активирован тариф «Персональный»"' in source
    assert 'else:\n        await notify_tariff_changed(client_id, display_name)' in source
