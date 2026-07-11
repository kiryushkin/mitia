import os
import json
from datetime import datetime
from ..core.config import BASE_DIR, log

class SitemapService:
    @staticmethod
    async def generate_sitemap(client_id: str):
        """Генерирует sitemap.xml на основе проиндексированных страниц в БД."""
        from .db_service import SitePage, AsyncSessionLocal
        from sqlalchemy import select
        
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(SitePage.url, SitePage.updated_at)
                    .where(SitePage.client_id == client_id)
                )
                pages = result.all()
            
            if not pages:
                return None

            xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
            xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            
            for url, updated_at in pages:
                lastmod = updated_at.strftime('%Y-%m-%d') if updated_at else datetime.now().strftime('%Y-%m-%d')
                xml += f'  <url>\n    <loc>{url}</loc>\n    <lastmod>{lastmod}</lastmod>\n    <changefreq>daily</changefreq>\n  </url>\n'
            
            xml += '</urlset>'
            
            # Сохраняем файл в статическую папку, чтобы он был доступен по HTTP
            sitemap_path = os.path.join(BASE_DIR, "static", f"sitemap_{client_id}.xml")
            with open(sitemap_path, "w", encoding="utf-8") as f:
                f.write(xml)
            
            log.info(f"Sitemap generated for {client_id} at {sitemap_path}")
            return f"/api/chat/static/sitemap_{client_id}.xml"
        except Exception as e:
            log.error(f"Sitemap generation error: {e}")
            return None
