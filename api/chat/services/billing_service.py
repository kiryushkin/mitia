import logging
import asyncio
from datetime import datetime, timedelta
from sqlalchemy import select, update
from api.chat.services.db_service import AsyncSessionLocal, User, BalanceTransaction
from api.chat.core.config import TARIFF_RULES, STORAGE_PACK_RULES
from api.chat.services.notification_service import (
    notify_auto_renew_failed,
    notify_monthly_messages_reset,
    notify_tariff_changed,
    notify_tariff_downgraded,
    notify_tariff_expiring,
)

log = logging.getLogger(__name__)

class BillingService:
    def __init__(self):
        self._running = False

    async def start(self):
        """Запускает фоновую задачу проверки тарифов."""
        if self._running:
            return
        self._running = True
        asyncio.create_task(self._billing_loop())
        log.info("BillingService started")

    async def _billing_loop(self):
        """Цикл проверки раз в 12 часов."""
        while self._running:
            try:
                await self.check_and_renew_tariffs()
            except Exception as e:
                log.error(f"Error in billing loop: {e}")
            await asyncio.sleep(12 * 3600)  # Проверка каждые 12 часов

    async def check_and_renew_tariffs(self):
        """Проверяет пользователей с истекающим тарифом и включенным автопродлением."""
        now = datetime.now()
        tomorrow = now + timedelta(days=1)
        in_three_days = now + timedelta(days=3)

        await self._downgrade_expired_tariffs(now)
        await self._reset_paid_message_periods(now)

        async with AsyncSessionLocal() as db:
            expiring_stmt = select(User).where(
                User.tariff_name != 'start',
                User.tariff_expires_at.is_not(None),
                User.tariff_expires_at <= in_three_days,
                User.tariff_expires_at >= now,
            )
            expiring_result = await db.execute(expiring_stmt)
            expiring_users = expiring_result.scalars().all()
            for user in expiring_users:
                expires_at = user.tariff_expires_at or now
                days_left = max((expires_at.date() - now.date()).days, 0)
                dedupe_key = f"tariff-expiring:{user.client_id}:{expires_at.date().isoformat()}"
                await notify_tariff_expiring(user.client_id, expires_at, days_left, dedupe_key=dedupe_key)

            # Берём всех с включённым автопродлением, у кого срок подходит или уже истёк.
            # Нижняя граница по дате убрана намеренно: если биллинг простаивал больше
            # суток, просроченные пользователи иначе не попадали ни сюда, ни в downgrade
            # и оставались на платном тарифе бесплатно.
            stmt = select(User).where(
                User.auto_renew == True,
                User.tariff_name != 'start',
                User.tariff_expires_at.is_not(None),
                User.tariff_expires_at <= tomorrow,
            )
            result = await db.execute(stmt)
            users = result.scalars().all()

            for user in users:
                await self._renew_user_tariff(user)

    async def _downgrade_expired_tariffs(self, now: datetime):
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(User).where(
                    User.tariff_name != 'start',
                    User.tariff_expires_at.is_not(None),
                    User.tariff_expires_at <= now,
                    User.auto_renew == False,
                )
            )
            users = result.scalars().all()
            for user in users:
                previous_tariff = user.tariff_name
                user.tariff_name = 'start'
                user.tariff_expires_at = None
                user.tariff_billing_period = 'month'
                # The paid-period remainder expires; the one-time Start trial and
                # separately purchased packs are tracked independently.
                user.messages_consumed = int(getattr(user, 'start_trial_messages_used', 0) or 0)
                user.messages_period_started_at = now
                user.messages_reset_at = None
                user.auto_renew = False
                await notify_tariff_downgraded(
                    user.client_id,
                    previous_tariff,
                    dedupe_key=f'tariff-downgraded:{user.client_id}:{now.date().isoformat()}',
                )
            if users:
                await db.commit()

    async def _reset_paid_message_periods(self, now: datetime):
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(User).where(
                    User.tariff_name != 'start',
                    User.tariff_expires_at.is_not(None),
                    User.tariff_expires_at > now,
                    User.messages_reset_at.is_not(None),
                    User.messages_reset_at <= now,
                )
            )
            users = result.scalars().all()
            for user in users:
                reset_at = user.messages_reset_at
                while user.messages_reset_at and user.messages_reset_at <= now:
                    user.messages_period_started_at = user.messages_reset_at
                    user.messages_reset_at = user.messages_period_started_at + timedelta(days=30)
                user.messages_consumed = 0
                await notify_monthly_messages_reset(
                    user.client_id,
                    user.tariff_name,
                    dedupe_key=f'message-limit-reset:{user.client_id}:{reset_at.date().isoformat()}',
                )
            if users:
                await db.commit()

    async def _renew_user_tariff(self, user: User):
        """Логика продления конкретного пользователя."""
        tariff_info = TARIFF_RULES.get(user.tariff_name)
        if not tariff_info:
            log.warning(f"Unknown tariff {user.tariff_name} for user {user.client_id}")
            return

        billing_period = str(getattr(user, 'tariff_billing_period', 'month') or 'month')
        period_days = 365 if billing_period == 'year' else 30
        # Годовая цена — со скидкой из тарифа (как в интерфейсе), а не price*12.
        if billing_period == 'year':
            cost = float(tariff_info.get('year_price') or float(tariff_info.get('price', 0) or 0) * 12)
        else:
            cost = float(tariff_info.get('price', 0) or 0)
        storage_pack_price = 0.0
        storage_plan_pack_id = str(getattr(user, 'storage_plan_pack_id', '') or '')
        if storage_plan_pack_id:
            pack = next((item for item in STORAGE_PACK_RULES if str(item.get('pack_id')) == storage_plan_pack_id), None)
            if pack:
                storage_pack_price = float(pack.get('monthly_price') or 0)
        total_cost = cost + storage_pack_price
        if total_cost <= 0:
            return

        # Всё списание и обновление тарифа делаем атомарно под блокировкой строки,
        # чтобы не разъехаться с ручными платежами/покупками и оставить след транзакции.
        renewed = False
        new_expires_at = None
        insufficient = False
        async with AsyncSessionLocal() as db:
            locked = (await db.execute(
                select(User).where(User.id == user.id).with_for_update()
            )).scalar_one_or_none()
            if locked is None:
                return

            current_balance = float(locked.balance or 0)
            if current_balance >= total_cost:
                # Если тариф уже истёк (например, из-за простоя биллинга) — продлеваем
                # от текущего момента, а не от прошедшей даты, чтобы не выдать
                # "уже просроченный" период.
                base_expiry = max(locked.tariff_expires_at or datetime.now(), datetime.now())
                new_expires_at = base_expiry + timedelta(days=period_days)
                locked.balance = current_balance - total_cost
                locked.tariff_expires_at = new_expires_at
                locked.messages_consumed = 0
                locked.messages_period_started_at = base_expiry
                locked.messages_reset_at = base_expiry + timedelta(days=30)
                db.add(BalanceTransaction(
                    client_id=locked.client_id,
                    amount=-total_cost,
                    source='auto_renew',
                    description=f"Автопродление тарифа {locked.tariff_name} ({billing_period})",
                    external_id=f"auto-renew:{locked.client_id}:{new_expires_at.date().isoformat()}",
                ))
                renewed = True
            else:
                locked.auto_renew = False
                insufficient = True
            await db.commit()

        if renewed:
            log.info(f"Tariff {user.tariff_name} auto-renewed for {user.client_id}. Charged: {total_cost}")
            await notify_tariff_changed(
                user.client_id,
                tariff_info.get('name', user.tariff_name),
                billing_period=billing_period,
                expires_at=new_expires_at,
            )
        elif insufficient:
            log.warning(f"Insufficient balance for auto-renew {user.client_id}. Cost: {total_cost}")
            dedupe_key = f"auto-renew-failed:{user.client_id}:{(user.tariff_expires_at.date().isoformat() if user.tariff_expires_at else 'unknown')}"
            await notify_auto_renew_failed(user.client_id, tariff_info.get('name', user.tariff_name), total_cost, dedupe_key=dedupe_key)

billing_service = BillingService()
