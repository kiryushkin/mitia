import copy
import re
from typing import Any, Optional

from sqlalchemy import select, update, func, delete

from ..core.config import TARIFF_RULES, ASSISTANT_SLOTS_HARD_CAP, deep_merge, log
from .notification_service import notify_assistants_limit_exceeded


def get_effective_account_limits(user) -> dict[str, int]:
    tariff_name = str((getattr(user, "tariff_name", None) or "start")).strip().lower() or "start"
    tariff_rules = TARIFF_RULES.get(tariff_name, TARIFF_RULES["start"])
    tariff_assistants_limit = int(tariff_rules.get("assistants_limit", TARIFF_RULES["start"].get("assistants_limit", 1)) or 1)
    purchased_assistants = int(getattr(user, "extra_assistants_purchased", 0) or 0)
    extra_messages_limit = max(0, int(getattr(user, "extra_messages_limit", 0) or 0))
    extra_storage_bytes = max(0, int(getattr(user, "extra_storage_bytes", 0) or 0))
    extra_storage_purchased_bytes = max(0, int(getattr(user, "extra_storage_purchased_bytes", 0) or 0))
    storage_plan_pack_id = str(getattr(user, "storage_plan_pack_id", "") or "")

    extra_context_limit = max(0, int(getattr(user, "extra_context_limit", 0) or 0))
    extra_index_pages = max(0, int(getattr(user, "extra_index_pages", 0) or 0))
    extra_assistants_hard_cap = max(0, int(getattr(user, "extra_assistants_hard_cap", 0) or 0))
    assistants_hard_cap = max(ASSISTANT_SLOTS_HARD_CAP, extra_assistants_hard_cap)
    assistants_limit = min(tariff_assistants_limit + purchased_assistants, assistants_hard_cap)
    return {
        "tariff_name": tariff_name,
        "tariff_assistants_limit": tariff_assistants_limit,
        "extra_assistants_purchased": purchased_assistants,
        "assistants_hard_cap": assistants_hard_cap,
        "assistants_limit": assistants_limit,
        "messages_limit": int(tariff_rules.get("base_limit", TARIFF_RULES["start"]["base_limit"]) or 0) + extra_messages_limit,
        "context_limit": int(tariff_rules.get("context_limit", TARIFF_RULES["start"]["context_limit"]) or 0) + extra_context_limit,

        "max_index_pages": int(tariff_rules.get("max_index_pages", TARIFF_RULES["start"]["max_index_pages"]) or 0) + extra_index_pages,
        "storage_limit": int(tariff_rules.get("storage_limit", TARIFF_RULES["start"]["storage_limit"]) or 0) + extra_storage_bytes + extra_storage_purchased_bytes,
        "extra_messages_limit": extra_messages_limit,
        "extra_storage_bytes": extra_storage_bytes,
        "extra_storage_purchased_bytes": extra_storage_purchased_bytes,
        "storage_plan_pack_id": storage_plan_pack_id,

        "extra_context_limit": extra_context_limit,
        "extra_index_pages": extra_index_pages,
        "extra_assistants_hard_cap": extra_assistants_hard_cap,
        "operators_limit": int(tariff_rules.get("operators_limit", TARIFF_RULES["start"].get("operators_limit", 1)) or 1),
    }
from .cache_service import cache_service
from .db_service import AsyncSessionLocal, User, ClientConfig as LegacyClientConfig, Assistant, AssistantConfig

DEFAULT_ASSISTANT_ID = "main"
ASSISTANT_ACTIVE_KEY = "admin_active_assistant"

ACCOUNT_LEVEL_KEYS = {
    "email",
    "balance",
    "tariff_name",
    "messages_used",
    "messages_limit",
    "messages_consumed",
    "is_active",
    "auto_renew",
    "notifications",
    "ui_settings",
    "analytics",
    "theme",
}

ASSISTANT_LEVEL_KEYS = {
    "bot_settings",
    "theme",
    "welcome_msg",
    "integrations",
    "site_url",
    "sitemap_url",
    "enable_site_search",
    "sync_interval_hours",
    "auto_index_on_start",
    "max_pages_to_index",
    "services",
    "faq",
    "contacts",
    "quick_replies",
    "quick_replies_by_url",
    "quick_replies_tree",
    "allowed_origins",
    "privacy_url",
    "ai_provider",
    "system_prompt",
    "intent_rules",
    "limits",
    "rate_limit_per_minute",
    "max_message_length",
    "working_hours",
    "working_hours_holidays",
    "working_hours_holidays_enabled",
    "legal",
    "legal_data",
    "welcome_trigger_delay_ms",
    "enable_quick_replies",
    "widget_enabled",
}

NEW_ASSISTANT_TOP_LEVEL_CLEAR_KEYS = {
    "site_url",
    "sitemap_url",
    "indexed_pages",
    "indexed_pages_snapshot",
    "indexed_pages_state",
    "indexed_pages_cache",
    "indexed_pages_stats",
    "working_hours",
    "working_hours_holidays",
    "working_hours_holidays_enabled",
    "analytics",
    "knowledge_file_url",
    "knowledge_file_name",
    "price_file_url",
    "price_file_name",
    "ai_unavailable_message",
    "fallback_message",
    "fallback_answer",
    "reserve_answer",
    "reserved_answer",
}

NEW_ASSISTANT_BOT_SETTINGS_CLEAR_KEYS = {
    "knowledge_file_url",
    "knowledge_file_name",
    "price_file_url",
    "price_file_name",
    "ai_unavailable_message",
    "fallback_message",
    "fallback_answer",
    "reserve_answer",
    "reserved_answer",
    "site_url",
    "sitemap_url",
    "indexed_pages",
    "indexed_pages_snapshot",
    "indexed_pages_state",
    "indexed_pages_cache",
    "indexed_pages_stats",
}


def _assistant_cache_key(client_id: str, assistant_id: str) -> str:
    return f"client_cfg:{client_id}:{assistant_id}"


def slugify_assistant_id(value: str) -> str:
    raw = (value or "").strip().lower()
    raw = re.sub(r"[^a-z0-9а-яё_-]+", "-", raw)
    raw = re.sub(r"-+", "-", raw).strip("-")
    return raw or DEFAULT_ASSISTANT_ID


def split_legacy_config(config: Optional[dict]) -> tuple[dict, dict]:
    raw = copy.deepcopy(config or {})
    account = {}
    assistant = {}
    for key, value in raw.items():
        if key in ACCOUNT_LEVEL_KEYS:
            account[key] = value
        elif key in ASSISTANT_LEVEL_KEYS or key not in ACCOUNT_LEVEL_KEYS:
            assistant[key] = value
    return account, assistant


def build_assistant_filter_conditions(column, assistant_filter: Optional[str]):
    raw_value = str(assistant_filter or '').strip()
    if not raw_value or raw_value == 'all':
        return []

    parts = []
    for part in raw_value.split(','):
        normalized = str(part or '').strip()
        if normalized and normalized not in parts:
            parts.append(normalized)
    if not parts or 'all' in parts:
        return []

    include_main = 'main' in parts
    assistant_ids = [part for part in parts if part != 'main']
    if include_main and 'main' not in assistant_ids:
        assistant_ids.append('main')

    conditions = []
    if assistant_ids:
        conditions.append(column.in_(assistant_ids))
    if include_main:
        conditions.append(column.is_(None))
    return conditions


async def ensure_default_assistant(client_id: str) -> Assistant:
    target_client_id = (client_id or "mitia_assistant").strip() or "mitia_assistant"
    async with AsyncSessionLocal() as session:
        existing = await session.execute(
            select(Assistant)
            .where(Assistant.client_id == target_client_id, Assistant.deleted_at.is_(None))
            .order_by(Assistant.is_default.desc(), Assistant.sort_order.asc(), Assistant.id.asc())
        )
        assistant = existing.scalars().first()
        if assistant:
            if not assistant.is_default:
                assistant.is_default = True
                await session.commit()
            return assistant

        legacy_row = await session.execute(
            select(LegacyClientConfig).where(LegacyClientConfig.client_id == target_client_id)
        )
        legacy = legacy_row.scalar_one_or_none()
        legacy_raw = copy.deepcopy((legacy.config_json or {}) if legacy else {})
        _, assistant_cfg = split_legacy_config(legacy_raw)

        # Старый системный клиент может существовать только в legacy-конфиге.
        # Новые таблицы ассистентов ссылаются на users, поэтому создаем
        # минимальную служебную запись перед созданием default-ассистента.
        if target_client_id == "mitia_assistant":
            user_result = await session.execute(
                select(User).where(User.client_id == target_client_id)
            )
            if user_result.scalar_one_or_none() is None:
                legacy_email = str(legacy_raw.get("email") or "").strip()
                email_result = await session.execute(
                    select(User).where(User.email == legacy_email)
                ) if legacy_email else None
                email_taken = email_result.scalar_one_or_none() if email_result else None
                session.add(User(
                    client_id=target_client_id,
                    email=legacy_email if legacy_email and not email_taken else "mitia-assistant@legacy.local",
                    password_hash="legacy-system-client",
                    balance=float(legacy_raw.get("balance") or 0),
                    tariff_name=str(legacy_raw.get("tariff_name") or "start"),
                    is_active=bool(legacy_raw.get("is_active", True)),
                    is_verified=True,
                    auto_renew=bool(legacy_raw.get("auto_renew", False)),
                ))
                await session.flush()

        bot_settings = assistant_cfg.get("bot_settings") or {}
        assistant_name = str(bot_settings.get("bot_name") or legacy_raw.get("bot_name") or "Митя").strip() or "Митя"
        assistant_role = str(bot_settings.get("bot_role") or legacy_raw.get("bot_role") or "ИИ-ассистент").strip() or "ИИ-ассистент"

        assistant = Assistant(
            client_id=target_client_id,
            assistant_id=DEFAULT_ASSISTANT_ID,
            name=assistant_name,
            role=assistant_role,
            is_default=True,
            is_active=True,
            sort_order=0,
        )
        session.add(assistant)
        await session.flush()
        session.add(AssistantConfig(
            assistant_id=assistant.assistant_id,
            client_id=target_client_id,
            config_json=assistant_cfg,
        ))
        await session.commit()
        return assistant


async def ensure_assistant_migration(client_id: str) -> None:
    await ensure_default_assistant(client_id)


async def get_assistants(client_id: str, include_deleted: bool = False) -> list[Assistant]:
    await ensure_assistant_migration(client_id)
    async with AsyncSessionLocal() as session:
        query = select(Assistant).where(Assistant.client_id == client_id)
        if not include_deleted:
            query = query.where(Assistant.deleted_at.is_(None))
        query = query.order_by(Assistant.sort_order.asc(), Assistant.id.asc())
        result = await session.execute(query)
        return list(result.scalars().all())


async def get_assistant(client_id: str, assistant_id: Optional[str] = None) -> Assistant:
    await ensure_assistant_migration(client_id)
    target_assistant_id = assistant_id or DEFAULT_ASSISTANT_ID
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Assistant).where(
                Assistant.client_id == client_id,
                Assistant.assistant_id == target_assistant_id,
                Assistant.deleted_at.is_(None),
            )
        )
        assistant = result.scalar_one_or_none()
        if assistant:
            return assistant

        default_result = await session.execute(
            select(Assistant).where(
                Assistant.client_id == client_id,
                Assistant.is_default == True,
                Assistant.deleted_at.is_(None),
            )
        )
        default_assistant = default_result.scalar_one_or_none()
        if default_assistant:
            return default_assistant

    return await ensure_default_assistant(client_id)


async def get_active_admin_assistant_id(client_id: str) -> str:
    cache_key = f"{ASSISTANT_ACTIVE_KEY}:{client_id}"
    cached = cache_service.get(cache_key)
    if cached:
        return str(cached)
    assistant = await get_assistant(client_id)
    cache_service.set(cache_key, assistant.assistant_id)
    return assistant.assistant_id


async def set_active_admin_assistant_id(client_id: str, assistant_id: str) -> str:
    assistant = await get_assistant(client_id, assistant_id)
    cache_service.set(f"{ASSISTANT_ACTIVE_KEY}:{client_id}", assistant.assistant_id)
    return assistant.assistant_id


async def get_account_config(client_id: str) -> dict[str, Any]:
    await ensure_assistant_migration(client_id)
    async with AsyncSessionLocal() as session:
        res_cfg = await session.execute(select(LegacyClientConfig.config_json).where(LegacyClientConfig.client_id == client_id))
        config = res_cfg.scalar_one_or_none() or {}
        res_user = await session.execute(select(User).where(User.client_id == client_id))
        user = res_user.scalar_one_or_none()

    account_config, _ = split_legacy_config(config)
    if user:
        limits = get_effective_account_limits(user)
        account_config["email"] = user.email
        account_config["balance"] = user.balance
        account_config["tariff_name"] = limits["tariff_name"]
        account_config["messages_used"] = user.messages_consumed
        account_config["messages_consumed"] = user.messages_consumed
        account_config["extra_messages_purchased"] = int(getattr(user, "extra_messages_purchased", 0) or 0)
        account_config["extra_messages_used"] = int(getattr(user, "extra_messages_used", 0) or 0)
        account_config["extra_assistants_purchased"] = limits["extra_assistants_purchased"]
        account_config["extra_messages_limit"] = limits["extra_messages_limit"]
        account_config["tariff_assistants_limit"] = limits["tariff_assistants_limit"]

        account_config["assistants_limit"] = limits["assistants_limit"]
        account_config["assistants_hard_cap"] = limits["assistants_hard_cap"]
        account_config["messages_limit"] = limits["messages_limit"]
        account_config["context_limit"] = limits["context_limit"]
        account_config["operators_limit"] = limits["operators_limit"]
        account_config["max_index_pages"] = limits["max_index_pages"]
        account_config["storage_limit"] = limits["storage_limit"]
        account_config["extra_storage_bytes"] = limits["extra_storage_bytes"]
        account_config["extra_storage_purchased_bytes"] = limits["extra_storage_purchased_bytes"]
        account_config["storage_plan_pack_id"] = limits["storage_plan_pack_id"]
        account_config["extra_context_limit"] = limits["extra_context_limit"]
        account_config["extra_index_pages"] = limits["extra_index_pages"]
        account_config["extra_assistants_hard_cap"] = limits["extra_assistants_hard_cap"]
        account_config["is_active"] = user.is_active
        account_config["auto_renew"] = user.auto_renew
    return account_config


async def get_assistant_config(client_id: str, assistant_id: Optional[str] = None) -> dict[str, Any]:
    assistant = await get_assistant(client_id, assistant_id)
    cache_key = _assistant_cache_key(client_id, assistant.assistant_id)
    cached = cache_service.get(cache_key)
    if cached:
        config = copy.deepcopy(cached)
    else:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(AssistantConfig.config_json).where(
                    AssistantConfig.client_id == client_id,
                    AssistantConfig.assistant_id == assistant.assistant_id,
                )
            )
            config = result.scalar_one_or_none() or {}
        config = copy.deepcopy(config)

    if isinstance(config, dict) and isinstance(config.get("raw"), dict):
        nested = config.get("raw") or {}
        depth_guard = 0
        while isinstance(nested, dict) and isinstance(nested.get("raw"), dict) and depth_guard < 5:
            nested = nested.get("raw") or {}
            depth_guard += 1
        config = nested if isinstance(nested, dict) else {}

    bot_settings = config.setdefault("bot_settings", {})
    if not bot_settings.get("bot_name"):
        bot_settings["bot_name"] = assistant.name
    if not bot_settings.get("bot_role"):
        bot_settings["bot_role"] = assistant.role
    cache_service.set(cache_key, config)
    return copy.deepcopy(config)


async def save_assistant_config(client_id: str, assistant_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    await ensure_assistant_migration(client_id)
    assistant = await get_assistant(client_id, assistant_id)
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(AssistantConfig).where(
                AssistantConfig.client_id == client_id,
                AssistantConfig.assistant_id == assistant.assistant_id,
            )
        )
        row = result.scalar_one_or_none()
        current = copy.deepcopy(row.config_json if row and row.config_json else {})
        merged = deep_merge(current, copy.deepcopy(patch or {}))
        bot_settings = merged.setdefault("bot_settings", {})
        incoming_name = str(bot_settings.get("bot_name") or "").strip()
        incoming_role = str(bot_settings.get("bot_role") or "").strip()
        assistant.name = incoming_name or "Митя"
        assistant.role = incoming_role or "ИИ-ассистент"
        bot_settings["bot_name"] = assistant.name
        bot_settings["bot_role"] = assistant.role
        if row:
            row.config_json = merged
        else:
            row = AssistantConfig(
                client_id=client_id,
                assistant_id=assistant.assistant_id,
                config_json=merged,
            )
            session.add(row)
        await session.commit()

    cache_service.delete(_assistant_cache_key(client_id, assistant.assistant_id))
    return await get_assistant_config(client_id, assistant.assistant_id)


async def save_account_config(client_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    await ensure_assistant_migration(client_id)
    account_patch = {k: v for k, v in (patch or {}).items() if k in ACCOUNT_LEVEL_KEYS}
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(LegacyClientConfig).where(LegacyClientConfig.client_id == client_id))
        row = result.scalar_one_or_none()
        current = copy.deepcopy((row.config_json or {}) if row else {})
        merged = deep_merge(current, account_patch)
        if row:
            row.config_json = merged
        else:
            session.add(LegacyClientConfig(client_id=client_id, config_json=merged))

        user_result = await session.execute(select(User).where(User.client_id == client_id))
        user = user_result.scalar_one_or_none()
        if user:
            if "email" in patch:
                user.email = patch["email"]
            if "auto_renew" in patch:
                user.auto_renew = bool(patch["auto_renew"])
            theme = patch.get("theme") or {}
            if "widget_enabled" in theme:
                # widget_enabled — настройка конкретного ассистента.
                # Глобальный user.is_active трогаем только из суперпанели / явного account patch,
                # иначе выключение виджета у одного ассистента гасит все сайты аккаунта.
                pass
        await session.commit()
    return await get_account_config(client_id)


def _sanitize_new_assistant_config(base_config: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    cfg = copy.deepcopy(base_config or {})
    if not isinstance(cfg, dict):
        cfg = {}

    for key in NEW_ASSISTANT_TOP_LEVEL_CLEAR_KEYS:
        cfg.pop(key, None)

    bot_settings = dict(cfg.get("bot_settings") or {})
    for key in NEW_ASSISTANT_BOT_SETTINGS_CLEAR_KEYS:
        bot_settings.pop(key, None)

    sanitized = {
        "bot_settings": bot_settings,
        "theme": copy.deepcopy(cfg.get("theme") or {}),
        "integrations": copy.deepcopy(cfg.get("integrations") or {}),
        "contacts": {},
        "faq": {},
        "services": {},
        "legal": {},
        "legal_data": {},
        "quick_replies": [],
        "quick_replies_by_url": [],
        "quick_replies_tree": [],
        "welcome_msg": "",
        "indexed_pages": [],
    }

    return sanitized


async def create_assistant(client_id: str, name: str, role: str, base_config: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    await ensure_assistant_migration(client_id)
    base_name = str(name or "Новый ассистент").strip() or "Новый ассистент"
    base_role = str(role or "ИИ-ассистент").strip() or "ИИ-ассистент"
    candidate = slugify_assistant_id(base_name)
    async with AsyncSessionLocal() as session:
        user_result = await session.execute(select(User).where(User.client_id == client_id))
        user = user_result.scalar_one_or_none()
        limits = get_effective_account_limits(user) if user else get_effective_account_limits(type('AnonUser', (), {'tariff_name': 'start', 'extra_assistants_purchased': 0, 'extra_storage_bytes': 0, 'extra_context_limit': 0, 'extra_index_pages': 0, 'extra_assistants_hard_cap': 0})())
        tariff_name = limits['tariff_name']
        extra_assistants_purchased = limits['extra_assistants_purchased']
        assistants_limit = limits['assistants_limit']
        assistants_hard_cap = limits['assistants_hard_cap']

        existing = await session.execute(
            select(func.count()).select_from(Assistant).where(
                Assistant.client_id == client_id,
                Assistant.deleted_at.is_(None),
            )
        )
        assistants_count = int(existing.scalar_one() or 0)
        if assistants_count >= assistants_hard_cap:
            try:
                await notify_assistants_limit_exceeded(client_id, assistants_hard_cap, dedupe_key=f"assistants-limit-hard:{client_id}:{assistants_hard_cap}")
            except Exception:
                pass
            raise ValueError(f"Достигнут технический предел аккаунта — максимум {assistants_hard_cap} ассистентов. Чтобы увеличить лимит выше, обратитесь в поддержку.")
        if assistants_count >= assistants_limit:
            try:
                await notify_assistants_limit_exceeded(client_id, assistants_limit, dedupe_key=f"assistants-limit:{client_id}:{assistants_limit}")
            except Exception:
                pass
            if assistants_limit >= assistants_hard_cap:
                raise ValueError(f"Достигнут технический предел аккаунта — максимум {assistants_hard_cap} ассистентов. Чтобы увеличить лимит выше, обратитесь в поддержку.")
            if tariff_name == 'start' and extra_assistants_purchased <= 0:
                raise ValueError("На тарифе «Старт» доступен только 1 ассистент. Чтобы создать ещё ассистентов, перейдите в раздел тарифов и купите дополнительные слоты или смените тариф.")
            raise ValueError(f"На аккаунте уже использован доступный лимит ассистентов — максимум {assistants_limit}. Чтобы увеличить лимит, перейдите в раздел тарифов.")

        sort_order = assistants_count
        suffix = 1
        while True:
            exists = await session.execute(
                select(Assistant.id).where(Assistant.client_id == client_id, Assistant.assistant_id == candidate)
            )
            if exists.scalar_one_or_none() is None:
                break
            suffix += 1
            candidate = f"{slugify_assistant_id(base_name)}-{suffix}"

        assistant = Assistant(
            client_id=client_id,
            assistant_id=candidate,
            name=base_name,
            role=base_role,
            is_default=False,
            is_active=True,
            sort_order=sort_order,
        )
        session.add(assistant)
        cfg = _sanitize_new_assistant_config(base_config)
        cfg.setdefault("bot_settings", {})
        cfg["bot_settings"]["bot_name"] = base_name
        cfg["bot_settings"]["bot_role"] = base_role
        cfg.setdefault("theme", {})
        cfg.setdefault("integrations", {})
        session.add(AssistantConfig(client_id=client_id, assistant_id=candidate, config_json=cfg))
        await session.commit()

    return {
        "assistant_id": candidate,
        "name": base_name,
        "role": base_role,
        "is_default": False,
        "is_active": True,
        "sort_order": sort_order,
    }


async def update_assistant(client_id: str, assistant_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    assistant = await get_assistant(client_id, assistant_id)
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Assistant).where(Assistant.client_id == client_id, Assistant.assistant_id == assistant.assistant_id)
        )
        row = result.scalar_one()
        if "name" in payload:
            row.name = str(payload["name"] or row.name).strip() or row.name
        if "role" in payload:
            row.role = str(payload["role"] or row.role).strip() or row.role
        if "sort_order" in payload:
            row.sort_order = int(payload["sort_order"] or 0)
        if "is_active" in payload:
            row.is_active = bool(payload["is_active"])
        if payload.get("is_default"):
            await session.execute(
                update(Assistant)
                .where(Assistant.client_id == client_id)
                .values(is_default=False)
            )
            row.is_default = True
        await session.commit()
    cache_service.delete(_assistant_cache_key(client_id, assistant.assistant_id))
    return {
        "assistant_id": assistant.assistant_id,
        "name": payload.get("name", assistant.name),
        "role": payload.get("role", assistant.role),
        "is_default": bool(payload.get("is_default", assistant.is_default)),
        "is_active": bool(payload.get("is_active", assistant.is_active)),
        "sort_order": int(payload.get("sort_order", assistant.sort_order)),
    }


async def soft_delete_assistant(client_id: str, assistant_id: str) -> None:
    assistant = await get_assistant(client_id, assistant_id)
    if assistant.is_default:
        raise ValueError("Нельзя удалить ассистента по умолчанию")

    active_assistant_id = await get_active_admin_assistant_id(client_id)

    async with AsyncSessionLocal() as session:
        await session.execute(
            delete(AssistantConfig).where(
                AssistantConfig.client_id == client_id,
                AssistantConfig.assistant_id == assistant.assistant_id,
            )
        )
        await session.execute(
            delete(Assistant).where(
                Assistant.client_id == client_id,
                Assistant.assistant_id == assistant.assistant_id,
            )
        )
        await session.commit()

    await clear_assistant_runtime_cache(client_id, assistant.assistant_id)
    if active_assistant_id == assistant.assistant_id:
        await set_active_admin_assistant_id(client_id, DEFAULT_ASSISTANT_ID)


async def list_assistants_payload(client_id: str) -> list[dict[str, Any]]:
    active_assistant_id = await get_active_admin_assistant_id(client_id)
    assistants = await get_assistants(client_id)
    cache_service.clear_pattern(f"client_cfg:{client_id}:*")
    payload = []
    for assistant in assistants:
        cfg = await get_assistant_config(client_id, assistant.assistant_id)
        if isinstance(cfg, dict) and isinstance(cfg.get("raw"), dict):
            cfg = cfg.get("raw") or {}
        bot_settings = cfg.get("bot_settings") or {}

        normalized_name = str(bot_settings.get("bot_name") or assistant.name or "Митя").strip() or "Митя"
        normalized_role = str(bot_settings.get("bot_role") or assistant.role or "ИИ-ассистент").strip() or "ИИ-ассистент"

        if assistant.name != normalized_name or assistant.role != normalized_role:
            async with AsyncSessionLocal() as session:
                row = await session.execute(
                    select(Assistant).where(Assistant.client_id == client_id, Assistant.assistant_id == assistant.assistant_id)
                )
                db_assistant = row.scalar_one_or_none()
                if db_assistant:
                    db_assistant.name = normalized_name
                    db_assistant.role = normalized_role
                    await session.commit()
            assistant.name = normalized_name
            assistant.role = normalized_role

        payload.append({
            "assistant_id": assistant.assistant_id,
            "name": normalized_name,
            "role": normalized_role,
            "is_default": bool(assistant.is_default),
            "is_active": bool(assistant.is_active),
            "is_selected": assistant.assistant_id == active_assistant_id,
            "sort_order": assistant.sort_order,
            "config": cfg,
        })
    return payload


def _normalize_origin_host(value: str) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    raw = raw.replace("https://", "").replace("http://", "")
    raw = raw.split("/")[0].split("?")[0].split("#")[0]
    raw = raw.replace("www.", "").split(":")[0].strip()
    return raw


async def resolve_assistant_id_for_origin(client_id: str, origin_or_host: Optional[str] = None) -> str:
    """Находит ассистента по домену сайта.

    Нужен для публичного виджета: каждый ассистент может быть привязан к своему домену.
    Если assistant_id не передан в script, выбираем ассистента по referer/origin.
    Fallback: default/main, а не "активный в админке".
    """
    await ensure_assistant_migration(client_id)
    host = _normalize_origin_host(origin_or_host or "")
    assistants = await get_assistants(client_id)

    if host:
        for assistant in assistants:
            cfg = await get_assistant_config(client_id, assistant.assistant_id)
            if isinstance(cfg, dict) and isinstance(cfg.get("raw"), dict):
                cfg = cfg.get("raw") or {}
            origins = cfg.get("allowed_origins") or []
            if isinstance(origins, str):
                origins = [origins] if origins.strip() else []
            for origin in origins:
                if _normalize_origin_host(origin) == host:
                    return assistant.assistant_id

    for assistant in assistants:
        if assistant.is_default:
            return assistant.assistant_id
    if assistants:
        return assistants[0].assistant_id
    return DEFAULT_ASSISTANT_ID


async def clear_assistant_runtime_cache(client_id: str, assistant_id: str) -> None:
    cache_service.delete(_assistant_cache_key(client_id, assistant_id))
    cache_service.clear_pattern(f"ai_cache:{client_id}:{assistant_id}:*")
    cache_service.clear_pattern(f"client_cfg:{client_id}:{assistant_id}*")


async def assistant_cache_key(client_id: str, assistant_id: str, suffix: str) -> str:
    target_assistant_id = assistant_id or await get_active_admin_assistant_id(client_id)
    return f"ai_cache:{client_id}:{target_assistant_id}:{suffix}"
