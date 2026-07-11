/**
 * Рендер списка диалогов, статистики, выбора
 */

import { state, getFilteredDialogs } from '../state.js';
import { formatDate, translateIntent, createInitialsPlaceholder, escapeHtml, loadEmailAvatar } from '../helpers.js?v=1';
import { openDialog } from './modal.js';

// Кэш DOM-узлов диалогов для дифференциального рендеринга
const dialogNodes = new Map();

// Observer для ленивой загрузки аватарок
const avatarObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const container = entry.target;
            const data = container.dataset;
            if (data.src) {
                const img = new Image();
                img.className = 'sender-avatar-img';
                img.src = data.src;
                img.onload = () => {
                    container.innerHTML = '';
                    container.appendChild(img);
                };
                img.onerror = () => {
                    container.innerHTML = data.placeholder || '';
                };
                delete container.dataset.src;
                avatarObserver.unobserve(container);
            } else if (data.type === 'email') {
                loadEmailAvatar(container, data.email, data.name, 'sender-avatar-img');
                avatarObserver.unobserve(container);
            }
        }
    });
}, { rootMargin: '100px' });

/**
 * Отрисовка всех диалогов
 */
export function renderDialogs() {
    const container = document.getElementById('dialogs-container');
    const template = document.getElementById('tmpl-dialog-card');

    if (!container || !template) return;

    const filtered = getFilteredDialogs();
    renderStats(filtered);

    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state">Диалогов не найдено</div>';
        dialogNodes.clear();
        return;
    }

    // Пагинация: берем только часть для отрисовки
    const limit = state.currentPage * state.pageSize;
    const visible = filtered.slice(0, limit);

    // Удаляем из DOM те, которых больше нет в видимом списке
    const visibleIds = new Set(visible.map(d => d.session_id));
    for (const [id, node] of dialogNodes.entries()) {
        if (!visibleIds.has(id)) {
            node.remove();
            dialogNodes.delete(id);
        }
    }

    const fragment = document.createDocumentFragment();
    let hasNewElements = false;

    visible.forEach((dialog, index) => {
        let card = dialogNodes.get(dialog.session_id);
        const isNew = !card;

        if (isNew) {
            const clone = document.importNode(template.content, true);
            card = clone.querySelector('.dialog-vizitka');
            dialogNodes.set(dialog.session_id, card);
            hasNewElements = true;
        }

        updateCardData(card, dialog);

        if (isNew) {
            fragment.appendChild(card);
        } else {
            if (container.children[index] !== card) {
                container.insertBefore(card, container.children[index]);
            }
        }
    });

    if (hasNewElements) {
        container.appendChild(fragment);
    }
}

/**
 * Инициализация бесконечного скролла
 */
export function initInfiniteScroll() {
    const container = document.getElementById('dialogs-container');
    if (!container) return;

    container.addEventListener('scroll', () => {
        // Если до конца скролла осталось меньше 200px
        if (container.scrollHeight - container.scrollTop - container.clientHeight < 200) {
            const filtered = getFilteredDialogs();
            if (state.currentPage * state.pageSize < filtered.length) {
                state.currentPage++;
                renderDialogs();
            }
        }
    }, { passive: true });
}

/**
 * Обновление данных конкретной карточки (без пересоздания узла)
 */
function updateCardData(card, dialog) {
    card.dataset.sessionId = dialog.session_id;
    card.dataset.updatedAt = dialog.updated_at || '';

    // Select mode
    const roundCheck = card.querySelector('.dialog-select-round');
    const checkbox = card.querySelector('.dialog-checkbox');
    if (state.selectMode) {
        if (roundCheck) roundCheck.style.display = 'flex';
        card.classList.add('selection-mode');
        const isSel = state.selectedSessions.has(dialog.session_id);
        if (isSel) card.classList.add('selected-dialog');
        else card.classList.remove('selected-dialog');
        if (checkbox) checkbox.checked = isSel;
        card.onclick = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.classList.contains('checkmark')) return;
            toggleSelectDialog(dialog.session_id);
        };
    } else {
        if (roundCheck) roundCheck.style.display = 'none';
        card.classList.remove('selected-dialog');
        card.classList.remove('selection-mode');
        card.onclick = () => openDialog(dialog.session_id);
    }

    const dateEl = card.querySelector('.vizitka-date');
    if (dateEl) dateEl.textContent = formatDate(dialog.last_time || dialog.updated_at);

    const platformEl = card.querySelector('.platform-info');
    if (platformEl) renderPlatformInfo(platformEl, card, dialog);

    card.querySelector('.count-total').textContent = dialog.message_count || 0;
    card.querySelector('.count-user').textContent = dialog.user_messages_count || 0;
    card.querySelector('.count-ai').textContent = dialog.ai_messages_count || 0;
    card.querySelector('.count-operator').textContent = dialog.operator_messages_count || 0;

    const intentTag = card.querySelector('.intent-tag');
    let status = 'new';
    const currentStatus = (dialog.status || '').toLowerCase();

    if (dialog.is_archived || currentStatus === 'archive') status = 'archive';
    else if (currentStatus === 'lead') status = 'lead';
    else if (dialog.is_operator_mode) status = 'application';
    else status = 'read';

    if (status !== 'read') {
        intentTag.style.display = 'inline-block';
        intentTag.textContent = translateIntent(status);
        intentTag.className = `intent-tag intent-${status}`;
    } else {
        intentTag.style.display = 'none';
    }

    const hasNewIndicator = !dialog.is_read;
    if (hasNewIndicator) card.classList.add('is-unread');
    else card.classList.remove('is-unread');

    if (currentStatus === 'lead') card.classList.add('is-lead');
    else card.classList.remove('is-lead');

    if (dialog.mode === 'operator') card.classList.add('is-operator');
    else card.classList.remove('is-operator');

    if (state.activeSessionId === dialog.session_id) card.classList.add('active-card');
    else card.classList.remove('active-card');
}

/**
 * Нормализация контактного саб-поля для карточки
 */
function isLikelyPhone(value) {
    if (value === null || value === undefined) return false;
    const raw = String(value).trim();
    if (!raw) return false;
    const digits = raw.replace(/\D/g, '');
    return digits.length >= 6;
}

function isGenericContactLabel(value) {
    if (value === null || value === undefined) return true;
    const str = String(value).trim();
    if (!str) return true;

    const low = str.toLowerCase();
    const generic = new Set([
        'email', 'e-mail', 'mail', 'почта', 'почта:',
        'телефон', 'phone', 'контакт', 'contact',
        'геопозиция', 'location', 'geo'
    ]);

    return generic.has(low);
}

function normalizeSubValue(value) {
    if (value === null || value === undefined) return '';

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        const str = String(value).trim();
        return isGenericContactLabel(str) ? '' : str;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            const normalized = normalizeSubValue(item);
            if (normalized) return normalized;
        }
        return '';
    }

    if (typeof value === 'object') {
        const lat = value.lat ?? value.latitude ?? value?.geo?.lat ?? value?.location?.lat;
        const lng = value.lng ?? value.lon ?? value.longitude ?? value?.geo?.lng ?? value?.location?.lng ?? value?.location?.lon;
        if (lat !== undefined && lat !== null && lng !== undefined && lng !== null) {
            return `Геопозиция: ${lat}, ${lng}`;
        }

        const rawValue = value.value ?? value.contact ?? value.email ?? value.phone ?? value.text;
        if (rawValue !== undefined && rawValue !== null) {
            const normalizedValue = normalizeSubValue(rawValue);
            if (normalizedValue) return normalizedValue;
            if (isLikelyPhone(rawValue)) return String(rawValue).trim();
        }

        const label = value.label ?? value.title ?? value.name ?? value.address;
        if (label !== undefined && label !== null) {
            const str = String(label).trim();
            if (str && !isGenericContactLabel(str)) {
                return str;
            }
        }

        return '';
    }

    return '';
}

function getPrimaryProfileContact(meta) {
    if (!meta || typeof meta !== 'object') return '';

    const orderedKeys = [
        'phones', 'emails', 'addresses', 'tg_links', 'wa_links',
        'vk_links', 'avito_links', 'ok_links', 'max_links', 'other_links'
    ];

    for (const key of orderedKeys) {
        let items = meta[key];
        if (!items) continue;
        if (!Array.isArray(items)) items = [items];

        for (const item of items) {
            const raw = (typeof item === 'object' && item !== null)
                ? (item.value ?? item.contact ?? item.email ?? item.phone ?? item.text ?? item.label)
                : item;

            if (raw === undefined || raw === null) continue;

            if (isLikelyPhone(raw)) return String(raw).trim();

            const normalized = normalizeSubValue(raw);
            if (normalized) return normalized;
        }
    }

    const legacyCandidates = [meta.contact, meta.phone, meta.email, meta.sender_email, meta.sender_phone];
    for (const raw of legacyCandidates) {
        if (raw === undefined || raw === null) continue;
        if (isLikelyPhone(raw)) return String(raw).trim();
        const normalized = normalizeSubValue(raw);
        if (normalized) return normalized;
    }

    return '';
}

/**
 * Конфигурация платформ для отрисовки карточек
 */
const PLATFORM_CONFIG = {
    telegram: {
        icon: 'icon_telegram.svg',
        label: 'Telegram',
        parse: (meta, sessionId) => {
            const name = `${meta.first_name || ''} ${meta.last_name || ''}`.trim() || meta.username || `User ${sessionId.split('-').pop()}`;
            return {
                name,
                sub: meta.username ? `@${meta.username}` : (meta.user_id ? `ID: ${meta.user_id}` : ''),
                phone: meta.phone || meta.contact || '',
                avatar: meta.photo || meta.photo_url || null
            };
        }
    },
    vk: {
        icon: 'icon_vk.svg',
        label: 'ВКонтакте',
        parse: (meta, sessionId) => {
            const vkId = meta.vk_user_id || sessionId.split('-').pop();
            const name = `${meta.first_name || ''} ${meta.last_name || ''}`.trim() || meta.username || 'ВК Пользователь';
            return {
                name,
                sub: meta.username ? meta.username : (vkId ? `vk.com/id${vkId}` : ''),
                isVkLink: !!vkId && !meta.username,
                vkId: vkId,
                phone: meta.phone || '',
                avatar: meta.photo_url || meta.photo_max || meta.photo_200 || meta.photo_100 || meta.photo || null
            };
        }
    },
    max: {
        icon: 'icon_max.svg',
        label: 'MAX',
        parse: (meta, sessionId) => {
            const sessionTail = String(sessionId || '').split('-').pop();
            const rawUsername = String(meta.username || '').trim().replace(/^@+/, '');
            const phone = meta.phone ? String(meta.phone).trim() : '';
            const userId = meta.user_id ? String(meta.user_id).trim() : '';

            return {
                name: `${meta.first_name || ''} ${meta.last_name || ''}`.trim() || `User ${sessionTail}`,
                sub: rawUsername ? `@${rawUsername}` : (userId ? `ID: ${userId}` : (sessionTail ? `ID: ${sessionTail}` : 'MAX Пользователь')),
                phone,
                avatar: meta.photo || null
            };
        }
    },
    avito: {
        icon: 'icon_avito.svg',
        label: 'Avito',
        parse: (meta) => {
            const rawName = String(meta.name || '').trim();
            const isAutoSyncedName = /^(avito\s+пользователь|пользователь\s+avito)(\s+\d+)?$/i.test(rawName);
            const isDeleted = /удален|удалён/i.test(rawName);
            const name = isAutoSyncedName
                ? 'Avito Пользователь'
                : (rawName || 'Avito Пользователь');

            return {
                name,
                sub: isDeleted ? 'Пользователь удалён' : (isAutoSyncedName ? '' : (meta.avito_user_id ? `ID: ${meta.avito_user_id}` : '')),
                phone: meta.phone || '',
                avatar: meta.avatar_url || null
            };
        }
    },
    email: {
        icon: 'icon_envelope.svg',
        label: 'Email',
        isEmail: true,
        parse: (meta) => {
            let rawSender = meta.sender || meta.first_name || '';
            let email = meta.sender_email || meta.email || '';
            if (rawSender.includes('<')) {
                const match = rawSender.match(/<(.*?)>/);
                if (match) email = match[1];
                rawSender = rawSender.split('<')[0].trim();
            }
            const finalEmail = email.replace(/[<>]/g, '').trim();
            return {
                name: rawSender || finalEmail || 'Без имени',
                sub: finalEmail,
                email: finalEmail,
                phone: meta.phone || ''
            };
        }
    },
    web: {
        icon: 'icon_earth.svg',
        label: 'Веб-сайт',
        parse: (meta) => {
            const firstName = meta.first_name || meta.name || '';
            const lastName = meta.last_name || '';
            const name = `${firstName} ${lastName}`.trim() || 'Посетитель сайта';

            const phoneCandidate = meta.phones?.[0] || meta.phone || '';
            const phone = isLikelyPhone(phoneCandidate) ? String(phoneCandidate).trim() : '';

            const subCandidates = [meta.emails?.[0], meta.email, meta.messengers?.[0], meta.contact, meta.location, meta.geo];
            let sub = '';
            for (const candidate of subCandidates) {
                const normalized = normalizeSubValue(candidate);
                if (normalized && !isLikelyPhone(normalized)) {
                    sub = normalized;
                    break;
                }
            }

            return {
                name: name.charAt(0).toUpperCase() + name.slice(1),
                sub,
                phone,
                isWeb: true
            };
        }
    }
};

/**
 * Рендер информации о платформе и отправителе в карточке
 */
function renderPlatformInfo(platformEl, card, dialog) {
    let meta = dialog.metadata_json;
    if (typeof meta === 'string') {
        try { meta = JSON.parse(meta); } catch (e) { meta = {}; }
    }
    meta = meta || {};

    // Определяем платформу
    let platformKey = meta.platform;
    if (!platformKey && dialog.session_id) {
        if (dialog.session_id.startsWith('tg-')) platformKey = 'telegram';
        else if (dialog.session_id.startsWith('max-')) platformKey = 'max';
        else if (dialog.session_id.startsWith('vk-')) platformKey = 'vk';
        else if (dialog.session_id.startsWith('email_')) platformKey = 'email';
        else if (dialog.session_id.startsWith('avito-')) platformKey = 'avito';
    }
    if (!PLATFORM_CONFIG[platformKey]) platformKey = 'web';

    const config = PLATFORM_CONFIG[platformKey];
    const data = config.parse(meta, dialog.session_id);

    // Приоритет: первый контакт из карточки профиля управляет тем,
    // что показываем в карточке диалога
    const primaryProfileContact = getPrimaryProfileContact(meta);
    if (primaryProfileContact) {
        if (isLikelyPhone(primaryProfileContact)) {
            data.phone = primaryProfileContact;
            data.sub = '';
        } else if (primaryProfileContact.includes('@')) {
            data.email = primaryProfileContact;
            data.sub = primaryProfileContact;
            data.phone = '';
        } else {
            data.sub = primaryProfileContact;
            data.phone = '';
        }
    } else {
        // Фолбэк: если в профиле нет контактов, берем из dialog.client_contact
        if (!data.email && dialog.client_contact && dialog.client_contact.includes('@')) data.email = dialog.client_contact;
        if (!data.phone && dialog.client_contact && isLikelyPhone(dialog.client_contact)) data.phone = String(dialog.client_contact).trim();
        if (!data.sub && dialog.client_contact && !dialog.client_contact.includes('@') && !isLikelyPhone(dialog.client_contact)) {
            data.sub = normalizeSubValue(dialog.client_contact);
        }
    }
    
    // ПРИОРИТЕТ ИМЕНИ: Если в базе есть реальное имя, используем его вместо того, что пришло в Email
    if (dialog.client_name && dialog.client_name !== 'Без имени' && !dialog.client_name.includes('@')) {
        data.name = dialog.client_name;
    }
    
    if (!data.sub && data.email) data.sub = data.email;


    // 1. Иконка платформы
    platformEl.innerHTML = `<img src="/api/chat/img/${config.icon}" class="platform-icon-mini" title="${config.label}">`;

    // 2. Основная информация
    const container = card.querySelector('.email-sender-container');
    const nameEl = card.querySelector('.sender-name');
    const subEl = card.querySelector('.sender-email'); // Используется для username/email/id
    const phoneEl = card.querySelector('.sender-phone');
    const reasonEl = card.querySelector('.sender-archive-reason');
    const avatarWrapper = card.querySelector('.sender-avatar-wrapper');

    if (container && nameEl) {
        nameEl.textContent = data.name;
        nameEl.title = data.name;

        // Саб-инфо (email, id, username)
        if (data.sub) {
            if (data.isVkLink) {
                subEl.innerHTML = `<a href="https://vk.com/id${data.vkId}" target="_blank" style="color: var(--accent); text-decoration: underline;">${data.sub}</a>`;
            } else {
                subEl.textContent = data.sub;
            }
            subEl.style.display = 'block';
            subEl.title = data.sub;
        } else {
            subEl.style.display = 'none';
        }


        // Телефон (если есть)
        if (data.phone) {
            phoneEl.textContent = data.phone;
            phoneEl.style.display = 'block';
            phoneEl.title = data.phone;
        } else {
            phoneEl.style.display = 'none';
        }

        // Причина закрытия для архивных диалогов
        const currentStatus = String(dialog.status || '').toLowerCase();
        const isArchived = dialog.is_archived || currentStatus === 'archive';
        const closeReason = String(dialog.close_reason || '').trim();
        if (reasonEl && isArchived && closeReason) {
            reasonEl.textContent = `Причина: ${closeReason}`;
            reasonEl.title = closeReason;
            reasonEl.style.display = 'block';
        } else if (reasonEl) {
            reasonEl.style.display = 'none';
        }

        // Аватар
        if (avatarWrapper) {
            const placeholder = createInitialsPlaceholder(data.name);
            
            // Если аватар уже отрисован и это тот же URL, ничего не делаем
            if (avatarWrapper.dataset.currentSrc === (data.avatar || data.email || 'none')) {
                return;
            }

            avatarWrapper.innerHTML = placeholder; // Сначала ставим плейсхолдер
            avatarWrapper.style.display = 'block';
            
            if (config.isEmail) {
                avatarWrapper.dataset.type = 'email';
                avatarWrapper.dataset.email = data.email;
                avatarWrapper.dataset.name = data.name;
                avatarWrapper.dataset.currentSrc = data.email;
                avatarObserver.observe(avatarWrapper);
            } else if (data.isWeb) {
                const avatarUrl = state.widgetConfig?.theme?.msg_user_avatar || '/api/chat/img/icon_mitia_white.jpg';
                avatarWrapper.dataset.src = avatarUrl;
                avatarWrapper.dataset.placeholder = placeholder;
                avatarWrapper.dataset.currentSrc = avatarUrl;
                avatarObserver.observe(avatarWrapper);
            } else if (data.avatar) {
                avatarWrapper.dataset.src = data.avatar;
                avatarWrapper.dataset.placeholder = placeholder;
                avatarWrapper.dataset.currentSrc = data.avatar;
                avatarObserver.observe(avatarWrapper);
            } else {
                avatarWrapper.dataset.currentSrc = 'none';
                avatarObserver.unobserve(avatarWrapper);
            }
        }
        container.style.display = 'flex';
    }
}

/**
 * Статистика
 */
export function renderStats(dialogs) {
    const statsEl = document.getElementById('dialogs-stats');
    if (!statsEl) return;

    if (dialogs.length === 0) {
        statsEl.innerHTML = '';
        return;
    }

    let totalMsg = 0, userMsg = 0, aiMsg = 0, opMsg = 0;
    let webCount = 0, tgCount = 0, maxCount = 0, vkCount = 0, emailCount = 0;
    let unreadCount = 0, readCount = 0, leadCount = 0, applicationCount = 0, archiveCount = 0;

    dialogs.forEach(d => {
        totalMsg += d.message_count || 0;
        userMsg += d.user_messages_count || 0;
        aiMsg += d.ai_messages_count || 0;
        opMsg += d.operator_messages_count || 0;

        let platform = d.metadata_json ? d.metadata_json.platform : null;
        if (!platform && d.session_id) {
            if (d.session_id.startsWith('tg-')) platform = 'telegram';
            else if (d.session_id.startsWith('max-')) platform = 'max';
            else if (d.session_id.startsWith('vk-')) platform = 'vk';
            else if (d.session_id.startsWith('email_')) platform = 'email';
        }
        if (!platform) platform = 'web';

        if (platform === 'web') webCount++;
        else if (platform === 'telegram') tgCount++;
        else if (platform === 'max') maxCount++;
        else if (platform === 'vk') vkCount++;
        else if (platform === 'email') emailCount++;

        if (d.is_archived || d.status === 'archive') archiveCount++;
        if (!d.is_read) unreadCount++;
        if (d.is_read && (d.status === 'new' || !d.status) && !d.is_archived && !d.is_operator_mode) readCount++;
        const isArchive = d.is_archived || d.status === 'archive';
        if ((d.status === 'lead' || d.ai_intent === 'lead') && !isArchive) leadCount++;
        if (d.is_operator_mode && !isArchive && d.status !== 'lead') applicationCount++;
    });

    statsEl.innerHTML = `
        <div class="stats-row">
            <div class="stat-item stat-item-bold">Сообщений: ${totalMsg}</div>
            <div class="stat-item"><span class="stat-dot user"></span>Клиент: ${userMsg}</div>
            <div class="stat-item"><span class="stat-dot ai"></span>Бот: ${aiMsg}</div>
            <div class="stat-item"><span class="stat-dot operator"></span>Оператор: ${opMsg}</div>
        </div>
        <div class="stats-row">
            <div class="stat-item stat-item-bold">Диалогов: ${dialogs.length}</div>
            <div class="stat-item"><span class="stat-dot web"></span>Веб-сайт: ${webCount}</div>
            <div class="stat-item"><span class="stat-dot tg"></span>Telegram: ${tgCount}</div>
            <div class="stat-item"><span class="stat-dot max"></span>Max: ${maxCount}</div>
            <div class="stat-item"><span class="stat-dot vk"></span>VK: ${vkCount}</div>
            <div class="stat-item"><span class="stat-dot email"></span>Email: ${emailCount}</div>
        </div>
        <div class="stats-row">
            <div class="stat-item"><span class="stat-dot unread"></span>Не прочитано: ${unreadCount}</div>
            <div class="stat-item"><span class="stat-dot read"></span>Прочитано: ${readCount}</div>
            <div class="stat-item"><span class="stat-dot lead"></span>Лиды: ${leadCount}</div>
            <div class="stat-item"><span class="stat-dot application"></span>Заявки: ${applicationCount}</div>
            <div class="stat-item"><span class="stat-dot archive"></span>Архив: ${archiveCount}</div>
        </div>
    `;
}

/**
 * Обновление индикатора непрочитанных в сайдбаре
 */
export function updateSidebarNotify(hasUnread) {
    const dialogsTab = document.querySelector('.nav-item[data-tab="dialogs"]');
    if (dialogsTab) {
        if (hasUnread) dialogsTab.classList.add('active-notify');
        else dialogsTab.classList.remove('active-notify');
    }
}

/**
 * Обновление UI режима выбора
 */
export function updateSelectUI() {
    const btn = document.getElementById('btn-toggle-select');
    const lbl = document.getElementById('batch-selected-label');
    const btnStatus = document.getElementById('btn-batch-status');
    const btnDelete = document.getElementById('btn-batch-delete');
    const btnSelectAll = document.getElementById('btn-batch-select-all');
    const count = state.selectedSessions.size;

    if (state.selectMode) {
        if (btn) btn.classList.toggle('is-active', !!state.selectModeByToggle);
        if (lbl) lbl.style.display = 'block';

        if (btnSelectAll) {
            const allVisibleIds = getFilteredDialogs().map(d => d.session_id);
            const isAllSelected = allVisibleIds.length > 0 && allVisibleIds.every(id => state.selectedSessions.has(id));
            btnSelectAll.textContent = 'Выделить все';
            btnSelectAll.classList.toggle('active', isAllSelected);
        }
    } else {
        if (btn) btn.classList.remove('is-active');
        if (lbl) lbl.style.display = 'none';
    }

    if (lbl) lbl.textContent = 'Выбрано: ' + count;

    const hasSelection = count > 0;
    const setDisabled = (el, disabled) => {
        if (!el) return;
        el.disabled = disabled;
        el.style.opacity = disabled ? '0.4' : '1';
        el.style.pointerEvents = disabled ? 'none' : '';
    };
    setDisabled(btnStatus, !hasSelection);
    setDisabled(btnDelete, !hasSelection);

    // Выделить все активен всегда
    if (btnSelectAll) {
        btnSelectAll.disabled = false;
        btnSelectAll.style.opacity = '1';
        btnSelectAll.style.pointerEvents = '';

        const allVisibleIds = getFilteredDialogs().map(d => d.session_id);
        const isAllSelected = allVisibleIds.length > 0 && allVisibleIds.every(id => state.selectedSessions.has(id));
        btnSelectAll.textContent = 'Выделить все';
        btnSelectAll.classList.toggle('active', isAllSelected);
    }
}

/**
 * Переключение выбора диалога
 */
export function toggleSelectDialog(sessionId) {
    if (!state.selectMode) return;
    state.selectModeByToggle = true;
    if (state.selectedSessions.has(sessionId)) {
        state.selectedSessions.delete(sessionId);
    } else {
        state.selectedSessions.add(sessionId);
    }
    updateSelectUI();
    renderDialogs();
}

/**
 * Рендер прикреплённых файлов оператора
 */
export function renderOperatorFiles(files, container) {
    if (!container) return;
    container.innerHTML = '';
    files.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'file-preview-item';
        item.innerHTML = `
            <span class="file-name">${escapeHtml(file.name)}</span>
            <span class="file-remove" data-index="${index}">&times;</span>
        `;
        const removeBtn = item.querySelector('.file-remove');
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            files.splice(index, 1);
            renderOperatorFiles(files, container);
        };
        container.appendChild(item);
    });
}
