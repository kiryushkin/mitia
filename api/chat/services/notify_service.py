import httpx
import smtplib
import ssl
import logging
import json
import hmac
import hashlib
import random
import os
import re
from email.message import EmailMessage
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.image import MIMEImage
from email.utils import formatdate, make_msgid
from typing import Optional, Dict
from ..core.config import MAIL_CONFIG, TELEGRAM_CONFIG, MAX_CONFIG, VK_CONFIG, log

def _format_for_messenger(message: str) -> str:
    """Очищает Markdown-разметку для мессенджеров."""
    if not message: return ''
    return message.replace('**', '').replace('###', '').strip()

async def send_telegram_notification(text: str):
    """Отправка уведомления в Telegram."""
    token = TELEGRAM_CONFIG.get('token')
    chat_id = TELEGRAM_CONFIG.get('chat_id')
    if not token or not chat_id: return
    
    # Очищаем HTML-теги, которые Telegram не может распарсить
    import re
    # Сначала заменяем <br> и </p> на переносы строк
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</p>', '\n', text, flags=re.IGNORECASE)
    # Удаляем все остальные теги, кроме разрешенных в Telegram HTML (b, i, a, code, pre)
    text = re.sub(r'<(?!/?(b|i|a|code|pre)\b)[^>]+>', '', text)
    # Ограничиваем длину сообщения (лимит Telegram ~4096 символов)
    if len(text) > 4000:
        text = text[:3900] + "..."
    
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    async with httpx.AsyncClient() as client:
        try:
            await client.post(url, json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"})
        except Exception as e:
            log.error(f"Telegram Notify Error: {e}")

async def send_vk_notification(peer_id: str, message: str):
    """Отправка уведомления в VK."""
    token = VK_CONFIG.get('token')
    if not token or not peer_id: return
    
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.vk.com/method/messages.send",
                data={
                    "access_token": token,
                    "user_id": peer_id,
                    "random_id": random.getrandbits(31),
                    "message": _format_for_messenger(message),
                    "v": "5.131",
                },
            )
            data = resp.json()
            if data.get("error"):
                log.error(f"VK Notify Error: {data['error']}")
    except Exception as e:
        log.error(f"VK Notify Error: {e}")

async def notify_lead(client_id: str, lead_data: dict, channels: Dict, user_email: Optional[str] = None):
    """
    Универсальная функция уведомления о новом лиде по всем каналам.
    """
    text = f"Новый лид!\n\n"
    text += f"Имя: {lead_data.get('name', 'Аноним')}\n"
    text += f"Контакт: {lead_data.get('contact', 'Не указан')}\n"
    if lead_data.get('message'):
        text += f"\nСообщение:\n{lead_data['message']}"

    if channels.get('telegram'):
        await send_telegram_notification(f"<b>Новый лид!</b>\n\nИмя: {lead_data.get('name', 'Аноним')}\nКонтакт: {lead_data.get('contact', 'Не указан')}\n\nСообщение:\n{lead_data.get('message', '-')}")
    
    if channels.get('vk_peer_id'):
        await send_vk_notification(channels['vk_peer_id'], text)
    
    if channels.get('email_leads') and user_email:
        subject = f"Новая заявка от {lead_data.get('name', 'Аноним')}"
        await send_email(user_email, subject, text)


async def send_email(to_email: str, subject: str, body_plain: str) -> bool:
    """
    Отправка Email через SMTP (асинхронная обёртка).
    ВАЖНО: Используется при регистрации пользователей и подтверждении почты.
    """
    import asyncio
    conf = MAIL_CONFIG
    if not conf.get('password'):
        log.warning("MAIL_PASSWORD не настроен, письмо не отправлено")
        return False
    
    logo_cid = "mitia-logo"
    signature_icon_cid = "mitia-sign-icon"

    body_plain_with_signature = body_plain or ""
    signature_plain_text = "С уважением,\nМитя - ИИ-администратор платформы."
    if "Митя - ИИ-администратор платформы." not in body_plain_with_signature:
        body_plain_with_signature = f"{body_plain_with_signature}\n\n{signature_plain_text}".strip()

    content_html = body_plain_with_signature.replace(chr(10), '<br>')
    # Делаем слово mitia в тексте письма кликабельным (не трогаем mitia.pro)
    content_html = re.sub(
        r'\bmitia\b(?!\.pro\b)',
        '<a href="https://mitia.pro" style="color: #1a73e8; text-decoration: none;">mitia</a>',
        content_html,
        flags=re.IGNORECASE,
    )
    signature_plain_html = "С уважением,<br>Митя - ИИ-администратор платформы."
    signature_block_html = (
        f"<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin-top: 8px;\">"
        f"<tr>"
        f"<td style=\"vertical-align: middle; padding-right: 10px;\">"
        f"<img src=\"cid:{signature_icon_cid}\" alt=\"Митя\" style=\"width: 40px; height: 40px; display: block; border-radius: 8px;\" />"
        f"</td>"
        f"<td style=\"vertical-align: middle;\">С уважением,<br>Митя - ИИ-администратор платформы.</td>"
        f"</tr>"
        f"</table>"
    )
    content_html = content_html.replace(signature_plain_html, signature_block_html)

    body_html = f"""<html><body style="font-family: sans-serif; color: #1a1a1a; max-width: 480px; margin: 0 auto; padding: 30px 20px;">
<div style="text-align: center; margin-bottom: 30px;">
  <img src="cid:{logo_cid}" alt="MITIA" style="height: 32px; width: auto; display: inline-block;" />
</div>
<div style="background: #f9f9f9; border-radius: 20px; padding: 40px; line-height: 1.6; font-size: 15px;">
  {content_html}
</div>
<div style="text-align: center; margin-top: 30px; font-size: 12px; color: #aaa;">
  <p>© <a href="https://mitia.pro" style="color: #1a73e8; text-decoration: none;">mitia.pro</a> — умный помощник для бизнеса</p>
</div>
</body></html>"""

    def _send_sync():
        try:
            msg = EmailMessage()
            msg['From'] = conf['from']
            msg['To'] = to_email
            msg['Subject'] = subject
            msg['Date'] = formatdate(localtime=True)
            msg['Message-ID'] = make_msgid(domain=conf['from'].split('@')[-1])
            msg['Reply-To'] = conf.get('reply_to', conf['from'])
            msg['Auto-Submitted'] = 'auto-generated'
            msg['X-Auto-Response-Suppress'] = 'All'
            msg.set_content(body_plain_with_signature, subtype='plain', charset='utf-8')
            msg.add_alternative(body_html, subtype='html', charset='utf-8')

            html_part = msg.get_payload()[-1]

            logo_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "img", "mitia_logo.png")
            if os.path.exists(logo_path):
                with open(logo_path, "rb") as lf:
                    html_part.add_related(
                        lf.read(),
                        maintype="image",
                        subtype="png",
                        cid=f"<{logo_cid}>",
                        disposition="inline",
                    )
            else:
                log.warning(f"Logo file not found for email template: {logo_path}")

            signature_icon_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "img", "icon_mitia.png")
            if os.path.exists(signature_icon_path):
                with open(signature_icon_path, "rb") as sf:
                    html_part.add_related(
                        sf.read(),
                        maintype="image",
                        subtype="png",
                        cid=f"<{signature_icon_cid}>",
                        disposition="inline",
                    )
            else:
                log.warning(f"Signature icon file not found for email template: {signature_icon_path}")

            ctx = ssl.create_default_context()

            with smtplib.SMTP_SSL(conf['server'], conf['port'], context=ctx, timeout=10.0) as server:
                server.login(conf['user'], conf['password'])
                server.send_message(msg)

            log.info(f"Email sent to {to_email}")
            return True
        except Exception as e:
            log.error(f"Email error to {to_email}: {e}")
            return False

    return await asyncio.to_thread(_send_sync)

async def send_max_notification(chat_id: str, message: str):
    """
    Отправка уведомления в MAX.
    """
    from .max_service import send_max_message
    from ..core.config import MAX_CONFIG
    token = MAX_CONFIG.get('bot_token')
    if not token or not chat_id: return
    await send_max_message(token, int(chat_id), message)


