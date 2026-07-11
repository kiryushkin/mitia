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
        self.sync_progress = {}

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
            if settings.get("email_address") and settings.get("email_password"):
                await self.process_client_emails(client_id, settings)

        await base_polling_service.run_manager_loop(
            service_name="EMAIL_SERVICE",
            list_clients_fn=_list_clients,
            get_settings_fn=_get_settings,
            process_client_fn=_process_client,
            sleep_seconds=10,
            error_sleep_seconds=10,
        )

    async def process_client_emails(self, client_id: str, settings: Dict):
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
            
            for mail_data in new_emails:
                msg_id = mail_data.get("message_id")
                if msg_id:
                    cache_key = f"email_processed:{client_id}:{hashlib.md5(msg_id.encode()).hexdigest()}"
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
                    message_id=mail_data.get("message_id")
                )

        except Exception as e:
            log.error(f"[EMAIL_SERVICE] Error processing {email_addr}: {e}")

    async def sync_historical_emails(self, client_id: str, settings: Dict, mode: str = "sync_only", force: bool = False):
        """Запускает фоновую синхронизацию исторических писем."""
        email_addr = settings.get("email_address")
        password = settings.get("email_password")
        imap_server = settings.get("imap_server") or self._guess_imap(email_addr)
        
        if not imap_server:
            return

        if client_id in self.sync_progress and self.sync_progress[client_id]["status"] == "syncing":
            log.info(f"[EMAIL_SERVICE] Sync already in progress for {client_id}")
            return

        self.sync_progress[client_id] = {"total": 0, "current": 0, "status": "syncing"}
        
        async def _sync_task():
            try:
                from .cache_service import cache_service
                log.info(f"[EMAIL_SERVICE] Starting historical sync for {client_id} (Mode: {mode}, Force: {force})")
                
                if force:
                    cache_service.delete(f"email_sync_done:{client_id}")
                    cache_service.clear_pattern(f"email_processed:{client_id}:*")
                    log.info(f"[EMAIL_SERVICE] Cache cleared for forced sync of {client_id}")
                
                all_folders = await asyncio.to_thread(self._list_folders, email_addr, password, imap_server)
                log.info(f"[EMAIL_SERVICE] Found folders: {all_folders}")
                
                emails = await asyncio.to_thread(
                    self._check_imap,
                    client_id,
                    email_addr,
                    password,
                    imap_server,
                    settings,
                    since_days=None,
                    update_progress=True,
                    folders=all_folders
                )
                
                total = len(emails)
                self.sync_progress[client_id]["total"] = total
                
                for i, mail_data in enumerate(emails):
                    self.sync_progress[client_id]["current"] = i + 1
                    
                    msg_id = mail_data.get("message_id")
                    if msg_id:
                        cache_key = f"email_processed:{client_id}:{hashlib.md5(msg_id.encode()).hexdigest()}"
                        if cache_service.get(cache_key):
                            continue
                        cache_service.set(cache_key, "1", expire=86400 * 30)

                    await self.handle_incoming_email(
                        client_id, 
                        mail_data["sender"], 
                        mail_data["subject"], 
                        mail_data["body"], 
                        settings,
                        is_historical=(mode == "sync_only"),
                        is_html=mail_data.get("is_html", False),
                        attachments=mail_data.get("attachments", []),
                        message_id=mail_data.get("message_id")
                    )
                
                self.sync_progress[client_id]["status"] = "completed"
                log.info(f"[EMAIL_SERVICE] Historical sync completed for {client_id}")
                
                cache_service.set(f"email_sync_done:{client_id}", "1")
                
            except Exception as e:
                log.error(f"[EMAIL_SERVICE] Historical sync error for {client_id}: {e}")
                self.sync_progress[client_id]["status"] = "error"
                self.sync_progress[client_id]["error"] = str(e)

        asyncio.create_task(_sync_task())

    def _list_folders(self, email_addr: str, password: str, imap_server: str) -> list:
        """Возвращает список всех папок в ящике (кроме служебных)."""
        try:
            mail = imaplib.IMAP4_SSL(imap_server, timeout=15)
            mail.login(email_addr, password)
            status, folder_list = mail.list()
            mail.logout()
            
            if status != 'OK':
                return ["inbox"]
            
            folders = []
            for folder_info in folder_list:
                if isinstance(folder_info, bytes):
                    parts = folder_info.decode('utf-8', errors='ignore').split('"')
                    if len(parts) >= 2:
                        folder_name = parts[-2] if len(parts) % 2 == 0 else parts[-1]
                        if folder_name:
                            folders.append(folder_name)
            
            return folders if folders else ["inbox"]
        except Exception as e:
            log.error(f"[EMAIL_SERVICE] Failed to list folders: {e}")
            return ["inbox"]

    def _check_imap(self, client_id: str, email_addr: str, password: str, imap_server: str, settings: Dict, limit: int = 50, since_days: int = None, update_progress: bool = False, folders: list = None):
        new_emails = []
        try:
            mail = imaplib.IMAP4_SSL(imap_server, timeout=30)
            mail.login(email_addr, password)
            
            if folders:
                target_folders = folders
            else:
                target_folders = ["inbox"]
            
            skip_folders = {'trash', 'spam', 'junk', 'drafts', 'deleted items', 'deleted messages',
                           'корзина', 'спам', 'черновики', 'удаленные', 'удалённые',
                           '[gmail]/trash', '[gmail]/spam', '[gmail]/drafts', '[gmail]/all mail'}
            
            for folder_name in target_folders:
                folder_lower = folder_name.lower().strip('"')
                if folder_lower in skip_folders:
                    continue
                    
                try:
                    status, _ = mail.select(f'"{folder_name}"', readonly=True)
                    if status != 'OK':
                        continue
                    
                    log.info(f"[EMAIL_SERVICE] Scanning folder: {folder_name}")
                    
                    if since_days:
                        import datetime
                        date = (datetime.date.today() - datetime.timedelta(days=since_days)).strftime("%d-%b-%Y")
                        status, messages = mail.search(None, f'(SINCE "{date}")')
                    else:
                        status, messages = mail.search(None, 'ALL')

                    if status != 'OK':
                        continue
                        
                    msg_ids = messages[0].split()
                    
                    if not since_days and not update_progress:
                        msg_ids = msg_ids[-limit:]
                    
                    total_msgs = len(msg_ids)
                    if update_progress and client_id in self.sync_progress:
                        current_total = self.sync_progress[client_id].get("total", 0)
                        self.sync_progress[client_id]["total"] = current_total + total_msgs

                    for i, num in enumerate(msg_ids):
                        try:
                            if update_progress and client_id in self.sync_progress:
                                self.sync_progress[client_id]["current"] = self.sync_progress[client_id].get("current", 0) + 1
                                
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
                            
                            if not since_days:
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

    async def handle_incoming_email(self, client_id: str, sender: str, subject: str, body: str, settings: Dict, is_historical: bool = False, is_html: bool = False, attachments: List = None, message_id: str = None):
        log.info(f"[EMAIL_SERVICE] Processing email from {sender} for {client_id} (Historical: {is_historical}, HTML: {is_html})")
        
        email_match = re.search(r'([\w\.-]+@[\w\.-]+)', sender)
        sender_email = email_match.group(1) if email_match else sender

        my_email = settings.get("email_address")
        if my_email and sender_email.lower() == my_email.lower():
            log.info(f"[EMAIL_SERVICE] Skipping email from self: {sender_email}")
            return

        session_id = f"email_{hashlib.md5(sender_email.encode()).hexdigest()}"
        
        # Создаем/обновляем сессию
        user_info = {
            "first_name": sender.split('<')[0].strip() if '<' in sender else sender,
            "sender": sender,
            "email": sender_email,
            "sender_email": sender_email,
            "platform": "email"
        }
        async with AsyncSessionLocal() as db:
            await get_or_create_session(session_id, client_id, metadata=user_info)

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
        autoreply_enabled = settings.get("autoreply_enabled", False)
        autoreply_message = (settings.get("autoreply_message") or "").strip()

        log.info(
            f"[EMAIL_SERVICE] Flags for {client_id}: "
            f"assistant={assistant_enabled}, autoreply={autoreply_enabled}, operator={is_operator}"
        )

        if is_operator or not assistant_enabled:
            log.info(f"[EMAIL_SERVICE] Saving message without AI for {session_id}")
            await chat_service.process_ask(ask_data, stream=False, is_admin=True, skip_ai=True)

            if is_operator and autoreply_enabled and autoreply_message:
                log.info(f"[EMAIL_SERVICE] Sending operator autoreply for {session_id}")
                await self.send_reply(client_id, sender_email, f"Re: {subject}", autoreply_message, settings)
                await save_chat_message(session_id, client_id, autoreply_message, is_ai=False, is_admin=True)
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
