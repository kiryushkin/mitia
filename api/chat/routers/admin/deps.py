import os
from fastapi import Request, HTTPException
import jwt
from ...core.config import JWT_SECRET, JWT_ALGORITHM


async def verify_token(request: Request):
    """Проверка JWT токена или мастер-токена для доступа к админке."""
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    token = auth_header.split(' ')[1]

    MASTER_TOKEN = os.environ.get('SUPERADMIN_MASTER_TOKEN')
    if MASTER_TOKEN and token == MASTER_TOKEN:
        return {"sub": "mitia_assistant", "email": "assistant@mitia.pro", "role": "superadmin"}

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if not payload or 'sub' not in payload:
            raise HTTPException(status_code=401, detail="Invalid token payload")
        return payload
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
