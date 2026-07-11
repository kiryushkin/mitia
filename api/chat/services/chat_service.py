from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List

import base64
import json
import re
import asyncio
import os
import time
from datetime import datetime, timedelta
from fastapi import HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from ..core.config import TARIFF_RULES, log
from ..services.ai_service import ask_ai
from .cache_service import cache_service
import hashlib
from ..services.db_service import (
    get_user_by_client_id, get_or_create_session, 
    save_chat_message, get_chat_history, update_user_balance,
    AsyncSessionLocal, User, ChatSession, ChatMessage,
    save_storage_item, detect_file_type
)
from sqlalchemy import update, select
from sqlalchemy.orm.attributes import flag_modified
from ..services.notify_service import send_telegram_notification, send_email
from ..services.clients import get_client_config
from ..services.conversion_scenarios import scenario_engine
from .tts_engine import tts_engine
import httpx

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_PHONE_RE = re.compile(r"(?:\+?\d[\d\-\s()]{8,}\d)")
_URL_RE = re.compile(r"https?://|www\.", re.IGNORECASE)

_NAME_SPECIFIC_RE = re.compile(
    r"(?:меня\s+)?(?:зовут|имя|my\s+name\s+is|i['’]?m\s+)\s*[:\-]?\s*([А-ЯЁ][а-яё]{1,20}|[A-Z][a-z]{1,20})",
    re.IGNORECASE
)
# Убираем слишком простую регулярку _NAME_I_RE, которая ловила "Я Король"


def _contains_contact_info(text: str) -> bool:
    """True, если в тексте есть реальный email или телефонный номер.
    Заменяет старую грубую проверку на подстроки ('@', '89', 'телефон')."""
    if not text:
        return False

    if _EMAIL_RE.search(text):
        return True

    for candidate in _PHONE_RE.findall(text):
        # Считаем телефоном только если набралось 10–15 цифр (рос. и межд. форматы)
        digits = re.sub(r"\D", "", candidate)
        if 10 <= len(digits) <= 15:
            return True

    return False


def classify_message_kind(text: str, metadata: Optional[Dict[str, Any]] = None) -> str:
    """Классификация входящего сообщения: normal | spam | bulk.

    Rule-based MVP без дообучения модели: быстрый и прозрачный фильтр.
    """
    raw = (text or "").strip()
    if not raw:
        return "normal"

    lower = raw.lower()
    metadata = metadata or {}

    spam_score = 0
    bulk_score = 0

    # Явные стоп-слова и промо/мошеннические паттерны
    spam_keywords = [
        "крипт", "btc", "usdt", "ставк", "казино", "взлом", "накрут",
        "быстрый заработ", "легкий доход", "18+", "escort", "секс",
        "дешево", "срочно", "акция", "скидка", "только сегодня", "без вложений"
    ]
    if any(k in lower for k in spam_keywords):
        spam_score += 2

    # Массовая рассылка: много ссылок/контактов/шаблонный призыв
    links_count = len(re.findall(r"https?://|www\.", lower))
    emails_count = len(_EMAIL_RE.findall(raw))
    phones_count = 0
    for candidate in _PHONE_RE.findall(raw):
        digits = re.sub(r"\D", "", candidate)
        if 10 <= len(digits) <= 15:
            phones_count += 1

    if links_count >= 2:
        bulk_score += 2
    if emails_count + phones_count >= 2:
        bulk_score += 1

    # Крики и зашумленность
    letters = [ch for ch in raw if ch.isalpha()]
    if letters:
        upper_ratio = sum(1 for ch in letters if ch.isupper()) / len(letters)
        if upper_ratio > 0.7 and len(raw) > 25:
            spam_score += 1

    if len(raw) > 3000:
        bulk_score += 1
    if re.search(r"(.)\1{7,}", lower):
        spam_score += 1

    bulk_markers = ["подпишись", "переходи", "перешлите", "рассылка", "оптом", "прайс-лист"]
    if any(k in lower for k in bulk_markers):
        bulk_score += 1

    # Сигнал от интеграции/метаданных (если в будущем прокинем)
    if metadata.get("is_bulk") is True:
        bulk_score += 2
    if metadata.get("is_spam") is True:
        spam_score += 2

    if spam_score >= 2:
        return "spam"
    if bulk_score >= 2:
        return "bulk"
    return "normal"


def is_blocked_message_kind(kind: str) -> bool:
    return kind in {"spam", "bulk"}


# Гео-определение по IP (бесплатное, через ip-api.com)
GEO_CACHE = {}

async def detect_geo(ip: str) -> dict:
    """Определяет страну и город по IP. Кэширует результат."""
    if not ip:
        return {}
    if ip in GEO_CACHE:
        return GEO_CACHE[ip]
    
    log.info(f"[GEO] Detecting geo for IP: {ip}")
    
    if ip in ['127.0.0.1', 'localhost', '::1']:
        log.info(f"[GEO] Local IP detected ({ip}), skipping API call")
        return {}
    
    # Бесплатный ip-api.com НЕ работает по HTTPS — только HTTP
    # В Docker HTTP может быть заблокирован, поэтому добавляем HTTPS как fallback
    for api_url in [
        f"http://ip-api.com/json/{ip}?lang=ru&fields=status,country,city,query",
        f"https://ip-api.com/json/{ip}?lang=ru&fields=status,country,city,query",
    ]:
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                resp = await client.get(api_url)
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get('status') == 'success':
                        country = data.get('country', '')
                        city = data.get('city', '')
                        result = {}
                        if city and country:
                            result['contact'] = f"{city}, {country}"
                            result['geo_city'] = city
                            result['geo_country'] = country
                        elif country:
                            result['contact'] = country
                            result['geo_country'] = country
                        if result:
                            GEO_CACHE[ip] = result
                            log.info(f"[GEO] Result for {ip}: {result}")
                            return result
        except Exception as e:
            log.warning(f"[GEO] API failed for {ip}: {e}")
    
    GEO_CACHE[ip] = {}
    log.info(f"[GEO] No geo data for {ip}")
    return {}


@dataclass
class AskData:
    """Унифицированный класс данных для передачи в ChatService.process_ask.
    Заменяет дамми-классы в Avito/VK/MAX/Telegram сервисах."""
    client_id: str
    session_id: str
    message: str
    token: str = ""
    context: Optional[Dict[str, Any]] = None
    voice_output: bool = False
    stream: bool = False
    source: Optional[str] = None
    timestamp: Optional[float] = None
    metadata: Optional[Dict[str, Any]] = None
    attachments: Optional[List[Dict[str, Any]]] = None
    client_ip: Optional[str] = None



def extract_response_text(result: Any) -> str:
    """Универсальное извлечение текста ответа из результата process_ask.
    Поддерживает dict, str и любые другие форматы."""
    if isinstance(result, str):
        return result
    if isinstance(result, dict):
        response_text = result.get("response") or result.get("answer") or result.get("text") or result.get("message", "")
        if isinstance(response_text, dict):
            response_text = response_text.get("text") or response_text.get("message") or str(response_text)
        return response_text
    return str(result)


class ChatService:
    async def _save_to_cache(self, client_id, question, answer, bot_settings):
        """Единый метод для сохранения в кэш Redis."""
        if bot_settings.get('enable_cache') and isinstance(answer, str) and answer.strip():
            if "ошибка" in answer.lower() and len(answer) < 50:
                return
            
            q_hash = hashlib.md5(question.strip().lower().encode()).hexdigest()
            cache_key = f"ai_cache:{client_id}:{q_hash}"
            
            cache_service.set(cache_key, answer)
            log.info(f"AI Cache Saved to Redis for {client_id}: {question[:30]}...")

    async def process_ask(self, data, files=None, stream=False, is_admin=False, skip_ai=False):
        from sqlalchemy.orm.attributes import flag_modified
        client_id = data.client_id
        session_id = data.session_id
        user_msg = data.message
        ai_user_msg = user_msg
        
        session_id = data.token or data.session_id
        if not client_id or client_id == 'default':
            client_id = 'mitia_assistant'
            
        message_kind = classify_message_kind(user_msg, getattr(data, 'metadata', None))

        await save_chat_message(
            session_id,
            'user',
            user_msg,
            attachments=getattr(data, 'attachments', None),
            author_role=message_kind,
            metadata=getattr(data, 'metadata', None),
            source=getattr(data, 'source', None),
            timestamp=getattr(data, 'timestamp', None)
        )

        if is_blocked_message_kind(message_kind) and not is_admin and not skip_ai:
            log.info(f"[FILTER] Blocked AI response for {client_id} ({session_id}), kind={message_kind}")
            if stream:
                async def filtered_gen():
                    yield f"data: {json.dumps({'status': 'filtered', 'filter': message_kind, 'done': True})}\n\n"
                return filtered_gen()
            return {
                "status": "filtered",
                "filter": message_kind,
                "response": ""
            }

        # Учёт email-вложений: в Storage попадают только реально сохранённые на диск файлы
        email_attachments = getattr(data, 'attachments', None)
        if email_attachments and isinstance(email_attachments, list):
            from ..core.config import BASE_DIR

            physically_saved = []
            inline_attachments = []

            for att in email_attachments:
                if not isinstance(att, dict):
                    continue
                content_type = (att.get('content_type') or '').lower()
                disposition = (att.get('disposition') or '').lower()
                is_inline = disposition == 'inline' or bool(att.get('cid'))
                if is_inline:
                    inline_attachments.append(att)
                    continue

                raw_data = att.get('data')
                if not raw_data:
                    continue

                try:
                    payload = base64.b64decode(raw_data)
                except Exception:
                    continue

                if not payload:
                    continue

                original_name = att.get('name') or f"email_{int(time.time())}"
                ext = os.path.splitext(original_name)[1]
                if not ext:
                    mime_to_ext = {
                        'image/jpeg': '.jpg',
                        'image/png': '.png',
                        'image/webp': '.webp',
                        'image/gif': '.gif',
                        'application/pdf': '.pdf',
                        'text/plain': '.txt'
                    }
                    ext = mime_to_ext.get(content_type, '')

                safe_stem = "".join(c for c in os.path.splitext(original_name)[0] if c.isalnum() or c in "._- ").strip()[:80] or "email_attachment"
                local_filename = f"email_{int(time.time())}_{safe_stem}{ext}"
                save_dir = os.path.join(BASE_DIR, "uploads", client_id, "email_attachments", session_id)
                os.makedirs(save_dir, exist_ok=True)
                save_path = os.path.join(save_dir, local_filename)

                try:
                    with open(save_path, "wb") as f:
                        f.write(payload)
                except Exception as save_err:
                    log.error(f"[EMAIL] Failed to save attachment for {client_id}: {save_err}")
                    continue

                local_url = f"/api/chat/uploads/{client_id}/email_attachments/{session_id}/{local_filename}"
                att['local_url'] = local_url
                att['saved'] = True
                att['size'] = len(payload)
                att['kind'] = 'file'
                physically_saved.append(att)

                asyncio.create_task(save_storage_item(
                    client_id=client_id,
                    category="email_attachment",
                    file_size=len(payload),
                    file_path=local_url,
                    file_name=original_name,
                    session_id=session_id,
                    file_type=detect_file_type(original_name)
                ))

            # Inline-объекты и несохранённые вложения считаем текстовыми объектами для UI,
            # но не включаем в used_storage файлов.
            for att in inline_attachments:
                if isinstance(att, dict):
                    att['kind'] = 'text_data'
                    att['saved'] = False

            if physically_saved:
                total_attach_size = sum(int(a.get('size') or 0) for a in physically_saved)
                async with AsyncSessionLocal() as db:
                    user = (await db.execute(select(User).where(User.client_id == client_id))).scalar_one_or_none()
                    if user:
                        tariff = TARIFF_RULES.get(user.tariff_name.lower(), TARIFF_RULES['start'])
                        storage_limit = tariff.get('storage_limit', 1 * 1024 * 1024 * 1024)
                        if user.used_storage + total_attach_size > storage_limit:
                            log.warning(f"[EMAIL] Storage limit exceeded for {client_id}")

        # Гео-определение для веб-виджета — определяем ДО создания сессии
        client_ip = getattr(data, 'client_ip', None)
        base_metadata = dict(getattr(data, 'metadata', None) or {})
        
        # Сохраняем IP в metadata для диагностики
        if client_ip:
            base_metadata['client_ip'] = client_ip
        
        # Если нет телефона/email/контакта — пробуем определить гео
        if client_ip and not base_metadata.get('phone') and not base_metadata.get('email') and not base_metadata.get('contact'):
            try:
                geo = await detect_geo(client_ip)
                if geo:
                    base_metadata.update(geo)
                    log.info(f"[GEO] Detected geo for session {session_id}: {geo}")
                    
                    # Принудительно обновляем сессию в БД, если она уже существует
                    async with AsyncSessionLocal() as db:
                        # Сначала получаем текущие метаданные, чтобы не затереть имя
                        res = await db.execute(select(ChatSession.metadata_json).where(ChatSession.session_id == session_id))
                        current_meta = res.scalar_one_or_none() or {}
                        
                        updated_meta = dict(current_meta)
                        updated_meta.update(base_metadata)
                        
                        await db.execute(
                            update(ChatSession)
                            .where(ChatSession.session_id == session_id)
                            .values(metadata_json=updated_meta)
                        )
                        await db.commit()
            except Exception as e:
                log.error(f"[GEO] Error detecting geo: {e}")

        await get_or_create_session(session_id, client_id, metadata=base_metadata if base_metadata else None)

        # Шлём обновление метаданных через WS, чтобы карточка обновилась
        if base_metadata.get('contact'):
            try:
                from ..routers.ws_router import manager
                await manager.broadcast(session_id, {
                    "type": "metadata_update",
                    "session_id": session_id
                })
            except Exception:
                pass

        if skip_ai:
            log.info(f"[CHAT_SERVICE] AI response skipped for session {session_id} (skip_ai=True)")
            return {"status": "ok", "message": "Message saved, AI skipped"}

        name_match = _NAME_SPECIFIC_RE.search(user_msg)
        if name_match:
            found_name = name_match.group(1).strip()
            
            if found_name:
                found_name = found_name.strip().capitalize()
                
                # Дополнительная проверка: имя должно быть достаточно длинным
                is_valid_name = False
                stop_words = {'Король', 'Бог', 'Бот', 'Админ', 'Клиент', 'Тест'}
                if found_name not in stop_words and len(found_name) >= 2:
                    is_valid_name = True
            if is_valid_name:
                try:
                    async with AsyncSessionLocal() as db:
                        res = await db.execute(select(ChatSession).where(ChatSession.session_id == session_id))
                        sess = res.scalar_one_or_none()
                        if sess:
                            meta = dict(sess.metadata_json or {})
                            meta['first_name'] = found_name
                            meta['name'] = found_name
                            meta['displayName'] = found_name
                            sess.metadata_json = meta
                            
                            # Явное уведомление SQLAlchemy об изменении JSON-поля
                            from sqlalchemy.orm.attributes import flag_modified
                            flag_modified(sess, "metadata_json")
                            
                            await db.commit()
                            log.info(f"[NAME] Saved '{found_name}' to metadata for {session_id}")

                            # Автоматически делаем лидом при получении имени
                            await db.execute(
                                update(ChatSession)
                                .where(ChatSession.session_id == session_id)
                                .values(status='lead')
                            )
                            await db.commit()

                            lead_alert_msg = (
                                f"🔔 *Новый лид!*\n\n"
                                f"Клиент: `{client_id}`\n"
                                f"Имя: {found_name}\n"
                                f"Сообщение: {user_msg}"
                            )
                            try:
                                from .telegram_service import notify_admins
                                await notify_admins(client_id, lead_alert_msg, event_type="lead")
                            except Exception:
                                pass

                            # ПРИНУДИТЕЛЬНОЕ УВЕДОМЛЕНИЕ ФРОНТЕНДА
                            try:
                                from ..routers.ws_router import manager
                                await manager.broadcast(session_id, {
                                    "type": "metadata_update",
                                    "session_id": session_id,
                                    "metadata": meta
                                })
                            except Exception as ws_err:
                                log.error(f"WS broadcast metadata error: {ws_err}")

                            try:
                                from ..routers.ws_router import manager
                                await manager.broadcast(session_id, {
                                    "type": "metadata_update",
                                    "session_id": session_id
                                })
                            except Exception as ws_err:
                                log.error(f"WS broadcast metadata error: {ws_err}")
                except Exception as e:
                    log.error(f"Error saving name to metadata: {e}")

        # Распознавание контактов (Email, Телефон, Мессенджеры)
        found_contacts = False
        
        # Инициализируем списки в метаданных, если их нет
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(ChatSession).where(ChatSession.session_id == session_id))
            sess = res.scalar_one_or_none()
            if sess:
                meta = dict(sess.metadata_json or {})
                for key in ['phones', 'emails', 'messengers']: 
                    if key not in meta: meta[key] = []

                # 0. Авто-добавление профиля текущего канала
                platform = meta.get('platform')
                if platform == 'vk' and meta.get('user_id'):
                    vk_link = f"vk.com/id{meta['user_id']}"
                    if vk_link not in meta['messengers']:
                        meta['messengers'].append(vk_link)
                        found_contacts = True
                elif platform == 'tg' and meta.get('username'):
                    tg_link = f"t.me/{meta['username']}"
                    if tg_link not in meta['messengers']:
                        meta['messengers'].append(tg_link)
                        found_contacts = True

                # 0. Авто-добавление профиля текущего канала
                platform = meta.get('platform')
                if platform == 'vk' and meta.get('vk_user_id'):
                    vk_link = f"vk.com/id{meta['vk_user_id']}"
                    if 'vk_links' not in meta: meta['vk_links'] = []
                    if not any(x.get('value') == vk_link for x in meta['vk_links']):
                        meta['vk_links'].append({'label': 'Профиль', 'value': vk_link})
                        found_contacts = True
                elif platform == 'tg' and meta.get('username'):
                    tg_link = f"t.me/{meta['username']}"
                    if 'tg_links' not in meta: meta['tg_links'] = []
                    if not any(x.get('value') == tg_link for x in meta['tg_links']):
                        meta['tg_links'].append({'label': 'Профиль', 'value': tg_link})
                        found_contacts = True

                # 1. Ищем Email
                emails = _EMAIL_RE.findall(user_msg)
                if 'emails' not in meta: meta['emails'] = []
                for em in emails:
                    if not any(x.get('value') == em for x in meta['emails']):
                        meta['emails'].append({'label': 'Email', 'value': em})
                        found_contacts = True

                # 2. Ищем Телефоны
                phones = _PHONE_RE.findall(user_msg)
                if 'phones' not in meta: meta['phones'] = []
                for ph in phones:
                    clean_ph = re.sub(r"\D", "", ph)
                    if 10 <= len(clean_ph) <= 15 and not any(x.get('value') == ph for x in meta['phones']):
                        meta['phones'].append({'label': 'Телефон', 'value': ph})
                        found_contacts = True

                # 3. Ищем Мессенджеры и ссылки
                msgr_patterns = [
                    (r't\.me/[A-Za-z0-9_]+', 'tg_links', 'Telegram'), 
                    (r'vk\.com/[A-Za-z0-9_\.]+', 'vk_links', 'VK'), 
                    (r'wa\.me/\d+', 'wa_links', 'WhatsApp'),
                    (r'https?://[A-Za-z0-9\.\-]+\.[A-Za-z]{2,}[^\s]*', 'other_links', 'Сайт')
                ]
                for pat, key, label in msgr_patterns:
                    if key not in meta: meta[key] = []
                    matches = re.findall(pat, user_msg, re.I)
                    for m in matches:
                        if not any(x.get('value') == m for x in meta[key]):
                            meta[key].append({'label': label, 'value': m})
                            found_contacts = True

                if found_contacts:
                    sess.metadata_json = meta
                    flag_modified(sess, "metadata_json")
                    await db.commit()
                    
                    # Уведомляем фронтенд
                    try:
                        from ..routers.ws_router import manager
                        await manager.broadcast(session_id, {
                            "type": "metadata_update",
                            "session_id": session_id,
                            "metadata": meta
                        })
                    except: pass

        if found_contacts:
            alert_msg = f"🔔 *Новые контакты!*\n\nКлиент: `{client_id}`\nСообщение: {user_msg}"
            try:
                from .telegram_service import notify_admins
                await notify_admins(client_id, alert_msg, event_type="contact")
            except: pass
            
            async with AsyncSessionLocal() as db:
                await db.execute(update(ChatSession).where(ChatSession.session_id == session_id).values(status='lead'))
                await db.commit()

        voice_output = getattr(data, 'voice_output', False)

        if not voice_output:
            client_config = await get_client_config(client_id)
            voice_output = client_config.raw.get('bot_settings', {}).get('enable_tts', False)
            log.info(f"TTS status from config for {client_id}: {voice_output}")

        if not client_id or client_id == 'default':
            client_id = 'mitia_assistant'
        
        session_id = data.token or data.session_id

        attachments = []
        unsupported_files = []
        supported_types = [
            'image/jpeg', 'image/png', 'image/jpg', 
            'application/pdf', 
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain', 'text/csv',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ]

        if files:
            import base64
            import io
            import os
            import time
            from ..core.config import BASE_DIR
            try:
                from PIL import Image
            except ImportError:
                Image = None

            # Phase 1: Read all files, accumulate total size
            file_data = []
            total_upload_size = 0

            for file in files:
                content = await file.read()
                content_type = file.content_type
                filename = file.filename

                if Image and content_type in ['image/webp', 'image/heic', 'image/heif']:
                    try:
                        img = Image.open(io.BytesIO(content))
                        if img.mode in ("RGBA", "P"):
                            img = img.convert("RGB")
                        output = io.BytesIO()
                        img.save(output, format="JPEG", quality=85)
                        content = output.getvalue()
                        content_type = 'image/jpeg'
                        filename = filename.rsplit('.', 1)[0] + '.jpg'
                        log.info(f"Converted {file.content_type} to image/jpeg for GigaChat")
                    except Exception as e:
                        log.error(f"Image conversion error: {e}")

                if content_type in supported_types:
                    total_upload_size += len(content)
                    file_data.append((filename, content_type, content, True))
                else:
                    file_data.append((filename, content_type, content, False))
                    unsupported_files.append(f"{filename} ({content_type})")

            # Phase 2: Check storage limit (used_storage обновляется в save_storage_item)
            if total_upload_size > 0:
                async with AsyncSessionLocal() as db:
                    user = (await db.execute(select(User).where(User.client_id == client_id))).scalar_one_or_none()
                    if user:
                        tariff = TARIFF_RULES.get(user.tariff_name.lower(), TARIFF_RULES['start'])
                        storage_limit = tariff.get('storage_limit', 1 * 1024 * 1024 * 1024)
                        if user.used_storage + total_upload_size > storage_limit:
                            raise HTTPException(status_code=403, detail="Storage limit exceeded")

            # Phase 3: Save files to disk and build attachments
            for filename, content_type, content, is_supported in file_data:
                if not is_supported:
                    continue
                
                user_chat_dir = os.path.join(BASE_DIR, "uploads", client_id, "chat_files", session_id)
                os.makedirs(user_chat_dir, exist_ok=True)
                
                ext = os.path.splitext(filename)[1] or ('.jpg' if content_type == 'image/jpeg' else '')
                local_filename = f"chat_{int(time.time())}_{filename}"
                save_path = os.path.join(user_chat_dir, local_filename)
                
                with open(save_path, "wb") as f:
                    f.write(content)
                
                local_url = f"/api/chat/uploads/{client_id}/chat_files/{session_id}/{local_filename}"
                
                encoded = base64.b64encode(content).decode('utf-8')
                attachments.append({
                    "name": filename,
                    "content_type": content_type,
                    "data": encoded,
                    "local_url": local_url
                })

                # Запись в StorageItem для учёта
                asyncio.create_task(save_storage_item(
                    client_id=client_id,
                    category="chat_file",
                    file_size=len(content),
                    file_path=local_url,
                    file_name=filename,
                    session_id=session_id
                ))

            # Обновляем сообщение пользователя — добавляем вложения,
            # чтобы они не пропадали при перезагрузке истории
            if attachments:
                async with AsyncSessionLocal() as db:
                    result = await db.execute(
                        select(ChatMessage)
                        .where(ChatMessage.session_id == session_id, ChatMessage.role == 'user')
                        .order_by(ChatMessage.id.desc())
                        .limit(1)
                    )
                    msg = result.scalar_one_or_none()
                    if msg:
                        msg.attachments = attachments
                        await db.commit()
                        log.info(f"[CHAT] Updated user message with {len(attachments)} attachments")

        if unsupported_files:
            files_str = ", ".join(unsupported_files)
            ai_user_msg += f"\n\n[СИСТЕМНОЕ УВЕДОМЛЕНИЕ: Пользователь прикрепил файлы, которые ты НЕ МОЖЕШЬ прочитать: {files_str}. Обязательно сообщи об этом пользователю и попроси прислать данные в формате текста, PDF, DOCX или обычного фото (JPG/PNG).]"

        user_row = await get_user_by_client_id(client_id)
        if not user_row:
            error_msg = "Пользователь не найден"
            if stream:
                async def err_gen(): yield f"data: {json.dumps({'error': error_msg})}\n\n"
                return err_gen()
            return {"response": error_msg, "status": "error"}

        if user_row.balance <= -1 and client_id != 'mitia_assistant' and not is_admin:
            log.warning(f"AI disabled for {client_id} due to negative balance ({user_row.balance}).")
            async with AsyncSessionLocal() as db:
                await db.execute(
                    update(ChatSession)
                    .where(ChatSession.session_id == session_id)
                    .values(is_operator_mode=True, status='waiting')
                )
                await db.commit()

            op_msg_default = "Я передал ваш вопрос оператору. Пожалуйста, оставьте контакты, мы ответим вам в ближайшее время."
            op_msg = op_msg_default
            try:
                client_config = await get_client_config(client_id)
                bot_settings = client_config.raw.get('bot_settings', {})
                ai_unavailable_message = (bot_settings.get('ai_unavailable_message') or '').strip()
                if ai_unavailable_message:
                    op_msg = ai_unavailable_message
            except Exception:
                pass

            if getattr(data, 'source', None) == 'widget':
                client_config = await get_client_config(client_id)
                widget_settings = client_config.raw.get('integrations', {}).get('widget', {})
                autoreply_enabled = bool(widget_settings.get('autoreply_enabled', False))
                autoreply_message = (widget_settings.get('autoreply_message') or '').strip()
                if autoreply_enabled and autoreply_message:
                    op_msg = autoreply_message
            await save_chat_message(session_id, 'assistant', op_msg)

            if stream:
                async def bal_gen():
                    yield f"data: {json.dumps({'status': 'waiting_for_operator', 'message': op_msg})}\n\n"
                return bal_gen()
            return {"status": "waiting_for_operator", "response": op_msg}

        t_name = user_row.tariff_name or 'start'
        rules = TARIFF_RULES.get(t_name, TARIFF_RULES['start'])
        
        reset_days = rules.get('reset_period_days', 0)
        if reset_days > 0:
            now = datetime.now()
            if user_row.messages_reset_at is None:
                user_row.messages_reset_at = now + timedelta(days=reset_days)
                async with AsyncSessionLocal() as db:
                    await db.execute(
                        update(User).where(User.client_id == client_id).values(
                            messages_reset_at=user_row.messages_reset_at
                        )
                    )
                    await db.commit()
            elif user_row.messages_reset_at < now:
                new_reset_at = now + timedelta(days=reset_days)
                async with AsyncSessionLocal() as db:
                    await db.execute(
                        update(User).where(User.client_id == client_id).values(
                            messages_consumed=0,
                            messages_reset_at=new_reset_at
                        )
                    )
                    await db.commit()
                user_row.messages_consumed = 0
                user_row.messages_reset_at = new_reset_at
                log.info(f"Messages counter reset for {client_id}, next reset: {new_reset_at}")
        
        is_expired = False
        if t_name != 'start' and user_row.tariff_expires_at:
            if user_row.tariff_expires_at < datetime.now():
                is_expired = True

        is_limit_exceeded = False
        cost = 0
        if user_row.messages_consumed >= rules['base_limit']:
            fresh_user = await get_user_by_client_id(client_id)
            if fresh_user:
                user_row = fresh_user
            if user_row.balance < rules.get('base_cost', 15):
                is_limit_exceeded = True
            else:
                cost = rules.get('base_cost', 15)
        
        if is_expired:
            is_limit_exceeded = True

        if is_limit_exceeded and not is_admin:
            if t_name != 'start':
                log.warning(f"Downgrading {client_id} from {t_name} to start: limit exceeded, balance insufficient")
                async with AsyncSessionLocal() as db:
                    await db.execute(
                        update(User).where(User.client_id == client_id).values(
                            tariff_name='start',
                            tariff_expires_at=None,
                            messages_consumed=0,
                            messages_reset_at=datetime.now() + timedelta(days=TARIFF_RULES['start']['reset_period_days'])
                        )
                    )
                    await db.commit()
                
                await send_telegram_notification(
                    f"⚠️ *Тариф '{rules.get('name', t_name)}' отключён!*\n\n"
                    f"Клиент: `{client_id}`\nПричина: лимит сообщений исчерпан, баланс недостаточен для оплаты.\n"
                    f"Тариф изменён на «Старт». Для возврата на платный тариф пополните баланс и смените тариф в панели управления."
                )
                if user_row.email:
                    await send_email(
                        user_row.email,
                        f"⚠️ Тариф '{rules.get('name', t_name)}' отключён — Mitya AI",
                        f"Ваш тарифный план '{rules.get('name', t_name)}' отключён, так как лимит сообщений исчерпан, а баланс недостаточен для оплаты.\n\n"
                        f"Тариф изменён на «Старт» (30 бесплатных сообщений в месяц).\n\n"
                        f"Для возврата на платный тариф пополните баланс и смените тариф в панели управления."
                    )
                
                t_name = 'start'
                rules = TARIFF_RULES['start']
                cost = 0
                is_limit_exceeded = False
            else:
                log.warning(f"AI disabled for {client_id} due to limits/expiration. Switching to operator mode.")
                async with AsyncSessionLocal() as db:
                    await db.execute(
                        update(ChatSession)
                        .where(ChatSession.session_id == session_id)
                        .values(is_operator_mode=True, status='waiting')
                    )
                    await db.commit()
                
                alert_text = (
                    f"⚠️ Лимит ИИ исчерпан!\n\n"
                    f"Ваш ассистент на сайте временно переведен в режим ручного управления, "
                    f"так как лимит сообщений по тарифу '{rules.get('name', t_name)}' исчерпан или баланс недостаточен.\n\n"
                    f"Пожалуйста, ответьте клиенту в панели управления или пополните баланс для активации ИИ."
                )
                
                await send_telegram_notification(f"⚠️ *Лимит ИИ исчерпан!*\n\nКлиент: `{client_id}`\nЧат переведен на ручное управление.")
                
                if user_row.email:
                    await send_email(user_row.email, "⚠️ Лимит ИИ исчерпан — Mitya AI", alert_text)
                
                op_msg_default = "Я передал ваш вопрос оператору, он ответит вам в ближайшее время."
                op_msg = op_msg_default
                try:
                    client_config = await get_client_config(client_id)
                    bot_settings = client_config.raw.get('bot_settings', {})
                    ai_unavailable_message = (bot_settings.get('ai_unavailable_message') or '').strip()
                    if ai_unavailable_message:
                        op_msg = ai_unavailable_message
                except Exception:
                    pass

                if getattr(data, 'source', None) == 'widget':
                    client_config = await get_client_config(client_id)
                    widget_settings = client_config.raw.get('integrations', {}).get('widget', {})
                    autoreply_enabled = bool(widget_settings.get('autoreply_enabled', False))
                    autoreply_message = (widget_settings.get('autoreply_message') or '').strip()
                    if autoreply_enabled and autoreply_message:
                        op_msg = autoreply_message
                await save_chat_message(session_id, 'assistant', op_msg)

                if stream:
                    async def limit_gen():
                        yield f"data: {json.dumps({'status': 'waiting_for_operator', 'message': op_msg})}\n\n"
                    return limit_gen()
                return {"status": "waiting_for_operator", "response": op_msg}

        if user_msg.startswith('[scenario]:') or user_msg == '[PRESENTATION_START]':
            res = await scenario_engine.process(client_id, session_id, user_msg)
            if stream:
                async def scenario_gen(): yield f"data: {json.dumps(res)}\n\n"
                return scenario_gen()
            return res

        async with AsyncSessionLocal() as db:
            await db.execute(
                update(ChatSession)
                .where(ChatSession.session_id == session_id)
                .values(is_read=False)
            )
            await db.commit()

        async with AsyncSessionLocal() as db:
            res_sess = await db.execute(select(ChatSession.is_operator_mode, ChatSession.metadata_json).where(ChatSession.session_id == session_id))
            sess_data = res_sess.fetchone()
            is_operator = sess_data[0] if sess_data else False
            sess_metadata = sess_data[1] if sess_data else {}
            widget_settings = {}

            # Проверка глобального отключения ассистента для виджета
            if getattr(data, 'source', None) == 'widget':
                client_config = await get_client_config(client_id)
                widget_settings = client_config.raw.get('integrations', {}).get('widget', {})
                if not widget_settings.get('assistant_enabled', True):
                    log.info(f"Global widget assistant disabled for {client_id}")
                    is_operator = True

            # Проверка индивидуального отключения в метаданных сессии
            if sess_metadata.get('assistant_disabled'):
                log.info(f"Assistant disabled for specific session {session_id}")
                is_operator = True

            if is_operator:
                log.info(f"Operator mode active for session {session_id}. AI response skipped.")

                op_msg = "Оператор скоро ответит вам. Пожалуйста, подождите."

                if getattr(data, 'source', None) == 'widget':
                    autoreply_enabled = bool(widget_settings.get('autoreply_enabled', False))
                    autoreply_message = (widget_settings.get('autoreply_message') or '').strip()
                    if autoreply_enabled and autoreply_message:
                        op_msg = autoreply_message

                await save_chat_message(session_id, 'assistant', op_msg)

                if stream:
                    async def op_gen():
                        yield f"data: {json.dumps({'content': op_msg})}\n\n"
                        yield f"data: {json.dumps({'status': 'waiting_for_operator', 'done': True})}\n\n"
                    return op_gen()
                return {"status": "waiting_for_operator", "response": op_msg}

        audio_url = None
        config_was_updated = False
        
        client_config = await get_client_config(client_id)
        bot_settings = client_config.raw.get('bot_settings', {})

        if bot_settings.get('enable_cache'):
            q_hash = hashlib.md5(user_msg.strip().lower().encode()).hexdigest()
            cache_key = f"ai_cache:{client_id}:{q_hash}"
            cached_answer = cache_service.get(cache_key)
            
            if cached_answer:
                log.info(f"AI Cache Hit (Redis) for {client_id}: {user_msg[:30]}...")
                return await self._send_direct_response(session_id, user_msg, cached_answer, stream, client_id=client_id, cost=0, skip_counter=True)

        effective_stream = stream
        if bot_settings.get('enable_web_search'):
            effective_stream = False

        ai_response = await self._get_ai_response(
            client_id, session_id, user_msg, data.context, rules, 
            stream=effective_stream, total_msg_cost=cost, user_row=user_row, 
            voice_output=voice_output, is_admin=is_admin, 
            attachments=attachments, ai_custom_msg=ai_user_msg
        )

        if effective_stream:
            async def wrapped_stream():
                full_text_for_tts = ""
                if isinstance(ai_response, str):
                    yield f"data: {json.dumps({'content': ai_response})}\n\n"
                    return
                
                try:
                    async for chunk in ai_response:
                        try:
                            chunk_data = json.loads(chunk.replace('data: ', '').strip())
                            if 'content' in chunk_data:
                                full_text_for_tts += chunk_data['content']
                        except: pass
                        yield chunk
                    
                    await self._save_to_cache(client_id, user_msg, full_text_for_tts, bot_settings)

                    if voice_output and full_text_for_tts:
                        try:
                            from .tts_engine import tts_engine
                            
                            voice = bot_settings.get('tts_voice', 'Nec_24000')
                            clean_text = full_text_for_tts.replace('**', '').replace('`', '').replace('•', '')
                            res = await tts_engine.generate(clean_text, voice=voice)
                            if res:
                                yield f"data: {json.dumps({'audio_url': res['url'], 'done': True})}\n\n"
                        except Exception as e:
                            log.error(f"TTS Stream error: {e}")
                except Exception as e:
                    log.error(f"Stream error: {e}")
                    yield f"data: {json.dumps({'content': f'Ошибка потока: {str(e)}'})}\n\n"
            return wrapped_stream()

        if isinstance(ai_response, dict) and ai_response.get('status') == 'function_call':
            func_data = ai_response['function']
            func_res_obj = await self.execute_function_call(client_id, func_data, is_admin=is_admin, context=data.context, session_id=session_id)
            
            history_data = await get_chat_history(session_id, limit=rules.get('context_limit', 15))
            messages_for_ai = [{"role": m['role'], "content": m['content']} for m in history_data]
            if messages_for_ai and messages_for_ai[-1]['role'] == 'user':
                messages_for_ai.pop()

            messages_for_ai.append({"role": "assistant", "function_call": func_data})
            messages_for_ai.append({"role": "function", "name": func_data['name'], "content": json.dumps(func_res_obj, ensure_ascii=False)})

            ai_response = await self._get_ai_response(
                client_id, session_id, user_msg, data.context, rules, 
                stream=effective_stream, total_msg_cost=cost, 
                user_row=user_row, voice_output=voice_output,
                is_admin=is_admin, custom_messages=messages_for_ai,
                attachments=attachments, ai_custom_msg=ai_user_msg
            )
            
            if effective_stream and not isinstance(ai_response, (dict, str)):
                return ai_response
            
            log.info(f"AI response after function call: {ai_response}")

            if isinstance(ai_response, dict) and ai_response.get('status') == 'function_call':
                func_data = ai_response['function']
                func_res_obj = await self.execute_function_call(client_id, func_data, is_admin=is_admin, context=data.context, session_id=session_id)
                
                messages_for_ai.append({"role": "assistant", "function_call": func_data})
                messages_for_ai.append({"role": "function", "name": func_data['name'], "content": json.dumps(func_res_obj, ensure_ascii=False)})

                ai_response = await self._get_ai_response(
                    client_id, session_id, user_msg, data.context, rules, 
                    stream=effective_stream, total_msg_cost=cost, 
                    user_row=user_row, voice_output=voice_output,
                    is_admin=is_admin, custom_messages=messages_for_ai,
                    attachments=attachments, ai_custom_msg=ai_user_msg
                )
                if effective_stream and not isinstance(ai_response, (dict, str)):
                    return ai_response

                ai_response = re.sub(r'\w+_search args: \{.*?\}', '', ai_response, flags=re.DOTALL)
                ai_response = re.sub(r'\[\w+_search.*?\]', '', ai_response, flags=re.IGNORECASE)
                ai_response = re.sub(r'\[источник \d+\]', '', ai_response, flags=re.IGNORECASE)
                ai_response = ai_response.replace('<|superquote|>', '"').strip()

            final_text = ai_response.get('response') if isinstance(ai_response, dict) else ai_response
            
            await save_chat_message(session_id, "assistant", final_text)
            await update_user_balance(client_id, cost, consumed_increment=1)
            
            if stream:
                async def fake_stream():
                    yield "data: " + json.dumps({"status": "start"}) + "\n\n"
                    await asyncio.sleep(0.5)
                    words = final_text.split(' ')
                    for i, word in enumerate(words):
                        chunk = word + (' ' if i < len(words) - 1 else '')
                        yield "data: " + json.dumps({"status": "stream", "content": chunk}) + "\n\n"
                        await asyncio.sleep(0.05)
                    yield "data: " + json.dumps({"status": "end"}) + "\n\n"
                return fake_stream()
            
            return ai_response

        final_text = ai_response.get('response') if isinstance(ai_response, dict) else ai_response
        
        if isinstance(final_text, str):
            final_text = re.sub(r'\[sources=\[?.*?\]?\]', '', final_text)
            final_text = final_text.replace('[]', '').strip()
        
        log.info(f"AI_FINAL_RESPONSE (len={len(str(final_text))}): {final_text}")

        if isinstance(final_text, str) and len(final_text) > 0:
            await save_chat_message(session_id, 'assistant', final_text, author_role='assistant')
            await update_user_balance(client_id, cost, consumed_increment=1)
            
            if voice_output:
                try:
                    from .tts_engine import tts_engine
                    voice = client_config.raw.get('bot_settings', {}).get('tts_voice', 'Nec_24000')
                    clean_text = final_text.replace('**', '').replace('`', '').replace('•', '')
                    
                    res_data = await tts_engine.generate(clean_text, voice=voice)
                    if res_data and "url" in res_data:
                        audio_url = res_data["url"]
                        log.info(f"Local TTS Generated: {audio_url}")
                except Exception as e:
                    log.error(f"Local TTS Generation error: {e}")

        if stream and not effective_stream:
            async def fake_stream():
                await asyncio.sleep(0.5)
                
                text_to_send = final_text
                if isinstance(text_to_send, str):
                    text_to_send = re.sub(r'\w+_search args: \{.*?\}', '', text_to_send, flags=re.DOTALL)
                    text_to_send = re.sub(r'\[\w+_search.*?\]', '', text_to_send, flags=re.IGNORECASE)
                    text_to_send = re.sub(r'\[источник \d+\]', '', text_to_send, flags=re.IGNORECASE)
                    text_to_send = re.sub(r'\[get_datetime\]', '', text_to_send)
                    text_to_send = re.sub(r'<\|superquote\|>', '"', text_to_send)
                    text_to_send = text_to_send.strip()

                if text_to_send:
                    words = text_to_send.split(' ')
                    current_text = ""
                    for i, word in enumerate(words):
                        current_text += (word + ' ')
                        yield f"data: {json.dumps({'content': word + ' '})}\n\n"
                        await asyncio.sleep(0.02)
                    
                    if audio_url:
                        yield f"data: {json.dumps({'audio_url': audio_url})}\n\n"
                    
                    await self._save_to_cache(client_id, user_msg, text_to_send, bot_settings)

                    yield f"data: {json.dumps({'done': True})}\n\n"
                else:
                    yield f"data: {json.dumps({'error': 'Пустой ответ от ИИ'})}\n\n"
            return fake_stream()

        res_payload = {"response": final_text, "status": "ok", "session_id": session_id, "audio_url": audio_url}
        if config_was_updated: res_payload["config_updated"] = True
        return res_payload

    async def execute_function_call(self, client_id, func_data, is_admin=False, context=None, session_id=None):
        """Выполняет команду от ИИ."""
        name = func_data['name']
        
        args_raw = func_data.get('arguments', {})
        if isinstance(args_raw, str):
            try:
                args = json.loads(args_raw)
            except:
                args = {}
        else:
            args = args_raw
            
        log.info(f"Executing AI function: {name} (is_admin={is_admin}) with args: {args}")

        try:
            from ..services.clients import get_client_config, save_client_config
            config = await get_client_config(client_id)
            
            if name == "get_datetime":
                from datetime import datetime
                now = datetime.now().strftime("%d.%m.%Y %H:%M:%S")
                return {
                    "status": "success",
                    "content": now,
                    "message": f"ИНСТРУКЦИЯ: Сейчас {now}. Используй это время в ответе, но НЕ упоминай название функции get_datetime."
                }

            if name == "web_search":
                query = args.get('query', '') or args.get('arguments', {}).get('query', '')
                
                if not str(query).strip():
                    target_id = session_id or client_id
                    history = await get_chat_history(target_id, limit=2)
                    if history:
                        for h in history:
                            if h['role'] == 'user':
                                query = h['content']
                                break

                query = str(query).lower().strip()
                log.info(f"REAL SEARCH START: '{query}'")
                
                search_result = ""
                
                from ..core.config import YANDEX_SEARCH_API_KEY, YANDEX_SEARCH_FOLDER_ID, YANDEX_API_KEY, YANDEX_FOLDER_ID
                
                search_key = YANDEX_SEARCH_API_KEY or YANDEX_API_KEY
                search_folder = YANDEX_SEARCH_FOLDER_ID or YANDEX_FOLDER_ID
                
                if search_key and search_folder:
                    from .search_service import perform_search
                    search_result = await perform_search(query, search_key, search_folder)
                else:
                    search_result = "ОШИБКА: Ключи Yandex Cloud не настроены."
                    log.error("Search attempt failed: Yandex keys missing")

                if not search_result or "Error 403" in str(search_result):
                    search_result = "ТЕХНИЧЕСКАЯ ОШИБКА: Поиск в интернете временно недоступен. Игнорируй это сообщение при ответе на следующие вопросы пользователя. Сейчас отвечай СТРОГО на основе БАЗЫ ЗНАНИЙ (Приоритеты №1-3)."

                return {
                    "status": "success",
                    "content": search_result,
                    "message": search_result
                }

            admin_only_functions = [
                "update_business_info", 
                "update_widget_appearance", 
                "manage_knowledge_object", 
                "update_working_hours",
                "confirm_save_changes",
                "create_payment_invoice"
            ]

            if name in admin_only_functions:
                return {
                    "status": "error",
                    "message": "Управление через ИИ отключено. Пожалуйста, используйте панель управления."
                }

        except Exception as e:
            log.error(f"Error executing AI function {name}: {e}")
            return {"status": "error", "message": str(e)}

        return {"status": "error", "message": "Unknown function"}

    async def _get_ai_response(self, client_id, session_id, user_msg, context, rules, stream=False, total_msg_cost=0, user_row=None, voice_output=False, custom_messages=None, is_admin=False, attachments=None, ai_custom_msg=None):
        """Получение ответа от ИИ через ai_service."""
        client_config = await get_client_config(client_id)
        
        inline_buttons_enabled = client_config.raw.get('theme', {}).get('inline_buttons_enabled', True)
        
        if custom_messages:
            messages_for_ai = custom_messages
        else:
            limit = rules.get('context_limit', 10)
            history_data = await get_chat_history(session_id, limit=limit)
            
            messages_for_ai = []
            for m in history_data:
                if m['role'] in ['user', 'assistant'] and 'function_call' not in str(m.get('content', '')):
                    messages_for_ai.append({"role": m['role'], "content": m['content']})
            
            msg_to_send = ai_custom_msg if ai_custom_msg else user_msg
            messages_for_ai.append({"role": "user", "content": msg_to_send})

        if stream:
            return await ask_ai(
                messages_for_ai,
                client_config,
                stream=True,
                client_id=client_id,
                session_id=session_id,
                total_msg_cost=total_msg_cost,
                user_row=user_row,
                rules=rules,
                voice_output=voice_output,
                is_admin=is_admin,
                attachments=attachments,
                inline_buttons_enabled=inline_buttons_enabled,
                context=context
            )

        return await ask_ai(
            messages_for_ai,
            client_config,
            stream=False,
            client_id=client_id,
            session_id=session_id,
            total_msg_cost=total_msg_cost,
            user_row=user_row,
            rules=rules,
            voice_output=voice_output,
            is_admin=is_admin,
            attachments=attachments,
            inline_buttons_enabled=inline_buttons_enabled,
            context=context
        )

    async def _send_direct_response(self, session_id, user_msg, response_text, stream, client_id=None, voice_output=False, cost=0, skip_counter=False):
        await save_chat_message(session_id, 'user', user_msg)
        
        await save_chat_message(session_id, 'assistant', response_text)
        if client_id:
            await update_user_balance(client_id, cost, consumed_increment=0 if skip_counter else 1)
        
        client_config = await get_client_config(client_id) if client_id else None
        bot_settings = client_config.raw.get('bot_settings', {}) if client_config else {}

        if client_id:
            await self._save_to_cache(client_id, user_msg, response_text, bot_settings)

        audio_url = None
        if voice_output and client_id:
            try:
                voice = bot_settings.get('tts_voice', 'Nec_24000')
                clean_text = response_text.replace('**', '').replace('`', '').replace('•', '')
                res = await tts_engine.generate(clean_text, voice=voice)
                if res:
                    audio_url = res.get('url')
            except Exception as e:
                log.error(f"TTS Error in direct response: {e}")

        if stream:
            if bot_settings.get('dna_typewriter', True):
                async def direct_fake_stream():
                    yield f"data: {json.dumps({'status': 'start'})}\n\n"
                    words = response_text.split(' ')
                    for i, word in enumerate(words):
                        chunk = word + (' ' if i < len(words) - 1 else '')
                        yield f"data: {json.dumps({'content': chunk})}\n\n"
                        await asyncio.sleep(0.02) # Скорость печати
                    if audio_url:
                        yield f"data: {json.dumps({'audio_url': audio_url})}\n\n"
                    yield f"data: {json.dumps({'done': True})}\n\n"
                return direct_fake_stream()
            
            async def direct_gen(): yield f"data: {json.dumps({'response': response_text, 'audio_url': audio_url, 'done': True})}\n\n"
            return direct_gen()
            
        return {"response": response_text, "status": "ok", "audio_url": audio_url}

chat_service = ChatService()
