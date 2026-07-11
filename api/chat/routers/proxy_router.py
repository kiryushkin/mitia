from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
import httpx
import asyncio
import traceback
from typing import Optional
from ..services.integrations_service import get_integration_settings
from ..core.config import log, TELEGRAM_CONFIG
from ..services.telegram_service import get_tg_client

router = APIRouter(prefix="/api/chat/proxy", tags=["proxy"])

# Используем базовый URL из конфига или дефолтный
TG_API_BASE = TELEGRAM_CONFIG.get("api_url", "https://api.telegram.org")

@router.get("/avatar")
async def proxy_avatar(
    platform: str,
    client_id: str,
    file_id: Optional[str] = None,
    url: Optional[str] = None
):
    """Проксирует изображения аватаров для Telegram и MAX.
    Использует кэширование браузера, чтобы не нагружать память сервера.
    """
    
    if platform == "tg":
        if not file_id:
            raise HTTPException(status_code=400, detail="file_id is required for tg")
            
        settings = await get_integration_settings(client_id, "telegram")
        bot_token = settings.get("bot_token")
        if not bot_token:
            raise HTTPException(status_code=404, detail="Bot token not found")
            
        try:
            async with get_tg_client() as client:
                # Получаем путь к файлу
                resp = await client.get(f"{TG_API_BASE}/bot{bot_token}/getFile", params={"file_id": file_id})
                if resp.status_code != 200:
                    raise HTTPException(status_code=resp.status_code)
                
                data = resp.json()
                file_path = data.get("result", {}).get("file_path")
                if not file_path:
                    raise HTTPException(status_code=404)
                
                if "api.telegram.org" in TG_API_BASE:
                    file_url = f"https://api.telegram.org/file/bot{bot_token}/{file_path}"
                else:
                    file_url = f"{TG_API_BASE}/file/bot{bot_token}/{file_path}"
                
                # Стримим напрямую из Telegram пользователю
                async def stream_contents():
                    async with get_tg_client() as s_client:
                        try:
                            async with s_client.stream("GET", file_url) as r:
                                if r.status_code != 200:
                                    return
                                async for chunk in r.aiter_bytes():
                                    yield chunk
                        except Exception as e:
                            log.error(f"Proxy stream error: {e}")

                return StreamingResponse(
                    stream_contents(), 
                    media_type="image/jpeg",
                    headers={
                        "Cache-Control": "public, max-age=604800, immutable",
                        "X-Platform": "Telegram"
                    }
                )
        except Exception as e:
            log.error(f"Proxy TG avatar error: {e}")
            raise HTTPException(status_code=500)
            
    if platform == "max":
        if not url:
            raise HTTPException(status_code=400, detail="url is required for max")
            
        try:
            async def stream_contents():
                async with httpx.AsyncClient(timeout=10.0) as client:
                    try:
                        async with client.stream("GET", url) as r:
                            if r.status_code != 200:
                                return
                            async for chunk in r.aiter_bytes():
                                yield chunk
                    except Exception as e:
                        log.error(f"Proxy MAX stream error: {e}")

            return StreamingResponse(
                stream_contents(), 
                media_type="image/jpeg",
                headers={
                    "Cache-Control": "public, max-age=604800, immutable",
                    "X-Platform": "MAX"
                }
            )
        except Exception as e:
            log.error(f"Proxy MAX avatar error: {e}")
            raise HTTPException(status_code=500)
            
    raise HTTPException(status_code=400, detail="Unsupported platform")


@router.get("/email-avatar")
async def proxy_email_avatar(email: str = Query(...)):
    """Прокси для email-аватаров — логотип компании через Google Favicons.
    Пробует полный домен, затем корневой. Кешируется на 7 дней.
    """
    clean_email = email.lower().strip()
    if not clean_email or '@' not in clean_email:
        raise HTTPException(status_code=400, detail="Invalid email")

    async def try_url(url: str) -> tuple:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, follow_redirects=True)
                if resp.status_code != 200:
                    return None, None
                ct = resp.headers.get('content-type', 'image/jpeg')
                return resp.content, ct
        except Exception as e:
            log.debug(f"Email avatar fetch error for {url}: {e}")
            return None, None

    # Пробуем полный домен, затем корневой
    domain = clean_email.split('@')[1] if '@' in clean_email else None
    if domain:
        domains_to_try = [domain]
        parts = domain.split('.')
        if len(parts) > 2:
            root = '.'.join(parts[-2:])
            if root != domain:
                domains_to_try.append(root)
        for d in domains_to_try:
            content, ct = await try_url(f"https://www.google.com/s2/favicons?domain={d}&sz=64")
            if content:
                return Response(content=content, media_type=ct, headers={
                    "Cache-Control": "public, max-age=604800, immutable",
                    "X-Avatar-Source": "favicon"
                })

    # Если ничего не нашли — возвращаем 404, чтобы фронтенд показал инициалы
    raise HTTPException(status_code=404, detail="Avatar not found")

