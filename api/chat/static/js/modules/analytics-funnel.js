export const FunnelModule = {
    state: {
        charts: {}
    },

    async loadModeComparisonData(analyticsModule) {
        try {
            const token = analyticsModule.getToken();
            const [assistantRes, operatorRes] = await Promise.all([
                fetch(`/api/chat/admin/activity-stats?${analyticsModule.buildRangeQuery('assistant').toString()}`, {
                    headers: { Authorization: `Bearer ${token}` }
                }),
                fetch(`/api/chat/admin/activity-stats?${analyticsModule.buildRangeQuery('operator').toString()}`, {
                    headers: { Authorization: `Bearer ${token}` }
                })
            ]);

            if (!assistantRes.ok || !operatorRes.ok) return null;

            const assistantData = await assistantRes.json();
            const operatorData = await operatorRes.json();
            const requestedFutureRange = analyticsModule.isFullFutureRange(analyticsModule.getEffectiveDateRange());

            return {
                assistant: Array.isArray(assistantData?.stats) ? assistantData.stats : [],
                operator: Array.isArray(operatorData?.stats) ? operatorData.stats : [],
                futureRange: Boolean(assistantData?.future_range || operatorData?.future_range || requestedFutureRange)
            };
        } catch (_) {
            return null;
        }
    },

    destroyCharts() {
        ['modeShare', 'modeTrend', 'modeFunnel'].forEach((key) => {
            if (this.state.charts[key]) {
                this.state.charts[key].destroy();
                delete this.state.charts[key];
            }
        });
    },

    updateFunnelPeriodSubtitle(range, analyticsModule) {
        const card = document.getElementById('card-analytics-mode-funnel');
        const subtitle = card?.querySelector('.card-subtitle');
        if (!subtitle) return;

        const baseText = 'Сопоставление объёма сообщений, диалогов и лидов с участием ассистента и оператора';
        const normalized = analyticsModule.normalizeDateRange(range);
        if (!normalized.from || !normalized.to) {
            subtitle.textContent = baseText;
            return;
        }

        const fromLabel = analyticsModule.formatDateShort(normalized.from);
        const toLabel = analyticsModule.formatDateShort(normalized.to);
        subtitle.textContent = normalized.from === normalized.to
            ? `${baseText} за ${fromLabel}`
            : `${baseText} за период ${fromLabel} — ${toLabel}`;
    },

    renderModeCompare(payload, analyticsModule) {
        const assistantRows = Array.isArray(payload?.assistant) ? payload.assistant : [];
        const operatorRows = Array.isArray(payload?.operator) ? payload.operator : [];
        const effectiveRange = analyticsModule.getEffectiveDateRange();
        const isFutureRange = Boolean(payload?.futureRange || analyticsModule.isFullFutureRange(effectiveRange));

        this.updateFunnelPeriodSubtitle(effectiveRange, analyticsModule);

        const buildDemoSeries = (length, seriesIndex, min, max) => {
            const safeLength = Math.max(1, length);
            return Array.from({ length: safeLength }, (_, pointIndex) => {
                const progress = safeLength === 1 ? 0 : pointIndex / (safeLength - 1);
                const wave = Math.sin(progress * Math.PI * (2.1 + seriesIndex * 0.4) + seriesIndex * 0.8);
                const pulse = Math.cos(progress * Math.PI * 4 + seriesIndex * 0.45);
                const normalized = Math.max(0.08, 0.54 + wave * 0.25 + pulse * 0.11);
                return Number((min + normalized * (max - min)).toFixed(2));
            });
        };

        const buildRangeLabels = () => {
            const from = effectiveRange?.from;
            const to = effectiveRange?.to;
            if (!from || !to) return ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

            const start = new Date(`${from}T00:00:00`);
            const end = new Date(`${to}T00:00:00`);
            if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
                return ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
            }

            const labels = [];
            const cursor = new Date(start);
            while (cursor <= end) {
                labels.push(cursor.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }));
                cursor.setDate(cursor.getDate() + 1);
            }

            return labels.length ? labels : ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
        };

        const shareCanvas = document.getElementById('analytics-mode-share-chart');
        const trendCanvas = document.getElementById('analytics-mode-trend-chart');
        const funnelCanvas = document.getElementById('analytics-mode-funnel-chart');
        if (!shareCanvas || !trendCanvas || !funnelCanvas) return;

        this.destroyCharts();

        const sum = (rows, field) => rows.reduce((acc, row) => acc + Number(row?.[field] || 0), 0);

        const assistantTotals = {
            msgs: sum(assistantRows, 'bot_msgs'),
            dialogs: sum(assistantRows, 'total_dialogs'),
            leads: sum(assistantRows, 'leads')
        };
        const operatorTotals = {
            msgs: sum(operatorRows, 'operator_msgs'),
            dialogs: sum(operatorRows, 'total_dialogs'),
            leads: sum(operatorRows, 'leads')
        };

        const totalMsgs = assistantTotals.msgs + operatorTotals.msgs;
        const assistantShare = totalMsgs ? (assistantTotals.msgs / totalMsgs) * 100 : 0;
        const operatorShare = totalMsgs ? (operatorTotals.msgs / totalMsgs) * 100 : 0;

        const hasModeData = (
            assistantTotals.msgs + assistantTotals.dialogs + assistantTotals.leads +
            operatorTotals.msgs + operatorTotals.dialogs + operatorTotals.leads
        ) > 0;

        if (typeof Chart === 'undefined') {
            return;
        }

        const isPlaceholder = !hasModeData || isFutureRange;
        const tooltipMarkerCallbacks = {
            labelColor(context) {
                const dataset = context.dataset || {};
                const source = dataset.borderColor || dataset.backgroundColor || '#fff';
                const color = Array.isArray(source)
                    ? (source[context.dataIndex] || source[0] || '#fff')
                    : source;
                return { borderColor: color, backgroundColor: 'rgba(0,0,0,0)', borderWidth: 2 };
            },
            labelPointStyle() {
                return { pointStyle: 'circle', rotation: 0 };
            }
        };
        const buildTooltip = (callbacks = {}) => ({
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
            callbacks: { ...tooltipMarkerCallbacks, ...callbacks }
        });
        const emptyMessage = isFutureRange
            ? 'Выбранная дата ещё не наступила, данные появятся позже.'
            : 'Данные появятся после первых диалогов';
        analyticsModule.setCardEmptyState('card-analytics-mode-share', isPlaceholder, emptyMessage);
        analyticsModule.setCardEmptyState('card-analytics-mode-trend', isPlaceholder, emptyMessage);
        analyticsModule.setCardEmptyState('card-analytics-mode-funnel', isPlaceholder, emptyMessage);

        this.state.charts.modeShare = new Chart(shareCanvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Ассистент', 'Оператор'],
                datasets: [{
                    data: isPlaceholder ? [62, 38] : [assistantShare.toFixed(2), operatorShare.toFixed(2)],
                    backgroundColor: isPlaceholder ? ['rgba(255,255,255,0.18)', 'rgba(255,255,255,0.10)'] : ['#7000FF', '#FF007A'],
                    borderColor: isPlaceholder ? ['rgba(255,255,255,0.25)', 'rgba(255,255,255,0.16)'] : ['rgba(112,0,255,0.8)', 'rgba(255,0,122,0.8)'],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '64%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: 'rgba(255,255,255,0.82)',
                            usePointStyle: true,
                            pointStyle: 'circle',
                            boxWidth: 10,
                            boxHeight: 10,
                            padding: 12,
                            font: { size: 14, family: 'Geist, sans-serif', weight: '500', lineHeight: 1.2 },
                            generateLabels(chart) {
                                const dataset = chart?.data?.datasets?.[0];
                                const labels = chart?.data?.labels || [];
                                if (!dataset) return [];

                                return labels.map((label, index) => {
                                    const color = Array.isArray(dataset.backgroundColor)
                                        ? (dataset.backgroundColor[index] || '#fff')
                                        : (dataset.backgroundColor || '#fff');
                                    const value = Number(dataset.data?.[index] ?? 0);
                                    const shownValue = isPlaceholder ? 0 : value;
                                    return {
                                        text: `${label}: ${shownValue.toFixed(1)}%`,
                                        fillStyle: 'rgba(0,0,0,0)',
                                        strokeStyle: color,
                                        lineWidth: 2,
                                        hidden: !chart.getDataVisibility(index),
                                        datasetIndex: 0,
                                        index,
                                        pointStyle: 'circle',
                                        color: 'rgba(255,255,255,0.92)',
                                        fontColor: 'rgba(255,255,255,0.92)'
                                    };
                                });
                            }
                        }
                    },
                    tooltip: isPlaceholder ? { enabled: false } : buildTooltip({
                        label(context) {
                            const value = Number(context.raw || 0);
                            return `${context.label}: ${value.toFixed(1)}%`;
                        }
                    })
                }
            }
        });

        const labels = isPlaceholder
            ? buildRangeLabels()
            : assistantRows.map((row) => {
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
                        data: isPlaceholder
                            ? buildDemoSeries(labels.length || 7, 0, 2, 14)
                            : assistantRows.map((r) => Number(r?.bot_msgs || 0)),
                        borderColor: isPlaceholder ? 'rgba(255,255,255,0.26)' : '#7000FF',
                        backgroundColor: isPlaceholder ? 'rgba(255,255,255,0.08)' : 'rgba(112,0,255,0.12)',
                        fill: true,
                        tension: 0.32,
                        pointRadius: 3,
                        pointHoverRadius: isPlaceholder ? 3 : 5,
                        pointStyle: 'circle',
                        pointBackgroundColor: 'rgba(0,0,0,0)',
                        pointBorderColor: isPlaceholder ? 'rgba(255,255,255,0.26)' : '#7000FF',
                        pointBorderWidth: 2,
                        clip: 8,
                        borderWidth: 2
                    },
                    {
                        label: 'Оператор',
                        data: isPlaceholder
                            ? buildDemoSeries(labels.length || 7, 1, 1, 9)
                            : operatorRows.map((r) => Number(r?.operator_msgs || 0)),
                        borderColor: isPlaceholder ? 'rgba(255,255,255,0.16)' : '#FF007A',
                        backgroundColor: isPlaceholder ? 'rgba(255,255,255,0.04)' : 'rgba(255,0,122,0.12)',
                        fill: true,
                        tension: 0.32,
                        pointRadius: 3,
                        pointHoverRadius: isPlaceholder ? 3 : 5,
                        pointStyle: 'circle',
                        pointBackgroundColor: 'rgba(0,0,0,0)',
                        pointBorderColor: isPlaceholder ? 'rgba(255,255,255,0.16)' : '#FF007A',
                        pointBorderWidth: 2,
                        clip: 8,
                        borderWidth: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: 'rgba(255,255,255,0.82)',
                            usePointStyle: true,
                            pointStyle: 'circle',
                            boxWidth: 10,
                            boxHeight: 10,
                            padding: 12,
                            font: { size: 14, family: 'Geist, sans-serif', weight: '500', lineHeight: 1.2 },
                            generateLabels(chart) {
                                const datasets = chart?.data?.datasets || [];
                                return datasets.map((dataset, index) => {
                                    const color = Array.isArray(dataset.borderColor)
                                        ? (dataset.borderColor[0] || '#fff')
                                        : (dataset.borderColor || '#fff');
                                    const total = (dataset.data || []).reduce((sum, value) => sum + (Number(value) || 0), 0);
                                    const shownTotal = isPlaceholder ? 0 : total;
                                    return {
                                        text: `${dataset.label} ${Math.round(shownTotal)}`,
                                        fillStyle: 'rgba(0,0,0,0)',
                                        strokeStyle: color,
                                        lineWidth: 2,
                                        fontColor: 'rgba(255,255,255,0.82)',
                                        color: 'rgba(255,255,255,0.82)',
                                        hidden: !chart.isDatasetVisible(index),
                                        datasetIndex: index,
                                        pointStyle: 'circle'
                                    };
                                });
                            }
                        }
                    },
                    tooltip: isPlaceholder ? { enabled: false } : buildTooltip()
                },
                scales: {
                    x: {
                        grid: { display: false },
                        offset: true,
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

        const assistantAbsolute = [assistantTotals.dialogs, assistantTotals.msgs, assistantTotals.leads];
        const operatorAbsolute = [operatorTotals.dialogs, operatorTotals.msgs, operatorTotals.leads];

        this.state.charts.modeFunnel = new Chart(funnelCanvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['Диалоги участия', 'Ответы', 'Лиды'],
                datasets: [
                    {
                        label: 'Ассистент',
                        data: isPlaceholder ? [8, 14, 3] : assistantAbsolute,
                        backgroundColor: isPlaceholder ? 'rgba(255,255,255,0.16)' : 'rgba(112,0,255,0.7)',
                        borderRadius: 8,
                        _absolute: assistantAbsolute
                    },
                    {
                        label: 'Оператор',
                        data: isPlaceholder ? [5, 8, 2] : operatorAbsolute,
                        backgroundColor: isPlaceholder ? 'rgba(255,255,255,0.10)' : 'rgba(0,229,255,0.7)',
                        borderRadius: 8,
                        _absolute: operatorAbsolute
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: 'rgba(255,255,255,0.82)',
                            usePointStyle: true,
                            pointStyle: 'circle',
                            boxWidth: 10,
                            boxHeight: 10,
                            padding: 12,
                            font: { size: 14, family: 'Geist, sans-serif', weight: '500', lineHeight: 1.2 },
                            generateLabels(chart) {
                                const datasets = chart?.data?.datasets || [];
                                return datasets.map((dataset, index) => {
                                    const color = Array.isArray(dataset.backgroundColor)
                                        ? (dataset.backgroundColor[0] || '#fff')
                                        : (dataset.backgroundColor || '#fff');
                                    const abs = Array.isArray(dataset._absolute) ? dataset._absolute : (dataset.data || []);
                                    const shownTotal = isPlaceholder ? 0 : Number(abs[0] || 0);
                                    return {
                                        text: `${dataset.label}: ${Math.round(shownTotal)} диалог.`,
                                        fillStyle: 'rgba(0,0,0,0)',
                                        strokeStyle: color,
                                        lineWidth: 2,
                                        fontColor: 'rgba(255,255,255,0.82)',
                                        color: 'rgba(255,255,255,0.82)',
                                        hidden: !chart.isDatasetVisible(index),
                                        datasetIndex: index,
                                        pointStyle: 'circle'
                                    };
                                });
                            }
                        }
                    },
                    tooltip: isPlaceholder ? { enabled: false } : buildTooltip({
                        label(context) {
                            const abs = context.dataset._absolute || context.dataset.data || [];
                            const value = Number(abs[context.dataIndex] || 0);
                            return `${context.dataset.label}: ${Math.round(value)}`;
                        }
                    })
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
    }
};
