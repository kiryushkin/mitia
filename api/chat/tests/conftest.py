"""
Фикстуры для тестов Mitya AI.
Мокируют БД, Redis, внешние API — тесты не требуют реальной инфраструктуры.
"""
import os
import sys
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch

# Переменные окружения ДО любых импортов
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["JWT_SECRET"] = "test-secret-key-for-tests"
os.environ["SUPERADMIN_MASTER_TOKEN"] = "test-master-token"

# Мокаем Redis
sys.modules['redis'] = MagicMock()

# Мокаем pgvector
sys.modules['pgvector'] = MagicMock()
sys.modules['pgvector.sqlalchemy'] = MagicMock()

# Мокаем faiss
sys.modules['faiss'] = MagicMock()

# Мокаем Silero/TTS
sys.modules['torch'] = MagicMock()
sys.modules['torchaudio'] = MagicMock()
sys.modules['silero'] = MagicMock()

# Мокаем Pillow
sys.modules['PIL'] = MagicMock()
sys.modules['PIL.Image'] = MagicMock()

# Мокаем pdfplumber, docx
sys.modules['pdfplumber'] = MagicMock()
sys.modules['docx'] = MagicMock()

# Мокаем pymorphy3
sys.modules['pymorphy3'] = MagicMock()
sys.modules['pymorphy3_dicts_ru'] = MagicMock()

# Мокаем ВЕСЬ модуль db_service до его импорта —
# иначе SQLAlchemy упадёт на Mapped[list[float]] без pgvector
_mock_db = MagicMock()
# Правильный мок AsyncSessionLocal:
# execute(stmt) должен возвращать stmt как есть (чтобы патчи select().where().scalar_one_or_none работали)
async def _fake_execute(stmt, *args, **kwargs):
    return stmt

_mock_session = MagicMock()
_mock_session.execute = _fake_execute
_mock_session.commit = AsyncMock()
_mock_session.add = MagicMock()
_mock_session.__aenter__ = AsyncMock(return_value=_mock_session)
_mock_session.__aexit__ = AsyncMock(return_value=None)
_mock_db.AsyncSessionLocal = MagicMock(return_value=_mock_session)
_mock_db.User = MagicMock()
_mock_db.ClientConfig = MagicMock()
_mock_db.ChatSession = MagicMock()
_mock_db.ChatMessage = MagicMock()
_mock_db.Lead = MagicMock()
_mock_db.GlobalToken = MagicMock()
_mock_db.UserScenario = MagicMock()
_mock_db.ScenarioTemplate = MagicMock()
_mock_db.ActiveScenario = MagicMock()
_mock_db.SitePage = MagicMock()
_mock_db.SiteTerm = MagicMock()
_mock_db.get_user_by_client_id = AsyncMock()
_mock_db.get_or_create_session = AsyncMock()
_mock_db.save_chat_message = AsyncMock()
_mock_db.get_chat_history = AsyncMock(return_value=[])
_mock_db.update_user_balance = AsyncMock()
_mock_db.get_metrics_summary = AsyncMock(return_value={"total_dialogs": 0, "total_leads": 0})
_mock_db.save_lead = AsyncMock()
_mock_db.search_site_pages = AsyncMock(return_value=[])
_mock_db.get_global_token = AsyncMock(return_value=None)
_mock_db.save_global_token = AsyncMock()
_mock_db.init_db = AsyncMock()
_mock_db.get_db = MagicMock()
sys.modules['api.chat.services.db_service'] = _mock_db

# Мокаем часть sqlalchemy, но не ломаем dialect-specific импорты
# для сценариев и других модулей, которым нужны реальные классы PostgreSQL.
import sqlalchemy as _sa
_sa.update = MagicMock(return_value=MagicMock())
_sa.select = MagicMock(return_value=MagicMock())
_sa.delete = MagicMock(return_value=MagicMock())
_sa.func = MagicMock()
_sa.text = MagicMock(return_value=MagicMock())
_sa.and_ = MagicMock(return_value=MagicMock())
_sa.or_ = MagicMock(return_value=MagicMock())
_sa.desc = MagicMock(return_value=MagicMock())

# Лёгкий stub для sqlalchemy.dialects.postgresql.insert(...).on_conflict_do_update(...)
class _FakePgInsert:
    def values(self, *args, **kwargs):
        return self

    def on_conflict_do_update(self, *args, **kwargs):
        return self


def _fake_pg_insert(*args, **kwargs):
    return _FakePgInsert()

import sqlalchemy.dialects.postgresql as _pg
_pg.insert = _fake_pg_insert


@pytest.fixture(autouse=True)
def mock_cache():
    """Мокаем Redis cache_service."""
    mock = MagicMock()
    mock.get = MagicMock(return_value=None)
    mock.set = MagicMock()
    mock.delete = MagicMock()
    mock.incr_with_window = MagicMock(return_value=1)
    with patch("api.chat.services.cache_service.cache_service", mock):
        yield mock


@pytest.fixture(autouse=True)
def mock_send_email():
    """Мокаем отправку писем."""
    mock = AsyncMock(return_value=True)
    with patch("api.chat.services.notify_service.send_email", mock):
        with patch("api.chat.routers.auth_router.send_email", mock):
            with patch("api.chat.services.chat_service.send_email", mock):
                yield mock


@pytest.fixture(autouse=True)
def mock_gigachat():
    """Мокаем GigaChat API."""
    mock = AsyncMock(return_value="Тестовый ответ от ассистента")
    with patch("api.chat.services.gigachat_service.handle_gigachat_request", mock):
        with patch("api.chat.services.gigachat_service.get_gigachat_token", AsyncMock(return_value="test-token")):
            yield mock


@pytest.fixture
def test_app():
    """Облегчённое FastAPI-приложение для app-level тестов без полного bootstrap main_async."""
    from fastapi import FastAPI
    from api.chat.routers import chat_router, auth_router, admin_router

    app = FastAPI(title="Mitya AI Test App")
    app.include_router(chat_router.router)
    app.include_router(auth_router.router)
    app.include_router(admin_router.router)
    return app


@pytest_asyncio.fixture
async def client(test_app):
    """Асинхронный тестовый клиент FastAPI."""
    from httpx import ASGITransport, AsyncClient

    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
