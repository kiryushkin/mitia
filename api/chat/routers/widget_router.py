import re
import html
import httpx
from urllib.parse import urljoin, urlparse, unquote
from fastapi import APIRouter, Request, HTTPException, Depends
from ..core.config import log
from .admin_router import verify_token
from ..services.integrations_service import get_integration_settings, save_integration_settings

router = APIRouter(prefix="/api/chat/widget", tags=["widget"])

# Паттерны для поиска скрипта виджета в HTML
WIDGET_SCRIPT_PATTERNS = [
    re.compile(r'chat-widget\.js', re.IGNORECASE),
    re.compile(r'chat-widget\.iife\.js', re.IGNORECASE),
]


async def _fetch_page(url: str, timeout: float = 10.0) -> str | None:
    """Загружает HTML-код страницы."""
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, verify=False) as client:
            resp = await client.get(url, headers={
                "User-Agent": "Mozilla/5.0 (compatible; MitiaWidgetVerifier/1.0)"
            })
            if resp.status_code == 200:
                return resp.text
            log.warning(f"Page {url} returned status {resp.status_code}")
            return None
    except Exception as e:
        log.warning(f"Failed to fetch {url}: {e}")
        return None


def _find_widget_script(page_html: str, client_id: str = None, assistant_id: str = None) -> bool:
    """Проверяет код виджета с учетом client_id и выбранного assistant_id."""
    normalized_html = html.unescape(page_html or "")
    decoded_html = unquote(normalized_html)
    if not any(pattern.search(normalized_html) for pattern in WIDGET_SCRIPT_PATTERNS):
        return False
    if client_id and client_id not in decoded_html:
        return False
    if assistant_id and assistant_id not in decoded_html:
        return False
    return True


def _extract_links(html: str, base_url: str) -> list[str]:
    """Извлекает внутренние ссылки из HTML (до 20 штук)."""
    href_pattern = re.compile(r'href=["\']([^"\']+)["\']', re.IGNORECASE)
    base_domain = urlparse(base_url).netloc
    links = []
    seen = set()
    for match in href_pattern.finditer(html):
        href = match.group(1)
        if href.startswith('#') or href.startswith('javascript:') or href.startswith('mailto:') or href.startswith('tel:'):
            continue
        full_url = urljoin(base_url, href)
        parsed = urlparse(full_url)
        if parsed.netloc == base_domain and parsed.scheme in ('http', 'https'):
            clean = full_url.split('#')[0].split('?')[0]
            if clean not in seen:
                seen.add(clean)
                links.append(clean)
        if len(links) >= 20:
            break
    return links


@router.post("/setup")
async def widget_setup(request: Request, client_id: str, assistant_id: str | None = None, token_data: dict = Depends(verify_token)):
    """Сохранение настроек виджета (enabled, domain)."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    data = await request.json()
    await save_integration_settings(client_id, "widget", data, assistant_id=assistant_id)
    return {"status": "success"}


@router.post("/verify")
async def widget_verify(request: Request, client_id: str, assistant_id: str | None = None, token_data: dict = Depends(verify_token)):
    """Проверяет наличие скрипта виджета на сайте пользователя.
    
    Сначала проверяет главную страницу (домен из настроек).
    Если скрипт не найден, обходит до 20 внутренних страниц сайта.
    """
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    data = await request.json()
    domain = (data.get('domain') or '').strip()

    if not domain:
        return {"status": "error", "error": "Домен не указан"}

    # Нормализуем URL
    if not domain.startswith('http'):
        domain = 'https://' + domain
    domain = domain.rstrip('/')

    target_widget_id = assistant_id or client_id
    log.info(f"Widget verification started for {client_id}:{target_widget_id} at {domain}")

    # Шаг 1: проверяем главную страницу
    homepage_html = await _fetch_page(domain)
    if homepage_html and _find_widget_script(homepage_html, client_id, assistant_id):
        log.info(f"Widget script found on homepage: {domain}")
        return {
            "status": "ok",
            "found": True,
            "found_on": domain,
            "message": "Скрипт виджета найден на главной странице"
        }

    # Шаг 2: обходим внутренние страницы
    if homepage_html:
        links = _extract_links(homepage_html, domain)
        log.info(f"Checking {len(links)} internal pages for widget script")

        for link in links:
            page_html = await _fetch_page(link)
            if page_html and _find_widget_script(page_html, client_id, assistant_id):
                log.info(f"Widget script found on: {link}")
                return {
                    "status": "ok",
                    "found": True,
                    "found_on": link,
                    "message": f"Скрипт виджета найден на странице: {link}"
                }

    log.info(f"Widget script not found on {domain}")
    return {
        "status": "ok",
        "found": False,
        "message": "Скрипт виджета не найден на сайте."
    }
