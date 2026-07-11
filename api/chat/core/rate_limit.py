import time
from fastapi import HTTPException, Request
from collections import defaultdict

class RateLimiter:
    def __init__(self, requests_limit: int, window_seconds: int, name: str = "default"):
        self.requests_limit = requests_limit
        self.window_seconds = window_seconds
        self.name = name
        # Запасное хранилище в памяти на случай недоступности Redis
        self.history = defaultdict(list)

    def _check_in_memory(self, client_ip: str) -> bool:
        """Подсчёт лимита в памяти процесса (fallback). True = лимит превышен."""
        now = time.time()
        self.history[client_ip] = [t for t in self.history[client_ip] if now - t < self.window_seconds]
        if len(self.history[client_ip]) >= self.requests_limit:
            return True
        self.history[client_ip].append(now)
        return False

    async def __call__(self, request: Request):
        client_ip = request.client.host

        # Основной путь: единый счётчик в Redis (работает для всех воркеров сразу).
        from ..services.cache_service import cache_service
        redis_key = f"ratelimit:{self.name}:{client_ip}"
        count = cache_service.incr_with_window(redis_key, self.window_seconds)

        if count is None:
            # Redis недоступен — откатываемся на счётчик в памяти, чтобы не уронить сайт
            exceeded = self._check_in_memory(client_ip)
        else:
            exceeded = count > self.requests_limit

        if exceeded:
            from .config import log
            log.warning(f"Rate limit exceeded for IP: {client_ip} (limiter: {self.name})")
            raise HTTPException(status_code=429, detail="Too Many Requests. Please try again later.")

# Лимит: 30 запросов в 10 секунд (увеличено для тестов)
ask_limiter = RateLimiter(requests_limit=30, window_seconds=10, name="ask")
# Лимит: 10 запросов в минуту для TTS
tts_limiter = RateLimiter(requests_limit=10, window_seconds=60, name="tts")
