import pytest
from fastapi.testclient import TestClient
from api.chat.main_async import app
from api.chat.routers.admin_router import verify_token

# Мокаем авторизацию
async def mock_verify_token():
    return {"sub": "mitia_assistant"}

app.dependency_overrides[verify_token] = mock_verify_token

client = TestClient(app)

def test_setup_telegram_valid_token():
    """Тест сохранения валидного токена и включения интеграции"""
    token = "123456789:TEST_TELEGRAM_BOT_TOKEN"
    payload = {
        "bot_token": token,
        "enabled": True,
        "admin_id": "123456"
    }
    response = client.post("/api/chat/telegram/setup?client_id=mitia_assistant", json=payload)
    assert response.status_code == 200
    assert response.json() == {"status": "success"}

def test_setup_telegram_invalid_token():
    """Тест с заведомо неверным токеном"""
    payload = {
        "bot_token": "invalid:token",
        "enabled": True
    }
    response = client.post("/api/chat/telegram/setup?client_id=mitia_assistant", json=payload)
    # Должен вернуть 400, так как мы добавили валидацию в роутер
    assert response.status_code == 400
    assert "error" in response.json()
