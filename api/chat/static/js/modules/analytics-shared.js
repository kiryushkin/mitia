export function getAppliedAnalyticsAssistantFilter() {
    return window.AdminApp?.getAnalyticsAssistantFilter?.() || [];
}

function keepExistingAssistantIds(values) {
    const assistants = window.AdminApp?.getAssistantsList?.() || [];
    if (!assistants.length) return Array.isArray(values) ? values : [];
    const validAssistantIds = new Set(assistants.map((item) => item.assistant_id));
    return (Array.isArray(values) ? values : [])
        .filter((assistantId) => validAssistantIds.has(assistantId));
}

export function getPreviewAnalyticsAssistantFilter() {
    const preview = window.AdminApp?.modules?.analytics?.getPreviewAssistantFilter?.()
        || getAppliedAnalyticsAssistantFilter();
    return keepExistingAssistantIds(preview);
}

export function sameAssistantFilter(a = [], b = []) {
    return JSON.stringify(Array.isArray(a) ? a : []) === JSON.stringify(Array.isArray(b) ? b : []);
}

export async function renderAnalyticsAssistantButtons(selected = getAppliedAnalyticsAssistantFilter()) {
    const container = document.getElementById('analytics-assistant-buttons');
    if (!container) return;

    let assistants = window.AdminApp?.getAssistantsList?.() || [];
    if (!assistants.length) {
        try {
            const token = localStorage.getItem('chatadmin_auth_token');
            const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
            const res = await fetch(`/api/chat/admin/assistants?client_id=${encodeURIComponent(clientId)}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            assistants = Array.isArray(data.assistants)
                ? data.assistants.map((item) => ({
                    assistant_id: item.assistant_id,
                    name: item.name || item.config?.bot_settings?.bot_name || item.assistant_id,
                }))
                : [];
            window.AdminApp?.setAssistantsList?.(assistants);
        } catch (_) {
            assistants = [];
        }
    }

    const validAssistantIds = new Set(assistants.map((item) => item.assistant_id));
    const active = (Array.isArray(selected) ? selected : [])
        .filter((assistantId) => validAssistantIds.has(assistantId));
    const analytics = window.AdminApp?.modules?.analytics;
    if (!sameAssistantFilter(active, selected)) {
        analytics?.setDraftAssistantFilter?.(active);
    }
    const items = [...assistants];

    container.innerHTML = items.map((item) => `
        <button class="filter-btn${active.includes(item.assistant_id) ? ' active' : ''}" data-analytics-assistant="${item.assistant_id}">${item.name}</button>
    `).join('');

    container.querySelectorAll('[data-analytics-assistant]').forEach((btn) => {
        btn.onclick = () => {
            const next = btn.dataset.analyticsAssistant || '';
            const currentAnalytics = window.AdminApp?.modules?.analytics;
            const current = currentAnalytics?.getPreviewAssistantFilter?.() || [];
            const idx = current.indexOf(next);
            if (idx >= 0) current.splice(idx, 1);
            else current.push(next);
            currentAnalytics?.setDraftAssistantFilter?.(current);
            renderAnalyticsAssistantButtons(current);
            currentAnalytics?.reloadAnalyticsAndFaq?.();
        };
    });
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/'/g, '&#39;');
}

export function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return escapeHtml(String(value));

    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
}
