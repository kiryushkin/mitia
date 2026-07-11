from fastapi import APIRouter, Request, HTTPException, Depends, BackgroundTasks
import asyncio
import os
from ..core.config import log
from .admin_router import verify_token
from ..services.site_indexer import get_indexer_for_client
from ..services.cache_service import cache_service

router = APIRouter(prefix="/api/chat/admin/index", tags=["indexing"])

INDEXING_STATUS = {}

async def run_indexing_task(client_id: str, site_url: str, auth_token: str = None):
    """Фоновая задача индексации сайта."""
    try:
        from datetime import datetime
        start_time = datetime.now()
        
        INDEXING_STATUS[client_id] = {"status": "running", "progress": 10, "message": "Запуск сканирования..."}
        
        cache_service.clear_pattern(f"ai_cache:{client_id}:*")
        
        # Определяем лимит страниц по тарифу
        from ..services.db_service import AsyncSessionLocal, User, SitePage, SiteTerm
        from sqlalchemy import select, delete
        from ..core.config import TARIFF_RULES
        
        max_pages = 50 
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(User).where(User.client_id == client_id))
            user = result.scalar_one_or_none()
            if user:
                tariff_info = TARIFF_RULES.get(user.tariff_name, TARIFF_RULES.get('start'))
                max_pages = tariff_info.get('max_index_pages', 50)
        
        # Формируем заголовки авторизации
        headers = {}
        if auth_token:
            headers["Authorization"] = f"Bearer {auth_token}"
        
        from ..services.site_indexer import SiteIndexer
        indexer = SiteIndexer(site_url, client_id, auth_headers=headers)
        
        # ШАГ 0: ПРОВЕРКА СМЕНЫ ДОМЕНА
        # Если домен изменился, очищаем старый индекс полностью
        from urllib.parse import urlparse
        new_domain = urlparse(site_url).netloc
        
        async with AsyncSessionLocal() as db:
            # Берем одну любую страницу из базы для проверки домена
            existing_page_res = await db.execute(
                select(SitePage.url).where(SitePage.client_id == client_id).limit(1)
            )
            existing_page_url = existing_page_res.scalar_one_or_none()
            
            if existing_page_url:
                old_domain = urlparse(existing_page_url).netloc
                if old_domain != new_domain:
                    log.info(f"Domain changed from {old_domain} to {new_domain}. Clearing old index.")
                    # Находим все ID страниц клиента
                    page_ids_res = await db.execute(select(SitePage.id).where(SitePage.client_id == client_id))
                    page_ids = [r[0] for r in page_ids_res.all()]
                    if page_ids:
                        await db.execute(delete(SiteTerm).where(SiteTerm.page_id.in_(page_ids)))
                        await db.execute(delete(SitePage).where(SitePage.client_id == client_id))
                        await db.commit()
        
        INDEXING_STATUS[client_id] = {"status": "running", "progress": 30, "message": f"Глубокий анализ страниц (лимит: {max_pages})..."}
        
        # Запускаем индексацию
        await indexer.full_index(max_pages=max_pages)
        
        # ШАГ 3: ОЧИСТКА УДАЛЕННЫХ СТРАНИЦ
        # Удаляем страницы, которые не обновились во время этого прохода (значит их больше нет на сайте)
        async with AsyncSessionLocal() as db:
            # Находим ID страниц, которые не были обновлены (updated_at остался старым)
            old_pages_res = await db.execute(
                select(SitePage.id).where(
                    SitePage.client_id == client_id,
                    SitePage.updated_at < start_time
                )
            )
            old_page_ids = [r[0] for r in old_pages_res.all()]
            
            if old_page_ids:
                log.info(f"Cleaning up {len(old_page_ids)} removed pages for {client_id}")
                # Удаляем термины и сами страницы
                await db.execute(delete(SiteTerm).where(SiteTerm.page_id.in_(old_page_ids)))
                await db.execute(delete(SitePage).where(SitePage.id.in_(old_page_ids)))
                await db.commit()
        
        INDEXING_STATUS[client_id] = {"status": "completed", "progress": 100, "message": "Индексация завершена успешно"}
        
        # Триггерим авто-синк, чтобы AutoIndexer сразу подхватил изменения
        try:
            from ..services.auto_indexer import get_auto_indexer
            auto_idx = get_auto_indexer()
            if auto_idx:
                await auto_idx.force_sync(client_id)
                log.info(f"Auto-sync triggered for {client_id} after manual indexing")
        except Exception as sync_err:
            log.error(f"Auto-sync trigger failed for {client_id}: {sync_err}")
    except Exception as e:
        log.error(f"Indexing error for {client_id}: {e}")
        INDEXING_STATUS[client_id] = {"status": "error", "message": str(e)}


@router.post("/start")
async def start_indexing(background_tasks: BackgroundTasks, client_id: str, request: Request, token_data: dict = Depends(verify_token)):
    """Запуск процесса индексации сайта клиента."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")
    
    data = await request.json()
    site_url = data.get('site_url')
    
    if not site_url:
        # Если URL не передан в запросе, пробуем взять его из конфига клиента
        from ..services.clients import get_client_config
        config = await get_client_config(client_id)
        site_url = config.raw.get('site_url') or config.raw.get('contacts', {}).get('website')
    
    if not site_url:
        return {"status": "error", "message": "URL сайта не указан ни в настройках индексации, ни в профиле"}

    # Получаем токен из текущего запроса, чтобы пробросить его в индексатор
    auth_header = request.headers.get('Authorization')
    token = auth_header.split(' ')[1] if auth_header and ' ' in auth_header else None

    background_tasks.add_task(run_indexing_task, client_id, site_url, token)
    return {"status": "success", "message": "Индексация запущена в фоновом режиме"}

@router.get("/status")
async def get_indexing_status(client_id: str, token_data: dict = Depends(verify_token)):
    """Получение текущего статуса индексации."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")
    
    status = INDEXING_STATUS.get(client_id, {"status": "idle", "message": "Индексация не запускалась"})
    return status

@router.get("/list")
async def list_indexed_pages(client_id: str, token_data: dict = Depends(verify_token)):
    """Получение списка проиндексированных страниц."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")
    
    from ..services.db_service import SitePage, AsyncSessionLocal
    from sqlalchemy import select
    
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(SitePage.id, SitePage.url, SitePage.title, SitePage.updated_at)
            .where(SitePage.client_id == client_id)
            .order_by(SitePage.updated_at.desc())
        )
        pages = result.all()
        
    return {
        "status": "success",
        "pages": [
            {
                "id": p.id, 
                "url": p.url, 
                "title": p.title or p.url, 
                "updated_at": p.updated_at.isoformat() if p.updated_at else None
            } for p in pages
        ]
    }

@router.delete("/page/{page_id}")
async def delete_indexed_page(page_id: int, client_id: str, token_data: dict = Depends(verify_token)):
    """Удаление конкретной страницы из индекса."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")
    
    from ..services.db_service import SitePage, SiteTerm, AsyncSessionLocal
    from sqlalchemy import delete
    
    async with AsyncSessionLocal() as db:
        # Сначала удаляем термины (связанные данные)
        await db.execute(delete(SiteTerm).where(SiteTerm.page_id == page_id))
        # Затем саму страницу
        await db.execute(delete(SitePage).where(SitePage.id == page_id, SitePage.client_id == client_id))
        await db.commit()
        
    return {"status": "success", "message": "Страница удалена"}

@router.delete("/clear")
async def clear_index(client_id: str, token_data: dict = Depends(verify_token)):
    """Полная очистка индекса клиента."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")
    
    from ..services.db_service import SitePage, SiteTerm, AsyncSessionLocal
    from sqlalchemy import delete, select
    
    async with AsyncSessionLocal() as db:
        # Находим все ID страниц клиента
        page_ids_res = await db.execute(select(SitePage.id).where(SitePage.client_id == client_id))
        page_ids = [r[0] for r in page_ids_res.all()]
        
        if page_ids:
            await db.execute(delete(SiteTerm).where(SiteTerm.page_id.in_(page_ids)))
            await db.execute(delete(SitePage).where(SitePage.client_id == client_id))
            await db.commit()
            
    # Очищаем кэш ответов ИИ, так как база знаний изменилась
    cache_service.clear_pattern(f"ai_cache:{client_id}:*")
    return {"status": "success", "message": "Индекс полностью очищен"}
