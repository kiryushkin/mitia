import json
from .clients import get_client_config, save_client_config

async def get_integration_settings(client_id: str, integration_name: str):
    """Получает настройки конкретной интеграции для клиента."""
    config = await get_client_config(client_id)
    integrations = config.raw.get('integrations', {})
    return integrations.get(integration_name, {})

async def save_integration_settings(client_id: str, integration_name: str, settings: dict):
    """Сохраняет настройки конкретной интеграции для клиента."""
    config = await get_client_config(client_id)
    if 'integrations' not in config.raw:
        config.raw['integrations'] = {}
    
    config.raw['integrations'][integration_name] = settings
    await save_client_config(client_id, config.raw)
    
    # save_client_config уже очищает кэш по ключу client_cfg:{client_id}
    return True

async def is_integration_enabled(client_id: str, integration_name: str):
    """Проверяет, включена ли интеграция."""
    settings = await get_integration_settings(client_id, integration_name)
    return settings.get('enabled', False)
