from fastapi import APIRouter, Request, HTTPException, Depends, File, UploadFile, Form
from fastapi.responses import JSONResponse, StreamingResponse, RedirectResponse, HTMLResponse
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
import json
from typing import Optional, Dict, Any, List
import uuid
from datetime import datetime

from ..core.config import TARIFF_RULES, log
from ..services.ai_service import ask_ai
from ..services.gigachat_service import get_gigachat_token
from ..services.db_service import (
    get_user_by_client_id, get_chat_history
)
from ..services.clients import get_client_config
from ..services.assistants_service import resolve_assistant_id_for_origin
from ..services.chat_service import chat_service
from ..services.tts_engine import tts_engine
from ..core.rate_limit import ask_limiter, tts_limiter
from fastapi.templating import Jinja2Templates
import os
from ..core.config import BASE_DIR

templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

router = APIRouter(prefix="/api/chat", tags=["chat"])

class ChatContext(BaseModel):
    title: Optional[str] = None
    path: Optional[str] = None
    visible_actions: Optional[List[str]] = None

class AskRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=50000)
    client_id: str = "mitia_assistant"
    token: Optional[str] = None
    session_id: Optional[str] = None
    context: Optional[ChatContext] = None
    voice_output: Optional[bool] = False
    stream: Optional[bool] = False
    source: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    attachments: Optional[List[Dict[str, Any]]] = None
    client_ip: Optional[str] = None
    assistant_id: Optional[str] = None

from ..services.theme_manager import get_default_theme, THEME_FIELDS

@router.get("/theme-defaults")
async def get_theme_defaults():
    """Возвращает дефолтные настройки темы из JSON-файла."""
    return get_default_theme()

@router.get("/intelligence-defaults")
async def get_intelligence_defaults():
    """Возвращает дефолтные настройки интеллекта из JSON-файла."""
    import os
    from ..core.config import BASE_DIR
    path = os.path.join(BASE_DIR, "core", "intelligence_defaults.json")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

@router.get("/integrations-presets")
async def get_integrations_presets():
    """Возвращает пресеты интеграций из JSON-файла."""
    import os
    from ..core.config import BASE_DIR
    path = os.path.join(BASE_DIR, "core", "integrations_presets.json")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

@router.get("/config")
async def get_config(request: Request, client_id: str, assistant_id: Optional[str] = None):
    """Загрузка конфигурации виджета."""
    if not client_id or client_id == 'default':
        client_id = 'mitia_assistant'

    referer = request.headers.get('referer')
    origin = request.headers.get('origin') or referer
    is_platform_admin_preview = bool(referer and '/admin' in referer)
    if not assistant_id and not is_platform_admin_preview:
        assistant_id = await resolve_assistant_id_for_origin(client_id, origin)

    user_row = await get_user_by_client_id(client_id)
    ai_disabled_by_balance = False
    if user_row and user_row.balance <= -1 and client_id != 'mitia_assistant':
        # Вместо блокировки 402 мы разрешаем загрузку виджета, но помечаем, что AI отключен.
        # Это позволяет пользователю связаться с оператором.
        ai_disabled_by_balance = True
    
    # Загружаем конфиг без кэша, чтобы сразу видеть изменения домена
    config = await get_client_config(client_id, use_cache=False, assistant_id=assistant_id)
    
    allowed_origins = config.raw.get('allowed_origins', [])
    log.info(f"[DOMAIN CHECK] client_id: {client_id}, assistant_id: {assistant_id}, allowed_origins: {allowed_origins}, referer: {referer}")

    # Внутри админки разрешаем предпросмотр конфигурации текущего клиента
    # без доменной проверки, чтобы настройки не подменялись витринным аккаунтом.
    if is_platform_admin_preview:
        res = config.public_dict()
        res['assistant_id'] = assistant_id
        res['ai_disabled'] = ai_disabled_by_balance
        res['preview_fallback'] = False
        return res

    # Если список доменов пуст — блокируем вне админ-предпросмотра
    if not allowed_origins:
        log.warning(f"Blocked widget load for {client_id}: No allowed domain configured.")
        return JSONResponse(status_code=403, content={"detail": "Widget not configured for any domain", "hidden": True})
    
    # Если домены указаны, то referer ОБЯЗАТЕЛЕН (защита от прямой загрузки конфига)
    if not referer:
        log.warning(f"Blocked widget load for {client_id}: No referer header.")
        return JSONResponse(status_code=403, content={"detail": "Referer required", "hidden": True})

    from urllib.parse import urlparse
    try:
        domain = urlparse(referer).netloc.replace('www.', '').split(':')[0]
        
        is_match = False
        for allowed_site in allowed_origins:
            # Очищаем разрешенный домен от протоколов и путей
            allowed_domain = allowed_site.replace('http://', '').replace('https://', '').split('/')[0].replace('www.', '').split(':')[0]
            
            if domain == allowed_domain:
                is_match = True
                break
            
            # Разрешаем локальную разработку только если localhost явно указан в разрешенных
            # (убрал автоматическое разрешение localhost)

        if not is_match:
            log.warning(f"Blocked widget load for {client_id} on unauthorized domain: {domain}. Allowed: {allowed_origins}")
            return JSONResponse(status_code=403, content={"detail": "Domain not authorized", "hidden": True})
    except Exception as e:
        log.error(f"Error parsing domain in config check: {e}")
        return JSONResponse(status_code=403, content={"detail": "Invalid configuration", "hidden": True})

    res = config.public_dict()
    res['ai_disabled'] = ai_disabled_by_balance
    res['assistant_id'] = assistant_id
    return res

@router.get("/history")
async def history(request: Request, token: str, client_id: Optional[str] = None, limit: int = 50):
    """Получение истории сообщений с проверкой принадлежности клиенту."""
    actual_limit = max(1, min(int(limit or 50), 500))

    token_data = None
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        try:
            from ..core.config import JWT_SECRET, JWT_ALGORITHM
            import jwt
            token_data = jwt.decode(auth_header.split(' ')[1], JWT_SECRET, algorithms=[JWT_ALGORITHM])
        except Exception:
            token_data = None

    is_superadmin = bool(token_data and token_data.get('role') == 'superadmin')
    requester_id = token_data.get('sub') if token_data else None
    if not client_id and not is_superadmin:
        raise HTTPException(status_code=400, detail="client_id is required")
    if requester_id and not is_superadmin and requester_id != client_id:
        raise HTTPException(status_code=403, detail="Access denied")

    from ..services.db_service import AsyncSessionLocal, ChatSession
    from sqlalchemy import select
    async with AsyncSessionLocal() as db:
        stmt = select(ChatSession).where(ChatSession.session_id == token)
        if client_id:
            stmt = stmt.where(ChatSession.client_id == client_id)

        res = await db.execute(stmt)
        session = res.scalar_one_or_none()
        
        # Если сессия не найдена (удалена или еще не создана),
        # возвращаем пустую историю вместо 403 ошибки.
        # Это предотвратит спам ошибками в консоли виджета.
        if not session:
            return JSONResponse(content={"status": "success", "history": []})

    messages = await get_chat_history(token, actual_limit)
    return JSONResponse(
        content=jsonable_encoder({"status": "success", "history": messages}),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )

@router.post("/ask")
async def ask(
    request: Request,
    _ = Depends(ask_limiter),
    message: Optional[str] = Form(None),
    client_id: Optional[str] = Form("mitia_assistant"),
    token: Optional[str] = Form(None),
    session_id: Optional[str] = Form(None),
    context: Optional[str] = Form(None),
    voice_output: Optional[bool] = Form(False),
    stream: Optional[bool] = Form(False),
    source: Optional[str] = Form(None),
    files: Optional[List[UploadFile]] = File(None)
):
    """Основной эндпоинт диалога с ИИ через ChatService. Поддерживает JSON и FormData."""
    
    referer = request.headers.get('referer')
    isAdminPage = '/admin' in request.url.path or (referer and '/admin' in referer)
    
    content_type = request.headers.get("content-type", "")
    
    log.info(f"[ASK DEBUG] Message: {message}, Files count: {len(files) if files else 0}, Content-Type: {content_type}")
    
    # Получаем IP клиента
    forwarded = request.headers.get("X-Forwarded-For")
    real_ip = request.headers.get("X-Real-IP")
    
    if forwarded:
        client_ip = forwarded.split(",")[0].strip()
    elif real_ip:
        client_ip = real_ip
    else:
        client_ip = request.client.host if request.client else None

    # Если IP локальный, пробуем взять его из метаданных (присланный фронтендом)
    if client_ip in [None, '127.0.0.1', 'localhost', '::1']:
        try:
            if "application/json" in content_type:
                # Для JSON мы еще не распарсили тело, сделаем это позже
                pass
            else:
                # Для FormData
                form_data = await request.form()
                meta_str = form_data.get('metadata')
                if meta_str:
                    meta_obj = json.loads(meta_str)
                    if meta_obj.get('client_ip'):
                        client_ip = meta_obj.get('client_ip')
                        log.info(f"[IP DEBUG] Using IP from metadata: {client_ip}")
        except:
            pass
    
    log.info(f"[IP DEBUG] X-Forwarded-For: {forwarded}, X-Real-IP: {real_ip}, Remote Host: {request.client.host if request.client else 'None'}, Result IP: {client_ip}")
    
    is_stream = stream
    if "application/json" in content_type:
        try:
            data_dict = await request.json()
            data = AskRequest(**data_dict)
            is_stream = data_dict.get('stream', False)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid JSON: {str(e)}")
    else:
        # Для FormData проверяем stream вручную, так как FastAPI может не распарсить "true" как bool
        form_data = await request.form()
        stream_val = form_data.get('stream')
        if stream_val is not None:
            is_stream = str(stream_val).lower() == 'true'
            
        if not message:
            raise HTTPException(status_code=400, detail="Message is required")
            
        ctx_obj = None
        if context:
            try:
                ctx_obj = ChatContext(**json.loads(context))
            except: pass
            
        data = AskRequest(
            message=message,
            client_id=client_id,
            token=token,
            session_id=session_id,
            context=ctx_obj,
            voice_output=voice_output,
            source=source,
            assistant_id=form_data.get('assistant_id')
        )
    
    data.client_ip = client_ip

    result = await chat_service.process_ask(data, files=files, stream=is_stream, is_admin=False)
    
    if is_stream:
        if isinstance(result, StreamingResponse):
            return result
        if hasattr(result, '__aiter__'):
            return StreamingResponse(result, media_type="text/event-stream")
    
    if isinstance(result, dict):
        return JSONResponse(content=result)
        
    return result

@router.post("/stop")
async def stop_chat(request: Request):
    """Принудительная остановка генерации и сохранение остатка текста."""
    try:
        data = await request.json()
        session_id = data.get('token') or data.get('session_id')
        client_id = str(data.get('client_id') or '').strip()
        last_text = data.get('last_text', '')

        if not session_id or not client_id:
            raise HTTPException(status_code=400, detail="session_id and client_id are required")

        log.info(f"Stop signal received for session {session_id}. Last text length: {len(last_text)}")

        from ..services.db_service import AsyncSessionLocal, ChatMessage, ChatSession
        async with AsyncSessionLocal() as db:
            from sqlalchemy import select, desc
            session_result = await db.execute(
                select(ChatSession.id).where(
                    ChatSession.session_id == session_id,
                    ChatSession.client_id == client_id,
                )
            )
            if session_result.scalar_one_or_none() is None:
                raise HTTPException(status_code=403, detail="Access denied")

            result = await db.execute(
                    select(ChatMessage)
                    .where(ChatMessage.session_id == session_id, ChatMessage.role == 'assistant')
                    .order_by(desc(ChatMessage.id))
                    .limit(1)
                )
            msg = result.scalar_one_or_none()
            if msg:
                final_text = last_text if last_text else msg.content
                msg.content = final_text + "\n\n*Прервано пользователем*"
                await db.commit()
                log.info(f"Message {msg.id} updated with stop note. Content length: {len(msg.content)}")
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error in stop_chat: {e}")
        return {"status": "error"}

@router.delete("/history/{message_id}")
async def delete_message(request: Request, message_id: int):
    """Удаление отдельного сообщения из истории."""
    # Проверяем авторизацию (только админ может удалять)
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        from ..core.config import JWT_SECRET, JWT_ALGORITHM
        import jwt
        token_data = jwt.decode(auth_header.split(' ')[1], JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    requester_id = token_data.get('sub')
    is_superadmin = token_data.get('role') == 'superadmin'
    if not requester_id and not is_superadmin:
        raise HTTPException(status_code=401, detail="Invalid token")

    from ..services.db_service import (
        AsyncSessionLocal, ChatMessage, ChatSession, User,
        mark_storage_items_deleted
    )
    from sqlalchemy import delete, select, update, func
    import asyncio

    async with AsyncSessionLocal() as db:
        # Получаем сообщение перед удалением
        msg = (await db.execute(
            select(ChatMessage).where(ChatMessage.id == message_id)
        )).scalar_one_or_none()

        if msg:
            client_id = None
            # Определяем client_id через сессию
            session_res = await db.execute(
                select(ChatSession.client_id).where(ChatSession.session_id == msg.session_id)
            )
            client_id = session_res.scalar_one_or_none()
            if not is_superadmin and requester_id != client_id:
                raise HTTPException(status_code=403, detail="Access denied")

            # Считаем размер вложений
            freed_size = 0
            if msg.attachments and isinstance(msg.attachments, list):
                for att in msg.attachments:
                    freed_size += att.get('size', 0)

            # Удаляем сообщение
            await db.execute(delete(ChatMessage).where(ChatMessage.id == message_id))

            # Освобождаем used_storage
            if freed_size > 0 and client_id:
                await db.execute(
                    update(User)
                    .where(User.client_id == client_id)
                    .values(used_storage=func.greatest(0, User.used_storage - freed_size))
                )

            await db.commit()

            # Помечаем StorageItem
            if client_id:
                asyncio.create_task(mark_storage_items_deleted(
                    client_id=client_id, message_id=message_id
                ))

    return {"status": "ok"}

@router.api_route("/tts", methods=["GET", "POST"])
async def text_to_speech(request: Request, _ = Depends(tts_limiter)):
    """Озвучка текста через локальный Silero TTS."""
    try:
        if request.method == "POST":
            data = await request.json()
            text = data.get('text', '')
            voice_param = data.get('voice')
            client_id = data.get('client_id') or request.query_params.get('client_id', 'mitia_assistant')
            assistant_id = data.get('assistant_id') or request.query_params.get('assistant_id')
        else:
            text = request.query_params.get('text', '')
            voice_param = request.query_params.get('voice')
            client_id = request.query_params.get('client_id', 'mitia_assistant')
            assistant_id = request.query_params.get('assistant_id')
    except:
        return JSONResponse(status_code=400, content={"error": "Invalid JSON or parameters"})

    if not text: return {"error": "No text"}
    
    cfg = await get_client_config(client_id, assistant_id=assistant_id)
    voice = voice_param or cfg.raw.get('bot_settings', {}).get('tts_voice', 'Nec_24000')
    
    # Генерируем локально
    res_data = await tts_engine.generate(text, voice=voice)
    
    if res_data:
        if request.method == "GET":
            return RedirectResponse(url=res_data["url"])
        return res_data
    
    return JSONResponse(status_code=500, content={"error": "Failed to generate audio"})
