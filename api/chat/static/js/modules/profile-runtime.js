export async function loadNewsPreview() {
    const list = document.getElementById('profile-news-list');
    if (!list) return;
    try {
        const module = window.AdminApp?.modules?.newsShared;
        if (!module || typeof module.load !== 'function') return;
        const items = await module.load(3);
        module.renderList(list, items, { mode: 'preview' });
        module.bindListActions(document);
        module.updateBadge(document);
    } catch (error) {
        list.innerHTML = '<div class="setting-item"><p class="setting-hint">Не удалось загрузить новости.</p></div>';
    }
}

export async function pollBalance() {
    try {
        const clientId = new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id') || 'mitia_assistant';
        const token = localStorage.getItem('chatadmin_auth_token');
        const res = await fetch(`/api/chat/admin/balance?client_id=${clientId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401) { this.stopPolling(); return; }
        const data = await res.json();
        if (data.status === 'success') {
            const used = data.messages_consumed || 0;
            const baseLimit = Math.max(Number(data.messages_limit || 0), 0);
            const extraRemaining = Math.max(Number(data.extra_messages_remaining || 0), 0);
            const totalLimit = baseLimit + extraRemaining;
            const totalRemaining = Math.max(Number(data.messages_total_remaining ?? Math.max(baseLimit - used, 0)), 0);
            const consumedTotal = Math.max(totalLimit - totalRemaining, 0);
            const limitText = document.getElementById('tariff-limit-text');
            const assistantsLimitText = document.getElementById('assistants-limit-text');
            const progressBar = document.getElementById('tariff-progress-bar');
            const assistantsProgressBar = document.getElementById('assistants-limit-progress-bar');
            const resetEl = document.getElementById('tariff-reset');
            if (limitText) limitText.textContent = `${consumedTotal}/${totalLimit}`;
            if (assistantsLimitText) {
                const totalAssistants = Number(data.assistants_limit || 0);
                const usedAssistants = Number(this.state?.assistants_backend_items?.length || 0);
                assistantsLimitText.textContent = `${usedAssistants}/${totalAssistants}`;
                if (assistantsProgressBar) {
                    assistantsProgressBar.style.width = `${Math.min((usedAssistants / Math.max(totalAssistants, 1)) * 100, 100)}%`;
                }
            }
            if (progressBar) progressBar.style.width = `${Math.min((consumedTotal / Math.max(totalLimit, 1)) * 100, 100)}%`;
            if (resetEl) resetEl.style.display = 'none';
            const balanceEl = document.getElementById('user-balance');
            if (balanceEl) balanceEl.textContent = `${data.balance || 0} ₽`;
        }
    } catch (e) {}
}
