from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import select, update, delete, func, or_

from .db_service import AsyncSessionLocal, Notification, User, ClientConfig
from .notify_service import send_email


MONEY_LABEL = "руб."


def _notification_preferences(raw: dict | None) -> dict:
    data = raw if isinstance(raw, dict) else {}
    return {
        "platform_news_in_app": bool(data.get("platform_news_in_app", True)),
        "platform_news_email": bool(data.get("platform_news_email", False)),
        "billing_in_app": bool(data.get("billing_in_app", True)),
        "billing_email": bool(data.get("billing_email", True)),
        "limits_in_app": bool(data.get("limits_in_app", True)),
        "limits_email": bool(data.get("limits_email", True)),
        "security_in_app": bool(data.get("security_in_app", True)),
        "security_email": bool(data.get("security_email", True)),
    }


async def get_notification_preferences(client_id: str) -> dict:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(ClientConfig.config_json).where(ClientConfig.client_id == client_id))
        config = result.scalar_one_or_none() or {}
    notifications = config.get("notifications") if isinstance(config, dict) else {}
    return _notification_preferences(notifications)


def _resolve_channels(category: str, prefs: dict, force_email: bool = False) -> tuple[bool, bool]:
    if category == "platform":
        in_app = bool(prefs.get("platform_news_in_app", True))
        email = bool(prefs.get("platform_news_email", False))
    elif category == "billing":
        in_app = bool(prefs.get("billing_in_app", True))
        email = bool(prefs.get("billing_email", True))
    elif category == "limits":
        in_app = bool(prefs.get("limits_in_app", True))
        email = bool(prefs.get("limits_email", True))
    elif category == "security":
        in_app = bool(prefs.get("security_in_app", True))
        email = True if force_email else bool(prefs.get("security_email", True))
    else:
        in_app = True
        email = False
    if force_email:
        email = True
    return in_app, email


async def create_notification(
    *,
    client_id: Optional[str],
    category: str,
    type: str,
    title: str,
    body: str,
    severity: str = "info",
    source: str = "system",
    channel_scope: str = "in_app",
    action_url: Optional[str] = None,
    action_label: Optional[str] = None,
    dedupe_key: Optional[str] = None,
    send_email_copy: bool = False,
    email_subject: Optional[str] = None,
    force_email: bool = False,
) -> Notification | None:
    prefs = await get_notification_preferences(client_id) if client_id else _notification_preferences({})
    allow_in_app, allow_email = _resolve_channels(category, prefs, force_email=force_email)
    should_store = allow_in_app or client_id is None
    should_email = bool(send_email_copy and client_id and allow_email)

    row = None
    async with AsyncSessionLocal() as db:
        if dedupe_key:
            existing = await db.execute(
                select(Notification).where(Notification.dedupe_key == dedupe_key)
            )
            row = existing.scalar_one_or_none()
            if row:
                return row

        if should_store:
            row = Notification(
                client_id=client_id,
                category=category,
                type=type,
                severity=severity,
                title=title,
                body=body,
                source=source,
                channel_scope=channel_scope,
                action_url=action_url,
                action_label=action_label,
                dedupe_key=dedupe_key,
                created_at=datetime.now(),
            )
            db.add(row)
            await db.commit()
            refresh = getattr(db, "refresh", None)
            if callable(refresh):
                refresh_result = refresh(row)
                if hasattr(refresh_result, "__await__"):
                    await refresh_result

        if should_email:
            user_result = await db.execute(select(User).where(User.client_id == client_id))
            user = user_result.scalar_one_or_none()
            if user and user.email:
                await send_email(user.email, email_subject or title, body)

        return row


async def list_notifications(client_id: str, limit: int = 20, include_global: bool = True):
    async with AsyncSessionLocal() as db:
        stmt = select(Notification).where(Notification.is_archived.is_(False))
        if include_global:
            stmt = stmt.where((Notification.client_id == client_id) | (Notification.client_id.is_(None)))
        else:
            stmt = stmt.where(Notification.client_id == client_id)
        stmt = stmt.order_by(Notification.created_at.desc()).limit(max(int(limit or 20), 1))
        result = await db.execute(stmt)
        return result.scalars().all()


async def list_manual_superadmin_news(limit: int = 100):
    async with AsyncSessionLocal() as db:
        stmt = (
            select(Notification)
            .where(Notification.source == "superadmin", Notification.type.in_(["superadmin_news", "platform_news"]))
            .order_by(Notification.created_at.desc())
            .limit(max(int(limit or 100), 1))
        )
        result = await db.execute(stmt)
        return result.scalars().all()


async def update_manual_superadmin_news(
    notification_id: int,
    *,
    title: str,
    body: str,
    client_id: Optional[str],
    action_url: Optional[str],
    action_label: Optional[str],
) -> bool:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Notification).where(
                Notification.id == notification_id,
                Notification.source == "superadmin",
                Notification.type.in_(["superadmin_news", "platform_news"]),
            )
        )
        row = result.scalar_one_or_none()
        if not row:
            return False
        row.title = title
        row.body = body
        row.client_id = client_id
        row.action_url = action_url
        row.action_label = action_label
        row.type = "superadmin_news" if client_id else "platform_news"
        await db.commit()
        return True


async def delete_manual_superadmin_news(notification_id: int) -> bool:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            delete(Notification).where(
                Notification.id == notification_id,
                Notification.source == "superadmin",
                Notification.type.in_(["superadmin_news", "platform_news"]),
            )
        )
        await db.commit()
        return bool(result.rowcount)


async def mark_notification_read(notification_id: int, client_id: str) -> bool:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Notification).where(
                Notification.id == notification_id,
                (Notification.client_id == client_id) | (Notification.client_id.is_(None)),
            )
        )
        row = result.scalar_one_or_none()
        if not row:
            return False
        row.is_read = True
        await db.commit()
        return True


async def mark_all_notifications_read(client_id: str) -> int:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            update(Notification)
            .where(
                Notification.is_read.is_(False),
                (Notification.client_id == client_id) | (Notification.client_id.is_(None)),
            )
            .values(is_read=True)
        )
        await db.commit()
        return int(result.rowcount or 0)


async def get_unread_notifications_count(client_id: str) -> int:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.is_archived.is_(False),
                Notification.is_read.is_(False),
                or_(Notification.client_id == client_id, Notification.client_id.is_(None)),
            )
        )
        return int(result.scalar_one() or 0)


async def notify_balance_topped_up(client_id: str, amount: float, source: str = "system"):
    return await create_notification(
        client_id=client_id,
        category="billing",
        type="balance_topped_up",
        severity="success",
        source=source,
        channel_scope="both",
        title="Баланс пополнен",
        body=f"На ваш баланс зачислено {float(amount):.0f} {MONEY_LABEL}",
        send_email_copy=True,
        email_subject="Баланс пополнен — Mitia",
    )


async def notify_tariff_changed(
    client_id: str,
    tariff_name: str,
    *,
    billing_period: str | None = None,
    expires_at: datetime | None = None,
):
    period_label = " на год" if billing_period == "year" else " на 30 дней" if billing_period == "month" else ""
    paid_until = (
        f" Оплачено до {expires_at.strftime('%d.%m.%Y')}."
        if expires_at else ""
    )
    return await create_notification(
        client_id=client_id,
        category="billing",
        type="tariff_changed",
        severity="success",
        source="billing",
        channel_scope="both",
        title="Тариф обновлён",
        body=f"Подключён тариф «{tariff_name}»{period_label}.{paid_until}",
        send_email_copy=True,
        email_subject="Тариф обновлён — Mitia",
    )


async def notify_monthly_messages_reset(client_id: str, tariff_name: str, dedupe_key: Optional[str] = None):
    return await create_notification(
        client_id=client_id,
        category="billing",
        type="monthly_messages_reset",
        severity="success",
        source="billing",
        channel_scope="both",
        title="Лимит сообщений обновлён",
        body=f"Для тарифа «{tariff_name}» начался новый месячный лимит сообщений ИИ.",
        dedupe_key=dedupe_key,
        send_email_copy=True,
        email_subject="Лимит сообщений обновлён — Mitia",
    )


async def notify_tariff_downgraded(
    client_id: str,
    previous_tariff: str,
    dedupe_key: Optional[str] = None,
    *,
    manual: bool = False,
):
    reason = "Вы выбрали" if manual else "Срок тарифа закончился, поэтому аккаунт переведён на"
    return await create_notification(
        client_id=client_id,
        category="billing",
        type="tariff_downgraded",
        severity="warning",
        source="billing",
        channel_scope="both",
        title="Тариф завершён",
        body=(
            f"{reason} бесплатный тариф «Старт» вместо «{previous_tariff}». "
            "Неиспользованные сообщения, включённые в тариф, сгорели; отдельно купленные пакеты сохранены."
        ),
        dedupe_key=dedupe_key,
        send_email_copy=True,
        email_subject="Тариф завершён — Mitia",
    )


async def notify_message_pack_purchased(client_id: str, label: str):
    return await create_notification(
        client_id=client_id,
        category="billing",
        type="message_pack_purchased",
        severity="success",
        source="billing",
        channel_scope="both",
        title="Пакет сообщений куплен",
        body=f"Пакет «{label}» уже добавлен к вашему лимиту.",
        send_email_copy=True,
        email_subject="Куплен пакет сообщений — Mitia",
    )


async def notify_assistant_pack_purchased(client_id: str, label: str):
    return await create_notification(
        client_id=client_id,
        category="billing",
        type="assistant_pack_purchased",
        severity="success",
        source="billing",
        channel_scope="both",
        title="Слоты ассистентов куплены",
        body=f"Пакет слотов «{label}» уже добавлен к вашему аккаунту.",
        send_email_copy=True,
        email_subject="Куплены слоты ассистентов — Mitia",
    )


async def notify_storage_pack_purchased(client_id: str, label: str):
    return await create_notification(
        client_id=client_id,
        category="billing",
        type="storage_pack_purchased",
        severity="success",
        source="billing",
        channel_scope="both",
        title="Подключено расширение хранилища",
        body=f"Для вашего тарифа активировано расширение «{label}». Ежемесячная стоимость будет добавляться к следующему продлению.",
        send_email_copy=True,
        email_subject="Подключено расширение хранилища — Mitia",
    )


async def publish_platform_news(title: str, body: str, *, action_url: Optional[str] = None, action_label: Optional[str] = None, send_email_copy: bool = False):
    row = await create_notification(
        client_id=None,
        category="platform",
        type="platform_news",
        severity="info",
        source="superadmin",
        channel_scope="both" if send_email_copy else "in_app",
        title=title,
        body=body,
        action_url=action_url,
        action_label=action_label,
        send_email_copy=False,
    )

    if send_email_copy:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(User.client_id, User.email, ClientConfig.config_json).where(User.email.is_not(None)))
            rows = result.all()
        for client_id, email, config_json in rows:
            notifications = (config_json or {}).get("notifications") if isinstance(config_json, dict) else {}
            prefs = _notification_preferences(notifications)
            legacy_platform_news = bool(notifications.get("platform_news")) if isinstance(notifications, dict) else False
            if not (prefs.get("platform_news_email") or legacy_platform_news):
                continue
            if email:
                await send_email(email, title, body)

    return row


async def notify_welcome_news(client_id: str):
    return await create_notification(
        client_id=client_id,
        category="platform",
        type="welcome_news",
        severity="info",
        source="system",
        channel_scope="in_app",
        title="Добро пожаловать!",
        body="Mitia — платформа, где ИИ-ассистенты помогают бизнесу отвечать быстрее, продавать увереннее и работать без рутины. Начните с настройки первого ассистента, подключите нужные интеграции и соберите рабочую систему общения с клиентами в одном месте.",
        dedupe_key=f"welcome-news:{client_id}",
    )


async def notify_messages_quota_exhausted(client_id: str, dedupe_key: Optional[str] = None):
    return await create_notification(
        client_id=client_id,
        category="limits",
        type="messages_quota_exhausted",
        severity="warning",
        source="limits",
        channel_scope="both",
        title="Лимит сообщений исчерпан",
        body="Лимит сообщений ассистента исчерпан. Чтобы вернуть ответы ассистента, докупите пакет сообщений или смените тариф.",
        dedupe_key=dedupe_key,
        send_email_copy=True,
        email_subject="Лимит сообщений исчерпан — Mitia",
    )


async def notify_storage_limit_exceeded(client_id: str, dedupe_key: Optional[str] = None):
    return await create_notification(
        client_id=client_id,
        category="limits",
        type="storage_limit_exceeded",
        severity="warning",
        source="limits",
        channel_scope="both",
        title="Лимит хранилища исчерпан",
        body="Лимит хранилища исчерпан. Новые файлы, вложения и текстовые данные временно недоступны, пока вы не освободите место или не увеличите хранилище.",
        dedupe_key=dedupe_key,
        send_email_copy=True,
        email_subject="Лимит хранилища исчерпан — Mitia",
    )


async def notify_assistants_limit_exceeded(client_id: str, limit_value: int, dedupe_key: Optional[str] = None):
    return await create_notification(
        client_id=client_id,
        category="limits",
        type="assistants_limit_exceeded",
        severity="warning",
        source="limits",
        channel_scope="both",
        title="Достигнут лимит ассистентов",
        body=f"Для аккаунта достигнут лимит ассистентов: {int(limit_value or 0)}. Чтобы добавить новых ассистентов, измените тариф или условия аккаунта.",
        dedupe_key=dedupe_key,
        send_email_copy=True,
        email_subject="Достигнут лимит ассистентов — Mitia",
    )


async def notify_personal_tariff_assigned(client_id: str, title: str, body: str):
    return await create_notification(
        client_id=client_id,
        category="platform",
        type="personal_tariff_assigned",
        severity="success",
        source="superadmin",
        channel_scope="both",
        title=title,
        body=body,
        send_email_copy=True,
        email_subject=title,
        force_email=True,
    )


async def notify_tariff_expiring(client_id: str, expires_at: datetime, days_left: int, dedupe_key: Optional[str] = None):
    days_label = "день" if days_left == 1 else ("дня" if days_left in (2, 3, 4) else "дней")
    return await create_notification(
        client_id=client_id,
        category="billing",
        type="tariff_expiring",
        severity="warning",
        source="billing",
        channel_scope="both",
        title="Срок тарифа скоро закончится",
        body=f"Тариф истекает через {days_left} {days_label} — {expires_at.strftime('%d.%m.%Y')}. Проверьте баланс и автопродление.",
        dedupe_key=dedupe_key,
        send_email_copy=True,
        email_subject="Тариф скоро истечёт — Mitia",
    )


async def notify_auto_renew_failed(client_id: str, tariff_name: str, price: float, dedupe_key: Optional[str] = None):
    return await create_notification(
        client_id=client_id,
        category="billing",
        type="auto_renew_failed",
        severity="critical",
        source="billing",
        channel_scope="both",
        title="Автопродление не выполнено",
        body=f"Не удалось продлить тариф «{tariff_name}». На балансе недостаточно средств для списания {float(price):.0f} {MONEY_LABEL}",
        dedupe_key=dedupe_key,
        send_email_copy=True,
        email_subject="Автопродление не выполнено — Mitia",
    )


async def notify_security_event(client_id: str, title: str, body: str, dedupe_key: Optional[str] = None):
    return await create_notification(
        client_id=client_id,
        category="security",
        type="security_event",
        severity="critical",
        source="security",
        channel_scope="both",
        title=title,
        body=body,
        dedupe_key=dedupe_key,
        send_email_copy=True,
        email_subject=title,
        force_email=True,
    )
