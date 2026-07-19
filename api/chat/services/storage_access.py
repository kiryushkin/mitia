import mimetypes
import os
from pathlib import Path
from typing import Optional

from fastapi import HTTPException
from fastapi.responses import FileResponse

from ..core.config import BASE_DIR


def _is_safe_within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except Exception:
        return False


def resolve_file_path_from_url(file_url: Optional[str]) -> Optional[Path]:
    if not file_url or not isinstance(file_url, str):
        return None

    clean_url = file_url.split("?")[0].split("#")[0].strip()
    base = Path(BASE_DIR)

    if "/api/chat/uploads/" in clean_url:
        tail = clean_url.split("/api/chat/uploads/", 1)[1]
        candidate = (base / "uploads" / tail).resolve()
        allowed_root = (base / "uploads").resolve()
        return candidate if _is_safe_within(candidate, allowed_root) else None

    if "/api/chat/img/" in clean_url:
        tail = clean_url.split("/api/chat/img/", 1)[1]
        candidate = (base / "img" / tail).resolve()
        allowed_root = (base / "img").resolve()
        return candidate if _is_safe_within(candidate, allowed_root) else None

    return None


def build_storage_file_response(file_url: str, file_name: Optional[str] = None) -> FileResponse:
    file_path = resolve_file_path_from_url(file_url)
    if not file_path:
        raise HTTPException(status_code=404, detail="File not found")

    if not os.path.exists(file_path) or not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    media_type, _ = mimetypes.guess_type(str(file_path))
    return FileResponse(
        path=str(file_path),
        filename=file_name or file_path.name,
        media_type=media_type or "application/octet-stream"
    )
