import redis
import json
import os
import logging
from typing import Optional, Any

log = logging.getLogger("mitia_core")

class CacheService:
    def __init__(self):
        self.prefix = "mitia:v1:"
        self.client = None
        
        redis_host = os.environ.get("REDIS_HOST", "localhost")
        redis_port = int(os.environ.get("REDIS_PORT", 6379))
        redis_db = int(os.environ.get("REDIS_DB", 0))
        redis_password = os.environ.get("REDIS_PASSWORD", None)

        try:
            self.client = redis.Redis(
                host=redis_host,
                port=redis_port,
                db=redis_db,
                password=redis_password,
                decode_responses=True
            )
            self.client.ping()
            log.info(f"Connected to Redis at {redis_host}:{redis_port}")
        except Exception as e:
            log.error(f"Failed to connect to Redis: {e}")
            self.client = None

    def _get_key(self, key: str) -> str:
        return f"{self.prefix}{key}"

    def set(self, key: str, value: Any, expire: Optional[int] = None):
        if not self.client: return
        try:
            serialized = json.dumps(value)
            self.client.set(self._get_key(key), serialized, ex=expire)
        except Exception as e:
            log.error(f"Redis set error: {e}")

    def get(self, key: str) -> Optional[Any]:
        if not self.client: return None
        try:
            data = self.client.get(key if key.startswith(self.prefix) else self._get_key(key))
            return json.loads(data) if data else None
        except Exception as e:
            log.error(f"Redis get error: {e}")
            return None

    def delete(self, key: str):
        if not self.client: return
        try:
            self.client.delete(self._get_key(key))
        except Exception as e:
            log.error(f"Redis delete error: {e}")

    def clear_pattern(self, pattern: str):
        """Очистка ключей по паттерну с учетом префикса."""
        if not self.client: return
        try:
            full_pattern = self._get_key(pattern)
            keys = self.client.keys(full_pattern)
            if keys:
                self.client.delete(*keys)
        except Exception as e:
            log.error(f"Redis clear_pattern error: {e}")

    def incr_with_window(self, key: str, window_seconds: int) -> Optional[int]:
        """Атомарно увеличивает счётчик и возвращает его текущее значение.
        При первом обращении устанавливает время жизни ключа (окно).
        Возвращает None, если Redis недоступен (вызывающий код должен сделать fallback)."""
        if not self.client:
            return None
        try:
            full_key = self._get_key(key)
            count = self.client.incr(full_key)
            # Устанавливаем TTL только при первом инкременте, чтобы окно не сбрасывалось
            if count == 1:
                self.client.expire(full_key, window_seconds)
            return count
        except Exception as e:
            log.error(f"Redis incr_with_window error: {e}")
            return None

# Глобальный экземпляр
cache_service = CacheService()
