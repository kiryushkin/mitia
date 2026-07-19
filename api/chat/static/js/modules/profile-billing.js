export async function loadBalanceHistory() {
    const panel = document.getElementById('balance-history-panel');
    const list = document.getElementById('balance-history-list');
    if (!panel || !list) return;

    list.innerHTML = '<div class="value-small">Загрузка...</div>';

    try {
        const token = localStorage.getItem('chatadmin_auth_token');
        const res = await fetch('/api/payments/history', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (data.status !== 'success' || !Array.isArray(data.history) || !data.history.length) {
            list.innerHTML = '<div class="balance-history-empty">Пополнений пока нет</div>';
            return;
        }

        const lastFive = data.history.slice(0, 5);
        list.innerHTML = lastFive.map((item) => {
            const date = item.date || '-';
            const amount = item.amount || 0;
            return `
                    <div class="balance-history-item">
                        <span class="balance-history-date">${date}</span>
                        <span class="balance-history-amount">+${amount} ₽</span>
                    </div>
                `;
        }).join('');

        list.innerHTML += `
            <button class="balance-history-all-btn" id="balance-history-all-btn" type="button">Все операции</button>
        `;

        const allBtn = document.getElementById('balance-history-all-btn');
        if (allBtn) {
            allBtn.addEventListener('click', () => {
                if (window.AdminApp?.navigateToTab) {
                    window.AdminApp.navigateToTab('transactions');
                }
            });
        }
    } catch (e) {
        list.innerHTML = '<div class="balance-history-empty">Не удалось загрузить историю</div>';
    }
}

export async function toggleBalanceHistory() {
    const panel = document.getElementById('balance-history-panel');
    const toggleBtn = document.getElementById('balance-history-toggle');
    if (!panel || !toggleBtn) return;

    const isOpen = panel.classList.contains('is-open');
    if (isOpen) {
        panel.classList.remove('is-open');
        toggleBtn.classList.remove('is-open');
        return;
    }

    panel.classList.add('is-open');
    toggleBtn.classList.add('is-open');
    await this.loadBalanceHistory();
}

export async function confirmPendingYookassaPayment() {
    const paymentId = sessionStorage.getItem('mitia_pending_yookassa_payment');
    if (!paymentId) return;

    const token = localStorage.getItem('chatadmin_auth_token');
    try {
        const response = await fetch(`/api/payments/status/${encodeURIComponent(paymentId)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) return;

        const payment = await response.json();
        if (payment.paid) {
            sessionStorage.removeItem('mitia_pending_yookassa_payment');
            await this.pollBalance();
            await this.loadBalanceHistory();
            this.showAlert('tmpl-success-alert', {
                title: 'Баланс пополнен',
                text: `Зачислено ${payment.amount} ₽.`
            });
        }
    } catch (error) {
        console.warn('[YooKassa] Payment confirmation check failed', error);
    }
}

export async function handleTopUp() {
    const amountInput = document.getElementById('topup-amount-inline');
    if (!amountInput) return;

    const rawAmount = parseInt(amountInput.value, 10);
    if (!amountInput.value || isNaN(rawAmount) || rawAmount <= 0) {
        amountInput.classList.add('input-error');
        amountInput.focus();
        return;
    }

    amountInput.classList.remove('input-error');
    const clientId = new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id') || 'mitia_assistant';
    const token = localStorage.getItem('chatadmin_auth_token');

    try {
        const response = await fetch('/api/payments/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ amount: rawAmount, client_id: clientId })
        });
        const data = await response.json();
        if (data.confirmation_url && data.payment_id) {
            sessionStorage.setItem('mitia_pending_yookassa_payment', data.payment_id);
            window.location.href = data.confirmation_url;
            return;
        }
        this.showAlert('tmpl-error-alert', { title: 'Ошибка оплаты', text: data.error || 'Не удалось создать платёж.' });
    } catch (error) {
        this.showAlert('tmpl-error-alert', { title: 'Ошибка сети', text: 'Не удалось связаться с сервером оплаты.' });
    }
}
