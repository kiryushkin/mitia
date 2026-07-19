export function getClientId() {
    return new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id') || 'mitia_assistant';
}

export function getToken() {
    return localStorage.getItem('chatadmin_auth_token');
}

export function clearProfileValidationErrors() {
    document.querySelectorAll('.input-error').forEach((el) => el.classList.remove('input-error'));
}

export function markFieldsError(fields = []) {
    fields.forEach((field) => {
        if (field && field.classList) {
            field.classList.add('input-error');
        }
    });
}

export function clearTariffError() {
    document.querySelectorAll('#tariff-inline-grid .profile-tariff-option.input-error').forEach((el) => {
        el.classList.remove('input-error');
    });
}

export function setTariffError(tariffId = null) {
    this.clearTariffError();
    if (!tariffId) return;
    const card = document.querySelector(`#tariff-inline-grid .profile-tariff-option[data-tariff="${tariffId}"]`);
    if (card) card.classList.add('input-error');
}

export function formatSaveFailureMessage(message) {
    const text = String(message || '').trim();
    if (!text) return 'Не удалось сохранить изменения.';

    const insufficientFundsMatch = text.match(/^Недостаточно средств\.?\s*(.*)$/u);
    if (insufficientFundsMatch) {
        const firstLine = 'Недостаточно средств.';
        const remainder = (insufficientFundsMatch[1] || '').trim();
        if (!remainder) return firstLine;
        const secondLine = /[.!?]$/.test(remainder) ? remainder : `${remainder}.`;
        return `${firstLine}\n${secondLine}`;
    }

    return text.endsWith('.') ? text : `${text}.`;
}
