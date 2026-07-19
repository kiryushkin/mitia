import json
import copy
import time

from fastapi import APIRouter, HTTPException, Depends, Request
from sqlalchemy import select, update
from sqlalchemy.orm.attributes import flag_modified

from ...core.config import log, deep_merge, TARIFF_RULES
from ...services.db_service import AsyncSessionLocal, User
from ...services.clients import reload_client_config, get_client_config
from ...services.assistants_service import (
    get_account_config,
    get_assistant_config,
    save_account_config,
    save_assistant_config,
    get_active_admin_assistant_id,
    clear_assistant_runtime_cache,
)
from ...services.cache_service import cache_service
from .deps import verify_token
from .files import move_temp_file, delete_old_file

router = APIRouter()


@router.api_route("/config", methods=["GET", "POST"])
async def admin_config(request: Request, client_id: str, assistant_id: str | None = None, token_data: dict = Depends(verify_token)):
    """Совместимый endpoint общего конфига: account-level + assistant-level в контексте выбранного assistant_id."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    target_client_id = (client_id or 'mitia_assistant').strip()
    if target_client_id == 'default':
        target_client_id = 'mitia_assistant'
    target_assistant_id = assistant_id or await get_active_admin_assistant_id(target_client_id)

    if request.method == "POST":
        new_data = await request.json()
        new_data['updated_at'] = time.time()
        top_keys = sorted(list(new_data.keys()))
        log.info(f"Updating config for {target_client_id}:{target_assistant_id}. keys={top_keys}")

        # Нормализация allowed_origins: https://example.com без path/slash
        if 'allowed_origins' in new_data:
            raw_origins = new_data.get('allowed_origins') or []
            if isinstance(raw_origins, str):
                raw_origins = [raw_origins] if raw_origins.strip() else []
            normalized = []
            for raw in raw_origins:
                value = str(raw or '').strip()
                if not value:
                    continue
                if not value.startswith(('http://', 'https://')):
                    value = f'https://{value}'
                value = value.rstrip('/')
                try:
                    from urllib.parse import urlparse
                    parsed = urlparse(value)
                    if parsed.netloc:
                        value = f"{parsed.scheme}://{parsed.netloc}"
                except Exception:
                    pass
                if value not in normalized:
                    normalized.append(value)
            new_data['allowed_origins'] = normalized

        account_patch = {}
        assistant_patch = copy.deepcopy(new_data)

        if 'email' in new_data:
            account_patch['email'] = new_data['email']
            assistant_patch.pop('email', None)
        if 'auto_renew' in new_data:
            account_patch['auto_renew'] = new_data['auto_renew']
            assistant_patch.pop('auto_renew', None)

        # The operator name is account-wide: one person answers messages from
        # every assistant and every external channel.
        theme_patch = dict(new_data.get('theme') or {})
        if 'msg_operator_name' in theme_patch:
            account_patch['theme'] = {'msg_operator_name': theme_patch['msg_operator_name']}
            assistant_theme = dict(assistant_patch.get('theme') or {})
            assistant_theme.pop('msg_operator_name', None)
            if assistant_theme:
                assistant_patch['theme'] = assistant_theme
            else:
                assistant_patch.pop('theme', None)

        file_fields = [
            ('theme', 'widget_img'),
            ('theme', 'msg_bot_avatar'),
            ('theme', 'msg_user_avatar'),
            ('theme', 'msg_operator_avatar'),
            ('theme', 'profile_avatar'),
            ('theme', 'window_bg_img'),
            ('theme', 'header_logo'),
            ('theme', 'welcome_img'),
            ('theme', 'inline_btn_accent_img'),
            ('theme', 'inline_btn_neutral_img'),
            ('theme', 'inline_btn_info_img'),
            ('bot_settings', 'knowledge_file_url'),
            ('bot_settings', 'knowledge_file_name')
        ]

        current_assistant_config = await get_assistant_config(target_client_id, target_assistant_id)
        for section, field in file_fields:
            old_val = current_assistant_config.get(section, {}).get(field)
            if section in assistant_patch and field in assistant_patch[section]:
                new_val = assistant_patch[section][field]
                if new_val and "/uploads/temp/" in str(new_val):
                    subfolder = "avatars" if field != 'knowledge_file_url' else "knowledge"
                    new_val = move_temp_file(new_val, f"{target_client_id}/{target_assistant_id}", subfolder, field)
                    assistant_patch[section][field] = new_val
                if old_val and old_val != new_val:
                    delete_old_file(old_val)

        if assistant_patch.get('bot_settings', {}).get('ai_model') == 'local':
            assistant_patch['bot_settings']['ai_model'] = 'local_start'

        if 'theme' in assistant_patch:
            theme = assistant_patch.get('theme', {}) or {}
            theme['widget_dots_display'] = 'none' if theme.get('widget_img') not in [None, '', 'none', 'null'] else 'block'
            assistant_patch['theme'] = theme

        saved_assistant_config = await save_assistant_config(target_client_id, target_assistant_id, assistant_patch)
        if account_patch:
            await save_account_config(target_client_id, account_patch)

        await reload_client_config(target_client_id, assistant_id=target_assistant_id)
        await clear_assistant_runtime_cache(target_client_id, target_assistant_id)

        try:
            from ...services.vector_service import VectorService
            vector_db = VectorService(f"{target_client_id}:{target_assistant_id}")
            vector_db.clear()
        except Exception as ve:
            log.error(f"[Vector] Error clearing index on save: {ve}")

        try:
            from ..ws_router import manager
            await manager.broadcast_to_client(target_client_id, {
                "type": "config_update",
                "assistant_id": target_assistant_id,
                "config": saved_assistant_config
            })
        except Exception as e:
            log.error(f"Error broadcasting config update: {e}")

        merged_config = await get_client_config(target_client_id, use_cache=False, assistant_id=target_assistant_id)
        return {"status": "success", "config": merged_config.raw, "assistant_id": target_assistant_id, "message": "Настройки сохранены, кэш обновлен"}

    config = await get_client_config(target_client_id, use_cache=False, assistant_id=target_assistant_id)
    if config.db_data:
        tariff_info = TARIFF_RULES.get(config.db_data.get('tariff_name') or 'start', TARIFF_RULES['start'])
        config.raw['tariff_name'] = tariff_info.get('name', config.db_data.get('tariff_name'))
        config.raw['messages_limit'] = tariff_info.get('base_limit', 30)
        config.raw['messages_used'] = config.db_data.get('messages_consumed', 0)
        config.raw['is_active'] = config.db_data.get('is_active', True)

    return {"status": "success", "config": config.raw, "assistant_id": target_assistant_id}


@router.get("/global-operator-status")
async def get_global_operator_status(client_id: str, token_data: dict = Depends(verify_token)):
    """Получение глобального статуса ассистента (is_active)."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(User.is_active).where(User.client_id == client_id))
        is_active = res.scalar_one_or_none()
        return {"status": "success", "enabled": bool(is_active)}


@router.post("/global-operator-status")
async def save_global_operator_status(request: Request, token_data: dict = Depends(verify_token)):
    """Сохранение глобального статуса ассистента."""
    data = await request.json()
    client_id = data.get('client_id')
    enabled = data.get('enabled')

    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    async with AsyncSessionLocal() as db:
        await db.execute(
            update(User)
            .where(User.client_id == client_id)
            .values(is_active=bool(enabled))
        )
        await db.commit()
    
    await reload_client_config(client_id)
    return {"status": "success"}


@router.post("/config/clear-cache")
async def clear_client_ai_cache(client_id: str, token_data: dict = Depends(verify_token)):
    """Очистка кэша ответов ИИ для клиента."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    cache_service.clear_pattern(f"ai_cache:{client_id}:*")
    return {"status": "success", "message": "Кэш ИИ успешно очищен"}


@router.get("/integrations")
async def get_integrations(client_id: str, assistant_id: str | None = None, token_data: dict = Depends(verify_token)):
    """Получение всех интеграций клиента."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    config = await get_client_config(client_id, assistant_id=assistant_id)
    return {"status": "success", "integrations": config.raw.get('integrations', {}), "assistant_id": config.raw.get('assistant_id')}


@router.post("/integrations/{name}")
async def update_integration(name: str, client_id: str, assistant_id: str | None = None, request: Request = None, token_data: dict = Depends(verify_token)):
    """Обновление настроек конкретной интеграции."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    data = await request.json()
    target_assistant_id = assistant_id or await get_active_admin_assistant_id(client_id)

    current = await get_assistant_config(client_id, target_assistant_id)
    integrations = copy.deepcopy(current.get('integrations') or {})
    integration_payload = copy.deepcopy(data)
    integration_payload['assistant_id'] = target_assistant_id
    integrations[name] = integration_payload
    await save_assistant_config(client_id, target_assistant_id, {'integrations': integrations})

    if name == 'widget':
        widget_enabled = bool(data.get('enabled', False))
        allowed_origins_value = data.get('allowed_origins', '')
        if isinstance(allowed_origins_value, str):
            allowed_origins = [allowed_origins_value] if allowed_origins_value else []
        elif isinstance(allowed_origins_value, list):
            allowed_origins = [v for v in allowed_origins_value if v]
        else:
            allowed_origins = []

        # Нормализуем домены: https://example.com, без пути и слэша в конце.
        normalized_origins = []
        for raw in allowed_origins:
            value = str(raw or '').strip()
            if not value:
                continue
            if not value.startswith(('http://', 'https://')):
                value = f'https://{value}'
            value = value.rstrip('/')
            # Убираем path, оставляем origin
            try:
                from urllib.parse import urlparse
                parsed = urlparse(value)
                if parsed.netloc:
                    value = f"{parsed.scheme}://{parsed.netloc}"
            except Exception:
                pass
            if value not in normalized_origins:
                normalized_origins.append(value)

        await save_assistant_config(client_id, target_assistant_id, {
            'allowed_origins': normalized_origins,
            'theme': {'widget_enabled': widget_enabled}
        })

    await reload_client_config(client_id, assistant_id=target_assistant_id)
    await clear_assistant_runtime_cache(client_id, target_assistant_id)

    return {"status": "success", "assistant_id": target_assistant_id}
