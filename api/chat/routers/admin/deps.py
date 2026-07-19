import os
import hashlib
from datetime import timedelta
from fastapi import Request, HTTPException
import jwt
from ...core.config import JWT_SECRET, JWT_ALGORITHM
from ...services.cache_service import cache_service


SUPERADMIN_LOCK_PREFIX = "superadmin:lock:"
SUPERADMIN_UNLOCKED_PREFIX = "superadmin:unlocked:"
SUPERADMIN_ATTEMPTS_PREFIX = "superadmin:attempts:"
SUPERADMIN_LOCK_HOURS = 24
SUPERADMIN_UNLOCK_WINDOW_MINUTES = 15
SUPERADMIN_ATTEMPTS_LIMIT = 3
SUPERADMIN_ATTEMPTS_WINDOW_SECONDS = 24 * 60 * 60
SUPERADMIN_UNLOCK_CODE_ENV = "SUPERADMIN_UNLOCK_CODE"


def get_request_client_ip(request: Request) -> str:
    return (
        request.headers.get('x-forwarded-for', '').split(',')[0].strip()
        or (request.client.host if request.client else '')
        or 'unknown'
    )


def get_superadmin_request_fingerprint(request: Request) -> str:
    client_ip = get_request_client_ip(request)
    user_agent = (request.headers.get('user-agent') or '').strip()
    raw = f"{client_ip}|{user_agent}"
    digest = hashlib.sha256(raw.encode('utf-8')).hexdigest()[:24]
    return digest or 'unknown'


def get_superadmin_lock_scope(request: Request) -> str:
    master_token = (os.environ.get('SUPERADMIN_MASTER_TOKEN') or '').strip()
    raw = f"superadmin|{master_token}"
    digest = hashlib.sha256(raw.encode('utf-8')).hexdigest()[:24]
    return digest or 'unknown'


async def get_superadmin_access_state(request: Request) -> dict:
    client_ip = get_request_client_ip(request)
    fingerprint = get_superadmin_request_fingerprint(request)
    lock_scope = get_superadmin_lock_scope(request)
    lock_key = f"{SUPERADMIN_LOCK_PREFIX}{lock_scope}"
    unlock_key = f"{SUPERADMIN_UNLOCKED_PREFIX}{lock_scope}"
    attempts_key = f"{SUPERADMIN_ATTEMPTS_PREFIX}{lock_scope}"
    user_agent = (request.headers.get('user-agent') or '').strip()
    forwarded_for = (request.headers.get('x-forwarded-for') or '').strip()

    try:
        is_locked = bool(cache_service.get(lock_key))
    except Exception:
        is_locked = False

    try:
        is_unlocked = bool(cache_service.get(unlock_key))
    except Exception:
        is_unlocked = False

    try:
        attempts = int(cache_service.get(attempts_key) or 0)
    except Exception:
        attempts = 0

    attempts_remaining = max(SUPERADMIN_ATTEMPTS_LIMIT - attempts, 0)

    return {
        "client_ip": client_ip,
        "fingerprint": fingerprint,
        "lock_scope": lock_scope,
        "lock_key": lock_key,
        "unlock_key": unlock_key,
        "attempts_key": attempts_key,
        "is_locked": is_locked,
        "is_unlocked": is_unlocked,
        "requires_unlock_code": is_locked and not is_unlocked,
        "attempts": attempts,
        "attempts_limit": SUPERADMIN_ATTEMPTS_LIMIT,
        "attempts_remaining": attempts_remaining,
        "user_agent": user_agent,
        "forwarded_for": forwarded_for,
    }


async def verify_token(request: Request):
    """Проверка JWT токена или мастер-токена для доступа к админке."""
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    token = auth_header.split(' ')[1]
    is_superadmin_path = request.url.path.startswith('/api/chat/superadmin')
    access_state = await get_superadmin_access_state(request)
    lock_key = access_state["lock_key"]
    unlock_key = access_state["unlock_key"]
    is_locked = access_state["is_locked"]

    MASTER_TOKEN = os.environ.get('SUPERADMIN_MASTER_TOKEN')
    if MASTER_TOKEN and token == MASTER_TOKEN:
        is_unlocked = access_state["is_unlocked"]
        attempts = int(access_state.get("attempts") or 0)
        attempts_limit_reached = attempts >= SUPERADMIN_ATTEMPTS_LIMIT

        if is_locked or attempts_limit_reached:
            if not is_unlocked:
                raise HTTPException(status_code=429, detail="Superadmin login is blocked for 24 hours after failed attempts")

            try:
                cache_service.delete(unlock_key)
                cache_service.delete(lock_key)
                cache_service.delete(access_state["attempts_key"])
            except Exception:
                pass
        return {"sub": "admin", "email": "assistant@mitia.pro", "role": "superadmin"}

    if is_superadmin_path:
        try:
            attempts_key = access_state["attempts_key"]
            next_attempt = cache_service.incr_with_window(attempts_key, SUPERADMIN_ATTEMPTS_WINDOW_SECONDS)
            if next_attempt is not None:
                access_state["attempts"] = int(next_attempt)
                access_state["attempts_remaining"] = max(SUPERADMIN_ATTEMPTS_LIMIT - int(next_attempt), 0)
                if int(next_attempt) >= SUPERADMIN_ATTEMPTS_LIMIT:
                    cache_service.set(lock_key, '1', expire=SUPERADMIN_LOCK_HOURS * 60 * 60)
        except Exception:
            pass
        if is_locked or access_state.get("attempts", 0) >= SUPERADMIN_ATTEMPTS_LIMIT:
            try:
                cache_service.set(lock_key, '1', expire=SUPERADMIN_LOCK_HOURS * 60 * 60)
            except Exception:
                pass
            raise HTTPException(status_code=429, detail="Superadmin login is blocked for 24 hours after failed attempts")
        raise HTTPException(status_code=401, detail="Only SUPERADMIN_MASTER_TOKEN can access superadmin")

    if is_locked:
        raise HTTPException(status_code=429, detail="Superadmin login is blocked for 24 hours after a failed attempt")

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if not payload or 'sub' not in payload:
            raise HTTPException(status_code=401, detail="Invalid token payload")
        return payload
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
