import { state, getFilteredDialogs } from '../state.js';
import { renderDialogs, updateSelectUI } from './list.js';
import { renderCalendar } from './calendar.js';

let onSearch = null;
let onBatchDelete = null;
let draftAssistantFilter = [];
let saveHandlerBound = false;

function getAppliedAssistantFilter() {
    return window.AdminApp?.getDialogsAssistantFilter?.() || [];
}

function setDraftAssistantFilter(value) {
    draftAssistantFilter = Array.isArray(value) ? [...value] : [];
    if (window.AdminApp?.modules?.dialogs) {
        window.AdminApp.modules.dialogs._draftAssistantFilterPreview = [...draftAssistantFilter];
    }
}

async function renderAssistantButtons() {
    const container = document.getElementById('assistant-buttons');
    if (!container) return;

    let assistants = window.AdminApp?.getAssistantsList?.() || [];
    if (!assistants.length) {
        try {
            const token = localStorage.getItem('chatadmin_auth_token');
            const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
            const res = await fetch(`/api/chat/admin/assistants?client_id=${encodeURIComponent(clientId)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            assistants = Array.isArray(data.assistants)
                ? data.assistants.map((item) => ({
                    assistant_id: item.assistant_id,
                    name: item.name || item.config?.bot_settings?.bot_name || item.assistant_id,
                }))
                : [];
            window.AdminApp?.setAssistantsList?.(assistants);
        } catch (_) {
            assistants = [];
        }
    }

    const active = draftAssistantFilter;
    const items = [...assistants];

    container.innerHTML = items.map((item) => `
        <button class="filter-btn${active.includes(item.assistant_id) ? ' active' : ''}" data-assistant-filter="${item.assistant_id}">${item.name}</button>
    `).join('');

    container.querySelectorAll('[data-assistant-filter]').forEach((btn) => {
        btn.onclick = () => {
            const next = btn.dataset.assistantFilter || '';
            const current = [...draftAssistantFilter];
            const idx = current.indexOf(next);
            if (idx >= 0) current.splice(idx, 1);
            else current.push(next);
            setDraftAssistantFilter(current);
            renderAssistantButtons();
            state.currentPage = 1;
            if (onSearch) onSearch();
        };
    });
}

function updateModeButtonsUI() {
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
}

export async function bindEvents(callbacks = {}) {
    onSearch = callbacks.onSearch || null;
    onBatchDelete = callbacks.onBatchDelete || null;

    if (!saveHandlerBound) {
        document.addEventListener('click', async (event) => {
            const saveBtn = event.target.closest('#global-save-btn, #dialog-sidebar-save-btn');
            const dialogsActive = document.querySelector('.nav-item.active[data-tab="dialogs"]')
                || document.querySelector('.admin-sidebar.dialog-mode');
            if (!saveBtn || !dialogsActive) return;
            const applied = getAppliedAssistantFilter();
            const changed = JSON.stringify(applied) !== JSON.stringify(draftAssistantFilter);
            if (!changed) return;
            window.AdminApp?.setDialogsAssistantFilter?.(draftAssistantFilter);
            state.currentPage = 1;
            if (onSearch) onSearch();
        }, true);
        saveHandlerBound = true;
    }

    document.querySelectorAll('#status-buttons .filter-btn').forEach(btn => {
        btn.onclick = () => {
            const filter = btn.dataset.filter;
            if (state.activeFilters.has(filter)) {
                state.activeFilters.delete(filter);
                btn.classList.remove('active');
            } else {
                state.activeFilters.add(filter);
                btn.classList.add('active');
            }
            state.currentPage = 1;
            renderDialogs();
        };
    });

    document.querySelectorAll('#mode-buttons .filter-btn').forEach(btn => {
        btn.onclick = () => {
            const mode = (btn.dataset.mode || '').trim();
            if (!mode || mode === 'all') {
                state.activeModes.clear();
            } else if (state.activeModes.has(mode)) {
                state.activeModes.clear();
            } else {
                state.activeModes = new Set([mode]);
            }
            updateModeButtonsUI();
            state.currentPage = 1;
            renderDialogs();
        };
    });

    document.querySelectorAll('#platform-buttons .filter-btn').forEach(btn => {
        btn.onclick = () => {
            const platform = btn.dataset.platform;
            if (state.activePlatforms.has(platform)) {
                state.activePlatforms.delete(platform);
                btn.classList.remove('active');
            } else {
                state.activePlatforms.add(platform);
                btn.classList.add('active');
            }
            state.currentPage = 1;
            renderDialogs();
        };
    });

    const searchInput = document.getElementById('dialogs-search');
    if (searchInput) {
        let searchTimeout;
        searchInput.oninput = (e) => {
            state.searchQuery = e.target.value.toLowerCase();
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                if (onSearch) onSearch();
            }, 300);
        };
    }

    const btnToggle = document.getElementById('btn-toggle-select');
    if (btnToggle) {
        btnToggle.onclick = () => {
            if (!state.selectMode) {
                state.selectMode = true;
                state.selectModeByToggle = true;
            } else if (!state.selectModeByToggle) {
                state.selectedSessions = new Set();
                state.selectModeByToggle = true;
            } else {
                state.selectMode = false;
                state.selectModeByToggle = false;
                state.selectedSessions = new Set();
            }
            updateSelectUI();
            renderDialogs();
        };
    }

    const btnStatus = document.getElementById('btn-batch-status');
    const statusDropdown = document.getElementById('batch-status-dropdown');
    if (btnStatus && statusDropdown) {
        btnStatus.onclick = (e) => {
            e.stopPropagation();
            if (statusDropdown.parentElement !== document.body) {
                document.body.appendChild(statusDropdown);
            }
            const rect = btnStatus.getBoundingClientRect();
            statusDropdown.style.top = (rect.bottom + 8) + 'px';
            statusDropdown.style.left = rect.left + 'px';
            statusDropdown.classList.toggle('show');
        };
        statusDropdown.querySelectorAll('.dropdown-item').forEach(item => {
            item.onclick = (e) => {
                e.stopPropagation();
                const st = item.dataset.status;
                if (st && callbacks.onBatchStatus) callbacks.onBatchStatus(st);
                statusDropdown.classList.remove('show');
            };
        });
        document.addEventListener('click', (e) => {
            if (!statusDropdown.contains(e.target) && e.target !== btnStatus) {
                statusDropdown.classList.remove('show');
            }
        });
    }

    const btnDelete = document.getElementById('btn-batch-delete');
    if (btnDelete) {
        btnDelete.onclick = (e) => {
            e.stopPropagation();
            if (statusDropdown) statusDropdown.classList.remove('show');
            if (onBatchDelete) onBatchDelete();
        };
    }

    const btnSelectAll = document.getElementById('btn-batch-select-all');
    if (btnSelectAll) {
        btnSelectAll.onclick = () => {
            if (!state.selectMode) {
                state.selectMode = true;
            }
            state.selectModeByToggle = false;
            const allVisibleIds = getFilteredDialogs().map(d => d.session_id);
            const allSelected = allVisibleIds.length > 0 && allVisibleIds.every(id => state.selectedSessions.has(id));

            if (allSelected) {
                allVisibleIds.forEach(id => state.selectedSessions.delete(id));
            } else {
                allVisibleIds.forEach(id => state.selectedSessions.add(id));
            }
            updateSelectUI();
            renderDialogs();
        };
    }

    const btnReset = document.getElementById('btn-reset-filters');
    if (btnReset) {
        btnReset.onclick = (e) => {
            e.stopPropagation();

            const doReset = () => resetFilters();

            if (typeof window.showAlert === 'function') {
                const overlay = window.showAlert('tmpl-confirm-alert', {
                    title: 'Сбросить фильтры?',
                    text: 'Поиск, даты и выбранные фильтры будут очищены.'
                });

                if (overlay) {
                    const confirmBtn = overlay.querySelector('#confirm-yes');
                    const cancelBtn = overlay.querySelector('#confirm-cancel');
                    const close = () => {
                        overlay.style.opacity = '0';
                        document.body.style.overflow = '';
                        setTimeout(() => overlay.remove(), 300);
                    };

                    if (confirmBtn) {
                        confirmBtn.textContent = 'Сбросить';
                        confirmBtn.onclick = () => { doReset(); close(); };
                    }
                    if (cancelBtn) cancelBtn.onclick = close;
                    return;
                }
            }

            if (confirm('Сбросить фильтры диалогов?')) doReset();
        };
    }

    setDraftAssistantFilter(getAppliedAssistantFilter());
    await renderAssistantButtons();

    // Принудительно обновляем кнопки при инициализации
    updateModeButtonsUI();
}

export function applyAssistantFilterDraft(value) {
    setDraftAssistantFilter(value);
    renderAssistantButtons();
}

export function resetFilters() {
    state.activeFilters.clear();
    state.activePlatforms.clear();
    state.activeModes.clear();
    state.searchQuery = '';
    state.currentPage = 1;
    state.periodPreset = null;
    state.dateRange = { from: null, to: null };

    const searchInput = document.getElementById('dialogs-search');
    if (searchInput) searchInput.value = '';

    document.querySelectorAll('#card-dialogs-filters .filter-btn').forEach(btn => btn.classList.remove('active'));
    setDraftAssistantFilter([]);
    window.AdminApp?.setDialogsAssistantFilter?.([]);
    renderAssistantButtons();
    updateModeButtonsUI();

    renderCalendar();
    renderDialogs();
    if (onSearch) onSearch();
}



