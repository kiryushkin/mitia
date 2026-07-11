/**
 * Оркестратор модуля диалогов
 * Собирает state, api, websocket, UI-компоненты в единый DialogsModule
 */

import { state, resetState } from './state.js';
import {
    fetchSessions,
    fetchAdminConfig,
    saveAdminConfig,
    fetchCloseReasons,
    createCloseReason,
} from './api.js';
import { disconnectWebSocket } from './websocket.js';
import { bindEvents, initMobileFilters } from './ui/filters.js';
import { initCalendar } from './ui/calendar.js';
import { renderDialogs, updateSidebarNotify, updateSelectUI, initInfiniteScroll } from './ui/list.js';
import { setOnDialogsChanged, renderDialogSidebar } from './ui/modal.js';

/**
 * Загрузка диалогов с сервера
 */
async function loadDialogsFromServer(isSilent = false) {
    try {
        const searchQuery = document.getElementById('dialogs-search')?.value || '';
        
        // Сбрасываем страницу при поиске (если это не фоновое обновление)
        if (!isSilent) state.currentPage = 1;

        const newData = await fetchSessions(searchQuery);

        if (!isSilent) {
            const hasUnread = newData.some(d => !d.is_read || d.is_operator_mode);
            updateSidebarNotify(hasUnread);
        }

        // Нормализуем metadata_json для корректного сравнения
        const normalizeMeta = (d) => ({
            ...d,
            metadata_json: typeof d.metadata_json === 'string'
                ? JSON.parse(d.metadata_json)
                : d.metadata_json
        });
        const newNorm = newData.map(normalizeMeta);
        
        // УМНОЕ ОБНОВЛЕНИЕ: сохраняем локально распознанные имена
        newNorm.forEach(newD => {
            const oldD = state.dialogs.find(d => d.session_id === newD.session_id);
            if (oldD) {
                // Если в старом объекте было имя, а в новом нет - сохраняем старое
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

/**
 * Массовое изменение статуса
 */
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
                        // Переключаем в режим оператора
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

/**
 * Массовое удаление
 */
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

/**
 * Автообновление списка диалогов
 */
function startAutoUpdate() {
    if (state.autoUpdateTimer) clearInterval(state.autoUpdateTimer);
    state.autoUpdateTimer = setInterval(() => {
        const searchInput = document.getElementById('dialogs-search');
        if (!searchInput || !searchInput.value.trim()) {
            loadDialogsFromServer(true);
        }
    }, 5000);
}


/**
 * Единый экспортируемый объект (совместим с admin.js)
 */
export const DialogsModule = {
    get state() { return state; },

    async init() {
        console.log('Dialogs module V2 initialized');

        if (state.autoUpdateTimer) clearInterval(state.autoUpdateTimer);
        if (state.historyUpdateTimer) clearInterval(state.historyUpdateTimer);
        disconnectWebSocket();

        resetState();

        const urlParams = new URLSearchParams(window.location.search);
        state.activeClientId = urlParams.get('client_id') || localStorage.getItem('chat_client_id') || null;

        // Колбэк при изменении диалогов из модалки
        setOnDialogsChanged(() => loadDialogsFromServer(true));

        bindEvents({
            onSearch: () => loadDialogsFromServer(),
            onBatchStatus: (status) => batchChangeStatus(status),
            onBatchDelete: () => batchDelete()
        });
        initMobileFilters();
        updateSelectUI();
        initInfiniteScroll();
        initCalendar(() => {
            state.currentPage = 1;
            renderDialogs();
        });
        await loadDialogsFromServer();

        try {
            const cfg = await fetchAdminConfig(state.activeClientId);
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
        } catch (e) {
            console.error('Failed to load operator name config', e);
        }

        // Deep Linking: если в URL есть session_id или был передан deepSessionId, открываем его
        const sid = new URLSearchParams(window.location.search).get('session_id') || window.deepSessionId;

        if (sid) {
            const { openDialog } = await import('./ui/modal.js');
            await openDialog(sid);
            window.deepSessionId = null;
        }

        startAutoUpdate();

        // Принудительно скрываем прелоадер после инициализации модуля
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

        const operatorNameInput = document.getElementById('dialogs-operator-name-input');
        if (operatorNameInput) {
            const name = operatorNameInput.value.trim();
            const result = await saveAdminConfig({ theme: { msg_operator_name: name } }, state.activeClientId);
            if (!result?.ok) {
                throw new Error('Failed to save msg_operator_name');
            }
        }

        // Проверяем, открыт ли режим редактирования (по наличию кнопки Отмена)
        const btnCancel = document.getElementById('btn-cancel-profile');
        if (btnCancel && btnCancel.style.display === 'flex') {
            return await saveClientProfile();
        }
        return true;
    }

};
