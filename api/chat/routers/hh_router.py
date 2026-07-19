import hashlib
import json
import os
import secrets
import urllib.parse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse

from .admin_router import verify_token
from ..core.config import HH_CONFIG, log
from ..services.cache_service import cache_service
from ..services.integrations_service import get_integration_settings, save_integration_settings


router = APIRouter(prefix="/api/chat/hh", tags=["hh"])


def _build_redirect_uri(request: Request) -> str:
    local_callback = str(request.url_for("hh_oauth_callback"))
    env_redirect = os.environ.get("HH_REDIRECT_URI", "").strip()

    if env_redirect:
        force_local = os.environ.get("HH_FORCE_LOCAL_REDIRECT", "").strip().lower() in {"1", "true", "yes"}
        if not force_local:
            return env_redirect

    return local_callback



def _masked_state(state: str) -> str:
    if not state:
        return ""
    if len(state) <= 8:
        return "***"
    return f"{state[:4]}***{state[-4:]}"


@router.get("/oauth/start")
async def hh_oauth_start(request: Request, client_id: str, assistant_id: str | None = None, token_data: dict = Depends(verify_token)):
    if token_data["sub"] != client_id and token_data["sub"] != "admin":
        raise HTTPException(status_code=403, detail="Access denied")

    app_client_id = (HH_CONFIG.get("client_id") or "").strip()
    if not app_client_id:
        return {"status": "error", "error": "HH_CLIENT_ID не задан на сервере"}

    redirect_uri = _build_redirect_uri(request)

    req_host = (request.url.hostname or "").lower()
    is_local_request = req_host in {"localhost", "127.0.0.1"}
    parsed_redirect = urllib.parse.urlparse(redirect_uri)
    redirect_host = (parsed_redirect.hostname or "").lower()
    is_local_redirect = redirect_host in {"localhost", "127.0.0.1"}

    allow_prod_redirect_from_local = os.environ.get("HH_ALLOW_PROD_REDIRECT_FROM_LOCAL", "").strip().lower() in {"1", "true", "yes"}
    if is_local_request and not is_local_redirect and not allow_prod_redirect_from_local:
        return {
            "status": "error",
            "error": "Вы открыли админку локально, а HH_REDIRECT_URI указывает на прод. OAuth остановлен, чтобы не перекидывать на хостинг. Для локального теста используйте публичный локальный URL (ngrok/localtunnel) и зарегистрируйте его в HH, либо включите HH_ALLOW_PROD_REDIRECT_FROM_LOCAL=true."
        }

    state = secrets.token_urlsafe(32)

    state_key = f"hh_oauth_state:{client_id}:{hashlib.sha256(state.encode()).hexdigest()}"
    cache_service.set(
        state_key,
        {
            "client_id": client_id,
            "assistant_id": assistant_id,
            "redirect_uri": redirect_uri,
        },
        expire=600,
    )

    params = {
        "response_type": "code",
        "client_id": app_client_id,
        "redirect_uri": redirect_uri,
        "state": state,
    }
    auth_url = f"{HH_CONFIG.get('auth_url', 'https://hh.ru/oauth/authorize')}?{urllib.parse.urlencode(params)}"

    return {
        "status": "ok",
        "auth_url": auth_url,
        "redirect_uri": redirect_uri,
    }


@router.get("/oauth/callback", name="hh_oauth_callback")
async def hh_oauth_callback(request: Request, code: str = "", state: str = "", error: str = "", error_description: str = ""):
    if error:
        text = error_description or error or "OAuth ошибка"
        return HTMLResponse(content=f"<html><body><script>window.close && window.close();</script><p>Ошибка HeadHunter: {text}</p></body></html>", status_code=400)

    if not code or not state:
        return HTMLResponse(content="<html><body><p>Недостаточно параметров OAuth.</p></body></html>", status_code=400)

    state_hash = hashlib.sha256(state.encode()).hexdigest()
    state_info = None
    matched_key = None
    if cache_service.client:
        keys = cache_service.client.keys(f"{cache_service.prefix}hh_oauth_state:*:{state_hash}")
        if keys:
            matched_key = keys[0]
            state_info = cache_service.get(matched_key)

    if not state_info:
        log.warning("[HH_OAUTH] Invalid or expired state: %s", _masked_state(state))
        return HTMLResponse(content="<html><body><p>Состояние OAuth истекло. Повторите подключение.</p></body></html>", status_code=400)

    client_id = state_info.get("client_id")
    assistant_id = state_info.get("assistant_id")
    redirect_uri = state_info.get("redirect_uri")

    app_client_id = (HH_CONFIG.get("client_id") or "").strip()
    app_client_secret = (HH_CONFIG.get("client_secret") or "").strip()
    if not app_client_id or not app_client_secret:
        return HTMLResponse(content="<html><body><p>HH credentials не настроены на сервере.</p></body></html>", status_code=500)

    token_url = HH_CONFIG.get("token_url", "https://hh.ru/oauth/token")
    token_payload = {
        "grant_type": "authorization_code",
        "client_id": app_client_id,
        "client_secret": app_client_secret,
        "code": code,
        "redirect_uri": redirect_uri,
    }

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            token_resp = await client.post(token_url, data=token_payload)
            token_data = token_resp.json()
            if token_resp.status_code >= 400 or not token_data.get("access_token"):
                err = token_data.get("error_description") or token_data.get("error") or "Не удалось получить access_token"
                return HTMLResponse(content=f"<html><body><p>{err}</p></body></html>", status_code=400)

            access_token = token_data.get("access_token", "")
            refresh_token = token_data.get("refresh_token", "")
            expires_in = int(token_data.get("expires_in", 0) or 0)

            me_resp = await client.get(
                f"{HH_CONFIG.get('api_url', 'https://api.hh.ru')}/me",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            me_data = me_resp.json() if me_resp.headers.get("content-type", "").startswith("application/json") else {}
            account_name = me_data.get("email") or me_data.get("first_name") or "hh.ru"

        settings = await get_integration_settings(client_id, "hh", assistant_id=assistant_id)
        settings.update(
            {
                # OAuth stores authorization only. The admin confirms enabling
                # the channel with the integrations form after returning.
                "enabled": False,
                "connected": True,
                "access_token": access_token,
                "refresh_token": refresh_token,
                "expires_in": expires_in,
                "account_name": account_name,
                "redirect_uri": redirect_uri,
                "assistant_enabled": False,
                "autoreply_enabled": False,
                "autoreply_message": "",
            }
        )
        await save_integration_settings(client_id, "hh", settings, assistant_id=assistant_id)

        if matched_key:
            cache_service.delete(matched_key.replace(cache_service.prefix, ""))

        params = {"client_id": str(client_id or "")}
        if assistant_id:
            params["assistant_id"] = str(assistant_id)
        params["hh_authorized"] = "1"
        target = "/admin/integrations?" + urllib.parse.urlencode(params)
        target_json = json.dumps(target)
        return HTMLResponse(content=(
            "<html><body><script>"
            f"const target = {target_json};"
            "if (window.opener) { window.opener.location.href = target; window.close(); } "
            "else { window.location.replace(target); }"
            "</script><p>HeadHunter подключен. Возвращаемся в панель управления...</p></body></html>"
        ))
    except Exception as exc:
        log.error("[HH_OAUTH] Callback error: %s", exc)
        return HTMLResponse(content="<html><body><p>Ошибка подключения HeadHunter.</p></body></html>", status_code=500)


@router.post("/verify")
async def hh_verify(client_id: str, assistant_id: str | None = None, token_data: dict = Depends(verify_token)):
    """Проверяет, что сохранённый OAuth-токен HH ещё действителен."""
    if token_data["sub"] != client_id and token_data["sub"] != "admin":
        raise HTTPException(status_code=403, detail="Access denied")

    settings = await get_integration_settings(client_id, "hh", assistant_id=assistant_id)
    access_token = str(settings.get("access_token") or "").strip()
    if not access_token:
        return {"status": "error", "connected": False, "error": "HeadHunter не авторизован"}

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                f"{HH_CONFIG.get('api_url', 'https://api.hh.ru')}/me",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        if response.status_code == 200:
            data = response.json()
            return {
                "status": "ok",
                "connected": True,
                "account_name": data.get("email") or data.get("first_name") or settings.get("account_name", "hh.ru"),
            }
        log.warning("[HH_VERIFY] Token rejected for %s: HTTP %s", client_id, response.status_code)
    except Exception as error:
        log.warning("[HH_VERIFY] Request failed for %s: %s", client_id, error)
        return {"status": "error", "connected": False, "error": "Не удалось проверить доступ к hh.ru"}

    return {"status": "error", "connected": False, "error": "Авторизация HeadHunter истекла. Смените аккаунт hh.ru."}


@router.get("/status")
async def hh_status(client_id: str, assistant_id: str | None = None, token_data: dict = Depends(verify_token)):
    if token_data["sub"] != client_id and token_data["sub"] != "admin":
        raise HTTPException(status_code=403, detail="Access denied")

    settings = await get_integration_settings(client_id, "hh", assistant_id=assistant_id)
    connected = bool(settings.get("connected") or settings.get("access_token"))
    return {
        "status": "ok",
        "connected": connected,
        "enabled": bool(settings.get("enabled")),
        "account_name": settings.get("account_name", ""),
        "has_refresh_token": bool(settings.get("refresh_token")),
    }


@router.post("/disconnect")
async def hh_disconnect(client_id: str, assistant_id: str | None = None, token_data: dict = Depends(verify_token)):
    if token_data["sub"] != client_id and token_data["sub"] != "admin":
        raise HTTPException(status_code=403, detail="Access denied")

    settings = await get_integration_settings(client_id, "hh", assistant_id=assistant_id)
    settings.update(
        {
            "enabled": False,
            "connected": False,
            "access_token": "",
            "refresh_token": "",
            "expires_in": 0,
            "account_name": "",
        }
    )
    await save_integration_settings(client_id, "hh", settings, assistant_id=assistant_id)
    return {"status": "ok"}
