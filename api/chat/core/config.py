import os
import logging
from logging.handlers import RotatingFileHandler
from datetime import timedelta

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", ".."))

DATABASE_URL = os.environ.get('DATABASE_URL')
if not DATABASE_URL:
    POSTGRES_USER = os.environ.get('POSTGRES_USER', os.environ.get('USER', 'postgres'))
    POSTGRES_PASSWORD = os.environ.get('POSTGRES_PASSWORD', '')
    POSTGRES_HOST = os.environ.get('POSTGRES_HOST', 'localhost')
    POSTGRES_PORT = os.environ.get('POSTGRES_PORT', '5432')
    POSTGRES_DB = os.environ.get('POSTGRES_DB', 'mitia')
    DATABASE_URL = f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"

log_formatter = logging.Formatter('%(asctime)s [%(levelname)s] %(name)s: %(message)s')
log_file = os.path.join(BASE_DIR, 'mitia.log')

file_handler = RotatingFileHandler(log_file, maxBytes=5*1024*1024, backupCount=5, encoding='utf-8')
file_handler.setFormatter(log_formatter)
file_handler.setLevel(logging.INFO)

console_handler = logging.StreamHandler()
console_handler.setFormatter(log_formatter)
console_handler.setLevel(logging.INFO)

logging.basicConfig(
    level=logging.INFO,
    handlers=[file_handler, console_handler]
)
logging.getLogger('httpx').setLevel(logging.WARNING)
logging.getLogger('httpcore').setLevel(logging.WARNING)
log = logging.getLogger('mitia_core')

_env_path = os.path.join(ROOT_DIR, ".env")
if os.path.isfile(_env_path):
    with open(_env_path, 'r') as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                os.environ[k.strip()] = v.strip().strip('"').strip("'")

GIGACHAT_KEY = os.environ.get('GIGACHAT_KEY', '')
GIGACHAT_MODEL = os.environ.get('GIGACHAT_MODEL', 'GigaChat')
CERT_PATH = os.path.join(ROOT_DIR, "giga_certs.pem")
CERT_VERIFY = CERT_PATH if os.path.exists(CERT_PATH) else True

YANDEX_API_KEY = os.environ.get('YANDEX_API_KEY', '')
YANDEX_FOLDER_ID = os.environ.get('YANDEX_FOLDER_ID', '')
YANDEX_MODEL = os.environ.get('YANDEX_MODEL', 'yandexgpt/latest')
YANDEX_SEARCH_API_KEY = os.environ.get('YANDEX_SEARCH_API_KEY', '')
YANDEX_SEARCH_FOLDER_ID = os.environ.get('YANDEX_SEARCH_FOLDER_ID', '')

ADMIN_TOKEN = os.environ.get('ADMIN_TOKEN')
JWT_SECRET = os.environ.get('JWT_SECRET')
ENVIRONMENT = os.environ.get('ENVIRONMENT', os.environ.get('APP_ENV', 'development')).strip().lower()
IS_PRODUCTION = ENVIRONMENT in {'prod', 'production'}

if not JWT_SECRET:
    if IS_PRODUCTION:
        raise RuntimeError("JWT_SECRET must be set in production environment")
    if ADMIN_TOKEN:
        JWT_SECRET = ADMIN_TOKEN
    else:
        import secrets
        JWT_SECRET = secrets.token_hex(32)
        log.warning("JWT_SECRET не задан. Сгенерирован временный ключ (только для non-production).")

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24

import jwt
import hashlib
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional

def get_password_hash(password: str) -> str:
    """Хеширует пароль с использованием PBKDF2."""
    salt = secrets.token_hex(16)
    iterations = 100000
    hash_name = 'sha256'
    
    pwd_hash = hashlib.pbkdf2_hmac(
        hash_name,
        password.encode('utf-8'),
        salt.encode('utf-8'),
        iterations
    ).hex()
    
    return f"pbkdf2:{hash_name}:{iterations}${salt}${pwd_hash}"

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Проверяет пароль. Поддерживает как PBKDF2, так и старый SHA-256."""
    if not hashed_password:
        return False
        
    if ":" not in hashed_password and "$" not in hashed_password:
        old_hash = hashlib.sha256(plain_password.encode()).hexdigest()
        return secrets.compare_digest(old_hash, hashed_password)
    
    try:
        algorithm_part, salt, pwd_hash = hashed_password.split('$')
        _, hash_name, iterations = algorithm_part.split(':')
        
        new_hash = hashlib.pbkdf2_hmac(
            hash_name,
            plain_password.encode('utf-8'),
            salt.encode('utf-8'),
            int(iterations)
        ).hex()
        
        return secrets.compare_digest(new_hash, pwd_hash)
    except Exception:
        return False

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """Создает JWT токен для авторизации."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)

def deep_merge(base: dict, update: dict) -> dict:
    """
    Рекурсивно объединяет два словаря.
    Гарантирует, что пустые строки и значения из update перезаписывают base.
    """
    import copy
    result = copy.deepcopy(base)
    
    for key, value in update.items():
        if isinstance(value, dict) and key in result and isinstance(result[key], dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result

MAIL_CONFIG = {
    "user": os.environ.get('MAIL_USER', 'assistant@mitia.pro'),
    "password": os.environ.get('MAIL_PASSWORD', ''),
    "from": os.environ.get('MAIL_FROM', 'assistant@mitia.pro'),
    "reply_to": os.environ.get('MAIL_REPLY_TO', 'assistant@mitia.pro'),
    "server": os.environ.get('MAIL_SERVER', 'smtp.spaceweb.ru'),
    "port": int(os.environ.get('MAIL_PORT', 465))
}

TELEGRAM_CONFIG = {
    "token": os.environ.get('TELEGRAM_BOT_TOKEN'),
    "chat_id": os.environ.get('TELEGRAM_CHAT_ID'),
    "proxy": os.environ.get('TELEGRAM_PROXY'),
    "api_url": os.environ.get('TELEGRAM_API_URL', 'https://api.telegram.org')
}

PUBLIC_APP_URL = os.environ.get('PUBLIC_APP_URL', 'https://mitia.pro').rstrip('/')

YOOKASSA_CONFIG = {
    "shop_id": os.environ.get('YOOKASSA_SHOP_ID'),
    "secret_key": os.environ.get('YOOKASSA_SECRET_KEY')
}

MAX_CONFIG = {
    "bot_token": os.environ.get('MAX_BOT_TOKEN')
}
VK_CONFIG = {
    "token": os.environ.get('VK_TOKEN'),
    "group_id": os.environ.get('VK_GROUP_ID')
}

HH_CONFIG = {
    "client_id": os.environ.get('HH_CLIENT_ID', ''),
    "client_secret": os.environ.get('HH_CLIENT_SECRET', ''),
    "auth_url": os.environ.get('HH_AUTH_URL', 'https://hh.ru/oauth/authorize'),
    "token_url": os.environ.get('HH_TOKEN_URL', 'https://hh.ru/oauth/token'),
    "api_url": os.environ.get('HH_API_URL', 'https://api.hh.ru')
}

TARIFF_RULES = {
    'start': {
        'name': 'Старт',
        'price': 0,
        'year_price': 0,
        'base_limit': 30,
        'reset_period_days': 0,
        'context_limit': 10,
        'assistants_limit': 1,
        'operators_limit': 1,
        'model': 'GigaChat',
        'available_models': ['GigaChat', 'yandexgpt/latest'],
        'max_index_pages': 30,
        'storage_limit': 1 * 1024 * 1024 * 1024 # 1GB
    },
    'business': {
        'name': 'Бизнес',
        'price': 3900,
        'year_price': 39000,
        'base_limit': 1000,
        'reset_period_days': 30,
        'context_limit': 30,
        'assistants_limit': 5,
        'operators_limit': 1,
        'model': 'GigaChat',
        'available_models': ['GigaChat', 'yandexgpt/latest'],
        'max_index_pages': 500,
        'storage_limit': 5 * 1024 * 1024 * 1024 # 5GB
    },
    'neuro': {
        'name': 'Нейро',
        'price': 9900,
        'year_price': 99000,
        'base_limit': 5000,
        'reset_period_days': 30,
        'context_limit': 100,
        'assistants_limit': 20,
        'operators_limit': 1,
        'model': 'GigaChat',
        'available_models': ['GigaChat', 'yandexgpt/latest'],
        'max_index_pages': 5000,
        'storage_limit': 10 * 1024 * 1024 * 1024 # 10GB
    }
}

MESSAGE_PACK_RULES = [
    {
        'pack_id': 'pack-100',
        'label': '100 сообщений ассистента',
        'messages': 100,
        'price': 900,
        'is_recommended': False,
    },
    {
        'pack_id': 'pack-500',
        'label': '500 сообщений ассистента',
        'messages': 500,
        'price': 3900,
        'is_recommended': True,
    },
    {
        'pack_id': 'pack-1000',
        'label': '1000 сообщений ассистента',
        'messages': 1000,
        'price': 6900,
        'is_recommended': False,
    },
]

ASSISTANT_SLOTS_SOFT_CAP = 50
ASSISTANT_SLOTS_HARD_CAP = 100
ASSISTANT_SLOTS_AVAILABLE_ON_START = True
ASSISTANT_SLOT_PACK_RULES = [
    {
        'pack_id': 'assistants-plus-1',
        'label': '+1 ассистент',
        'slots': 1,
        'price': 1900,
        'is_recommended': False,
    },
    {
        'pack_id': 'assistants-plus-3',
        'label': '+3 ассистента',
        'slots': 3,
        'price': 4900,
        'is_recommended': True,
    },
    {
        'pack_id': 'assistants-plus-5',
        'label': '+5 ассистентов',
        'slots': 5,
        'price': 6900,
        'is_recommended': False,
    },
]

STORAGE_PACK_RULES = [
    {
        'pack_id': 'storage-plan-2gb',
        'label': 'Память +2 ГБ',
        'bytes': 2 * 1024 * 1024 * 1024,
        'monthly_price': 290,
        'is_recommended': False,
    },
    {
        'pack_id': 'storage-plan-10gb',
        'label': 'Память +10 ГБ',
        'bytes': 10 * 1024 * 1024 * 1024,
        'monthly_price': 990,
        'is_recommended': True,
    },
    {
        'pack_id': 'storage-plan-50gb',
        'label': 'Память +50 ГБ',
        'bytes': 50 * 1024 * 1024 * 1024,
        'monthly_price': 3490,
        'is_recommended': False,
    },
]


def get_message_pack(pack_id: str):
    for pack in MESSAGE_PACK_RULES:
        if str(pack.get('pack_id')) == str(pack_id):
            return pack
    return None


def get_assistant_slot_pack(pack_id: str):
    for pack in ASSISTANT_SLOT_PACK_RULES:
        if str(pack.get('pack_id')) == str(pack_id):
            return pack
    return None


def get_storage_pack(pack_id: str):
    for pack in STORAGE_PACK_RULES:
        if str(pack.get('pack_id')) == str(pack_id):
            return pack
    return None
