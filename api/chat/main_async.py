from fastapi import FastAPI, Request, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
import os
import json
from typing import Dict, List, Optional
from jinja2 import Environment, FileSystemLoader

from .core.config import BASE_DIR, ROOT_DIR, log
from .routers import chat_router, admin_router, auth_router, superadmin_router, index_router, payment_router, ws_router, telegram_router, max_router, vk_router, avito_router, widget_router, webhook_router, email_router, proxy_router, hh_router

import sys
sys.path.append(ROOT_DIR)
try:
    from web_kiryushkin.router import router as kiryushkin_router
except ImportError:
    kiryushkin_router = None
from .services.db_service import AsyncSessionLocal, init_db
from fastapi import Depends
from .routers.admin_router import verify_token
from .services.clients import get_client_config, list_clients
from .services.auto_indexer import init_auto_indexer
from .services.billing_service import billing_service
from .services.site_indexer import get_indexer_for_client
from .services.telegram_service import run_polling
from .services.max_service import run_max_polling
from .services.avito_service import run_avito_polling
from .services.email_service import email_service
import asyncio

app = FastAPI(title="Mitya AI API", version="3.0.0")

@app.on_event("startup")
async def startup_event():
    """Действия при запуске сервера."""
    await init_db()
    
    try:
        init_auto_indexer(
            get_client_config_fn=get_client_config,
            list_clients_fn=list_clients,
            get_indexer_fn=get_indexer_for_client,
            check_interval_seconds=600,
            run_initial=True
        )
        log.info("AutoIndexer initialized and started")
    except Exception as e:
        log.error(f"Failed to init AutoIndexer: {e}")

    try:
        await billing_service.start()
        log.info("BillingService initialized and started")
    except Exception as e:
        log.error(f"Failed to init BillingService: {e}")

    try:
        asyncio.create_task(run_polling())
        log.info("Telegram Polling task created")
    except Exception as e:
        log.error(f"Failed to start Telegram Polling: {e}")

    try:
        asyncio.create_task(run_max_polling())
        log.info("MAX Polling task created")
    except Exception as e:
        log.error(f"Failed to start MAX Polling: {e}")

    try:
        await email_service.start()
        log.info("Email Service started")
    except Exception as e:
        log.error(f"Failed to start Email Service: {e}")

    try:
        asyncio.create_task(run_avito_polling())
        log.info("Avito Polling task created")
    except Exception as e:
        log.error(f"Failed to start Avito Polling: {e}")

    try:
        temp_dir = os.path.join(BASE_DIR, "uploads", "temp")
        if os.path.exists(temp_dir):
            import shutil
            for filename in os.listdir(temp_dir):
                file_path = os.path.join(temp_dir, filename)
                try:
                    if os.path.isfile(file_path) or os.path.islink(file_path):
                        os.unlink(file_path)
                    elif os.path.isdir(file_path):
                        shutil.rmtree(file_path)
                except Exception as e:
                    log.error(f"Failed to delete {file_path}. Reason: {e}")
            log.info("Temporary upload folder cleared.")
    except Exception as e:
        log.error(f"Error clearing temp folder: {e}")

_allowed_origins_env = os.environ.get("ALLOWED_ORIGINS", "").strip()
if _allowed_origins_env:
    _allowed_origins = [o.strip() for o in _allowed_origins_env.split(",") if o.strip()]
    _allow_credentials = True
else:
    _allowed_origins = []
    _allow_credentials = True
    log.warning("ALLOWED_ORIGINS is not set. Cross-origin requests are blocked by default.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Добавляем поддержку прокси-заголовков (X-Forwarded-For и т.д.)
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")

from fastapi.templating import Jinja2Templates
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

@app.get("/help", response_class=HTMLResponse)
async def help_page(request: Request):
    return templates.TemplateResponse(request=request, name="help.html")

app.include_router(ws_router.router)
app.include_router(chat_router.router)
app.include_router(admin_router.router)
app.include_router(auth_router.router)
app.include_router(superadmin_router.router)
app.include_router(index_router.router)
app.include_router(payment_router.router)
app.include_router(telegram_router.router)
app.include_router(max_router.router)
app.include_router(vk_router.router)
app.include_router(avito_router.router)
app.include_router(widget_router.router)
app.include_router(webhook_router.router)
app.include_router(email_router.router)
app.include_router(proxy_router.router)
app.include_router(hh_router.router)

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse(os.path.join(BASE_DIR, "img", "favicon.svg"))

app.mount("/api/chat/static/css", StaticFiles(directory=os.path.join(BASE_DIR, "static", "css"), html=False), name="css")
app.mount("/api/chat/static/js", StaticFiles(directory=os.path.join(BASE_DIR, "static", "js"), html=False), name="js")
app.mount("/api/chat/static/fonts", StaticFiles(directory=os.path.join(BASE_DIR, "static", "fonts"), html=False), name="fonts")
app.mount("/api/chat/static/img", StaticFiles(directory=os.path.join(BASE_DIR, "static", "img"), html=False), name="img")
app.mount("/api/chat/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")
app.mount("/api/chat/img", StaticFiles(directory=os.path.join(BASE_DIR, "img")), name="img")

@app.get("/api/chat/uploads/temp/{filename}")
async def get_temp_file(filename: str):
    """Доступ к временным файлам превью."""
    file_path = os.path.join(BASE_DIR, "uploads", "temp", filename)
    if os.path.exists(file_path):
        return FileResponse(file_path)
    raise HTTPException(status_code=404, detail="Temp file not found")

async def _is_valid_chat_session(client_id: str, session_id: str) -> bool:
    """Проверяет, что диалог с таким session_id реально принадлежит client_id.
    Используется для допуска к файлам чата по знанию session_id."""
    try:
        from sqlalchemy import select
        from .services.db_service import ChatSession
        async with AsyncSessionLocal() as db:
            res = await db.execute(
                select(ChatSession.id).where(
                    ChatSession.session_id == session_id,
                    ChatSession.client_id == client_id
                )
            )
            return res.scalar_one_or_none() is not None
    except Exception as e:
        log.error(f"Chat session validation error: {e}")
        return False


@app.get("/api/chat/uploads/{client_id}/{folder}/{filename}")
@app.get("/api/chat/uploads/{client_id}/{folder}/{subfolder}/{filename}")
async def get_protected_file(
    client_id: str, 
    folder: str, 
    filename: str, 
    subfolder: Optional[str] = None,
    request: Request = None
):
    """Защищенный доступ к файлам."""
    is_authorized = False
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        try:
            token = auth_header.split(' ')[1]
            from .core.config import JWT_SECRET, JWT_ALGORITHM
            import jwt
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            if payload.get('sub') == client_id or payload.get('role') == 'superadmin':
                is_authorized = True
        except Exception as e:
            log.warning(f"JWT auth failed for protected file access: {e}")

    public_folders = [
        "avatars", "configs", "temp", "img", 
        "widget", "header", "welcome", "window", 
        "bot", "user", "operator", "profile", "knowledge"
    ]
    if folder in public_folders:
        is_authorized = True

    if folder == "chat_files" and subfolder:
        session_id = subfolder
        if await _is_valid_chat_session(client_id, session_id):
            is_authorized = True

    if not is_authorized:
        raise HTTPException(status_code=403, detail="Access denied")

    if subfolder:
        file_path = os.path.join(BASE_DIR, "uploads", client_id, folder, subfolder, filename)
    else:
        file_path = os.path.join(BASE_DIR, "uploads", client_id, folder, filename)

    if os.path.exists(file_path):
        return FileResponse(file_path)
    raise HTTPException(status_code=404, detail="File not found")


if kiryushkin_router:
    app.include_router(kiryushkin_router)

@app.get("/")
async def root_page(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")

@app.get("/login")
async def login_page(request: Request):
    verify_success = request.query_params.get("verify_success", "false")
    verify_error = request.query_params.get("verify_error", "false")
    return templates.TemplateResponse(
        request=request,
        name="login.html",
        context={"verify_success": verify_success, "verify_error": verify_error, "auth_mode": "login"}
    )

@app.get("/register")
async def register_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="login.html",
        context={"verify_success": "false", "verify_error": "false", "auth_mode": "signup"}
    )

@app.get("/reset")
async def reset_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="login.html",
        context={"verify_success": "false", "verify_error": "false", "auth_mode": "reset"}
    )

@app.get("/verify-email")
async def verify_email_redirect(token: str):
    """Человекочитаемый редирект на API-эндпоинт верификации."""
    return RedirectResponse(url=f"/api/chat/verify-email?token={token}")

@app.get("/admin")
@app.get("/admin/{module_name}")
@app.get("/admin/dialogs/{slug}")
async def admin_page(request: Request, module_name: Optional[str] = None, slug: Optional[str] = None):
    if request.headers.get("X-Requested-With") == "XMLHttpRequest":
        if not module_name:
            return HTMLResponse("Select module")
        from jinja2 import Environment, FileSystemLoader
        env = Environment(loader=FileSystemLoader(os.path.join(BASE_DIR, "templates")))
        try:
            template = env.get_template(f"{module_name}.html")
            return HTMLResponse(template.render())
        except Exception:
            raise HTTPException(status_code=404, detail="Module template not found")

    from jinja2 import Environment, FileSystemLoader
    env = Environment(loader=FileSystemLoader(os.path.join(BASE_DIR, "templates")))
    template = env.get_template("admin.html")
    return HTMLResponse(template.render())

@app.get("/assistant")
async def assistant_redirect():
    return RedirectResponse(url="/admin/assistant")

@app.get("/settings")
async def settings_redirect():
    return RedirectResponse(url="/admin/settings")

@app.get("/profile")
async def profile_redirect():
    return RedirectResponse(url="/admin/profile")

@app.get("/dialogs")
async def dialogs_redirect():
    return RedirectResponse(url="/admin/dialogs")

@app.get("/integrations")
async def integrations_redirect():
    return RedirectResponse(url="/admin/integrations")

@app.get("/storage")
async def storage_redirect():
    return RedirectResponse(url="/admin/storage")

@app.get("/analytics")
async def analytics_redirect():
    return RedirectResponse(url="/admin/analytics")

@app.get("/dashboard")
async def dashboard_redirect():
    return RedirectResponse(url="/admin/dashboard")

@app.get("/admin-v2")
async def admin_v2_page(request: Request):
    qs = str(request.url.query)
    target = "/admin" + ("?" + qs if qs else "")
    return RedirectResponse(url=target)

@app.get("/api/chat/chat-widget.js")
async def get_widget_js(request: Request):
    file_name = "dist/chat-widget.iife.js"
    return FileResponse(
        os.path.join(BASE_DIR, "static", file_name),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )

@app.get("/api/chat/chat-widget.css")
async def get_widget_css():
    return FileResponse(os.path.join(BASE_DIR, "static", "css", "chat-widget.css"))

@app.get("/api/chat/img/{file_path:path}")
async def get_image(file_path: str):
    return FileResponse(os.path.join(BASE_DIR, "img", file_path))

@app.get("/sitemap.xml")
async def get_sitemap(request: Request):
    """Динамическая генерация sitemap.xml с красивыми ссылками."""
    from fastapi.responses import Response
    
    base_url = str(request.base_url).rstrip('/')
    urls = [
        "/", 
        "/help",
        "/login",
        "/register",
        "/reset",
        "/admin",
        "/assistant",
        "/settings",
        "/profile",
        "/dialogs",
        "/integrations",
        "/dashboard"
    ]
    
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    for url in sorted(urls):
        xml += f'  <url><loc>{base_url}{url}</loc><changefreq>daily</changefreq></url>\n'
    xml += '</urlset>'
    
    return Response(content=xml, media_type="application/xml")

@app.get("/robots.txt")
async def get_robots():
    return FileResponse(os.path.join(BASE_DIR, "static", "robots.txt"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5007)
