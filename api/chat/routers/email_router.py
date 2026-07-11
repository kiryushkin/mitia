from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..services.email_service import email_service
from ..routers.admin_router import verify_token
from ..services.integrations_service import get_integration_settings
import imaplib
import smtplib
import asyncio

router = APIRouter(prefix="/api/chat/email", tags=["email"])

def _get_provider_hint(email: str) -> str:
    """Возвращает подсказку для конкретного почтового провайдера."""
    domain = email.lower().split('@')[-1] if '@' in email else ''
    
    hints = {
        "gmail.com": "Для Gmail нужен пароль приложения.",
        "yandex.ru": "Для Яндекс.Почты нужен пароль приложения.",
        "ya.ru": "Для Яндекс.Почты нужен пароль приложения.",
        "mail.ru": "Для Mail.ru нужен пароль для внешних приложений. Включите 'Доступ по IMAP/SMTP' в настройках почты и используйте сгенерированный пароль.",
        "list.ru": "Для Mail.ru нужен пароль для внешних приложений. Включите 'Доступ по IMAP/SMTP' в настройках почты.",
        "bk.ru": "Для Mail.ru нужен пароль для внешних приложений. Включите 'Доступ по IMAP/SMTP' в настройках почты.",
        "inbox.ru": "Для Mail.ru нужен пароль для внешних приложений. Включите 'Доступ по IMAP/SMTP' в настройках почты.",
        "rambler.ru": "Для Rambler используйте полный email в качестве логина и пароль от аккаунта. Убедитесь, что IMAP/SMTP включён в настройках.",
        "lenta.ru": "Для Rambler используйте полный email в качестве логина и пароль от аккаунта.",
        "autorambler.ru": "Для Rambler используйте полный email в качестве логина и пароль от аккаунта.",
        "myrambler.ru": "Для Rambler используйте полный email в качестве логина и пароль от аккаунта.",
        "ro.ru": "Для Rambler используйте полный email в качестве логина и пароль от аккаунта.",
        "outlook.com": "Для Outlook.com используйте полный email как логин. Если включена двухфакторка — нужен пароль приложения.",
        "hotmail.com": "Для Hotmail используйте полный email как логин. Если включена двухфакторка — нужен пароль приложения.",
        "live.com": "Для Live.com используйте полный email как логин. Если включена двухфакторка — нужен пароль приложения.",
        "mail.com": "Для Mail.com используйте полный email как логин и пароль от аккаунта.",
        "icloud.com": "Для iCloud нужен пароль приложения.",
        "yahoo.com": "Для Yahoo нужен пароль приложения.",
        "zoho.com": "Для Zoho используйте полный email как логин и пароль от аккаунта.",
        "proton.me": "Для ProtonMail нужен пароль приложения (Bridge), а не основной пароль.",
        "protonmail.com": "Для ProtonMail нужен пароль приложения (Bridge), а не основной пароль.",
        "gmx.com": "Для GMX используйте полный email как логин и пароль от аккаунта.",
        "aol.com": "Для AOL используйте полный email как логин и пароль от аккаунта.",
        "yandex.com": "Для Яндекс.Почты нужен пароль приложения.",
    }
    
    for key, hint in hints.items():
        if key in domain:
            return hint
    return ""

def format_email_error(e: Exception, email: str = "") -> str:
    """Преобразует технические ошибки почты в понятные пользователю сообщения."""
    err_str = str(e)
    hint = _get_provider_hint(email)
    
    if "application-specific password required" in err_str.lower():
        return f"Требуется пароль приложения.{hint}"
    
    if "invalidsecondfactor" in err_str.lower():
        return f"Ошибка входа: требуется пароль приложения.{hint}"

    if isinstance(e, UnicodeEncodeError) or "ascii" in err_str.lower():
        return "Логин или пароль содержат недопустимые символы."
    
    if "authentication failed" in err_str.lower() or "login failure" in err_str.lower() or "invalid credentials" in err_str.lower() or "invalid login or password" in err_str.lower() or "authentication error" in err_str.lower():
        return f"Неверный логин или пароль.{hint}"

    if "username and password not accepted" in err_str.lower() or "badcredentials" in err_str.lower() or "gsmtp" in err_str.lower():
        return f"Gmail отклонил вход.{hint}"

    if "535" in err_str:
        return f"Почтовый сервер отклонил логин или пароль.{hint}"
    
    if "timed out" in err_str.lower() or "connection refused" in err_str.lower():
        return "Не удалось подключиться к серверу (тайм-аут). Проверьте адреса IMAP/SMTP."
    
    if "nodename nor servname provided" in err_str.lower() or "getaddrinfo failed" in err_str.lower():
        return "Сервер почты не найден. Проверьте адреса IMAP/SMTP."
    
    if "ssl" in err_str.lower():
        return "Ошибка защищенного соединения (SSL/TLS). Проверьте, что сервер использует правильный порт."

    clean_err = err_str.replace("b'", "'").replace("\'", "'").strip("()")
    return clean_err

class EmailCheckRequest(BaseModel):
    email_address: str
    email_password: str
    imap_server: str = None
    smtp_server: str = None

@router.post("/check-auth")
async def check_email_auth(data: EmailCheckRequest, user=Depends(verify_token)):
    """Проверяет корректность данных IMAP и SMTP."""
    email_addr = data.email_address
    password = data.email_password
    imap_server = data.imap_server or email_service._guess_imap(email_addr)
    smtp_server = data.smtp_server or email_service._guess_smtp(email_addr)

    if not imap_server or not smtp_server:
        raise HTTPException(status_code=400, detail="Не удалось определить серверы IMAP/SMTP")

    results = {}

    try:
        def _check_imap():
            mail = imaplib.IMAP4_SSL(imap_server, timeout=10)
            mail.login(email_addr, password)
            mail.logout()
            return True
        
        await asyncio.to_thread(_check_imap)
        results["imap"] = "ok"
    except Exception as e:
        results["imap"] = format_email_error(e, email_addr)

    try:
        def _check_smtp():
            try:
                server = smtplib.SMTP_SSL(smtp_server, 465, timeout=10)
                server.login(email_addr, password)
                server.quit()
            except:
                server = smtplib.SMTP(smtp_server, 587, timeout=10)
                server.starttls()
                server.login(email_addr, password)
                server.quit()
            return True

        await asyncio.to_thread(_check_smtp)
        results["smtp"] = "ok"
    except Exception as e:
        results["smtp"] = format_email_error(e, email_addr)

    if results.get("imap") == "ok" and results.get("smtp") == "ok":
        return {"status": "ok"}
    else:
        if results.get("imap") == results.get("smtp"):
            return {"status": "error", "error": results.get("imap")}
            
        error_msg = ""
        if results.get("imap") != "ok": error_msg += f"IMAP: {results['imap']} "
        if results.get("smtp") != "ok": error_msg += f"SMTP: {results['smtp']}"
        return {"status": "error", "error": error_msg.strip()}

@router.get("/status/{client_id}")
async def get_email_status(client_id: str, user=Depends(verify_token)):
    """Возвращает статус синхронизации почты."""
    from ..services.cache_service import cache_service
    sync_key = f"email_sync_done:{client_id}"
    is_synced = cache_service.get(sync_key)
    
    progress = email_service.sync_progress.get(client_id, {"status": "idle"})
    
    return {
        "is_synced": bool(is_synced),
        "status": progress.get("status", "ready" if is_synced else "idle"),
        "progress": progress
    }

class EmailSyncRequest(BaseModel):
    client_id: str
    mode: str = "sync_only"
    force: bool = False

@router.post("/sync")
async def start_email_sync(data: EmailSyncRequest, user=Depends(verify_token)):
    """Запускает синхронизацию истории."""
    from ..core.config import log
    log.info(f"[EMAIL_ROUTER] Start sync request for client: {data.client_id}, mode: {data.mode}")
    
    settings = await get_integration_settings(data.client_id, "email")
    if not settings:
        log.error(f"[EMAIL_ROUTER] Settings not found for {data.client_id}")
        raise HTTPException(status_code=400, detail="Настройки интеграции не найдены")
        
    if not settings.get("enabled"):
        log.error(f"[EMAIL_ROUTER] Email integration disabled for {data.client_id}")
        raise HTTPException(status_code=400, detail="Интеграция Email не включена")
    
    if not settings.get("email_address") or not settings.get("email_password"):
        log.error(f"[EMAIL_ROUTER] Email credentials missing for {data.client_id}")
        raise HTTPException(status_code=400, detail="Email или пароль не настроены")
    
    await email_service.sync_historical_emails(data.client_id, settings, mode=data.mode, force=data.force)
    return {"status": "ok", "message": "Синхронизация запущена"}

@router.get("/folders/{client_id}")
async def get_email_folders(client_id: str, user=Depends(verify_token)):
    """Возвращает список папок почтового ящика."""
    settings = await get_integration_settings(client_id, "email")
    if not settings:
        raise HTTPException(status_code=400, detail="Настройки не найдены")
    
    email_addr = settings.get("email_address")
    password = settings.get("email_password")
    imap_server = settings.get("imap_server") or email_service._guess_imap(email_addr)
    
    if not email_addr or not password or not imap_server:
        raise HTTPException(status_code=400, detail="Email не настроен")

    folders = await asyncio.to_thread(email_service._list_folders, email_addr, password, imap_server)
    return {"folders": folders}

