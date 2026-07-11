/**
 * Чистые утилиты для модуля диалогов
 */

/**
 * Загрузка аватара по email через серверный прокси
 */
export function loadEmailAvatar(wrapper, email, senderName, imgClass = 'avatar-img') {
    const cleanEmail = (email || '').toLowerCase().trim();
    if (!cleanEmail || !wrapper) {
        if (wrapper) {
            wrapper.innerHTML = createInitialsPlaceholder(senderName || '?');
            wrapper.style.display = 'block';
        }
        return;
    }

    const img = new Image();
    img.className = imgClass;
    img.style.display = 'block';

    img.onerror = () => {
        wrapper.innerHTML = createInitialsPlaceholder(senderName || cleanEmail.split('@')[0] || '?');
        wrapper.style.display = 'block';
    };

    img.onload = () => {
        // Проверяем, не является ли картинка слишком маленькой (заглушкой 1x1)
        if (img.naturalWidth > 1 && img.naturalHeight > 1) {
            wrapper.innerHTML = '';
            wrapper.appendChild(img);
            wrapper.style.display = 'block';
        } else {
            // Если это пиксель 1x1, оставляем инициалы
            wrapper.innerHTML = createInitialsPlaceholder(senderName || cleanEmail.split('@')[0] || '?');
        }
    };



    img.src = `/api/chat/proxy/email-avatar?email=${encodeURIComponent(cleanEmail)}`;
}

/**
 * Базовая функция для создания алертов (убираем дублирование)
 */
async function _baseAlert(templateId, data = {}, isPrompt = false) {
    return new Promise((resolve) => {
        const template = document.getElementById(templateId);
        if (!template) {
            if (isPrompt) resolve(prompt(data.text, data.placeholder));
            else resolve(confirm(data.text));
            return;
        }

        const clone = document.importNode(template.content, true);
        const overlay = clone.querySelector('.custom-alert-overlay');
        
        // Универсальный поиск элементов
        const titleEl = overlay.querySelector('.alert-title');
        const textEl = overlay.querySelector('.alert-text');
        const input = overlay.querySelector('#prompt-input') || overlay.querySelector('input');
        const confirmBtn = overlay.querySelector('#prompt-confirm') || overlay.querySelector('#confirm-yes');
        const cancelBtn = overlay.querySelector('#prompt-cancel') || overlay.querySelector('#confirm-cancel');

        // Добавляем подсказки, если они есть
        if (data.suggestions && isPrompt) {
            const suggestionsContainer = document.createElement('div');
            suggestionsContainer.className = 'alert-suggestions';
            data.suggestions.forEach(s => {
                const btn = document.createElement('button');
                btn.className = 'suggestion-btn';
                btn.textContent = s.label;
                btn.onclick = () => close(s); // Возвращаем объект подсказки целиком
                suggestionsContainer.appendChild(btn);
            });
            input.parentNode.insertBefore(suggestionsContainer, input.nextSibling);
        }

        if (data.title && titleEl) titleEl.textContent = data.title;
        if (data.text && textEl) textEl.textContent = data.text;
        if (data.placeholder && input) input.placeholder = data.placeholder;
        if (data.confirmText && confirmBtn) confirmBtn.textContent = data.confirmText;

        document.body.appendChild(overlay);

        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            if (input) input.focus();
        });

        document.body.style.overflow = 'hidden';

        const close = (result = null) => {
            overlay.style.opacity = '0';
            document.body.style.overflow = '';
            setTimeout(() => overlay.remove(), 300);
            resolve(result);
        };

        if (confirmBtn) {
            confirmBtn.onclick = () => {
                const val = isPrompt ? (input ? input.value.trim() : '') : true;
                if (!isPrompt || val) close(val);
            };
        }

        if (cancelBtn) cancelBtn.onclick = () => close(null);
        
        if (input && isPrompt) {
            input.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    const val = input.value.trim();
                    if (val) close(val);
                } else if (e.key === 'Escape') {
                    close(null);
                }
            };
        }

        overlay.onclick = (e) => { if (e.target === overlay) close(null); };
    });
}

/**
 * Показ кастомного confirm-алерта
 */
export function showConfirmAlert(data = {}) {
    return _baseAlert('tmpl-confirm-alert', data, false);
}

/**
 * Показ кастомного prompt-алерта
 */
export function showPromptAlert(data = {}) {
    return _baseAlert('tmpl-prompt-alert', data, true);
}

/**
 * Форматирование даты для визитки диалога
 */
export function formatDate(dateStr) {
    if (!dateStr) return 'Недавно';
    const date = new Date(dateStr);
    const now = new Date();
    if (date.toDateString() === now.toDateString())
        return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ', '
        + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function formatTime(timestamp) {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function translateIntent(intent) {
    const map = {
        'lead': 'Лид', 'application': 'Заявка', 'interest': 'Интерес', 'consultation': 'Вопрос', 'spam': 'Спам',
        'tech': 'Тест', 'new': 'Не прочитано', 'read': 'Прочитано', 'archive': 'Архив'
    };
    return map[intent] || 'Диалог';
}

export function createInitialsPlaceholder(name) {
    const initials = name.split(' ').filter(n => n).map(n => n[0]).join('').toUpperCase().substring(0, 2) || '?';
    const colors = ['#FF5722', '#2196F3', '#4CAF50', '#FFC107', '#9C27B0', '#00BCD4', '#E91E63', '#673AB7', '#3F51B5', '#009688'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const color = colors[Math.abs(hash) % colors.length];
    return `<div class="initials-placeholder" style="background:${color};">${initials}</div>`;
}

export function slugify(text) {
    if (!text) return 'chat';
    const cyrillicToLatin = {
        'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
        'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
        'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
        'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
    };
    return text.toString().toLowerCase().trim()
        .split('').map(char => cyrillicToLatin[char] || char).join('')
        .replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-')
        .replace(/^-+/, '').replace(/-+$/, '');
}
