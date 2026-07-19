from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import RedirectResponse, JSONResponse
import uuid
import os
import json
import hashlib
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, update, insert, delete
from ..core.config import (
    BASE_DIR, log, create_access_token, ACCESS_TOKEN_EXPIRE_MINUTES,
    get_password_hash, verify_password, TARIFF_RULES
)
from ..services.notify_service import send_email
from ..services.notification_service import notify_welcome_news
from ..routers.superadmin_router import get_registration_lock_settings
from ..services.db_service import AsyncSessionLocal, User, ClientConfig as DBClientConfig, StorageItem

from ..routers.admin_router import verify_token

router = APIRouter(prefix="/api/chat", tags=["auth"])

@router.post("/profile/auto-renew")
async def toggle_auto_renew(request: Request, token_data: dict = Depends(verify_token)):
    """Переключение автопродления тарифа."""
    data = await request.json()
    enabled = data.get('enabled', False)
    client_id = token_data.get('sub')

    async with AsyncSessionLocal() as db:
        await db.execute(
            update(User)
            .where(User.client_id == client_id)
            .values(auto_renew=enabled)
        )
        await db.commit()

    return {"status": "success", "auto_renew": enabled}

@router.post("/register")
async def register_user(request: Request):
    """Регистрация нового пользователя в PostgreSQL."""
    registration_lock = get_registration_lock_settings()
    if registration_lock.get("enabled"):
        return {"status": "error", "message": registration_lock.get("message") or "Регистрация временно недоступна", "registration_locked": True}
    data = await request.json()
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')
    
    if not email or not password:
        return {"status": "error", "message": "Email и пароль обязательны"}

    mail_configured = bool(os.environ.get('MAIL_PASSWORD', '').strip())
    now = datetime.utcnow()

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == email))
        existing_user = result.scalar_one_or_none()
        
        if existing_user:
            if existing_user.is_verified:
                return {"status": "error", "message": "Пользователь с таким Email уже существует"}
            v_token = uuid.uuid4().hex
            existing_user.verification_token = v_token
            existing_user.verification_token_created_at = now
            existing_user.password_hash = get_password_hash(password)
            if not mail_configured:
                existing_user.is_verified = True
                existing_user.verification_token = None
                existing_user.verification_token_created_at = None
            await db.commit()
            client_id = existing_user.client_id
        else:
            client_id = f"usr_{uuid.uuid4().hex[:12]}"
            v_token = uuid.uuid4().hex
            pwd_hash = get_password_hash(password)

            new_user = User(
                email=email,
                password_hash=pwd_hash,
                client_id=client_id,
                verification_token=v_token if mail_configured else None,
                verification_token_created_at=now if mail_configured else None,
                is_verified=not mail_configured,
                balance=0.0,
                tariff_name="start",
                messages_consumed=0,
                start_trial_messages_used=0,
                messages_reset_at=None,
                is_active=True
            )
            db.add(new_user)
            await db.commit()
            try:
                await notify_welcome_news(client_id)
            except Exception as e:
                log.error(f"Failed to create welcome notification for {client_id}: {e}")

    if not mail_configured:
        log.warning("MAIL_PASSWORD is not set: user registered as verified without email confirmation")
        return {
            "status": "success",
            "message": "Регистрация успешна! Можно войти в аккаунт.",
            "auto_verified": True,
        }

    base_url = str(request.base_url).replace("127.0.0.1", "localhost").replace("www.localhost", "localhost")
    verify_url = f"{base_url}verify-email?token={v_token}"
    
    body = (
        f"Добро пожаловать на платформу MITIA!\n\n"
        f"Чтобы подтвердить регистрацию, нажмите на кнопку ниже:\n\n"
        f'<a href="{verify_url}" style="display: inline-block; padding: 14px 32px; '
        f'background-color: #ff3300; color: #ffffff; text-decoration: none; '
        f'border-radius: 8px; font-size: 16px; font-weight: 600; '
        f'font-family: -apple-system, BlinkMacSystemFont, sans-serif;">Подтвердить</a>'
        f"\n\nЕсли вы не регистрировались на платформе MITIA, просто проигнорируйте это письмо."
    )
    
    try:
        await send_email(
            email, 
            "Подтверждение регистрации MITIA", 
            body
        )
    except Exception as e:
        log.error(f"Failed to send verification email to {email}: {e}")
    
    return {"status": "success", "message": "Регистрация успешна! Проверьте почту для подтверждения."}

@router.post("/login-user")
async def login_user_route(request: Request):
    """Вход в систему через PostgreSQL."""
    data = await request.json()
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')
    
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(User).where(User.email == email)
        )
        user = result.scalar_one_or_none()
        
        if not user or not verify_password(password, user.password_hash):
            return {"status": "error", "message": "Неверный Email или пароль"}
        
        if not user.is_verified:
            return {"status": "error", "message": "Подтвердите Email перед входом"}

        access_token = create_access_token(
            data={"sub": user.client_id, "email": email}
        )
        return {"status": "success", "token": access_token, "client_id": user.client_id}

@router.get("/verify-email")
async def verify_email(token: str):
    """Подтверждение Email в PostgreSQL."""
    if not token:
        raise HTTPException(status_code=400, detail="Токен не найден")
    
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.verification_token == token))
        user = result.scalar_one_or_none()
        
        if not user:
            return RedirectResponse(url="/login?verify_error=true")
        
        if user.verification_token_created_at:
            if datetime.utcnow() - user.verification_token_created_at > timedelta(hours=24):
                user.verification_token = None
                user.verification_token_created_at = None
                await db.commit()
                return RedirectResponse(url="/login?verify_error=true")
        
        user.is_verified = True
        user.verification_token = None
        user.verification_token_created_at = None
        user.tariff_name = "start"
        user.messages_consumed = 0
        user.messages_reset_at = datetime.utcnow() + timedelta(days=TARIFF_RULES["start"]["reset_period_days"])

        theme_path = os.path.join(BASE_DIR, "core", "theme_defaults.json")
        intel_path = os.path.join(BASE_DIR, "core", "intelligence_defaults.json")
        default_json = {}
        try:
            with open(theme_path, "r", encoding="utf-8") as f:
                default_json = json.load(f)
            with open(intel_path, "r", encoding="utf-8") as f:
                default_json.update(json.load(f))
        except Exception as e:
            log.error(f"Failed to load theme/intelligence defaults: {e}")
        
        if default_json:
            cfg_result = await db.execute(select(DBClientConfig).where(DBClientConfig.client_id == user.client_id))
            existing_cfg = cfg_result.scalar_one_or_none()
            if existing_cfg:
                existing_cfg.config_json = default_json
            else:
                new_cfg = DBClientConfig(client_id=user.client_id, config_json=default_json)
                db.add(new_cfg)

        await db.commit()
    
    welcome_body = (
        f"Добро пожаловать на платформу MITIA!\n\n"
        f"Ваш аккаунт успешно подтверждён. Теперь вам доступны все возможности:\n\n"
        f"— Создание и настройка ИИ-ассистента\n"
        f"— Виджет для сайта и интеграции каналов связи\n"
        f"— Обучение на ваших документах и базе знаний\n"
        f"— Аналитика диалогов, статистика и рекомендации\n\n"
        f"Чтобы начать, войдите в панель управления."
    )
    try:
        await send_email(user.email, "Добро пожаловать в MITIA", welcome_body)
    except Exception as e:
        log.error(f"Failed to send welcome email to {user.email}: {e}")
    
    return RedirectResponse(url="/login?verify_success=true")

from ..routers.admin_router import verify_token

@router.post("/profile/change-email")
async def change_email_route(request: Request, token_data: dict = Depends(verify_token)):
    """Смена email авторизованного пользователя."""
    data = await request.json()
    new_email = data.get('new_email', '').strip().lower()
    password = data.get('password', '')
    client_id = token_data['sub']

    if not new_email:
        return {"status": "error", "message": "Новый Email обязателен"}

    if not password:
        return {"status": "error", "message": "Подтвердите пароль"}

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.client_id == client_id))
        user = result.scalar_one_or_none()

        if not user or not verify_password(password, user.password_hash):
            return {"status": "error", "message": "Пароль указан неверно"}

        existing = await db.execute(select(User).where(User.email == new_email))
        if existing.scalar_one_or_none():
            return {"status": "error", "message": "Этот Email уже используется"}

        old_email = user.email

        user.email = new_email
        await db.commit()

        notify_body = (
            f"Email вашего аккаунта на платформе MITIA был изменён на {new_email}.\n\n"
            f"Если это были не вы, немедленно свяжитесь с поддержкой."
        )
        old_email_sent = False
        try:
            old_email_sent = await send_email(old_email, "Email изменён — MITIA", notify_body)
            if not old_email_sent:
                old_email_sent = await send_email(old_email, "Email изменён — MITIA", notify_body)
        except Exception as e:
            log.error(f"Failed to send email change notice to {old_email}: {e}")

        new_email_body = (
            f"Вы успешно изменили email аккаунта на платформе MITIA.\n\n"
            f"Новый адрес: {new_email}\n\n"
            f"Если это были не вы, немедленно свяжитесь с поддержкой."
        )
        new_email_sent = False
        try:
            new_email_sent = await send_email(new_email, "Ваш email на MITIA обновлён", new_email_body)
            if not new_email_sent:
                new_email_sent = await send_email(new_email, "Ваш email на MITIA обновлён", new_email_body)
        except Exception as e:
            log.error(f"Failed to send email change confirmation to {new_email}: {e}")

        if not old_email_sent:
            log.error(f"Email change notice was not delivered to old email: {old_email}")
        if not new_email_sent:
            log.error(f"Email change notice was not delivered to new email: {new_email}")

        return {"status": "success", "message": "Email успешно изменён"}


@router.post("/profile/delete-account")
async def delete_account_route(request: Request, token_data: dict = Depends(verify_token)):
    """Удаление аккаунта пользователя."""
    data = await request.json()
    password = data.get('password', '')
    client_id = token_data['sub']

    if not password:
        return {"status": "error", "message": "Подтвердите пароль"}

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.client_id == client_id))
        user = result.scalar_one_or_none()

        if not user or not verify_password(password, user.password_hash):
            return {"status": "error", "message": "Пароль указан неверно"}

        user_email = user.email

    # A notification failure must not keep a user account alive against an
    # explicit irreversible deletion request.
    try:
        await send_email(
            user_email,
            "Аккаунт удалён — MITIA",
            "По вашему запросу аккаунт на платформе MITIA был удалён без возможности восстановления.",
        )
    except Exception as exc:
        log.warning("Failed to send account deletion email to %s: %s", user_email, exc)

    try:
        from ..services.account_deletion_service import delete_client_account
        await delete_client_account(client_id)
    except Exception:
        log.exception("Account deletion failed for %s", client_id)
        return JSONResponse(
            status_code=500,
            content={"status": "error", "message": "Не удалось удалить аккаунт. Повторите попытку позже."},
        )

    return {"status": "success", "message": "Аккаунт удалён"}


@router.post("/update-password")
async def update_password_route(request: Request, token_data: dict = Depends(verify_token)):
    """Смена пароля авторизованного пользователя."""
    data = await request.json()
    old_password = data.get('old_password', '')
    new_password = data.get('password', '')
    client_id = token_data['sub']
    
    if not new_password or len(new_password) < 6:
        return {"status": "error", "message": "Минимум 6 символов"}

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.client_id == client_id))
        user = result.scalar_one_or_none()
        
        if not user or not verify_password(old_password, user.password_hash):
            return {"status": "error", "message": "Пароль указан неверно"}

        pwd_hash = get_password_hash(new_password)
        
        try:
            await db.execute(
                update(User)
                .where(User.client_id == client_id)
                .values(password_hash=pwd_hash)
            )
            await db.commit()
            
            notify_body = (
                f"Пароль от вашего аккаунта на платформе MITIA был успешно изменён.\n\n"
                f"Если это были не вы, немедленно свяжитесь с поддержкой."
            )
            try:
                await send_email(user.email, "Пароль изменён — MITIA", notify_body)
            except Exception as e:
                log.error(f"Failed to send password change email to {user.email}: {e}")
            
            return {"status": "success", "message": "Пароль изменен"}
        except Exception as e:
            log.error(f"Error updating password for {client_id}: {e}")
            return {"status": "error", "message": "Ошибка при обновлении пароля"}

@router.post("/reset-password")
async def reset_password(request: Request):
    """Сброс пароля: генерация токена и отправка письма."""
    data = await request.json()
    email = data.get('email', '').strip().lower()
    if not email:
        return {"status": "error", "message": "Email обязателен"}
    
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        
        if not user:
            return {"status": "success", "message": "Если такой Email зарегистрирован, инструкции отправлены"}

        reset_token = f"rl_{uuid.uuid4().hex}"
        user.verification_token = reset_token
        user.verification_token_created_at = datetime.utcnow()
        await db.commit()

    base_url = str(request.base_url).replace("127.0.0.1", "localhost").replace("www.localhost", "localhost")
    reset_url = f"{base_url}login?reset_token={reset_token}"
    
    body = (
        f"Вы запросили сброс пароля на платформе MITIA.\n\n"
        f"Чтобы установить новый пароль, нажмите на кнопку ниже:\n\n"
        f'<a href="{reset_url}" style="display: inline-block; padding: 14px 32px; '
        f'background-color: #ff3300; color: #ffffff; text-decoration: none; '
        f'border-radius: 8px; font-size: 16px; font-weight: 600; '
        f'font-family: -apple-system, BlinkMacSystemFont, sans-serif;">Сбросить пароль</a>'
        f"\n\nЕсли вы не запрашивали сброс пароля, просто проигнорируйте это письмо."
    )
    
    await send_email(
        email, 
        "Восстановление пароля MITIA", 
        body
    )
    
    return {"status": "success", "message": "Проверьте почту"}

@router.post("/confirm-reset")
async def confirm_reset(request: Request):
    """Установка нового пароля по токену."""
    data = await request.json()
    token = data.get('token')
    new_password = data.get('password')

    if not token or not new_password or len(new_password) < 6:
        return {"status": "error", "message": "Некорректные данные"}
    if not token.startswith("ra_"):
        return {"status": "error", "message": "Ссылка недействительна"}

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.verification_token == token))
        user = result.scalar_one_or_none()

        if not user:
            return {"status": "error", "message": "Ссылка недействительна"}
        
        if user.verification_token_created_at:
            if datetime.utcnow() - user.verification_token_created_at > timedelta(hours=24):
                user.verification_token = None
                user.verification_token_created_at = None
                await db.commit()
                return {"status": "error", "message": "Ссылка недействительна"}

        user.password_hash = get_password_hash(new_password)
        user.verification_token = None
        user.verification_token_created_at = None
        user.is_active = True

        cfg_result = await db.execute(select(DBClientConfig).where(DBClientConfig.client_id == user.client_id))
        cfg = cfg_result.scalar_one_or_none()
        if cfg:
            cfg_json = cfg.config_json or {}
            cfg_json['widget_enabled'] = True
            cfg.config_json = cfg_json

        await db.commit()

    notify_body = (
        f"Пароль от вашего аккаунта на платформе MITIA был успешно изменён.\n\n"
        f"Если это были не вы, немедленно свяжитесь с поддержкой."
    )
    try:
        await send_email(user.email, "Пароль изменён — MITIA", notify_body)
    except Exception as e:
        log.error(f"Failed to send password change email to {user.email}: {e}")

    return {
        "status": "success", 
        "message": "Пароль изменен"
    }

@router.get("/check-reset-token")
async def check_reset_token(token: str):
    """Проверка валидности токена сброса пароля.
    Строго один клик: link-токен (rl_) при первой проверке сразу ротируется в apply-токен (ra_)."""
    if not token or not token.startswith(("rl_", "ra_")):
        return {"status": "error"}

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.verification_token == token))
        user = result.scalar_one_or_none()
        if not user:
            return {"status": "error"}

        if user.verification_token_created_at:
            if datetime.utcnow() - user.verification_token_created_at > timedelta(hours=24):
                user.verification_token = None
                user.verification_token_created_at = None
                await db.commit()
                return {"status": "error"}

        if token.startswith("ra_"):
            return {"status": "success", "apply_token": token}

        apply_token = f"ra_{uuid.uuid4().hex}"
        user.verification_token = apply_token
        user.verification_token_created_at = datetime.utcnow()
        await db.commit()
        return {"status": "success", "apply_token": apply_token}
