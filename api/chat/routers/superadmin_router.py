from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import FileResponse
import os
from datetime import datetime, timedelta
import uuid
from sqlalchemy import select, update, delete, or_, text
from ..core.config import BASE_DIR, log
from ..services.db_service import AsyncSessionLocal, User, ClientConfig as DBClientConfig, mark_storage_items_deleted, add_balance_transaction
from .admin_router import verify_token
from ..services.clients import get_client_config, reload_client_config
from ..services.notify_service import send_email
import json

router = APIRouter(prefix="/api/chat/superadmin", tags=["superadmin"])


async def verify_superadmin(token_data: dict = Depends(verify_token)):
    """Доступ только для суперадмина (вход по SUPERADMIN_MASTER_TOKEN выдаёт role='superadmin')."""
    if token_data.get('role') != 'superadmin':
        raise HTTPException(status_code=403, detail="Superadmin access required")
    return token_data

@router.get("")
async def superadmin_page():
    """Страница суперадмина."""
    return FileResponse(os.path.join(BASE_DIR, "templates", "superadmin.html"))

@router.get("/users")
async def get_users(q: str = "", token_data: dict = Depends(verify_superadmin)):
    """Список всех пользователей системы."""
    search = q.strip().lower()
    async with AsyncSessionLocal() as db:
        stmt = select(User)
        if search:
            stmt = stmt.where(or_(User.email.ilike(f"%{search}%"), User.client_id.ilike(f"%{search}%")))
        stmt = stmt.order_by(User.created_at.desc())
        
        result = await db.execute(stmt)
        rows = result.scalars().all()
        
        users = []
        for user in rows:
            user_dict = {
                "id": user.id,
                "email": user.email,
                "client_id": user.client_id,
                "balance": user.balance,
                "created_at": user.created_at,
                "is_active": user.is_active,
                "is_verified": getattr(user, 'is_verified', True),
                "tariff": user.tariff_name,
                "tariff_expires_at": user.tariff_expires_at,
                "messages_consumed": user.messages_consumed,
                "auto_renew": user.auto_renew,
                "notifications": (await get_client_config(user.client_id, use_cache=False)).raw.get('notifications', {}),
                "total_paid": 0,
                "total_spent": user.messages_consumed,
                "indexed_pages": 0,
                "last_activity": user.created_at
            }
            
            try:
                cfg = await get_client_config(user.client_id, use_cache=False)
                user_dict["site_url"] = cfg.site_url if cfg else ""
            except:
                user_dict["site_url"] = ""
            users.append(user_dict)
            
    return {"status": "success", "users": users}

@router.post("/update_balance")
async def update_balance(request: Request, token_data: dict = Depends(verify_superadmin)):
    """Управление балансом пользователя."""
    data = await request.json()
    client_id = data.get('client_id')
    amount = data.get('amount')
    set_balance = data.get('set_balance')
    added_amount = 0.0

    async with AsyncSessionLocal() as db:
        current_result = await db.execute(select(User.balance).where(User.client_id == client_id))
        current_balance = current_result.scalar_one_or_none()

        if current_balance is None:
            return {"status": "error", "message": "Пользователь не найден"}

        if set_balance is not None:
            val = float(set_balance)
            added_amount = max(0.0, val - float(current_balance))
            await db.execute(
                update(User)
                .where(User.client_id == client_id)
                .values(balance=val)
            )
        elif amount is not None:
            val = float(amount)
            added_amount = max(0.0, val)
            await db.execute(
                update(User)
                .where(User.client_id == client_id)
                .values(balance=User.balance + val)
            )
        await db.commit()

    if added_amount > 0:
        await add_balance_transaction(
            client_id=client_id,
            amount=added_amount,
            source="superpanel",
            description="Начисление баланса из суперпанели"
        )

    await reload_client_config(client_id)
    return {"status": "success"}

@router.post("/set_tariff")
async def set_tariff(request: Request, token_data: dict = Depends(verify_superadmin)):
    """Смена тарифа пользователя."""
    data = await request.json()
    client_id = data.get('client_id')
    tariff_id = data.get('tariff_id')
    
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(User)
            .where(User.client_id == client_id)
            .values(tariff_name=tariff_id)
        )
        await db.commit()
    
    await reload_client_config(client_id)
    return {"status": "success"}

@router.post("/toggle_status")
async def toggle_status(request: Request, token_data: dict = Depends(verify_superadmin)):
    """Включение/выключение пользователя и его виджета."""
    data = await request.json()
    client_id = data.get('client_id')
    active = data.get('active')
    
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(User)
            .where(User.client_id == client_id)
            .values(is_active=bool(active))
        )
        
        res = await db.execute(select(DBClientConfig).where(DBClientConfig.client_id == client_id))
        cfg_obj = res.scalar_one_or_none()
        if cfg_obj:
            config = cfg_obj.config_json or {}
            config['widget_enabled'] = bool(active)
            if not isinstance(config.get('theme'), dict):
                config['theme'] = {}
            config['theme']['widget_enabled'] = bool(active)
            cfg_obj.config_json = config
        
        await db.commit()
    
    await reload_client_config(client_id)
    return {"status": "success"}

@router.post("/security-reset")
async def security_reset(request: Request, token_data: dict = Depends(verify_superadmin)):
    """Экстренная защита: сначала письмо, затем блокировка и фиксация reset-token."""
    data = await request.json()
    client_id = data.get('client_id')
    disable_account = bool(data.get('disable_account', True))

    if not client_id:
        return {"status": "error", "message": "client_id обязателен"}

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.client_id == client_id))
        user = result.scalar_one_or_none()
        if not user:
            return {"status": "error", "message": "Пользователь не найден"}

        reset_token = f"rl_{uuid.uuid4().hex}"
        user_email = user.email

        base_url = str(request.base_url).replace("127.0.0.1", "localhost").replace("www.localhost", "localhost")
        reset_url = f"{base_url}login?reset_token={reset_token}"

        body = (
            f"Служба безопасности mitia инициировала экстренный сброс пароля для вашего аккаунта.\n\n"
            f"Чтобы восстановить доступ, нажмите кнопку ниже:\n\n"
            f'<a href="{reset_url}" style="display: inline-block; padding: 14px 32px; '
            f'background-color: #ff3300; color: #ffffff; text-decoration: none; '
            f'border-radius: 8px; font-size: 16px; font-weight: 600; '
            f'font-family: -apple-system, BlinkMacSystemFont, sans-serif;">Восстановить доступ</a>'
            f"\n\nЕсли это действие выполнено не вами, срочно свяжитесь с поддержкой."
        )

        email_sent = await send_email(user_email, "Экстренный сброс пароля — mitia", body)
        if not email_sent:
            return {
                "status": "error",
                "message": "Не удалось отправить письмо. Изменения в аккаунт не внесены."
            }

        user.verification_token = reset_token
        user.verification_token_created_at = datetime.utcnow()

        if disable_account:
            user.is_active = False
            cfg_res = await db.execute(select(DBClientConfig).where(DBClientConfig.client_id == client_id))
            cfg_obj = cfg_res.scalar_one_or_none()
            if cfg_obj:
                cfg = cfg_obj.config_json or {}
                cfg['widget_enabled'] = False
                if not isinstance(cfg.get('theme'), dict):
                    cfg['theme'] = {}
                cfg['theme']['widget_enabled'] = False
                cfg_obj.config_json = cfg

        await db.commit()

    if disable_account:
        await reload_client_config(client_id)

    return {
        "status": "success",
        "message": "Инструкция по восстановлению отправлена. Аккаунт временно деактивирован.",
        "disabled": disable_account
    }

@router.post("/extend_tariff")
async def extend_tariff(request: Request, token_data: dict = Depends(verify_superadmin)):
    """Продление тарифа пользователя на 30 дней."""
    data = await request.json()
    client_id = data.get('client_id')
    days = data.get('days', 30)
    
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.client_id == client_id))
        user = result.scalar_one_or_none()
        
        if user:
            now = datetime.now()
            current_expiry = user.tariff_expires_at
            
            if not current_expiry or current_expiry < now:
                current_expiry = now
            
            new_expiry = current_expiry + timedelta(days=days)
            
            await db.execute(
                update(User)
                .where(User.client_id == client_id)
                .values(tariff_expires_at=new_expiry)
            )
            await db.commit()
            log.info(f"Tariff extended for {client_id} until {new_expiry}")
            return {"status": "success", "new_expiry": new_expiry.isoformat()}
            
    return {"status": "error", "message": "User not found"}

@router.post("/reset_tariff")
async def reset_tariff(request: Request, token_data: dict = Depends(verify_superadmin)):
    """Аннулирование тарифа (сброс даты и установка Старта)."""
    data = await request.json()
    client_id = data.get('client_id')
    
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(User)
            .where(User.client_id == client_id)
            .values(
                tariff_name="start",
                tariff_expires_at=None,
                messages_consumed=0,
                is_active=True
            )
        )
        await db.commit()
            
    await reload_client_config(client_id)
    return {"status": "success"}

@router.post("/delete_user")
async def delete_user(request: Request, token_data: dict = Depends(verify_superadmin)):
    """Полное удаление пользователя и всех его данных."""
    data = await request.json()
    client_id = data.get('client_id')
    
    from ..services.db_service import ChatSession, ChatMessage, Lead, SitePage
    async with AsyncSessionLocal() as db:
        # Сначала сообщения чата (через session_id из ChatSession)
        from sqlalchemy import select as sa_select
        session_ids_subq = sa_select(ChatSession.session_id).where(ChatSession.client_id == client_id)
        await db.execute(delete(ChatMessage).where(ChatMessage.session_id.in_(session_ids_subq)))
        # Сессии чата
        await db.execute(delete(ChatSession).where(ChatSession.client_id == client_id))
        # Лиды
        await db.execute(delete(Lead).where(Lead.client_id == client_id))
        # Проиндексированные страницы сайта (SiteTerm удалятся каскадом FK)
        await db.execute(delete(SitePage).where(SitePage.client_id == client_id))
        # Конфиг и пользователь
        await db.execute(delete(DBClientConfig).where(DBClientConfig.client_id == client_id))
        await db.execute(delete(User).where(User.client_id == client_id))
        await db.commit()

    # Помечаем все StorageItem как удалённые
    import asyncio
    asyncio.create_task(mark_storage_items_deleted(client_id=client_id))

    return {"status": "success"}
