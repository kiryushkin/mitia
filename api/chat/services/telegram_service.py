"""
Telegram Bot Integration Service.
Обрабатывает входящие вебхуки, маршрутизирует сообщения в chat_service,
отправляет ответы ИИ обратно в Telegram.
"""
import hashlib
from typing import Optional, Literal

import httpx

from ..core.config import log, TELEGRAM_CONFIG
from ..services.clients import list_clients, get_client_config
from ..services.integrations_service import get_integration_settings
from ..services.db_service import (
    AsyncSessionLocal, get_or_create_session, save_chat_message, is_operator_mode,
    download_and_save_file
)
from ..services.chat_service import chat_service, extract_response_text, AskData
from .cache_service import cache_service

TG_API = TELEGRAM_CONFIG.get("api_url", "https://api.telegram.org")
TG_PROXY = TELEGRAM_CONFIG.get("proxy")

if TG_PROXY:
    if '@' in TG_PROXY and '://' in TG_PROXY:
        scheme, rest = TG_PROXY.split('://', 1)
        if '@' in rest:
            _, host_part = rest.split('@', 1)
            log.info(f"[TG_SERVICE] Using proxy: {scheme}://***@{host_part}")
        else:
            log.info(f"[TG_SERVICE] Using proxy: {scheme}://{rest}")
    else:
        log.info("[TG_SERVICE] Using proxy")
if TG_API != "https://api.telegram.org":
    log.info(f"[TG_SERVICE] Using custom API URL: {TG_API}")


def get_tg_client(**kwargs) -> httpx.AsyncClient:
    """Создает httpx.AsyncClient с поддержкой прокси."""
    client_kwargs = {"timeout": 10}
    client_kwargs.update(kwargs)
    
    if TG_PROXY:
        client_kwargs["proxy"] = TG_PROXY
        
    return httpx.AsyncClient(**client_kwargs)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()[:16]


async def register_bot_token(client_id: str, bot_token: str):
    if bot_token:
        cache_service.set(f"tg_bot_token:{_token_hash(bot_token)}", client_id)


async def find_client_by_token(bot_token: str) -> Optional[str]:
    client_id = cache_service.get(f"tg_bot_token:{_token_hash(bot_token)}")
    if client_id:
        return client_id
    try:
        clients = await list_clients()
        for c in clients:
            cid = c
            if not cid:
                continue
            settings = await get_integration_settings(cid, "telegram")
            if settings.get("bot_token") == bot_token and settings.get("enabled"):
                cache_service.set(f"tg_bot_token:{_token_hash(bot_token)}", cid)
                return cid
    except Exception as e:
        log.error(f"Fallback client search failed: {e}")
    return None


async def get_or_create_tg_session(client_id: str, tg_chat_id: int, from_user: dict = None) -> str:
    cache_key = f"tg_session:{client_id}:{tg_chat_id}"
    session_id = cache_service.get(cache_key)
    if session_id:
        return session_id
    session_id = f"tg-{client_id}-{tg_chat_id}"
    
    # Собираем информацию о пользователе
    user_info = {}
    if from_user:
        user_info = {
            "first_name": from_user.get("first_name"),
            "last_name": from_user.get("last_name"),
            "username": from_user.get("username"),
            "platform": "telegram"
        }
        # Если есть телефон в метаданных (может быть передан при первом контакте)
        if from_user.get("phone_number"):
            user_info["phone"] = from_user.get("phone_number")

    async with AsyncSessionLocal() as db:
        await get_or_create_session(session_id, client_id, metadata=user_info)
    cache_service.set(cache_key, session_id)
    return session_id


async def send_telegram_message(bot_token: str, chat_id: int, text: str) -> bool:
    url = f"{TG_API}/bot{bot_token}/sendMessage"
    
    # Конвертируем Markdown жирный в HTML жирный для Telegram
    formatted_text = text.replace("**", "<b>")
    # Закрываем теги (простая логика: каждая вторая <b> становится </b>)
    parts = formatted_text.split("<b>")
    new_text = parts[0]
    for i in range(1, len(parts)):
        tag = "<b>" if i % 2 != 0 else "</b>"
        new_text += tag + parts[i]
    
    # Если остался незакрытый тег
    if new_text.count("<b>") > new_text.count("</b>"):
        new_text += "</b>"

    try:
        async with get_tg_client() as client:
            resp = await client.post(url, json={
                "chat_id": chat_id,
                "text": new_text,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            })
            if resp.status_code != 200:
                log.error(f"TG sendMessage fail: {resp.status_code} {resp.text}")
                return False
            return True
    except Exception as e:
        log.error(f"TG sendMessage error: {e}")
        return False


async def send_telegram_typing(bot_token: str, chat_id: int) -> bool:
    url = f"{TG_API}/bot{bot_token}/sendChatAction"
    try:
        async with get_tg_client(timeout=5) as client:
            await client.post(url, json={"chat_id": chat_id, "action": "typing"})
            return True
    except Exception:
        return False


async def get_telegram_file_url(bot_token: str, file_id: str) -> Optional[str]:
    """Получает прямую ссылку на файл в Telegram по его file_id."""
    try:
        url = f"{TG_API}/bot{bot_token}/getFile"
        async with get_tg_client() as client:
            resp = await client.get(url, params={"file_id": file_id})
            if resp.status_code == 200:
                data = resp.json()
                if data.get("ok"):
                    file_path = data["result"].get("file_path")
                    # Правильный формат ссылки для скачивания
                    return f"{TG_API}/file/bot{bot_token}/{file_path}"
    except Exception as e:
        log.error(f"Error getting TG file url: {e}")
    return None


async def get_telegram_user_photo(client_id: str, bot_token: str, user_id: int) -> Optional[str]:
    """Получает URL фото профиля пользователя Telegram через прокси с кэшированием."""
    # Кэшируем проверку фото на 1 час вместо 24, чтобы быстрее подхватывать обновления
    cache_key = f"tg_user_photo:{user_id}"
    cached_photo = cache_service.get(cache_key)
    if cached_photo:
        return cached_photo

    try:
        # 1. Получаем список фото профиля
        url = f"{TG_API}/bot{bot_token}/getUserProfilePhotos"
        async with get_tg_client() as client:
            resp = await client.get(url, params={"user_id": user_id, "limit": 1})
            if resp.status_code == 200:
                data = resp.json()
                if data.get("ok") and data["result"].get("total_count", 0) > 0:
                    # Берем первое фото, самый маленький размер (индекс 0)
                    photos = data["result"]["photos"][0]
                    file_id = photos[0]["file_id"]
                    
                    photo_url = f"/api/chat/proxy/avatar?platform=tg&client_id={client_id}&file_id={file_id}"
                    # Кэшируем на 1 час (3600 секунд)
                    cache_service.set(cache_key, photo_url, expire=3600)
                    return photo_url
    except Exception as e:
        log.error(f"Error getting TG user photo: {e}")
    return None


async def handle_telegram_message(
    client_id: str, bot_token: str, tg_chat_id: int,
    user_text: str, from_user: dict,
) -> bool:
    # Получаем фото пользователя
    photo_url = await get_telegram_user_photo(client_id, bot_token, from_user.get("id"))

    # Всегда обновляем метаданные в базе при новом сообщении
    user_info = {
        "first_name": from_user.get("first_name"),
        "last_name": from_user.get("last_name"),
        "username": from_user.get("username"),
        "photo": photo_url,
        "platform": "telegram"
    }
    session_id = f"tg-{client_id}-{tg_chat_id}"
    
    async with AsyncSessionLocal() as db:
        await get_or_create_session(session_id, client_id, metadata=user_info)

    # Кэшируем только ID сессии для быстрого доступа в других местах
    cache_key = f"tg_session:{client_id}:{tg_chat_id}"
    cache_service.set(cache_key, session_id)

    # Если это команда /start, отправляем приветственное сообщение из настроек
    if user_text.strip().lower() == "/start":
        try:
            config = await get_client_config(client_id)
            welcome_msg = config.welcome_msg
            await send_telegram_message(bot_token, tg_chat_id, welcome_msg)
            return True
        except Exception as e:
            log.error(f"Error sending welcome message for /start: {e}")
            # В случае ошибки продолжаем обычную обработку

    is_operator = await is_operator_mode(session_id)

    # Проверяем, включена ли интеграция для этого клиента
    settings = await get_integration_settings(client_id, "telegram")
    if not settings.get("enabled"):
        log.warning(f"TG message ignored: integration disabled for client {client_id}")
        return False

    # Режим ассистента: работает если включен глобально И сессия не в режиме оператора
    assistant_enabled = settings.get("assistant_enabled", False)

    if is_operator or not assistant_enabled:
        await save_chat_message(session_id, "user", user_text)
        
        # Уведомляем оператора о новом сообщении (не как лид, а как сообщение в чате)
        user_name = from_user.get("first_name", "")
        if from_user.get("last_name"):
            user_name += f" {from_user.get('last_name')}"
        username = from_user.get("username")
        user_display = f"{user_name} (@{username})" if username else user_name
        
        notification_text = (
            f"💬 <b>Новое сообщение в чате!</b>\n"
            f"От: {user_display}\n"
            f"Текст: {user_text}\n\n"
            f"<i>Режим: {'Оператор' if is_operator else 'Ассистент выключен'}</i>"
        )
        await notify_admins(client_id, notification_text, event_type="message")
        
        # Если ИИ не активен, отправляем автоответ (только если он включен и настроен)
        if settings.get("autoreply_enabled") and settings.get("autoreply_message"):
            autoreply_msg = settings.get("autoreply_message")
            await send_telegram_message(bot_token, tg_chat_id, autoreply_msg)
            await save_chat_message(session_id, "assistant", autoreply_msg)
        return True

    await send_telegram_typing(bot_token, tg_chat_id)

    data = AskData(
        client_id=client_id,
        session_id=session_id,
        message=user_text,
        token=session_id,
        context=None,
        voice_output=False,
        stream=False,
    )

    try:
        result = await chat_service.process_ask(data, files=None, stream=False, is_admin=False)

        # ГАРАНТИРОВАННОЕ ИЗВЛЕЧЕНИЕ ТЕКСТА
        response_text = extract_response_text(result)
        
        # Если в результате все еще dict (цепочка вызовов функций), продолжаем извлекать
        while isinstance(response_text, dict):
            response_text = extract_response_text(response_text)

        response_text = str(response_text) if response_text is not None else ""

        if result and isinstance(result, dict) and result.get("status") == "function_call":
            log.info(f"[TG] AI requested function call, waiting for final response...")
            if not response_text or response_text == "None" or response_text.strip() == "":
                return True

        if not response_text.strip() or response_text == "None":
            response_text = "Извините, я не смог сформировать текстовый ответ. Попробуйте перефразировать вопрос."

        # Очистка от технических артефактов
        if response_text.startswith("pro)"):
            response_text = response_text.replace("pro)", "").strip()
            response_text = response_text.replace("pro)", "").strip()

        if response_text.startswith("{") and "answer" in response_text:
            try:
                import json
                tmp = json.loads(response_text)
                response_text = tmp.get("answer", response_text)
            except:
                pass

        max_len = 4000
        if len(response_text) > max_len:
            parts = []
            current = ""
            for line in response_text.split("\n"):
                if len(current) + len(line) + 1 > max_len:
                    parts.append(current)
                    current = line
                else:
                    current += ("\n" + line) if current else line
            if current:
                parts.append(current)
            for part in parts:
                await send_telegram_message(bot_token, tg_chat_id, part)
        else:
            await send_telegram_message(bot_token, tg_chat_id, response_text)

        return True

    except Exception as e:
        log.error(f"TG message handling error: {e}")
        await send_telegram_message(
            bot_token, tg_chat_id,
            "⚠️ Произошла ошибка при обработке сообщения. Попробуйте позже."
        )
        return False


async def set_webhook(bot_token: str, webhook_url: str) -> bool:
    url = f"{TG_API}/bot{bot_token}/setWebhook"
    try:
        async with get_tg_client(timeout=3) as client:
            resp = await client.post(url, json={"url": webhook_url})
            data = resp.json()
            if data.get("ok"):
                log.info(f"Webhook set for bot: {webhook_url}")
                return True
            log.error(f"Failed to set webhook: {data}")
            return False
    except Exception as e:
        log.error(f"setWebhook error: {e}")
        return False


async def delete_webhook(bot_token: str) -> bool:
    url = f"{TG_API}/bot{bot_token}/deleteWebhook"
    try:
        async with get_tg_client(timeout=3) as client:
            resp = await client.post(url)
            return resp.json().get("ok", False)
    except Exception as e:
        log.error(f"deleteWebhook error: {e}")
        return False


async def validate_bot_token(bot_token: str) -> bool:
    """Проверяет валидность токена через getMe."""
    url = f"{TG_API}/bot{bot_token}/getMe"
    try:
        async with get_tg_client(timeout=3, verify=False) as client:
            log.info(f"[TG_CHECK] Sending request to Telegram API for token ...{bot_token[-5:]}")
            resp = await client.get(url)
            log.info(f"[TG_CHECK] Response status: {resp.status_code}, body: {resp.text}")
            return resp.status_code == 200
    except Exception as e:
        log.error(f"[TG_CHECK] Critical error during validation: {str(e)}")
        return False


async def notify_operator_takeover(client_id: str, session_id: str, operator_name: str):
    if not session_id.startswith(f"tg-{client_id}-"):
        return
    try:
        tg_chat_id = int(session_id.split("-")[-1])
    except (ValueError, IndexError):
        return
    settings = await get_integration_settings(client_id, "telegram")
    bot_token = settings.get("bot_token")
    if not bot_token or not settings.get("enabled"):
        return
    await send_telegram_message(
        bot_token, tg_chat_id,
        f"👤 <b>{operator_name}</b> подключился к диалогу. ИИ-ассистент временно отключён."
    )


async def notify_operator_release(
    client_id: str, session_id: str, operator_name: str, ai_name: str
):
    if not session_id.startswith(f"tg-{client_id}-"):
        return
    try:
        tg_chat_id = int(session_id.split("-")[-1])
    except (ValueError, IndexError):
        return
    settings = await get_integration_settings(client_id, "telegram")
    bot_token = settings.get("bot_token")
    if not bot_token or not settings.get("enabled"):
        return
    await send_telegram_message(
        bot_token, tg_chat_id,
        f"🤖 {operator_name} вышел из чата. <b>{ai_name}</b> снова на связи."
    )


async def send_telegram_file(bot_token: str, chat_id: int, file_data_base64: str, filename: str, content_type: str) -> bool:
    """Отправка файла в Telegram."""
    import base64
    import io
    
    method = "sendDocument"
    if content_type.startswith("image/"):
        method = "sendPhoto"
    
    url = f"{TG_API}/bot{bot_token}/{method}"
    
    try:
        file_content = base64.b64decode(file_data_base64)
        files = {
            "document" if method == "sendDocument" else "photo": (filename, io.BytesIO(file_content), content_type)
        }
        data = {"chat_id": chat_id}
        
        async with get_tg_client(timeout=20) as client:
            resp = await client.post(url, data=data, files=files)
            return resp.status_code == 200
    except Exception as e:
        log.error(f"TG sendFile error: {e}")
        return False


async def send_operator_message_to_tg(
    client_id: str, session_id: str, message: str, attachments: list = None, operator_name: str = "Оператор"
) -> bool:
    if not session_id.startswith(f"tg-{client_id}-"):
        return False
    try:
        tg_chat_id = int(session_id.split("-")[-1])
    except (ValueError, IndexError):
        return False
    settings = await get_integration_settings(client_id, "telegram")
    bot_token = settings.get("bot_token")
    if not bot_token or not settings.get("enabled"):
        return False
    
    # Форматируем сообщение с именем оператора
    display_message = f"👤 <b>{operator_name}</b>: {message}" if message else ""
    
    success = True
    if display_message:
        success = await send_telegram_message(bot_token, tg_chat_id, display_message)
    
    if attachments:
        for att in attachments:
            res = await send_telegram_file(
                bot_token, tg_chat_id, att.get("data"), att.get("name"), att.get("content_type")
            )
            if not res: success = False
            
    return success


async def notify_admins(
    client_id: str,
    message: str,
    event_type: Literal["lead", "contact", "message"] = "message"
):
    """Отправляет уведомление всем администраторам клиента."""
    settings = await get_integration_settings(client_id, "telegram")
    notifications_settings = await get_integration_settings(client_id, "notifications")
    bot_token = settings.get("bot_token")
    admin_ids_raw = notifications_settings.get("admin_id", settings.get("admin_id", ""))
    enabled = notifications_settings.get("enabled", False)

    if event_type == "lead":
        event_enabled = notifications_settings.get("notify_leads")
    elif event_type == "contact":
        event_enabled = notifications_settings.get("notify_contacts")
    else:
        event_enabled = notifications_settings.get("notify_messages")

    if event_enabled is None:
        event_enabled = enabled

    if not bot_token or not admin_ids_raw or not enabled or not event_enabled:
        log.warning(
            f"[NOTIFY_ADMINS] Skip: token={bool(bot_token)}, ids={bool(admin_ids_raw)}, "
            f"enabled={enabled}, event_type={event_type}, event_enabled={event_enabled}"
        )
        return

    # Разделяем по запятой или точке с запятой
    import re
    admin_ids = re.split(r'[;,]', str(admin_ids_raw))

    for admin_id in admin_ids:
        admin_id = admin_id.strip()
        if not admin_id:
            continue

        # Очищаем от меток (например, "Иван:12345" -> "12345")
        if ":" in admin_id:
            admin_id = admin_id.split(":")[-1].strip()

        try:
            log.info(f"[NOTIFY_ADMINS] Sending to {admin_id} for client {client_id}")
            await send_telegram_message(bot_token, int(admin_id), message)
        except Exception as e:
            log.error(f"Failed to notify admin {admin_id}: {e}")


async def run_polling():
    """
    Запускает Long Polling для всех активных ботов.
    Полезно для локальной разработки без вебхуков.
    """
    import asyncio
    log.info("Starting Telegram Polling service...")
    
    # Список токенов, для которых мы уже удалили вебхук в этой сессии
    cleaned_tokens = set()
    
    offset = 0
    while True:
        try:
            clients = await list_clients()
            for c in clients:
                if isinstance(c, str):
                    cid = c
                else:
                    cid = c.get("client_id") or c.get("id")
                
                if not cid: continue
                
                settings = await get_integration_settings(cid, "telegram")
                # Если настройки вернулись строкой, парсим
                if isinstance(settings, str):
                    try:
                        import json
                        settings = json.loads(settings)
                    except: settings = {}
                
                token = settings.get("bot_token")
                enabled = settings.get("enabled")
                
                if not token or not enabled:
                    if cid in cleaned_tokens:
                        log.info(f"[TG_POLLING] Integration disabled for {cid}, removing from active.")
                        cleaned_tokens.remove(cid)
                    continue
                
                # Логируем только если это новый клиент или мы только что включили его
                if cid not in cleaned_tokens:
                    log.info(f"TG Polling active for {cid}, token: ...{token[-5:]}")
                    log.info(f"Cleaning up webhook for {cid} to enable Polling...")
                    await delete_webhook(token)
                    cleaned_tokens.add(cid)
                
                # Опрашиваем Telegram
                url = f"{TG_API}/bot{token}/getUpdates"
                async with get_tg_client(timeout=5) as client:
                    resp = await client.get(url, params={"offset": offset, "timeout": 10})
                    if resp.status_code != 200:
                        continue
                    
                    data = resp.json()
                    if not data.get("ok"):
                        log.error(f"TG Polling error for {cid}: {data}")
                        continue
                        
                    for update in data.get("result", []):
                        offset = update["update_id"] + 1
                        
                        if "message" not in update:
                            continue
                            
                        message = update["message"]
                        tg_chat_id = message.get("chat", {}).get("id")
                        user_text = message.get("text") or ""
                        from_user = message.get("from", {})

                        # Обработка вложений в Telegram — скачиваем файлы
                        attachment_links = []
                        session_id = f"tg-{cid}-{tg_chat_id}"

                        if "photo" in message:
                            photo = message["photo"][-1]
                            file_url = await get_telegram_file_url(token, photo["file_id"])
                            if file_url:
                                local_url = await download_and_save_file(
                                    file_url, cid, session_id=session_id,
                                    file_name="photo.jpg", category="chat_file"
                                )
                                attachment_links.append(f"🖼 Фото: {local_url or file_url}")
                        if "document" in message:
                            doc = message["document"]
                            file_url = await get_telegram_file_url(token, doc["file_id"])
                            name = doc.get("file_name", "файл")
                            if file_url:
                                local_url = await download_and_save_file(
                                    file_url, cid, session_id=session_id,
                                    file_name=name, category="chat_file"
                                )
                                attachment_links.append(f"📄 Файл {name}: {local_url or file_url}")
                        if "video" in message:
                            video = message["video"]
                            file_url = await get_telegram_file_url(token, video["file_id"])
                            if file_url:
                                local_url = await download_and_save_file(
                                    file_url, cid, session_id=session_id,
                                    file_name="video.mp4", category="chat_file"
                                )
                                attachment_links.append(f"🎥 Видео: {local_url or file_url}")

                        if attachment_links:
                            extra_text = "\n".join(attachment_links)
                            user_text = f"{user_text}\n\n{extra_text}".strip()

                        if tg_chat_id and (user_text or attachment_links):
                            log.info(f"TG Polling: New message from {tg_chat_id}")
                            await handle_telegram_message(
                                cid, token, tg_chat_id, user_text or "", from_user
                            )
                            
        except httpx.ReadTimeout:
            # Для long polling таймаут — штатная ситуация (нет новых апдейтов)
            log.debug("TG Polling timeout: no updates")
        except Exception as e:
            log.exception(
                f"Polling error in Telegram run_polling loop: {type(e).__name__}: {e!r}"
            )
            await asyncio.sleep(5)
        
        await asyncio.sleep(0.5)
