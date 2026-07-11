"""
Auto Indexer — фоновый автоматический индексатор всех клиентов.

Что делает:
1. При старте сервера — проходит по всем клиентам с auto_index_on_start=True
   и запускает индексацию через sitemap.
2. Каждые N часов (sync_interval_hours клиента) — повторяет проверку.
3. Через listen_new_clients() — реагирует на появление новых JSON-файлов
   в папке clients/ (можно добавить клиента без рестарта сервера).

Запускается автоматически из chat_widget.py при старте.
"""
import os
import time
import logging
import asyncio
from typing import Optional

from .clients import get_client_config, list_clients
from .site_indexer import SiteIndexer
from .cache_service import cache_service

log = logging.getLogger('auto_indexer')

class AutoIndexer:
    """Фоновый scheduler для автоматической индексации сайтов клиентов (асинхронный)."""

    def __init__(self, get_client_config_fn, list_clients_fn, get_indexer_fn,
                 check_interval_seconds: int = 600):
        self.get_client_config = get_client_config_fn
        self.list_clients = list_clients_fn
        self.get_indexer = get_indexer_fn
        self.check_interval = check_interval_seconds
        self._task: Optional[asyncio.Task] = None
        self._last_sync: dict[str, float] = {}
        self._known_clients: set[str] = set()

    def start(self, run_initial: bool = True):
        """Запускает фоновую задачу."""
        if self._task and not self._task.done():
            log.warning("AutoIndexer уже запущен")
            return
        self._task = asyncio.create_task(self._loop(run_initial))
        log.info(f"AutoIndexer запущен (проверка каждые {self.check_interval}с)")

    async def stop(self):
        """Останавливает фоновую задачу."""
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        log.info("AutoIndexer остановлен")

    async def _loop(self, run_initial: bool):
        """Основной цикл."""
        if run_initial:
            try:
                await self._initial_sync_all()
            except Exception as e:
                log.error(f"Ошибка initial sync: {e}")
        
        while True:
            try:
                await self._check_and_sync()
                await self._detect_new_clients()
            except Exception as e:
                log.error(f"Ошибка в цикле AutoIndexer: {e}")
            await asyncio.sleep(self.check_interval)

    async def _initial_sync_all(self):
        """Запускает sitemap-sync для всех клиентов сразу при старте."""
        clients = await self.list_clients()
        log.info(f"Initial indexing: найдено {len(clients)} клиентов")
        self._known_clients = set(clients)
        for client_id in clients:
            try:
                cfg = await self.get_client_config(client_id)
                if cfg.auto_index_on_start and cfg.enable_site_search and cfg.site_url and cfg.site_url.startswith('http'):
                    await self._sync_client(client_id, cfg, reason='startup')
            except Exception as e:
                log.error(f"Initial sync клиента {client_id}: {e}")

    async def _check_and_sync(self):
        """Проверяет кого пора синкнуть и синкает."""
        now = time.time()
        clients = await self.list_clients()
        for client_id in clients:
            try:
                cfg = await self.get_client_config(client_id)
                if not (cfg.enable_site_search and cfg.site_url and cfg.site_url.startswith('http')):
                    continue
                if cfg.sync_interval_hours <= 0:
                    continue
                last = self._last_sync.get(client_id, 0)
                interval_seconds = cfg.sync_interval_hours * 3600
                if now - last >= interval_seconds:
                    await self._sync_client(client_id, cfg, reason='scheduled')
            except Exception as e:
                log.error(f"Проверка клиента {client_id}: {e}")

    async def _detect_new_clients(self):
        """Обнаруживает новых клиентов в БД и сразу их синкает."""
        current_list = await self.list_clients()
        current = set(current_list)
        new_clients = current - self._known_clients
        if new_clients:
            for client_id in new_clients:
                try:
                    cfg = await self.get_client_config(client_id)
                    if cfg.auto_index_on_start and cfg.enable_site_search and cfg.site_url:
                        log.info(f"Обнаружен новый клиент: {client_id}")
                        await self._sync_client(client_id, cfg, reason='new_client')
                except Exception as e:
                    log.error(f"Sync нового клиента {client_id}: {e}")
            self._known_clients = current

    async def _sync_client(self, client_id: str, cfg, reason: str = ''):
        """Запускает sync_from_sitemap for конкретного клиента."""
        try:
            cache_service.clear_pattern(f"ai_cache:{client_id}:*")
            indexer = self.get_indexer(client_id, cfg.site_url)
            sitemap_url = cfg.sitemap_url or None
            log.info(f"[{reason}] Sync клиента '{client_id}' ({cfg.site_url})...")
            
            result = await indexer.sync_from_sitemap(
                sitemap_url=sitemap_url,
                max_pages=cfg.max_pages_to_index,
                remove_missing=True
            )
            
            self._last_sync[client_id] = time.time()
            log.info(f"[{reason}] Клиент '{client_id}': "
                     f"+{result.get('added', 0)} новых, "
                     f"~{result.get('updated', 0)} обновлено, "
                     f"{result.get('skipped', 0)} без изменений")
        except Exception as e:
            log.error(f"_sync_client {client_id}: {e}")

    async def force_sync(self, client_id: str) -> dict:
        """Ручной запуск sync для клиента."""
        try:
            cfg = await self.get_client_config(client_id)
            if not cfg.site_url:
                return {'status': 'error', 'message': f"client '{client_id}' has no site_url"}
            indexer = self.get_indexer(client_id, cfg.site_url)
            result = await indexer.sync_from_sitemap(
                sitemap_url=cfg.sitemap_url or None,
                max_pages=cfg.max_pages_to_index
            )
            self._last_sync[client_id] = time.time()
            return result
        except Exception as e:
            log.error(f"force_sync {client_id}: {e}")
            return {'status': 'error', 'message': str(e)}

    async def get_status(self) -> dict:
        """Возвращает статус для админки."""
        now = time.time()
        clients_status = []
        clients = await self.list_clients()
        for client_id in clients:
            try:
                cfg = await self.get_client_config(client_id)
                last = self._last_sync.get(client_id, 0)
                next_sync = (last + cfg.sync_interval_hours * 3600) if last > 0 else now
                clients_status.append({
                    'client_id': client_id,
                    'site_url': cfg.site_url,
                    'sync_interval_hours': cfg.sync_interval_hours,
                    'last_sync_ago_s': int(now - last) if last > 0 else None,
                    'next_sync_in_s': max(0, int(next_sync - now)) if last > 0 else 0,
                    'auto_enabled': cfg.sync_interval_hours > 0 and cfg.enable_site_search,
                })
            except Exception:
                pass
        return {
            'running': self._task is not None and not self._task.done(),
            'check_interval_s': self.check_interval,
            'clients': clients_status,
        }

_auto_indexer: Optional[AutoIndexer] = None

def init_auto_indexer(get_client_config_fn, list_clients_fn, get_indexer_fn,
                      check_interval_seconds: int = 600,
                      run_initial: bool = True) -> AutoIndexer:
    global _auto_indexer
    _auto_indexer = AutoIndexer(
        get_client_config_fn, list_clients_fn, get_indexer_fn,
        check_interval_seconds=check_interval_seconds
    )
    _auto_indexer.start(run_initial=run_initial)
    return _auto_indexer

def get_auto_indexer() -> Optional[AutoIndexer]:
    return _auto_indexer