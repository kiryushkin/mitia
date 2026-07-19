import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..routers.admin_router import verify_token
from ..services.email_service import email_service
import imaplib
import smtplib

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
