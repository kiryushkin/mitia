"""Локальная расшифровка голосовых сообщений с помощью faster-whisper."""
import asyncio
import os
from pathlib import Path
from typing import Optional
from urllib.parse import unquote, urlparse

from ..core.config import BASE_DIR, log

_model = None
_model_lock = asyncio.Lock()


def _voice_path(local_url: str) -> Optional[Path]:
    """Возвращает безопасный путь к файлу из защищённого URL загрузки."""
    upload_prefix = "/api/chat/uploads/"
    path = urlparse(local_url).path
    if not path.startswith(upload_prefix):
        return None

    uploads_dir = (Path(BASE_DIR) / "uploads").resolve()
    candidate = (uploads_dir / unquote(path[len(upload_prefix):])).resolve()
    if uploads_dir not in candidate.parents or not candidate.is_file():
        return None
    return candidate


def _transcribe_sync(file_path: Path) -> str:
    global _model
    from faster_whisper import WhisperModel

    if _model is None:
        model_name = os.getenv("WHISPER_MODEL", "small")
        model_dir = os.getenv("WHISPER_MODEL_DIR", "/models/whisper")
        log.info("[STT] Loading local Whisper model %s on CPU", model_name)
        _model = WhisperModel(
            model_name,
            device="cpu",
            compute_type="int8",
            download_root=model_dir,
        )

    segments, _ = _model.transcribe(
        str(file_path),
        beam_size=5,
        vad_filter=True,
        condition_on_previous_text=False,
    )
    return " ".join(segment.text.strip() for segment in segments).strip()


async def transcribe_voice(local_url: str) -> Optional[str]:
    """Расшифровывает сохранённое голосовое и возвращает текст без ошибок наружу."""
    if os.getenv("WHISPER_ENABLED", "true").strip().lower() in {"0", "false", "no"}:
        return None

    file_path = _voice_path(local_url)
    if not file_path:
        log.warning("[STT] Refusing voice file outside uploads: %s", local_url)
        return None

    try:
        async with _model_lock:
            return await asyncio.to_thread(_transcribe_sync, file_path)
    except Exception as error:
        log.exception("[STT] Failed to transcribe %s: %s", file_path.name, error)
        return None
