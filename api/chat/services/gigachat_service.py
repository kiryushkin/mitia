import time
import uuid
import json
import os
import re
import httpx
import anyio
from typing import Optional, List, Dict
from ..core.config import GIGACHAT_KEY, GIGACHAT_MODEL, CERT_VERIFY, log, BASE_DIR
from ..services.db_service import get_global_token, save_global_token, AsyncSessionLocal, ChatMessage, User, update_user_balance

async def get_gigachat_token():
    """Получает токен GigaChat с кэшированием в БД."""
    scope = 'GIGACHAT_API_PERS'
    cached = await get_global_token(scope)
    if cached and cached['expires_at'] > time.time() + 300:
        return cached['token']

    if not GIGACHAT_KEY:
        log.error("GIGACHAT_KEY не найден")
        return None

    url = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
    headers = {
        'Authorization': f'Basic {GIGACHAT_KEY}',
        'RqUID': str(uuid.uuid4()),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
    }

    async with httpx.AsyncClient(verify=CERT_VERIFY) as client:
        try:
            response = await client.post(url, headers=headers, data={'scope': scope}, timeout=15.0)
            if response.status_code == 200:
                data = response.json()
                token = data.get('access_token')
                expires_at = data.get('expires_at', 0) / 1000
                if token:
                    await save_global_token(scope, token, expires_at)
                    return token
            else:
                log.error(f"GigaChat Auth Error Status: {response.status_code} | {response.text}")
        except Exception as e:
            log.error(f"GigaChat Auth Exception: {e}")
    return None

async def upload_gigachat_file(file_path: str, file_name: str, content_type: str) -> Optional[str]:
    """Загружает файл в хранилище GigaChat для vision/file-aware ответа."""
    token = await get_gigachat_token()
    if not token:
        return None

    try:
        with open(file_path, "rb") as file_obj:
            files = {"file": (file_name, file_obj, content_type)}
            data = {"purpose": "general"}
            headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
            async with httpx.AsyncClient(verify=CERT_VERIFY) as client:
                response = await client.post(
                    "https://gigachat.devices.sberbank.ru/api/v1/files",
                    headers=headers,
                    data=data,
                    files=files,
                    timeout=60.0,
                )
        if response.status_code in (200, 201):
            return response.json().get("id")
        log.warning("GigaChat file upload failed: %s %s", response.status_code, response.text[:500])
    except Exception as error:
        log.warning("GigaChat file upload error for %s: %s", file_name, error)
    return None


GIGACHAT_FALLBACK_MODELS = ["GigaChat", "GigaChat-Max", "GigaChat-Pro", "GigaChat-Lite"]
GIGACHAT_ULTRA_MODEL = "GigaChat-Ultra"

async def handle_gigachat_request(messages: List[Dict], target_model: str, stream: bool = False, **kwargs):
    """Обработка запроса к GigaChat с перебором моделей (fallback)."""
    token = await get_gigachat_token()
    if not token:
        log.error("GigaChat token is unavailable — check GIGACHAT_KEY in .env")
        return "Ассистент временно недоступен. Пожалуйста, попробуйте позже."

    url = "https://gigachat.devices.sberbank.ru/api/v1/chat/completions"
    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': f'Bearer {token}'
    }

    # Строим цепочку fallback: Ultra → target_model → Max → Pro → Lite
    fallback_chain = [GIGACHAT_ULTRA_MODEL]
    for m in [target_model] + GIGACHAT_FALLBACK_MODELS:
        if m not in fallback_chain:
            fallback_chain.append(m)

    payload_template = {
        "messages": messages,
        "temperature": kwargs.get('temperature', 0.7),
        "stream": stream
    }
    if kwargs.get('available_tools'):
        payload_template["functions"] = kwargs['available_tools']
        payload_template["function_call"] = "auto"

    retries = kwargs.get('retries', 2)
    retry_delay = kwargs.get('retry_delay', 1.5)

    for model_idx, model in enumerate(fallback_chain):
        payload = {**payload_template, "model": model}
        if stream and model_idx > 0:
            log.warning(f"GigaChat stream fallback to {model} — not supported, falling back to non-stream")
            return await handle_gigachat_request(messages, model, stream=False, **kwargs)

        if stream:
            return gigachat_stream_generator(url, headers, payload, **kwargs)

        async with httpx.AsyncClient(verify=CERT_VERIFY) as client:
            for attempt in range(retries):
                try:
                    res = await client.post(url, headers=headers, json=payload, timeout=30.0)
                    if res.status_code == 200:
                        choice = res.json()['choices'][0]['message']
                        if 'function_call' in choice:
                            return {"status": "function_call", "function": choice['function_call']}
                        return choice.get('content', '')

                    if res.status_code in (401, 403):
                        log.warning(f"GigaChat {model} auth error ({res.status_code}), trying next model...")
                        break

                    if res.status_code == 429:
                        log.warning(f"GigaChat {model} quota exhausted (429), trying next model...")
                        break

                    if res.status_code in (500, 502, 503, 504) and attempt < retries - 1:
                        delay = retry_delay * (attempt + 1)
                        log.warning(f"GigaChat {model} temporary error {res.status_code}, retry in {delay:.1f}s")
                        await anyio.sleep(delay)
                        continue

                    log.error(f"GigaChat API error: {res.status_code} - {res.text[:300]}")
                    return "Ассистент временно недоступен. Пожалуйста, попробуйте позже."
                except Exception as e:
                    if attempt < retries - 1:
                        delay = retry_delay * (attempt + 1)
                        log.warning(f"GigaChat Error on attempt {attempt + 1}/{retries}: {e}. Retry in {delay:.1f}s")
                        await anyio.sleep(delay)
                        continue
                    log.error(f"GigaChat Error: {e}")
                    return "Ассистент временно недоступен. Пожалуйста, попробуйте позже."
            # Если вышли из retry по 429 — пробуем следующую модель
            continue

    log.error("GigaChat request failed after all models")
    return "Ассистент временно недоступен. Пожалуйста, попробуйте позже."

async def get_gigachat_embeddings(texts: List[str]) -> List[List[float]]:
    """Получает векторные представления (embeddings) для списка текстов."""
    token = await get_gigachat_token()
    if not token:
        log.error("GigaChat Auth Error for embeddings")
        return []

    url = "https://gigachat.devices.sberbank.ru/api/v1/embeddings"
    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': f'Bearer {token}'
    }
    
    # GigaChat имеет ОЧЕНЬ жесткий лимит на эмбеддинги (514 токенов)
    # Обрезаем текст до ~1000 символов, чтобы гарантированно влезть
    safe_texts = []
    for t in texts:
        if len(t) > 1000:
            safe_texts.append(t[:1000])
        else:
            safe_texts.append(t)

    payload = {
        "model": "Embeddings", # Или другая модель эмбеддингов GigaChat
        "input": safe_texts
    }

    async with httpx.AsyncClient(verify=CERT_VERIFY) as client:
        try:
            res = await client.post(url, headers=headers, json=payload, timeout=30.0)
            if res.status_code == 200:
                data = res.json()
                # GigaChat возвращает список объектов с полем 'embedding'
                return [item['embedding'] for item in data['data']]
            else:
                log.error(f"GigaChat Embeddings Error: {res.status_code} | {res.text}")
                return []
        except Exception as e:
            log.error(f"GigaChat Embeddings Exception: {e}")
            return []

async def gigachat_stream_generator(url, headers, payload, **kwargs):
    """Генератор потока для GigaChat."""
    client_id = kwargs.get('client_id')
    session_id = kwargs.get('session_id')
    emojis = kwargs.get('emojis', 'none')
    
    async with httpx.AsyncClient(verify=CERT_VERIFY) as client:
        async with client.stream("POST", url, headers=headers, json=payload, timeout=60.0) as response:
            if response.status_code != 200:
                yield f"data: {json.dumps({'error': 'API Error'})}\n\n"
                return

            msg_id = None
            if session_id:
                async with AsyncSessionLocal() as db:
                    msg = ChatMessage(session_id=session_id, role='assistant', content="")
                    db.add(msg)
                    await db.commit()
                    await db.refresh(msg)
                    msg_id = msg.id

            full_content = ""
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data_str = line[6:].strip()
                    if data_str == "[DONE]": break
                    try:
                        data_json = json.loads(data_str)
                        delta = data_json['choices'][0]['delta']
                        
                        if 'function_call' in delta:
                            continue

                        content = delta.get('content', '')
                        if content:
                            # Очистка от технических тегов
                            content = re.sub(r'\[(sources?|web_search|get_datetime|time).*?\]', '', content, flags=re.IGNORECASE)
                            content = re.sub(r'\[\d+\]', '', content)
                            
                            # Если эмодзи отключены, вырезаем их на лету
                            if emojis == 'none' or emojis is False:
                                content = re.sub(r'[\U00010000-\U0010ffff]', '', content)
                            
                            full_content += content
                            yield f"data: {json.dumps({'content': content})}\n\n"
                    except: continue

            if msg_id:
                async with AsyncSessionLocal() as db:
                    final_text = full_content.strip()
                    if emojis == 'active':
                        final_text = re.sub(r'[\U00010000-\U0010ffff]', '', final_text)
                    
                    # DATA GUARD: фильтруем финальный текст перед сохранением в БД
                    allowed_contacts = kwargs.get('allowed_contacts', [])
                    if allowed_contacts:
                        from .data_guard import apply_data_guard
                        final_text = apply_data_guard(final_text, allowed_contacts)
                    
                    from sqlalchemy import update
                    await db.execute(update(ChatMessage).where(ChatMessage.id == msg_id).values(content=final_text))
                    
                    if client_id:
                        cost = kwargs.get('total_msg_cost', 0)
                        await db.execute(update(User).where(User.client_id == client_id).values(
                            balance=User.balance - cost,
                            messages_consumed=User.messages_consumed + 1
                        ))
                    await db.commit()
