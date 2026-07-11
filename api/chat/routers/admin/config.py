import json
import copy
import time

from fastapi import APIRouter, HTTPException, Depends, Request
from sqlalchemy import select, update
from sqlalchemy.orm.attributes import flag_modified

from ...core.config import log, deep_merge, TARIFF_RULES
from ...services.db_service import AsyncSessionLocal, User
from ...services.clients import reload_client_config
from ...services.cache_service import cache_service
from .deps import verify_token
from .files import move_temp_file, delete_old_file

router = APIRouter()


@router.api_route("/config", methods=["GET", "POST"])
async def admin_config(request: Request, client_id: str, token_data: dict = Depends(verify_token)):
    """Получение и сохранение конфигурации клиента."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    target_client_id = (client_id or 'mitia_assistant').strip()
    if target_client_id == 'default':
        target_client_id = 'mitia_assistant'

    from ...services.db_service import ClientConfig as DBClientConfig
    from sqlalchemy.dialects.postgresql import insert

    if request.method == "POST":
        new_data = await request.json()
        new_data['updated_at'] = time.time()
        top_keys = sorted(list(new_data.keys()))
        log.info(f"Updating config for {target_client_id}. keys={top_keys}")

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(DBClientConfig).where(DBClientConfig.client_id == target_client_id))
            db_config_obj = result.scalar_one_or_none()

            updated_config = {}
            if not db_config_obj:
                updated_config = new_data
                db_config_obj = DBClientConfig(client_id=target_client_id, config_json=new_data)
                db.add(db_config_obj)
            else:
                current_config = db_config_obj.config_json or {}

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

                for section, field in file_fields:
                    old_val = current_config.get(section, {}).get(field)

                    if section in new_data and field in new_data[section]:
                        new_val = new_data[section][field]

                        if new_val and "/uploads/temp/" in str(new_val):
                            subfolder = "avatars" if field != 'knowledge_file_url' else "knowledge"
                            new_val = move_temp_file(new_val, target_client_id, subfolder, field)
                            new_data[section][field] = new_val

                        if old_val and old_val != new_val:
                            log.info(f"[CLEANUP] Detected change in {section}.{field}. Old: {old_val}, New: {new_val}")
                            delete_old_file(old_val)
                    elif section in new_data and field not in new_data[section] and section == 'bot_settings' and field == 'knowledge_file_url':
                        pass

                if 'bot_settings' in new_data and 'knowledge_file_name' in new_data['bot_settings']:
                    if 'bot_settings' not in current_config:
                        current_config['bot_settings'] = {}
                    current_config['bot_settings']['knowledge_file_name'] = new_data['bot_settings']['knowledge_file_name']
                    log.info(f"[SAVE] Preserved knowledge_file_name: {new_data['bot_settings']['knowledge_file_name']}")

                # НОРМАЛИЗАЦИЯ: синхронизируем корневой widget_enabled с theme.widget_enabled,
                # чтобы избежать рассинхронизации (в конфиге два поля с одним смыслом)
                if 'theme' in new_data and 'widget_enabled' in new_data['theme']:
                    current_config['widget_enabled'] = new_data['theme']['widget_enabled']
                    log.info(f"[SYNC] Root widget_enabled synced with theme.widget_enabled: {new_data['theme']['widget_enabled']}")

                updated_config = deep_merge(current_config, new_data)

                if 'contacts' in new_data:
                    if 'contacts' not in updated_config:
                        updated_config['contacts'] = {}
                    for c_key, c_val in new_data['contacts'].items():
                        updated_config['contacts'][c_key] = c_val
                    log.info(f"[DEBUG] Contacts explicitly updated: {updated_config['contacts']}")

                if 'legal_data' in new_data:
                    if 'legal_data' not in updated_config:
                        updated_config['legal_data'] = {'ip': {}, 'ooo': {}, 'self': {}}

                    for l_type, l_fields in new_data['legal_data'].items():
                        if l_type not in updated_config['legal_data']:
                            updated_config['legal_data'][l_type] = {}
                        if isinstance(l_fields, dict):
                            for f_key, f_val in l_fields.items():
                                updated_config['legal_data'][l_type][f_key] = f_val
                    log.info(f"[DEBUG] Legal data explicitly updated")

                # НОРМАЛИЗАЦИЯ: Переносим параметры личности в bot_settings
                if 'bot_settings' not in updated_config:
                    updated_config['bot_settings'] = {}

                new_name = updated_config.get('bot_name') or updated_config.get('theme', {}).get('bot_name')
                if new_name:
                    updated_config['bot_settings']['bot_name'] = new_name
                    updated_config.pop('bot_name', None)
                    if 'theme' in updated_config:
                        updated_config['theme'].pop('bot_name', None)

                new_role = updated_config.get('bot_role') or updated_config.get('theme', {}).get('bot_role')
                if new_role:
                    updated_config['bot_settings']['bot_role'] = new_role
                    updated_config.pop('bot_role', None)
                    if 'theme' in updated_config:
                        updated_config['theme'].pop('bot_role', None)

                new_welcome = updated_config.get('welcome_msg') or updated_config.get('theme', {}).get('welcome_msg')
                if new_welcome:
                    updated_config['welcome_msg'] = new_welcome
                    if 'theme' in updated_config:
                        updated_config['theme'].pop('welcome_msg', None)

                new_model = None
                if 'bot_settings' in new_data and 'ai_model' in new_data['bot_settings']:
                    new_model = new_data['bot_settings']['ai_model']

                if not new_model:
                    new_model = new_data.get('ai_model') or new_data.get('theme', {}).get('ai_model')

                if new_model:
                    if 'bot_settings' not in updated_config:
                        updated_config['bot_settings'] = {}
                    updated_config['bot_settings']['ai_model'] = new_model
                    updated_config.pop('ai_model', None)
                    if 'theme' in updated_config:
                        updated_config['theme'].pop('ai_model', None)

                if updated_config.get('bot_settings', {}).get('ai_model') == 'local':
                    updated_config['bot_settings']['ai_model'] = 'local_start'

                log.info(f"[DEBUG] Final ai_model in bot_settings: {updated_config.get('bot_settings', {}).get('ai_model')}")

                theme = updated_config.get('theme', {})
                if not theme.get('widget_img') or theme.get('widget_img') in ['none', 'null', '']:
                    theme['widget_dots_display'] = 'block'
                else:
                    theme['widget_dots_display'] = 'none'
                updated_config['theme'] = theme

                log.info(f"[DEBUG] Final config to save for {target_client_id}: {json.dumps(updated_config, ensure_ascii=False)}")

                db_config_obj.config_json = copy.deepcopy(updated_config)
                flag_modified(db_config_obj, "config_json")

            if 'theme' in new_data and 'widget_enabled' in new_data['theme']:
                await db.execute(
                    update(User)
                    .where(User.client_id == target_client_id)
                    .values(is_active=bool(new_data['theme']['widget_enabled']))
                )

            if 'email' in new_data:
                await db.execute(
                    update(User)
                    .where(User.client_id == target_client_id)
                    .values(email=new_data['email'])
                )

            if 'auto_renew' in new_data:
                await db.execute(
                    update(User)
                    .where(User.client_id == target_client_id)
                    .values(auto_renew=bool(new_data['auto_renew']))
                )

            await db.commit()

            await reload_client_config(target_client_id)
            cache_service.clear_pattern(f"ai_cache:{target_client_id}:*")

            # Очистка векторной базы знаний, чтобы при следующей загрузке она переиндексировалась
            try:
                from ...services.vector_service import VectorService
                vector_db = VectorService(target_client_id)
                vector_db.clear()
                log.info(f"[Vector] Cleared index for {target_client_id} on config save")
            except Exception as ve:
                log.error(f"[Vector] Error clearing index on save: {ve}")

            # Оповещаем все активные виджеты об обновлении конфигурации
            try:
                from ..ws_router import manager
                await manager.broadcast_to_client(target_client_id, {
                    "type": "config_update",
                    "config": updated_config
                })
            except Exception as e:
                log.error(f"Error broadcasting config update: {e}")

            log.info(f"[SAVE] Config and Redis Cache updated for {target_client_id}")

            return {"status": "success", "config": updated_config, "message": "Настройки сохранены, кэш обновлен"}

    async with AsyncSessionLocal() as db:
        res_cfg = await db.execute(select(DBClientConfig.config_json).where(DBClientConfig.client_id == target_client_id))
        config = res_cfg.scalar_one_or_none() or {}

        res_user = await db.execute(select(User).where(User.client_id == target_client_id))
        user = res_user.scalar_one_or_none()

        if user:
            tariff_info = TARIFF_RULES.get(user.tariff_name or 'start', TARIFF_RULES['start'])
            messages_limit = tariff_info.get('base_limit', 30)
            config['email'] = user.email
            config['balance'] = user.balance
            config['tariff_name'] = tariff_info.get('name', user.tariff_name)
            config['messages_used'] = user.messages_consumed
            config['messages_limit'] = messages_limit
            config['is_active'] = user.is_active

        return {"status": "success", "config": config}


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
async def get_integrations(client_id: str, token_data: dict = Depends(verify_token)):
    """Получение всех интеграций клиента."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    from ...services.clients import get_client_config
    config = await get_client_config(client_id)
    return {"status": "success", "integrations": config.raw.get('integrations', {})}


@router.post("/integrations/{name}")
async def update_integration(name: str, client_id: str, request: Request, token_data: dict = Depends(verify_token)):
    """Обновление настроек конкретной интеграции."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    data = await request.json()

    from ...services.integrations_service import save_integration_settings
    await save_integration_settings(client_id, name, data)
    return {"status": "success"}
