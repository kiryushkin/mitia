"""Regression tests for widget source code and its chat window behavior."""
from pathlib import Path


WIDGET_SOURCE = Path("api/chat/widget_src/src/index.js")
WINDOW_SOURCE = Path("api/chat/widget_src/src/ui/window.js")
CHAT_API_SOURCE = Path("api/chat/widget_src/src/api/chat.js")
CONFIG_SOURCE = Path("api/chat/widget_src/src/core/config.js")
WELCOME_SOURCE = Path("api/chat/widget_src/src/ui/welcome.js")


def test_preview_welcome_is_persisted_in_widget_config_before_rendering():
    """A live preview update must also change the state used when the window opens."""
    source = WIDGET_SOURCE.read_text(encoding="utf-8")
    apply_theme = source[source.index("applyTheme: (theme, data = {}) => {"):source.index("toggleTTS:")]

    assert "if (data.welcome_msg !== undefined)" in apply_theme
    assert "CONFIG.welcome_msg = data.welcome_msg;" in apply_theme
    assert "applyTheme(theme, CONFIG, window.els, window.shadow, data || {});" in apply_theme


def test_remote_config_update_refreshes_welcome_and_renders_it():
    """WebSocket configuration updates must update both state and visible message."""
    source = WIDGET_SOURCE.read_text(encoding="utf-8")
    update_handler = source[source.index("api.on('config_update'"):source.index("let typingTimeout")]

    assert "if (data.config.welcome_msg !== undefined) CONFIG.welcome_msg = data.config.welcome_msg;" in update_handler
    assert "applyTheme(CONFIG.theme, CONFIG, window.els, window.shadow, data.config);" in update_handler


def test_opening_empty_widget_window_loads_history_and_welcome():
    """Opening an empty window invokes history loading, where the welcome is displayed once."""
    window_source = WINDOW_SOURCE.read_text(encoding="utf-8")
    chat_source = CHAT_API_SOURCE.read_text(encoding="utf-8")

    assert "await loadHistoryFn(config, chatToken, els);" in window_source
    assert "const canShowWelcome = history.length === 0" in chat_source
    assert "addMessage(config.welcome_msg, 'bot', { noScroll: true, isWelcome: true }, config, els);" in chat_source


def test_widget_storage_is_scoped_to_the_specific_assistant():
    """Two assistants belonging to one client must not share widget state."""
    config_source = CONFIG_SOURCE.read_text(encoding="utf-8")
    widget_source = WIDGET_SOURCE.read_text(encoding="utf-8")
    welcome_source = WELCOME_SOURCE.read_text(encoding="utf-8")

    assert "export function getWidgetStorageScope" in config_source
    assert "`${clientId}_${assistantId}`" in config_source
    assert "mitya_session_id_${storageScope}" in widget_source
    assert "mitya_welcome_last_closed_${storageScope}" in welcome_source


def test_widget_does_not_duplicate_welcome_when_history_exists():
    """A persisted conversation must not receive a fresh welcome on every window open."""
    source = CHAT_API_SOURCE.read_text(encoding="utf-8")

    assert "history.length === 0" in source
    assert "!sessionStorage.getItem(welcomeKey)" in source
    assert "msg.content === config.welcome_msg && msg.role === 'assistant'" in source


def test_preview_welcome_creation_is_idempotent_during_parallel_theme_updates():
    """Appearance sync may run repeatedly, but it must produce only one welcome message."""
    theme_source = Path("api/chat/widget_src/src/ui/theme.js").read_text(encoding="utf-8")

    assert "els._isCreatingWelcomeMessage" in theme_source
    assert "els._welcomeMessageVersion" in theme_source
    assert "querySelectorAll('.message.is-welcome')" in theme_source
    assert "existingMessages.forEach(message => message.remove())" in theme_source


def test_widget_rejects_svg_attachments():
    html_source = Path("api/chat/widget_src/src/ui/html.js").read_text(encoding="utf-8")
    index_source = WIDGET_SOURCE.read_text(encoding="utf-8")

    file_input = html_source[html_source.index('id="chat-file-input"'):]
    allowed_extensions = index_source[index_source.index("const ALLOWED_EXTENSIONS"):]
    assert ".svg" not in file_input.split(">", 1)[0]
    assert "'.svg'" not in allowed_extensions.split("];", 1)[0]


def test_realtime_operator_and_system_messages_use_the_configured_animation():
    """Messages delivered by WebSocket must not bypass the typewriter preference."""
    source = WIDGET_SOURCE.read_text(encoding="utf-8")
    handler = source[source.index("api.on('message'"):source.index("api.on('config_update'")]

    assert "chat_typewriter_enabled" in handler
    assert "isStreaming: typewriterEnabled" in handler
    assert "data.author_role === 'operator' ? 'operator' : 'bot'" in handler
    history_loader = Path("api/chat/widget_src/src/api/chat.js").read_text(encoding="utf-8")
    assert "author_role: msg.author_role" in history_loader
    assert "msg.author_role === 'operator'" in history_loader
    assert "await addMessage(data.content, role" in handler
