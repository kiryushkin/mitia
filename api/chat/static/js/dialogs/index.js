import { state, resetState } from './state.js';
import {
    fetchSessions,
    fetchAdminConfig,
    fetchAnalyticsSettings,
    fetchIntegrations,
    saveAdminConfig,
    fetchCloseReasons,
    createCloseReason,
} from './api.js';
import { disconnectWebSocket } from './websocket.js';
import { bindEvents, applyAssistantFilterDraft } from './ui/filters.js';
import { initCalendar, renderCalendar } from './ui/calendar.js';
import { renderDialogs, updateSidebarNotify, updateSelectUI, initInfiniteScroll } from './ui/list.js';

function syncAssistantsListFromAdmin() {
    if (!window.AdminApp) return;
    const items = Array.isArray(window.AdminApp.modules?.profile?.state?.assistants_backend_items)
        ? window.AdminApp.modules.profile.state.assistants_backend_items
        : [];
    if (typeof window.AdminApp.setAssistantsList === 'function') {
        window.AdminApp.setAssistantsList(items.map((item) => ({
            assistant_id: item.assistant_id,
            name: item.name || item.config?.bot_settings?.bot_name || item.assistant_id,
        })));
    }
}

function getPersistedDialogsFilters(config) {
    const fallback = { statuses: [], modes: [], platforms: [] };
    if (!config || typeof config !== 'object') return fallback;

    const raw = config.dialogs_filters;
    if (!raw || typeof raw !== 'object') return fallback;

    const statuses = Array.isArray(raw.statuses) ? raw.statuses.map(String) : [];
    const modes = Array.isArray(raw.modes) ? raw.modes.map(String) : [];
    const platforms = Array.isArray(raw.platforms) ? raw.platforms.map(String) : [];
    return { statuses, modes, platforms };
}

function normalizeModeSet(rawModes) {
    const set = new Set((Array.isArray(rawModes) ? rawModes : []).map(String));
    const hasAssistant = set.has('assistant');
    const hasOperator = set.has('operator');

    if (set.has('all') || (hasAssistant && hasOperator) || (!hasAssistant && !hasOperator)) {
        return new Set();
    }

    return new Set([hasAssistant ? 'assistant' : 'operator']);
}

const PLATFORM_FILTERS = [
    { integration: 'widget', platform: 'web', label: 'Веб-сайт' },
    { integration: 'telegram', platform: 'telegram', label: 'Telegram' },
    { integration: 'max', platform: 'max', label: 'MAX' },
    { integration: 'vk', platform: 'vk', label: 'Вконтакте' },
    { integration: 'ok', platform: 'ok', label: 'Одноклассники' },
    { integration: 'email', platform: 'email', label: 'Email' },
    { integration: 'avito', platform: 'avito', label: 'Avito' },
    { integration: 'hh', platform: 'hh', label: 'HeadHunter' },
];

function renderPlatformButtons(integrations) {
    const container = document.getElementById('platform-buttons');
    if (!container) return;

    const enabledPlatforms = PLATFORM_FILTERS.filter(({ integration }) => integrations?.[integration]?.enabled)
        .map(({ platform }) => platform);
    const filterSection = document.getElementById('dialog-channels-filter');
    if (filterSection) filterSection.style.display = enabledPlatforms.length ? '' : 'none';
    state.activePlatforms = new Set(
        [...state.activePlatforms].filter((platform) => enabledPlatforms.includes(platform))
    );

    container.innerHTML = PLATFORM_FILTERS
        .filter(({ platform }) => enabledPlatforms.includes(platform))
        .map(({ platform, label }) => (
            `<button class="filter-btn${state.activePlatforms.has(platform) ? ' active' : ''}" data-platform="${platform}">${label}</button>`
        ))
        .join('');

    container.querySelectorAll('[data-platform]').forEach((button) => {
        button.onclick = () => {
            const platform = button.dataset.platform;
            if (state.activePlatforms.has(platform)) {
                state.activePlatforms.delete(platform);
            } else {
                state.activePlatforms.add(platform);
            }
            state.currentPage = 1;
            syncFilterButtonsFromState();
            renderDialogs();
        };
    });
}

function syncFilterButtonsFromState() {
    document.querySelectorAll('#status-buttons .filter-btn').forEach((btn) => {
        const key = btn.dataset.filter;
        btn.classList.toggle('active', !!key && state.activeFilters.has(key));
    });

    const activeMode = state.activeModes.has('assistant')
        ? 'assistant'
        : state.activeModes.has('operator')
            ? 'operator'
            : null;

    document.querySelectorAll('#mode-buttons .filter-btn').forEach((btn) => {
        const mode = (btn.dataset.mode || '').trim();
        let isActive = false;
        if (mode === 'all') {
            isActive = !activeMode;
        } else {
            isActive = !!activeMode && mode === activeMode;
        }
        btn.classList.toggle('active', isActive);
    });

    document.querySelectorAll('#platform-buttons .filter-btn').forEach((btn) => {
        const key = btn.dataset.platform;
        btn.classList.toggle('active', !!key && state.activePlatforms.has(key));
    });
}

import { setOnDialogsChanged, renderDialogSidebar } from './ui/modal.js';

async function loadDialogsFromServer(isSilent = false) {
    syncAssistantsListFromAdmin();
    try {
        const searchQuery = document.getElementById('dialogs-search')?.value || '';
        
        if (!isSilent) state.currentPage = 1;

        const newData = await fetchSessions(searchQuery);

        if (!isSilent) {
            const hasUnread = newData.some(d => !d.is_read);
            updateSidebarNotify(hasUnread);
        }

        const normalizeMeta = (d) => ({
            ...d,
            metadata_json: typeof d.metadata_json === 'string'
                ? JSON.parse(d.metadata_json)
                : d.metadata_json
        });
        const newNorm = newData.map(normalizeMeta);
        state.hasLoadedDialogsOnce = true;

        newNorm.forEach(newD => {
            const oldD = state.dialogs.find(d => d.session_id === newD.session_id);
            if (oldD) {
                const oldName = oldD.metadata_json?.first_name || oldD.metadata_json?.name;
                const newName = newD.metadata_json?.first_name || newD.metadata_json?.name;
                if (oldName && !newName) {
                    if (!newD.metadata_json) newD.metadata_json = {};
                    newD.metadata_json.first_name = oldName;
                }
            }
        });

        const oldNorm = state.dialogs.map(normalizeMeta);

        if (JSON.stringify(newNorm) !== JSON.stringify(oldNorm)) {
            state.dialogs = newNorm;
            renderDialogs();
            if (state.activeSessionId) {
                renderDialogSidebar(state.activeSessionId);
            }
        }
    } catch (e) {
        console.error('Failed to load dialogs', e);
    }
}

async function batchChangeStatus(newStatus) {
    const sids = Array.from(state.selectedSessions);
    if (sids.length === 0) return;

    const token = localStorage.getItem('chatadmin_auth_token');
    const clientId = state.activeClientId
        || new URLSearchParams(window.location.search).get('client_id')
        || localStorage.getItem('chat_client_id');

    let archiveCloseReason = null;
    if (newStatus === 'archive') {
        const { showPromptAlert } = await import('./helpers.js?v=1');

        while (true) {
            const reasons = await fetchCloseReasons(clientId, false);
            const pick = await showPromptAlert({
                title: 'Причина закрытия',
                text: 'Выберите причину для архивации выбранных диалогов:',
                confirmText: 'Применить',
                suggestions: [
                    ...reasons.map((r) => ({ label: r.title, key: String(r.id) })),
                    { label: '+ Добавить новую причину', key: '__add__' },
                ],
            });

            if (!pick) return;
            if (typeof pick === 'object' && pick.key === '__add__') {
                const title = await showPromptAlert({
                    title: 'Новая причина',
                    text: 'Введите название причины закрытия:',
                    placeholder: 'Например: Нецелевой запрос',
                    confirmText: 'Сохранить',
                });
                if (!title) continue;
                const created = await createCloseReason(String(title).trim(), clientId);
                if (!created.ok || !created.reason) {
                    alert('Не удалось создать причину.');
                    continue;
                }
                archiveCloseReason = created.reason;
                break;
            }

            const selectedId = Number(pick?.key);
            const selected = reasons.find((r) => r.id === selectedId);
            if (selected) {
                archiveCloseReason = selected;
                break;
            }
        }
    }

    for (const sid of sids) {
        try {
            const url = `/api/chat/admin/history/${sid}/status`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify({ status: newStatus })
            });

            if (res.ok) {
                if (newStatus === 'new' && state.activeSessionId === sid) {
                    const closeBtn = document.querySelector('.chat-modal-overlay .close-modal');
                    if (closeBtn) closeBtn.click();
                }

                const d = state.dialogs.find(item => item.session_id === sid);
                if (d) {
                    d.status = newStatus;
                    if (newStatus === 'archive') {
                        d.is_archived = true;
                        d.is_operator_mode = false;
                        d.close_reason = archiveCloseReason?.title || d.close_reason;
                        fetch(`/api/chat/admin/sessions/${sid}/archive`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': 'Bearer ' + token
                            },
                            body: JSON.stringify({
                                is_archived: true,
                                user_close_reason_id: archiveCloseReason?.id ?? null,
                            })
                        }).catch(() => {});
                    } else if (newStatus === 'lead') {
                        d.is_archived = false;
                        fetch(`/api/chat/admin/sessions/${sid}/archive`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': 'Bearer ' + token
                            },
                            body: JSON.stringify({ is_archived: false })
                        }).catch(() => {});
                    } else if (newStatus === 'application') {
                        d.is_archived = false;
                        d.is_operator_mode = true;
                        fetch(`/api/chat/admin/sessions/${sid}/archive`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': 'Bearer ' + token
                            },
                            body: JSON.stringify({ is_archived: false })
                        }).catch(() => {});
                        fetch(`/api/chat/admin/sessions/${sid}/operator`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': 'Bearer ' + token
                            },
                            body: JSON.stringify({ is_operator: true })
                        }).catch(() => {});
                    }
                }
            }
        } catch (e) {
            console.error('Batch status error for ' + sid, e);
        }
    }

    state.selectedSessions = new Set();
    state.selectMode = false;
    state.selectModeByToggle = false;
    updateSelectUI();
    renderDialogs();
    setTimeout(() => loadDialogsFromServer(true), 2000);
}

function batchDelete() {
    const sids = Array.from(state.selectedSessions);
    if (sids.length === 0) return;

    import('./helpers.js?v=1').then(async ({ showConfirmAlert }) => {
        const confirmed = await showConfirmAlert({
            title: 'Удалить диалоги?',
            text: 'Вы уверены, что хотите удалить ' + sids.length + ' диалог(ов)? Это действие необратимо.',
            confirmText: 'Удалить'
        });

        if (!confirmed) return;

        const token = localStorage.getItem('chatadmin_auth_token');
        for (const sid of sids) {
            try {
                await fetch('/api/chat/admin/sessions/' + sid, {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
            } catch (e) {
                console.error('Batch delete error:', e);
            }
        }
        state.dialogs = state.dialogs.filter(d => !sids.includes(d.session_id));
        state.selectedSessions = new Set();
        state.selectMode = false;
        state.selectModeByToggle = false;
        updateSelectUI();
        renderDialogs();
        await loadDialogsFromServer();
    });
}

function startAutoUpdate() {
    if (state.autoUpdateTimer) clearInterval(state.autoUpdateTimer);
    state.autoUpdateTimer = setInterval(() => {
        const searchInput = document.getElementById('dialogs-search');
        if (!searchInput || !searchInput.value.trim()) {
            loadDialogsFromServer(true);
        }
    }, 5000);
}

export const DialogsModule = {
    get state() { return state; },

    getPreviewAssistantFilter() {
        if (typeof window.AdminApp?.getDialogsAssistantFilter === 'function') {
            const applied = window.AdminApp.getDialogsAssistantFilter() || [];
            if (Array.isArray(this._draftAssistantFilterPreview) && this._draftAssistantFilterPreview.length >= 0) {
                return this._draftAssistantFilterPreview;
            }
            return applied;
        }
        return this._draftAssistantFilterPreview || [];
    },

    async init() {
        console.log('Dialogs module V2 initialized');

        if (state.autoUpdateTimer) clearInterval(state.autoUpdateTimer);
        if (state.historyUpdateTimer) clearInterval(state.historyUpdateTimer);
        disconnectWebSocket();

        resetState();

        const urlParams = new URLSearchParams(window.location.search);
        state.activeClientId = urlParams.get('client_id') || localStorage.getItem('chat_client_id') || null;

        setOnDialogsChanged(() => loadDialogsFromServer(true));

        await bindEvents({
            onSearch: () => {
                return loadDialogsFromServer();
            },
            onBatchStatus: (status) => batchChangeStatus(status),
            onBatchDelete: () => batchDelete()
        });

        // Сворачиваем фильтры по умолчанию на мобильных устройствах и планшетах
        if (window.innerWidth <= 1024) {
            const filtersCard = document.getElementById('card-dialogs-filters');
            if (filtersCard) filtersCard.classList.add('is-collapsed');
        }

        updateSelectUI();
        initInfiniteScroll();

        this._draftAssistantFilterPreview = window.AdminApp?.getDialogsAssistantFilter?.() || [];

        try {
            const analyticsSettings = await fetchAnalyticsSettings(state.activeClientId);
            const today = new Date();
            const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            state.calendarBounds = {
                minDate: analyticsSettings?.calendar_bounds?.min_date || todayKey,
                maxDate: analyticsSettings?.calendar_bounds?.max_date || todayKey,
                maxSource: analyticsSettings?.calendar_bounds?.max_source || 'today'
            };
        } catch (_) {
            const today = new Date();
            const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            state.calendarBounds = {
                minDate: todayKey,
                maxDate: todayKey,
                maxSource: 'today'
            };
        }

        initCalendar(() => {
            state.currentPage = 1;
            renderDialogs();
        });
        await loadDialogsFromServer();

        try {
            const [cfg, integrationSettings] = await Promise.all([
                fetchAdminConfig(state.activeClientId),
                fetchIntegrations(state.activeClientId),
            ]);
            const operatorNameInput = document.getElementById('dialogs-operator-name-input');
            const counter = document.querySelector('.char-counter[data-for="dialogs-operator-name-input"] span');
            if (operatorNameInput) {
                const value = cfg?.theme?.msg_operator_name || '';
                operatorNameInput.value = value;
                if (counter) counter.textContent = String(value.length);

                operatorNameInput.oninput = () => {
                    if (counter) counter.textContent = String(operatorNameInput.value.length);
                    const saveBtn = document.getElementById('global-save-btn');
                    if (saveBtn) saveBtn.classList.add('pulse-active');
                };
            }

            const persisted = getPersistedDialogsFilters(cfg);
            state.activeFilters = new Set(persisted.statuses);
            state.activeModes = normalizeModeSet(persisted.modes);
            state.activePlatforms = new Set(persisted.platforms);
            renderPlatformButtons(integrationSettings || cfg?.integrations || {});
            applyAssistantFilterDraft(window.AdminApp?.getDialogsAssistantFilter?.() || []);
            syncFilterButtonsFromState();
            renderCalendar();
            state.currentPage = 1;
            renderDialogs();
        } catch (e) {
            console.error('Failed to load operator name config', e);
        }

        const sid = new URLSearchParams(window.location.search).get('session_id') || window.deepSessionId;

        if (sid) {
            const { openDialog } = await import('./ui/modal.js');
            await openDialog(sid);
            window.deepSessionId = null;
        }

        startAutoUpdate();

        const loader = document.getElementById('admin-preloader');
        if (loader) loader.style.display = 'none';
    },

    async loadDialogs(isSilent = false) {
        return loadDialogsFromServer(isSilent);
    },

    async loadHistory(sessionId) {
        const { loadChatHistory } = await import('./ui/modal.js');
        return loadChatHistory(sessionId);
    },

    renderOperatorFiles(files, container) {
        import('./ui/list.js').then(m => m.renderOperatorFiles(files, container));
    },

    async saveData() {
        const { saveClientProfile } = await import('./ui/modal.js');

        if (state.activeSessionId) {
            await saveClientProfile();
            return true;
        }

        const operatorNameInput = document.getElementById('dialogs-operator-name-input');
        const name = operatorNameInput ? operatorNameInput.value.trim() : '';
        const filtersPayload = {
            statuses: Array.from(state.activeFilters),
            modes: Array.from(state.activeModes),
            platforms: Array.from(state.activePlatforms)
        };
        const result = await saveAdminConfig({
            theme: { msg_operator_name: name },
            dialogs_filters: filtersPayload
        }, state.activeClientId);
        if (!result?.ok) {
            throw new Error('Failed to save dialogs settings');
        }

        return true;
    }

};
