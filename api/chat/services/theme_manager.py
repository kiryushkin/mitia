import os
import json
import copy
from ..core.config import BASE_DIR, log

# Путь к единому источнику правды
DEFAULTS_PATH = os.path.join(BASE_DIR, "core", "theme_defaults.json")

def load_theme_defaults():
    """Загружает дефолтные настройки из JSON-файла."""
    try:
        with open(DEFAULTS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        log.error(f"Error loading theme_defaults.json: {e}")
        return {}

# Загружаем один раз при импорте модуля
THEME_DEFAULTS = load_theme_defaults()
THEME_FIELDS = list(THEME_DEFAULTS.keys())

# Человекопонятные описания для ИИ
FIELD_DESCRIPTIONS = {
    # ВИДЖЕТ (ИКОНКА)
    "widget_draggable": "Разрешить перетаскивание иконки виджета",
    "widget_size": "Размер иконки виджета (например, '64px')",
    "widget_top": "Позиция иконки сверху в % (0-100)",
    "widget_left": "Позиция иконки слева в % (0-100)",
    "widget_radius": "Скругление иконки (например, '50%' для круга)",
    "widget_bg_color": "Цвет фона иконки (HEX или градиент)",
    "widget_bg_opacity": "Прозрачность фона иконки (0.0 - 1.0)",
    "widget_bg_blur": "Размытие фона иконки (например, '10px')",
    "widget_border_enabled": "Включить обводку иконки",
    "widget_border_color": "Цвет обводки иконки (HEX)",
    "widget_border_width": "Толщина обводки иконки (например, '2px')",
    "widget_border_opacity": "Прозрачность обводки иконки (0.0 - 1.0)",
    "widget_shadow_enabled": "Включить тень иконки",
    "widget_shadow_color": "Цвет тени иконки (HEX)",
    "widget_shadow_opacity": "Прозрачность тени иконки (0.0 - 1.0)",
    "widget_shadow_blur": "Размытие тени иконки (например, '30px')",
    "widget_effects_enabled": "Включить все визуальные эффекты иконки",
    "widget_dots_enabled": "Показывать точки на иконке",
    "widget_dots_color": "Цвет точек на иконке",
    "widget_dots_opacity": "Прозрачность точек на иконке",
    "widget_pulse_enabled": "Эффект пульсации вокруг иконки",
    "widget_pulse_color": "Цвет пульсации",
    "widget_pulse_opacity": "Прозрачность пульсации",
    "widget_pulse_size": "Размер (расширение) пульсации",
    "widget_pulse_speed": "Скорость пульсации (например, '1s')",
    "widget_glare_enabled": "Эффект блика на иконке",
    "widget_glare_color": "Цвет блика",
    "widget_glare_opacity": "Прозрачность блика",
    "widget_glare_size": "Размер блика в %",
    "widget_glare_speed": "Скорость движения блика",
    "widget_breathing_enabled": "Эффект дыхания (плавное изменение размера)",
    "widget_breathing_speed": "Скорость дыхания",
    "widget_breathing_scale": "Интенсивность увеличения при дыхании",

    # ОКНО ЧАТА
    "window_width": "Ширина окна чата (например, '400px' или '35%')",
    "window_height": "Высота окна чата (например, '600px' или '80%')",
    "window_radius": "Скругление углов окна чата (например, '32px')",
    "window_bg": "Цвет фона окна чата (HEX или градиент)",
    "window_bg_opacity": "Прозрачность фона окна (0.0 - 1.0)",
    "window_bg_blur": "Размытие фона окна (например, '15px')",
    "window_border_enabled": "Включить обводку окна",
    "window_border_color": "Цвет обводки окна",
    "window_border_width": "Толщина обводки окна",
    "window_shadow_enabled": "Включить тень окна",
    "window_shadow_color": "Цвет тени окна",
    "window_shadow_blur": "Размытие тени окна",

    # ПРИВЕТСТВИЕ (ОБЛАКО)
    "welcome_bubble_enabled": "Включить облако приветствия над иконкой",
    "welcome_bubble_text": "Текст приветствия в облаке",
    "welcome_bg": "Цвет фона облака приветствия (HEX)",
    "welcome_text_color": "Цвет текста в облаке (HEX)",
    "welcome_font_size": "Размер шрифта в облаке",
    "welcome_radius": "Скругление облака приветствия",
    "welcome_shadow_enabled": "Включить тень облака",

    # СООБЩЕНИЯ
    "msg_bot_bg": "Цвет фона сообщений бота (HEX)",
    "msg_bot_text_color": "Цвет текста бота (HEX)",
    "msg_bot_font_size": "Размер шрифта бота",
    "msg_user_bg": "Цвет фона сообщений пользователя (HEX)",
    "msg_user_text_color": "Цвет текста пользователя (HEX)",
    "msg_user_font_size": "Размер шрифта пользователя",
    "msg_link_color": "Цвет ссылок в тексте сообщений (HEX)",
    "chat_typewriter_enabled": "Эффект печатающейся машинки при ответе бота",
    "chat_typing_indicator_enabled": "Показывать индикатор 'Бот печатает...'",

    # КНОПКИ УПРАВЛЕНИЯ (В ПОЛЕ ВВОДА)
    "btn_send_bg_color": "Цвет фона кнопки отправки",
    "btn_send_icon_color": "Цвет иконки самолетика",
    "btn_send_radius": "Скругление кнопки отправки",
    "btn_stop_bg_color": "Цвет фона кнопки остановки генерации",
    "btn_stop_icon_color": "Цвет иконки квадрата (стоп)",
    "btn_mic_bg_color": "Цвет фона кнопки микрофона",
    "btn_mic_icon_color": "Цвет иконки микрофона",
    "btn_attach_enabled": "Показывать кнопку скрепки (вложения)",
    "btn_attach_bg_color": "Цвет фона кнопки вложений",
    "btn_attach_icon_color": "Цвет иконки скрепки",
    "btn_record_bg_color": "Цвет фона кнопки записи голоса (аватара)",
    "btn_record_icon_color": "Цвет иконки микрофона на аватаре",

    # ИНТЕРАКТИВНЫЕ КНОПКИ (ВАРИАНТЫ ОТВЕТОВ)
    "inline_buttons_enabled": "Показывать ли интерактивные кнопки в чате",
    "inline_btn_accent_bg": "Цвет фона основной кнопки (Да/Ок)",
    "inline_btn_accent_text": "Цвет текста основной кнопки",
    "inline_btn_neutral_bg": "Цвет фона второстепенной кнопки (Нет/Отмена)",
    "inline_btn_neutral_text": "Цвет текста второстепенной кнопки",
    "inline_btn_info_bg": "Цвет фона информационной кнопки (Выбор/Узнать)",
    "inline_btn_info_text": "Цвет текста информационной кнопки",
    "inline_btn_radius": "Общее скругление для всех интерактивных кнопок"
}


def generate_ai_schema():
    """Генерирует JSON-схему для ИИ на основе theme_defaults.json с умными описаниями."""
    properties = {}
    
    # Словари для автоматической сборки описаний
    prefixes = {
        "widget_": "Иконка виджета: ",
        "window_": "Окно чата: ",
        "welcome_": "Облако приветствия: ",
        "msg_bot_": "Сообщения бота: ",
        "msg_user_": "Сообщения пользователя: ",
        "msg_operator_": "Сообщения оператора: ",
        "inline_btn_accent_": "Кнопка 'Да': ",
        "inline_btn_neutral_": "Кнопка 'Нет': ",
        "inline_btn_info_": "Кнопка 'Выбор': ",
        "btn_send_": "Кнопка отправки: ",
        "btn_stop_": "Кнопка стоп: ",
        "btn_mic_": "Кнопка микрофона: ",
        "btn_attach_": "Кнопка вложений: ",
        "btn_record_": "Кнопка записи: ",
        "input_": "Поле ввода: ",
        "header_": "Шапка чата: ",
        "footer_": "Подвал чата: "
    }
    
    suffixes = {
        "_bg_color": "цвет фона (HEX)",
        "_bg": "цвет фона (HEX)",
        "_color": "основной цвет (HEX)",
        "_text_color": "цвет текста (HEX)",
        "_text": "цвет текста (HEX)",
        "_opacity": "прозрачность (0.0-1.0)",
        "_radius": "скругление углов",
        "_size": "размер",
        "_width": "ширина",
        "_height": "высота",
        "_border_enabled": "включить обводку",
        "_border_color": "цвет обводки",
        "_border_width": "толщина обводки",
        "_shadow_enabled": "включить тень",
        "_shadow_color": "цвет тени",
        "_shadow_blur": "размытие тени",
        "_enabled": "включить/выключить",
        "_font_family": "шрифт",
        "_font_size": "размер шрифта",
        "_font_weight": "толщина шрифта"
    }

    for key, default_value in THEME_DEFAULTS.items():
        # Если есть ручное описание — берем его
        description = FIELD_DESCRIPTIONS.get(key)
        
        # Если нет — пробуем собрать автоматически
        if not description:
            prefix_text = ""
            for p, txt in prefixes.items():
                if key.startswith(p):
                    prefix_text = txt
                    break
            
            suffix_text = ""
            for s, txt in suffixes.items():
                if key.endswith(s):
                    suffix_text = txt
                    break
            
            if prefix_text or suffix_text:
                description = f"{prefix_text}{suffix_text}".strip()
            else:
                description = f"Параметр дизайна: {key}"

        # Определяем тип данных
        if isinstance(default_value, bool):
            field_type = "boolean"
        elif isinstance(default_value, (int, float)):
            field_type = "number"
        else:
            field_type = "string"
            
        properties[key] = {
            "type": field_type,
            "description": description
        }
    return properties

def get_ai_theme_tools():
    """Возвращает описание инструмента для изменения дизайна."""
    return {
        "name": "update_widget_appearance",
        "description": "Изменить внешний вид виджета чата (цвета, прозрачность, размытие, размер, позиция, эффекты). Используй это, если владелец просит изменить дизайн.",
        "parameters": {
            "type": "object",
            "properties": generate_ai_schema()
        }
    }

def get_default_theme():
    """Возвращает полный золотой стандарт."""
    return copy.deepcopy(THEME_DEFAULTS)

def apply_theme_changes(new_theme, current_config, is_admin=False):
    """Применяет изменения темы к текущей конфигурации."""
    theme_update = {}
    
    if is_admin:
        if 'theme' not in current_config: current_config['theme'] = {}
        if 'bot_settings' not in current_config: current_config['bot_settings'] = {}

    for key, value in new_theme.items():
        if key in THEME_FIELDS:
            theme_update[key] = value
            if is_admin:
                current_config['theme'][key] = value
        elif key in ['tts_voice', 'enable_tts', 'enable_web_search']:
            if is_admin:
                current_config['bot_settings'][key] = value
    
    return theme_update
