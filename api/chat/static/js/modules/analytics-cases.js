import { escapeHtml, formatDateTime } from './analytics-shared.js';

export const CasesModule = {

    async loadCloseReasonsAnalytics(analyticsModule) {
        try {
            const token = analyticsModule.getToken();
            const qp = analyticsModule.buildRangeQuery();
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
                    <div class="close-reasons-row-name" title="${escapeHtml(row.reason || '—')}">${escapeHtml(row.reason || '—')}</div>
                    <div class="close-reasons-row-count">${Number(row.count || 0)}</div>
                    <div class="close-reasons-row-share">${Number(row.share_percent || 0).toFixed(2)}%</div>
                </div>
            `).join('')
            : '<div class="analytics-placeholder-text">Нет пользовательских причин за период</div>';

        const systemRows = system.length
            ? system.map((row) => `
                <div class="close-reasons-row">
                    <div class="close-reasons-row-name" title="${escapeHtml(row.reason || '—')}">${escapeHtml(row.reason || '—')}</div>
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

    renderCloseReasonsPlaceholder(message) {
        const container = document.getElementById('close-reasons-container');
        if (!container) return;
        container.innerHTML = `<div class="analytics-placeholder"><div class="analytics-placeholder-text">${escapeHtml(message)}</div></div>`;
    },

    async loadCaseHistory(analyticsModule) {
        try {
            const token = analyticsModule.getToken();
            const qp = analyticsModule.buildRangeQuery();
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

    renderCaseHistory(dialogs) {
        const container = document.getElementById('case-history-container');
        if (!container) return;

        const safeDialogs = Array.isArray(dialogs) ? dialogs : [];
        if (!safeDialogs.length) {
            this.renderCaseHistoryPlaceholder('За выбранный период кейсы не найдены.');
            return;
        }

        container.innerHTML = safeDialogs.map((dialog) => {
            const sessionId = escapeHtml(dialog?.session_id || '—');
            const platform = escapeHtml((dialog?.platform || 'web').toString().toUpperCase());
            const latest = escapeHtml(formatDateTime(dialog?.latest_case_opened));
            const cases = Array.isArray(dialog?.cases) ? dialog.cases : [];

            const casesHtml = cases.map((item) => {
                const number = Number(item?.case_number || 0);
                const opened = escapeHtml(formatDateTime(item?.opened_at));
                const closed = escapeHtml(formatDateTime(item?.closed_at));
                const closeReason = escapeHtml(item?.close_reason || '—');
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

    renderCaseHistoryPlaceholder(message) {
        const container = document.getElementById('case-history-container');
        if (!container) return;
        container.innerHTML = `<div class="analytics-placeholder"><div class="analytics-placeholder-text">${escapeHtml(message)}</div></div>`;
    }
};