from fastapi import HTTPException, UploadFile


MAX_UPLOAD_FILE_SIZE = 5 * 1024 * 1024


async def read_upload_limited(
    file: UploadFile,
    max_size: int = MAX_UPLOAD_FILE_SIZE,
) -> bytes:
    """Читает не больше допустимого размера и отклоняет слишком большой файл."""
    content = await file.read(max_size + 1)
    if len(content) > max_size:
        raise HTTPException(
            status_code=413,
            detail=f"File is too large. Maximum size is {max_size // (1024 * 1024)} MB",
        )
    return content
