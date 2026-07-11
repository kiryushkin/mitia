#!/bin/bash

# Разрешаем дублирование библиотек OpenMP (нужно для FAISS на macOS)
export KMP_DUPLICATE_LIB_OK=TRUE

# Запускать строго из корня проекта (kiryushkin/)
cd "$(dirname "$0")"
export PYTHONPATH="$PWD"
# SUPERADMIN_MASTER_TOKEN загружается из .env (не хранится в репозитории)
# Сгенерируй новый: python3 -c "import secrets; print(secrets.token_urlsafe(32))"

# Убиваем запущенные ранее процессы на этих портах
echo "# Set UTF-8 encoding for Python
export PYTHONIOENCODING=utf-8
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

[*] Cleaning up ports..."
lsof -ti:5001,5002,5004,5005,5006,5007 | xargs kill -9 2>/dev/null

# Запуск тестов перед стартом серверов
echo "[*] Running health checks and tests..."
./venv/bin/python3 api/chat/tests/test_scenarios.py
if [ $? -ne 0 ]; then
    echo "[!] CRITICAL: Tests failed! Servers will not start."
    exit 1
fi
echo "[+] Tests passed successfully."

# Сборка чат-виджета
echo "[*] Building chat widget..."
(cd api/chat/widget_src && npm run build && cp ../static/dist/chat-widget.iife.js ../static/chat-widget-module.js)
if [ $? -ne 0 ]; then
    echo "[!] WARNING: Widget build failed!"
else
    echo "[+] Widget module built successfully."
fi

echo "[*] Starting all servers..."

# Запуск АСИНХРОННОГО сервера (FastAPI) на порту 5007
# Теперь это основной сервер для чата и админки
./venv/bin/python3 -m api.chat.main_async &
echo "[+] ASYNC SERVER (FastAPI) started on port 5007 (http://127.0.0.1:5007/api/chat/admin)"

echo "[!] All servers are running in background."


echo "[!] Main Site: http://127.0.0.1:5005"
echo "[!] To stop them, use: pkill -f python3"

# Оставляем скрипт активным, чтобы видеть логи (опционально)
wait
