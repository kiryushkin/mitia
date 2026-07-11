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

async def handle_gigachat_request(messages: List[Dict], target_model: str, stream: bool = False, **kwargs):
    """Обработка запроса к GigaChat."""
    token = await get_gigachat_token()
    if not token:
        return "Ошибка авторизации GigaChat"

    url = "https://gigachat.devices.sberbank.ru/api/v1/chat/completions"
    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': f'Bearer {token}'
    }

    payload = {
        "model": target_model,
        "messages": messages,
        "temperature": kwargs.get('temperature', 0.7),
        "stream": stream
    }

    if kwargs.get('available_tools'):
        payload["functions"] = kwargs['available_tools']
        payload["function_call"] = "auto"

    if stream:
        return gigachat_stream_generator(url, headers, payload, **kwargs)

    retries = kwargs.get('retries', 3)
    retry_delay = kwargs.get('retry_delay', 1.5)

    async with httpx.AsyncClient(verify=CERT_VERIFY) as client:
        for attempt in range(retries):
            try:
                res = await client.post(url, headers=headers, json=payload, timeout=30.0)
                if res.status_code == 200:
                    choice = res.json()['choices'][0]['message']
                    if 'function_call' in choice:
                        return {"status": "function_call", "function": choice['function_call']}
                    return choice.get('content', '')

                if res.status_code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                    delay = retry_delay * (attempt + 1)
                    log.warning(f"GigaChat temporary error {res.status_code}, retry in {delay:.1f}s")
                    await anyio.sleep(delay)
                    continue

                return f"Ошибка API: {res.status_code}"
            except Exception as e:
                if attempt < retries - 1:
                    delay = retry_delay * (attempt + 1)
                    log.warning(f"GigaChat Error on attempt {attempt + 1}/{retries}: {e}. Retry in {delay:.1f}s")
                    await anyio.sleep(delay)
                    continue
                log.error(f"GigaChat Error: {e}")
                return "Ошибка при запросе к GigaChat"

    return "Ошибка при запросе к GigaChat"

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
