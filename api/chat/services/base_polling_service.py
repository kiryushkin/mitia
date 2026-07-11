import asyncio
from typing import Any, Awaitable, Callable

from ..core.config import log


class BasePollingService:
    """Общий помощник для polling-сервисов.

    Делает единый цикл обхода клиентов, нормализует client_id/
    настройки и централизует обработку ошибок цикла.
    """

    @staticmethod
    def normalize_client_id(client: Any) -> str:
        if isinstance(client, str):
            return client
        if isinstance(client, dict):
            return client.get("client_id") or client.get("id") or ""
        return ""

    @staticmethod
    def normalize_settings(settings: Any) -> dict:
        if isinstance(settings, dict):
            return settings
        if isinstance(settings, str):
            try:
                import json
                parsed = json.loads(settings)
                return parsed if isinstance(parsed, dict) else {}
            except Exception:
                return {}
        return {}

    async def run_manager_loop(
        self,
        *,
        service_name: str,
        list_clients_fn: Callable[[], Awaitable[list]],
        get_settings_fn: Callable[[str], Awaitable[Any]],
        process_client_fn: Callable[[str, dict], Awaitable[None]],
        sleep_seconds: int = 30,
        error_sleep_seconds: int = 10,
    ) -> None:
        while True:
            try:
                clients = await list_clients_fn()
                for client in clients:
                    client_id = self.normalize_client_id(client)
                    if not client_id:
                        continue

                    settings = self.normalize_settings(await get_settings_fn(client_id))
                    if not settings.get("enabled"):
                        continue

                    try:
                        await process_client_fn(client_id, settings)
                    except Exception as client_error:
                        log.error(f"[{service_name}] Client loop error for {client_id}: {client_error}")

                await asyncio.sleep(sleep_seconds)
            except Exception as e:
                log.error(f"[{service_name}] Manager loop error: {e}")
                await asyncio.sleep(error_sleep_seconds)


base_polling_service = BasePollingService()
