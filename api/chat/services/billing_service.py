import logging
import asyncio
from datetime import datetime, timedelta
from sqlalchemy import select, update
from api.chat.services.db_service import AsyncSessionLocal, User
from api.chat.core.config import TARIFF_RULES

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

        async with AsyncSessionLocal() as db:
            # Ищем пользователей, у которых тариф истекает в ближайшие 24 часа и включено автопродление
            stmt = select(User).where(
                User.auto_renew == True,
                User.tariff_name != 'start',
                User.tariff_expires_at <= tomorrow,
                User.tariff_expires_at > now - timedelta(days=1) # Не трогаем совсем старые
            )
            result = await db.execute(stmt)
            users = result.scalars().all()

            for user in users:
                await self._renew_user_tariff(user)

    async def _renew_user_tariff(self, user: User):
        """Логика продления конкретного пользователя."""
        tariff_info = TARIFF_RULES.get(user.tariff_name)
        if not tariff_info:
            log.warning(f"Unknown tariff {user.tariff_name} for user {user.client_id}")
            return

        cost = tariff_info.get('price', 0)
        if cost <= 0:
            return

        if user.balance >= cost:
            # Денег хватает — продлеваем
            new_expires_at = (user.tariff_expires_at or datetime.now()) + timedelta(days=30)
            
            async with AsyncSessionLocal() as db:
                await db.execute(
                    update(User)
                    .where(User.id == user.id)
                    .values(
                        balance=User.balance - cost,
                        tariff_expires_at=new_expires_at,
                        messages_consumed=0 # Сбрасываем счетчик при продлении
                    )
                )
                await db.commit()
            
            log.info(f"Tariff {user.tariff_name} auto-renewed for {user.client_id}. New balance: {user.balance - cost}")
            # Здесь можно добавить отправку уведомления пользователю
        else:
            # Денег не хватает — отключаем автопродление и уведомляем
            log.warning(f"Insufficient balance for auto-renew {user.client_id}. Balance: {user.balance}, Cost: {cost}")
            async with AsyncSessionLocal() as db:
                await db.execute(
                    update(User)
                    .where(User.id == user.id)
                    .values(auto_renew=False)
                )
                await db.commit()
            # Здесь обязательно нужно отправить уведомление о неудачном продлении

billing_service = BillingService()
