import { createProfileActivityChart } from './modules/profile-activity-chart.js';
import { FAQModule } from './modules/faq.js';

const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

export const AnalyticsModule = {
    state: {
        initialized: false,
        charts: {},
        dateRange: { from: null, to: null },
        calendarYear: null,
        calendarMonth: null,
        periodPreset: 'week',
        analyticsMode: 'all'
    },

    async init() {
        this.state.initialized = true;

        const now = new Date();
        this.state.calendarYear = now.getFullYear();
        this.state.calendarMonth = now.getMonth();

        this.activityChart = createProfileActivityChart(this);
        this.activityChart.init();

        this.bindFilters();

        // Сворачиваем фильтры по умолчанию на мобильных устройствах и планшетах
        if (window.innerWidth <= 1024) {
            const filtersCard = document.getElementById('card-analytics-filters');
            if (filtersCard) filtersCard.classList.add('is-collapsed');
        }

        this.applyQuickPeriod('week', false);
        this.renderCalendar();
        this.scheduleMidnightRefresh();

        await this.reloadAnalyticsAndFaq();
    },

    bindFilters() {
        const resetBtn = document.getElementById('btn-analytics-reset-filters');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.applyQuickPeriod('week');
            });
        }

        document.querySelectorAll('.analytics-period-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const period = btn.dataset.period;
                if (!period) return;
                this.applyQuickPeriod(period);
            });
        });

        document.querySelectorAll('.analytics-mode-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const mode = (btn.dataset.mode || '').trim();
                if (!mode) return;
                this.state.analyticsMode = mode;
                this.updateModeButtons();
                this.reloadAnalyticsAndFaq();
            });
        });
    },

    applyQuickPeriod(period, withReload = true) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        let from = new Date(today);
        let to = new Date(today);

        if (period === 'today') {
            // from/to already today
        } else if (period === 'yesterday') {
            from.setDate(today.getDate() - 1);
            to.setDate(today.getDate() - 1);
        } else if (period === 'week') {
            from.setDate(today.getDate() - 6);
        } else if (period === 'month') {
            from = new Date(today.getFullYear(), today.getMonth(), 1);
        } else if (period === 'quarter') {
            const quarterMonth = Math.floor(today.getMonth() / 3) * 3;
            from = new Date(today.getFullYear(), quarterMonth, 1);
        } else if (period === 'year') {
            from = new Date(today.getFullYear(), 0, 1);
        }

        this.state.periodPreset = period;
        this.state.dateRange = {
            from: this.dateKey(from),
            to: this.dateKey(to)
        };

        this.state.calendarYear = to.getFullYear();
        this.state.calendarMonth = to.getMonth();

        this.applyDateRangeToChartsState();
        this.renderCalendar();

        if (withReload) {
            this.reloadAnalyticsAndFaq();
        }
    },

    updateQuickPeriodButtons() {
        document.querySelectorAll('.analytics-period-btn').forEach((btn) => {
            const isActive = btn.dataset.period === this.state.periodPreset;
            btn.classList.toggle('active', isActive);
        });
    },

    updateModeButtons() {
        document.querySelectorAll('.analytics-mode-btn').forEach((btn) => {
            const isActive = btn.dataset.mode === this.state.analyticsMode;
            btn.classList.toggle('active', isActive);
        });
    },

    applyDateRangeToChartsState() {
        const from = this.state.dateRange.from;
        const to = this.state.dateRange.to;

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

    buildMonth(year, month) {
        const wrapper = document.createElement('div');
        wrapper.className = 'calendar-month';

        const header = document.createElement('div');
        header.className = 'calendar-month-header';

        const prevBtn = document.createElement('button');
        prevBtn.className = 'calendar-nav-btn';
        prevBtn.type = 'button';
        prevBtn.textContent = '‹';
        prevBtn.onclick = () => this.navCalendar(-1);

        const title = document.createElement('div');
        title.className = 'calendar-month-title';
        title.textContent = `${MONTH_NAMES[month]} ${year}`;

        const nextBtn = document.createElement('button');
        nextBtn.className = 'calendar-nav-btn';
        nextBtn.type = 'button';
        nextBtn.textContent = '›';
        nextBtn.onclick = () => this.navCalendar(1);

        header.appendChild(prevBtn);
        header.appendChild(title);
        header.appendChild(nextBtn);
        wrapper.appendChild(header);

        const weekdays = document.createElement('div');
        weekdays.className = 'calendar-weekdays';
        ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach((d) => {
            const wd = document.createElement('span');
            wd.className = 'calendar-weekday';
            wd.textContent = d;
            weekdays.appendChild(wd);
        });
        wrapper.appendChild(weekdays);

        const daysGrid = document.createElement('div');
        daysGrid.className = 'calendar-days';

        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDow = (firstDay.getDay() + 6) % 7;

        const prevLast = new Date(year, month, 0).getDate();
        for (let i = startDow - 1; i >= 0; i--) {
            const day = prevLast - i;
            daysGrid.appendChild(this.buildDayCell(day, month === 0 ? 11 : month - 1, month === 0 ? year - 1 : year, true));
        }

        for (let d = 1; d <= lastDay.getDate(); d++) {
            daysGrid.appendChild(this.buildDayCell(d, month, year, false));
        }

        const totalCells = startDow + lastDay.getDate();
        const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
        for (let d = 1; d <= remaining; d++) {
            daysGrid.appendChild(this.buildDayCell(d, month === 11 ? 0 : month + 1, month === 11 ? year + 1 : year, true));
        }

        wrapper.appendChild(daysGrid);
        return wrapper;
    },

    buildDayCell(day, month, year, otherMonth) {
        const cell = document.createElement('button');
        cell.className = 'calendar-day';
        cell.textContent = day;
        cell.type = 'button';

        if (otherMonth) cell.classList.add('other-month');

        const date = new Date(year, month, day);
        const dateStr = this.dateKey(date);
        const today = new Date();
        if (date.toDateString() === today.toDateString()) cell.classList.add('today');

        const from = this.state.dateRange.from;
        const to = this.state.dateRange.to;

        if (from && !to && dateStr === from) {
            cell.classList.add('selected', 'single');
        } else {
            if (from && dateStr === from) cell.classList.add('selected', 'range-start');
            if (to && dateStr === to) cell.classList.add('selected', 'range-end');
            if (from && to && dateStr > from && dateStr < to) cell.classList.add('in-range');
        }

        cell.onclick = () => {
            if (otherMonth) return;

            const f = this.state.dateRange.from;
            const t = this.state.dateRange.to;

            if (!f && !t) {
                this.state.dateRange = { from: dateStr, to: null };
                this.state.periodPreset = 'custom';
            } else if (f && !t) {
                if (dateStr === f) {
                    this.state.dateRange = { from: null, to: null };
                } else {
                    this.state.dateRange = {
                        from: dateStr < f ? dateStr : f,
                        to: dateStr > f ? dateStr : f
                    };
                }
                this.state.periodPreset = 'custom';
            } else if (f && t) {
                if (dateStr === f) {
                    this.state.dateRange = { from: t, to: null };
                } else if (dateStr === t) {
                    this.state.dateRange = { from: null, to: null };
                } else {
                    this.state.dateRange = { from: dateStr, to: null };
                }
                this.state.periodPreset = 'custom';
            }

            this.applyDateRangeToChartsState();
            this.renderCalendar();
            this.reloadAnalyticsAndFaq();
        };

        return cell;
    },

    navCalendar(delta) {
        let m = this.state.calendarMonth + delta;
        let y = this.state.calendarYear;
        if (m < 0) { m = 11; y--; }
        if (m > 11) { m = 0; y++; }
        this.state.calendarMonth = m;
        this.state.calendarYear = y;
        this.renderCalendar();
    },

    renderCalendar() {
        const container = document.getElementById('analytics-calendar-single');
        if (!container) return;

        this.updateQuickPeriodButtons();
        this.updateModeButtons();

        container.innerHTML = '';
        container.appendChild(this.buildMonth(this.state.calendarYear, this.state.calendarMonth));

        const info = document.getElementById('analytics-date-range-info');
        if (info) {
            const from = this.state.dateRange.from;
            const to = this.state.dateRange.to;
            if (from && to) {
                info.textContent = `${this.formatDateShort(from)} — ${this.formatDateShort(to)}`;
            } else if (from) {
                info.textContent = `С ${this.formatDateShort(from)} — выберите конечную дату`;
            } else {
                info.textContent = '';
            }
        }
    },

    getClientId() {
        return new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id') || 'mitia_assistant';
    },

    getToken() {
        return localStorage.getItem('chatadmin_auth_token');
    },

    buildRangeQuery(mode) {
        const qp = new URLSearchParams({ client_id: this.getClientId() });
        const from = this.state.dateRange?.from;
        const to = this.state.dateRange?.to;

        if (from && to) {
            qp.set('date_from', from);
            qp.set('date_to', to);
        } else {
            qp.set('days', '7');
        }

        if (mode) qp.set('mode', mode);
        return qp;
    },

    async loadModeComparisonData() {
        try {
            const token = this.getToken();
            const [assistantRes, operatorRes] = await Promise.all([
                fetch(`/api/chat/admin/activity-stats?${this.buildRangeQuery('assistant').toString()}`, {
                    headers: { Authorization: `Bearer ${token}` }
                }),
                fetch(`/api/chat/admin/activity-stats?${this.buildRangeQuery('operator').toString()}`, {
                    headers: { Authorization: `Bearer ${token}` }
                })
            ]);

            if (!assistantRes.ok || !operatorRes.ok) return null;

            const assistantData = await assistantRes.json();
            const operatorData = await operatorRes.json();

            return {
                assistant: Array.isArray(assistantData?.stats) ? assistantData.stats : [],
                operator: Array.isArray(operatorData?.stats) ? operatorData.stats : []
            };
        } catch (_) {
            return null;
        }
    },

    destroyModeCompareCharts() {
        ['modeShare', 'modeTrend', 'modeFunnel'].forEach((key) => {
            if (this.state.charts[key]) {
                this.state.charts[key].destroy();
                delete this.state.charts[key];
            }
        });
    },


    renderModeCompare(payload) {
        const assistantRows = Array.isArray(payload?.assistant) ? payload.assistant : [];
        const operatorRows = Array.isArray(payload?.operator) ? payload.operator : [];

        const shareCanvas = document.getElementById('analytics-mode-share-chart');
        const trendCanvas = document.getElementById('analytics-mode-trend-chart');
        const funnelCanvas = document.getElementById('analytics-mode-funnel-chart');
        if (!shareCanvas || !trendCanvas || !funnelCanvas) return;

        this.destroyModeCompareCharts();

        if (typeof Chart === 'undefined') return;

        const sum = (rows, field) => rows.reduce((acc, row) => acc + Number(row?.[field] || 0), 0);

        const assistantTotals = {
            msgs: sum(assistantRows, 'total_msgs'),
            dialogs: sum(assistantRows, 'total_dialogs'),
            leads: sum(assistantRows, 'leads'),
            applications: sum(assistantRows, 'applications')
        };
        const operatorTotals = {
            msgs: sum(operatorRows, 'total_msgs'),
            dialogs: sum(operatorRows, 'total_dialogs'),
            leads: sum(operatorRows, 'leads'),
            applications: sum(operatorRows, 'applications')
        };

        const totalMsgs = assistantTotals.msgs + operatorTotals.msgs;
        const assistantShare = totalMsgs ? (assistantTotals.msgs / totalMsgs) * 100 : 0;
        const operatorShare = totalMsgs ? (operatorTotals.msgs / totalMsgs) * 100 : 0;

        this.state.charts.modeShare = new Chart(shareCanvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Ассистент', 'Оператор'],
                datasets: [{
                    data: [assistantShare.toFixed(2), operatorShare.toFixed(2)],
                    backgroundColor: ['#7000FF', '#FF007A'],
                    borderColor: ['rgba(112,0,255,0.8)', 'rgba(255,0,122,0.8)'],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                aspectRatio: 1,
                cutout: '64%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: 'rgba(255,255,255,0.82)', usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 13 } }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(20,20,30,0.95)',
                        titleFont: { size: 15, weight: 'bold' },
                        bodyFont: { size: 14 },
                        bodyColor: 'rgba(255,255,255,0.9)',
                        padding: 12,
                        cornerRadius: 8,
                        borderColor: 'rgba(255,255,255,0.15)',
                        borderWidth: 1,
                        displayColors: true,
                        usePointStyle: true,
                        boxWidth: 10,
                        boxHeight: 10,
                        boxPadding: 6,
                        callbacks: {
                            label(context) {
                                const value = Number(context.raw || 0);
                                return `${context.label}: ${value.toFixed(1)}%`;
                            }
                        }
                    }
                }
            }
        });

        const labels = assistantRows.map((row) => {
            const raw = String(row?.date || '');
            if (!raw) return '';
            const d = new Date(`${raw}T00:00:00`);
            return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
        });

        this.state.charts.modeTrend = new Chart(trendCanvas.getContext('2d'), {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Ассистент',
                        data: assistantRows.map((r) => Number(r?.total_msgs || 0)),
                        borderColor: '#7000FF',
                        backgroundColor: 'rgba(112,0,255,0.12)',
                        fill: true,
                        tension: 0.32,
                        pointRadius: 2,
                        borderWidth: 2
                    },
                    {
                        label: 'Оператор',
                        data: operatorRows.map((r) => Number(r?.total_msgs || 0)),
                        borderColor: '#FF007A',
                        backgroundColor: 'rgba(255,0,122,0.12)',
                        fill: true,
                        tension: 0.32,
                        pointRadius: 2,
                        borderWidth: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'bottom', labels: { color: 'rgba(255,255,255,0.82)', usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 13 } } }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: 'rgba(255,255,255,0.78)',
                            font: { size: 13, weight: '600' },
                            maxTicksLimit: 14,
                            padding: 8,
                            autoSkip: true
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255,255,255,0.08)' },
                        ticks: { color: 'rgba(255,255,255,0.72)', font: { size: 12 } }
                    }
                }
            }
        });

        this.state.charts.modeFunnel = new Chart(funnelCanvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['Диалоги', 'Лиды', 'Заявки'],
                datasets: [
                    {
                        label: 'Ассистент',
                        data: [assistantTotals.dialogs, assistantTotals.leads, assistantTotals.applications],
                        backgroundColor: 'rgba(112,0,255,0.7)',
                        borderRadius: 8
                    },
                    {
                        label: 'Оператор',
                        data: [operatorTotals.dialogs, operatorTotals.leads, operatorTotals.applications],
                        backgroundColor: 'rgba(0,229,255,0.7)',
                        borderRadius: 8
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { color: 'rgba(255,255,255,0.82)', usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 13 } } }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: 'rgba(255,255,255,0.78)',
                            font: { size: 13, weight: '600' },
                            maxTicksLimit: 14,
                            padding: 8,
                            autoSkip: true
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255,255,255,0.08)' },
                        ticks: { color: 'rgba(255,255,255,0.72)', font: { size: 12 } }
                    }
                }
            }
        });
    },

    async reloadAnalyticsAndFaq() {
        await this.activityChart.loadAnalyticsData();
        const modeCompare = await this.loadModeComparisonData();
        this.renderModeCompare(modeCompare);
        await Promise.all([
            this.checkAIInsight()
        ]);
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

    buildFaqTrendPoints(series, width = 260, height = 34, pad = 3) {
        const numeric = Array.isArray(series) ? series.map((v) => Number(v) || 0) : [];
        const safe = numeric.length ? numeric : [0];
        const max = Math.max(...safe, 1);
        const min = Math.min(...safe, 0);
        const span = Math.max(1, max - min);
        const innerW = Math.max(1, width - pad * 2);
        const innerH = Math.max(1, height - pad * 2);

        if (safe.length === 1) {
            const y = pad + innerH / 2;
            return `${pad},${y} ${pad + innerW},${y}`;
        }

        return safe.map((value, index) => {
            const x = pad + (index / (safe.length - 1)) * innerW;
            const norm = (value - min) / span;
            const y = pad + (1 - norm) * innerH;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
    },

    buildFaqTrendRowsHtml(rows, options = {}) {
        const palette = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#a8e6cf', '#6ea8ff', '#f78fb3', '#c3aed6', '#7bed9f'];
        const dateLabels = Array.isArray(options.dateLabels) ? options.dateLabels : [];

        const rowsHtml = rows.map((row, index) => {
            const color = palette[index % palette.length];
            const points = this.buildFaqTrendPoints(row.series);
            const title = this.escapeHtml(row.question || '—');
            const total = Number(row.total || 0);

            return `
                <div class="faq-trend-item">
                    <div class="faq-trend-title">${title}</div>
                    <div class="faq-trend-line-row">
                        <svg class="faq-trend-svg" viewBox="0 0 260 34" preserveAspectRatio="none" aria-hidden="true">
                            <polyline class="faq-trend-line-track" points="3,17 257,17"></polyline>
                            <polyline style="stroke:${color}" class="faq-trend-line" points="${points}"></polyline>
                        </svg>
                        <span class="faq-trend-total">${total}</span>
                    </div>
                </div>
            `;
        }).join('');

        if (dateLabels.length <= 1) {
            return rowsHtml;
        }

        const first = dateLabels[0];
        const middle = dateLabels[Math.floor((dateLabels.length - 1) / 2)];
        const last = dateLabels[dateLabels.length - 1];
        const firstShort = this.escapeHtml(this.formatDateShort(first));
        const middleShort = this.escapeHtml(this.formatDateShort(middle));
        const lastShort = this.escapeHtml(this.formatDateShort(last));
        const firstFull = this.escapeHtml(first);
        const middleFull = this.escapeHtml(middle);
        const lastFull = this.escapeHtml(last);

        return `${rowsHtml}
            <div class="faq-trend-axis" aria-hidden="true">
                <span class="faq-trend-axis-label" title="${firstFull}">${firstShort}</span>
                <span class="faq-trend-axis-label" title="${middleFull}">${middleShort}</span>
                <span class="faq-trend-axis-label" title="${lastFull}">${lastShort}</span>
            </div>
        `;
    },

    buildFaqRankRowsHtml(rows) {
        const max = Math.max(...rows.map((row) => Number(row.total || 0)), 1);
        const palette = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#a8e6cf', '#6ea8ff', '#f78fb3', '#c3aed6', '#7bed9f', '#ff9f43', '#5f27cd'];

        return rows.map((row, index) => {
            const total = Number(row.total || 0);
            const pct = Math.max(2, Math.round((total / max) * 100));
            const color = palette[(index * 7 + 3) % palette.length];
            const question = this.escapeHtml(row.question || '—');
            return `
                <div class="faq-rank-item">
                    <div class="faq-rank-title">${question}</div>
                    <div class="faq-rank-line">
                        <div class="faq-bar-track">
                            <div class="faq-bar-fill" style="width:${pct}%;background:${color}"></div>
                        </div>
                        <span class="faq-rank-total">${total}</span>
                    </div>
                </div>
            `;
        }).join('');
    },

    renderFaqCard(rows, options = {}) {
        const container = document.getElementById('faq-container');
        if (!container) return false;

        const dateLabels = Array.isArray(options.dateLabels) ? options.dateLabels : [];
        let periodLabel = '';

        if (dateLabels.length > 1) {
            const from = this.escapeHtml(this.formatDateShort(dateLabels[0]));
            const to = this.escapeHtml(this.formatDateShort(dateLabels[dateLabels.length - 1]));
            periodLabel = `<div class="faq-period-label">Период: ${from} — ${to}</div>`;
        } else if (this.state.dateRange?.from && this.state.dateRange?.to) {
            const from = this.escapeHtml(this.formatDateShort(this.state.dateRange.from));
            const to = this.escapeHtml(this.formatDateShort(this.state.dateRange.to));
            periodLabel = `<div class="faq-period-label">Период: ${from} — ${to}</div>`;
        } else if (this.state.dateRange?.from) {
            const day = this.escapeHtml(this.formatDateShort(this.state.dateRange.from));
            periodLabel = `<div class="faq-period-label">Дата: ${day}</div>`;
        }

        container.innerHTML = `${periodLabel}${this.buildFaqRankRowsHtml(rows)}`;
        return true;
    },

    renderFaqByDay(faqByDay) {
        const days = Array.isArray(faqByDay) ? faqByDay.filter((d) => d && d.date) : [];
        if (!days.length) return false;

        const byQuestion = new Map();

        days.forEach((day, dayIndex) => {
            const requests = Array.isArray(day.frequent_requests) ? day.frequent_requests : [];
            requests.forEach((item) => {
                const question = String(item?.q || item?.question || '').trim();
                if (!question) return;
                const count = Number(item?.count || 0);
                if (!byQuestion.has(question)) {
                    byQuestion.set(question, {
                        question,
                        total: 0,
                        series: new Array(days.length).fill(0)
                    });
                }

                const row = byQuestion.get(question);
                row.total += count;
                row.series[dayIndex] += count;
            });
        });

        const rows = [...byQuestion.values()]
            .filter((row) => row.total > 0)
            .sort((a, b) => b.total - a.total)
            .slice(0, 12);

        if (!rows.length) return false;
        return this.renderFaqCard(rows, { dateLabels: days.map((d) => d.date) });
    },

    renderFaqTotals(items) {
        const safeItems = Array.isArray(items) ? items : [];
        const rows = safeItems
            .map((item) => {
                const question = String(item?.q || item?.question || '').trim();
                const count = Number(item?.count || 0);
                return { question, total: count, series: [count] };
            })
            .filter((item) => item.question && item.total > 0)
            .sort((a, b) => b.total - a.total)
            .slice(0, 12);

        if (!rows.length) return false;

        const labels = [];
        if (this.state.dateRange?.from) labels.push(this.state.dateRange.from);
        if (this.state.dateRange?.to && this.state.dateRange.to !== this.state.dateRange.from) labels.push(this.state.dateRange.to);

        return this.renderFaqCard(rows, { dateLabels: labels });
    },

    renderCaseHistoryPlaceholder(message) {
        const container = document.getElementById('case-history-container');
        if (!container) return;
        container.innerHTML = `<div class="analytics-placeholder"><div class="analytics-placeholder-text">${this.escapeHtml(message)}</div></div>`;
    },

    renderCloseReasonsPlaceholder(message) {
        const container = document.getElementById('close-reasons-container');
        if (!container) return;
        container.innerHTML = `<div class="analytics-placeholder"><div class="analytics-placeholder-text">${this.escapeHtml(message)}</div></div>`;
    },

    renderCloseReasonsAnalytics(data) {
        const container = document.getElementById('close-reasons-container');
        if (!container) return;

        const summary = data?.summary || {};
        const top = Array.isArray(data?.top_user_reasons) ? data.top_user_reasons : [];
        const system = Array.isArray(data?.system_breakdown) ? data.system_breakdown : [];

        const summaryHtml = `
            <div class="close-reasons-summary">
                <div class="close-reasons-summary-item"><div class="close-reasons-summary-label">Закрыто кейсов</div><div class="close-reasons-summary-value">${Number(summary.total_closed || 0)}</div></div>
                <div class="close-reasons-summary-item"><div class="close-reasons-summary-label">Пользовательские причины</div><div class="close-reasons-summary-value">${Number(summary.total_user || 0)}</div></div>
                <div class="close-reasons-summary-item"><div class="close-reasons-summary-label">Системные причины</div><div class="close-reasons-summary-value">${Number(summary.total_system || 0)}</div></div>
                <div class="close-reasons-summary-item"><div class="close-reasons-summary-label">Без причины</div><div class="close-reasons-summary-value">${Number(summary.total_unknown || 0)}</div></div>
            </div>
        `;

        const topRows = top.length
            ? top.map((row) => `
                <div class="close-reasons-row">
                    <div class="close-reasons-row-name" title="${this.escapeHtml(row.reason || '—')}">${this.escapeHtml(row.reason || '—')}</div>
                    <div class="close-reasons-row-count">${Number(row.count || 0)}</div>
                    <div class="close-reasons-row-share">${Number(row.share_percent || 0).toFixed(2)}%</div>
                </div>
            `).join('')
            : '<div class="analytics-placeholder-text">Нет пользовательских причин за период</div>';

        const systemRows = system.length
            ? system.map((row) => `
                <div class="close-reasons-row">
                    <div class="close-reasons-row-name" title="${this.escapeHtml(row.reason || '—')}">${this.escapeHtml(row.reason || '—')}</div>
                    <div class="close-reasons-row-count">${Number(row.count || 0)}</div>
                    <div class="close-reasons-row-share">&nbsp;</div>
                </div>
            `).join('')
            : '<div class="analytics-placeholder-text">Системные причины не зафиксированы</div>';

        container.innerHTML = `
            ${summaryHtml}
            <div class="close-reasons-block">
                <div class="close-reasons-block-title">Топ пользовательских причин</div>
                <div class="close-reasons-list">${topRows}</div>
            </div>
            <div class="close-reasons-block">
                <div class="close-reasons-block-title">Системные причины (служебные)</div>
                <div class="close-reasons-list">${systemRows}</div>
            </div>
        `;
    },

    async loadCloseReasonsAnalytics() {
        try {
            const token = this.getToken();
            const mode = this.state.analyticsMode === 'all' ? '' : this.state.analyticsMode;
            const qp = this.buildRangeQuery(mode);
            const res = await fetch(`/api/chat/admin/close-reasons-analytics?${qp.toString()}`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!res.ok) {
                this.renderCloseReasonsPlaceholder('Не удалось загрузить аналитику причин закрытия.');
                return;
            }

            const data = await res.json();
            this.renderCloseReasonsAnalytics(data);
        } catch (_) {
            this.renderCloseReasonsPlaceholder('Ошибка загрузки аналитики причин закрытия.');
        }
    },

    renderCaseHistory(dialogs) {
        const container = document.getElementById('case-history-container');
        if (!container) return;

        const safeDialogs = Array.isArray(dialogs) ? dialogs : [];
        if (!safeDialogs.length) {
            this.renderCaseHistoryPlaceholder('За выбранный период кейсы не найдены.');
            return;
        }

        container.innerHTML = safeDialogs.map((dialog) => {
            const sessionId = this.escapeHtml(dialog?.session_id || '—');
            const platform = this.escapeHtml((dialog?.platform || 'web').toString().toUpperCase());
            const latest = this.escapeHtml(this.formatDateTime(dialog?.latest_case_opened));
            const cases = Array.isArray(dialog?.cases) ? dialog.cases : [];

            const casesHtml = cases.map((item) => {
                const number = Number(item?.case_number || 0);
                const opened = this.escapeHtml(this.formatDateTime(item?.opened_at));
                const closed = this.escapeHtml(this.formatDateTime(item?.closed_at));
                const closeReason = this.escapeHtml(item?.close_reason || '—');
                const status = item?.is_active ? '<span class="case-history-status is-active">Открыт</span>' : '<span class="case-history-status">Закрыт</span>';

                return `
                    <div class="case-history-item">
                        <div class="case-history-item-head">
                            <div class="case-history-item-title">Кейс #${number || '—'}</div>
                            ${status}
                        </div>
                        <div class="case-history-item-meta">
                            <span>Открыт: ${opened}</span>
                            <span>Закрыт: ${closed}</span>
                            <span>Причина: ${closeReason}</span>
                        </div>
                    </div>
                `;
            }).join('');

            return `
                <div class="case-history-dialog">
                    <div class="case-history-dialog-head">
                        <div class="case-history-dialog-title">Диалог ${sessionId}</div>
                        <div class="case-history-dialog-badges">
                            <span class="case-history-badge">${platform}</span>
                            <span class="case-history-badge">Последняя активность: ${latest}</span>
                        </div>
                    </div>
                    <div class="case-history-list">
                        ${casesHtml || '<div class="analytics-placeholder-text">Кейсы отсутствуют</div>'}
                    </div>
                </div>
            `;
        }).join('');
    },

    async loadCaseHistory() {
        try {
            const token = this.getToken();
            const mode = this.state.analyticsMode === 'all' ? '' : this.state.analyticsMode;
            const qp = this.buildRangeQuery(mode);
            qp.set('limit_dialogs', '20');
            qp.set('limit_cases', '3');

            const res = await fetch(`/api/chat/admin/dialog-case-history?${qp.toString()}`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!res.ok) {
                this.renderCaseHistoryPlaceholder('Не удалось загрузить историю кейсов.');
                return;
            }

            const data = await res.json();
            this.renderCaseHistory(data?.dialogs);
        } catch (_) {
            this.renderCaseHistoryPlaceholder('Ошибка загрузки истории кейсов.');
        }
    },

    renderAIInsight(data) {
        const insightEl = document.getElementById('ai-insight-text');
        if (!insightEl) return;

        if (data?.status === 'processing') {
            insightEl.innerHTML = '<span class="loading-dots">ИИ анализирует ваши диалоги...</span>';
            return;
        }

        if (data?.status === 'success' && data.business_data) {
            const b = data.business_data;
            let html = '';
            if (b.lost_profit) html += `<div style="margin-bottom:12px"><b style="color:var(--accent)">Упущенная выгода:</b><br>${this.escapeHtml(b.lost_profit)}</div>`;
            if (b.barriers) html += `<div style="margin-bottom:12px"><b style="color:var(--accent)">Барьеры:</b><br>${this.escapeHtml(b.barriers)}</div>`;
            if (b.strategy) html += `<div style="margin-bottom:12px"><b style="color:var(--accent)">Стратегия:</b><br>${this.escapeHtml(b.strategy)}</div>`;
            if (b.sentiment !== undefined) html += `<div style="margin-top:10px;font-size:12px;color:var(--text-muted)">Лояльность: ${Number(b.sentiment || 0)}% | Горячих лидов: ${Number(b.hot_leads_count || 0)}</div>`;
            insightEl.innerHTML = html || 'Рекомендации сформированы.';
            return;
        }

        if (data?.status === 'success' && data.business_recommendations) {
            insightEl.textContent = String(data.business_recommendations);
            return;
        }

        if (data?.status === 'success' && (Array.isArray(data?.frequent_requests) || Array.isArray(data?.faq_by_day))) {
            const hasFaq = (Array.isArray(data?.frequent_requests) && data.frequent_requests.length > 0)
                || (Array.isArray(data?.faq_by_day) && data.faq_by_day.length > 0);
            insightEl.textContent = hasFaq
                ? 'Рекомендации для выбранного периода доступны в блоке «Частые вопросы». Для полного AI-анализа выберите «Общий» режим без узких фильтров.'
                : 'По выбранному периоду пока мало данных для AI-рекомендаций. Попробуйте расширить диапазон дат.';
            return;
        }

        if (data?.status === 'error') {
            insightEl.textContent = data.message || 'Ошибка генерации рекомендаций. Попробуйте позже.';
            return;
        }

        insightEl.textContent = 'Накопите больше диалогов для получения персональных рекомендаций от ИИ.';
    },

    async checkAIInsight() {
        try {
            const clientId = new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id') || 'mitia_assistant';
            const token = localStorage.getItem('chatadmin_auth_token');

            const qp = new URLSearchParams({ client_id: clientId });
            const from = this.state.dateRange.from;
            const to = this.state.dateRange.to;
            if (from && to) {
                qp.set('date_from', from);
                qp.set('date_to', to);
            } else if (from) {
                qp.set('date_from', from);
                qp.set('date_to', from);
            }

            const res = await fetch(`/api/chat/admin/ai-recommendations?${qp.toString()}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) {
                FAQModule.renderPlaceholder();
                this.renderAIInsight({ status: 'error' });
                return;
            }

            const data = await res.json();
            this.renderAIInsight(data);

            if (this.renderFaqByDay(data?.faq_by_day)) {
                return;
            }

            if (this.renderFaqTotals(data?.frequent_requests)) {
                return;
            }

            FAQModule.update(data);
        } catch (e) {
            FAQModule.renderPlaceholder();
            this.renderAIInsight({ status: 'error' });
        }
    },

    destroy() {
        this.clearMidnightRefresh();
        this.destroyModeCompareCharts();

        if (this.activityChart) {
            this.activityChart.destroy();
            this.activityChart = null;
        }
        this.state.initialized = false;
    }
};
