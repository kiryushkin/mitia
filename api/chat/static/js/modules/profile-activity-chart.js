export function createProfileActivityChart(profile) {
    const messageSeriesDefs = [
        { key: 'user_msgs', label: 'Пользователь', color: '#00E5FF', axis: 'y' },
        { key: 'bot_msgs', label: 'Ассистент', color: '#7000FF', axis: 'y' },
        { key: 'operator_msgs', label: 'Оператор', color: '#FF007A', axis: 'y' },
        { key: 'total_msgs', label: 'Всего сообщений', color: '#ffffff', axis: 'y' }
    ];

    const platformSeriesDefs = [
        { key: 'web_dialogs', label: 'Веб', color: '#FFFFFF', axis: 'y' },
        { key: 'tg_dialogs', label: 'Telegram', color: '#2AABEE', axis: 'y' },
        { key: 'vk_dialogs', label: 'VK', color: '#0077FF', axis: 'y' },
        { key: 'email_dialogs', label: 'Email', color: '#f39c12', axis: 'y' },
        { key: 'avito_dialogs', label: 'Avito', color: '#2E7D32', axis: 'y' },
        { key: 'max_dialogs', label: 'MAX', color: '#9B5CFF', axis: 'y' }
    ];

    const resultSeriesDefs = [
        { key: 'leads', label: 'Лид', color: '#CCFF00', axis: 'y', mode: 'percent' },
        { key: 'applications', label: 'Заявка', color: '#00FF94', axis: 'y', mode: 'percent' },
        { key: 'total_dialogs', label: 'Диалоги', color: 'rgba(255,255,255,0.15)', axis: 'y1', mode: 'count' }
    ];

    function ensureState() {
        if (!profile.state.activityPeriod) {
            profile.state.activityPeriod = 7;
        }
        if (!profile.state.analyticsExpandedCard) {
            profile.state.analyticsExpandedCard = null;
        }
    }

    function syncFromUiSettings() {}

    function getClientId() {
        return new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id') || 'mitia_assistant';
    }

    function getToken() {
        return localStorage.getItem('chatadmin_auth_token');
    }

    function buildOutlineLegendLabels(chart) {
        const datasets = chart?.data?.datasets || [];
        const isPercentScale = Number(chart?.options?.scales?.y?.max) === 100;

        return datasets.map((dataset, index) => {
            const bg = Array.isArray(dataset.backgroundColor) ? dataset.backgroundColor[0] : dataset.backgroundColor;
            const br = Array.isArray(dataset.borderColor) ? dataset.borderColor[0] : dataset.borderColor;
            const color = br || bg || '#fff';
            const values = (dataset.data || []).map((value) => Number(value) || 0);
            const total = values.reduce((sum, value) => sum + value, 0);

            let valueLabel = `${Math.round(total)}`;
            if (isPercentScale && dataset.yAxisID !== 'y1') {
                const avg = values.length ? total / values.length : 0;
                valueLabel = `${avg.toFixed(1)}%`;
            }

            return {
                text: `${dataset.label || `Серия ${index + 1}`} ${valueLabel}`,
                fillStyle: 'rgba(0,0,0,0)',
                strokeStyle: color,
                lineWidth: 2,
                fontColor: 'rgba(255,255,255,0.9)',
                hidden: !chart.isDatasetVisible(index),
                datasetIndex: index,
                pointStyle: 'circle'
            };
        });
    }

    function buildBusinessPlatformLegendLabels(chart) {
        const datasets = chart?.data?.datasets || [];
        return datasets.map((dataset, index) => {
            const bg = Array.isArray(dataset.backgroundColor) ? dataset.backgroundColor[0] : dataset.backgroundColor;
            const br = Array.isArray(dataset.borderColor) ? dataset.borderColor[0] : dataset.borderColor;
            const color = br || bg || '#fff';
            const total = (dataset.data || []).reduce((sum, value) => sum + (Number(value) || 0), 0);
            return {
                text: `${dataset.label} ${Math.round(total)}`,
                fillStyle: 'rgba(0,0,0,0)',
                strokeStyle: color,
                lineWidth: 2,
                fontColor: 'rgba(255,255,255,0.9)',
                hidden: !chart.isDatasetVisible(index),
                datasetIndex: index,
                pointStyle: 'circle'
            };
        });
    }

    function getChartOptions(type, isPlaceholder) {
        const baseScales = {
            x: {
                grid: { display: false },
                ticks: {
                    display: true,
                    color: 'rgba(255,255,255,0.78)',
                    font: { size: 13, weight: '600' },
                    maxTicksLimit: 14,
                    padding: 8,
                    autoSkip: true
                },
                stacked: undefined
            },
            y: {
                grid: { color: 'rgba(255,255,255,0.08)' },
                ticks: { color: 'rgba(255,255,255,0.72)', font: { size: 12 } },
                stacked: undefined
            }
        };

        const baseTooltip = {
            backgroundColor: 'rgba(20,20,30,0.95)',
            titleColor: '#fff',
            titleFont: { size: 15, weight: 'bold' },
            bodyColor: 'rgba(255,255,255,0.9)',
            bodyFont: { size: 14 },
            padding: 12,
            cornerRadius: 8,
            borderColor: 'rgba(255,255,255,0.15)',
            borderWidth: 1,
            displayColors: true,
            usePointStyle: true,
            boxWidth: 10,
            boxHeight: 10,
            boxPadding: 6,
            filter(context) {
                const value = Number(context?.parsed?.y ?? context?.raw ?? 0);
                return value !== 0;
            }
        };

        if (type === 'conversion') {
            return {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                layout: { padding: { top: 16, bottom: 32, left: 10, right: 20 } },
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: {
                            color: 'rgba(255,255,255,0.82)',
                            boxWidth: 10,
                            boxHeight: 10,
                            usePointStyle: true,
                            pointStyle: 'circle',
                            padding: 16,
                            font: { size: 13 },
                            generateLabels: type === 'platforms-business' ? buildBusinessPlatformLegendLabels : buildOutlineLegendLabels
                        }
                    },
                    tooltip: isPlaceholder
                        ? { enabled: false }
                        : {
                            ...baseTooltip,
                            callbacks: {
                                label(context) {
                                    const value = Number(context.parsed.y || 0);
                                    if (context.dataset.yAxisID === 'y1') {
                                        return `${context.dataset.label}: ${Math.round(value)}`;
                                    }
                                    return `${context.dataset.label}: ${value.toFixed(1)}%`;
                                }
                            }
                        }
                },
                scales: {
                    x: { ...baseScales.x },
                    y: {
                        ...baseScales.y,
                        min: 0,
                        max: 100,
                        ticks: {
                            color: 'rgba(255,255,255,0.82)',
                            font: { size: 12 },
                            callback(value) {
                                return `${value}%`;
                            }
                        }
                    },
                    y1: {
                        ...baseScales.y,
                        position: 'right',
                        grid: { drawOnChartArea: false },
                        ticks: {
                            color: 'rgba(255,255,255,0.55)',
                            font: { size: 12 }
                        }
                    }
                }
            };
        }

        if (type === 'platforms-business') {
            return {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                layout: { padding: { top: 16, bottom: 32, left: 10, right: 20 } },
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: {
                            color: 'rgba(255,255,255,0.82)',
                            boxWidth: 10,
                            boxHeight: 10,
                            usePointStyle: true,
                            pointStyle: 'circle',
                            padding: 16,
                            font: { size: 13 },
                            generateLabels: buildBusinessPlatformLegendLabels
                        }
                    },
                    tooltip: isPlaceholder ? { enabled: false } : baseTooltip
                },
                scales: {
                    x: { ...baseScales.x, stacked: true },
                    y: { ...baseScales.y, position: 'left', stacked: true }
                }
            };
        }

        if (type === 'mixed') {
            return {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                layout: { padding: { top: 16, bottom: 32, left: 10, right: 20 } },
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: {
                            color: 'rgba(255,255,255,0.82)',
                            boxWidth: 10,
                            boxHeight: 10,
                            usePointStyle: true,
                            pointStyle: 'circle',
                            padding: 16,
                            font: { size: 13 },
                            generateLabels: buildOutlineLegendLabels
                        }
                    },
                    tooltip: isPlaceholder ? { enabled: false } : baseTooltip
                },
                scales: {
                    x: { ...baseScales.x, stacked: false },
                    y: { ...baseScales.y, position: 'left', stacked: false },
                    y1: {
                        ...baseScales.y,
                        position: 'right',
                        stacked: false,
                        grid: { drawOnChartArea: false }
                    }
                }
            };
        }

        return {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            layout: { padding: { top: 16, bottom: 32, left: 10, right: 20 } },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        color: 'rgba(255,255,255,0.82)',
                        boxWidth: 10,
                        boxHeight: 10,
                        usePointStyle: true,
                        pointStyle: 'circle',
                        padding: 16,
                        font: { size: 13 },
                        generateLabels: type === 'platforms-business' ? buildBusinessPlatformLegendLabels : buildOutlineLegendLabels
                    }
                },
                tooltip: isPlaceholder ? { enabled: false } : baseTooltip
            },
            scales: baseScales
        };
    }

    function aggregateByWeek(stats) {
        const weeks = [];
        let currentWeek = null;

        stats.forEach((s) => {
            const d = new Date(s.date + 'T00:00:00');
            const weekStart = new Date(d);
            weekStart.setDate(d.getDate() - ((d.getDay() + 6) % 7));
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            const key = weekStart.toISOString().slice(0, 10);

            if (!currentWeek || currentWeek.date !== key) {
                if (currentWeek) weeks.push(currentWeek);
                currentWeek = {
                    date: key,
                    date_end: weekEnd.toISOString().slice(0, 10),
                    user_msgs: 0, bot_msgs: 0, operator_msgs: 0, total_msgs: 0,
                    spam_msgs: 0, bulk_msgs: 0,
                    total_dialogs: 0, web_dialogs: 0, tg_dialogs: 0, max_dialogs: 0,
                    vk_dialogs: 0, email_dialogs: 0, avito_dialogs: 0,
                    leads: 0, applications: 0
                };
            }

            currentWeek.user_msgs += s.user_msgs || 0;
            currentWeek.bot_msgs += s.bot_msgs || 0;
            currentWeek.operator_msgs += s.operator_msgs || 0;
            currentWeek.total_msgs += s.total_msgs || 0;
            currentWeek.spam_msgs += s.spam_msgs || 0;
            currentWeek.bulk_msgs += s.bulk_msgs || 0;
            currentWeek.total_dialogs += s.total_dialogs || 0;
            currentWeek.web_dialogs += s.web_dialogs || 0;
            currentWeek.tg_dialogs += s.tg_dialogs || 0;
            currentWeek.max_dialogs += s.max_dialogs || 0;
            currentWeek.vk_dialogs += s.vk_dialogs || 0;
            currentWeek.email_dialogs += s.email_dialogs || 0;
            currentWeek.avito_dialogs += s.avito_dialogs || 0;
            currentWeek.leads += s.leads || 0;
            currentWeek.applications += s.applications || 0;
        });

        if (currentWeek) weeks.push(currentWeek);
        return weeks;
    }

    function buildLabels(displayStats, isPlaceholder) {
        return isPlaceholder
            ? ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
            : displayStats.map((s) => {
                const d = new Date(s.date + 'T00:00:00');
                return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
            });
    }

    function buildDatasets(displayStats, isPlaceholder, seriesDefs, chartType = 'bar') {
        if (chartType === 'conversion') {
            return seriesDefs.map((series) => ({
                type: 'line',
                label: series.label,
                data: isPlaceholder
                    ? new Array(7).fill(0)
                    : displayStats.map((item) => {
                        if (series.mode === 'count') {
                            return Number(item[series.key] || 0);
                        }
                        const total = Number(item.total_dialogs || 0);
                        const numerator = Number(item[series.key] || 0);
                        if (!total) return 0;
                        return Number(((numerator / total) * 100).toFixed(1));
                    }),
                borderColor: series.color,
                backgroundColor: 'transparent',
                pointBackgroundColor: 'rgba(0,0,0,0)',
                pointBorderColor: series.color,
                pointBorderWidth: 2,
                pointRadius: 2,
                pointHoverRadius: 3,
                borderWidth: series.mode === 'count' ? 1.6 : 2,
                borderDash: series.mode === 'count' ? [5, 4] : undefined,
                tension: 0.3,
                fill: false,
                yAxisID: series.axis
            }));
        }

        if (chartType === 'line') {
            return seriesDefs.map((series) => ({
                type: 'line',
                label: series.label,
                data: isPlaceholder ? new Array(7).fill(0) : displayStats.map((item) => item[series.key] || 0),
                borderColor: series.color,
                backgroundColor: 'transparent',
                pointBackgroundColor: 'rgba(0,0,0,0)',
                pointBorderColor: series.color,
                pointBorderWidth: 2,
                pointRadius: 2,
                pointHoverRadius: 3,
                borderWidth: 2,
                tension: 0.35,
                fill: false,
                yAxisID: series.axis
            }));
        }

        return seriesDefs.map((series) => ({
            type: 'bar',
            label: series.label,
            data: isPlaceholder ? new Array(7).fill(0) : displayStats.map((item) => item[series.key] || 0),
            backgroundColor: series.color,
            borderRadius: 4,
            yAxisID: series.axis
        }));
    }

    function renderChart(chartKey, canvasId, stats, seriesDefs, chartType = 'bar') {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (profile.state.charts[chartKey]) {
            profile.state.charts[chartKey].destroy();
        }

        const isPlaceholder = !stats || stats.length === 0;
        const displayStats = !isPlaceholder && stats.length > 120 ? aggregateByWeek(stats) : (stats || []);
        const labels = buildLabels(displayStats, isPlaceholder);
        const datasets = buildDatasets(displayStats, isPlaceholder, seriesDefs, chartType);

        const optionsType = chartKey === 'activityPlatforms'
            ? 'platforms-business'
            : (chartType === 'conversion' ? 'conversion' : 'mixed');

        profile.state.charts[chartKey] = new Chart(ctx, {
            data: { labels, datasets },
            options: getChartOptions(optionsType, isPlaceholder)
        });
    }

    function renderActivityCharts(stats) {
        renderChart('activityMessages', 'activity-messages-chart', stats, messageSeriesDefs, 'line');
        renderChart('activityPlatforms', 'activity-platforms-chart', stats, platformSeriesDefs, 'bar');
        renderChart('activityResults', 'activity-results-chart', stats, resultSeriesDefs, 'conversion');
    }

    async function loadAnalyticsData() {
        try {
            const period = profile.state.activityPeriod || 7;

            const qp = new URLSearchParams({ client_id: getClientId() });
            const mode = (profile.state.analyticsMode || '').trim();
            if (mode && mode !== 'all') {
                qp.set('mode', mode);
            }
            if (period === 'custom' && profile.state.customDateFrom && profile.state.customDateTo) {
                qp.set('date_from', profile.state.customDateFrom);
                qp.set('date_to', profile.state.customDateTo);
            } else {
                qp.set('days', String(period));
            }

            const url = `/api/chat/admin/activity-stats?${qp.toString()}`;
            const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
            if (!res.ok) return;

            const data = await res.json();
            const stats = data.stats || [];
            profile._lastActivityStats = stats;
            if (profile && typeof profile.renderModeCompare === 'function') {
                profile.renderModeCompare(stats);
            }
            renderActivityCharts(stats);
        } catch (e) {
            console.warn('Failed to load analytics for profile', e);
        }
    }

    function setAnalyticsExpanded(card, expanded) {
        const cards = document.querySelectorAll('.analytics-card');
        const middleColumn = document.getElementById('profile-middle-column');
        const rightColumn = document.getElementById('profile-right-column');
        const leftColumn = document.getElementById('profile-left-column');

        cards.forEach((item) => {
            const isCurrent = item === card;
            const opened = isCurrent && !!expanded;
            item.classList.toggle('is-expanded', opened);

            const filtersGrid = item.querySelector('.activity-filters-grid');
            const filtersBtn = item.querySelector('.btn-activity-filters-toggle');
            if (filtersGrid) filtersGrid.classList.toggle('is-hidden', !opened);
            if (filtersBtn) {
                filtersBtn.classList.toggle('active', opened);
                filtersBtn.style.display = opened ? 'flex' : '';
            }

            const calendarWrapper = item.querySelector('.profile-calendar-wrapper');
            const chartContainer = item.querySelector('.analytics-main-chart-container');
            if (!opened && calendarWrapper) {
                calendarWrapper.style.display = 'none';
            }
            if (!opened && chartContainer) {
                chartContainer.style.display = '';
            }
            if (!opened) {
                item.classList.remove('is-calendar-open');
            }
        });

        profile.state.analyticsExpandedCard = expanded && card ? card.id : null;
        const hasExpanded = !!profile.state.analyticsExpandedCard;
        const expandedInRightColumn = hasExpanded && !!card && card.closest('#profile-right-column');
        const expandedInMiddleColumn = hasExpanded && !!card && card.closest('#profile-middle-column');

        document.body.classList.toggle('analytics-expanded-open', hasExpanded);

        if (middleColumn) {
            middleColumn.classList.toggle('analytics-focus-active', expandedInMiddleColumn);
            middleColumn.classList.toggle('analytics-hidden', expandedInRightColumn);
        }

        if (rightColumn) {
            rightColumn.classList.toggle('analytics-focus-active', expandedInRightColumn);
            rightColumn.classList.toggle('analytics-hidden', expandedInMiddleColumn);
        }

        if (leftColumn) {
            leftColumn.classList.toggle('analytics-hidden', hasExpanded);
        }
    }

    function toggleProfileCalendar(card, show) {
        if (!card) return;
        const wrapper = card.querySelector('.profile-calendar-wrapper');
        const chartContainer = card.querySelector('.analytics-main-chart-container');
        if (!wrapper) return;
        card.classList.toggle('is-calendar-open', !!show);
        wrapper.style.display = show ? 'flex' : 'none';
        if (chartContainer) {
            chartContainer.style.display = show ? 'none' : '';
        }
        if (show) {
            profile.state.calendarDraftDateFrom = profile.state.customDateFrom || null;
            profile.state.calendarDraftDateTo = profile.state.customDateTo || null;
            renderProfileCalendar(card);
        }
    }

    function dateKey(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function bindPressEffect(btn) {
        if (!btn) return;
        const addPress = () => btn.classList.add('is-pressed');
        const removePress = () => btn.classList.remove('is-pressed');
        btn.addEventListener('pointerdown', addPress);
        btn.addEventListener('pointerup', removePress);
        btn.addEventListener('pointercancel', removePress);
        btn.addEventListener('mouseleave', removePress);
        btn.addEventListener('blur', removePress);
    }

    function buildProfileDayCell(day, month, year, otherMonth, card) {
        const cell = document.createElement('button');
        cell.className = 'calendar-day';
        cell.textContent = day;
        cell.type = 'button';
        bindPressEffect(cell);

        if (otherMonth) cell.classList.add('other-month');

        const date = new Date(year, month, day);
        const dateStr = dateKey(date);
        const today = new Date();
        if (date.toDateString() === today.toDateString()) cell.classList.add('today');

        const from = profile.state.calendarDraftDateFrom ?? profile.state.customDateFrom;
        const to = profile.state.calendarDraftDateTo ?? profile.state.customDateTo;

        if (from && !to && dateStr === from) {
            cell.classList.add('selected', 'single');
        } else {
            if (from && dateStr === from) cell.classList.add('selected', 'range-start');
            if (to && dateStr === to) cell.classList.add('selected', 'range-end');
            if (from && to && dateStr > from && dateStr < to) cell.classList.add('in-range');
        }

        cell.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (otherMonth) return;
            
            const f = profile.state.calendarDraftDateFrom ?? profile.state.customDateFrom;
            const t = profile.state.calendarDraftDateTo ?? profile.state.customDateTo;

            if (!f || (f && t)) {
                profile.state.calendarDraftDateFrom = dateStr;
                profile.state.calendarDraftDateTo = null;
            } else {
                if (dateStr === f) {
                    profile.state.calendarDraftDateFrom = null;
                    profile.state.calendarDraftDateTo = null;
                } else if (dateStr < f) {
                    profile.state.calendarDraftDateTo = f;
                    profile.state.calendarDraftDateFrom = dateStr;
                } else {
                    profile.state.calendarDraftDateTo = dateStr;
                }
            }

            console.log(`[Calendar] Selected: from=${profile.state.calendarDraftDateFrom}, to=${profile.state.calendarDraftDateTo}`);
            renderProfileCalendar(card);
        };

        return cell;
    }

    function closeCalendarPickers() {
        profile.state.calendarPickerOpen = null;
    }

    function toggleCalendarPicker(type, card) {
        profile.state.calendarPickerOpen = profile.state.calendarPickerOpen === type ? null : type;
        renderProfileCalendar(card);
    }

    function renderProfileCalendar(card) {
        if (!card) return;
        const container = card.querySelector('.profile-calendar');
        if (!container) return;
        container.innerHTML = '';

        const now = new Date();
        const calYear = profile.state.profileCalYear || now.getFullYear();
        const calMonth = profile.state.profileCalMonth || now.getMonth();
        const pickerOpen = profile.state.calendarPickerOpen || null;

        const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

        const wrapper = document.createElement('div');
        wrapper.className = 'calendar-month';

        const header = document.createElement('div');
        header.className = 'calendar-month-header';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'calendar-picker-group';

        const monthBtn = document.createElement('button');
        monthBtn.className = `calendar-picker-btn ${pickerOpen === 'month' ? 'active' : ''}`;
        monthBtn.type = 'button';
        monthBtn.textContent = MONTH_NAMES[calMonth];
        bindPressEffect(monthBtn);
        monthBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleCalendarPicker('month', card);
        };

        const yearBtn = document.createElement('button');
        yearBtn.className = `calendar-picker-btn ${pickerOpen === 'year' ? 'active' : ''}`;
        yearBtn.type = 'button';
        yearBtn.textContent = String(calYear);
        bindPressEffect(yearBtn);
        yearBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleCalendarPicker('year', card);
        };

        titleWrap.appendChild(monthBtn);
        titleWrap.appendChild(yearBtn);

        const toolbarCenter = card.querySelector('.profile-calendar-toolbar-center');
        if (toolbarCenter) {
            toolbarCenter.innerHTML = '';
            toolbarCenter.appendChild(titleWrap);
        } else {
            header.appendChild(titleWrap);
        }
        wrapper.appendChild(header);

        const calendarBody = document.createElement('div');
        calendarBody.className = 'calendar-body';

        const calendarGridWrap = document.createElement('div');
        calendarGridWrap.className = 'calendar-grid-wrap';

        const weekdays = document.createElement('div');
        weekdays.className = 'calendar-weekdays';
        ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach((d) => {
            const wd = document.createElement('span');
            wd.className = 'calendar-weekday';
            wd.textContent = d;
            weekdays.appendChild(wd);
        });
        calendarGridWrap.appendChild(weekdays);

        const daysGrid = document.createElement('div');
        daysGrid.className = 'calendar-days';

        const firstDay = new Date(calYear, calMonth, 1);
        const lastDay = new Date(calYear, calMonth + 1, 0);
        const startDow = (firstDay.getDay() + 6) % 7;

        const prevLast = new Date(calYear, calMonth, 0).getDate();
        for (let i = startDow - 1; i >= 0; i--) {
            const day = prevLast - i;
            daysGrid.appendChild(buildProfileDayCell(day, calMonth === 0 ? 11 : calMonth - 1, calMonth === 0 ? calYear - 1 : calYear, true, card));
        }

        for (let d = 1; d <= lastDay.getDate(); d++) {
            daysGrid.appendChild(buildProfileDayCell(d, calMonth, calYear, false, card));
        }

        const totalCells = startDow + lastDay.getDate();
        const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
        for (let d = 1; d <= remaining; d++) {
            daysGrid.appendChild(buildProfileDayCell(d, calMonth === 11 ? 0 : calMonth + 1, calMonth === 11 ? calYear + 1 : calYear, true, card));
        }

        calendarGridWrap.appendChild(daysGrid);
        calendarBody.appendChild(calendarGridWrap);

        if (pickerOpen === 'month') {
            const monthPanel = document.createElement('div');
            monthPanel.className = 'calendar-picker-panel calendar-month-panel';
            MONTH_NAMES.forEach((name, i) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `calendar-picker-option ${i === calMonth ? 'active' : ''}`;
                btn.textContent = name;
                bindPressEffect(btn);
                btn.onclick = () => {
                    profile.state.profileCalMonth = i;
                    closeCalendarPickers();
                    renderProfileCalendar(card);
                };
                monthPanel.appendChild(btn);
            });
            calendarBody.appendChild(monthPanel);
        }

        if (pickerOpen === 'year') {
            const yearPanel = document.createElement('div');
            yearPanel.className = 'calendar-picker-panel calendar-year-panel profile-calendar-year-panel';
            const currentYear = now.getFullYear();
            const endYear = currentYear + 2;
            const startYear = currentYear - 40;
            for (let y = endYear; y >= startYear; y--) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `calendar-picker-option calendar-year-option ${y === calYear ? 'active' : ''}`;
                btn.textContent = String(y);
                bindPressEffect(btn);
                btn.onclick = () => {
                    profile.state.profileCalYear = y;
                    closeCalendarPickers();
                    renderProfileCalendar(card);
                };
                yearPanel.appendChild(btn);
            }
            calendarBody.appendChild(yearPanel);
        }

        wrapper.appendChild(calendarBody);
        container.appendChild(wrapper);
    }

    function bindActivityPeriods() {
        const cards = document.querySelectorAll('.analytics-card');
        cards.forEach((card) => {
            const calBtn = card.querySelector('.btn-period-calendar');
            const applyBtn = card.querySelector('.btn-calendar-apply');
            const cancelBtn = card.querySelector('.btn-calendar-cancel');
            const resetBtn = card.querySelector('.btn-calendar-reset');

            if (calBtn) {
                bindPressEffect(calBtn);
                calBtn.addEventListener('click', () => {
                    const wrapper = card.querySelector('.profile-calendar-wrapper');
                    const visible = wrapper && wrapper.style.display !== 'none';
                    if (visible) closeCalendarPickers();
                    toggleProfileCalendar(card, !visible);
                });
            }

            if (applyBtn) {
                bindPressEffect(applyBtn);
                applyBtn.addEventListener('click', () => {
                    const draftFrom = profile.state.calendarDraftDateFrom ?? profile.state.customDateFrom;
                    const draftTo = profile.state.calendarDraftDateTo ?? profile.state.customDateTo;

                    profile.state.customDateFrom = draftFrom || null;
                    profile.state.customDateTo = draftTo || null;

                    if (profile.state.customDateFrom) {
                        if (!profile.state.customDateTo) {
                            profile.state.customDateTo = profile.state.customDateFrom;
                        }
                        profile.state.activityPeriod = 'custom';
                    } else {
                        profile.state.activityPeriod = 7;
                    }

                    profile.state.calendarDraftDateFrom = null;
                    profile.state.calendarDraftDateTo = null;
                    closeCalendarPickers();
                    toggleProfileCalendar(card, false);
                    loadAnalyticsData();
                });
            }

            if (cancelBtn) {
                bindPressEffect(cancelBtn);
                cancelBtn.addEventListener('click', () => {
                    profile.state.calendarDraftDateFrom = null;
                    profile.state.calendarDraftDateTo = null;
                    closeCalendarPickers();
                    toggleProfileCalendar(card, false);
                });
            }

            if (resetBtn) {
                bindPressEffect(resetBtn);
                resetBtn.addEventListener('click', () => {
                    profile.state.calendarDraftDateFrom = null;
                    profile.state.calendarDraftDateTo = null;
                    renderProfileCalendar(card);
                });
            }
        });
    }

    function bindSeriesControls() {
        const cards = document.querySelectorAll('.analytics-card');
        setAnalyticsExpanded(null, false);

        cards.forEach((card) => {
            const filtersBtn = card.querySelector('.btn-activity-filters-toggle');
            const expandBtn = card.querySelector('.btn-analytics-expand');
            const closeBtn = card.querySelector('.btn-analytics-close');
            const filtersGrid = card.querySelector('.activity-filters-grid');

            if (filtersBtn) {
                bindPressEffect(filtersBtn);
                filtersBtn.addEventListener('click', () => {
                    if (profile.state.analyticsExpandedCard !== card.id) return;
                    if (!filtersGrid) return;
                    const hidden = filtersGrid.classList.contains('is-hidden');
                    filtersGrid.classList.toggle('is-hidden', !hidden);
                    filtersBtn.classList.toggle('active', hidden);
                    filtersGrid.style.display = hidden ? 'grid' : 'none';
                });
            }

            if (expandBtn) {
                bindPressEffect(expandBtn);
                expandBtn.addEventListener('click', () => {
                    setAnalyticsExpanded(card, true);
                    if (filtersGrid) {
                        filtersGrid.classList.remove('is-hidden');
                        filtersGrid.style.display = 'grid';
                    }
                });
            }

            if (closeBtn) {
                bindPressEffect(closeBtn);
                closeBtn.addEventListener('click', () => {
                    setAnalyticsExpanded(card, false);
                    toggleProfileCalendar(card, false);
                });
            }
        });

        profile._analyticsEscHandler = (event) => {
            if (event.key === 'Escape' && profile.state.analyticsExpandedCard) {
                const activeCard = document.getElementById(profile.state.analyticsExpandedCard);
                setAnalyticsExpanded(activeCard, false);
                if (activeCard) toggleProfileCalendar(activeCard, false);
            }
        };
        document.addEventListener('keydown', profile._analyticsEscHandler);
    }

    return {
        init() {
            ensureState();
            syncFromUiSettings();
            bindActivityPeriods();
            bindSeriesControls();
        },
        async loadAnalyticsData() {
            await loadAnalyticsData();
        },
        syncFromSettings() {
            ensureState();
            syncFromUiSettings();
        },
        destroy() {
            const wrappers = document.querySelectorAll('.analytics-card .profile-calendar-wrapper');
            wrappers.forEach((wrapper) => {
                wrapper.style.display = 'none';
            });

            if (profile._analyticsEscHandler) {
                document.removeEventListener('keydown', profile._analyticsEscHandler);
                profile._analyticsEscHandler = null;
            }

            setAnalyticsExpanded(null, false);

            ['activityMessages', 'activityPlatforms', 'activityResults', 'main'].forEach((key) => {
                if (profile.state.charts[key]) {
                    profile.state.charts[key].destroy();
                    delete profile.state.charts[key];
                }
            });
        }
    };
}
