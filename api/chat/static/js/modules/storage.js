export const StorageModule = {
    init() {
        this.loadData();
        this._pollTimer = setInterval(() => this.loadData(), 30000);
    },

    destroy() {
        if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    },

    async loadData() {
        const clientId = new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id') || 'mitia_assistant';
        const token = localStorage.getItem('chatadmin_auth_token');

        try {
            const [balanceRes, storageRes] = await Promise.all([
                fetch(`/api/chat/admin/balance?client_id=${clientId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
                fetch(`/api/chat/admin/storage-usage?client_id=${clientId}&limit=1`, { headers: { 'Authorization': `Bearer ${token}` } })
            ]);

            const balanceData = await balanceRes.json();
            const storageData = await storageRes.json();

            // Лимиты по умолчанию
            const TARIFF_LIMITS = {
                'start': 1 * 1024 * 1024 * 1024,
                'business': 5 * 1024 * 1024 * 1024,
                'neuro': 10 * 1024 * 1024 * 1024
            };

            let limit = TARIFF_LIMITS['start'];
            let used = 0;

            if (balanceData.status === 'success') {
                const tariff = (balanceData.tariff_name || 'start').toLowerCase();
                limit = balanceData.storage_limit || TARIFF_LIMITS[tariff] || TARIFF_LIMITS['start'];
                used = balanceData.used_storage || 0;
                console.log(`Storage: Tariff=${tariff}, Limit=${limit}, Used=${used}`);
            }
            
            this.renderDonut(used, limit, storageData.status === 'success' ? storageData : null);

        } catch (e) {
            console.error('Storage load error:', e);
        }
    },

    renderDonut(used, limit, data) {
        const usedEl = document.getElementById('storage-donut-value');
        const totalEl = document.getElementById('storage-total-limit');
        const container = document.getElementById('storage-segments');
        
        const formatSize = (bytes) => {
            if (!bytes || bytes === 0) return '0 Б';
            const k = 1024;
            const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            // Для ГБ оставляем 1 знак, для остальных — целые
            const decimals = i === 3 ? 1 : 0;
            return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
        };

        if (usedEl) usedEl.textContent = formatSize(used);
        if (totalEl) totalEl.textContent = formatSize(limit);

        if (!container) return;

        const colorMap = {
            'image': '#e6194b', 'video': '#3cb44b', 'audio': '#ffe119',
            'document': '#4363d8', 'other': '#f58231', 'text': '#911eb4'
        };

        let segments = [];
        let currentPercent = 0;

        if (data && data.by_type) {
            data.by_type.forEach(t => {
                const ft = t.file_type || 'other';
                const p = (t.total_size / limit) * 100;
                const color = colorMap[ft] || '#808080';

                if (p > 0.1) {
                    segments.push(`${color} ${currentPercent}% ${currentPercent + p}%`);
                    currentPercent += p;
                }
            });
        }

        if (segments.length > 0) {
            container.style.background = `conic-gradient(${segments.join(', ')}, rgba(255,255,255,0.05) ${currentPercent}% 100%)`;
        } else {
            container.style.background = 'rgba(255,255,255,0.05)';
        }
    }
};
