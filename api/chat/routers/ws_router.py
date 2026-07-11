from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import json
from typing import Dict, List
import logging
import jwt
from sqlalchemy import select

from ..services.db_service import AsyncSessionLocal, ChatSession

log = logging.getLogger("mitia_core")
router = APIRouter()

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
        self.client_sessions: Dict[str, List[str]] = {}  # client_id -> [session_id, ...]

    async def connect(self, websocket: WebSocket, client_id: str, session_id: str):
        await websocket.accept()
        if session_id not in self.active_connections:
            self.active_connections[session_id] = []
        self.active_connections[session_id].append(websocket)
        
        if client_id not in self.client_sessions:
            self.client_sessions[client_id] = []
        if session_id not in self.client_sessions[client_id]:
            self.client_sessions[client_id].append(session_id)
            
        log.info(f"WS: Connected session {session_id} for client {client_id}. Active: {len(self.active_connections[session_id])}")

    def disconnect(self, websocket: WebSocket, client_id: str, session_id: str):
        if session_id in self.active_connections:
            if websocket in self.active_connections[session_id]:
                self.active_connections[session_id].remove(websocket)
            if not self.active_connections[session_id]:
                del self.active_connections[session_id]
                # Удаляем сессию из списка клиента, если больше нет соединений для этой сессии
                if client_id in self.client_sessions and session_id in self.client_sessions[client_id]:
                    self.client_sessions[client_id].remove(session_id)
                    if not self.client_sessions[client_id]:
                        del self.client_sessions[client_id]
        log.info(f"WS: Disconnected session {session_id}")

    async def broadcast(self, session_id: str, message: dict, exclude: WebSocket = None):
        if session_id in self.active_connections:
            for connection in self.active_connections[session_id]:
                if connection != exclude:
                    try:
                        await connection.send_json(message)
                    except Exception as e:
                        log.error(f"WS Broadcast error: {e}")

    async def broadcast_to_client(self, client_id: str, message: dict):
        """Отправляет сообщение всем активным сессиям конкретного клиента."""
        if client_id in self.client_sessions:
            for session_id in self.client_sessions[client_id]:
                await self.broadcast(session_id, message)

manager = ConnectionManager()


async def _is_session_owned_or_new(client_id: str, session_id: str) -> bool:
    """Разрешаем новые сессии, но для существующих проверяем принадлежность клиенту."""
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(ChatSession.client_id).where(ChatSession.session_id == session_id)
        )
        owner = res.scalar_one_or_none()
        if owner is None:
            return True
        return owner == client_id


@router.websocket("/ws/chat/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    token = websocket.query_params.get("token")
    session_id = websocket.query_params.get("session_id") or token

    referer = websocket.headers.get('referer') or websocket.headers.get('origin')

    # Надёжный признак панели платформы: same-origin запрос (Origin == Host)
    from urllib.parse import urlparse
    host_header = (websocket.headers.get('host') or '').split(':')[0].replace('www.', '')
    origin_domain = ''
    if referer:
        try:
            origin_domain = urlparse(referer).netloc.split(':')[0].replace('www.', '')
        except Exception:
            origin_domain = ''

    is_same_origin = bool(origin_domain and host_header and origin_domain == host_header)
    is_admin_preview = (referer and '/admin' in referer) or is_same_origin
    is_admin_dialogs = bool(referer and '/admin/dialogs' in referer)

    # Проверка домена для WebSocket
    from ..services.clients import get_client_config
    config = await get_client_config(client_id, use_cache=False)
    allowed_origins = config.raw.get('allowed_origins', [])
    
    referer = websocket.headers.get('referer') or websocket.headers.get('origin')
    if not referer and is_admin_preview:
        # Для same-origin admin-preview без Referer пропускаем доменную проверку
        referer = f"http://{host_header}/admin"
    
    if not allowed_origins and not is_admin_preview:
        log.warning(f"WS: Connection rejected for {client_id} - no allowed domains configured")
        await websocket.close(code=4003)
        return

    if referer and not is_admin_preview:
        from urllib.parse import urlparse
        try:
            domain = urlparse(referer).netloc.replace('www.', '').split(':')[0]
            is_match = False
            for allowed_site in allowed_origins:
                allowed_domain = allowed_site.replace('http://', '').replace('https://', '').split('/')[0].replace('www.', '').split(':')[0]
                if domain == allowed_domain:
                    is_match = True
                    break

            if not is_match:
                log.warning(f"WS: Connection rejected for {client_id} - unauthorized domain: {domain}")
                await websocket.close(code=4003)
                return
        except Exception as e:
            log.warning(f"WS: Domain parse error for {client_id}: {e}")
            await websocket.close(code=4003)
            return

    # JWT обязателен только для операторской панели диалогов.
    # Для превью виджета на /admin используется chat token (ct-...), он не является JWT.
    if is_admin_dialogs:
        if not token:
            log.warning(f"WS: Admin dialogs rejected for {client_id} - missing token")
            await websocket.close(code=4001)
            return
        try:
            from ..core.config import JWT_SECRET, JWT_ALGORITHM
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            token_sub = payload.get("sub")
            token_role = payload.get("role")
            if token_role != "superadmin" and token_sub != client_id:
                log.warning(f"WS: Admin dialogs rejected for {client_id} - token subject mismatch")
                await websocket.close(code=4003)
                return
        except Exception as e:
            log.warning(f"WS: Admin dialogs rejected for {client_id} - invalid JWT: {e}")
            await websocket.close(code=4001)
            return

    if not session_id:
        log.warning(f"WS: Connection rejected for {client_id} - no session_id")
        await websocket.close(code=4000)
        return

    try:
        is_owned_or_new = await _is_session_owned_or_new(client_id, session_id)
    except Exception as e:
        log.error(f"WS: Session ownership check failed for {client_id}/{session_id}: {e}")
        await websocket.close(code=1011)
        return

    if not is_owned_or_new:
        log.warning(f"WS: Connection rejected for {client_id} - session does not belong to client")
        await websocket.close(code=4003)
        return

    await manager.connect(websocket, client_id, session_id)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            if message.get("type") == "typing":
                await manager.broadcast(
                    session_id, 
                    {
                        "type": "typing", 
                        "is_typing": message.get("is_typing", False),
                        "author_role": message.get("author_role", "operator")
                    },
                    exclude=websocket
                )
    except WebSocketDisconnect:
        manager.disconnect(websocket, client_id, session_id)
    except Exception as e:
        log.error(f"WS Loop Error: {e}")
        manager.disconnect(websocket, client_id, session_id)
