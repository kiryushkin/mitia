export const NewsModule = {
    state: {
        items: [],
        loaded: false,
        unreadCount: 0,
    },

    getClientId() {
        return new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id') || 'mitia_assistant';
    },

    getToken() {
        return localStorage.getItem('chatadmin_auth_token');
    },

    formatDate(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    },

    async load(limit = 5) {
        const token = this.getToken();
        if (!token) return [];
        const clientId = this.getClientId();
        const response = await fetch(`/api/chat/admin/notifications?client_id=${encodeURIComponent(clientId)}&limit=${limit}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json();
        this.state.items = Array.isArray(data.items) ? data.items : [];
        this.state.unreadCount = Number(data.unread_count || 0);
        this.state.loaded = true;
        return this.state.items;
    },

    async markRead(notificationId) {
        const token = this.getToken();
        if (!token || !notificationId) return;
        const clientId = this.getClientId();
        await fetch(`/api/chat/admin/notifications/${notificationId}/read?client_id=${encodeURIComponent(clientId)}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` }
        });
    },

    async markAllRead() {
        const token = this.getToken();
        if (!token) return 0;
        const clientId = this.getClientId();
        const response = await fetch(`/api/chat/admin/notifications/read-all?client_id=${encodeURIComponent(clientId)}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json();
        this.state.unreadCount = Number(data.unread_count || 0);
        this.state.items = this.state.items.map((item) => ({ ...item, is_read: true }));
        return Number(data.updated || 0);
    },

    updateBadge(root = document) {
        const badge = root.querySelector('[data-news-unread-badge]');
        if (!badge) return;
        const count = Number(this.state.unreadCount || 0);
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.hidden = count <= 0;
    },

    truncate(text, limit = 140) {
        const value = String(text || '').trim();
        if (value.length <= limit) return value;
        return `${value.slice(0, limit - 1).trimEnd()}…`;
    },

    renderList(container, items = [], options = {}) {
        if (!container) return;
        const isPreview = options.mode === 'preview';
        if (!items.length) {
            container.innerHTML = isPreview
                ? '<div class="setting-item"><p class="setting-hint">Пока новостей и уведомлений нет.</p></div>'
                : '<div class="news-empty-state"><p class="setting-hint">Пока новостей и уведомлений нет.</p></div>';
            return;
        }
        container.innerHTML = items.map((item) => {
            const date = this.formatDate(item.created_at);
            const action = !isPreview && item.action_url && item.action_label
                ? `<a class="guide-inline-btn news-card-link" href="${item.action_url}" data-news-action-url="${item.action_url}">${item.action_label}</a>`
                : '';
            const unreadClass = item.is_read ? '' : (isPreview ? ' news-preview-item-unread' : ' news-card-item-unread');
            const body = isPreview ? this.truncate(item.body, 120) : String(item.body || '');
            if (isPreview) {
                return `
                    <div class="setting-item news-preview-item${unreadClass}" data-notification-id="${item.id}">
                        <div class="flex-between">
                            <h4 class="subtitle-card-bold">${item.title}</h4>
                            <span class="value-small">${date}</span>
                        </div>
                        <p class="setting-hint">${body}</p>
                    </div>
                `;
            }
            return `
                <article class="bento-card news-card-item${unreadClass}" data-notification-id="${item.id}">
                    <div class="card-header-flex news-card-header-row">
                        <h3 class="card-title news-card-title">${item.title}</h3>
                        <span class="value-small news-card-date">${date}</span>
                    </div>
                    <div class="news-card-body">
                        <p class="setting-hint news-card-text">${body}</p>
                        ${action}
                    </div>
                </article>
            `;
        }).join('');
    },

    bindListActions(root = document) {
        root.querySelectorAll('.news-card-item').forEach((itemEl) => {
            if (itemEl.dataset.newsReadBound === '1') return;
            itemEl.dataset.newsReadBound = '1';
            itemEl.addEventListener('click', async () => {
                const notificationId = Number(itemEl.dataset.notificationId || 0);
                if (!notificationId) return;
                itemEl.classList.remove('news-card-item-unread');
                await this.markRead(notificationId);
                if (this.state.unreadCount > 0) this.state.unreadCount -= 1;
                this.updateBadge(root);
            });
        });

        root.querySelectorAll('[data-news-action-url]').forEach((link) => {
            if (link.dataset.newsBound === '1') return;
            link.dataset.newsBound = '1';
            link.addEventListener('click', async (event) => {
                const url = link.dataset.newsActionUrl;
                if (!url) return;
                event.preventDefault();
                if (url === '/admin/tariffs' && window.AdminApp?.navigateToTab) {
                    await window.AdminApp.navigateToTab('tariffs');
                    return;
                }
                if (url === '/admin' && window.AdminApp?.navigateToTab) {
                    await window.AdminApp.navigateToTab('profile');
                    return;
                }
                window.location.href = url;
            });
        });
    },
};
