from typing import Optional

from fastapi import HTTPException


def normalize_client_id(client_id: Optional[str]) -> str:
    raw = str(client_id or "").strip()
    if not raw or raw == "default":
        return "mitia_assistant"
    return raw


def ensure_client_access(token_data: dict, client_id: Optional[str]) -> str:
    target_client_id = normalize_client_id(client_id)
    token_sub = normalize_client_id(token_data.get("sub"))

    if token_sub != "admin" and token_sub != target_client_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return target_client_id


def resolve_target_client_id(
    requested_client_id: Optional[str],
    token_data: dict,
    fallback_client_id: str = "mitia_assistant"
) -> str:
    token_sub = normalize_client_id(token_data.get("sub"))

    if token_sub == "admin":
        if requested_client_id:
            return normalize_client_id(requested_client_id)
        return normalize_client_id(fallback_client_id)

    if requested_client_id:
        requested = normalize_client_id(requested_client_id)
        if requested != token_sub:
            raise HTTPException(status_code=403, detail="Access denied")
        return requested

    return token_sub
