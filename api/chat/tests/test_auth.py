"""
Тесты авторизации: регистрация, вход, JWT.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestAuth:
    """Регистрация и вход."""

    @pytest.mark.asyncio
    async def test_register_new_user(self, client):
        """Регистрация нового пользователя — успех."""
        # Мокаем: пользователь не найден (новый)
        with patch("api.chat.routers.auth_router.select") as mock_select:
            mock_result = MagicMock()
            mock_result.scalar_one_or_none = MagicMock(return_value=None)
            mock_select.return_value.where.return_value = mock_result

            response = await client.post("/api/chat/register", json={
                "email": "test@example.com",
                "password": "securepass123"
            })

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "Регистрация успешна" in data["message"]

    @pytest.mark.asyncio
    async def test_register_duplicate_email(self, client):
        """Регистрация с уже существующим email — ошибка."""
        with patch("api.chat.routers.auth_router.select") as mock_select:
            mock_result = AsyncMock()
            mock_result.scalar_one_or_none = MagicMock(return_value=MagicMock())
            mock_select.return_value.where.return_value = mock_result

            response = await client.post("/api/chat/register", json={
                "email": "exists@example.com",
                "password": "securepass123"
            })

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "error"
        assert "уже существует" in data["message"]

    @pytest.mark.asyncio
    async def test_register_empty_fields(self, client):
        """Регистрация с пустыми полями — ошибка."""
        response = await client.post("/api/chat/register", json={
            "email": "",
            "password": ""
        })

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "error"

    @pytest.mark.asyncio
    async def test_login_success(self, client):
        """Успешный вход — возвращает JWT токен."""
        mock_user = MagicMock()
        mock_user.client_id = "usr_test123456"
        mock_user.email = "test@example.com"
        mock_user.password_hash = "pbkdf2:sha256:100000$salt$hash"
        mock_user.is_verified = True

        with patch("api.chat.routers.auth_router.select") as mock_select:
            mock_result = MagicMock()
            mock_result.scalar_one_or_none = MagicMock(return_value=mock_user)
            mock_select.return_value.where.return_value = mock_result

            with patch("api.chat.routers.auth_router.verify_password", return_value=True):
                response = await client.post("/api/chat/login-user", json={
                    "email": "test@example.com",
                    "password": "securepass123"
                })

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "token" in data
        assert data["client_id"] == "usr_test123456"
        assert len(data["token"]) > 20

    @pytest.mark.asyncio
    async def test_login_wrong_password(self, client):
        """Вход с неверным паролем — ошибка."""
        mock_user = MagicMock()
        mock_user.password_hash = "pbkdf2:sha256:100000$salt$hash"
        mock_user.is_verified = True

        with patch("api.chat.routers.auth_router.select") as mock_select:
            mock_result = MagicMock()
            mock_result.scalar_one_or_none = MagicMock(return_value=mock_user)
            mock_select.return_value.where.return_value = mock_result

            with patch("api.chat.routers.auth_router.verify_password", return_value=False):
                response = await client.post("/api/chat/login-user", json={
                    "email": "test@example.com",
                    "password": "wrongpass"
                })

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "error"

    @pytest.mark.asyncio
    async def test_login_unverified_email(self, client):
        """Вход с неподтверждённой почтой — ошибка."""
        mock_user = MagicMock()
        mock_user.password_hash = "pbkdf2:sha256:100000$salt$hash"
        mock_user.is_verified = False

        with patch("api.chat.routers.auth_router.select") as mock_select:
            mock_result = MagicMock()
            mock_result.scalar_one_or_none = MagicMock(return_value=mock_user)
            mock_select.return_value.where.return_value = mock_result

            with patch("api.chat.routers.auth_router.verify_password", return_value=True):
                response = await client.post("/api/chat/login-user", json={
                    "email": "unverified@example.com",
                    "password": "securepass123"
                })

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "error"
        assert "Подтвердите" in data["message"]

    @pytest.mark.asyncio
    async def test_jwt_token_structure(self, client):
        """JWT токен содержит правильные поля."""
        import jwt
        from api.chat.core.config import JWT_SECRET, JWT_ALGORITHM

        mock_user = MagicMock()
        mock_user.client_id = "usr_jwt_test_1"
        mock_user.email = "jwt@example.com"
        mock_user.password_hash = "pbkdf2:sha256:100000$salt$hash"
        mock_user.is_verified = True

        with patch("api.chat.routers.auth_router.select") as mock_select:
            mock_result = MagicMock()
            mock_result.scalar_one_or_none = MagicMock(return_value=mock_user)
            mock_select.return_value.where.return_value = mock_result

            with patch("api.chat.routers.auth_router.verify_password", return_value=True):
                response = await client.post("/api/chat/login-user", json={
                    "email": "jwt@example.com",
                    "password": "securepass123"
                })

        data = response.json()
        token = data["token"]
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])

        assert payload["sub"] == "usr_jwt_test_1"
        assert payload["email"] == "jwt@example.com"
        assert "exp" in payload

    @pytest.mark.asyncio
    async def test_create_payment_rejects_other_tenant(self):
        """Нельзя создать платёж от имени другого аккаунта."""
        from fastapi import HTTPException
        from api.chat.routers.payment_router import create_payment

        request = MagicMock()
        request.json = AsyncMock(return_value={"amount": 100, "client_id": "usr_other"})

        with pytest.raises(HTTPException) as error:
            await create_payment(
                request=request,
                token_data={"sub": "usr_current"},
            )

        assert error.value.status_code == 403

    @pytest.mark.asyncio
    async def test_create_payment_rejects_negative_amount(self):
        """Отрицательная сумма не отправляется в платёжный сервис."""
        from api.chat.routers.payment_router import create_payment

        request = MagicMock()
        request.json = AsyncMock(return_value={"amount": -100, "client_id": "usr_current"})
        response = await create_payment(
            request=request,
            token_data={"sub": "usr_current"},
        )

        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_confirm_reset_rejects_email_verification_token(self, client):
        """Токен подтверждения почты нельзя использовать для смены пароля."""
        response = await client.post("/api/chat/confirm-reset", json={
            "token": "email-verification-token",
            "password": "new-secure-password",
        })

        assert response.status_code == 200
        assert response.json()["status"] == "error"

    @pytest.mark.asyncio
    async def test_check_reset_token_rejects_email_verification_token(self, client):
        """Проверка reset-ссылки принимает только reset-токены."""
        response = await client.get(
            "/api/chat/check-reset-token",
            params={"token": "email-verification-token"},
        )

        assert response.status_code == 200
        assert response.json()["status"] == "error"
