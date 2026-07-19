"""
Тесты конфигурации: загрузка конфига виджета, проверка домена, дефолты темы.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestConfig:
    """Загрузка конфигурации виджета."""

    @pytest.mark.asyncio
    async def test_config_mitia_assistant(self, client):
        """Конфиг для mitia_assistant всегда доступен."""
        mock_config = MagicMock()
        mock_config.raw = {"allowed_origins": ["localhost"]}
        mock_config.public_dict.return_value = {
            "client_id": "mitia_assistant",
            "bot_name": "Митя",
            "theme": {"brand_color": "#ff3300"},
            "widget_enabled": True,
        }

        with patch("api.chat.routers.chat_router.get_user_by_client_id", AsyncMock(return_value=None)):
            with patch("api.chat.routers.chat_router.get_client_config", AsyncMock(return_value=mock_config)):
                response = await client.get("/api/chat/config?client_id=mitia_assistant", headers={"referer": "http://localhost/widget"})

        assert response.status_code == 200
        data = response.json()
        assert data["client_id"] == "mitia_assistant"
        assert data["widget_enabled"] is True

    @pytest.mark.asyncio
    async def test_config_default_client_id(self, client):
        """Пустой client_id или 'default' → mitia_assistant."""
        mock_config = MagicMock()
        mock_config.raw = {"allowed_origins": ["localhost"]}
        mock_config.public_dict.return_value = {
            "client_id": "mitia_assistant",
            "bot_name": "Митя",
            "widget_enabled": True,
        }

        with patch("api.chat.routers.chat_router.get_user_by_client_id", AsyncMock(return_value=None)):
            with patch("api.chat.routers.chat_router.get_client_config", AsyncMock(return_value=mock_config)):
                response = await client.get("/api/chat/config?client_id=default", headers={"referer": "http://localhost/widget"})

        assert response.status_code == 200
        data = response.json()
        assert data["client_id"] == "mitia_assistant"

    @pytest.mark.asyncio
    async def test_config_payment_required(self, client):
        """Баланс <= -1 → конфиг доступен, но AI помечен как отключённый."""
        mock_user = MagicMock()
        mock_user.balance = -5.0
        mock_config = MagicMock()
        mock_config.raw = {"allowed_origins": ["debtor.local"]}
        mock_config.public_dict.return_value = {"client_id": "usr_debtor", "widget_enabled": True}

        with patch("api.chat.routers.chat_router.get_user_by_client_id", AsyncMock(return_value=mock_user)):
            with patch("api.chat.routers.chat_router.get_client_config", AsyncMock(return_value=mock_config)):
                response = await client.get("/api/chat/config?client_id=usr_debtor", headers={"referer": "https://debtor.local/page"})

        assert response.status_code == 200
        data = response.json()
        assert data["ai_disabled"] is True

    @pytest.mark.asyncio
    async def test_config_domain_blocked(self, client):
        """Запрос с чужого домена → 403."""
        mock_user = MagicMock()
        mock_user.balance = 0.0

        mock_config = MagicMock()
        mock_config.raw = {"site_url": "https://my-site.ru", "allowed_origins": ["my-site.ru"]}

        with patch("api.chat.routers.chat_router.get_user_by_client_id", AsyncMock(return_value=mock_user)):
            with patch("api.chat.routers.chat_router.get_client_config", AsyncMock(return_value=mock_config)):
                response = await client.get(
                    "/api/chat/config?client_id=usr_test",
                    headers={"referer": "https://evil-hacker.com/page"}
                )

        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_config_domain_allowed(self, client):
        """Запрос с правильного домена → 200."""
        mock_user = MagicMock()
        mock_user.balance = 0.0

        mock_config = MagicMock()
        mock_config.raw = {"site_url": "https://my-site.ru", "allowed_origins": ["my-site.ru"]}
        mock_config.public_dict.return_value = {"client_id": "usr_test", "widget_enabled": True}

        with patch("api.chat.routers.chat_router.get_user_by_client_id", AsyncMock(return_value=mock_user)):
            with patch("api.chat.routers.chat_router.get_client_config", AsyncMock(return_value=mock_config)):
                response = await client.get(
                    "/api/chat/config?client_id=usr_test",
                    headers={"referer": "https://my-site.ru/contacts"}
                )

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_config_no_allowed_domain(self, client):
        """Не настроен site_url → 403 для внешних запросов."""
        mock_user = MagicMock()
        mock_user.balance = 0.0

        mock_config = MagicMock()
        mock_config.raw = {"site_url": None, "contacts": {}, "allowed_origins": []}

        with patch("api.chat.routers.chat_router.get_user_by_client_id", AsyncMock(return_value=mock_user)):
            with patch("api.chat.routers.chat_router.get_client_config", AsyncMock(return_value=mock_config)):
                response = await client.get(
                    "/api/chat/config?client_id=usr_test",
                    headers={"referer": "https://some-site.ru"}
                )

        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_theme_defaults_endpoint(self, client):
        """GET /api/chat/theme-defaults возвращает JSON."""
        with patch("api.chat.routers.chat_router.get_default_theme", return_value={"brand_color": "#ff3300"}):
            response = await client.get("/api/chat/theme-defaults")

        assert response.status_code == 200
        data = response.json()
        assert "brand_color" in data

    @pytest.mark.asyncio
    async def test_config_public_dict_structure(self, client):
        """public_dict содержит все обязательные поля."""
        mock_config = MagicMock()
        mock_config.raw = {"allowed_origins": ["test.ru"]}
        mock_config.public_dict.return_value = {
            "client_id": "usr_test",
            "bot_name": "ТестБот",
            "avatar": "/img/ava.png",
            "welcome_msg": "Привет!",
            "widget_enabled": True,
            "theme": {"brand_color": "#000000"},
            "privacy_url": "/privacy",
            "site_url": "https://test.ru",
            "bot_settings": {},
            "enable_quick_replies": True,
            "quick_replies": [],
        }

        with patch("api.chat.routers.chat_router.get_user_by_client_id", AsyncMock(return_value=None)):
            with patch("api.chat.routers.chat_router.get_client_config", AsyncMock(return_value=mock_config)):
                response = await client.get("/api/chat/config?client_id=usr_test", headers={"referer": "https://test.ru/widget"})

        assert response.status_code == 200
        data = response.json()
        required_fields = ["client_id", "bot_name", "widget_enabled", "theme"]
        for field in required_fields:
            assert field in data, f"Missing field: {field}"
