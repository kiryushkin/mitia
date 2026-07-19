from fastapi import APIRouter, Depends, HTTPException

from .deps import verify_token
from ...services.notification_service import (
    list_notifications,
    mark_notification_read,
    mark_all_notifications_read,
    get_unread_notifications_count,
)

router = APIRouter()


@router.get("/notifications")
async def get_notifications(client_id: str, limit: int = 20, token_data: dict = Depends(verify_token)):
    if token_data["sub"] != client_id and token_data["sub"] != "admin":
        raise HTTPException(status_code=403, detail="Access denied")

    rows = await list_notifications(client_id, limit=limit, include_global=True)
    unread_count = await get_unread_notifications_count(client_id)
    return {
        "status": "success",
        "unread_count": unread_count,
        "items": [
            {
                "id": row.id,
                "client_id": row.client_id,
                "category": row.category,
                "type": row.type,
                "severity": row.severity,
                "title": row.title,
                "body": row.body,
                "source": row.source,
                "channel_scope": row.channel_scope,
                "action_url": row.action_url,
                "action_label": row.action_label,
                "is_read": bool(row.is_read),
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ]
    }


@router.post("/notifications/{notification_id}/read")
async def read_notification(notification_id: int, client_id: str, token_data: dict = Depends(verify_token)):
    if token_data["sub"] != client_id and token_data["sub"] != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    ok = await mark_notification_read(notification_id, client_id)
    return {"status": "success" if ok else "error"}


@router.post("/notifications/read-all")
async def read_all_notifications(client_id: str, token_data: dict = Depends(verify_token)):
    if token_data["sub"] != client_id and token_data["sub"] != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    count = await mark_all_notifications_read(client_id)
    return {"status": "success", "updated": count, "unread_count": 0}
