from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import FileResponse
import os
from datetime import datetime, timedelta
import uuid
from sqlalchemy import select, update, delete, or_, text, func, desc
from ..core.config import BASE_DIR, TARIFF_RULES, log
from ..services.db_service import AsyncSessionLocal, User, ClientConfig as DBClientConfig, BalanceTransaction, ClientCustomCondition, mark_storage_items_deleted, add_balance_transaction
from .admin_router import verify_token
from .admin.deps import (
    SUPERADMIN_LOCK_PREFIX,
    SUPERADMIN_UNLOCKED_PREFIX,
    SUPERADMIN_UNLOCK_WINDOW_MINUTES,
    SUPERADMIN_UNLOCK_CODE_ENV,
    get_superadmin_lock_scope,
    get_superadmin_request_fingerprint,
    get_superadmin_access_state,
)
from ..services.cache_service import cache_service
from ..services.clients import get_client_config, reload_client_config
from ..services.notify_service import send_email
from ..services.notification_service import (
    notify_balance_topped_up,
    publish_platform_news,
    create_notification,
    notify_security_event,
    notify_personal_tariff_assigned,
    notify_tariff_changed,
    notify_tariff_downgraded,
    list_manual_superadmin_news,
    update_manual_superadmin_news,
    delete_manual_superadmin_news,
)
from ..services.notify_service import send_email
from ..services.assistants_service import get_effective_account_limits
import json

router = APIRouter(prefix="/api/chat/superadmin", tags=["superadmin"])

REGISTRATION_LOCK_CACHE_KEY = "platform:registration_lock"
REGISTRATION_LOCK_DEFAULT = {
    "enabled": False,
    "title": "Регистрация временно недоступна",
    "message": "Мы временно закрыли регистрацию новых пользователей. Попробуйте позже.",
}


def get_registration_lock_settings() -> dict:
    try:
        data = cache_service.get(REGISTRATION_LOCK_CACHE_KEY)
    except Exception:
        data = None
    if not isinstance(data, dict):
        return dict(REGISTRATION_LOCK_DEFAULT)
    return {
        "enabled": bool(data.get("enabled", False)),
        "title": str(data.get("title") or REGISTRATION_LOCK_DEFAULT["title"]),
        "message": str(data.get("message") or REGISTRATION_LOCK_DEFAULT["message"]),
    }


def _serialize_custom_condition(row: ClientCustomCondition) -> dict:
    return {
        "id": row.id,
        "client_id": row.client_id,
        "extra_messages": int(row.extra_messages or 0),
        "extra_assistants": int(row.extra_assistants or 0),
        "extra_messages_limit": int(row.extra_messages_limit or 0),
        "extra_storage_bytes": int(row.extra_storage_bytes or 0),
        "extra_context_limit": int(row.extra_context_limit or 0),
        "extra_index_pages": int(row.extra_index_pages or 0),
        "extra_assistants_hard_cap": int(row.extra_assistants_hard_cap or 0),
        "extend_days": int(row.extend_days or 0),
        "expires_at_override": row.expires_at_override.isoformat() if row.expires_at_override else None,
        "reason_comment": row.reason_comment or "",
        "created_by": row.created_by or "",
        "is_active": bool(row.is_active),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _coerce_signed_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _build_personal_tariff_summary(*, extra_messages: int, extra_assistants: int, extra_messages_limit: int, extra_storage_gb: int, extra_context_limit: int, extra_index_pages: int, extra_assistants_hard_cap: int, expires_at_override, extend_days: int) -> tuple[str, str]:
    parts = []
    if extra_messages:
        parts.append(f"дополнительные сообщения: {extra_messages:+d}")
    if extra_assistants:
        parts.append(f"дополнительные ассистенты: {extra_assistants:+d}")
    if extra_messages_limit:
        parts.append(f"лимит сообщений ИИ: +{extra_messages_limit}")
    if extra_storage_gb:
        parts.append(f"хранилище: +{extra_storage_gb} ГБ")
    if extra_context_limit:
        parts.append(f"контекст памяти ИИ: +{extra_context_limit}")
    if extra_index_pages:
        parts.append(f"страницы индексации: +{extra_index_pages}")
    if extra_assistants_hard_cap:
        parts.append(f"тех. потолок ассистентов: +{extra_assistants_hard_cap}")
    if expires_at_override:
        parts.append(f"срок действия: до {expires_at_override.strftime('%d.%m.%Y')}")
    elif extend_days:
        parts.append(f"продление тарифа: на {extend_days} дн.")

    title = "Индивидуальные условия обновлены"
    if not parts:
        body = "Для вашего аккаунта активированы индивидуальные условия. Подробности доступны в панели управления."
    else:
        body = "Для вашего аккаунта активированы индивидуальные условия:\n\n— " + "\n— ".join(parts) + "\n\nИзменения уже доступны в панели управления."
    return title, body


async def _recalculate_user_custom_condition_effects(db, user: User):
    result = await db.execute(
        select(ClientCustomCondition)
        .where(
            ClientCustomCondition.client_id == user.client_id,
            ClientCustomCondition.is_active.is_(True),
        )
        .order_by(desc(ClientCustomCondition.created_at))
    )
    active_conditions = result.scalars().all()

    total_extra_messages = sum(int(row.extra_messages or 0) for row in active_conditions)
    total_extra_assistants = sum(int(row.extra_assistants or 0) for row in active_conditions)
    total_extra_messages_limit = sum(int(row.extra_messages_limit or 0) for row in active_conditions)
    total_extra_storage_bytes = sum(int(row.extra_storage_bytes or 0) for row in active_conditions)
    total_extra_context_limit = sum(int(row.extra_context_limit or 0) for row in active_conditions)
    total_extra_index_pages = sum(int(row.extra_index_pages or 0) for row in active_conditions)
    total_extra_assistants_hard_cap = sum(int(row.extra_assistants_hard_cap or 0) for row in active_conditions)

    user.extra_messages_purchased = total_extra_messages
    user.extra_assistants_purchased = total_extra_assistants
    user.extra_messages_limit = total_extra_messages_limit
    user.extra_storage_bytes = total_extra_storage_bytes
    user.extra_context_limit = total_extra_context_limit
    user.extra_index_pages = total_extra_index_pages
    user.extra_assistants_hard_cap = total_extra_assistants_hard_cap

    latest_override = next((row for row in active_conditions if row.expires_at_override), None)
    if latest_override and latest_override.expires_at_override:
        user.tariff_expires_at = latest_override.expires_at_override


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
        # The legacy system client exists only for backward compatibility and is
        # not a customer account that should be managed from the superpanel.
        stmt = select(User).where(User.client_id != 'mitia_assistant')
        if search:
            stmt = stmt.where(or_(User.email.ilike(f"%{search}%"), User.client_id.ilike(f"%{search}%")))
        stmt = stmt.order_by(User.created_at.desc())

        result = await db.execute(stmt)
        rows = result.scalars().all()
        client_ids = [user.client_id for user in rows]

        payments_totals = {}
        manual_totals = {}
        spent_totals = {}
        last_payments = {}
        recent_transactions = {}
        custom_conditions_map = {}

        if client_ids:
            payments_rows = await db.execute(
                select(BalanceTransaction.client_id, func.coalesce(func.sum(BalanceTransaction.amount), 0.0))
                .where(
                    BalanceTransaction.client_id.in_(client_ids),
                    BalanceTransaction.amount > 0,
                    BalanceTransaction.source != 'superpanel',
                )
                .group_by(BalanceTransaction.client_id)
            )
            payments_totals = {client_id: float(total or 0) for client_id, total in payments_rows.all()}

            manual_rows = await db.execute(
                select(BalanceTransaction.client_id, func.coalesce(func.sum(BalanceTransaction.amount), 0.0))
                .where(
                    BalanceTransaction.client_id.in_(client_ids),
                    BalanceTransaction.amount > 0,
                    BalanceTransaction.source == 'superpanel',
                )
                .group_by(BalanceTransaction.client_id)
            )
            manual_totals = {client_id: float(total or 0) for client_id, total in manual_rows.all()}

            spent_rows = await db.execute(
                select(BalanceTransaction.client_id, func.coalesce(func.sum(BalanceTransaction.amount), 0.0))
                .where(
                    BalanceTransaction.client_id.in_(client_ids),
                    BalanceTransaction.amount < 0,
                )
                .group_by(BalanceTransaction.client_id)
            )
            spent_totals = {client_id: abs(float(total or 0)) for client_id, total in spent_rows.all()}

            for client_id in client_ids:
                last_payment_result = await db.execute(
                    select(BalanceTransaction)
                    .where(
                        BalanceTransaction.client_id == client_id,
                        BalanceTransaction.amount > 0,
                        BalanceTransaction.source != 'superpanel',
                    )
                    .order_by(BalanceTransaction.created_at.desc())
                    .limit(1)
                )
                last_payments[client_id] = last_payment_result.scalar_one_or_none()

                tx_result = await db.execute(
                    select(BalanceTransaction)
                    .where(BalanceTransaction.client_id == client_id)
                    .order_by(BalanceTransaction.created_at.desc())
                    .limit(5)
                )
                recent_transactions[client_id] = tx_result.scalars().all()

            custom_conditions_result = await db.execute(
                select(ClientCustomCondition)
                .where(
                    ClientCustomCondition.client_id.in_(client_ids),
                    ClientCustomCondition.is_active.is_(True),
                )
                .order_by(desc(ClientCustomCondition.created_at))
            )
            for row in custom_conditions_result.scalars().all():
                custom_conditions_map.setdefault(row.client_id, []).append(row)

        users = []
        sidebar_summary = {
            "total_balance": 0.0,
            "manual_credits": 0.0,
            "spent_total": 0.0,
            "active_tariff_count": 0,
            "custom_conditions_count": 0,
            "extra_assistants_total": 0,
            "extra_messages_total": 0,
        }
        for user in rows:
            client_id = user.client_id
            cfg = await get_client_config(client_id, use_cache=False)
            notifications = cfg.raw.get('notifications', {}) if cfg and isinstance(cfg.raw, dict) else {}
            is_newsletter_subscribed = bool(
                notifications.get('platform_news')
                or notifications.get('platform_news_email')
            ) if isinstance(notifications, dict) else False
            limits = get_effective_account_limits(user)
            user_dict = {
                "id": user.id,
                "email": user.email,
                "client_id": client_id,
                "balance": user.balance,
                "created_at": user.created_at,
                "is_active": user.is_active,
                "is_verified": getattr(user, 'is_verified', True),
                "tariff": user.tariff_name,
                "is_personal_tariff": bool(getattr(user, 'is_personal_tariff', False)),
                "tariff_expires_at": user.tariff_expires_at,
                "messages_consumed": user.messages_consumed,
                "auto_renew": user.auto_renew,
                "notifications": notifications,
                "is_newsletter_subscribed": is_newsletter_subscribed,
                "total_paid": payments_totals.get(client_id, 0.0),
                "total_manual_credits": manual_totals.get(client_id, 0.0),
                "total_spent_money": spent_totals.get(client_id, 0.0),
                "total_spent": user.messages_consumed,
                "indexed_pages": 0,
                "last_activity": user.created_at,
                "last_payment_at": last_payments.get(client_id).created_at.isoformat() if last_payments.get(client_id) and last_payments.get(client_id).created_at else None,
                "last_payment_amount": float(last_payments.get(client_id).amount or 0) if last_payments.get(client_id) else 0.0,
                "recent_transactions": [
                    {
                        "amount": float(tx.amount or 0),
                        "source": tx.source,
                        "description": tx.description,
                        "created_at": tx.created_at.isoformat() if tx.created_at else None,
                    }
                    for tx in recent_transactions.get(client_id, [])
                ],
                "messages_limit": limits["messages_limit"],
                "messages_limit": limits["messages_limit"],
                "storage_limit": limits["storage_limit"],
                "context_limit": limits["context_limit"],
                "max_index_pages": limits["max_index_pages"],
                "assistants_limit": limits["assistants_limit"],
                "assistants_hard_cap": limits["assistants_hard_cap"],
                "extra_messages_limit": limits["extra_messages_limit"],
                "extra_messages_limit": limits["extra_messages_limit"],
                "extra_storage_bytes": limits["extra_storage_bytes"],
                "extra_context_limit": limits["extra_context_limit"],
                "extra_index_pages": limits["extra_index_pages"],
                "extra_assistants_hard_cap": limits["extra_assistants_hard_cap"],
                "custom_conditions": [_serialize_custom_condition(row) for row in custom_conditions_map.get(client_id, [])],
                "custom_conditions_summary": {
                    "extra_messages": sum(int(row.extra_messages or 0) for row in custom_conditions_map.get(client_id, [])),
                    "extra_assistants": sum(int(row.extra_assistants or 0) for row in custom_conditions_map.get(client_id, [])),
                    "extend_days": sum(int(row.extend_days or 0) for row in custom_conditions_map.get(client_id, [])),
                    "has_expiry_override": any(bool(row.expires_at_override) for row in custom_conditions_map.get(client_id, [])),
                },
            }

            try:
                user_dict["site_url"] = cfg.site_url if cfg else ""
            except:
                user_dict["site_url"] = ""
            sidebar_summary["total_balance"] += float(user.balance or 0)
            sidebar_summary["manual_credits"] += float(manual_totals.get(client_id, 0.0) or 0)
            sidebar_summary["spent_total"] += float(spent_totals.get(client_id, 0.0) or 0)
            if user.tariff_name and user.tariff_name != "start":
                sidebar_summary["active_tariff_count"] += 1
            sidebar_summary["custom_conditions_count"] += len(custom_conditions_map.get(client_id, []))
            sidebar_summary["extra_assistants_total"] += sum(int(row.extra_assistants or 0) for row in custom_conditions_map.get(client_id, []))
            sidebar_summary["extra_messages_total"] += sum(int(row.extra_messages or 0) for row in custom_conditions_map.get(client_id, []))
            users.append(user_dict)

    subscribed_count = sum(1 for user in users if user.get("is_newsletter_subscribed"))
    return {"status": "success", "users": users, "summary": {"newsletter_subscribed": subscribed_count, "sidebar": sidebar_summary}}

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
        await notify_balance_topped_up(client_id, added_amount, source="superadmin")

    await reload_client_config(client_id)
    return {"status": "success"}

@router.post("/set_tariff")
async def set_tariff(request: Request, token_data: dict = Depends(verify_superadmin)):
    """Смена тарифа пользователя.

    Название «Персональный» назначается только здесь, флагом is_personal.
    Базовый тариф (start/business/neuro) при этом всё равно сохраняется —
    от него считаются лимиты, а «Персональный» лишь меняет отображаемое имя.
    """
    data = await request.json()
    client_id = data.get('client_id')
    tariff_id = data.get('tariff_id')
    is_personal = bool(data.get('is_personal', False))

    values = {"tariff_name": tariff_id, "is_personal_tariff": is_personal}

    async with AsyncSessionLocal() as db:
        await db.execute(
            update(User)
            .where(User.client_id == client_id)
            .values(**values)
        )
        await db.commit()
    
    await reload_client_config(client_id)

    tariff_key = str(tariff_id or 'start').strip().lower()
    display_name = 'Персональный' if is_personal else TARIFF_RULES.get(tariff_key, TARIFF_RULES['start']).get('name', 'Старт')
    if is_personal:
        await notify_personal_tariff_assigned(
            client_id,
            "Для вас активирован тариф «Персональный»",
            "Для вашего аккаунта активирован персональный тариф. Подробности доступны в панели управления.",
        )
    else:
        await notify_tariff_changed(client_id, display_name)

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

@router.post("/publish-news")
async def publish_news(request: Request, token_data: dict = Depends(verify_superadmin)):
    data = await request.json()
    title = str(data.get("title") or "").strip()
    body = str(data.get("body") or "").strip()
    client_id = str(data.get("client_id") or "").strip() or None
    action_url = str(data.get("action_url") or "").strip() or None
    action_label = str(data.get("action_label") or "").strip() or None

    if not title or not body:
        return {"status": "error", "message": "Заполните заголовок и текст новости."}

    if client_id:
        await create_notification(
            client_id=client_id,
            category="platform",
            type="superadmin_news",
            severity="info",
            source="superadmin",
            channel_scope="in_app",
            title=title,
            body=body,
            action_url=action_url,
            action_label=action_label,
        )
    else:
        await publish_platform_news(title, body, action_url=action_url, action_label=action_label)

    return {"status": "success"}


@router.get("/news")
async def get_superadmin_news(limit: int = 100, token_data: dict = Depends(verify_superadmin)):
    items = await list_manual_superadmin_news(limit=limit)
    return {
        "status": "success",
        "items": [
            {
                "id": row.id,
                "client_id": row.client_id,
                "title": row.title,
                "body": row.body,
                "type": row.type,
                "severity": row.severity,
                "action_url": row.action_url,
                "action_label": row.action_label,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in items
        ]
    }


@router.post("/news/{notification_id}/update")
async def update_superadmin_news(notification_id: int, request: Request, token_data: dict = Depends(verify_superadmin)):
    data = await request.json()
    title = str(data.get("title") or "").strip()
    body = str(data.get("body") or "").strip()
    client_id = str(data.get("client_id") or "").strip() or None
    action_url = str(data.get("action_url") or "").strip() or None
    action_label = str(data.get("action_label") or "").strip() or None
    if not title or not body:
        return {"status": "error", "message": "Заполните заголовок и текст новости."}
    ok = await update_manual_superadmin_news(
        notification_id,
        title=title,
        body=body,
        client_id=client_id,
        action_url=action_url,
        action_label=action_label,
    )
    return {"status": "success" if ok else "error"}


@router.post("/news/{notification_id}/delete")
async def delete_superadmin_news(notification_id: int, token_data: dict = Depends(verify_superadmin)):
    ok = await delete_manual_superadmin_news(notification_id)
    return {"status": "success" if ok else "error"}


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

    await notify_security_event(
        client_id,
        "Экстренный сброс пароля",
        "Для вашего аккаунта выполнен экстренный сброс пароля. Если это действие было несанкционированным, срочно свяжитесь с поддержкой.",
        dedupe_key=f"security-reset:{client_id}:{reset_token}",
    )

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
    
    previous_tariff = 'текущий тариф'
    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.client_id == client_id))).scalar_one_or_none()
        if not user:
            return {"status": "error", "message": "Пользователь не найден"}
        previous_tariff = str(user.tariff_name or 'start')
        user.tariff_name = "start"
        user.tariff_expires_at = None
        user.messages_consumed = int(getattr(user, 'start_trial_messages_used', 0) or 0)
        user.is_active = True
        user.is_personal_tariff = False
        await db.commit()

    await notify_tariff_downgraded(client_id, previous_tariff, manual=True)
    await reload_client_config(client_id)
    return {"status": "success"}

@router.get("/custom-conditions")
async def get_custom_conditions(client_id: str = "", token_data: dict = Depends(verify_superadmin)):
    client_id = (client_id or "").strip()
    if not client_id:
        return {"status": "error", "message": "client_id is required"}

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ClientCustomCondition)
            .where(ClientCustomCondition.client_id == client_id)
            .order_by(desc(ClientCustomCondition.created_at))
        )
        items = [_serialize_custom_condition(row) for row in result.scalars().all()]
    return {"status": "success", "items": items}


@router.post("/custom-conditions/upsert")
async def upsert_custom_condition(request: Request, token_data: dict = Depends(verify_superadmin)):
    data = await request.json()
    client_id = str(data.get("client_id") or "").strip()
    if not client_id:
        return {"status": "error", "message": "client_id is required"}

    condition_id_raw = data.get("condition_id")
    condition_id = int(condition_id_raw) if condition_id_raw not in (None, "") else None
    extra_messages = _coerce_signed_int(data.get("extra_messages"), 0)
    extra_assistants = _coerce_signed_int(data.get("extra_assistants"), 0)
    extend_days = _coerce_signed_int(data.get("extend_days"), 0)
    reason_comment = str(data.get("reason_comment") or "").strip() or None
    extra_messages_limit = max(0, _coerce_signed_int(data.get("extra_messages_limit"), 0))
    extra_storage_gb = min(max(0, _coerce_signed_int(data.get("extra_storage_gb"), 0)), 10240)

    extra_context_limit = min(max(0, _coerce_signed_int(data.get("extra_context_limit"), 0)), 100000)
    extra_index_pages = min(max(0, _coerce_signed_int(data.get("extra_index_pages"), 0)), 100000)
    extra_assistants_hard_cap = min(max(0, _coerce_signed_int(data.get("extra_assistants_hard_cap"), 0)), 100000)
    expires_at_override_raw = str(data.get("expires_at_override") or "").strip()
    expires_at_override = None
    if expires_at_override_raw:
        expires_at_override = datetime.fromisoformat(expires_at_override_raw)

    created_by = token_data.get("email") or token_data.get("sub") or "superadmin"

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.client_id == client_id))
        user = result.scalar_one_or_none()
        if not user:
            return {"status": "error", "message": "Пользователь не найден"}

        if condition_id is not None:
            condition_result = await db.execute(
                select(ClientCustomCondition).where(
                    ClientCustomCondition.id == condition_id,
                    ClientCustomCondition.client_id == client_id,
                )
            )
            row = condition_result.scalar_one_or_none()
            if not row:
                return {"status": "error", "message": "Условие не найдено"}
            row.extra_messages = extra_messages
            row.extra_assistants = extra_assistants
            row.extra_messages_limit = extra_messages_limit
            row.extra_storage_bytes = int(extra_storage_gb) * 1024 * 1024 * 1024
            row.extra_context_limit = extra_context_limit
            row.extra_index_pages = extra_index_pages
            row.extra_assistants_hard_cap = extra_assistants_hard_cap
            row.extend_days = extend_days
            row.expires_at_override = expires_at_override
            row.reason_comment = reason_comment
            row.created_by = created_by
            row.is_active = True
        else:
            row = ClientCustomCondition(
                client_id=client_id,
                extra_messages=extra_messages,
                extra_assistants=extra_assistants,
                extra_messages_limit=extra_messages_limit,
                extra_storage_bytes=int(extra_storage_gb) * 1024 * 1024 * 1024,
                extra_context_limit=extra_context_limit,
                extra_index_pages=extra_index_pages,
                extra_assistants_hard_cap=extra_assistants_hard_cap,
                extend_days=extend_days,
                expires_at_override=expires_at_override,
                reason_comment=reason_comment,
                created_by=created_by,
                is_active=True,
            )
            db.add(row)

        await _recalculate_user_custom_condition_effects(db, user)

        if expires_at_override:
            user.tariff_expires_at = expires_at_override
        elif extend_days != 0:
            now = datetime.now()
            current_expiry = user.tariff_expires_at if user.tariff_expires_at and user.tariff_expires_at > now else now
            user.tariff_expires_at = current_expiry + timedelta(days=extend_days)

        await db.commit()
        await db.refresh(row)

    title, body = _build_personal_tariff_summary(
        extra_messages=extra_messages,
        extra_assistants=extra_assistants,
        extra_messages_limit=extra_messages_limit,
        extra_storage_gb=extra_storage_gb,
        extra_context_limit=extra_context_limit,
        extra_index_pages=extra_index_pages,
        extra_assistants_hard_cap=extra_assistants_hard_cap,
        expires_at_override=expires_at_override,
        extend_days=extend_days,
    )
    await notify_personal_tariff_assigned(client_id, title, body)
    await reload_client_config(client_id)
    return {"status": "success", "item": _serialize_custom_condition(row)}


@router.post("/custom-conditions/{condition_id}/deactivate")
async def deactivate_custom_condition(condition_id: int, token_data: dict = Depends(verify_superadmin)):
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(ClientCustomCondition).where(ClientCustomCondition.id == condition_id))
        row = result.scalar_one_or_none()
        if not row:
            return {"status": "error", "message": "Условие не найдено"}
        row.is_active = False
        user_result = await db.execute(select(User).where(User.client_id == row.client_id))
        user = user_result.scalar_one_or_none()
        if user:
            await _recalculate_user_custom_condition_effects(db, user)
        await db.commit()
    await reload_client_config(row.client_id)
    return {"status": "success"}


@router.post("/custom-conditions/reset")
async def reset_custom_conditions(request: Request, token_data: dict = Depends(verify_superadmin)):
    data = await request.json()
    client_id = str(data.get("client_id") or "").strip()
    if not client_id:
        return {"status": "error", "message": "client_id is required"}

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.client_id == client_id))
        user = result.scalar_one_or_none()
        if not user:
            return {"status": "error", "message": "Пользователь не найден"}

        rows_result = await db.execute(
            select(ClientCustomCondition).where(
                ClientCustomCondition.client_id == client_id,
                ClientCustomCondition.is_active.is_(True),
            )
        )
        rows = rows_result.scalars().all()
        for row in rows:
            row.is_active = False

        await _recalculate_user_custom_condition_effects(db, user)
        await db.commit()

    await reload_client_config(client_id)
    return {"status": "success", "message": "Персональные лимиты возвращены к тарифу"}



@router.post("/send-newsletter")
async def send_newsletter(request: Request, token_data: dict = Depends(verify_superadmin)):
    data = await request.json()
    subject = str(data.get("subject") or "").strip()
    body = str(data.get("body") or "").strip()
    only_subscribed = bool(data.get("only_subscribed", True))

    if not subject or not body:
        return {"status": "error", "message": "Заполни тему и текст рассылки"}

    sent = 0
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User.client_id, User.email, DBClientConfig.config_json).where(User.email.is_not(None)))
        rows = result.all()

    for client_id, email, config_json in rows:
        notifications = (config_json or {}).get("notifications") if isinstance(config_json, dict) else {}
        subscribed = bool(notifications.get("platform_news") or notifications.get("platform_news_email")) if isinstance(notifications, dict) else False
        if only_subscribed and not subscribed:
            continue
        if not email:
            continue
        ok = await send_email(email, subject, body)
        if ok:
            sent += 1

    return {"status": "success", "sent": sent}


@router.get("/status")
async def superadmin_status(request: Request):
    access_state = await get_superadmin_access_state(request)
    return {
        "status": "success",
        "is_locked": access_state["is_locked"],
        "is_unlocked": access_state["is_unlocked"],
        "requires_unlock_code": access_state["requires_unlock_code"],
        "attempts": access_state["attempts"],
        "attempts_limit": access_state["attempts_limit"],
        "attempts_remaining": access_state["attempts_remaining"],
        "client_ip": access_state["client_ip"],
        "forwarded_for": access_state["forwarded_for"],
        "user_agent": access_state["user_agent"],
        "fingerprint": access_state["fingerprint"],
        "lock_scope": access_state["lock_scope"],
    }


@router.get("/registration-lock-public")
async def get_registration_lock_public():
    return {"status": "success", "settings": get_registration_lock_settings()}


@router.get("/registration-lock")
async def get_registration_lock(token_data: dict = Depends(verify_superadmin)):
    return {"status": "success", "settings": get_registration_lock_settings()}


@router.post("/registration-lock")
async def update_registration_lock(request: Request, token_data: dict = Depends(verify_superadmin)):
    data = await request.json()
    settings = {
        "enabled": bool(data.get("enabled", False)),
        "title": str(data.get("title") or REGISTRATION_LOCK_DEFAULT["title"]).strip() or REGISTRATION_LOCK_DEFAULT["title"],
        "message": str(data.get("message") or REGISTRATION_LOCK_DEFAULT["message"]).strip() or REGISTRATION_LOCK_DEFAULT["message"],
    }
    cache_service.set(REGISTRATION_LOCK_CACHE_KEY, settings, expire=24 * 60 * 60)
    return {"status": "success", "settings": settings}


@router.post("/unlock")
async def unlock_superadmin(request: Request):
    data = await request.json()
    unlock_code = str(data.get("unlock_code") or "").strip()
    expected_code = os.environ.get(SUPERADMIN_UNLOCK_CODE_ENV, "").strip()
    if not expected_code or unlock_code != expected_code:
        return {"status": "error", "message": "Неверный код разблокировки"}

    lock_scope = get_superadmin_lock_scope(request)
    lock_key = f"{SUPERADMIN_LOCK_PREFIX}{lock_scope}"
    unlock_key = f"{SUPERADMIN_UNLOCKED_PREFIX}{lock_scope}"
    try:
        cache_service.set(lock_key, '1', expire=24 * 60 * 60)
        cache_service.set(unlock_key, '1', expire=SUPERADMIN_UNLOCK_WINDOW_MINUTES * 60)
    except Exception:
        pass
    return {
        "status": "success",
        "message": f"Доступ разблокирован на {SUPERADMIN_UNLOCK_WINDOW_MINUTES} минут для повторного входа"
    }


@router.post("/delete_user")
async def delete_user(request: Request, token_data: dict = Depends(verify_superadmin)):
    """Полное удаление пользователя и всех его данных."""
    data = await request.json()
    client_id = data.get('client_id')
    
    if not client_id:
        raise HTTPException(status_code=400, detail="client_id is required")

    try:
        from ..services.account_deletion_service import delete_client_account
        await delete_client_account(client_id)
    except Exception as e:
        log.exception("Delete user failed for %s", client_id)
        return {"status": "error", "message": "Не удалось удалить пользователя. Проверьте связанные данные и логи сервера."}

    return {"status": "success"}
