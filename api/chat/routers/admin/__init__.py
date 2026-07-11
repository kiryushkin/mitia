"""
Admin router package — разбит на модули по доменам:
- deps.py      — зависимости (verify_token)
- files.py     — загрузка/удаление файлов и аватаров
- config.py    — конфигурация клиента, интеграции
- analytics.py — аналитика, метрики, AI-рекомендации, баланс, тарифы, кэш
- sessions.py  — лиды, история, сессии, режим оператора
"""

from fastapi import APIRouter

from .files import router as files_router
from .config import router as config_router
from .analytics import router as analytics_router
from .sessions import router as sessions_router

router = APIRouter(prefix="/api/chat/admin", tags=["admin"])

router.include_router(files_router)
router.include_router(config_router)
router.include_router(analytics_router)
router.include_router(sessions_router)
