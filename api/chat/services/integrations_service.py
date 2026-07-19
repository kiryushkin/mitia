from sqlalchemy import update

from .assistants_service import get_assistant_config, get_assistants, save_assistant_config, get_active_admin_assistant_id
from .db_service import AsyncSessionLocal, ChatSession


async def get_integration_settings(client_id: str, integration_name: str, assistant_id: str | None = None):
    """Получает настройки конкретной интеграции для клиента в контексте ассистента."""
    resolved_assistant_id = assistant_id or await get_active_admin_assistant_id(client_id)
    config = await get_assistant_config(client_id, resolved_assistant_id)
    integrations = config.get('integrations', {})
    settings = integrations.get(integration_name, {})
    if isinstance(settings, dict):
        settings.setdefault('assistant_id', resolved_assistant_id)
    return settings


async def save_integration_settings(client_id: str, integration_name: str, settings: dict, assistant_id: str | None = None):
    """Сохраняет настройки конкретной интеграции для ассистента."""
    resolved_assistant_id = assistant_id or await get_active_admin_assistant_id(client_id)
    config = await get_assistant_config(client_id, resolved_assistant_id)
    integrations = dict(config.get('integrations') or {})
    payload = dict(settings or {})
    payload['assistant_id'] = resolved_assistant_id
    integrations[integration_name] = payload
    await save_assistant_config(client_id, resolved_assistant_id, {'integrations': integrations})

    # A channel switched back to Assistant must not remain blocked by an old
    # per-dialog manual takeover. Limit/billing checks still protect AI later.
    if payload.get('enabled') and payload.get('assistant_enabled') is True:
        prefixes = {
            'telegram': 'tg-',
            'max': 'max-',
            'vk': 'vk-',
            'ok': 'ok-',
            'avito': 'avito-',
            'email': 'email_',
            'hh': 'hh-',
        }
        prefix = prefixes.get(integration_name)
        if prefix:
            async with AsyncSessionLocal() as db:
                await db.execute(
                    update(ChatSession)
                    .where(
                        ChatSession.client_id == client_id,
                        ChatSession.assistant_id == resolved_assistant_id,
                        ChatSession.session_id.startswith(prefix),
                    )
                    .values(is_operator_mode=False)
                )
                await db.commit()
    return True


async def list_integration_settings(client_id: str, integration_name: str) -> list[tuple[str, dict]]:
    """Возвращает настройки канала каждого ассистента аккаунта.

    Используется только внешними webhook/polling-процессами: они не должны
    зависеть от ассистента, который последний раз был открыт в админке.
    """
    result = []
    for assistant in await get_assistants(client_id):
        settings = await get_integration_settings(
            client_id, integration_name, assistant_id=assistant.assistant_id
        )
        if isinstance(settings, dict):
            result.append((assistant.assistant_id, settings))
    return result


async def is_integration_enabled(client_id: str, integration_name: str, assistant_id: str | None = None):
    """Проверяет, включена ли интеграция."""
    settings = await get_integration_settings(client_id, integration_name, assistant_id=assistant_id)
    return settings.get('enabled', False)
