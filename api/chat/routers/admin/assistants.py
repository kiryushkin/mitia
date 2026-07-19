from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from .deps import verify_token
from ...services.assistants_service import (
    list_assistants_payload,
    create_assistant,
    update_assistant,
    soft_delete_assistant,
    get_assistant_config,
    save_assistant_config,
    get_active_admin_assistant_id,
    set_active_admin_assistant_id,
)

router = APIRouter()


def _ensure_access(token_data: dict, client_id: str) -> None:
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")


@router.get("/assistants")
async def get_assistants_list(client_id: str, token_data: dict = Depends(verify_token)):
    _ensure_access(token_data, client_id)
    active_assistant_id = await get_active_admin_assistant_id(client_id)
    return {
        "status": "success",
        "assistants": await list_assistants_payload(client_id),
        "active_assistant_id": active_assistant_id,
    }


@router.post("/assistants")
async def create_assistant_endpoint(request: Request, token_data: dict = Depends(verify_token)):
    payload = await request.json()
    client_id = (payload.get('client_id') or '').strip()
    _ensure_access(token_data, client_id)
    try:
        created = await create_assistant(
            client_id=client_id,
            name=payload.get('name') or 'Новый ассистент',
            role=payload.get('role') or 'ИИ-ассистент',
            base_config=payload.get('config') or {},
        )
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"status": "error", "message": str(exc), "detail": str(exc)})
    active_assistant_id = await get_active_admin_assistant_id(client_id)
    return {"status": "success", "assistant": created, "active_assistant_id": active_assistant_id}


@router.patch("/assistants/{assistant_id}")
async def update_assistant_endpoint(assistant_id: str, request: Request, token_data: dict = Depends(verify_token)):
    payload = await request.json()
    client_id = (payload.get('client_id') or '').strip()
    _ensure_access(token_data, client_id)
    updated = await update_assistant(client_id, assistant_id, payload)
    return {"status": "success", "assistant": updated}


@router.delete("/assistants/{assistant_id}")
async def delete_assistant_endpoint(assistant_id: str, client_id: str, token_data: dict = Depends(verify_token)):
    _ensure_access(token_data, client_id)
    try:
        await soft_delete_assistant(client_id, assistant_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"status": "success"}


@router.get("/assistant-config")
async def get_assistant_config_endpoint(client_id: str, assistant_id: str, token_data: dict = Depends(verify_token)):
    _ensure_access(token_data, client_id)
    config = await get_assistant_config(client_id, assistant_id)
    return {"status": "success", "config": config, "assistant_id": assistant_id}


@router.post("/assistant-config")
async def save_assistant_config_endpoint(request: Request, token_data: dict = Depends(verify_token)):
    payload = await request.json()
    client_id = (payload.get('client_id') or '').strip()
    assistant_id = (payload.get('assistant_id') or '').strip()
    _ensure_access(token_data, client_id)
    if not assistant_id:
        raise HTTPException(status_code=400, detail="assistant_id is required")
    config_payload = payload.get('config') if isinstance(payload.get('config'), dict) else {
        k: v for k, v in payload.items() if k not in {'client_id', 'assistant_id'}
    }
    config = await save_assistant_config(client_id, assistant_id, config_payload)
    return {"status": "success", "config": config, "assistant_id": assistant_id}


@router.get("/assistants/active")
async def get_active_assistant_endpoint(client_id: str, token_data: dict = Depends(verify_token)):
    _ensure_access(token_data, client_id)
    assistant_id = await get_active_admin_assistant_id(client_id)
    return {"status": "success", "assistant_id": assistant_id}


@router.post("/assistants/active")
async def set_active_assistant_endpoint(request: Request, token_data: dict = Depends(verify_token)):
    payload = await request.json()
    client_id = (payload.get('client_id') or '').strip()
    assistant_id = (payload.get('assistant_id') or '').strip()
    _ensure_access(token_data, client_id)
    if not assistant_id:
        raise HTTPException(status_code=400, detail="assistant_id is required")
    active_id = await set_active_admin_assistant_id(client_id, assistant_id)
    return {"status": "success", "assistant_id": active_id}
