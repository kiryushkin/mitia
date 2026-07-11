/**
 * Фильтры и события пользовательского ввода
 */

import { state, getFilteredDialogs } from '../state.js';
import { renderDialogs, updateSelectUI } from './list.js';
import { renderCalendar } from './calendar.js';

let onSearch = null;
let onBatchDelete = null;

/**
 * Привязка всех событий
 */
export function bindEvents(callbacks = {}) {
    onSearch = callbacks.onSearch || null;
    onBatchDelete = callbacks.onBatchDelete || null;

    // Фильтры статуса
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

    // Фильтры режима
    document.querySelectorAll('#mode-buttons .filter-btn').forEach(btn => {
        btn.onclick = () => {
            const mode = btn.dataset.mode;
            if (state.activeModes.has(mode)) {
                state.activeModes.delete(mode);
                btn.classList.remove('active');
            } else {
                state.activeModes.add(mode);
                btn.classList.add('active');
            }
            state.currentPage = 1;
            renderDialogs();
        };
    });

    // Фильтры платформы
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

    // Поиск
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

    // Кнопка Выбрать
    const btnToggle = document.getElementById('btn-toggle-select');
    if (btnToggle) {
        btnToggle.onclick = () => {
            if (!state.selectMode) {
                // Включаем ручной режим выбора
                state.selectMode = true;
                state.selectModeByToggle = true;
            } else if (!state.selectModeByToggle) {
                // Если режим включен через "Выделить все",
                // переводим в ручной режим и снимаем все выделения,
                // но оставляем карточки в состоянии выбора
                state.selectedSessions = new Set();
                state.selectModeByToggle = true;
            } else {
                // Выключаем ручной режим выбора полностью
                state.selectMode = false;
                state.selectModeByToggle = false;
                state.selectedSessions = new Set();
            }
            updateSelectUI();
            renderDialogs();
        };
    }

    // Статус dropdown
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

    // Удалить выбранные
    const btnDelete = document.getElementById('btn-batch-delete');
    if (btnDelete) {
        btnDelete.onclick = (e) => {
            e.stopPropagation();
            if (statusDropdown) statusDropdown.classList.remove('show');
            if (onBatchDelete) onBatchDelete();
        };
    }

    // Выбрать все
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

    // Сброс фильтров
    const btnReset = document.getElementById('btn-reset-filters');
    if (btnReset) {
        btnReset.onclick = (e) => {
            e.stopPropagation();
            resetFilters();
        };
    }
}

/**
 * Сброс всех фильтров
 */
export function resetFilters() {
    state.activeFilters.clear();
    state.activePlatforms.clear();
    state.activeModes.clear();
    state.dateRange = { from: null, to: null };
    state.searchQuery = '';
    state.currentPage = 1;

    const searchInput = document.getElementById('dialogs-search');
    if (searchInput) searchInput.value = '';

    document.querySelectorAll('#card-dialogs-filters .filter-btn').forEach(btn => btn.classList.remove('active'));

    renderCalendar();
    renderDialogs();
    if (onSearch) onSearch();
}

/**
 * Мобильная сворачиваемость фильтров
 */
export function initMobileFilters() {
    const toggle = document.getElementById('mobile-filter-toggle');
    const card = document.getElementById('card-dialogs-filters');
    if (!toggle || !card) return;

    toggle.onclick = () => {
        if (window.innerWidth <= 768) {
            card.classList.toggle('expanded');
        }
    };
}


