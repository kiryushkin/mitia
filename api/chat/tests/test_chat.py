"""
Тесты чата: отправка сообщений, стриминг, кэш, лимиты.
"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestChat:
    """Основной цикл диалога — тестируем HTTP-слой."""

    @pytest.mark.asyncio
    async def test_ask_simple_message(self, client):
        """Отправка простого сообщения — успешный ответ."""
        with patch("api.chat.routers.chat_router.chat_service.process_ask", AsyncMock(return_value={
            "response": "Здравствуйте! Чем могу помочь?",
            "status": "ok",
            "session_id": "sess_001",
        })):
            response = await client.post("/api/chat/ask", data={
                "message": "Привет!",
                "client_id": "usr_test",
                "session_id": "sess_001",
            })

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "response" in data
        assert len(data["response"]) > 0

    @pytest.mark.asyncio
    async def test_ask_user_not_found(self, client):
        """Сообщение от несуществующего пользователя — ошибка."""
        with patch("api.chat.routers.chat_router.chat_service.process_ask", AsyncMock(return_value={
            "response": "Пользователь не найден",
            "status": "error",
        })):
            response = await client.post("/api/chat/ask", data={
                "message": "Привет!",
                "client_id": "usr_ghost",
                "session_id": "sess_001",
            })

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "error"

    @pytest.mark.asyncio
    async def test_ask_empty_message(self, client):
        """Пустое сообщение → 400."""
        response = await client.post("/api/chat/ask", data={
            "message": "",
            "client_id": "usr_test",
        })

        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_ask_stream_mode(self, client):
        """Стриминг-режим возвращает text/event-stream."""
        async def fake_stream():
            yield f"data: {json.dumps({'content': 'Привет'})}\n\n"
            yield f"data: {json.dumps({'content': ' мир!'})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"

        with patch("api.chat.routers.chat_router.chat_service.process_ask", AsyncMock(return_value=fake_stream())):
            response = await client.post("/api/chat/ask", data={
                "message": "Привет!",
                "client_id": "usr_test",
                "session_id": "sess_001",
                "stream": "true",
            })

        assert response.status_code == 200
        assert "text/event-stream" in response.headers.get("content-type", "")

    @pytest.mark.asyncio
    async def test_ask_with_contact_detection(self, client):
        """Сообщение с телефоном — сервис обрабатывает корректно."""
        with patch("api.chat.routers.chat_router.chat_service.process_ask", AsyncMock(return_value={
            "response": "Спасибо! Мы свяжемся с вами.",
            "status": "ok",
        })):
            response = await client.post("/api/chat/ask", data={
                "message": "Мой номер +7 999 123 45 67",
                "client_id": "usr_test",
                "session_id": "sess_002",
            })

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"

    @pytest.mark.asyncio
    async def test_ask_cache_hit(self, client):
        """Повторный вопрос — ответ из кэша."""
        with patch("api.chat.routers.chat_router.chat_service.process_ask", AsyncMock(return_value={
            "response": "Ответ из кэша!",
            "status": "ok",
        })):
            response = await client.post("/api/chat/ask", data={
                "message": "Какой у вас адрес?",
                "client_id": "usr_test",
                "session_id": "sess_003",
            })

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "Ответ из кэша" in data["response"]

    @pytest.mark.asyncio
    async def test_ask_limit_exceeded(self, client):
        """Лимит сообщений исчерпан → режим оператора."""
        with patch("api.chat.routers.chat_router.chat_service.process_ask", AsyncMock(return_value={
            "status": "waiting_for_operator",
            "response": "Ассистент временно недоступен, ожидайте ответа оператора.",
        })):
            response = await client.post("/api/chat/ask", data={
                "message": "Привет!",
                "client_id": "usr_test",
                "session_id": "sess_004",
            })

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "waiting_for_operator"

    @pytest.mark.asyncio
    async def test_stop_chat(self, client):
        """Принудительная остановка генерации."""
        response = await client.post("/api/chat/stop", json={
            "session_id": "sess_001",
            "last_text": "Неполный отв"
        })

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"

    @pytest.mark.asyncio
    async def test_history_endpoint(self, client):
        """Получение истории сообщений."""
        mock_session = MagicMock()

        # Патчим select в модуле db_service (он уже замокан, но history использует
        # локальный импорт from sqlalchemy import select внутри chat_router)
        with patch("sqlalchemy.select") as mock_select:
            mock_result = MagicMock()
            mock_result.scalar_one_or_none = MagicMock(return_value=mock_session)
            mock_select.return_value.where.return_value = mock_result

            with patch("api.chat.routers.chat_router.get_chat_history", AsyncMock(return_value=[
                {"role": "user", "content": "Привет!", "timestamp": "2024-01-01T00:00:00"},
                {"role": "assistant", "content": "Здравствуйте!", "timestamp": "2024-01-01T00:00:01"},
            ])):
                response = await client.get("/api/chat/history?token=sess_001&client_id=usr_test")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert len(data["history"]) == 2
        assert data["history"][0]["role"] == "user"

    @pytest.mark.asyncio
    async def test_ask_json_content_type(self, client):
        """Отправка через JSON (не FormData)."""
        with patch("api.chat.routers.chat_router.chat_service.process_ask", AsyncMock(return_value={
            "response": "Ответ через JSON",
            "status": "ok",
        })):
            response = await client.post(
                "/api/chat/ask",
                json={
                    "message": "Привет!",
                    "client_id": "usr_test",
                    "session_id": "sess_json",
                },
                headers={"Content-Type": "application/json"}
            )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
