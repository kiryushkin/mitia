"""
Site Indexer — модуль индексации и BM25-поиска по контенту сайта.

- Краулит сайт (BFS) и сохраняет страницы в SQLite.
- Нормализует слова через морфологию (pymorphy3) для русского языка.
- Ранжирует BM25 (Okapi) — индустриальный стандарт.
- Поддерживает приоритеты страниц (по URL-паттернам) для бизнес-логики.
- Возвращает контекст для RAG (с источниками title+url).

Запуск как скрипт:
    python -m api.chat.site_indexer
"""
from __future__ import annotations

import os
import re
import json
import math
import hashlib
import logging
from collections import Counter, defaultdict
from typing import Optional
from urllib.parse import urljoin, urlparse

import html
import httpx
from bs4 import BeautifulSoup
import html2text
import asyncio
from datetime import datetime

from ..core.config import CERT_VERIFY, log
from .gigachat_service import get_gigachat_token
from .db_service import AsyncSessionLocal, SitePage, SiteTerm
from sqlalchemy import select, delete, func, insert, and_, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

def clean_text(text: str) -> str:
    """Очистка текста от HTML-сущностей и лишних пробелов."""
    if not text: return ""
    text = html.unescape(text)
    text = text.replace('\xa0', ' ')
    text = re.sub(r'\s+', ' ', text).strip()
    return text

try:
    import pymorphy3
    _morph = pymorphy3.MorphAnalyzer()
    HAS_MORPH = True
except Exception as e:
    log.warning(f"pymorphy3 не доступен ({e}). Морфология выключена.")
    _morph = None
    HAS_MORPH = False

RU_STOP_WORDS = frozenset({
    'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а',
    'то', 'все', 'она', 'так', 'его', 'но', 'да', 'ты', 'к', 'у', 'же',
    'вы', 'за', 'бы', 'по', 'только', 'ее', 'мне', 'было', 'вот', 'от',
    'меня', 'еще', 'нет', 'о', 'из', 'ему', 'теперь', 'когда', 'даже',
    'ну', 'вдруг', 'ли', 'если', 'уже', 'или', 'ни', 'быть', 'был', 'него',
    'до', 'вас', 'нибудь', 'опять', 'уж', 'вам', 'ведь', 'там', 'потом',
    'себя', 'ничего', 'ей', 'может', 'они', 'тут', 'где', 'есть', 'надо',
    'для', 'мы', 'тебя', 'их', 'чем', 'была', 'сам', 'чтоб', 'без', 'будто',
    'чего', 'раз', 'тоже', 'себе', 'под', 'будет', 'ж', 'тогда', 'кто', 'этот',
    'того', 'потому', 'этого', 'какой', 'совсем', 'ним', 'здесь', 'этом',
    'один', 'почти', 'мой', 'тем', 'чтобы', 'нее', 'кажется', 'сейчас',
    'были', 'куда', 'зачем', 'всех', 'никогда', 'можно', 'при', 'наконец',
    'два', 'об', 'другой', 'хоть', 'после', 'над', 'больше', 'тот', 'через',
    'эти', 'нас', 'про', 'всего', 'них', 'какая', 'много', 'разве', 'три',
    'эту', 'моя', 'впрочем', 'хорошо', 'свою', 'этой', 'перед', 'иногда',
    'лучше', 'чуть', 'том', 'нельзя', 'такой', 'им', 'более', 'всегда',
    'конечно', 'всю', 'между',
    'здравствуйте', 'привет', 'добрый', 'день', 'вечер', 'утро', 'подскажите',
    'пожалуйста', 'спасибо', 'благодарю', 'нету', 'просто', 'хотел', 'могу',
    'можете', 'сделать', 'какой', 'какая', 'какие', 'этого', 'того', 'этом',
    'быть', 'есть', 'будет', 'было', 'были', 'хочу', 'нужно', 'можно', 'надо',
    'стать', 'свой', 'весь', 'самый', 'очень', 'много', 'мало', 'больше', 'меньше',
    'вопрос', 'ответ', 'сказать', 'говорить', 'знать', 'понимать', 'думать',
    'хотеть', 'делать', 'взять', 'давать', 'идти', 'прийти', 'человек', 'время',
    'дело', 'жизнь', 'деньги', 'работа', 'слово', 'место', 'лицо', 'глаз', 'рука',
    'раз', 'год', 'новый', 'старый', 'хороший', 'плохой', 'нужный', 'должен',
    'просто', 'сразу', 'опять', 'снова', 'совсем', 'почти', 'вдруг', 'вместе',
    'потом', 'тогда', 'сейчас', 'здесь', 'там', 'тут', 'куда', 'откуда', 'зачем',
    'почему', 'как', 'что', 'кто', 'чей', 'какой', 'который', 'такой', 'этот',
    'тот', 'каждый', 'любой', 'иной', 'другой', 'весь', 'все', 'всё', 'всех',
    'ничего', 'никто', 'никакой', 'ничей', 'некий', 'некоторый', 'несколько',
    'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be',
    'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'this', 'that',
})


WORD_RE = re.compile(r'[а-яёa-z0-9]{2,}', re.IGNORECASE)


def normalize_word(word: str) -> str:
    """Лемматизация (если доступна). Иначе — нижний регистр."""
    w = word.lower()
    if HAS_MORPH and re.search(r'[а-яё]', w):
        try:
            return _morph.parse(w)[0].normal_form
        except Exception:
            return w
    return w


def tokenize(text: str) -> list[str]:
    """Извлекает нормализованные токены без стоп-слов."""
    tokens = []
    for raw in WORD_RE.findall(text or ''):
        norm = normalize_word(raw)
        if norm and norm not in RU_STOP_WORDS and len(norm) > 1:
            tokens.append(norm)
    return tokens

class SiteIndexer:
    """Индексатор сайта с BM25-ранжированием."""

    BM25_K1 = 1.5
    BM25_B = 0.75

    DEFAULT_PRIORITIES: list[tuple[str, float]] = [
        (r'/offer',     1.5),
        (r'/services',  1.5),
        (r'/price',     1.4),
        (r'/portfolio', 1.3),
        (r'/about',     1.2),
        (r'/$',         1.2),
        (r'/privacy',   0.5),
    ]

    def __init__(self, base_url: str, client_id: str,
                 priorities: Optional[list] = None, request_timeout: int = 15,
                 auth_headers: Optional[dict] = None):
        self.base_url = base_url.rstrip('/')
        self.client_id = client_id
        self.priorities = priorities or self.DEFAULT_PRIORITIES
        self.request_timeout = request_timeout
        
        # Стандартные заголовки браузера для обхода блокировок
        self.auth_headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        }
        if auth_headers:
            self.auth_headers.update(auth_headers)

        self.h = html2text.HTML2Text()

        self.h.ignore_links = True
        self.h.ignore_images = False
        self.h.body_width = 0

    async def _parse_sitemap(self) -> set[str]:
        """Ищет и парсит sitemap.xml сайта."""
        urls = set()
        sitemap_url = f"{self.base_url}/sitemap.xml"
        try:
            async with httpx.AsyncClient(
                verify=False, 
                headers=self.auth_headers,
                follow_redirects=True
            ) as client:
                r = await client.get(sitemap_url, timeout=self.request_timeout)
                if r.status_code == 200:
                    # Простой поиск URL через регулярку
                    found = re.findall(r'<loc>(https?://[^<]+)</loc>', r.text)
                    for u in found:
                        urls.add(u.strip())
        except Exception as e:
            log.warning(f"Sitemap parse error for {sitemap_url}: {e}")
        return urls

    async def full_index(self, max_pages: int = 200):
        """Глубокая рекурсивная индексация сайта."""
        log.info(f"Начало глубокой индексации для {self.base_url}")
        
        to_visit = {self.base_url, self.base_url + '/'}

        # Добавляем типичные пути, которые могут быть не связаны ссылками
        common_paths = ['/docs', '/about', '/contacts', '/faq', '/pricing', '/docs.html']
        for p in common_paths:
            to_visit.add(urljoin(self.base_url + '/', p))

        visited = set()
        count = 0

        # 1. Пытаемся найти sitemap
        sitemap_urls = await self._parse_sitemap()
        if sitemap_urls:
            log.info(f"Найдено {len(sitemap_urls)} URL в sitemap.xml")
            to_visit.update(sitemap_urls)

        while to_visit and count < max_pages:
            url = to_visit.pop()
            # Нормализуем URL (убираем слеш в конце для сравнения)
            norm_url = url.rstrip('/')
            if norm_url in visited: continue
            
            # Проверяем домен и исключаем технические пути
            parsed = urlparse(url)
            path = parsed.path.lower()
            if parsed.netloc and parsed.netloc != urlparse(self.base_url).netloc:
                continue
            
            # Исключаем документацию API и статику
            exclude_paths = ['/docs', '/redoc', '/openapi.json', '/favicon.ico']
            if any(path.startswith(p) for p in exclude_paths):
                continue

            success = await self.index_page(url)
            visited.add(norm_url)
            
            if success:
                count += 1
                # Извлекаем новые ссылки для рекурсии
                new_links = await self._extract_links(url)
                for link in new_links:
                    if link.rstrip('/') not in visited:
                        to_visit.add(link)
            
            await asyncio.sleep(0.2)

        log.info(f"Индексация завершена. Всего страниц: {count}")
        
        # Очищаем векторный индекс, чтобы он пересобрался с новыми данными сайта
        try:
            from .vector_service import VectorService
            VectorService(self.client_id).clear()
        except:
            pass
            
        return count

    async def _extract_links(self, url: str) -> set[str]:
        """Извлекает все внутренние ссылки со страницы, включая скрытые в скриптах."""
        links = set()
        try:
            async with httpx.AsyncClient(
                verify=False, 
                headers=self.auth_headers,
                follow_redirects=True
            ) as client:
                r = await client.get(url, timeout=self.request_timeout)
                if r.status_code != 200: return links
                
                soup = BeautifulSoup(r.content, 'html.parser')
                
                # 1. Стандартные ссылки
                for a in soup.find_all('a', href=True):
                    href = a['href']
                    full_url = urljoin(url, href).split('#')[0].split('?')[0].rstrip('/')
                    if full_url.startswith(self.base_url):
                        if not any(full_url.lower().endswith(ext) for ext in ['.jpg', '.png', '.css', '.js', '.pdf', '.zip', '.webp']):
                            links.add(full_url)
                
                # 2. Поиск ссылок в скриптах (JSON-LD или просто строки)
                scripts = soup.find_all('script')
                for script in scripts:
                    if script.string:
                        # Ищем паттерны похожие на внутренние пути
                        path_matches = re.findall(r'["\'](/[a-z0-9/_-]+)["\']', script.string, re.I)
                        for path in path_matches:
                            full_url = urljoin(self.base_url, path)
                            if full_url.startswith(self.base_url):
                                links.add(full_url)
                                
        except Exception as e:
            log.error(f"Error extracting links from {url}: {e}")
        return links

    def _calc_priority(self, url: str) -> float:
        path = urlparse(url).path or '/'
        for pattern, weight in self.priorities:
            if re.search(pattern, path):
                return weight
        return 1.0

    def _content_hash(self, text: str) -> str:
        """Генерирует MD5 хеш контента."""
        return hashlib.md5(text.encode('utf-8')).hexdigest()

    async def _get_embedding(self, text: str) -> Optional[list[float]]:
        """Получает векторное представление текста через GigaChat API."""
        try:
            token = await get_gigachat_token()
            if not token: return None
            embed_url = "https://gigachat.devices.sberbank.ru/api/v1/embeddings"
            headers = {'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'}
            payload = {"model": "Embeddings", "input": [text[:2000]]}
            async with httpx.AsyncClient(verify=CERT_VERIFY) as client:
                r = await client.post(embed_url, headers=headers, json=payload, timeout=10.0)
                if r.status_code == 200: return r.json()['data'][0]['embedding']
        except Exception as e:
            log.error(f"Embedding Error: {e}")
        return None

    async def index_page(self, url: str, force_update: bool = False) -> bool:
        try:
            if not url.startswith('http'):
                url = urljoin(self.base_url, url)
            
            async with httpx.AsyncClient(
                verify=False, 
                headers=self.auth_headers, 
                follow_redirects=True
            ) as client:
                response = await client.get(url, timeout=self.request_timeout)
                if response.status_code == 401 or response.status_code == 403:
                    log.warning(f"Доступ запрещен (Auth required): {url}")
                response.raise_for_status()

            
            await asyncio.sleep(0.5)

            if 'text/html' not in response.headers.get('Content-Type', ''):
                return False

            if len(response.content) > 1024 * 1024:
                log.warning(f"  {url}: слишком большой файл, пропуск")
                return False

            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Улучшенный поиск заголовка
            title = ""
            if soup.title and soup.title.string:
                title = clean_text(soup.title.string)
            
            if not title:
                # Пробуем найти первый h1, h2 или h3
                h_tag = soup.find(['h1', 'h2', 'h3'])
                if h_tag:
                    title = clean_text(h_tag.get_text())
            
            if not title:
                # Если совсем ничего нет, берем имя файла из URL
                title = urlparse(url).path.split('/')[-1] or url
            
            desc_meta = soup.find('meta', attrs={'name': 'description'})
            description = clean_text((desc_meta.get('content') or '').strip() if desc_meta else '')

            media_data = []
            
            for img in soup.find_all('img'):
                src = img.get('src') or img.get('data-src') or img.get('data-original') or img.get('data-lazy-src')
                if src:
                    src = urljoin(url, src)
                    alt = clean_text(img.get('alt') or img.get('title') or '')
                    media_data.append(f"![{alt}]({src})")
            
            for video in soup.find_all(['video', 'iframe']):
                vsrc = video.get('src') or video.get('data-src')
                if vsrc:
                    vsrc = urljoin(url, vsrc)
                    if 'youtube.com' in vsrc or 'youtu.be' in vsrc or 'vimeo.com' in vsrc or vsrc.endswith(('.mp4', '.webm')):
                        media_data.append(f"[Видео]({vsrc})")

            scripts = soup.find_all('script')
            for script in scripts:
                if script.string:
                    img_matches = re.findall(r'["\'](https?://[^"\']+\.(?:jpg|jpeg|png|webp|gif|svg))["\']', script.string, re.I)
                    for m in img_matches:
                        media_data.append(f"![Изображение]({m})")

            media_text = "\n".join(list(set(media_data)))

            main_html = self._extract_main_content(soup)
            text = self.h.handle(main_html)
            
            text = clean_text(text)
            
            # Добавляем URL в начало текста, чтобы ИИ знал адрес страницы
            text = f"URL страницы: {url}\n\n{text}"
            
            if media_text:
                text += "\n\nМЕДИА-КОНТЕНТ НА СТРАНИЦЕ:\n" + media_text

            if not text:
                log.info(f"  {url}: пустой контент, пропуск")
                return False

            content_hash = self._content_hash(text)
            
            embedding = await self._get_embedding(text)

            async with AsyncSessionLocal() as db:
                result = await db.execute(select(SitePage.id, SitePage.content_hash).where(SitePage.url == url, SitePage.client_id == self.client_id))
                row = result.fetchone()
                
                if row and row[1] == content_hash and not force_update:
                    await db.execute(update(SitePage).where(SitePage.id == row[0]).values(updated_at=func.now()))
                    await db.commit()
                    log.info(f"  {url}: без изменений")
                    return True

                title_tokens = set(tokenize(title))
                doc_tokens = tokenize(text)
                tf = Counter(doc_tokens)
                priority = self._calc_priority(url)

                if row:
                    page_id = row[0]
                    await db.execute(
                        update(SitePage)
                        .where(SitePage.id == page_id)
                        .values(
                            title=title,
                            content=text[:8000],
                            content_hash=content_hash,
                            doc_length=len(doc_tokens),
                            priority=priority,
                            embedding=embedding,
                            updated_at=func.now()
                        )
                    )
                    await db.execute(delete(SiteTerm).where(SiteTerm.page_id == page_id))
                else:
                    new_page = SitePage(
                        client_id=self.client_id,
                        url=url,
                        title=title,
                        content=text[:8000],
                        content_hash=content_hash,
                        doc_length=len(doc_tokens),
                        priority=priority,
                        embedding=embedding
                    )
                    db.add(new_page)
                    await db.flush()
                    page_id = new_page.id

                if tf:
                    db.add_all([
                        SiteTerm(page_id=page_id, term=term, tf=freq, in_title=(term in title_tokens))
                        for term, freq in tf.items()
                    ])
                
                await db.commit()
                log.info(f"  {url}: проиндексировано ({len(tf)} уникальных слов)")
                return True

        except Exception as e:
            log.error(f"  Ошибка индексации {url}: {e}")
            return False

    async def fetch_sitemap_urls(self, sitemap_url: Optional[str] = None) -> list[dict]:
        """
        Читает sitemap.xml клиента (по умолчанию <site>/sitemap.xml).
        Поддерживает sitemap-индексы (вложенные sitemaps).
        Возвращает [{url, lastmod}].
        """
        if not sitemap_url:
            sitemap_url = urljoin(self.base_url + '/', 'sitemap.xml')

        try:
            async with httpx.AsyncClient(
                verify=False,
                headers=self.auth_headers,
                follow_redirects=True
            ) as client:
                resp = await client.get(sitemap_url, timeout=self.request_timeout)
                resp.raise_for_status()
                content = resp.content
        except Exception as e:
            log.warning(f"Не удалось загрузить sitemap {sitemap_url}: {e}")
            return []

        soup = BeautifulSoup(content, 'xml')
        urls: list[dict] = []

        sitemap_tags = soup.find_all('sitemap')
        if sitemap_tags:
            for s in sitemap_tags:
                loc = s.find('loc')
                if loc and loc.text:
                    urls.extend(await self.fetch_sitemap_urls(loc.text.strip()))
            return urls

        for u in soup.find_all('url'):
            loc = u.find('loc')
            if not loc or not loc.text:
                continue
            url_str = loc.text.strip()
            lastmod_tag = u.find('lastmod')
            lastmod = lastmod_tag.text.strip() if (lastmod_tag and lastmod_tag.text) else None
            urls.append({'url': url_str, 'lastmod': lastmod})

        log.info(f"Sitemap {sitemap_url}: найдено {len(urls)} URL")
        return urls

    async def sync_from_sitemap(self, sitemap_url: Optional[str] = None,
                          max_pages: int = 200,
                          remove_missing: bool = False) -> dict:
        """
        Умная до-индексация по sitemap:
        - Новые страницы → индексируем
        - Изменённые (по lastmod) → переиндексируем
        - Не изменённые → пропускаем (быстро)
        - Удалённые из sitemap → опционально удаляем (remove_missing=True)
        """
        sitemap_urls = await self.fetch_sitemap_urls(sitemap_url)
        if not sitemap_urls:
            return {'status': 'error', 'message': 'Sitemap пуст или недоступен',
                    'added': 0, 'updated': 0, 'skipped': 0, 'errors': 0}

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(SitePage.url, SitePage.updated_at).where(SitePage.client_id == self.client_id))
            rows = result.fetchall()
            existing = {row[0]: (row[1].isoformat() if row[1] else '') for row in rows}

        added = updated = skipped = errors = 0
        sitemap_set: set[str] = set()

        for entry in sitemap_urls[:max_pages]:
            url = entry['url'].split('#')[0].rstrip('/')
            sitemap_set.add(url)
            lastmod = entry.get('lastmod')

            if not url.startswith(self.base_url):
                skipped += 1
                continue
            if re.search(r'\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|webm|mp3)$', url, re.I):
                skipped += 1
                continue

            is_new = url not in existing
            need_update = False

            if not is_new and lastmod:
                try:
                    db_modified = existing[url] or ''
                    if lastmod[:10] > db_modified[:10]:
                        need_update = True
                except Exception:
                    need_update = True

            if is_new or need_update:
                ok = await self.index_page(url, force_update=need_update)
                if ok:
                    if is_new:
                        added += 1
                    else:
                        updated += 1
                else:
                    errors += 1
            else:
                skipped += 1

        removed = 0
        if remove_missing:
            for old_url in existing:
                if old_url not in sitemap_set:
                    if await self.remove_page(old_url):
                        removed += 1

        result = {
            'status': 'success',
            'sitemap_url': sitemap_url or urljoin(self.base_url + '/', 'sitemap.xml'),
            'total_in_sitemap': len(sitemap_urls),
            'added': added,
            'updated': updated,
            'skipped': skipped,
            'errors': errors,
        }
        if remove_missing:
            result['removed'] = removed

        log.info(f"Sync sitemap: +{added} новых, ~{updated} обновлено, "
                 f"{skipped} без изменений, {errors} ошибок")
        return result

    async def remove_page(self, url: str) -> bool:
        """Удаляет страницу из индекса (если её больше нет на сайте)."""
        url = url.split('#')[0].rstrip('/')
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    delete(SitePage).where(SitePage.url == url, SitePage.client_id == self.client_id)
                )
                await db.commit()
                return result.rowcount > 0
        except Exception as e:
            log.error(f"Ошибка удаления {url}: {e}")
            return False

    async def crawl_site(self, start_url: str = '/', max_pages: int = 50,
                   url_filter=None) -> int:
        """
        Простой BFS-краулер для обхода сайта (если нет sitemap).
        """
        queue = [start_url]
        visited = set()
        count = 0

        while queue and count < max_pages:
            url = queue.pop(0)
            if url in visited: continue
            visited.add(url)

            ok = await self.index_page(url)
            if ok:
                count += 1
                full_url = urljoin(self.base_url, url)
                try:
                    async with httpx.AsyncClient(verify=CERT_VERIFY) as client:
                        resp = await client.get(full_url, timeout=self.request_timeout)
                        if 'text/html' in resp.headers.get('Content-Type', ''):
                            soup = BeautifulSoup(resp.content, 'html.parser')
                            for a in soup.find_all('a', href=True):
                                link = a['href'].split('#')[0].rstrip('/')
                                if not link: continue
                                if link.startswith('/') or link.startswith(self.base_url):
                                    if url_filter and not re.search(url_filter, link):
                                        continue
                                    if link not in visited:
                                        queue.append(link)
                except: continue
        return count

    async def search(self, query: str, limit: int = 5, min_score: float = 0.1) -> list[dict]:
        """Поиск BM25 в PostgreSQL."""
        tokens = tokenize(query)
        if not tokens: return []

        async with AsyncSessionLocal() as db:
            stats = await db.execute(
                select(func.count(SitePage.id), func.avg(SitePage.doc_length))
                .where(SitePage.client_id == self.client_id)
            )
            n_docs, avg_dl = stats.fetchone()
            if not n_docs: return []
            avg_dl = float(avg_dl or 1.0)

            scores = defaultdict(float)
            for term in tokens:
                df_res = await db.execute(
                    select(func.count(SiteTerm.page_id))
                    .join(SitePage)
                    .where(SitePage.client_id == self.client_id, SiteTerm.term == term)
                )
                df = df_res.scalar() or 0
                if df == 0: continue
                
                idf = math.log((n_docs - df + 0.5) / (df + 0.5) + 1.0)
                
                tf_res = await db.execute(
                    select(SiteTerm.page_id, SiteTerm.tf, SitePage.doc_length, SitePage.priority, SiteTerm.in_title)
                    .join(SitePage)
                    .where(SitePage.client_id == self.client_id, SiteTerm.term == term)
                )
                
                for pid, tf, dl, priority, in_title in tf_res.all():
                    tf_boosted = tf * 2.0 if in_title else tf
                    score = idf * (tf_boosted * (self.BM25_K1 + 1)) / (tf_boosted + self.BM25_K1 * (1 - self.BM25_B + self.BM25_B * dl / avg_dl))
                    scores[pid] += score * priority

            if not scores: return []
            
            sorted_ids = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:limit]
            results = []
            
            for page_id, score in sorted_ids:
                if score < min_score: continue
                res = await db.execute(select(SitePage).where(SitePage.id == page_id))
                p = res.scalar_one_or_none()
                if p:
                    results.append({
                        'url': p.url,
                        'title': p.title,
                        'description': "",
                        'content': p.content,
                        'score': round(score, 3),
                        'snippet': await self._make_snippet(page_id, tokens)
                    })
            
            return results

    async def _make_snippet(self, page_id: int, query_tokens: list[str], max_len: int = 500) -> str:
        """Извлекает релевантный фрагмент из контента страницы, сохраняя изображения."""
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(SitePage.content).where(SitePage.id == page_id))
            content = result.scalar_one_or_none()
        
        if not content:
            return ''
        text = content
        
        images = re.findall(r'!\[.*?\]\(.*?\)', text)
        
        text_lower = text.lower()
        best_pos = -1
        for tok in query_tokens:
            stem = tok[:max(4, len(tok) - 2)]
            pos = text_lower.find(stem)
            if pos != -1 and (best_pos == -1 or pos < best_pos):
                best_pos = pos
        
        if best_pos == -1:
            snippet_text = text[:max_len].rstrip()
        else:
            start = max(0, best_pos - 100)
            end = min(len(text), start + max_len)
            snippet_text = text[start:end].strip()
            if start > 0: snippet_text = '…' + snippet_text
            if end < len(text): snippet_text += '…'

        if images:
            return "\n".join(images[:3]) + "\n\n" + snippet_text
        
        return snippet_text

    def _to_relative_url(self, url: str) -> str:
        """Превращает абсолютный URL в относительный, отрезая base_url."""
        if url.startswith(self.base_url):
            rel = url[len(self.base_url):]
            return rel if rel.startswith('/') else '/' + rel
        return url

    def get_context_for_query(self, query: str, max_chars: int = 1500,
                              max_sources: int = 4) -> str:
        """Возвращает контекст для RAG — текст для подмешивания в системный промпт."""
        results = self.search(query, limit=max_sources)
        if not results:
            return ''
        parts = []
        total = 0
        for r in results:
            rel_url = self._to_relative_url(r['url'])
            block = f"[{r['title']}]({rel_url})\n{r['snippet']}"
            if total + len(block) > max_chars:
                break
            parts.append(block)
            total += len(block)
        return '\n\n---\n\n'.join(parts)

    def _extract_main_content(self, soup: BeautifulSoup) -> str:
        """Удаляет лишние элементы и возвращает основной контент."""
        for el in soup.find_all(['script', 'style', 'noscript', 'nav', 'footer', 'header', 'aside']):
            el.decompose()
        main = (soup.find('main') or soup.find('article') or
                soup.find('div', class_=re.compile(r'content|main|post|article|page')))
        return str(main) if main else (str(soup.body) if soup.body else str(soup))

    async def crawl_site(self, max_pages: int = 100):
        """Рекурсивный обход сайта (fallback если нет sitemap)."""
        return await self.full_index(max_pages=max_pages)

    def get_sources_for_query(self, query: str, limit: int = 3) -> list[dict]:
        """Возвращает источники для отображения на фронте (карточки)."""
        results = self.search(query, limit=limit)
        return [{'title': r['title'], 'url': self._to_relative_url(r['url']), 'snippet': r['snippet']}
                for r in results]

    async def get_stats(self) -> dict:
        async with AsyncSessionLocal() as db:
            page_count = await db.execute(select(func.count(SitePage.id)).where(SitePage.client_id == self.client_id))
            term_count = await db.execute(select(func.count(func.distinct(SiteTerm.term))).join(SitePage).where(SitePage.client_id == self.client_id))
            last = await db.execute(select(func.max(SitePage.updated_at)).where(SitePage.client_id == self.client_id))
            
        return {
            'page_count': page_count.scalar() or 0,
            'section_count': page_count.scalar() or 0,
            'unique_words': term_count.scalar() or 0,
            'last_indexed': last.scalar(),
            'morphology': HAS_MORPH,
        }

def init_site_indexer(base_url: Optional[str] = None) -> SiteIndexer:
    """Глобальный индексер (legacy). Используй get_indexer_for_client() для мульти-клиента."""
    if not base_url:
        base_url = os.environ.get('SITE_URL', 'https://mitia.pro')
    return SiteIndexer(base_url, 'mitia_assistant')

_client_indexers: dict[str, SiteIndexer] = {}


def get_indexer_for_client(client_id: str, site_url: str) -> SiteIndexer:
    """
    Возвращает индексер для конкретного клиента.
    Кешируется в памяти.
    """
    if client_id in _client_indexers:
        return _client_indexers[client_id]

    indexer = SiteIndexer(site_url, client_id)
    _client_indexers[client_id] = indexer
    return indexer


def get_cached_indexer(client_id: str) -> Optional[SiteIndexer]:
    """Возвращает уже созданный индексер из кеша или None."""
    return _client_indexers.get(client_id)

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
    indexer = SiteIndexer('https://mitia.pro', 'mitia_assistant')
    print("Запуск краулера...")
    asyncio.run(indexer.full_index(max_pages=20))
    print("\nСтатистика:", asyncio.run(indexer.get_stats()))
    
    test_queries = ['контакты', 'услуги', 'цены', 'о компании']
    for q in test_queries:
        print(f"\n=== Поиск: {q} ===")
        results = asyncio.run(indexer.search(q, limit=3))
        for r in results:
            print(f"  [{round(r['score'], 2)}] {r['title']} — {r['url']}")

import asyncio
import concurrent.futures

async def run_indexer_async(client_id: str, base_url: str):
    """Асинхронная обертка для запуска индексатора в фоне."""
    try:
        indexer = get_indexer_for_client(client_id, base_url)
        await indexer.full_index(max_pages=100)
        log.info(f"Фоновая индексация для {client_id} завершена.")
    except Exception as e:
        log.error(f"Ошибка фоновой индексации для {client_id}: {e}")
