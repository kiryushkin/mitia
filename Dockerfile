FROM python:3.11-slim

# Установка системных зависимостей, Node.js и npm
RUN apt-get update && apt-get install -y \
    build-essential \
    libmagic1 \
    ffmpeg \
    libsm6 \
    libxext6 \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Копируем зависимости Python
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu

# Установка Playwright и браузера (опционально, для сложных сайтов)
RUN pip install playwright && playwright install-deps chromium && playwright install chromium

# Копируем весь проект
COPY . .

# Сборка виджета
RUN cd api/chat/widget_src && npm install && npm run build && cp ../static/dist/chat-widget.iife.js ../static/chat-widget-module.js

# Создаем папки для логов и загрузок, устанавливаем права
RUN mkdir -p api/chat/uploads api/chat/img api/chat/logs && \
    chmod -R 777 api/chat/uploads api/chat/img api/chat/logs

# Команда запуска через Gunicorn
CMD ["gunicorn", "api.chat.main_async:app", "-w", "1", "-k", "uvicorn.workers.UvicornWorker", "-b", "0.0.0.0:5007", "--timeout", "120"]
