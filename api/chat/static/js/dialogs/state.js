/**
 * Состояние модуля диалогов
 */

export const state = {
    dialogs: [],
    widgetConfig: null,
    activeFilters: new Set(),
    activePlatforms: new Set(),
    activeModes: new Set(),
    dateRange: { from: null, to: null },
    calendarYear: null,
    calendarMonth: null,
    autoUpdateTimer: null,
    activeSessionId: null,
    activeClientId: null,
    historyUpdateTimer: null,
    lastHistoryContent: '',
    socket: null,
    typingTimeout: null,
    searchQuery: '',
    selectMode: false,
    selectModeByToggle: false,
    selectedSessions: new Set(),
    // Пагинация
    pageSize: 20,
    currentPage: 1,
    // Позиция списка диалогов до входа в режим открытого диалога
    listScrollBeforeDialogOpen: null
};

/**
 * Фильтрация диалогов по текущим активным фильтрам
 */
export function getFilteredDialogs() {
    let filtered = state.dialogs;

    // Фильтр по статусу
    if (state.activeFilters.size > 0) {
        filtered = filtered.filter(d => {
            const isUnread = !d.is_read;
            const isLead = (d.status === 'lead' || d.ai_intent === 'lead');
            const isSpam = d.status === 'spam';
            const isArchive = d.is_archived === true || d.status === 'archive';
            const isApplication = d.is_operator_mode === true && !isLead && !isArchive && !isSpam;
            const isRead = d.is_read && (d.status === 'new' || !d.status) && !isArchive && !isApplication && !isLead && !isSpam;
            let match = false;
            if (state.activeFilters.has('unread') && isUnread) match = true;
            if (state.activeFilters.has('read') && isRead) match = true;
            if (state.activeFilters.has('lead') && isLead) match = true;
            if (state.activeFilters.has('application') && isApplication) match = true;
            if (state.activeFilters.has('spam') && isSpam) match = true;
            if (state.activeFilters.has('archive') && isArchive) match = true;
            return match;
        });
    } else {
        // По умолчанию скрываем спам и архив, если не выбраны соответствующие фильтры
        filtered = filtered.filter(d => {
            const isSpam = d.status === 'spam';
            const isArchive = d.is_archived === true || d.status === 'archive';
            return !isSpam && !isArchive;
        });
    }

    // Фильтр по режиму
    if (state.activeModes.size === 1) {
        if (state.activeModes.has('operator')) {
            filtered = filtered.filter(d => d.is_operator_mode === true);
        } else if (state.activeModes.has('assistant')) {
            filtered = filtered.filter(d => d.is_operator_mode !== true);
        }
    }

    // Фильтр по платформе
    if (state.activePlatforms.size > 0) {
        filtered = filtered.filter(d => {
            let platform = d.metadata_json ? d.metadata_json.platform : null;
            if (!platform && d.session_id) {
                if (d.session_id.startsWith('tg-')) platform = 'telegram';
                else if (d.session_id.startsWith('max-')) platform = 'max';
                else if (d.session_id.startsWith('vk-')) platform = 'vk';
                else if (d.session_id.startsWith('email_')) platform = 'email';
                else if (d.session_id.startsWith('avito-')) platform = 'avito';
            }
            if (!platform) platform = 'web';
            return state.activePlatforms.has(platform);
        });
    }

    // Фильтр по дате
    if (state.dateRange.from) {
        const fromDate = new Date(state.dateRange.from + 'T00:00:00');
        const toDate = state.dateRange.to
            ? new Date(state.dateRange.to + 'T23:59:59')
            : new Date(state.dateRange.from + 'T23:59:59');

        filtered = filtered.filter(d => {
            const ts = d.last_time || d.updated_at;
            if (!ts) return false;
            const dDate = new Date(ts);
            return dDate >= fromDate && dDate <= toDate;
        });
    }

    return filtered;
}

/**
 * Сброс состояния к начальным значениям
 */
export function resetState() {
    state.dialogs = [];
    state.activeSessionId = null;
    state.activeClientId = null;
    state.lastHistoryContent = '';
    state.searchQuery = '';
    state.activeFilters.clear();
    state.activePlatforms.clear();
    state.activeModes.clear();
    state.dateRange = { from: null, to: null };
    state.listScrollBeforeDialogOpen = null;
    const now = new Date();
    state.calendarYear = now.getFullYear();
    state.calendarMonth = now.getMonth();
}
