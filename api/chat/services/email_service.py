import asyncio
import hashlib
import imaplib
import smtplib
import email
import email.policy
import re
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.image import MIMEImage
from email.header import decode_header
from typing import List, Optional, Dict

from ..core.config import log
from ..services.clients import list_clients
from ..services.integrations_service import get_integration_settings
from ..services.chat_service import chat_service, extract_response_text, AskData
from ..services.db_service import (
    AsyncSessionLocal, get_or_create_session, save_chat_message, is_operator_mode
)
from .base_polling_service import base_polling_service


def _guess_imap(email_addr: str) -> str:
    domain = (email_addr or "").lower().split("@")[-1]
    mapping = {
        "gmail.com": "imap.gmail.com",
        "yandex.ru": "imap.yandex.ru",
        "ya.ru": "imap.yandex.ru",
        "mail.ru": "imap.mail.ru",
        "bk.ru": "imap.mail.ru",
        "inbox.ru": "imap.mail.ru",
        "list.ru": "imap.mail.ru",
        "rambler.ru": "imap.rambler.ru",
        "outlook.com": "outlook.office365.com",
        "hotmail.com": "outlook.office365.com",
        "live.com": "outlook.office365.com",
        "icloud.com": "imap.mail.me.com",
        "yahoo.com": "imap.mail.yahoo.com",
    }
    return mapping.get(domain, f"imap.{domain}" if domain else "")


def _guess_smtp(email_addr: str) -> str:
    domain = (email_addr or "").lower().split("@")[-1]
    mapping = {
        "gmail.com": "smtp.gmail.com",
        "yandex.ru": "smtp.yandex.ru",
        "ya.ru": "smtp.yandex.ru",
        "mail.ru": "smtp.mail.ru",
        "bk.ru": "smtp.mail.ru",
        "inbox.ru": "smtp.mail.ru",
        "list.ru": "smtp.mail.ru",
        "rambler.ru": "smtp.rambler.ru",
        "outlook.com": "smtp.office365.com",
        "hotmail.com": "smtp.office365.com",
        "live.com": "smtp.office365.com",
        "icloud.com": "smtp.mail.me.com",
        "yahoo.com": "smtp.mail.yahoo.com",
    }
    return mapping.get(domain, f"smtp.{domain}" if domain else "")


class EmailService:
    def __init__(self):
        self.running = False
        self._task = None

    def _guess_imap(self, email_addr: str) -> str:
        return _guess_imap(email_addr)

    def _guess_smtp(self, email_addr: str) -> str:
        return _guess_smtp(email_addr)

    async def start(self):
        if self.running:
            return
        self.running = True
        self._task = asyncio.create_task(self._loop())
        log.info("[EMAIL_SERVICE] Started")

    async def stop(self):
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        log.info("[EMAIL_SERVICE] Stopped")

    async def _loop(self):
        from ..services.db_service import AsyncSessionLocal, User
        from sqlalchemy import select

        async def _list_clients():
            async with AsyncSessionLocal() as db:
                res = await db.execute(select(User.client_id))
                return res.scalars().all()

        async def _get_settings(client_id: str):
            return await get_integration_settings(client_id, "email")

        async def _process_client(client_id: str, settings: dict):
            if settings.get("enabled") and settings.get("email_address") and settings.get("email_password"):
                await self.process_client_emails(client_id, settings, assistant_id=settings.get("assistant_id"))

        await base_polling_service.run_manager_loop(
            service_name="EMAIL_SERVICE",
            list_clients_fn=_list_clients,
            get_settings_fn=_get_settings,
            process_client_fn=_process_client,
            sleep_seconds=10,
            error_sleep_seconds=10,
        )

    async def process_client_emails(self, client_id: str, settings: Dict, assistant_id: str | None = None):
        email_addr = settings.get("email_address")
        password = settings.get("email_password")
        imap_server = settings.get("imap_server") or self._guess_imap(email_addr)
        
        if not imap_server:
            return

        try:
            from .cache_service import cache_service
            
            new_emails = await asyncio.to_thread(
                self._check_imap,
                client_id,
                email_addr,
                password,
                imap_server,
                settings,
                limit=20
            )
            mailbox_key = hashlib.sha256(email_addr.strip().lower().encode()).hexdigest()[:16]
            monitor_key = f"email_monitor_initialized:{client_id}:{assistant_id or 'main'}:{mailbox_key}"
            is_first_check = not cache_service.get(monitor_key)
            if is_first_check:
                # Письма, уже лежавшие в ящике при подключении, не являются новыми диалогами.
                cache_service.set(monitor_key, "1", expire=86400 * 365)
                log.info(f"[EMAIL_SERVICE] Baseline established for {client_id}:{assistant_id or 'main'}")
                return

            for mail_data in new_emails:
                msg_id = mail_data.get("message_id")
                if msg_id:
                    cache_key = f"email_processed:{client_id}:{assistant_id or 'main'}:{hashlib.md5(msg_id.encode()).hexdigest()}"
                    if cache_service.get(cache_key):
                        continue
                    cache_service.set(cache_key, "1", expire=86400 * 30)

                await self.handle_incoming_email(
                    client_id,
                    mail_data["sender"],
                    mail_data["subject"],
                    mail_data["body"],
                    settings,
                    is_historical=False,
                    is_html=mail_data.get("is_html", False),
                    attachments=mail_data.get("attachments", []),
                    message_id=mail_data.get("message_id"),
                    assistant_id=assistant_id,
                )

        except Exception as e:
            log.error(f"[EMAIL_SERVICE] Error processing {email_addr}: {e}")

    def _check_imap(self, client_id: str, email_addr: str, password: str, imap_server: str, settings: Dict, limit: int = 50):
        new_emails = []
        try:
            mail = imaplib.IMAP4_SSL(imap_server, timeout=30)
            mail.login(email_addr, password)
            
            for folder_name in ["inbox"]:
                try:
                    status, _ = mail.select(f'"{folder_name}"', readonly=False)
                    if status != 'OK':
                        continue
                    
                    log.info(f"[EMAIL_SERVICE] Scanning folder: {folder_name}")
                    
                    # Мониторинг забирает только новые непрочитанные письма из входящих.
                    status, messages = mail.search(None, 'UNSEEN')

                    if status != 'OK':
                        continue
                        
                    msg_ids = messages[0].split()
                    
                    msg_ids = msg_ids[-limit:]

                    for num in msg_ids:
                        try:
                            status, data = mail.fetch(num, '(RFC822)')
                            if status != 'OK':
                                continue

                            raw_email = data[0][1]
                            if not raw_email:
                                continue
                                
                            msg = email.message_from_bytes(raw_email)
                            
                            message_id = msg.get("Message-ID", "")
                            sender = self._decode_header(msg.get("From"))
                            subject = self._decode_header(msg.get("Subject"))
                            
                            body = ""
                            html_body = ""
                            attachments = []

                            if msg.is_multipart():
                                for part in msg.walk():
                                    content_type = part.get_content_type()
                                    content_disposition = str(part.get("Content-Disposition"))

                                    if content_type == "text/plain" and "attachment" not in content_disposition:
                                        payload = part.get_payload(decode=True)
                                        if payload: body = payload.decode(errors='ignore')
                                    elif content_type == "text/html" and "attachment" not in content_disposition:
                                        payload = part.get_payload(decode=True)
                                        if payload: html_body = payload.decode(errors='ignore')
                                    # Проверяем и вложения, и встроенные изображения
                                    is_attachment = "attachment" in content_disposition
                                    is_inline = "inline" in content_disposition
                                    
                                    if is_attachment or is_inline or (content_type.startswith("image/") and not html_body):
                                        filename = self._decode_header(part.get_filename())
                                        cid = part.get("Content-ID")
                                        if cid:
                                            cid = cid.strip("<>")
                                        
                                        if not filename and is_inline:
                                            filename = f"image_{cid or 'img'}"

                                        payload = part.get_payload(decode=True)
                                        if payload:
                                            import base64
                                            attachments.append({
                                                "name": filename or cid or "image",
                                                "cid": cid,
                                                "disposition": "inline" if is_inline else "attachment",
                                                "content_type": content_type,
                                                "data": base64.b64encode(payload).decode('utf-8'),
                                                "size": len(payload)
                                            })
                            else:
                                payload = msg.get_payload(decode=True)
                                if payload:
                                    body = payload.decode(errors='ignore')

                            final_content = html_body if html_body else body

                            if final_content:
                                new_emails.append({
                                    "message_id": message_id,
                                    "sender": sender,
                                    "subject": subject,
                                    "body": final_content,
                                    "is_html": bool(html_body),
                                    "attachments": attachments
                                })
                            
                            mail.store(num, '+FLAGS', '\\Seen')
                                
                        except Exception as e:
                            log.error(f"[EMAIL_SERVICE] Error fetching message {num}: {e}")
                            
                except Exception as e:
                    log.error(f"[EMAIL_SERVICE] Error scanning folder {folder_name}: {e}")

            mail.logout()
        except Exception as e:
            log.error(f"[EMAIL_SERVICE] IMAP error for {email_addr}: {e}")
        return new_emails

    def _decode_header(self, header_value: str) -> str:
        if not header_value:
            return ""
        decoded_parts = decode_header(header_value)
        result = ""
        for part, encoding in decoded_parts:
            if isinstance(part, bytes):
                result += part.decode(encoding or "utf-8", errors="ignore")
            else:
                result += part
        return result

    async def handle_incoming_email(self, client_id: str, sender: str, subject: str, body: str, settings: Dict, is_historical: bool = False, is_html: bool = False, attachments: List = None, message_id: str = None, assistant_id: str | None = None):
        log.info(f"[EMAIL_SERVICE] Processing email from {sender} for {client_id} (Historical: {is_historical}, HTML: {is_html})")
        
        email_match = re.search(r'([\w\.-]+@[\w\.-]+)', sender)
        sender_email = email_match.group(1) if email_match else sender

        my_email = settings.get("email_address")
        if my_email and sender_email.lower() == my_email.lower():
            log.info(f"[EMAIL_SERVICE] Skipping email from self: {sender_email}")
            return

        session_id = f"email_{assistant_id or 'main'}_{hashlib.md5(sender_email.encode()).hexdigest()}"
        
        # Создаем/обновляем сессию
        user_info = {
            "first_name": sender.split('<')[0].strip() if '<' in sender else sender,
            "sender": sender,
            "email": sender_email,
            "sender_email": sender_email,
            "platform": "email"
        }
        async with AsyncSessionLocal() as db:
            await get_or_create_session(session_id, client_id, metadata=user_info, assistant_id=assistant_id)

        header_html = f"""
        <div class='email-message-container'>
            <div class='email-header' style='border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 15px;'>
                <div style='font-weight: bold; color: #555;'>От: <span style='color: #000;'>{sender}</span></div>
                <div style='font-weight: bold; color: #555;'>Тема: <span style='color: #000;'>{subject}</span></div>
            </div>
            <div class='email-body'>
                {body if is_html else f'<pre style="white-space: pre-wrap; font-family: inherit;">{body}</pre>'}
            </div>
        """

        if attachments:
            attach_list = "".join([f"<li>📎 {a['name']} ({a.get('content_type', a.get('type', ''))})</li>" for a in attachments])
            header_html += f"""
            <div class='email-attachments' style='margin-top: 20px; padding-top: 10px; border-top: 1px dashed #ccc;'>
                <div style='font-weight: bold; color: #555; margin-bottom: 5px;'>Вложения:</div>
                <ul style='list-style: none; padding: 0; margin: 0; font-size: 0.9em; color: #666;'>
                    {attach_list}
                </ul>
            </div>
            """
        
        header_html += "</div>"

        if len(header_html) > 49000:
            header_html = header_html[:49000] + "\n\n... [письмо обрезано из-за большого размера]"

        ask_data = AskData(
            client_id=client_id,
            assistant_id=assistant_id,
            session_id=session_id,
            message=header_html,
            source="email",
            metadata={
                "platform": "email",
                "mailbox": settings.get("email_address"),
                "subject": subject,
                "sender": sender,
                "sender_email": sender_email,
                "message_id": message_id,
                "has_attachments": bool(attachments)
            },
            attachments=attachments if attachments else None
        )
        
        if is_historical:
            log.info(f"[EMAIL_SERVICE] Saving historical email from {sender_email} to database")
            await chat_service.process_ask(ask_data, stream=False, is_admin=True, skip_ai=True)
            return

        is_operator = await is_operator_mode(session_id)
        assistant_enabled = settings.get("assistant_enabled", False)
        log.info(f"[EMAIL_SERVICE] Flags for {client_id}: assistant={assistant_enabled}, operator={is_operator}")

        if is_operator or not assistant_enabled:
            log.info(f"[EMAIL_SERVICE] Saving message without AI for {session_id}")
            await chat_service.process_ask(ask_data, stream=False, is_admin=True, skip_ai=True)
            from .operator_notification_service import (
                build_incoming_message_notification,
                notify_operators,
            )
            await notify_operators(
                client_id,
                build_incoming_message_notification(
                    source="email",
                    sender=sender,
                    message=f"{subject}: {body}",
                    is_operator=bool(is_operator),
                ),
                assistant_id=assistant_id,
            )

            return

        log.info(f"[EMAIL_SERVICE] AI Assistant is enabled for {client_id}, processing with AI")
        result = await chat_service.process_ask(ask_data, stream=False)
        reply_text = extract_response_text(result)
        if reply_text:
            await self.send_reply(client_id, sender_email, f"Re: {subject}", reply_text, settings)

    async def delete_email(self, client_id: str, message_id: str, settings: Dict):
        """Удаляет письмо из почтового ящика по message_id через IMAP."""
        email_addr = settings.get("email_address")
        password = settings.get("email_password")
        imap_server = settings.get("imap_server") or self._guess_imap(email_addr)
        
        if not imap_server or not message_id:
            return

        try:
            def _delete():
                mail = imaplib.IMAP4_SSL(imap_server, timeout=15)
                mail.login(email_addr, password)
                mail.select("inbox")
                status, data = mail.search(None, f'(HEADER Message-ID "{message_id}")')
                if status == 'OK' and data[0]:
                    for num in data[0].split():
                        mail.store(num, '+FLAGS', '\\Deleted')
                    mail.expunge()
                    log.info(f"[EMAIL_SERVICE] Deleted email {message_id} from inbox")
                mail.logout()
            
            await asyncio.to_thread(_delete)
        except Exception as e:
            log.error(f"[EMAIL_SERVICE] Failed to delete email {message_id}: {e}")

    async def send_reply(self, client_id: str, to_email: str, subject: str, body: str, settings: Dict):
        email_addr = settings.get("email_address")
        password = settings.get("email_password")
        smtp_server = settings.get("smtp_server") or self._guess_smtp(email_addr)

        if not smtp_server:
            log.error(f"[EMAIL_SERVICE] Cannot guess SMTP for {email_addr}")
            return

        try:
            await asyncio.to_thread(self._send_smtp, email_addr, password, smtp_server, to_email, subject, body)
            log.info(f"[EMAIL_SERVICE] Reply sent to {to_email}")
        except Exception as e:
            log.error(f"[EMAIL_SERVICE] SMTP error: {e}")

    def _send_smtp(self, from_email: str, password: str, smtp_server: str, to_email: str, subject: str, body: str):
        signature_icon_cid = "mitia-sign-icon"

        body_plain = body or ""
        signature_plain_text = "С уважением,\nМитя - ИИ-администратор платформы."
        if "Митя - ИИ-администратор платформы." not in body_plain:
            body_plain = f"{body_plain}\n\n{signature_plain_text}".strip()

        body_html = body_plain.replace("\n", "<br>")
        body_html = re.sub(
            r'\bmitia\b(?!\.pro\b)',
            '<a href="https://mitia.pro" style="color: #1a73e8; text-decoration: none;">mitia</a>',
            body_html,
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
        body_html = body_html.replace(signature_plain_html, signature_block_html)

        msg = MIMEMultipart('related')
        msg['Subject'] = subject
        msg['From'] = from_email
        msg['To'] = to_email

        alt_part = MIMEMultipart('alternative')
        alt_part.attach(MIMEText(body_plain, 'plain', 'utf-8'))
        alt_part.attach(MIMEText(body_html, 'html', 'utf-8'))
        msg.attach(alt_part)

        signature_icon_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "img", "icon_mitia.png")
        if os.path.exists(signature_icon_path):
            with open(signature_icon_path, "rb") as sf:
                signature_img = MIMEImage(sf.read(), _subtype="png")
            signature_img.add_header("Content-ID", f"<{signature_icon_cid}>")
            signature_img.add_header("X-Attachment-Id", signature_icon_cid)
            signature_img.add_header("Content-Disposition", "inline")
            msg.attach(signature_img)
        else:
            log.warning(f"[EMAIL_SERVICE] Signature icon file not found: {signature_icon_path}")

        try:
            server = smtplib.SMTP_SSL(smtp_server, 465)
            server.login(from_email, password)
            server.send_message(msg)
            server.quit()
        except:
            server = smtplib.SMTP(smtp_server, 587)
            server.starttls()
            server.login(from_email, password)
            server.send_message(msg)
            server.quit()

        try:
            imap_server = self._guess_imap(from_email)
            if imap_server:
                mail = imaplib.IMAP4_SSL(imap_server, timeout=15)
                mail.login(from_email, password)
                sent_folder = None
                for folder_name in ['Sent', 'INBOX.Sent', 'Sent Items', 'Sent Messages', 
                                     'Отправленные', 'INBOX.Отправленные']:
                    status, _ = mail.select(f'"{folder_name}"', readonly=True)
                    if status == 'OK':
                        sent_folder = folder_name
                        break
                if sent_folder:
                    mail.select(f'"{sent_folder}"', readonly=False)
                    mail.append(
                        f'"{sent_folder}"',
                        '\\Seen',
                        imaplib.Time2Internaldate(email.utils.formatdate()),
                        msg.as_bytes(policy=email.policy.SMTPUTF8)
                    )
                    log.info(f"[EMAIL_SERVICE] Copy saved to {sent_folder}")
                mail.logout()
        except Exception as e:
            log.warning(f"[EMAIL_SERVICE] Failed to save copy to Sent: {e}")

email_service = EmailService()
