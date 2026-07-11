"""
Client Config Manager — мульти-клиентская конфигурация.

Один JSON-файл на клиента: api/chat/clients/<client_id>.json
Содержит всё: брендинг, AI-настройки, промпт, цены/услуги,
   приветствия, quick-replies, нотификации (VK/Telegram/webhook),
   intent-правила (опционально).

Получение конфига:
    cfg = get_client_config('acme')

Публичный конфиг (отдаётся фронту):
    cfg.public_dict()
"""
from __future__ import annotations
import os
import json
import logging
import copy
from dataclasses import dataclass, field
from typing import Optional
from .cache_service import cache_service
from ..core.config import BASE_DIR
log = logging.getLogger('clients')
CLIENTS_DIR = os.path.join(os.path.dirname(__file__), 'clients')

@dataclass
class ClientConfig:
    client_id: str
    raw: dict = field(default_factory=dict)
    db_data: dict = field(default_factory=dict)

    @property
    def bot_name(self) -> str:
        # Сначала ищем в bot_settings, потом в корне (для совместимости), потом дефолт
        return self.raw.get('bot_settings', {}).get('bot_name') or self.raw.get('bot_name') or 'Митя'
    @property
    def avatar(self) -> str:
        return self.raw.get('avatar') or ''
    @property
    def welcome_msg(self) -> str:
        return self.raw.get('welcome_msg', 'Здравствуйте! Чем могу помочь?')
    @property
    def lead_success_msg(self) -> str:
        return self.raw.get('lead_success_msg', 'Заявка отправлена! Мы свяжемся с вами.')
    @property
    def scenario_success_msg(self) -> str:
        return self.raw.get('scenario_success_msg', 'Данные успешно отправлены! Мы свяжемся с вами.')
    @property
    def theme(self) -> dict:
        """CSS-переменные: brand_color, bg, text, etc."""
        return self.raw.get('theme', {})
    @property
    def privacy_url(self) -> str:
        return self.raw.get('privacy_url', '/privacy')
    @property
    def ai_provider(self) -> str:
        return self.raw.get('ai_provider', 'gigachat')
    @property
    def system_prompt(self) -> str:
        if self.raw.get('system_prompt'):
            return self.raw.get('system_prompt')
        
        settings = self.raw.get('bot_settings', {})
        parts = []
        
        parts.append(settings.get('personality_prompt', ""))
        parts.append("\n[ПРАВИЛА И ЗАПРЕТЫ]:\n" + settings.get('negative_prompt', ""))
        
        return "\n".join(parts)
    @property
    def site_url(self) -> str:
        return self.raw.get('site_url', '')
    @property
    def enable_site_search(self) -> bool:
        return bool(self.raw.get('enable_site_search', True))
    @property
    def sitemap_url(self) -> str:
        """URL sitemap. Если пусто — берётся <site_url>/sitemap.xml."""
        return self.raw.get('sitemap_url', '')
    @property
    def sync_interval_hours(self) -> int:
        """Как часто фоновый scheduler перепроверяет sitemap (часы). 0 = выключено."""
        return int(self.raw.get('sync_interval_hours', 6))
    @property
    def auto_index_on_start(self) -> bool:
        """Запускать ли индексацию при старте сервера."""
        return bool(self.raw.get('auto_index_on_start', True))
    @property
    def max_pages_to_index(self) -> int:
        return int(self.raw.get('max_pages_to_index', 200))
    @property
    def services(self) -> list[dict]:
        """[{name, price_from, description}]"""
        return self.raw.get('services', [])
    @property
    def faq(self) -> list[dict]:
        """[{question, answer}]"""
        return self.raw.get('faq', [])
    @property
    def contacts(self) -> dict:
        """{phone, email, telegram, vk, whatsapp, vk_messenger, max}"""
        return self.raw.get('contacts', {})
    @property
    def enable_quick_replies(self) -> bool:
        return bool(self.raw.get('enable_quick_replies', True))
    @property
    def quick_replies(self) -> list[dict]:
        return self.raw.get('quick_replies', [])
    @property
    def quick_replies_by_url(self) -> dict:
        """{'/portfolio': [{msg, label}, ...]}"""
        return self.raw.get('quick_replies_by_url', {})
    @property
    def quick_replies_tree(self) -> dict:
        return self.raw.get('quick_replies_tree', {})
    @property
    def welcome_trigger_delay_ms(self) -> int:
        return int(self.raw.get('welcome_trigger_delay_ms', 20000))
    @property
    def notifications(self) -> dict:
        """{vk: {token, peer_id}, telegram: {token, chat_id}, webhook: {url, secret}}"""
        return self.raw.get('notifications', {})
    @property
    def intent_rules(self) -> Optional[dict]:
        return self.raw.get('intent_rules')
    @property
    def rate_limit_per_minute(self) -> int:
        return int(self.raw.get('rate_limit_per_minute', 20))
    @property
    def max_message_length(self) -> int:
        return int(self.raw.get('max_message_length', 2000))
    @property
    def allowed_origins(self) -> list[str]:
        return self.raw.get('allowed_origins', [])
    def public_dict(self) -> dict:
        user_is_active = bool(self.db_data.get('is_active', True))
        theme_widget_enabled = bool(self.raw.get('theme', {}).get('widget_enabled', self.raw.get('widget_enabled', True)))

        return {
            'client_id':    self.client_id,
            'bot_name':     self.bot_name,
            'avatar':       self.avatar,
            'profile_avatar': self.raw.get('theme', {}).get('profile_avatar'),
            'welcome_msg':  self.welcome_msg,
            'is_active':    user_is_active,
            'widget_enabled': user_is_active and theme_widget_enabled,
            'owner_name':   self.raw.get('owner_name', 'Пользователь'),
            'theme':        self.theme,
            'limits':       self.raw.get('limits', {'messages_per_session': 20}),
            'privacy_url':  self.privacy_url,
            'site_url':     self.site_url,
            'bot_settings': {
                k: v for k, v in self.raw.get('bot_settings', {}).items()
                if k in ('enable_tts', 'tts_voice')
            },
            'system_prompt': self.system_prompt,
            'enable_quick_replies': self.enable_quick_replies,
            'quick_replies': self.quick_replies,
            'quick_replies_by_url': self.quick_replies_by_url,
            'quick_replies_tree': self.quick_replies_tree,
            'contacts': {
                k: v for k, v in self.contacts.items()
                if k in ('phone', 'email', 'telegram', 'whatsapp', 'vk_url', 'vk_messenger', 'max', 'extra_phones', 'extra_links')
            },
        }

def _path(client_id: str) -> str:
    safe = ''.join(c for c in client_id if c.isalnum() or c in '_-')
    return os.path.join(CLIENTS_DIR, f'{safe}.json')

async def get_client_config(client_id: str, use_cache: bool = True) -> ClientConfig:
    """
    Получает конфиг клиента. Приоритет: БД -> JSON-файл -> Дефолты.
    """
    client_id = (client_id or 'mitia_assistant').strip()
    if client_id == 'default':
        client_id = 'mitia_assistant'
    
    if client_id == 'mitia_assistant':
        use_cache = False

    if use_cache:
        cached_data = cache_service.get(f"client_cfg:{client_id}")
        if cached_data:
            return ClientConfig(
                client_id=client_id, 
                raw=cached_data.get('raw', {}), 
                db_data=cached_data.get('db_data', {})
            )
    
    base_raw = {}
    if client_id != 'mitia_assistant':
        # Загружаем неизменяемый «золотой стандарт» из двух JSON-файлов
        try:
            theme_path = os.path.join(BASE_DIR, "core", "theme_defaults.json")
            intel_path = os.path.join(BASE_DIR, "core", "intelligence_defaults.json")
            with open(theme_path, "r", encoding="utf-8") as f:
                base_raw = json.load(f)
            with open(intel_path, "r", encoding="utf-8") as f:
                intel = json.load(f)
                base_raw.update(intel)
        except Exception as e:
            log.error(f"Failed to load theme/intelligence defaults for {client_id}: {e}")

    raw = {}
    db_data = {}
    from ..core.config import deep_merge
    from .db_service import AsyncSessionLocal, User, ClientConfig as DBClientConfig
    from sqlalchemy import select
    
    try:
        async with AsyncSessionLocal() as session:
            res_cfg = await session.execute(select(DBClientConfig.config_json).where(DBClientConfig.client_id == client_id))
            config_json = res_cfg.scalar_one_or_none()
            
            res_user = await session.execute(select(User).where(User.client_id == client_id))
            user = res_user.scalar_one_or_none()
            
            if config_json:
                raw = config_json if isinstance(config_json, dict) else json.loads(config_json)
            
            if not raw:
                file_path = _path(client_id)
                if os.path.exists(file_path):
                    try:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            raw = json.load(f)
                            log.info(f"Loaded config from file for {client_id} (migrating to DB...)")
                    except Exception as fe:
                        log.error(f"File read error for {client_id}: {fe}")

            if user:
                db_data = {
                    "balance": user.balance,
                    "tariff_name": user.tariff_name,
                    "messages_consumed": user.messages_consumed,
                    "is_active": user.is_active
                }
                raw['balance'] = user.balance
                raw['tariff_name'] = user.tariff_name
                raw['widget_enabled'] = bool(user.is_active) and bool(raw.get('theme', {}).get('widget_enabled', raw.get('widget_enabled', True)))
    except Exception as e:
        log.error(f"Config loading error for {client_id}: {e}")

    final_raw = copy.deepcopy(base_raw) if base_raw else {}
    if not raw:
        pass
    elif not final_raw:
        final_raw = raw
    else:
        final_raw = deep_merge(final_raw, raw)

    cfg = ClientConfig(client_id=client_id, raw=final_raw, db_data=db_data)
    cache_service.set(f"client_cfg:{client_id}", {"raw": final_raw, "db_data": db_data})
    return cfg

async def list_clients() -> list[str]:
    """Возвращает список всех client_id из БД."""
    from .db_service import AsyncSessionLocal, User
    from sqlalchemy import select
    try:
        async with AsyncSessionLocal() as session:
            res = await session.execute(select(User.client_id).where(User.is_active == True))
            return [r[0] for r in res.all()]
    except Exception as e:
        log.error(f"list_clients error: {e}")
        return []

async def reload_client_config(client_id: str) -> ClientConfig:
    """Принудительно перезагружает конфиг клиента, очищая кэш Redis."""
    cache_service.delete(f"client_cfg:{client_id}")
    return await get_client_config(client_id, use_cache=False)

async def clear_all_client_caches():
    """Очищает весь кэш конфигураций."""
    cache_service.clear_pattern("client_cfg:*")

async def save_client_config(client_id: str, config_dict: dict):
    """
    Сохраняет конфиг клиента в БД и синхронизирует с JSON-файлом.
    """
    from .db_service import AsyncSessionLocal, ClientConfig as DBClientConfig
    from sqlalchemy import update, select
    
    try:
        async with AsyncSessionLocal() as session:
            res = await session.execute(select(DBClientConfig).where(DBClientConfig.client_id == client_id))
            db_cfg = res.scalar_one_or_none()
            
            if db_cfg:
                await session.execute(
                    update(DBClientConfig)
                    .where(DBClientConfig.client_id == client_id)
                    .values(config_json=config_dict)
                )
            else:
                new_cfg = DBClientConfig(client_id=client_id, config_json=config_dict)
                session.add(new_cfg)
            
            await session.commit()
            log.info(f"Config saved to DB for {client_id}")
            
            # Очищаем векторный индекс только при изменении знаний или настроек бота
            # (пропускаем при сохранении интеграций и внешнего вида)
            # try:
            #     from .vector_service import VectorService
            #     vs = VectorService(client_id)
            #     vs.clear()
            # except Exception as ve:
            #     log.error(f"Failed to clear vector index on config save: {ve}")
    except Exception as e:
        log.error(f"Error saving config to DB for {client_id}: {e}")

    file_path = _path(client_id)
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(config_dict, f, ensure_ascii=False, indent=2)
        log.info(f"Config synced to file for {client_id}")
    except Exception as e:
        log.error(f"Error syncing config to file for {client_id}: {e}")

    cache_service.delete(f"client_cfg:{client_id}")
