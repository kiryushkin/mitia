import json
import httpx
import re
from typing import List, Dict
from ..core.config import YANDEX_API_KEY, YANDEX_FOLDER_ID, YANDEX_MODEL, log

def clean_ascii(text: str) -> str:
    """Удаляет любые не-ASCII символы из строки."""
    if not text: return ""
    return "".join(char for char in str(text) if ord(char) < 128).strip()

async def handle_yandex_request(messages: List[Dict], stream: bool = False, **kwargs):
    """Обработка запроса к YandexGPT."""
    api_key = clean_ascii(YANDEX_API_KEY)
    folder_id = clean_ascii(YANDEX_FOLDER_ID)

    if not api_key or not folder_id:
        return {"response": "Ошибка: API ключ или Folder ID Яндекса не настроены или содержат некорректные символы", "status": "error"}

    url = "https://llm.api.cloud.yandex.net/foundationModels/v1/completionAsync" if not stream else "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"
    
    yandex_messages = []
    for m in messages:
        role = m.get('role', 'user')
        text = m.get('content', '')
        if not isinstance(text, str):
            text = str(text)
        
        if not text.strip():
            continue
            
        yandex_messages.append({"role": role, "text": text})

    if not yandex_messages:
        yandex_messages.append({"role": "user", "text": "..."})

    model_uri_part = kwargs.get('target_model', YANDEX_MODEL)

    model_path = model_uri_part
    if model_path in ['yandexgpt', 'yandexgpt-lite']:
        model_path = f"{model_path}/latest"
    
    payload = {
        "modelUri": f"gpt://{folder_id}/{model_path}",
        "completionOptions": {
            "stream": stream,
            "temperature": float(kwargs.get('temperature', 0.6)),
            "maxTokens": 2000
        },
        "messages": yandex_messages
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Api-Key {api_key}",
        "x-folder-id": folder_id
    }

    payload_bytes = json.dumps(payload, ensure_ascii=False).encode('utf-8')

    if stream:
        return yandex_stream_generator(payload_bytes, headers, **kwargs)
    else:
        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                res = await client.post("https://llm.api.cloud.yandex.net/foundationModels/v1/completion", headers=headers, json=payload)
                if res.status_code == 200:
                    data = res.json()
                    text = data['result']['alternatives'][0]['message']['text']
                    return {"response": text, "status": "ok"}
                else:
                    log.error(f"Yandex API Error: {res.text}")
                    return {"response": f"Ошибка Yandex API: {res.status_code}", "status": "error"}
            except Exception as e:
                log.error(f"Yandex Error: {e}")
                return {"response": f"Ошибка: {str(e)}", "status": "error"}

async def yandex_stream_generator(payload_bytes, headers, **kwargs):
    """Генератор потока для YandexGPT."""
    url = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"
    session_id = kwargs.get('session_id')
    full_content = ""
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            async with client.stream("POST", url, headers=headers, content=payload_bytes) as response:
                if response.status_code != 200:
                    err_body = await response.aread()
                    err_text = err_body.decode('utf-8', errors='ignore')
                    log.error(f"Yandex Stream Error: {response.status_code} | {err_text}")
                    yield f"data: {json.dumps({'content': f'Ошибка API Яндекса: {response.status_code}'}, ensure_ascii=False)}\n\n"
                    return

                async for line in response.aiter_lines():
                    if not line: continue
                    try:
                        data = json.loads(line)
                        if 'result' in data and 'alternatives' in data['result']:
                            new_full_text = data['result']['alternatives'][0]['message']['text']
                            chunk = new_full_text[len(full_content):]
                            if chunk:
                                full_content = new_full_text
                                yield f"data: {json.dumps({'content': chunk}, ensure_ascii=False)}\n\n"
                        elif 'error' in data:
                            err_msg = data.get('error', {}).get('message', 'Unknown Yandex Error')
                            log.error(f"Yandex API Error in stream: {err_msg}")
                            yield f"data: {json.dumps({'content': f'Ошибка API: {err_msg}'}, ensure_ascii=False)}\n\n"
                    except Exception as e:
                        continue
            
            if session_id and full_content:
                from .db_service import save_chat_message
                await save_chat_message(session_id, 'assistant', full_content.strip())
                
        except Exception as e:
            log.error(f"Yandex Critical Error: {type(e).__name__}")
            
            yield f"data: {json.dumps({'content': f'Ошибка соединения с Яндексом'}, ensure_ascii=False)}\n\n"
