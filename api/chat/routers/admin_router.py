"""
Admin router — реэкспорт из пакета admin/.
Сам код разнесён по модулям:
- admin/deps.py      — зависимости (verify_token)
- admin/files.py     — загрузка/удаление файлов и аватаров
- admin/config.py    — конфигурация клиента, интеграции
- admin/analytics.py — аналитика, метрики, AI-рекомендации, баланс, тарифы, кэш
- admin/sessions.py  — лиды, история, сессии, режим оператора
"""

from .admin import router
from .admin.deps import verify_token

__all__ = ["router", "verify_token"]