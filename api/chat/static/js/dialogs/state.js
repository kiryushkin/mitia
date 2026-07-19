export const state = {
    dialogs: [],
    hasLoadedDialogsOnce: false,
    widgetConfig: null,
    activeFilters: new Set(),
    activePlatforms: new Set(),
    activeModes: new Set(),
    dateRange: { from: null, to: null },
    periodPreset: null,
    calendarYear: null,
    calendarMonth: null,
    calendarBounds: {
        minDate: null,
        maxDate: null,
        maxSource: 'today'
    },
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
    pageSize: 20,
    currentPage: 1,
    listScrollBeforeDialogOpen: null
};

export function getFilteredDialogs() {
    let filtered = state.dialogs;

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
    }

    if (state.activeModes.size === 1) {
        if (state.activeModes.has('operator')) {
            filtered = filtered.filter(d => d.is_operator_mode === true);
        } else if (state.activeModes.has('assistant')) {
            filtered = filtered.filter(d => d.is_operator_mode !== true);
        }
    }

    if (state.activePlatforms.size > 0) {
        filtered = filtered.filter(d => {
            let platform = d.metadata_json ? d.metadata_json.platform : null;
            if (!platform && d.session_id) {
                if (d.session_id.startsWith('tg-')) platform = 'telegram';
                else if (d.session_id.startsWith('max-')) platform = 'max';
                else if (d.session_id.startsWith('vk-')) platform = 'vk';
                else if (d.session_id.startsWith('ok-')) platform = 'ok';
                else if (d.session_id.startsWith('email_')) platform = 'email';
                else if (d.session_id.startsWith('avito-')) platform = 'avito';
                else if (d.session_id.startsWith('hh-')) platform = 'hh';
            }
            if (!platform) platform = 'web';
            return state.activePlatforms.has(platform);
        });
    }

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

export function resetState() {
    state.dialogs = [];
    state.hasLoadedDialogsOnce = false;
    state.activeSessionId = null;
    state.activeClientId = null;
    state.lastHistoryContent = '';
    state.searchQuery = '';
    state.activeFilters.clear();
    state.activePlatforms.clear();
    state.activeModes.clear();
    state.dateRange = { from: null, to: null };
    state.periodPreset = null;
    state.listScrollBeforeDialogOpen = null;
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    state.calendarYear = now.getFullYear();
    state.calendarMonth = now.getMonth();
    state.calendarBounds = {
        minDate: todayKey,
        maxDate: todayKey,
        maxSource: 'today'
    };
}
