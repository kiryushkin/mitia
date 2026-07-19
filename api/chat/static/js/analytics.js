import { createProfileActivityChart } from './modules/profile-activity-chart.js?v=120';
import {
    getAppliedAnalyticsAssistantFilter,
    getPreviewAnalyticsAssistantFilter,
    renderAnalyticsAssistantButtons,
    sameAssistantFilter,
} from './modules/analytics-shared.js?v=106';
import { FunnelModule } from './modules/analytics-funnel.js?v=120';
import { CasesModule } from './modules/analytics-cases.js';
import { CalendarModule } from './modules/analytics-calendar.js';
import { FaqModule } from './modules/analytics-faq.js?v=116';

export const AnalyticsModule = {
    state: {
        initialized: false,
        charts: {},
        dateRange: { from: null, to: null },
        calendarYear: null,
        calendarMonth: null,
        periodPreset: null,
        analyticsMode: '',
        faqViewMode: 'summary',
        faqExpanded: true,
        faqCollapsedDaysLimit: 10,
        faqLastSnapshot: null,
        calendarBounds: {
            minDate: null,
            maxDate: null,
            maxSource: 'today'
        },
        draftAssistantFilter: [],
        appliedAssistantFilter: []
    },

    async init() {
        this.state.initialized = true;

        const now = new Date();
        this.state.calendarYear = now.getFullYear();
        this.state.calendarMonth = now.getMonth();

        this.activityChart = createProfileActivityChart(this);
        this.activityChart.init();

        this.bindFilters();
        this.bindFaqUi();
        this.bindGlobalSave();
        this.state.appliedAssistantFilter = getAppliedAnalyticsAssistantFilter();
        this.state.draftAssistantFilter = [...this.state.appliedAssistantFilter];
        await renderAnalyticsAssistantButtons(this.state.draftAssistantFilter);

        if (window.innerWidth <= 1024) {
            const filtersCard = document.getElementById('card-analytics-filters');
            if (filtersCard) filtersCard.classList.add('is-collapsed');
        }

        await this.loadData();
        this.scheduleMidnightRefresh();

        await this.reloadAnalyticsAndFaq();
    },

    bindFaqUi() {
        this.syncFaqUiState();
    },

    bindGlobalSave() {
        if (this._globalSaveBound) return;
        document.addEventListener('click', async (event) => {
            const saveBtn = event.target.closest('#global-save-btn');
            const analyticsNav = document.querySelector('.nav-item.active[data-tab="analytics"]');
            if (!saveBtn || !analyticsNav) return;
            if (sameAssistantFilter(this.state.appliedAssistantFilter, this.state.draftAssistantFilter)) return;
            this.state.appliedAssistantFilter = [...this.state.draftAssistantFilter];
            window.AdminApp?.setAnalyticsAssistantFilter?.(this.state.appliedAssistantFilter);
        }, true);
        this._globalSaveBound = true;
    },

    setDraftAssistantFilter(value) {
        this.state.draftAssistantFilter = Array.isArray(value) ? [...value] : [];
    },

    getPreviewAssistantFilter() {
        return Array.isArray(this.state.draftAssistantFilter)
            ? [...this.state.draftAssistantFilter]
            : [];
    },

    syncFaqUiState() {
        const faqCard = document.getElementById('card-faq');
        if (faqCard) {
            faqCard.classList.remove('faq-collapsed');
        }

    },

    bindFilters() {

        const resetBtn = document.getElementById('btn-analytics-reset-filters');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                const doReset = () => {
                    this.state.analyticsMode = '';
                    this.state.periodPreset = null;
                    this.state.dateRange = { from: null, to: null };
                    this.state.draftAssistantFilter = [];
                    this.applyDateRangeToChartsState();
                    this.updateModeButtons();
                    this.renderCalendar();
                    renderAnalyticsAssistantButtons(this.state.draftAssistantFilter);
                    this.reloadAnalyticsAndFaq();
                };

                if (typeof window.showAlert === 'function') {
                    const overlay = window.showAlert('tmpl-confirm-alert', {
                        title: 'Сбросить фильтры?',
                        text: 'Период и режим будут возвращены к настройкам по умолчанию.'
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

                if (confirm('Сбросить фильтры аналитики?')) doReset();
            });
        }

        document.querySelectorAll('.analytics-period-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const period = btn.dataset.period;
                if (!period) return;

                if (this.state.periodPreset === period) {
                    this.state.periodPreset = null;
                    this.state.dateRange = { from: null, to: null };
                    this.applyDateRangeToChartsState();
                    this.renderCalendar();
                    this.reloadAnalyticsAndFaq();
                    return;
                }

                const bounds = this.getCalendarBounds();
                const isAvailable = this.isQuickPeriodAvailable(period, bounds);
                if (!isAvailable) {
                    const title = 'Период пока недоступен';
                    const text = `Период «${btn.textContent?.trim() || period}» станет доступен после накопления данных. Сейчас доступны даты: ${this.formatDateShort(bounds.min)} — ${this.formatDateShort(bounds.max)}.`;

                    if (typeof window.showAlert === 'function') {
                        window.showAlert('tmpl-error-alert', { title, text });
                    } else {
                        alert(text);
                    }
                    return;
                }

                this.applyQuickPeriod(period);
            });
        });

    },


    applyQuickPeriod(period, withReload = true) {
        const bounds = this.getCalendarBounds();
        if (!this.isQuickPeriodAvailable(period, bounds)) {
            return;
        }
        const maxDateObj = this.parseDateKey(bounds.max) || new Date();
        let to = new Date(maxDateObj.getFullYear(), maxDateObj.getMonth(), maxDateObj.getDate());
        let from = new Date(to);

        if (period === 'today') {
        } else if (period === 'yesterday') {
            from.setDate(to.getDate() - 1);
            to = new Date(from);
        } else if (period === 'week') {
            from.setDate(to.getDate() - 6);
        } else if (period === 'month') {
            from.setDate(to.getDate() - 29);
        } else if (period === 'quarter') {
            from.setDate(to.getDate() - 90);
        } else if (period === 'year') {
            from = new Date(to.getFullYear(), 0, 1);
        }

        let range = {
            from: this.dateKey(from),
            to: this.dateKey(to)
        };
        range = this.clampDateRange(range);

        this.state.periodPreset = period;
        this.state.dateRange = range;

        const calendarTo = this.parseDateKey(range.to) || to;
        this.state.calendarYear = calendarTo.getFullYear();
        this.state.calendarMonth = calendarTo.getMonth();

        this.applyDateRangeToChartsState();
        this.renderCalendar();

        if (withReload) {
            this.reloadAnalyticsAndFaq();
        }
    },

    isQuickPeriodAvailable(period, bounds = this.getCalendarBounds()) {
        if (!period) return false;

        const maxDateObj = this.parseDateKey(bounds.max) || new Date();
        let to = new Date(maxDateObj.getFullYear(), maxDateObj.getMonth(), maxDateObj.getDate());
        let from = new Date(to);

        if (period === 'today') {
        } else if (period === 'yesterday') {
            from.setDate(to.getDate() - 1);
            to = new Date(from);
        } else if (period === 'week') {
            from.setDate(to.getDate() - 6);
        } else if (period === 'month') {
            from.setDate(to.getDate() - 29);
        } else if (period === 'quarter') {
            from.setDate(to.getDate() - 90);
        } else if (period === 'year') {
            from = new Date(to.getFullYear(), 0, 1);
        } else {
            return false;
        }

        const fromKey = this.dateKey(from);
        const toKey = this.dateKey(to);
        return fromKey >= bounds.min && toKey <= bounds.max;
    },

    updateQuickPeriodButtons() {
        const bounds = this.getCalendarBounds();
        document.querySelectorAll('.analytics-period-btn').forEach((btn) => {
            const period = btn.dataset.period;
            const isAvailable = this.isQuickPeriodAvailable(period, bounds);
            const isActive = period === this.state.periodPreset && isAvailable;

            btn.classList.toggle('is-disabled', !isAvailable);
            btn.classList.toggle('active', isActive);
            btn.title = isAvailable ? '' : 'Период станет доступен после накопления данных';
        });
    },

    updateModeButtons() {},

    getTodayDateKey() {
        return this.dateKey(new Date());
    },

    parseDateKey(dateStr) {
        if (!dateStr || typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
        const date = new Date(`${dateStr}T00:00:00`);
        if (Number.isNaN(date.getTime())) return null;
        return date;
    },

    getCalendarBounds() {
        const todayKey = this.getTodayDateKey();
        const rawMin = this.state.calendarBounds?.minDate || todayKey;
        const rawMax = this.state.calendarBounds?.maxDate || todayKey;
        let min = this.parseDateKey(rawMin) ? rawMin : todayKey;
        let max = this.parseDateKey(rawMax) ? rawMax : todayKey;

        if (max > todayKey) max = todayKey;
        if (min > max) min = max;

        return {
            min,
            max,
            maxSource: this.state.calendarBounds?.maxSource || 'today'
        };
    },

    clampDateRange(range = this.state.dateRange) {
        const bounds = this.getCalendarBounds();
        let from = range?.from || null;
        let to = range?.to || null;

        if (from && !this.parseDateKey(from)) from = null;
        if (to && !this.parseDateKey(to)) to = null;

        if (!from && !to) {
            return { from: null, to: null };
        }

        if (from && !to) {
            return {
                from: from < bounds.min ? bounds.min : from,
                to: null
            };
        }

        if (!from && to) {
            return {
                from: null,
                to: to > bounds.max ? bounds.max : to
            };
        }

        if (from > to) [from, to] = [to, from];
        if (from < bounds.min) from = bounds.min;
        if (to > bounds.max) to = bounds.max;
        if (from > to) from = to;

        return { from, to };
    },

    normalizeDateRange(range = this.state.dateRange) {
        return this.clampDateRange(range);
    },

    getEffectiveDateRange() {
        const normalized = this.normalizeDateRange();
        if (normalized.from && normalized.to) {
            return { ...normalized, isFallbackToday: false };
        }

        return { from: null, to: null, isFallbackToday: false };
    },

    isFullFutureRange(range) {
        const normalized = this.normalizeDateRange(range);
        if (!normalized.from || !normalized.to) return false;
        return normalized.from > this.getTodayDateKey();
    },

    applyDateRangeToChartsState() {
        const normalized = this.normalizeDateRange();
        const from = normalized.from;
        const to = normalized.to;

        this.state.dateRange = { from, to };

        if (from && to) {
            this.state.customDateFrom = from;
            this.state.customDateTo = to;
            this.state.activityPeriod = 'custom';
        } else {
            this.state.customDateFrom = null;
            this.state.customDateTo = null;
            this.state.activityPeriod = 7;
        }
    },

    renderCalendar() {
        CalendarModule.renderCalendar(this);
    },

    getClientId() {
        return new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id') || 'mitia_assistant';
    },

    getToken() {
        return localStorage.getItem('chatadmin_auth_token');
    },


    normalizeTime(time) {
        if (!time || typeof time !== 'string') return '03:10';
        const match = time.match(/^(\d{1,2}):(\d{1,2})/);
        if (!match) return '03:10';
        const h = match[1].padStart(2, '0');
        const m = match[2].padStart(2, '0');
        return `${h}:${m}`;
    },

    setTimeInputValue(value) {
        const input = document.getElementById('analytics-ai-time-input');
        if (input) {
            input.value = value || '03:10';
        }
    },

    async loadData() {
        try {
            const clientId = this.getClientId();
            const token = this.getToken();
            if (!token) {
                this.state.analyticsMode = '';
                this.state.periodPreset = null;
                this.state.dateRange = { from: null, to: null };
                FaqModule.applySavedFaqViewMode(this, 'summary');
                this.state.calendarBounds = {
                    minDate: this.getTodayDateKey(),
                    maxDate: this.getTodayDateKey(),
                    maxSource: 'today'
                };
                this.applyDateRangeToChartsState();
                this.renderCalendar();
                this.setTimeInputValue(this.state.aiAnalysisTime);
                this.updateModeButtons();
                return;
            }

            const assistantIds = this.state.appliedAssistantFilter || [];
            const activeAssistantId = window.AdminApp?.getActiveAssistantId?.() || '';
            const assistantQuery = `&assistant_id=${encodeURIComponent(assistantIds.length ? assistantIds.join(',') : 'all')}&active_assistant_id=${encodeURIComponent(activeAssistantId)}`;
            const res = await fetch(`/api/chat/admin/analytics-settings?client_id=${clientId}${assistantQuery}`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!res.ok) {
                this.state.analyticsMode = '';
                this.state.periodPreset = null;
                this.state.dateRange = { from: null, to: null };
                FaqModule.applySavedFaqViewMode(this, 'summary');
                this.state.calendarBounds = {
                    minDate: this.getTodayDateKey(),
                    maxDate: this.getTodayDateKey(),
                    maxSource: 'today'
                };
                this.applyDateRangeToChartsState();
                this.renderCalendar();
                this.setTimeInputValue(this.state.aiAnalysisTime);
                this.updateModeButtons();
                return;
            }

            const data = await res.json();
            const saved = data?.settings || {};
            this.state.appliedAssistantFilter = Array.isArray(saved.assistant_filter)
                ? [...saved.assistant_filter]
                : [...this.state.appliedAssistantFilter];
            this.state.draftAssistantFilter = [...this.state.appliedAssistantFilter];
            window.AdminApp?.setAnalyticsAssistantFilter?.(this.state.appliedAssistantFilter);
            await renderAnalyticsAssistantButtons(this.state.draftAssistantFilter);

            this.state.calendarBounds = {
                minDate: data?.calendar_bounds?.min_date || this.getTodayDateKey(),
                maxDate: data?.calendar_bounds?.max_date || this.getTodayDateKey(),
                maxSource: data?.calendar_bounds?.max_source || 'today'
            };

            this.state.analyticsMode = '';
            FaqModule.applySavedFaqViewMode(this, saved.faq_view_mode);

            const period = String(saved.period || '').trim();
            const allowedPeriods = ['today', 'yesterday', 'week', 'month', 'quarter', 'year'];
            const requestedPeriod = allowedPeriods.includes(period) ? period : null;
            this.state.periodPreset = null;
            this.state.dateRange = { from: null, to: null };
            if (requestedPeriod && this.isQuickPeriodAvailable(requestedPeriod)) {
                this.applyQuickPeriod(requestedPeriod, false);
            } else {
                this.applyDateRangeToChartsState();
                this.renderCalendar();
            }
            this.setTimeInputValue(this.state.aiAnalysisTime);
            this.updateModeButtons();
        } catch (_) {
            this.state.analyticsMode = '';
            this.state.periodPreset = null;
            this.state.dateRange = { from: null, to: null };
            FaqModule.applySavedFaqViewMode(this, 'summary');
            this.state.calendarBounds = {
                minDate: this.getTodayDateKey(),
                maxDate: this.getTodayDateKey(),
                maxSource: 'today'
            };
            this.applyDateRangeToChartsState();
            this.renderCalendar();
            this.setTimeInputValue(this.state.aiAnalysisTime);
            this.updateModeButtons();
        }
    },

    async saveData() {
        const clientId = this.getClientId();
        const token = this.getToken();
        if (!token) throw new Error('Unauthorized');

        const period = String(this.state.periodPreset || '').trim();
        const allowedPeriods = ['today', 'yesterday', 'week', 'month', 'quarter', 'year'];
        const safePeriod = allowedPeriods.includes(period) ? period : '';

        this.state.aiAnalysisTime = this.normalizeTime(this.state.aiAnalysisTime || '03:10');

        const assistantIds = Array.isArray(this.state.draftAssistantFilter) ? this.state.draftAssistantFilter : [];
        const activeAssistantId = window.AdminApp?.getActiveAssistantId?.() || '';
        const assistantQuery = `&assistant_id=${encodeURIComponent(assistantIds.length ? assistantIds.join(',') : 'all')}&active_assistant_id=${encodeURIComponent(activeAssistantId)}`;
        const res = await fetch(`/api/chat/admin/analytics-settings?client_id=${clientId}${assistantQuery}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
                mode: null,
                period: safePeriod || null,
                faq_view_mode: 'summary',
                assistant_filter: assistantIds
            })
        });

        if (!res.ok) {
            throw new Error('Failed to save analytics settings');
        }

        this.state.periodPreset = safePeriod || null;
        this.state.analyticsMode = '';
        this.state.appliedAssistantFilter = [...assistantIds];
        this.state.draftAssistantFilter = [...assistantIds];
        window.AdminApp?.setAnalyticsAssistantFilter?.(assistantIds);
        await renderAnalyticsAssistantButtons(this.state.draftAssistantFilter);
        await this.reloadAnalyticsAndFaq();
    },

    buildRangeQuery(mode = '') {
        const qp = new URLSearchParams({ client_id: this.getClientId() });
        const assistantIds = getPreviewAnalyticsAssistantFilter();
        qp.set('assistant_id', assistantIds.length ? assistantIds.join(',') : 'all');
        const effective = this.getEffectiveDateRange();

        if (effective.from && effective.to) {
            qp.set('date_from', effective.from);
            qp.set('date_to', effective.to);
        }

        const normalizedMode = String(mode || '').trim();
        if (normalizedMode === 'assistant' || normalizedMode === 'operator') {
            qp.set('mode', normalizedMode);
        }

        return qp;
    },



    setCardEmptyState(cardId, isEmpty, message = 'Нет данных за выбранный период') {
        const card = document.getElementById(cardId);
        if (!card) return;

        const chartWrap = card.querySelector('.analytics-main-chart-container');
        if (!chartWrap) return;

        const kindMap = {
            'card-analytics-platforms': 'bars',
            'card-analytics-messages': 'line',
            'card-analytics-results': 'mixed',
            'card-faq': 'bars',
            'card-analytics-mode-share': 'line',
            'card-analytics-mode-trend': 'line',
            'card-analytics-mode-funnel': 'bars'
        };
        const kind = kindMap[cardId] || 'line';

        card.classList.toggle('is-empty', !!isEmpty);

        const existing = chartWrap.querySelector('.analytics-empty-state');
        if (isEmpty) {
            if (!existing) {
                const empty = document.createElement('div');
                empty.className = `analytics-empty-state analytics-empty-state--${kind}`;
                empty.innerHTML = `<div class="analytics-empty-state-text">${this.escapeHtml(message)}</div>`;
                chartWrap.appendChild(empty);
            } else {
                existing.className = `analytics-empty-state analytics-empty-state--${kind}`;
                const textEl = existing.querySelector('.analytics-empty-state-text');
                if (textEl) textEl.textContent = message;
            }
        } else if (existing) {
            existing.remove();
        }
    },

    async reloadAnalyticsAndFaq() {
        const requestGeneration = (this._analyticsRequestGeneration || 0) + 1;
        this._analyticsRequestGeneration = requestGeneration;
        const isCurrent = () => this._analyticsRequestGeneration === requestGeneration;

        await this.activityChart.loadAnalyticsData(isCurrent);
        if (!isCurrent()) return;
        const modeCompare = await FunnelModule.loadModeComparisonData(this);
        if (!isCurrent()) return;
        FunnelModule.renderModeCompare(modeCompare, this);
        await CasesModule.loadCloseReasonsAnalytics(this);
        if (!isCurrent()) return;
        await CasesModule.loadCaseHistory(this);
        if (!isCurrent()) return;
        await this.reloadFaqData(isCurrent);
    },
    scheduleMidnightRefresh() {
        this.clearMidnightRefresh();

        const now = new Date();
        const next = new Date(now);
        next.setHours(24, 0, 0, 0);
        const msUntilMidnight = Math.max(1000, next.getTime() - now.getTime());

        this._midnightTimer = setTimeout(async () => {
            const preset = this.state.periodPreset;
            if (preset && preset !== 'custom' && this.state.initialized) {
                this.applyQuickPeriod(preset);
            }
            this.scheduleMidnightRefresh();
        }, msUntilMidnight);
    },

    clearMidnightRefresh() {
        if (this._midnightTimer) {
            clearTimeout(this._midnightTimer);
            this._midnightTimer = null;
        }
    },

    dateKey(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    },

    formatDateShort(dateStr) {
        if (!dateStr) return '';
        const [y, m, d] = dateStr.split('-');
        return `${d}.${m}.${y}`;
    },

    formatDateTime(value) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return this.escapeHtml(String(value));

        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const yyyy = date.getFullYear();
        const hh = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
    },

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },






    async reloadFaqData(isCurrent = () => true) {
        try {
            const clientId = new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id') || 'mitia_assistant';
            const token = localStorage.getItem('chatadmin_auth_token');

            const qp = new URLSearchParams({ client_id: clientId });
            const assistantIds = getPreviewAnalyticsAssistantFilter();
            qp.set('assistant_id', assistantIds.length ? assistantIds.join(',') : 'all');
            const effective = this.getEffectiveDateRange();
            if (effective.from && effective.to) {
                qp.set('date_from', effective.from);
                qp.set('date_to', effective.to);
            } else {
                const bounds = this.getCalendarBounds();
                if (bounds.min && bounds.max) {
                    qp.set('date_from', bounds.min);
                    qp.set('date_to', bounds.max);
                }
            }

            const res = await fetch(`/api/chat/admin/ai-recommendations?${qp.toString()}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) {
                FaqModule.renderFaqNoData('Не удалось загрузить данные по вопросам клиентов.');
                return;
            }

            const data = await res.json();
            if (!isCurrent()) return;
            this.state.faqLastSnapshot = data;
            this.syncFaqUiState();

            if (data?.future_range || this.isFullFutureRange(this.getEffectiveDateRange())) {
                FaqModule.renderFaqNoData('Для выбранной даты данные пока недоступны. Выберите более ранний период.');
                return;
            }

            const hasFaq = FaqModule.renderFaqFromSnapshot(data, this);
            if (hasFaq) return;

            if (data?.status === 'processing') {
                FaqModule.renderFaqNoData('Ожидаем завершения планового анализа...');
                return;
            }

            if (data?.is_partial && Array.isArray(data?.missing_days) && data.missing_days.length) {
                FaqModule.renderFaqNoData(`За часть выбранного периода данные ещё не готовы (${data.missing_days.length} дн.). Попробуйте позже или выберите меньший период.`);
                return;
            }

            FaqModule.renderFaqNoData(FaqModule.getFaqNoDataMessage(this));
        } catch (e) {
            if (!isCurrent()) return;
            FaqModule.renderFaqNoData('Ошибка загрузки данных по вопросам клиентов.');
        }
    },

    destroy() {
        this.clearMidnightRefresh();
        FunnelModule.destroyCharts();

        if (this.activityChart) {
            this.activityChart.destroy();
            this.activityChart = null;
        }
        this.state.initialized = false;
    }
};
