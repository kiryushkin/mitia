import { escapeHtml } from './analytics-shared.js?v=106';

export const FaqModule = {

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

    buildFaqTrendRowsHtml(rows, options = {}, analyticsModule) {
        const palette = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#a8e6cf', '#6ea8ff', '#f78fb3', '#c3aed6', '#7bed9f'];
        const dateLabels = Array.isArray(options.dateLabels) ? options.dateLabels : [];

        const rowsHtml = rows.map((row, index) => {
            const color = palette[index % palette.length];
            const points = this.buildFaqTrendPoints(row.series);
            const title = escapeHtml(row.question || '—');
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
        const firstShort = escapeHtml(analyticsModule.formatDateShort(first));
        const middleShort = escapeHtml(analyticsModule.formatDateShort(middle));
        const lastShort = escapeHtml(analyticsModule.formatDateShort(last));
        const firstFull = escapeHtml(first);
        const middleFull = escapeHtml(middle);
        const lastFull = escapeHtml(last);

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
            const messageCount = Number(row.messageCount || 0);
            const pct = Math.max(2, Math.round((total / max) * 100));
            const color = palette[(index * 7 + 3) % palette.length];
            const question = escapeHtml(row.question || '—');
            return `
                <div class="faq-rank-item">
                    <div class="faq-rank-title">${question}</div>
                    <div class="faq-rank-line">
                        <div class="faq-bar-track">
                            <div class="faq-bar-fill" style="width:${pct}%;background:${color}"></div>
                        </div>
                        <span class="faq-rank-total" title="Сообщений: ${messageCount}">${total}</span>
                    </div>
                </div>
            `;
        }).join('');
    },

    applySavedFaqViewMode(analyticsModule, _) {
        analyticsModule.state.faqViewMode = 'summary';
        analyticsModule.syncFaqUiState();
    },

    getFaqPeriodLabel(dateLabels = [], analyticsModule) {
        if (dateLabels.length > 1) {
            const from = escapeHtml(analyticsModule.formatDateShort(dateLabels[0]));
            const to = escapeHtml(analyticsModule.formatDateShort(dateLabels[dateLabels.length - 1]));
            return `<div class="faq-period-label">Период: ${from} — ${to}</div>`;
        }
        if (analyticsModule.state.dateRange?.from && analyticsModule.state.dateRange?.to) {
            const from = escapeHtml(analyticsModule.formatDateShort(analyticsModule.state.dateRange.from));
            const to = escapeHtml(analyticsModule.formatDateShort(analyticsModule.state.dateRange.to));
            return `<div class="faq-period-label">Период: ${from} — ${to}</div>`;
        }
        if (analyticsModule.state.dateRange?.from) {
            const day = escapeHtml(analyticsModule.formatDateShort(analyticsModule.state.dateRange.from));
            return `<div class="faq-period-label">Дата: ${day}</div>`;
        }
        return '';
    },

    renderFaqSummary(rows, dateLabels = [], analyticsModule) {
        const container = document.getElementById('faq-container');
        const faqCard = document.getElementById('card-faq');
        if (!container) return false;

        const sorted = [...rows]
            .filter((row) => Number(row.total || 0) > 0)
            .sort((a, b) => Number(b.total || 0) - Number(a.total || 0));

        if (!sorted.length) return false;

        const periodLabel = this.getFaqPeriodLabel(dateLabels, analyticsModule);
        container.innerHTML = `${periodLabel}${this.buildFaqRankRowsHtml(sorted)}`;
        if (faqCard) faqCard.classList.remove('is-empty');
        return true;
    },

    renderFaqFromSnapshot(data, analyticsModule) {
        analyticsModule.state.faqLastSnapshot = data || null;
        const dateLabels = [];

        const rows = (Array.isArray(data?.frequent_requests) ? data.frequent_requests : [])
            .map((item) => ({
                question: String(item?.q || item?.question || '').trim(),
                total: Number(item?.count || 0),
                messageCount: Number(item?.message_count || item?.count || 0),
                series: [Number(item?.count || 0)]
            }))
            .filter((item) => item.question && item.total > 0);

        return this.renderFaqSummary(rows, dateLabels, analyticsModule);
    },

    getFaqNoDataMessage(analyticsModule) {
        const from = analyticsModule.state.dateRange?.from;
        const to = analyticsModule.state.dateRange?.to;

        if (from && to && from !== to) {
            return `За период ${analyticsModule.formatDateShort(from)} — ${analyticsModule.formatDateShort(to)} клиентских вопросов не обнаружено.`;
        }

        if (from) {
            return `За ${analyticsModule.formatDateShort(from)} клиентских вопросов не обнаружено.`;
        }

        return 'За выбранный период клиентских вопросов не обнаружено.';
    },

    renderFaqNoData(message) {
        const container = document.getElementById('faq-container');
        const faqCard = document.getElementById('card-faq');
        if (!container) return;
        if (faqCard) faqCard.classList.add('is-empty');
        container.innerHTML = `
            <div class="analytics-empty-state analytics-empty-state--block">
                <div class="analytics-empty-state-text">${escapeHtml(message)}</div>
            </div>
        `;
    }
};

export function getFaqNoDataMessage(context) {
    return FaqModule.getFaqNoDataMessage(context);
}

export function renderFaqNoData(_context, message) {
    return FaqModule.renderFaqNoData(message);
}
