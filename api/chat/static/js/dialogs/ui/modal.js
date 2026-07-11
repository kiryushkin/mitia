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

/**
 * Форматирование контакта в виде ссылки
 */
function formatContactAsLink(label, value, platform) {
    if (!value) return '';
    const cleanValue = String(value).trim();
    let href = '';
    let text = cleanValue;

    const l = label.toLowerCase();

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
        const val = cleanValue.replace('id', '').split('/').pop();
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
    } else if (l.includes('max') || platform === 'max') {
        const val = cleanValue.split('/').pop();
        href = `https://max.ru/user/${val}`;
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
        const saveBtn = document.getElementById('global-save-btn');
        if (saveBtn) {
            saveBtn.classList.add('pulse-active');
            saveBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                saveClientProfile();
            };
        }
    };

    // Новый контакт добавляется в режиме просмотра (по ТЗ), но он будет сохранен только при нажатии на дискету
    const isEditing = document.getElementById('btn-cancel-profile')?.style.display === 'flex';
    row.querySelector('.contact-view-mode').style.display = isEditing ? 'none' : 'flex';
    row.querySelector('.contact-edit-mode').style.display = isEditing ? 'block' : 'none';

    container.appendChild(row);

    // Активируем глобальную кнопку сохранения сразу после добавления поля
    const globalSaveBtn = document.getElementById('global-save-btn');
    if (globalSaveBtn) {
        globalSaveBtn.classList.add('pulse-active');
        globalSaveBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            saveClientProfile();
        };
    }
}

/**
 * Удаление поля контакта
 */
export function removeContactField(btn) {
    const row = btn.closest('.setting-item');
    if (row) {
        row.remove();
        // Активируем сохранение при удалении поля
        const saveBtn = document.getElementById('global-save-btn');
        if (saveBtn) {
            saveBtn.classList.add('pulse-active');
            saveBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                saveClientProfile();
            };
        }
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
    
    // 2. Сохраняем режим оператора
    const okMode = await toggleOperatorMode(state.activeSessionId, isOperatorMode);

    if (okMeta && okMode) {
        // Моментально обновляем локальный стейт в state.dialogs
        const dialogIdx = state.dialogs.findIndex(d => d.session_id === state.activeSessionId);
        if (dialogIdx !== -1) {
            state.dialogs[dialogIdx].metadata_json = finalMeta;
            state.dialogs[dialogIdx].is_operator_mode = isOperatorMode;
        }

        // Визуальный фидбек на кнопке сохранения
        const globalSaveBtn = document.getElementById('global-save-btn');
        if (globalSaveBtn) {
            const DISKETTE_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v13a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`;
            const CHECK_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e1fd71" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            
            globalSaveBtn.innerHTML = CHECK_SVG;
            globalSaveBtn.classList.remove('pulse-active');
            globalSaveBtn.onclick = null;

            setTimeout(() => {
                // Возвращаем дискету только если кнопка все еще существует в DOM
                const btn = document.getElementById('global-save-btn');
                if (btn) btn.innerHTML = DISKETTE_SVG;
            }, 2000);
        }

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
            { label: 'VK ID', key: 'vk_id', targetKey: 'vk_links', ph: 'ID...' },
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
                            const saveBtn = document.getElementById('global-save-btn');
                            if (saveBtn) {
                                saveBtn.classList.add('pulse-active');
                                saveBtn.onclick = (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    saveClientProfile();
                                };
                            }
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
    const globalSaveBtn = document.getElementById('global-save-btn');
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
                    if (globalSaveBtn) {
                        globalSaveBtn.classList.add('pulse-active');
                        globalSaveBtn.onclick = (ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            saveClientProfile();
                        };
                    }
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
                if (globalSaveBtn && !globalSaveBtn.classList.contains('pulse-active')) {
                    globalSaveBtn.classList.add('pulse-active');
                    globalSaveBtn.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        saveClientProfile();
                    };
                }
            };
        }

        // Управление глобальной кнопкой сохранения
        if (globalSaveBtn) {
            if (edit) {
                globalSaveBtn.classList.add('pulse-active'); // Визуальный акцент
                globalSaveBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    saveClientProfile();
                };
            } else {
                globalSaveBtn.classList.remove('pulse-active');
                globalSaveBtn.onclick = null; // Возвращаем стандартное поведение
            }
        }
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
        const globalSaveBtn = document.getElementById('global-save-btn');
        if (globalSaveBtn) {
            globalSaveBtn.classList.remove('pulse-active');
            globalSaveBtn.onclick = null;
        }
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
            if (globalSaveBtn) {
                globalSaveBtn.classList.add('pulse-active');
                globalSaveBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    saveClientProfile();
                };
            }
        };
    }

    if (btnAdd) btnAdd.style.display = 'flex'; // По умолчанию показываем кнопку плюс

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
    renderDialogSidebar(sessionId);
    loadChatHistory(sessionId);
    startHistoryUpdate(sessionId);

    // Реалтайм-события (typing + новые сообщения)
    connectWebSocket(sessionId, (data) => {
        if (!data || typeof data !== 'object') return;

        if (data.type === 'typing') {
            const isUserTyping = !!data.is_typing && data.author_role !== 'operator';
            updateTypingStatus(isUserTyping);
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

        const globalSaveBtn = document.getElementById('global-save-btn');
        if (globalSaveBtn) {
            globalSaveBtn.classList.remove('pulse-active');
            globalSaveBtn.onclick = null;
            globalSaveBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v13a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`;
        }

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
 * Рендер контента сообщения (с поддержкой HTML для Email)
 */
function renderMessageContent(msg, sessionId) {
    let content = msg.content || msg.text || '';
    const isEmail = sessionId && sessionId.startsWith('email_');
    
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
        
        return `
            <div class="email-wrapper collapsed">
                <div class="email-header" onclick="DialogsModule.toggleEmail(this)">
                    <div class="email-subject"><span>${escapeHtml(subject)}</span></div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="collapse-chevron"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
                <div class="email-shadow-container" id="${shadowId}" data-content="${encodeURIComponent(content)}"></div>
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
                    background: #ffffff;
                    color: #000000;
                    font-family: sans-serif;
                    width: 100%;
                    overflow: hidden;
                }
                div, p, body, html {
                    margin: 0;
                    padding: 0;
                }
                * {
                    max-width: 100% !important;
                    box-sizing: border-box !important;
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

    if (!input || !sendBtn) return;

    // Очищаем старые обработчики (через замену узла или просто переназначение)
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);
    
    const newSendBtn = sendBtn.cloneNode(true);
    sendBtn.parentNode.replaceChild(newSendBtn, sendBtn);

    const handleSend = async () => {
        const text = newInput.value.trim();
        if (!text) return;

        sendTypingStatus(false);
        if (state.typingTimeout) {
            clearTimeout(state.typingTimeout);
            state.typingTimeout = null;
        }

        newInput.value = '';
        newSendBtn.style.display = 'none';
        if (micBtn) micBtn.style.display = 'flex';

        try {
            const ok = await sendOperatorMessage(sessionId, text);
            if (ok) {
                await loadChatHistory(sessionId, true);
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
}

export async function loadChatHistory(sessionId, isSilent = false) {
    const container = document.getElementById('modal-messages-container');
    if (!container) return;
    try {
        // Проверяем, находится ли пользователь внизу (с допуском 50px)
        const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;

        const history = await fetchHistory(sessionId, state.activeClientId);
        let messages = Array.isArray(history) ? history : (history.history || []);

        // Сравниваем с предыдущим контентом, чтобы избежать лишних обновлений и прыжков скролла
        const historyString = JSON.stringify(messages);
        if (isSilent && state.lastHistoryContent === historyString) {
            return;
        }
        state.lastHistoryContent = historyString;

        let finalHtml = messages.map(msg => {
            const roleClass = msg.role === 'assistant' ? 'assistant' : 'user';
            const contentHtml = renderMessageContent(msg, sessionId);
            return `<div class="modal-msg ${roleClass}"><div class="msg-bubble"><div class="msg-text-content">${contentHtml}</div></div></div>`;
        }).join('');
        container.innerHTML = finalHtml || '<div class="empty-state">История пуста</div>';
        
        initEmailShadowDOM();

        // Скроллим вниз только если пользователь был внизу или это не фоновое обновление
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

function resolveCidLinks(html, attachments) { return html; }
