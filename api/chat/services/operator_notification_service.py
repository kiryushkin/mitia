"""Unified operator notifications for inbound customer events."""
from __future__ import annotations

from html import escape
import re
from typing import Literal

from ..core.config import log
from .integrations_service import get_integration_settings


NotificationEventType = Literal["lead", "contact", "message"]


def _notification_enabled(settings: dict, event_type: NotificationEventType) -> bool:
    if not settings.get("enabled", False):
        return False

    event_setting = {
        "lead": "notify_leads",
        "contact": "notify_contacts",
        "message": "notify_messages",
    }[event_type]
    return settings.get(event_setting, settings["enabled"])


def _recipient_ids(raw_ids: object) -> list[int]:
    recipients = []
    for value in re.split(r"[;,]", str(raw_ids or "")):
        value = value.strip().split(":")[-1].strip()
        if value.isdigit():
            recipients.append(int(value))
    return recipients


def build_incoming_message_notification(
    *,
    source: str,
    sender: str,
    message: str,
    is_operator: bool,
) -> str:
    source_labels = {
        "telegram": "Telegram",
        "vk": "VK",
        "avito": "Avito",
        "email": "Email",
        "max": "MAX",
        "widget": "Виджет",
    }
    text = " ".join((message or "").split())
    if len(text) > 1000:
        text = f"{text[:997]}..."
    return (
        f"💬 <b>Новое сообщение: {escape(source_labels.get(source, source))}</b>\n"
        f"От: {escape(sender or 'Клиент')}\n"
        f"Текст: {escape(text or '—')}\n\n"
        f"<i>Режим: {'Оператор' if is_operator else 'Ассистент выключен'}</i>"
    )


async def notify_operators(
    client_id: str,
    message: str,
    event_type: NotificationEventType = "message",
    assistant_id: str | None = None,
) -> None:
    """Delivers an operator event to every configured Telegram recipient."""
    telegram_settings = await get_integration_settings(
        client_id, "telegram", assistant_id=assistant_id
    )
    notification_settings = await get_integration_settings(
        client_id, "notifications", assistant_id=assistant_id
    )
    if not _notification_enabled(notification_settings, event_type):
        return

    bot_token = telegram_settings.get("bot_token")
    recipient_ids = _recipient_ids(
        notification_settings.get("admin_id", telegram_settings.get("admin_id", ""))
    )
    if not bot_token or not recipient_ids:
        log.warning(
            "[OPERATOR_NOTIFY] Skip client=%s assistant=%s: token=%s recipients=%s",
            client_id,
            assistant_id or "main",
            bool(bot_token),
            bool(recipient_ids),
        )
        return

    # Local import prevents a circular import: Telegram also emits inbound events.
    from .telegram_service import send_telegram_message

    for recipient_id in recipient_ids:
        try:
            await send_telegram_message(bot_token, recipient_id, message)
        except Exception:
            log.exception(
                "[OPERATOR_NOTIFY] Failed client=%s assistant=%s recipient=%s",
                client_id,
                assistant_id or "main",
                recipient_id,
            )
