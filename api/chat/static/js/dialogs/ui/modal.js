/**
 * Модульный интерфейс чата — открытие, история, отправка
 */

import { state } from '../state.js';
import {
    fetchHistory,
    fetchWidgetConfig,
    markSessionRead,
    toggleOperatorMode,
    deleteSession,
    deleteSessionMessage,
    updateSessionStatus,
    archiveSession,
    fetchCloseReasons,
    createCloseReason,
    updateCloseReason,
    sendOperatorMessage,
    fetchGlobalOperatorStatus,
    fetchIntegrations,
    updateSessionMetadata,
    fetchAdminConfig,
    saveAdminConfig
} from '../api.js';
import {
    connectWebSocket,
    disconnectWebSocket,
    updateTypingStatus,
    sendTypingStatus
} from '../websocket.js';
import { slugify, escapeHtml, formatTime } from '../helpers.js?v=1';

function getDialogSaveButtons() {
    return [
        document.getElementById('global-save-btn'),
        document.getElementById('dialog-sidebar-save-btn')
    ].filter(Boolean);
}

function setDialogSaveActive(active = true) {
    const buttons = getDialogSaveButtons();
    buttons.forEach((btn) => {
        btn.classList.toggle('pulse-active', !!active);
        // Сохранение идёт через AdminApp.handleSidebarSave / DialogsModule.saveData.
        // onclick не вешаем, чтобы не дублировать сохранение.
        if (!active) btn.onclick = null;
    });
}

function setDialogSidebarMode(enabled) {
    if (window.AdminApp?.setSidebarMode) {
        window.AdminApp.setSidebarMode(enabled ? 'dialog' : null);
        return;
    }
    const sidebar = document.querySelector('.admin-sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('dialog-mode', !!enabled);
}

function isCompactDialogLayout() {
    return window.matchMedia('(max-width: 1024px)').matches;
}

function renderSidebarClientAvatar() {
    const button = document.getElementById('dialog-sidebar-client-avatar');
    if (!button) return;

    const profileAvatar = document.querySelector('#client-profile-card-container .dialog-sidebar-avatar');
    const profileImage = profileAvatar?.querySelector('img');
    const initials = profileAvatar?.textContent?.trim() || '?';
    button.classList.toggle('initials', !profileImage);
    button.innerHTML = profileImage
        ? `<img src="${escapeHtml(profileImage.src)}" alt="${escapeHtml(profileImage.alt || 'Клиент')}">`
        : escapeHtml(initials);
    button.onclick = () => {
        if (!isCompactDialogLayout() || !state.activeSessionId) return;
        document.querySelector('.appearance-grid')?.classList.add('is-dialog-profile');
    };
}

function showCompactDialogChat() {
    document.querySelector('.appearance-grid')?.classList.remove('is-dialog-profile');
}

/**
 * Форматирование контакта в виде ссылки
 */
function formatContactAsLink(label, value, platform) {
    if (!value) return '';
    const cleanValue = String(value).trim();
    let href = '';
    let text = cleanValue;

    const l = label.toLowerCase();

    // ID внешнего канала — служебный идентификатор, а не публичная ссылка.
    if (/\bid\b/i.test(label) || l.includes('chat id')) {
        return escapeHtml(text);
    }

    if (l.includes('email')) {
        href = `mailto:${cleanValue}`;
    } else if (l.includes('телефон') || l.includes('phone')) {
        href = `tel:${cleanValue.replace(/[^\d+]/g, '')}`;
    } else if (l.includes('telegram') || l.includes('телеграм') || platform === 'telegram') {
        const val = cleanValue.replace('@', '').split('/').pop();
        if (/^\d+$/.test(val)) {
            href = `https://t.me/id${val}`;
        } else {
            href = `https://t.me/${val}`;
        }
    } else if (l.includes('vk') || l.includes('вконтакте') || platform === 'vk') {
        const val = cleanValue.replace('@', '').replace('id', '').split('/').pop();
        href = `https://vk.com/${/^\d+$/.test(val) ? 'id' + val : val}`;
    } else if (l.includes('avito') || l.includes('авито') || platform === 'avito') {
        // Для Avito: формируем ссылку на профиль
        let val = cleanValue.split('/').pop().split('?')[0];
        if (val && val.length > 4) {
            const isNumeric = /^\d+$/.test(val);
            if (isNumeric) {
                // Числовой ID -> /brands/i123
                href = `https://www.avito.ru/brands/i${val}`;
            } else {
                // Хеш-ID или юзернейм -> /user/hash/profile
                href = `https://www.avito.ru/user/${val}/profile`;
            }
        } else if (cleanValue.includes('avito.ru')) {
            href = cleanValue.startsWith('http') ? cleanValue : `https://${cleanValue}`;
        }
    } else if (l.includes('max')) {
        // MAX не предоставляет универсальный публичный URL по numeric user_id.
        // Ссылкой считаем только явно переданный URL.
        if (cleanValue.startsWith('http')) href = cleanValue;
    } else if (cleanValue.startsWith('http') || cleanValue.includes('.')) {
        href = cleanValue.startsWith('http') ? cleanValue : `https://${cleanValue}`;
    }

    if (href) {
        return `<a href="${href}" target="_blank" class="contact-link-styled">${escapeHtml(text)}</a>`;
    }
    return escapeHtml(text);
}

let onDialogsChanged = null;

export function setOnDialogsChanged(callback) {
    onDialogsChanged = callback;
}

function getDialogsClientId() {
    return state.activeClientId
        || new URLSearchParams(window.location.search).get('client_id')
        || localStorage.getItem('chat_client_id')
        || null;
}

async function openCloseReasonsManager() {
    const helpers = await import('../helpers.js?v=1');
    const clientId = getDialogsClientId();

    const action = await helpers.showPromptAlert({
        title: 'Причины закрытия',
        text: 'Выберите действие для справочника причин:',
        confirmText: 'Выбрать',
        suggestions: [
            { label: 'Добавить причину', key: 'add' },
            { label: 'Переименовать причину', key: 'rename' },
            { label: 'Включить/отключить причину', key: 'toggle' },
        ],
    });

    if (!action || typeof action !== 'object') return;

    if (action.key === 'add') {
        const title = await helpers.showPromptAlert({
            title: 'Новая причина',
            text: 'Введите название причины закрытия:',
            placeholder: 'Например: Нецелевой запрос',
            confirmText: 'Сохранить',
        });
        if (!title) return;
        const created = await createCloseReason(String(title).trim(), clientId);
        if (!created.ok) alert('Не удалось создать причину. Возможно, она уже существует.');
        return;
    }

    const allReasons = await fetchCloseReasons(clientId, true);
    if (!allReasons.length) {
        alert('Справочник причин пуст. Сначала добавьте причину.');
        return;
    }

    const picked = await helpers.showPromptAlert({
        title: action.key === 'rename' ? 'Переименование причины' : 'Статус причины',
        text: 'Выберите причину из списка:',
        confirmText: 'Выбрать',
        suggestions: allReasons.map((r) => ({
            label: `${r.is_active ? '●' : '○'} ${r.title}`,
            key: String(r.id),
        })),
    });

    const reasonId = Number(picked?.key);
    const reason = allReasons.find((r) => r.id === reasonId);
    if (!reason) return;

    if (action.key === 'rename') {
        const newTitle = await helpers.showPromptAlert({
            title: 'Переименовать причину',
            text: `Текущее название: ${reason.title}`,
            placeholder: reason.title,
            confirmText: 'Сохранить',
        });
        if (!newTitle) return;
        const updated = await updateCloseReason(reasonId, { title: String(newTitle).trim() }, clientId);
        if (!updated.ok) alert('Не удалось переименовать причину.');
        return;
    }

    const updated = await updateCloseReason(reasonId, { is_active: !reason.is_active }, clientId);
    if (!updated.ok) {
        alert('Не удалось обновить статус причины.');
    }
}

async function pickArchiveCloseReason() {
    const helpers = await import('../helpers.js?v=1');
    const clientId = getDialogsClientId();

    while (true) {
        const reasons = await fetchCloseReasons(clientId, false);
        const pick = await helpers.showPromptAlert({
            title: 'Причина закрытия',
            text: 'Выберите причину для архивации диалога:',
            confirmText: 'Применить',
            suggestions: [
                ...reasons.map((r) => ({ label: r.title, key: String(r.id) })),
                { label: '+ Добавить новую причину', key: '__add__' },
                { label: '⚙ Управлять причинами', key: '__manage__' },
            ],
        });

        if (!pick) return null;
        if (typeof pick === 'object' && pick.key === '__manage__') {
            await openCloseReasonsManager();
            continue;
        }

        if (typeof pick === 'object' && pick.key === '__add__') {
            const title = await helpers.showPromptAlert({
                title: 'Новая причина',
                text: 'Введите название причины закрытия:',
                placeholder: 'Например: Завершили консультацию',
                confirmText: 'Сохранить',
            });
            if (!title) continue;
            const created = await createCloseReason(String(title).trim(), clientId);
            if (!created.ok || !created.reason) {
                alert('Не удалось создать причину. Возможно, она уже существует.');
                continue;
            }
            return created.reason;
        }

        const selectedId = Number(pick?.key);
        const selected = reasons.find((r) => r.id === selectedId);
        if (selected) return selected;
    }
}

/**
 * Добавление поля контакта
 */
export async function addContactField() {
    const helpers = await import('../helpers.js?v=1');
    
    const suggestions = [
        { label: 'Телефон', key: 'phones', ph: '+7...' },
        { label: 'Email', key: 'emails', ph: 'mail@...' },
        { label: 'Telegram', key: 'tg_links', ph: 't.me/...' },
        { label: 'WhatsApp', key: 'wa_links', ph: 'wa.me/...' },
        { label: 'Вконтакте', key: 'vk_links', ph: 'vk.com/...' },
        { label: 'VK Мессенджер', key: 'vk_links', ph: 'vk.com/...' },
        { label: 'Avito', key: 'avito_links', ph: 'avito.ru/...' },
        { label: 'Одноклассники', key: 'ok_links', ph: 'ok.ru/...' },
        { label: 'Max', key: 'max_links', ph: 'ID...' },
        { label: 'Сайт', key: 'other_links', ph: 'https://...' },
        { label: 'Адрес', key: 'addresses', ph: 'Адрес...' }
    ];

    const result = await helpers.showPromptAlert({
        title: 'Новый контакт',
        text: 'Выберите тип или введите название:',
        placeholder: 'Название...',
        confirmText: 'Далее',
        suggestions: suggestions
    });
    
    if (!result) return;

    const label = typeof result === 'object' ? result.label : result;
    const key = typeof result === 'object' ? result.key : 'other_links';
    const ph = typeof result === 'object' ? result.ph : 'Значение...';

    const value = await helpers.showPromptAlert({
        title: label,
        text: `Введите значение для контакта "${label}":`,
        placeholder: ph,
        confirmText: 'Добавить'
    });

    if (!value) return;

    const container = document.getElementById('profile-contacts-container');
    const tmpl = document.getElementById('tmpl-contact-field');
    const clone = tmpl.content.cloneNode(true);
    const row = clone.querySelector('.contact-row-item');
    
    row.dataset.key = key;
    row.querySelector('.field-label').textContent = label;
    row.querySelector('.field-label-edit').textContent = label;
    row.querySelector('.contact-value-text').textContent = value;
    
    const input = row.querySelector('.contact-input');
    input.value = value;
    input.dataset.label = label; // Убеждаемся, что метка сохранена в датасете
    
    row.querySelector('.btn-remove-field').onclick = () => {
        row.remove();
        // Активируем сохранение при удалении поля
        setDialogSaveActive(true);
    };

    // Новый контакт добавляется в режиме просмотра (по ТЗ), но он будет сохранен только при нажатии на дискету
    const isEditing = document.getElementById('btn-cancel-profile')?.style.display === 'flex';
    row.querySelector('.contact-view-mode').style.display = isEditing ? 'none' : 'flex';
    row.querySelector('.contact-edit-mode').style.display = isEditing ? 'block' : 'none';

    container.appendChild(row);

    // Активируем глобальную кнопку сохранения сразу после добавления поля
    setDialogSaveActive(true);
}

/**
 * Удаление поля контакта
 */
export function removeContactField(btn) {
    const row = btn.closest('.setting-item');
    if (row) {
        row.remove();
        // Активируем сохранение при удалении поля
        setDialogSaveActive(true);
    }
}

/**
 * Сохранение профиля клиента
 */
export async function saveClientProfile() {
    if (!state.activeSessionId) return;

    const metadata = {};
    const container = document.getElementById('profile-contacts-container');
    if (!container) return;

    // Собираем контакты
    const rows = container.querySelectorAll('.contact-row-item');
    rows.forEach(row => {
        const key = row.dataset.key || 'other_links';
        const input = row.querySelector('.contact-input');
        const val = input.value.trim();
        
        if (val) {
            if (!metadata[key]) metadata[key] = [];
            metadata[key].push({
                label: input.dataset.label || 'Контакт',
                value: val
            });
        }
    });

    // Собираем статус ИИ
    const modeToggle = document.getElementById('chat-mode-toggle');
    // Если чекбокс включен (checked), значит ассистент активен, следовательно режим оператора выключен (false)
    const isOperatorMode = modeToggle ? !modeToggle.checked : false;


    // Собираем аватар
    const avatarImg = document.querySelector('.profile-avatar-wrapper img, .dialog-sidebar-avatar img');
    const customAvatar = avatarImg ? avatarImg.dataset.customSrc : null;

    const dialogData = state.dialogs.find(d => d.session_id === state.activeSessionId);
    let currentMeta = dialogData ? dialogData.metadata_json : {};
    if (typeof currentMeta === 'string') try { currentMeta = JSON.parse(currentMeta); } catch(e) {}

    // Список ключей, которые относятся к контактам и должны быть полностью перезаписаны
    const contactKeys = ['phones', 'emails', 'addresses', 'tg_links', 'wa_links', 'vk_links', 'avito_links', 'ok_links', 'max_links', 'other_links', 'email', 'phone', 'contact'];

    // Создаем копию текущих метаданных, удаляя из них все старые контакты
    const finalMeta = { ...currentMeta };
    contactKeys.forEach(key => delete finalMeta[key]);

    // Добавляем только те контакты, которые сейчас есть в DOM
    Object.assign(finalMeta, metadata);

    if (customAvatar && customAvatar !== 'none') finalMeta.custom_avatar = customAvatar;
    if (customAvatar === 'none') delete finalMeta.custom_avatar;

    console.log('[Profile] Saving metadata (contacts replaced):', finalMeta);
    console.log('[Profile] Saving operator mode:', isOperatorMode);

    // 1. Сохраняем метаданные
    const okMeta = await updateSessionMetadata(state.activeSessionId, finalMeta);
    
    // 2. Сохраняем режим оператора только при фактическом изменении.
    // Иначе API создаёт лишнее системное сообщение о подключении/выходе оператора.
    const operatorModeChanged = Boolean(dialogData) && dialogData.is_operator_mode !== isOperatorMode;
    const okMode = !operatorModeChanged || await toggleOperatorMode(state.activeSessionId, isOperatorMode);

    if (okMeta && okMode) {
        // Моментально обновляем локальный стейт в state.dialogs
        const dialogIdx = state.dialogs.findIndex(d => d.session_id === state.activeSessionId);
        if (dialogIdx !== -1) {
            state.dialogs[dialogIdx].metadata_json = finalMeta;
            state.dialogs[dialogIdx].is_operator_mode = isOperatorMode;
        }

        // Сбрасываем акцент на кнопках сохранения (анимацию success даёт AdminApp.handleSidebarSave)
        setDialogSaveActive(false);

        console.log('[Profile] All changes saved successfully');
        
        // Принудительно выходим из режима редактирования перед перерисовкой
        const btnCancel = document.getElementById('btn-cancel-profile');
        if (btnCancel) btnCancel.style.display = 'none';
        
        // Перерисовываем сайдбар
        renderDialogSidebar(state.activeSessionId);
        
        // Обновляем список диалогов
        if (onDialogsChanged) onDialogsChanged();
    } else {
        alert('Ошибка при сохранении данных на сервере');
        throw new Error('Failed to save client profile');
    }
}

/**
 * Рендер контекстного сайдбара для диалога
 */
export function renderDialogSidebar(sessionId) {
    console.log(`[Profile Debug] renderDialogSidebar called for ${sessionId}`);
    const profileContainer = document.getElementById('client-profile-card-container');
    if (!profileContainer) return;

    // Блокируем перерисовку, если пользователь в режиме редактирования
    const btnCancelExisting = document.getElementById('btn-cancel-profile');
    if (btnCancelExisting && btnCancelExisting.style.display === 'flex') {
        console.log('[Profile] Skip render: editing in progress');
        return;
    }

    const tmplProfile = document.getElementById('tmpl-client-profile');
    if (!tmplProfile) return;

    const dialogData = state.dialogs.find(d => d.session_id === sessionId);
    const isOperator = dialogData ? dialogData.is_operator_mode : false;

    // Клонируем основной шаблон профиля
    const profileClone = tmplProfile.content.cloneNode(true);
    const avatarContainer = profileClone.getElementById('profile-avatar-container');
    const contactsContainer = profileClone.getElementById('profile-contacts-container');
    if (dialogData && dialogData.metadata_json) {
        let meta = dialogData.metadata_json;
        if (typeof meta === 'string') try { meta = JSON.parse(meta); } catch(e) {}
        
        console.log(`[Profile Debug] Metadata for session ${sessionId}:`, meta);
        
        const photo = meta.custom_avatar || meta.photo || meta.photo_url || meta.avatar_url || null;
        
        // Улучшенное определение платформы
        let platform = meta ? meta.platform : null;
        if (!platform && sessionId) {
            const sid = sessionId.toLowerCase();
            if (sid.includes('tg-') || sid.includes('telegram')) platform = 'telegram';
            else if (sid.includes('vk-')) platform = 'vk';
            else if (sid.includes('ok-')) platform = 'ok';
            else if (sid.includes('max-')) platform = 'max';
            else if (sid.includes('email_')) platform = 'email';
            else if (sid.includes('avito-')) platform = 'avito';
        }
        if (!platform) platform = 'web';

        console.log(`[Profile Debug] Detected platform: ${platform} for session: ${sessionId}`);

        const firstName = meta.first_name || meta.name || meta.sender || '';
        const lastName = meta.last_name || '';
        const name = `${firstName} ${lastName}`.trim() || 'Клиент';

        // Рендер аватара
        const avatarRow = document.createElement('div');
        avatarRow.className = 'profile-user-row';
        
        let finalPhoto = photo;
        if (!finalPhoto) {
            if (platform === 'web') {
                finalPhoto = state.widgetConfig?.theme?.msg_user_avatar || '/api/chat/img/icon_mitia_white.jpg';
            } else if (platform === 'vk') {
                finalPhoto = meta.photo_max || meta.photo_200 || meta.photo_100 || null;
            }
        }

        if (finalPhoto || (platform === 'email' && meta.sender_email)) {
            if (!finalPhoto && platform === 'email') {
                finalPhoto = `/api/chat/proxy/email-avatar?email=${encodeURIComponent(meta.sender_email || meta.email)}`;
            }
            avatarRow.innerHTML = `<div class="dialog-sidebar-avatar client-avatar-container"><img src="${finalPhoto}" data-custom-src="${meta.custom_avatar || ''}"></div><div class="profile-user-name">${escapeHtml(name)}</div>`;
        } else {
            const initials = name.split(' ').filter(n => n).map(n => n[0]).join('').toUpperCase().substring(0, 2) || '?';
            avatarRow.innerHTML = `<div class="dialog-sidebar-avatar initials client-avatar-container">${initials}</div><div class="profile-user-name">${escapeHtml(name)}</div>`;
        }
        avatarContainer.appendChild(avatarRow);

        // Рендер контактов
        const contactTypes = [
            { label: 'Телефон', key: 'phones', ph: '+7...' },
            { label: 'Email', key: 'emails', ph: 'mail@...' },
            { label: 'Адрес', key: 'addresses', ph: 'Адрес...' },
            { label: 'Telegram', key: 'tg_links', ph: 't.me/...' },
            { label: 'WhatsApp', key: 'wa_links', ph: 'wa.me/...' },
            { label: 'Вконтакте', key: 'vk_links', ph: 'vk.com/...' },
            { label: 'VK Мессенджер', key: 'vk_links', ph: 'vk.com/...' },
            { label: 'Avito', key: 'avito_links', ph: 'avito.ru/...' },
            { label: 'Одноклассники', key: 'ok_links', ph: 'ok.ru/...' },
            { label: 'Max', key: 'max_links', ph: 'ID...' },
            { label: 'Другое', key: 'other_links', ph: 'Значение...' }
        ];

        const tmplField = document.getElementById('tmpl-contact-field');

        contactTypes.forEach(type => {
            let items = meta[type.key] || [];
            if (!Array.isArray(items)) items = [items];

            items.forEach(item => {
                if (!item) return;
                const fieldClone = tmplField.content.cloneNode(true);
                const row = fieldClone.querySelector('.contact-row-item');
                
                const label = (typeof item === 'object' && item.label) ? item.label : type.label;
                const value = (typeof item === 'object' && item.value) ? item.value : item;

                if (!value || typeof value !== 'string') return;

                row.dataset.key = type.key;
                row.querySelector('.field-label').textContent = label;
                row.querySelector('.field-label-edit').textContent = label;
                row.querySelector('.contact-value-text').textContent = value;
                
                const input = row.querySelector('.contact-input');
                input.value = value;
                input.placeholder = type.ph;
                input.dataset.label = label;
                
                row.querySelector('.btn-remove-field').onclick = () => row.remove();
                contactsContainer.appendChild(fieldClone);
            });
        });

        // Legacy fields и синхронизация с карточкой диалога (включая ID и Username)
        const platformNames = {
            'telegram': 'Telegram',
            'vk': 'Вконтакте',
            'ok': 'Одноклассники',
            'avito': 'Avito',
            'max': 'Max',
            'email': 'Email',
            'web': 'Сайт'
        };
        const currentPlatformName = platformNames[platform] || '';

        // Специальная обработка для Avito: вытаскиваем ID из sessionId, если его нет в мете
        if (platform === 'avito' && sessionId) {
            const parts = sessionId.split('-');
            const avitoId = parts[parts.length - 1];
            // Поддерживаем как цифры, так и хеши (длина > 4)
            if (avitoId && avitoId.length > 4) {
                if (!meta.avito_id) meta.avito_id = avitoId;
                if (!meta.user_id) meta.user_id = avitoId;
            }
        }

        const legacyFields = [
            { label: 'Email', key: 'email', targetKey: 'emails', ph: 'mail@...' },
            { label: 'Телефон', key: 'phone', targetKey: 'phones', ph: '+7...' },
            { label: 'Контакт', key: 'contact', targetKey: 'other_links', ph: 'Значение...' },
            { label: 'Email', key: 'sender_email', targetKey: 'emails', ph: 'mail@...' },
            { label: 'Телефон', key: 'sender_phone', targetKey: 'phones', ph: '+7...' },
            { label: currentPlatformName || 'Username', key: 'username', targetKey: 'other_links', ph: '@...', isUsername: true },
            { label: `${currentPlatformName} ID`.trim(), key: 'user_id', targetKey: 'other_links', ph: 'ID...' },
            { label: `${currentPlatformName} ID`.trim(), key: 'id', targetKey: 'other_links', ph: 'ID...' },
            { label: `${currentPlatformName} ID`.trim(), key: 'sender_id', targetKey: 'other_links', ph: 'ID...' },
            { label: `${currentPlatformName} ID`.trim(), key: 'author_id', targetKey: 'other_links', ph: 'ID...' },
            { label: `${currentPlatformName} ID`.trim(), key: 'avito_id', targetKey: 'other_links', ph: 'ID...' },
            { label: 'Chat ID', key: 'chat_id', targetKey: 'other_links', ph: 'ID...' },
            { label: 'Telegram ID', key: 'tg_id', targetKey: 'tg_links', ph: 'ID...' },
            { label: 'Max ID', key: 'max_id', targetKey: 'max_links', ph: 'ID...' }
        ];

        legacyFields.forEach(f => {
            let val = meta[f.key];
            // Приводим к строке, так как ID могут быть числами
            if (val !== undefined && val !== null) {
                val = String(val).trim();
                if (val !== '') {
                    // Если это username и нет @ в начале, добавляем его
                    if (f.isUsername && !val.startsWith('@')) {
                        val = '@' + val;
                    }

                    // Проверяем дубликаты по чистому значению
                    const allInputs = Array.from(contactsContainer.querySelectorAll('.contact-input'));
                    const exists = allInputs.some(i => i.value.trim().toLowerCase() === val.toLowerCase());
                    
                    if (!exists) {
                        const fieldClone = tmplField.content.cloneNode(true);
                        const row = fieldClone.querySelector('.contact-row-item');
                        row.dataset.key = f.targetKey;
                        row.querySelector('.field-label').textContent = f.label;
                        row.querySelector('.field-label-edit').textContent = f.label;
                        
                        // Важно: используем innerHTML для ссылок
                        const linkHtml = formatContactAsLink(f.label, val, platform);
                        row.querySelector('.contact-value-text').innerHTML = linkHtml;

                        const input = row.querySelector('.contact-input');
                        input.value = val;
                        input.placeholder = f.ph;
                        input.dataset.label = f.label;
                        row.querySelector('.btn-remove-field').onclick = () => {
                            row.remove();
                            setDialogSaveActive(true);
                        };
                        contactsContainer.appendChild(fieldClone);
                    }
                }
            }
        });
    }

    // Очищаем и вставляем новый профиль
    profileContainer.innerHTML = '';
    profileContainer.appendChild(profileClone);

    // Инициализация событий
    const btnEdit = document.getElementById('btn-edit-profile');
    const btnCancel = document.getElementById('btn-cancel-profile');
    const btnAdd = document.getElementById('btn-add-any-contact');
    const avatarImg = document.querySelector('.dialog-sidebar-avatar img');
    const menuBtn = document.getElementById('chat-menu-btn');

    const toggleEditMode = (edit) => {
        const listCol = document.getElementById('dialogs-list-column');
        if (listCol) {
            if (edit) listCol.classList.add('dialogs-list-blocked');
            else listCol.classList.remove('dialogs-list-blocked');
        }

        document.querySelectorAll('.contact-view-mode').forEach(el => el.style.display = edit ? 'none' : 'flex');
        document.querySelectorAll('.contact-edit-mode').forEach(el => el.style.display = edit ? 'block' : 'none');

        if (btnCancel) btnCancel.style.display = edit ? 'flex' : 'none';
        if (menuBtn) menuBtn.style.display = edit ? 'none' : 'flex';
        if (avatarImg) avatarImg.style.cursor = edit ? 'pointer' : 'default';

        // Прячем кнопку добавления контакта ТОЛЬКО в режиме редактирования
        if (btnAdd) btnAdd.style.display = edit ? 'none' : 'flex';

        // Прячем всю строку тумблера ассистента ТОЛЬКО в режиме редактирования
        const modeRow = document.querySelector('.sidebar-mode-toggle-row');
        if (modeRow) modeRow.style.display = edit ? 'none' : 'flex';

        // Управление крестиком на аватаре через класс
        const container = avatarImg?.closest('.client-avatar-container');
        if (container) {
            if (edit) container.classList.add('editing');
            else container.classList.remove('editing');
        }

        if (edit) {
            const removeAvatarBtn = document.getElementById('btn-remove-client-avatar');
            if (!removeAvatarBtn && avatarImg) {
                const newBtn = document.createElement('button');
                newBtn.id = 'btn-remove-client-avatar';
                newBtn.className = 'avatar-remove-btn-client';
                newBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
                newBtn.onclick = (e) => {
                    e.stopPropagation();
                    avatarImg.src = '/api/chat/img/icon_mitia_white.jpg';
                    avatarImg.dataset.customSrc = 'none';
                    setDialogSaveActive(true);
                };
                if (container) container.appendChild(newBtn);
            }
        }

        const modeToggle = document.getElementById('chat-mode-toggle');
        if (modeToggle) {
            // Тумблер теперь всегда активен для переключения,
            // но сохранение происходит только по кнопке
            modeToggle.disabled = false;
            modeToggle.closest('.mitya-switch').style.opacity = '1';
            modeToggle.closest('.mitya-switch').style.cursor = 'pointer';

            // При переключении тумблера активируем кнопку сохранения, если мы еще не в режиме редактирования
            modeToggle.onchange = () => {
                const saveButtons = getDialogSaveButtons();
                const alreadyActive = saveButtons.some((btn) => btn.classList.contains('pulse-active'));
                if (!alreadyActive) setDialogSaveActive(true);
            };
        }

        // В режиме редактирования можно безвозвратно очистить отдельные сообщения и их вложения.
        const messagesContainer = document.getElementById('modal-messages-container');
        if (messagesContainer) messagesContainer.classList.toggle('is-editing-messages', !!edit);

        // Управление глобальной кнопкой сохранения
        setDialogSaveActive(!!edit);
    };

    if (btnEdit) {
        btnEdit.onclick = (e) => {
            e.stopPropagation();
            if (dropdown) dropdown.classList.remove('show');
            toggleEditMode(true);
        };
    }
    if (btnCancel) btnCancel.onclick = () => {
        toggleEditMode(false);
        // Сбрасываем кнопку сохранения
        setDialogSaveActive(false);
    };
    if (btnAdd) btnAdd.onclick = () => addContactField();

    if (avatarImg) {
        avatarImg.onclick = async () => {
            if (btnCancel.style.display !== 'flex') return; // Только в режиме редактирования
            const helpers = await import('../helpers.js?v=1');
            const newUrl = await helpers.showPromptAlert({
                title: 'Аватар клиента',
                text: 'Введите прямую ссылку на изображение:',
                placeholder: 'https://...',
                confirmText: 'Применить'
            });
            if (newUrl) {
                avatarImg.src = newUrl;
                avatarImg.dataset.customSrc = newUrl;
            }
        };
    }

    const modeToggle = document.getElementById('chat-mode-toggle');
    if (modeToggle) {
        modeToggle.checked = !isOperator;
        // По умолчанию показываем строку тумблера
        const modeRow = modeToggle.closest('.sidebar-mode-toggle-row');
        if (modeRow) modeRow.style.display = 'flex';

        modeToggle.onchange = () => {
            setDialogSaveActive(true);
        };
    }

    if (btnAdd) btnAdd.style.display = 'flex'; // По умолчанию показываем кнопку плюс

    const messagesContainer = document.getElementById('modal-messages-container');
    if (messagesContainer) {
        messagesContainer.onclick = async (event) => {
            const button = event.target.closest('.message-delete-button');
            if (!button || !messagesContainer.classList.contains('is-editing-messages')) return;
            const messageId = Number(button.dataset.messageId);
            if (!Number.isInteger(messageId)) return;

            const helpers = await import('../helpers.js?v=1');
            const confirmed = await helpers.showConfirmAlert({
                title: 'Удалить сообщение?',
                text: 'Сообщение и все его файлы будут удалены без возможности восстановления.',
                confirmText: 'Удалить'
            });
            if (!confirmed) return;

            button.disabled = true;
            if (await deleteSessionMessage(sessionId, messageId)) {
                state.lastHistoryContent = '';
                await loadChatHistory(sessionId);
            } else {
                button.disabled = false;
                alert('Не удалось удалить сообщение');
            }
        };
    }

    const dropdown = document.getElementById('chat-dropdown-menu');
    if (menuBtn && dropdown) {
        menuBtn.onclick = (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('show');
            
            if (dropdown.classList.contains('show')) {
                const closeMenu = (event) => {
                    if (!dropdown.contains(event.target) && event.target !== menuBtn) {
                        dropdown.classList.remove('show');
                        document.removeEventListener('click', closeMenu);
                    }
                };
                document.addEventListener('click', closeMenu);
            }
        };
    }

    document.getElementById('btn-make-lead')?.addEventListener('click', async () => {
        if (await updateSessionStatus(sessionId, 'lead')) onDialogsChanged?.();
    });

    document.getElementById('btn-make-app')?.addEventListener('click', async () => {
        if (await toggleOperatorMode(sessionId, true)) onDialogsChanged?.();
    });

    document.getElementById('btn-make-spam')?.addEventListener('click', async () => {
        if (await updateSessionStatus(sessionId, 'spam')) onDialogsChanged?.();
    });

    document.getElementById('btn-archive-session')?.addEventListener('click', async () => {
        const selectedReason = await pickArchiveCloseReason();
        if (!selectedReason) return;

        if (await archiveSession(sessionId, true, selectedReason.id)) {
            const dialog = state.dialogs.find((d) => d.session_id === sessionId);
            if (dialog) dialog.close_reason = selectedReason.title;
            onDialogsChanged?.();
        }
    });

    document.getElementById('btn-manage-close-reasons')?.addEventListener('click', async () => {
        await openCloseReasonsManager();
    });

    document.getElementById('btn-delete-session')?.addEventListener('click', async () => {
        const helpers = await import('../helpers.js?v=1');
        const confirmed = await helpers.showConfirmAlert({
            title: 'Удалить диалог?',
            text: 'Вы уверены, что хотите полностью удалить этот диалог? Это действие необратимо.',
            confirmText: 'Удалить'
        });

        if (confirmed) {
            if (await deleteSession(sessionId)) {
                window.closeActiveDialog?.();
                onDialogsChanged?.();
            }
        }
    });
}

export async function openDialog(sessionId) {
    state.activeSessionId = sessionId;
    state.lastHistoryContent = '';

    try {
        state.widgetConfig = await fetchAdminConfig(state.activeClientId);
    } catch (e) {
        state.widgetConfig = state.widgetConfig || {};
    }
    
    // Обновляем URL без перезагрузки страницы
    const url = new URL(window.location);
    url.searchParams.set('session_id', sessionId);
    window.history.pushState({}, '', url);

    const filterCol = document.getElementById('dialogs-filter-column');
    const profileCol = document.getElementById('dialogs-profile-column');
    const listCol = document.getElementById('dialogs-list-column');
    const dialogCol = document.getElementById('dialog-section-column');
    const grid = document.querySelector('.appearance-grid');
    const wasDialogActive = !!grid?.classList.contains('dialog-active');

    // Запоминаем позицию списка только при первом входе в режим диалога
    if (!wasDialogActive && listCol) {
        state.listScrollBeforeDialogOpen = listCol.scrollTop;
    }

    if (grid) grid.classList.add('dialog-active');
    if (filterCol) filterCol.style.display = 'none';
    if (profileCol) profileCol.style.display = 'flex';
    if (listCol) {
        listCol.style.display = 'flex';
        listCol.classList.add('narrow-list');
    }
    if (dialogCol) dialogCol.style.display = 'flex';

    document.body.classList.add('dialog-open');
    setDialogSidebarMode(true);
    showCompactDialogChat();
    renderDialogSidebar(sessionId);
    renderSidebarClientAvatar();
    loadChatHistory(sessionId);
    startHistoryUpdate(sessionId);

    // Реалтайм-события (typing + новые сообщения)
    connectWebSocket(sessionId, (data) => {
        if (!data || typeof data !== 'object') return;

        if (data.type === 'typing') {
            const isTyping = !!data.is_typing;
            const role = data.author_role || 'user';
            // Показываем статус, если печатает КТО-УГОДНО, кроме текущего оператора
            if (role !== 'operator') {
                updateTypingStatus(isTyping, role);
            } else {
                // Если пришло событие от оператора (например, из другой вкладки), скрываем статус
                updateTypingStatus(false);
            }
            return;
        }

        if (data.type === 'message') {
            loadChatHistory(sessionId, true);
        }
    });

    initChatControls(sessionId);
    
    // Принудительно перерисовываем список, чтобы обновилась обводка активной карточки
    const { renderDialogs } = await import('./list.js');
    renderDialogs();

    // Прокручиваем к активному диалогу только при первом входе в режим диалога.
    // При переключении карточек внутри уже открытого режима не дергаем список.
    if (!wasDialogActive) {
        const activeCard = document.querySelector(`.dialog-vizitka.active-card`);
        if (activeCard) {
            activeCard.scrollIntoView({ behavior: 'auto', block: 'start' });
        }
    }

    // Отмечаем прочитанным
    const dialog = state.dialogs.find(d => d.session_id === sessionId);
    if (dialog && !dialog.is_read) {
        markSessionRead(sessionId).then(ok => {
            if (ok) {
                dialog.is_read = true;
                onDialogsChanged?.();
            }
        });
    }

    window.handleDialogBack = () => {
        const grid = document.querySelector('.appearance-grid');
        if (isCompactDialogLayout() && grid?.classList.contains('is-dialog-profile')) {
            showCompactDialogChat();
            return;
        }
        window.closeActiveDialog?.();
    };

    window.closeActiveDialog = async () => {
        stopHistoryUpdate();
        disconnectWebSocket();
        updateTypingStatus(false);
        state.activeSessionId = null; // Сбрасываем активную сессию
        
        // Сбрасываем состояние редактирования и кнопку сохранения
        const btnCancel = document.getElementById('btn-cancel-profile');
        if (btnCancel) btnCancel.style.display = 'none';

        const listCol = document.getElementById('dialogs-list-column');
        if (listCol) listCol.classList.remove('dialogs-list-blocked');

        const DISKETTE_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v13a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`;
        getDialogSaveButtons().forEach((btn) => {
            btn.classList.remove('pulse-active');
            btn.onclick = null;
            btn.innerHTML = DISKETTE_SVG;
        });
        setDialogSidebarMode(false);
        showCompactDialogChat();
        const clientAvatarButton = document.getElementById('dialog-sidebar-client-avatar');
        if (clientAvatarButton) {
            clientAvatarButton.innerHTML = '';
            clientAvatarButton.onclick = null;
        }
        window.handleDialogBack = null;

        // Сначала мгновенно перерисовываем список, чтобы убрать обводку
        const { renderDialogs: renderList } = await import('./list.js');
        renderList();

        if (grid) grid.classList.remove('dialog-active');
        if (filterCol) filterCol.style.display = 'flex';
        if (profileCol) profileCol.style.display = 'none';
        if (listCol) {
            listCol.style.display = 'flex';
            listCol.classList.remove('narrow-list');
        }
        if (dialogCol) dialogCol.style.display = 'none';
        document.body.classList.remove('dialog-open');

        // Возвращаем список туда, где пользователь открыл карточку
        if (listCol && state.listScrollBeforeDialogOpen !== null) {
            listCol.scrollTop = state.listScrollBeforeDialogOpen;
            state.listScrollBeforeDialogOpen = null;
        }
        
        // Очищаем URL
        const url = new URL(window.location);
        url.searchParams.delete('session_id');
        window.history.pushState({}, '', url);
    };
}

/**
 * Эффект печатающейся машинки
 */
async function typeTextEffect(element, htmlContent, speed = 15) {
    element.innerHTML = '';
    // Для простоты эффекта в админке печатаем по словам, чтобы не ломать HTML-теги
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent;
    const text = tempDiv.innerText;
    const words = text.split(' ');
    
    let currentText = '';
    for (const word of words) {
        currentText += word + ' ';
        element.textContent = currentText;
        await new Promise(resolve => setTimeout(resolve, speed));
        const container = document.getElementById('modal-messages-container');
        if (container) container.scrollTop = container.scrollHeight;
    }
    // В конце заменяем на полный HTML, чтобы работали ссылки и форматирование
    element.innerHTML = htmlContent;
}

/**
 * Рендер контента сообщения (с поддержкой HTML для Email)
 */
function attachmentUrl(attachment) {
    if (!attachment || typeof attachment !== 'object') return '';
    const directUrl = attachment.url || attachment.file_url || attachment.local_url || attachment.path;
    if (directUrl) return String(directUrl);
    if (attachment.data && attachment.content_type) {
        return `data:${attachment.content_type};base64,${attachment.data}`;
    }
    return '';
}

function renderMessageAttachments(attachments, { hideInline = false } = {}) {
    if (!Array.isArray(attachments) || !attachments.length) return '';
    const items = attachments
        .filter((attachment) => !hideInline || attachment?.disposition !== 'inline')
        .map((attachment) => {
            const url = attachmentUrl(attachment);
            const name = String(attachment?.name || attachment?.file_name || 'Файл');
            const contentType = String(attachment?.content_type || attachment?.type || '');
            const isImage = contentType.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
            const isAudio = contentType.startsWith('audio/') || /\.(mp3|m4a|ogg|opus|wav|weba)$/i.test(name);
            if (!url) return `<div class="operator-message-file">📎 ${escapeHtml(name)}</div>`;
            if (isAudio) {
                return `<div class="operator-message-audio"><span class="operator-message-audio-name">${escapeHtml(name)}</span><audio controls preload="metadata" src="${escapeHtml(url)}">Ваш браузер не поддерживает воспроизведение аудио.</audio></div>`;
            }
            if (isImage) {
                return `<button type="button" class="operator-message-image-link" data-dialog-image-url="${escapeHtml(url)}" aria-label="Открыть изображение ${escapeHtml(name)}"><img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" class="operator-message-image"></button>`;
            }
            return `<a class="operator-message-file" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">📎 ${escapeHtml(name)}</a>`;
        }).join('');
    return items ? `<div class="operator-message-attachments">${items}</div>` : '';
}

function openDialogImageGallery(container, imageUrl) {
    const images = Array.from(container.querySelectorAll('[data-dialog-image-url]'));
    let currentIndex = images.findIndex((image) => image.dataset.dialogImageUrl === imageUrl);
    if (currentIndex < 0) currentIndex = 0;

    const panel = container.closest('.dialog-full-view-card');
    if (!panel || !images.length) return;

    const overlay = document.createElement('div');
    overlay.className = 'dialog-image-gallery';
    const close = () => overlay.remove();
    const render = () => {
        const image = images[currentIndex];
        const src = image.dataset.dialogImageUrl || '';
        const fileName = src.split('/').pop().split('?')[0] || 'image';
        overlay.innerHTML = `
            <div class="dialog-image-gallery-actions">
                <a href="${escapeHtml(src)}" download="${escapeHtml(fileName)}" class="dialog-image-gallery-action" title="Скачать" aria-label="Скачать изображение"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/></svg></a>
                <button type="button" class="dialog-image-gallery-action" data-gallery-close title="Закрыть" aria-label="Закрыть галерею"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
            </div>
            ${images.length > 1 ? '<button type="button" class="dialog-image-gallery-nav is-prev" data-gallery-prev aria-label="Предыдущее изображение"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg></button><button type="button" class="dialog-image-gallery-nav is-next" data-gallery-next aria-label="Следующее изображение"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg></button>' : ''}
            <img src="${escapeHtml(src)}" alt="Изображение из диалога" class="dialog-image-gallery-image">
            <span class="dialog-image-gallery-counter">${currentIndex + 1} / ${images.length}</span>`;
        overlay.querySelector('[data-gallery-close]')?.addEventListener('click', close);
        overlay.querySelector('[data-gallery-prev]')?.addEventListener('click', () => {
            currentIndex = (currentIndex - 1 + images.length) % images.length;
            render();
        });
        overlay.querySelector('[data-gallery-next]')?.addEventListener('click', () => {
            currentIndex = (currentIndex + 1) % images.length;
            render();
        });
    };

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close();
    });
    render();
    panel.appendChild(overlay);
}

function bindDialogImageGallery(container) {
    if (container.dataset.dialogImageGalleryBound === 'true') return;
    container.dataset.dialogImageGalleryBound = 'true';
    container.addEventListener('click', (event) => {
        const imageButton = event.target.closest('[data-dialog-image-url]');
        if (!imageButton) return;
        event.preventDefault();
        openDialogImageGallery(container, imageButton.dataset.dialogImageUrl || '');
    });
}

function resolveCidLinks(html, attachments) {
    if (!html || !Array.isArray(attachments)) return html;
    return attachments.reduce((resolvedHtml, attachment) => {
        const cid = String(attachment?.cid || '').trim().replace(/^<|>$/g, '');
        const url = attachmentUrl(attachment);
        if (!cid || !url) return resolvedHtml;
        return resolvedHtml.split(`cid:${cid}`).join(url);
    }, html);
}

function formatMessageDate(timestamp) {
    const date = timestamp ? new Date(timestamp) : new Date();
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatMessageTime(timestamp) {
    const date = timestamp ? new Date(timestamp) : new Date();
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function renderOperatorAvatar() {
    const theme = state.widgetConfig?.theme || {};
    const avatarUrl = theme.msg_operator_avatar || theme.operator_avatar;
    if (!avatarUrl || theme.msg_operator_avatar_enabled === false) return '';
    return `<img class="operator-message-avatar" src="${escapeHtml(avatarUrl)}" alt="Оператор">`;
}

function renderMessageContent(msg, sessionId) {
    let content = msg.content || msg.text || '';
    const isEmail = sessionId && sessionId.startsWith('email_');
    if (isEmail) content = resolveCidLinks(content, msg.attachments);
    
    if (isEmail && (content.includes('<html') || content.includes('<div') || content.includes('<body') || content.includes('<table'))) {
        // 1. Извлекаем тему
        let subject = msg.subject || msg.metadata?.subject;
        if (!subject) {
            const subjectMatch = content.match(/Тема:\s*(.*?)(?:<br|\n|<div|<p|\||$)/i);
            if (subjectMatch) subject = subjectMatch[1].replace(/<[^>]*>/g, '').trim();
            if (!subject) subject = 'Электронное письмо';
        }

        // 2. Очищаем тело письма от дублей темы и отправителя
        content = content.replace(/<div[^>]*>\s*От:\s*<span[^>]*>.*?<\/span>\s*<\/div>/is, '');
        content = content.replace(/(?:<div[^>]*>|<p[^>]*>|\s)*Тема:\s*.*?<\/(?:div|p)>(?:<br\s*\/?>|\s)*/is, '');
        content = content.replace(/Тема:\s*.*?<br\s*\/?>/is, '');
        
        const shadowId = `email-shadow-${Math.random().toString(36).substr(2, 9)}`;
        
        const attachmentsHtml = renderMessageAttachments(msg.attachments, { hideInline: true });
        return `
            <div class="email-wrapper collapsed">
                <div class="email-header" onclick="DialogsProfileHelpers.toggleEmail(this)">
                    <div class="email-subject"><span>${escapeHtml(subject)}</span></div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="collapse-chevron"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
                <div class="email-expanded-content">
                    <div class="email-shadow-container" id="${shadowId}" data-content="${encodeURIComponent(content)}"></div>
                    ${attachmentsHtml}
                </div>
            </div>`;
    }
    
    return escapeHtml(content);
}
    


/**
 * Инициализация Shadow DOM для HTML-писем
 */
function initEmailShadowDOM() {
    const containers = document.querySelectorAll('.email-shadow-container[data-content]');
    containers.forEach(container => {
        const content = decodeURIComponent(container.dataset.content);
        container.removeAttribute('data-content');
        
        try {
            // Создаем Shadow Root
            const shadow = container.attachShadow({ mode: 'open' });
            
            // Добавляем базовые стили изоляции внутрь Shadow DOM
            const style = document.createElement('style');
            style.textContent = `
                :host {
                    display: block;
                    background: #ffffff !important;
                    color: #000000 !important;
                    font-family: sans-serif;
                    width: 100%;
                    overflow: hidden;
                }
                div, p, body, html {
                    margin: 0;
                    padding: 0;
                    background: #ffffff !important;
                    color: #000000 !important;
                }
                * {
                    max-width: 100% !important;
                    box-sizing: border-box !important;
                }
                .email-body-content {
                    padding: 16px !important;
                    overflow-wrap: anywhere;
                }
            `;
            
            const body = document.createElement('div');
            body.className = 'email-body-content';
            body.innerHTML = content;
            
            shadow.appendChild(style);
            shadow.appendChild(body);
        } catch (e) {
            console.error('[EmailRender] Shadow DOM error:', e);
            container.innerHTML = content; // Fallback
        }
    });
}

/**
 * Инициализация управления чатом (ввод, отправка)
 */
function initChatControls(sessionId) {
    const input = document.getElementById('operator-input');
    const sendBtn = document.getElementById('send-operator-msg');
    const micBtn = document.getElementById('operator-mic-btn');
    const attachBtn = document.getElementById('operator-attach-btn');
    const fileInput = document.getElementById('operator-file-input');
    const attachedFilesBox = document.getElementById('operator-attached-files');
    const attachedFiles = [];

    if (!input || !sendBtn) return;

    // Очищаем старые обработчики (через замену узла или просто переназначение)
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);
    
    const newSendBtn = sendBtn.cloneNode(true);
    sendBtn.parentNode.replaceChild(newSendBtn, sendBtn);

    const renderAttachedFiles = () => {
        if (!attachedFilesBox) return;
        attachedFilesBox.innerHTML = attachedFiles.map((file, index) => `
            <div class="operator-attached-file" title="${escapeHtml(file.name)}">
                <span>${escapeHtml(file.name)}</span>
                <button type="button" data-file-index="${index}" aria-label="Удалить файл">×</button>
            </div>
        `).join('');
        attachedFilesBox.querySelectorAll('button[data-file-index]').forEach((button) => {
            button.onclick = () => {
                attachedFiles.splice(Number(button.dataset.fileIndex), 1);
                renderAttachedFiles();
            };
        });
    };

    const handleSend = async () => {
        const text = newInput.value.trim();
        if (!text && !attachedFiles.length) return;

        sendTypingStatus(false);
        if (state.typingTimeout) {
            clearTimeout(state.typingTimeout);
            state.typingTimeout = null;
        }

        newInput.value = '';
        newSendBtn.style.display = 'none';
        if (micBtn) micBtn.style.display = 'flex';

        try {
            const response = await sendOperatorMessage(sessionId, text, attachedFiles);
            if (response.ok) {
                attachedFiles.splice(0, attachedFiles.length);
                renderAttachedFiles();
                await loadChatHistory(sessionId, true);
            } else {
                console.error('[Chat] Operator message rejected:', await response.text());
            }
        } catch (e) {
            console.error('[Chat] Send error:', e);
        }
    };

    newInput.oninput = () => {
        const hasText = newInput.value.trim().length > 0;
        newSendBtn.style.display = hasText ? 'flex' : 'none';
        if (micBtn) micBtn.style.display = hasText ? 'none' : 'flex';

        sendTypingStatus(hasText);
        if (state.typingTimeout) clearTimeout(state.typingTimeout);
        if (hasText) {
            state.typingTimeout = setTimeout(() => {
                sendTypingStatus(false);
                state.typingTimeout = null;
            }, 1200);
        }
    };

    newInput.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    newSendBtn.onclick = handleSend;

    newInput.onblur = () => {
        sendTypingStatus(false);
        if (state.typingTimeout) {
            clearTimeout(state.typingTimeout);
            state.typingTimeout = null;
        }
    };

    if (attachBtn && fileInput) {
        attachBtn.onclick = () => fileInput.click();
        fileInput.onchange = () => {
            const files = Array.from(fileInput.files || []);
            attachedFiles.push(...files);
            fileInput.value = '';
            renderAttachedFiles();
        };
    }

    if (micBtn) {
        micBtn.onclick = () => {
            const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!Recognition) {
                alert('Голосовой ввод не поддерживается этим браузером.');
                return;
            }

            const recognition = new Recognition();
            recognition.lang = 'ru-RU';
            recognition.interimResults = false;
            recognition.maxAlternatives = 1;
            micBtn.classList.add('is-recording');
            recognition.onresult = (event) => {
                const transcript = event.results?.[0]?.[0]?.transcript || '';
                newInput.value = `${newInput.value}${newInput.value ? ' ' : ''}${transcript}`;
                newInput.dispatchEvent(new Event('input'));
                newInput.focus();
            };
            recognition.onerror = (event) => console.warn('[Operator STT] Recognition error:', event.error);
            recognition.onend = () => micBtn.classList.remove('is-recording');
            try {
                recognition.start();
            } catch (error) {
                micBtn.classList.remove('is-recording');
                console.warn('[Operator STT] Start error:', error);
            }
        };
    }
}

export async function loadChatHistory(sessionId, isSilent = false) {
    const container = document.getElementById('modal-messages-container');
    if (!container) return;
    try {
        const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;
        const history = await fetchHistory(sessionId, state.activeClientId);
        let messages = Array.isArray(history) ? history : (history.history || []);
        bindDialogImageGallery(container);

        const historyString = JSON.stringify(messages);
        if (isSilent && state.lastHistoryContent === historyString) {
            return;
        }

        // Если это не фоновое обновление или контейнер пуст, рендерим всё
        if (!isSilent || !container.querySelector('.modal-msg')) {
            state.lastHistoryContent = historyString;
            let previousDate = '';
            let finalHtml = messages.map(msg => {
                const roleClass = msg.author_role === 'operator' ? 'operator' : (msg.role === 'assistant' ? 'assistant' : 'user');
                const messageDate = formatMessageDate(msg.timestamp);
                const dateSeparator = messageDate && messageDate !== previousDate
                    ? `<div class="date-separator"><span>${escapeHtml(messageDate)}</span></div>`
                    : '';
                previousDate = messageDate || previousDate;
                const contentHtml = renderMessageContent(msg, sessionId);
                const isEmail = sessionId && sessionId.startsWith('email_');
                const attachmentsHtml = isEmail ? '' : renderMessageAttachments(msg.attachments);
                const timeHtml = `<span class="operator-message-time">${escapeHtml(formatMessageTime(msg.timestamp))}</span>`;
                const avatarHtml = roleClass === 'operator' ? renderOperatorAvatar() : '';
                const deleteButton = Number.isInteger(msg.id) ? `<button type="button" class="message-delete-button action-btn-circle sm btn-danger" data-message-id="${msg.id}" aria-label="Удалить сообщение" title="Удалить сообщение"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>` : '';
                return `${dateSeparator}<div class="modal-msg ${roleClass}${isEmail ? ' email-message' : ''}">${deleteButton}<div class="operator-message-row"><div class="msg-bubble"><div class="msg-text-content">${contentHtml}</div>${attachmentsHtml}${timeHtml}</div>${avatarHtml}</div></div>`;
            }).join('');
            container.innerHTML = finalHtml || '<div class="empty-state">История пуста</div>';
        } else {
            // Инкрементальное обновление для фоновых запросов
            const currentMsgCount = container.querySelectorAll('.modal-msg').length;
            if (messages.length > currentMsgCount) {
                const newMessages = messages.slice(currentMsgCount);
                for (const msg of newMessages) {
                    const roleClass = msg.author_role === 'operator' ? 'operator' : (msg.role === 'assistant' ? 'assistant' : 'user');
                    const contentHtml = renderMessageContent(msg, sessionId);
                    const isEmail = sessionId && sessionId.startsWith('email_');
                    const attachmentsHtml = isEmail ? '' : renderMessageAttachments(msg.attachments);
                    const messageDate = formatMessageDate(msg.timestamp);
                    const lastSeparator = container.querySelector('.date-separator:last-of-type span')?.textContent;
                    if (messageDate && messageDate !== lastSeparator) {
                        const separator = document.createElement('div');
                        separator.className = 'date-separator';
                        separator.innerHTML = `<span>${escapeHtml(messageDate)}</span>`;
                        container.appendChild(separator);
                    }

                    const msgDiv = document.createElement('div');
                    msgDiv.className = `modal-msg ${roleClass}${isEmail ? ' email-message' : ''}`;
                    const avatarHtml = roleClass === 'operator' ? renderOperatorAvatar() : '';
                    const deleteButton = Number.isInteger(msg.id) ? `<button type="button" class="message-delete-button action-btn-circle sm btn-danger" data-message-id="${msg.id}" aria-label="Удалить сообщение" title="Удалить сообщение"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>` : '';
                    msgDiv.innerHTML = `${deleteButton}<div class="operator-message-row"><div class="msg-bubble"><div class="msg-text-content"></div>${attachmentsHtml}<span class="operator-message-time">${escapeHtml(formatMessageTime(msg.timestamp))}</span></div>${avatarHtml}</div>`;
                    container.appendChild(msgDiv);

                    const textContent = msgDiv.querySelector('.msg-text-content');
                    const isTypingEffect = state.widgetConfig?.theme?.msg_typing_effect === 'typewriter';

                    if (msg.role === 'assistant' && isTypingEffect) {
                        await typeTextEffect(textContent, contentHtml);
                    } else {
                        textContent.innerHTML = contentHtml;
                    }
                }
            }
            state.lastHistoryContent = historyString;
        }
        
        initEmailShadowDOM();

        if (isAtBottom || !isSilent) {
            container.scrollTop = container.scrollHeight;
        }
    } catch (e) {
        console.error('[ChatHistory] Error loading history:', e);
    }
}

export function stopHistoryUpdate() {
    if (state.historyUpdateTimer) clearInterval(state.historyUpdateTimer);
    state.historyUpdateTimer = null;
}

export function startHistoryUpdate(sessionId) {
    stopHistoryUpdate();
    state.historyUpdateTimer = setInterval(() => loadChatHistory(sessionId, true), 3000);
}

// Привязываем вспомогательные функции к глобальному объекту для доступа извне, если нужно
window.DialogsProfileHelpers = {
    addContactField,
    removeContactField,
    saveClientProfile,
    toggleEmail: function(header) {
        const wrapper = header.parentElement;
        wrapper.classList.toggle('collapsed');
    }
};
