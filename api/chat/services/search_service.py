import httpx
import re
from typing import Optional
from ..core.config import log


async def perform_search(query: str, api_key: str, folder_id: str) -> str:
    """
    Выполняет поисковый запрос через Yandex Search API (XML).

    Args:
        query: Поисковый запрос.
        api_key: API-ключ Яндекс.Поиска.
        folder_id: ID каталога (folder_id) Яндекс.Облака.

    Returns:
        Строка с результатами поиска в формате, понятном для ИИ.
        При ошибке возвращает сообщение об ошибке.
    """
    if not api_key or not folder_id:
        return "ОШИБКА: Ключи Yandex Cloud не настроены."

    url = "https://yandex.ru/search/xml"
    params = {
        "user": folder_id,
        "key": api_key,
        "query": query,
        "l10n": "ru",
        "sortby": "rlv",
        "filter": "none",
        "groupby": "attr=d.mode=deep.groups-on-page=5.docs-in-group=3",
        "maxpassages": 2,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.get(url, params=params)

            if res.status_code == 200:
                text = res.text
                # Убираем XML-теги, оставляем только текст
                clean = re.sub(r"<[^>]+>", " ", text)
                clean = re.sub(r"\s+", " ", clean).strip()

                if not clean or len(clean) < 20:
                    return "По вашему запросу ничего не найдено."

                # Ограничиваем длину, чтобы не перегружать контекст ИИ
                max_len = 3000
                if len(clean) > max_len:
                    clean = clean[:max_len] + "..."

                return f"Результаты поиска по запросу «{query}»:\n{clean}"

            elif res.status_code == 403:
                log.error(f"Yandex Search 403 Forbidden: {res.text[:200]}")
                return "ОШИБКА: Доступ к поиску запрещён (403). Проверьте API-ключ и folder_id."
            else:
                log.error(f"Yandex Search Error {res.status_code}: {res.text[:200]}")
                return f"ОШИБКА: Поиск временно недоступен (код {res.status_code})."

    except httpx.TimeoutException:
        log.error("Yandex Search timeout")
        return "ОШИБКА: Таймаут поискового запроса."
    except Exception as e:
        log.error(f"Yandex Search Exception: {e}")
        return "ОШИБКА: Не удалось выполнить поиск."
