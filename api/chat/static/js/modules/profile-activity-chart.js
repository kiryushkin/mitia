export function createProfileActivityChart(profile) {
    const platformSeriesDefs = [
        { key: 'web_dialogs', label: 'Веб', color: '#FFFFFF', axis: 'y' },
        { key: 'tg_dialogs', label: 'Telegram', color: '#2AABEE', axis: 'y' },
        { key: 'vk_dialogs', label: 'VK', color: '#0077FF', axis: 'y' },
        { key: 'email_dialogs', label: 'Email', color: '#f39c12', axis: 'y' },
        { key: 'avito_dialogs', label: 'Avito', color: '#2E7D32', axis: 'y' },
        { key: 'max_dialogs', label: 'MAX', color: '#9B5CFF', axis: 'y' }
    ];

    const resultSeriesDefs = [
        { key: 'qualified_dialogs', label: 'Качественные', color: '#00E5FF', axis: 'y', mode: 'percent', denominatorKey: 'total_dialogs' },
        { key: 'leads', label: 'Лиды', color: '#CCFF00', axis: 'y', mode: 'percent', denominatorKey: 'qualified_dialogs' },
        { key: 'handoffs', label: 'Передачи оператору', color: '#00FF94', axis: 'y', mode: 'percent', denominatorKey: 'qualified_dialogs' },
        { key: 'total_dialogs', label: 'Все диалоги', color: 'rgba(255,255,255,0.35)', axis: 'y1', mode: 'count' }
    ];

    function ensureState() {
        if (profile.state.activityPeriod === undefined) {
            profile.state.activityPeriod = null;
        }
        if (!profile.state.analyticsExpandedCard) {
            profile.state.analyticsExpandedCard = null;
        }
        if (profile.state.analyticsSidebarFiltersOpen === undefined) {
            profile.state.analyticsSidebarFiltersOpen = false;
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
            const isPlaceholderDataset = Boolean(dataset?.isPlaceholder);

            let valueLabel = `${Math.round(isPlaceholderDataset ? 0 : total)}`;
            if (isPercentScale && dataset.yAxisID !== 'y1') {
                // Для процентных серий считаем агрегированную конверсию Σnum / Σden,
                // а не среднее процентов по дням (иначе парадокс Симпсона).
                const numSum = Number(dataset._numeratorSum || 0);
                const denSum = Number(dataset._denominatorSum || 0);
                const pct = isPlaceholderDataset || !denSum ? 0 : (numSum / denSum) * 100;
                valueLabel = `${pct.toFixed(1)}%`;
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
            const shownTotal = dataset?.isPlaceholder ? 0 : total;
            return {
                text: `${dataset.label} ${Math.round(shownTotal)}`,
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
            multiKeyBackground: 'rgba(0,0,0,0)',
            callbacks: {
                labelColor(context) {
                    const dataset = context.dataset || {};
                    const color = Array.isArray(dataset.borderColor)
                        ? (dataset.borderColor[context.dataIndex] || dataset.borderColor[0] || '#fff')
                        : (dataset.borderColor || dataset.backgroundColor || '#fff');
                    return { borderColor: color, backgroundColor: 'rgba(0,0,0,0)', borderWidth: 2 };
                },
                labelPointStyle() {
                    return { pointStyle: 'circle', rotation: 0 };
                }
            },
            filter(context) {
                const value = Number(context?.parsed?.y ?? context?.raw ?? 0);
                return value !== 0;
            }
        };

        if (type === 'conversion') {
            return {
                responsive: true,
                maintainAspectRatio: false,
                resizeDelay: 120,
                animation: false,
                transitions: { resize: { animation: { duration: 0 } } },
                interaction: { mode: 'index', intersect: false },
                layout: { padding: { top: 16, bottom: 6, left: 10, right: 20 } },
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
                            padding: 12,
                            font: { size: 14, family: 'Geist, sans-serif', weight: '500', lineHeight: 1.2 },
                            generateLabels: type === 'platforms-business' ? buildBusinessPlatformLegendLabels : buildOutlineLegendLabels
                        }
                    },
                    tooltip: isPlaceholder
                        ? { enabled: false }
                        : {
                            ...baseTooltip,
                            callbacks: {
                                ...baseTooltip.callbacks,
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
                    x: { ...baseScales.x, offset: true },
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
                resizeDelay: 120,
                animation: false,
                transitions: { resize: { animation: { duration: 0 } } },
                interaction: { mode: 'index', intersect: false },
                layout: { padding: { top: 16, bottom: 6, left: 10, right: 20 } },
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
                            padding: 12,
                            font: { size: 14, family: 'Geist, sans-serif', weight: '500', lineHeight: 1.2 },
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
                resizeDelay: 120,
                animation: false,
                transitions: { resize: { animation: { duration: 0 } } },
                interaction: { mode: 'index', intersect: false },
                layout: { padding: { top: 16, bottom: 6, left: 10, right: 20 } },
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
                            padding: 12,
                            font: { size: 14, family: 'Geist, sans-serif', weight: '500', lineHeight: 1.2 },
                            generateLabels: buildOutlineLegendLabels
                        }
                    },
                    tooltip: isPlaceholder ? { enabled: false } : baseTooltip
                },
                scales: {
                    x: { ...baseScales.x, stacked: false, offset: true },
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
            resizeDelay: 120,
            animation: false,
            transitions: { resize: { animation: { duration: 0 } } },
            interaction: { mode: 'index', intersect: false },
            layout: { padding: { top: 16, bottom: 6, left: 10, right: 20 } },
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
                        padding: 12,
                        font: { size: 14, family: 'Geist, sans-serif', weight: '500', lineHeight: 1.2 },
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
                    total_dialogs: 0, qualified_dialogs: 0, web_dialogs: 0, tg_dialogs: 0, max_dialogs: 0,
                    vk_dialogs: 0, email_dialogs: 0, avito_dialogs: 0,
                    leads: 0, applications: 0, handoffs: 0
                };
            }

            currentWeek.user_msgs += s.user_msgs || 0;
            currentWeek.bot_msgs += s.bot_msgs || 0;
            currentWeek.operator_msgs += s.operator_msgs || 0;
            currentWeek.total_msgs += s.total_msgs || 0;
            currentWeek.spam_msgs += s.spam_msgs || 0;
            currentWeek.bulk_msgs += s.bulk_msgs || 0;
            currentWeek.total_dialogs += s.total_dialogs || 0;
            currentWeek.qualified_dialogs += s.qualified_dialogs || 0;
            currentWeek.web_dialogs += s.web_dialogs || 0;
            currentWeek.tg_dialogs += s.tg_dialogs || 0;
            currentWeek.max_dialogs += s.max_dialogs || 0;
            currentWeek.vk_dialogs += s.vk_dialogs || 0;
            currentWeek.email_dialogs += s.email_dialogs || 0;
            currentWeek.avito_dialogs += s.avito_dialogs || 0;
            currentWeek.leads += s.leads || 0;
            currentWeek.applications += s.applications || 0;
            currentWeek.handoffs += s.handoffs || 0;
        });

        if (currentWeek) weeks.push(currentWeek);
        return weeks;
    }

    function buildLabels(displayStats, isPlaceholder) {
        if (Array.isArray(displayStats) && displayStats.length && displayStats.some((s) => s?.date)) {
            return displayStats.map((s) => {
                const d = new Date(s.date + 'T00:00:00');
                return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
            });
        }

        if (isPlaceholder) {
            return ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
        }

        return [];
    }

    function buildPlaceholderValues(length, seriesIndex, kind = 'line') {
        const safeLength = Math.max(1, length);
        return Array.from({ length: safeLength }, (_, pointIndex) => {
            const progress = safeLength === 1 ? 0 : pointIndex / (safeLength - 1);
            const wave = Math.sin(progress * Math.PI * (2.2 + seriesIndex * 0.35) + seriesIndex * 0.9);
            const pulse = Math.cos(progress * Math.PI * 4.4 + seriesIndex * 0.55);
            const normalized = Math.max(0.08, 0.54 + wave * 0.24 + pulse * 0.12);
            if (kind === 'percent') return Number((18 + normalized * 54).toFixed(1));
            if (kind === 'count') return Number((1 + normalized * 7).toFixed(1));
            if (kind === 'bar') return Number((1 + normalized * 9).toFixed(1));
            return Number((2 + normalized * 12).toFixed(1));
        });
    }

    function buildDatasets(displayStats, isPlaceholder, seriesDefs, chartType = 'bar') {
        const placeholderLine = ['rgba(255,255,255,0.28)', 'rgba(255,255,255,0.22)', 'rgba(255,255,255,0.18)', 'rgba(255,255,255,0.14)'];
        const placeholderBar = ['rgba(255,255,255,0.16)', 'rgba(255,255,255,0.13)', 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0.08)'];
        const placeholderLength = Array.isArray(displayStats) && displayStats.length ? displayStats.length : 7;

        if (chartType === 'conversion') {
            return seriesDefs.map((series, index) => {
                const denominatorKey = series.denominatorKey || 'qualified_dialogs';
                let numeratorSum = 0;
                let denominatorSum = 0;
                if (!isPlaceholder && series.mode === 'percent') {
                    displayStats.forEach((item) => {
                        numeratorSum += Number(item[series.key] || 0);
                        denominatorSum += Number(item[denominatorKey] || 0);
                    });
                }
                return ({
                type: 'line',
                label: series.label,
                data: isPlaceholder
                    ? buildPlaceholderValues(placeholderLength, index, series.mode === 'count' ? 'count' : 'percent')
                    : displayStats.map((item) => {
                        if (series.mode === 'count') {
                            return Number(item[series.key] || 0);
                        }
                        const denom = Number(item[denominatorKey] || 0);
                        const numerator = Number(item[series.key] || 0);
                        if (!denom) return 0;
                        return Number(((numerator / denom) * 100).toFixed(1));
                    }),
                _numeratorSum: numeratorSum,
                _denominatorSum: denominatorSum,
                borderColor: isPlaceholder ? (placeholderLine[index % placeholderLine.length]) : series.color,
                backgroundColor: 'transparent',
                pointBackgroundColor: 'rgba(0,0,0,0)',
                pointBorderColor: isPlaceholder ? (placeholderLine[index % placeholderLine.length]) : series.color,
                pointBorderWidth: isPlaceholder ? 1.5 : 2,
                pointRadius: 2,
                pointHoverRadius: isPlaceholder ? 2 : 3,
                clip: 8,
                borderWidth: series.mode === 'count' ? 1.6 : 2,
                borderDash: series.mode === 'count' ? [5, 4] : undefined,
                tension: 0.3,
                fill: false,
                yAxisID: series.axis,
                isPlaceholder
            });
            });
        }

        if (chartType === 'line') {
            return seriesDefs.map((series, index) => ({
                type: 'line',
                label: series.label,
                data: isPlaceholder
                    ? buildPlaceholderValues(placeholderLength, index, 'line')
                    : displayStats.map((item) => item[series.key] || 0),
                borderColor: isPlaceholder ? (placeholderLine[index % placeholderLine.length]) : series.color,
                backgroundColor: 'transparent',
                pointBackgroundColor: 'rgba(0,0,0,0)',
                pointBorderColor: isPlaceholder ? (placeholderLine[index % placeholderLine.length]) : series.color,
                pointBorderWidth: isPlaceholder ? 1.5 : 2,
                pointRadius: 2,
                pointHoverRadius: isPlaceholder ? 2 : 3,
                clip: 8,
                borderWidth: 2,
                tension: 0.35,
                fill: false,
                yAxisID: series.axis,
                isPlaceholder
            }));
        }

        return seriesDefs.map((series, index) => ({
            type: 'bar',
            label: series.label,
            data: isPlaceholder
                ? buildPlaceholderValues(placeholderLength, index, 'bar')
                : displayStats.map((item) => item[series.key] || 0),
            backgroundColor: isPlaceholder ? (placeholderBar[index % placeholderBar.length]) : series.color,
            borderRadius: 4,
            yAxisID: series.axis,
            isPlaceholder
        }));
    }

    function hasSeriesData(stats, seriesDefs) {
        if (!Array.isArray(stats) || !stats.length) return false;
        return stats.some((item) => seriesDefs.some((series) => Number(item?.[series.key] || 0) > 0));
    }

    function cardIdByChart(chartKey) {
        if (chartKey === 'activityMessages') return 'card-analytics-messages';
        if (chartKey === 'activityPlatforms') return 'card-analytics-platforms';
        if (chartKey === 'activityResults') return 'card-analytics-results';
        return null;
    }

    function renderChart(chartKey, canvasId, stats, seriesDefs, chartType = 'bar', forcePlaceholder = false) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (profile.state.charts[chartKey]) {
            profile.state.charts[chartKey].destroy();
            delete profile.state.charts[chartKey];
        }

        const hasData = hasSeriesData(stats, seriesDefs);
        const cardId = cardIdByChart(chartKey);

        if (typeof Chart === 'undefined') {
            return;
        }

        const isPlaceholder = forcePlaceholder || !hasData;
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
        if (cardId && typeof profile.setCardEmptyState === 'function') {
            const message = forcePlaceholder
                ? 'Данные для выбранного периода ещё не сформированы'
                : 'Данные появятся после первых диалогов';
            profile.setCardEmptyState(cardId, isPlaceholder, message);
        }
    }

    function renderDemandHeatmap(hourlyDemand = [], forcePlaceholder = false) {
        const container = document.getElementById('activity-demand-heatmap');
        if (!container) return;

        profile._lastHourlyDemand = Array.isArray(hourlyDemand) ? hourlyDemand : [];
        profile._lastDemandForcePlaceholder = Boolean(forcePlaceholder);

        const card = document.getElementById('card-analytics-messages');
        const isDetailed = Boolean(card?.classList.contains('is-expanded'));
        const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
        const buckets = isDetailed
            ? Array.from({ length: 24 }, (_, hour) => ({
                from: hour,
                to: hour + 1,
                label: String(hour).padStart(2, '0')
            }))
            : [
                { from: 0, to: 4, label: '00–04' },
                { from: 4, to: 8, label: '04–08' },
                { from: 8, to: 12, label: '08–12' },
                { from: 12, to: 16, label: '12–16' },
                { from: 16, to: 20, label: '16–20' },
                { from: 20, to: 24, label: '20–24' }
            ];

        const metadataRange = profile._lastActivityMetadata || {};
        const effectiveRange = typeof profile.getEffectiveDateRange === 'function'
            ? profile.getEffectiveDateRange()
            : { from: null, to: null };
        const rangeFrom = effectiveRange?.from || metadataRange.date_from || null;
        const rangeTo = effectiveRange?.to || metadataRange.date_to || null;
        const weekdayOccurrences = Array(7).fill(0);
        if (rangeFrom && rangeTo) {
            const cursor = new Date(`${rangeFrom}T00:00:00`);
            const end = new Date(`${rangeTo}T00:00:00`);
            while (!Number.isNaN(cursor.getTime()) && cursor <= end) {
                weekdayOccurrences[(cursor.getDay() + 6) % 7] += 1;
                cursor.setDate(cursor.getDate() + 1);
            }
        }

        const values = new Map();
        profile._lastHourlyDemand.forEach((row) => {
            const weekday = Number(row.weekday);
            const hour = Number(row.hour);
            const bucketIndex = buckets.findIndex((bucket) => hour >= bucket.from && hour < bucket.to);
            if (bucketIndex < 0) return;
            const key = `${weekday}:${bucketIndex}`;
            const current = values.get(key) || { messages: 0, dialogs: 0 };
            current.messages += Number(row.user_messages || 0);
            current.dialogs += Number(row.unique_dialogs || 0);
            values.set(key, current);
        });

        const maxAverageMessages = Math.max(0, ...[...values.entries()].map(([key, item]) => {
            const weekday = Number(key.split(':')[0]);
            const dayCount = Math.max(weekdayOccurrences[weekday] || 0, 1);
            return item.messages / dayCount;
        }));
        const headers = buckets.map((bucket) =>
            `<span class="demand-heatmap-hour">${bucket.label}</span>`
        ).join('');
        const rows = days.map((day, weekday) => {
            const cells = buckets.map((bucket, bucketIndex) => {
                const item = values.get(`${weekday}:${bucketIndex}`) || { messages: 0, dialogs: 0 };
                const dayCount = Math.max(weekdayOccurrences[weekday] || 0, 1);
                const averageMessages = item.messages / dayCount;
                const demoIntensity = 0.12 + (((weekday * 11 + bucketIndex * 7 + 5) % 17) / 17) * 0.5;
                const intensity = maxAverageMessages ? Math.sqrt(averageMessages / maxAverageMessages) : demoIntensity;
                const alpha = (maxAverageMessages && item.messages)
                    ? (0.16 + intensity * 0.84).toFixed(3)
                    : (maxAverageMessages ? '0.04' : (0.08 + intensity * 0.28).toFixed(3));
                const interval = isDetailed ? `${bucket.label}:00` : bucket.label;
                const title = maxAverageMessages
                    ? `${day}, ${interval} — в среднем ${averageMessages.toFixed(1)} сообщ. за день; всего ${item.messages} за ${dayCount} дн.`
                    : 'Демонстрационная интенсивность — данные ещё не сформированы';
                return `<span class="demand-heatmap-cell" style="--heat-alpha:${alpha}" title="${title}" aria-label="${title}"></span>`;
            }).join('');
            return `<span class="demand-heatmap-day">${day}</span>${cells}`;
        }).join('');

        const formatPeriodDate = (value) => {
            if (!value) return '';
            return typeof profile.formatDateShort === 'function' ? profile.formatDateShort(value) : value;
        };
        const periodLabel = rangeFrom && rangeTo
            ? `${formatPeriodDate(rangeFrom)} — ${formatPeriodDate(rangeTo)}`
            : 'весь доступный период';

        container.classList.toggle('is-detailed', isDetailed);
        container.innerHTML = `
            <div class="demand-heatmap-scroll">
                <div class="demand-heatmap-grid" style="--heat-columns:${buckets.length}">
                    <span></span>${headers}${rows}
                </div>
            </div>
            <div class="demand-heatmap-footer">
                <span>Низкий спрос</span>
                <span class="demand-heatmap-scale" aria-hidden="true"></span>
                <span>Высокий спрос</span>
                <span class="demand-heatmap-metric">Цвет: среднее за один такой день</span>
                <span class="demand-heatmap-period">Период: ${periodLabel}</span>
            </div>
        `;
        container.classList.toggle('is-empty', maxAverageMessages === 0);
        if (typeof profile.setCardEmptyState === 'function') {
            const message = forcePlaceholder
                ? 'Данные для выбранного периода ещё не сформированы'
                : 'Данные появятся после первых диалогов';
            profile.setCardEmptyState('card-analytics-messages', forcePlaceholder || maxAverageMessages === 0, message);
        }
    }

    function stabilizeAnalyticsCharts(card) {
        const rerender = () => {
            Object.values(profile.state.charts || {}).forEach((chart) => {
                if (chart && typeof chart.resize === 'function') chart.resize();
            });
            if (!card || card.id === 'card-analytics-messages') {
                renderDemandHeatmap(
                    profile._lastHourlyDemand || [],
                    Boolean(profile._lastDemandForcePlaceholder)
                );
            }
        };

        requestAnimationFrame(() => {
            requestAnimationFrame(rerender);
        });
        if (isSafariBrowser()) {
            window.setTimeout(rerender, 80);
            window.setTimeout(rerender, 180);
        }
    }

    function renderActivityCharts(stats, hourlyDemand = [], forcePlaceholder = false) {
        renderDemandHeatmap(hourlyDemand, forcePlaceholder);
        renderChart('activityPlatforms', 'activity-platforms-chart', stats, platformSeriesDefs, 'bar', forcePlaceholder);
        renderChart('activityResults', 'activity-results-chart', stats, resultSeriesDefs, 'conversion', forcePlaceholder);
    }

    function buildZeroStatsForRange(fromKey, toKey) {
        if (!fromKey || !toKey) return [];

        const start = new Date(`${fromKey}T00:00:00`);
        const end = new Date(`${toKey}T00:00:00`);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
            return [];
        }

        const rows = [];
        const cursor = new Date(start);
        while (cursor <= end) {
            rows.push({
                date: dateKey(cursor),
                user_msgs: 0,
                bot_msgs: 0,
                operator_msgs: 0,
                total_msgs: 0,
                spam_msgs: 0,
                bulk_msgs: 0,
                total_dialogs: 0,
                qualified_dialogs: 0,
                web_dialogs: 0,
                tg_dialogs: 0,
                max_dialogs: 0,
                vk_dialogs: 0,
                email_dialogs: 0,
                avito_dialogs: 0,
                leads: 0,
                applications: 0
            });
            cursor.setDate(cursor.getDate() + 1);
        }

        return rows;
    }

    async function loadAnalyticsData(isCurrent = () => true) {
        try {
            const period = profile.state.activityPeriod;
            const qp = new URLSearchParams({ client_id: getClientId() });
            const assistantIds = profile.getPreviewAssistantFilter?.() || [];
            qp.set('assistant_id', assistantIds.length ? assistantIds.join(',') : 'all');
            const customFrom = profile.state.customDateFrom || null;
            const customTo = profile.state.customDateTo || null;
            const selectedFrom = profile.state.dateRange?.from || null;
            const selectedTo = profile.state.dateRange?.to || null;
            if (period === 'custom' && customFrom) {
                qp.set('date_from', customFrom);
                qp.set('date_to', customTo || customFrom);
            } else if (selectedFrom && selectedTo) {
                qp.set('date_from', selectedFrom);
                qp.set('date_to', selectedTo);
            }

            const url = `/api/chat/admin/activity-stats?${qp.toString()}`;
            const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
            if (!res.ok) return;

            const data = await res.json();
            if (!isCurrent()) return;
            const stats = data.stats || [];
            const effective = (typeof profile.getEffectiveDateRange === 'function')
                ? profile.getEffectiveDateRange()
                : { from: null, to: null };
            const isFutureRange = Boolean(data?.future_range || (typeof profile.isFullFutureRange === 'function' && profile.isFullFutureRange(effective)));

            let normalizedStats = Array.isArray(stats) ? stats : [];
            if ((!normalizedStats.length || isFutureRange) && effective?.from && effective?.to) {
                normalizedStats = buildZeroStatsForRange(effective.from, effective.to);
            }

            profile._lastActivityStats = normalizedStats;
            profile._lastActivityMetadata = data?.metadata || {};
            if (profile && typeof profile.renderModeCompare === 'function') {
                profile.renderModeCompare(normalizedStats);
            }
            renderActivityCharts(normalizedStats, Array.isArray(data.hourly_demand) ? data.hourly_demand : [], isFutureRange);

        } catch (e) {
            console.warn('Failed to load analytics for profile', e);
        }
    }

    function getExpandedCard() {
        const expandedId = profile.state.analyticsExpandedCard;
        if (!expandedId) return null;
        return document.getElementById(expandedId);
    }

    function syncAnalyticsSidebarActions() {
        const sidebar = document.querySelector('.admin-sidebar');
        const backBtn = document.getElementById('analytics-sidebar-back-btn');
        const filtersBtn = document.getElementById('analytics-sidebar-filters-btn');
        const expandedCard = getExpandedCard();
        const hasExpanded = Boolean(expandedCard);

        if (sidebar) {
            sidebar.classList.toggle('analytics-mode', hasExpanded);
        }

        if (backBtn) {
            backBtn.disabled = !hasExpanded;
        }

        if (filtersBtn) {
            const isVisible = hasExpanded && Boolean(profile.state.analyticsSidebarFiltersOpen);

            filtersBtn.disabled = !hasExpanded;
            filtersBtn.classList.toggle('is-active', isVisible);
            filtersBtn.setAttribute(
                'title',
                hasExpanded
                    ? (isVisible ? 'Скрыть панель фильтров' : 'Показать панель фильтров')
                    : 'Откройте график на весь экран'
            );
        }
    }

    function isSafariBrowser() {
        const ua = navigator.userAgent || '';
        return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/i.test(ua);
    }

    function applyExpandedLayout(activeCard, hasExpanded) {
        const middleColumn = document.getElementById('profile-middle-column');
        const rightColumn = document.getElementById('profile-right-column');
        const leftColumn = document.getElementById('profile-left-column');

        const sidebarFiltersOpen = hasExpanded && Boolean(profile.state.analyticsSidebarFiltersOpen);
        const expandedInRightColumn = hasExpanded && !!activeCard && activeCard.closest('#profile-right-column');
        const expandedInMiddleColumn = hasExpanded && !!activeCard && activeCard.closest('#profile-middle-column');
        const faqExpanded = hasExpanded && !!activeCard && activeCard.id === 'card-faq';
        const isSafari = isSafariBrowser();
        const faqSplitScroll = faqExpanded && sidebarFiltersOpen && !isSafari;
        const faqSafariDualScroll = faqExpanded && sidebarFiltersOpen && isSafari;
        const shouldPreserveRightScroll = Boolean(rightColumn && faqExpanded && sidebarFiltersOpen);
        const rightScrollTop = shouldPreserveRightScroll ? rightColumn.scrollTop : 0;
        const rightWindowScrollTop = shouldPreserveRightScroll ? window.scrollY : 0;
        const rightWindowScrollLeft = shouldPreserveRightScroll ? window.scrollX : 0;

        document.body.classList.toggle('analytics-expanded-open', hasExpanded);
        document.body.classList.toggle('analytics-faq-expanded', faqExpanded && !faqSplitScroll && !faqSafariDualScroll);
        document.body.classList.toggle('analytics-faq-split-scroll', faqSplitScroll);
        document.body.classList.toggle('safari-no-faq-split-scroll', false);
        document.body.classList.toggle('safari-faq-dual-scroll', faqSafariDualScroll);

        if (middleColumn) {
            middleColumn.classList.toggle('analytics-focus-active', expandedInMiddleColumn);
            middleColumn.classList.toggle('analytics-hidden', expandedInRightColumn);
        }

        if (rightColumn) {
            rightColumn.classList.toggle('analytics-focus-active', expandedInRightColumn);
            rightColumn.classList.toggle('analytics-hidden', expandedInMiddleColumn);
            rightColumn.classList.toggle('analytics-faq-expanded-column', faqExpanded && !!expandedInRightColumn && !faqSplitScroll && !faqSafariDualScroll);
            rightColumn.classList.toggle('analytics-faq-split-column', faqSplitScroll && !!expandedInRightColumn);
            rightColumn.classList.toggle('analytics-faq-safari-dual-column', faqSafariDualScroll && !!expandedInRightColumn);
        }

        if (leftColumn) {
            leftColumn.classList.toggle('analytics-hidden', hasExpanded && !sidebarFiltersOpen);
            leftColumn.classList.toggle('analytics-split-filters-visible', hasExpanded && sidebarFiltersOpen);
        }

        const filtersCard = document.getElementById('card-analytics-filters');
        if (filtersCard && hasExpanded && sidebarFiltersOpen) {
            filtersCard.classList.remove('is-collapsed');
        }

        if (shouldPreserveRightScroll) {
            requestAnimationFrame(() => {
                if (rightColumn) rightColumn.scrollTop = rightScrollTop;
                window.scrollTo(rightWindowScrollLeft, rightWindowScrollTop);
            });
        }

        syncAnalyticsSidebarActions();
    }

    function setAnalyticsExpanded(card, expanded) {
        const prevExpandedId = profile.state.analyticsExpandedCard || null;
        const nextExpandedId = expanded && card ? card.id : null;
        const expandedCardChanged = prevExpandedId !== nextExpandedId;
        const restoreVisibility = (el) => {
            if (!el) return;
            el.style.removeProperty('display');
            el.style.removeProperty('visibility');
            el.style.removeProperty('opacity');
            el.removeAttribute('hidden');
        };

        const normalizeCollapsedCard = (item) => {
            item.classList.remove('is-calendar-open');

            const wrapper = item.querySelector('.profile-calendar-wrapper');
            const chartContainer = item.querySelector('.analytics-main-chart-container');
            const filtersGrid = item.querySelector('.activity-filters-grid');
            const header = item.querySelector('.card-header-flex');
            const title = item.querySelector('.card-title');
            const subtitle = item.querySelector('.card-subtitle');
            const period = item.querySelector('.period-selector');
            const titleGroup = header ? header.querySelector('div') : null;

            if (wrapper) wrapper.style.display = 'none';
            if (chartContainer) chartContainer.style.display = '';
            if (filtersGrid) filtersGrid.style.display = '';

            restoreVisibility(header);
            restoreVisibility(titleGroup);
            restoreVisibility(title);
            restoreVisibility(subtitle);
            restoreVisibility(period);
        };

        const normalizeAllCollapsedCards = () => {
            const cards = document.querySelectorAll('.analytics-card');
            cards.forEach((item) => {
                if (!item.classList.contains('is-expanded')) {
                    normalizeCollapsedCard(item);
                }
            });
        };

        if (expandedCardChanged) {
            const cards = document.querySelectorAll('.analytics-card');
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

                if (!opened) normalizeCollapsedCard(item);
            });
        }

        profile.state.analyticsExpandedCard = nextExpandedId;
        const hasExpanded = !!nextExpandedId;
        if (!hasExpanded) {
            profile.state.analyticsSidebarFiltersOpen = false;
            normalizeAllCollapsedCards();
        }

        const activeCard = hasExpanded ? (card || document.getElementById(nextExpandedId)) : null;
        applyExpandedLayout(activeCard, hasExpanded);

        if (!hasExpanded) {
            requestAnimationFrame(() => {
                normalizeAllCollapsedCards();
                requestAnimationFrame(() => {
                    normalizeAllCollapsedCards();
                });
            });
        }

        stabilizeAnalyticsCharts(card || (prevExpandedId ? document.getElementById(prevExpandedId) : null));

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
                        profile.state.activityPeriod = null;
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

        const sidebarBackBtn = document.getElementById('analytics-sidebar-back-btn');
        const sidebarFiltersBtn = document.getElementById('analytics-sidebar-filters-btn');

        if (sidebarBackBtn) {
            profile._analyticsSidebarBackHandler = () => {
                const activeCard = getExpandedCard();
                if (!activeCard) return;
                setAnalyticsExpanded(activeCard, false);
                toggleProfileCalendar(activeCard, false);
            };
            sidebarBackBtn.addEventListener('click', profile._analyticsSidebarBackHandler);
        }

        if (sidebarFiltersBtn) {
            profile._analyticsSidebarFiltersHandler = () => {
                const activeCard = getExpandedCard();
                if (!activeCard) return;

                const nextOpen = !profile.state.analyticsSidebarFiltersOpen;
                profile.state.analyticsSidebarFiltersOpen = nextOpen;

                setAnalyticsExpanded(activeCard, true);

                const filtersCard = document.getElementById('card-analytics-filters');
                if (filtersCard && nextOpen) {
                    filtersCard.classList.remove('is-collapsed');
                    requestAnimationFrame(() => {
                        filtersCard.style.transform = 'translateZ(0)';
                        filtersCard.offsetHeight;
                        filtersCard.style.transform = '';
                    });
                }
            };
            sidebarFiltersBtn.addEventListener('click', profile._analyticsSidebarFiltersHandler);
        }

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
                    const pageScrollTop = window.scrollY;
                    const column = card.closest('.appearance-column');
                    const columnScrollTop = column?.scrollTop || 0;
                    profile.state.analyticsSidebarFiltersOpen = false;
                    setAnalyticsExpanded(card, true);
                    if (filtersGrid) {
                        filtersGrid.classList.remove('is-hidden');
                        filtersGrid.style.display = 'grid';
                    }
                    if (card.id === 'card-faq') {
                        requestAnimationFrame(() => {
                            window.scrollTo(window.scrollX, pageScrollTop);
                            if (column) column.scrollTop = columnScrollTop;
                        });
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
                const activeCard = getExpandedCard();
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
        async loadAnalyticsData(isCurrent) {
            await loadAnalyticsData(isCurrent);
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

            const sidebarBackBtn = document.getElementById('analytics-sidebar-back-btn');
            if (sidebarBackBtn && profile._analyticsSidebarBackHandler) {
                sidebarBackBtn.removeEventListener('click', profile._analyticsSidebarBackHandler);
                profile._analyticsSidebarBackHandler = null;
            }

            const sidebarFiltersBtn = document.getElementById('analytics-sidebar-filters-btn');
            if (sidebarFiltersBtn && profile._analyticsSidebarFiltersHandler) {
                sidebarFiltersBtn.removeEventListener('click', profile._analyticsSidebarFiltersHandler);
                profile._analyticsSidebarFiltersHandler = null;
            }

            setAnalyticsExpanded(null, false);

            ['activityPlatforms', 'activityResults', 'main'].forEach((key) => {
                if (profile.state.charts[key]) {
                    profile.state.charts[key].destroy();
                    delete profile.state.charts[key];
                }
            });
        }
    };
}
