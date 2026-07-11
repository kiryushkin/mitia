import re
import logging
from typing import List

from ..core.config import log


def apply_data_guard(text: str, allowed_contacts: List[str]) -> str:
    """
    Железный программный фильтр (Data Guard): 
    Физически вырезает любые Email, Телефоны и Telegram, которых нет в админке.
    """
    if not text or len(text) < 10:
        return text

    # Если в тексте нет ни @, ни http, ни цифр - он чист, не тратим время
    if '@' not in text and 'http' not in text and not any(c.isdigit() for c in text):
        return text

    # 1. Подготавливаем чистые списки разрешенных данных
    allowed_emails = set()
    allowed_phones = set()
    allowed_tgs = set()
    allowed_wa = set()
    allowed_vk = set()
    allowed_social_urls = set()

    for c in allowed_contacts:
        if not c:
            continue
        c_low = str(c).lower().strip()
        if '@' in c_low:
            allowed_emails.add(c_low)
        elif 'wa.me' in c_low or 'whatsapp.com' in c_low:
            digits = re.sub(r"\D", "", c_low)
            if len(digits) >= 7:
                allowed_wa.add(digits)
        elif 'vk.me' in c_low or 'vk.com' in c_low:
            val = c_low.replace('https://', '').replace('http://', '').replace('vk.me/', '').replace('vk.com/', '').split('/')[0]
            allowed_vk.add(val)
        elif c_low.startswith('http'):
            allowed_social_urls.add(c_low.replace('https://', '').replace('http://', '').rstrip('/'))
        elif any(char.isdigit() for char in c_low) and '.' not in c_low:
            digits = re.sub(r"\D", "", c_low)
            if len(digits) >= 10:
                allowed_phones.add(digits)
        else:
            val = c_low.replace("@", "").replace("https://t.me/", "").replace("t.me/", "").split('/')[0]
            allowed_tgs.add(val)
            # Добавляем также вариант с префиксом, если это был юзернейм
            if not val.startswith('http'):
                allowed_tgs.add(val.lstrip('@'))

    # 2. Применяем фильтрацию к тексту
    # Регулярки для поиска контактов
    email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
    phone_pattern = r'(?:\+?\d[\d\s\-\(\)]{8,}\d)'
    tg_pattern = r'(?:t\.me\/|@)([a-zA-Z0-9_]{5,})'
    wa_pattern = r'(?:wa\.me\/|whatsapp\.com\/)(\d{7,15})'
    vk_pattern = r'(?:vk\.me\/|vk\.com\/)([a-zA-Z0-9_.]{3,32})'
    social_url_pattern = r'https?://(?:youtube\.com|instagram\.com|facebook\.com|ok\.ru|dzen\.ru|rutube\.ru)/[^\s]+'

    def filter_match(match, category):
        val = match.group(0)
        low_val = val.lower().strip()

        if category == 'email':
            if low_val in allowed_emails:
                return val
            log.warning(f"[DATA GUARD] Blocked Email: {val}")
            return "[email удален]"

        if category == 'phone':
            digits = re.sub(r"\D", "", val)
            # Если это похоже на ИНН (10-12 цифр) или счет (20 цифр), и это есть в разрешенных как есть - пропускаем
            if digits in allowed_phones or any(digits in ap for ap in allowed_phones):
                return val
            
            if len(digits) >= 10:
                # Проверяем разные форматы (с 7, с 8 или без)
                clean_digits = digits[-10:]
                is_allowed = any(ap.endswith(clean_digits) for ap in allowed_phones)
                if is_allowed:
                    return val
                log.warning(f"[DATA GUARD] Blocked Phone: {val}")
                return "[телефон удален]"
            return val

        if category == 'tg':
            # Извлекаем сам юзернейм из @username или t.me/username
            username = match.group(1).lower()
            if username in allowed_tgs or username.lstrip('@') in allowed_tgs:
                return val
            log.warning(f"[DATA GUARD] Blocked Telegram: {val}")
            return "[telegram удален]"

        if category == 'wa':
            digits = match.group(1)
            if digits in allowed_wa:
                return val
            log.warning(f"[DATA GUARD] Blocked WhatsApp: {val}")
            return "[whatsapp удален]"

        if category == 'vk':
            vk_id = match.group(1).lower()
            if vk_id in allowed_vk:
                return val
            log.warning(f"[DATA GUARD] Blocked VK: {val}")
            return "[vk удален]"

        if category == 'social':
            clean = low_val.replace('https://', '').replace('http://', '').rstrip('/')
            if any(clean in s for s in allowed_social_urls):
                return val
            log.warning(f"[DATA GUARD] Blocked Social: {val}")
            return "[ссылка удалена]"

        return val

    # Последовательно заменяем найденные контакты на безопасные версии
    text = re.sub(email_pattern, lambda m: filter_match(m, 'email'), text)
    text = re.sub(wa_pattern, lambda m: filter_match(m, 'wa'), text)
    text = re.sub(vk_pattern, lambda m: filter_match(m, 'vk'), text)
    text = re.sub(tg_pattern, lambda m: filter_match(m, 'tg'), text)
    text = re.sub(social_url_pattern, lambda m: filter_match(m, 'social'), text)
    
    # Телефоны последними, так как их регулярка самая широкая
    text = re.sub(phone_pattern, lambda m: filter_match(m, 'phone'), text)

    return text
