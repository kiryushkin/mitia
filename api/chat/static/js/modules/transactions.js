export const TransactionsModule = {
    state: {
        history: [],
        loaded: false,
    },

    async init() {
        console.log('Transactions module initialized');
        await this.loadHistory();
    },

    getToken() {
        return localStorage.getItem('chatadmin_auth_token');
    },

    async loadHistory() {
        const list = document.getElementById('transactions-list');
        if (!list) return;

        list.innerHTML = '<div class="setting-item"><p class="setting-hint">Загрузка...</p></div>';

        try {
            const token = this.getToken();
            const res = await fetch('/api/payments/history', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();

            if (data.status !== 'success' || !Array.isArray(data.history) || !data.history.length) {
                list.innerHTML = `
                    <div class="setting-item">
                        <p class="setting-hint" style="text-align:center;padding:40px 0;line-height:1.8">
                            В этом разделе будет отображаться история пополнения баланса.<br>
                            После первого пополнения здесь появятся все операции с датой и суммой.
                        </p>
                    </div>
                `;
                return;
            }

            this.state.history = data.history;
            this.state.loaded = true;
            this.renderHistory(list);
        } catch (e) {
            list.innerHTML = '<div class="setting-item"><p class="setting-hint">Не удалось загрузить историю</p></div>';
        }
    },

    renderHistory(container) {
        container.innerHTML = this.state.history.map((item) => {
            const date = item.date || '-';
            const amount = item.amount || 0;
            return `
                <div class="bento-card">
                    <div class="card-header-flex">
                        <span class="tx-date">${date}</span>
                        <span class="tx-amount">+${amount} ₽</span>
                    </div>
                </div>
            `;
        }).join('');
    },

    destroy() {}
};
