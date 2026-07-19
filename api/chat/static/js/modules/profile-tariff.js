export async function performTariffChange(tariffId, options = {}) {
    const silent = Boolean(options.silent);
    const billingPeriod = options.billingPeriod || 'month';
    const clientId = new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id');
    const token = localStorage.getItem('chatadmin_auth_token');

    this.state.lastTariffError = null;

    try {
        const response = await fetch(`/api/chat/admin/change-tariff?client_id=${clientId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ tariff: tariffId, billing_period: billingPeriod })
        });
        const data = await response.json();
        if (data.status === 'success') {
            this.clearTariffError();
            this.state.selected_tariff = null;
            this.loadData();
            this.pollBalance();
            return data;
        }

        const message = data.message || 'Не удалось сменить тариф';
        this.state.lastTariffError = message;
        this.setTariffError(tariffId);
        if (!silent) {
            this.showAlert('tmpl-error-alert', { title: 'Ошибка', text: message });
        }
        return false;
    } catch (error) {
        const message = 'Не удалось связаться с сервером';
        this.state.lastTariffError = message;
        this.setTariffError(tariffId);
        if (!silent) {
            this.showAlert('tmpl-error-alert', { title: 'Ошибка сети', text: message });
        }
        return false;
    }
}

export function getCurrentTariffId() {
    const tariffMap = {
        'старт': 'start',
        'бизнес': 'business',
        'нейро': 'neuro',
        'персональный': 'start'
    };
    return tariffMap[(this.state.tariff_name || 'Старт').toLowerCase()] || 'start';
}

export function updateTariffInlineUI() {
    const cards = document.querySelectorAll('#tariff-inline-grid .profile-tariff-option');
    if (!cards.length) return;

    const currentTariff = this.getCurrentTariffId();
    const selectedTariff = this.state.selected_tariff || currentTariff;

    cards.forEach((card) => {
        const tariffId = card.dataset.tariff;
        card.classList.remove('current-tariff', 'pending-change');

        if (tariffId === currentTariff && tariffId === selectedTariff) {
            card.classList.add('current-tariff');
        } else if (tariffId === selectedTariff) {
            card.classList.add('pending-change');
        }
    });
}

export function bindTariffInlineControls() {
    const grid = document.getElementById('tariff-inline-grid');
    if (!grid) return;

    grid.querySelectorAll('.profile-tariff-option').forEach((card) => {
        card.addEventListener('click', () => {
            this.clearTariffError();
            this.state.selected_tariff = card.dataset.tariff;
            this.updateTariffInlineUI();
        });
    });

    this.updateTariffInlineUI();
}

export async function saveTariffCardChanges(options = {}) {
    const currentTariff = this.getCurrentTariffId();
    const selectedTariff = this.state.selected_tariff;
    if (!selectedTariff || selectedTariff === currentTariff) {
        this.clearTariffError();
        return { status: 'skipped' };
    }

    const changed = await this.performTariffChange(selectedTariff, options);
    return changed ? { status: 'success' } : { status: 'failed', message: this.state.lastTariffError || 'Не удалось сменить тариф.' };
}
