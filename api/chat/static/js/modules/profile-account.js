export function bindAccountControls() {
    const deleteBtn = document.getElementById('account-delete-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => this.handleInlineAccountDelete());
    }
}

export function toggleAccountEditMode(forceMode = null) {
    const card = document.getElementById('card-settings');
    const lockBtn = document.getElementById('account-lock-btn');
    if (!card || !lockBtn) return;

    const isOpen = forceMode === null
        ? !card.classList.contains('account-edit-mode')
        : Boolean(forceMode);

    card.classList.toggle('account-edit-mode', isOpen);

    const lockIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>';
    const unlockIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 7.5-2"></path></svg>';

    lockBtn.innerHTML = isOpen ? unlockIcon : lockIcon;
    lockBtn.classList.toggle('menu-open', isOpen);
    lockBtn.setAttribute('aria-label', isOpen ? 'Закрыть редактирование аккаунта' : 'Редактировать аккаунт');

    if (!isOpen) {
        const passwordInput = document.getElementById('account-delete-password');
        if (passwordInput) {
            passwordInput.value = '';
            passwordInput.classList.remove('input-error');
        }
    }
}

export async function saveAccountCardChanges(options = {}) {
    const silent = Boolean(options.silent);

    const emailInput = document.getElementById('account-email-new');
    const passwordInput = document.getElementById('account-email-password');
    if (!emailInput || !passwordInput) return { status: 'skipped' };

    const newEmail = (emailInput.value || '').trim().toLowerCase();
    const password = passwordInput.value || '';

    emailInput.classList.remove('input-error');
    passwordInput.classList.remove('input-error');

    if (!newEmail && !password) return { status: 'skipped' };

    if (!newEmail || !password) {
        if (!newEmail) emailInput.classList.add('input-error');
        if (!password) passwordInput.classList.add('input-error');
        const message = 'Введите новый email и текущий пароль.';
        if (!silent) this.showAlert('tmpl-error-alert', { title: 'Ошибка', text: message });
        return { status: 'failed', message };
    }

    const currentEmail = (document.getElementById('display-user-email')?.textContent || '').trim().toLowerCase();
    if (currentEmail && newEmail === currentEmail) {
        emailInput.classList.add('input-error');
        const message = 'Новый email совпадает с текущим.';
        if (!silent) this.showAlert('tmpl-error-alert', { title: 'Ошибка', text: message });
        return { status: 'failed', message };
    }

    try {
        const token = localStorage.getItem('chatadmin_auth_token');
        const res = await fetch('/api/chat/profile/change-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ new_email: newEmail, password })
        });
        const data = await res.json();

        if (data.status !== 'success') {
            const message = data.message || 'Не удалось сменить email';
            if (!silent) this.showAlert('tmpl-error-alert', { title: 'Ошибка', text: message });
            return { status: 'failed', message };
        }

        const emailEl = document.getElementById('display-user-email');
        if (emailEl) emailEl.textContent = newEmail;
        this.state.email = newEmail;

        emailInput.value = '';
        passwordInput.value = '';

        if (!silent) {
            this.showAlert('tmpl-success-alert', { title: 'Email изменён', text: 'Мы отправили уведомления на старый и новый адреса.' });
        }

        return { status: 'success' };
    } catch (e) {
        const message = 'Не удалось связаться с сервером';
        if (!silent) this.showAlert('tmpl-error-alert', { title: 'Ошибка сети', text: message });
        return { status: 'failed', message };
    }
}

export async function handleInlineAccountDelete() {
    const passwordInput = document.getElementById('account-delete-password');
    if (!passwordInput || passwordInput.disabled) return;

    const password = (passwordInput.value || '').trim();
    passwordInput.classList.remove('input-error');

    if (!password) {
        passwordInput.classList.add('input-error');
        this.showAlert('tmpl-error-alert', { title: 'Ошибка', text: 'Введите пароль для подтверждения удаления' });
        return;
    }

    try {
        const token = localStorage.getItem('chatadmin_auth_token');
        const res = await fetch('/api/chat/profile/delete-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ password })
        });
        const data = await res.json();

        if (data.status === 'success') {
            const successOverlay = this.showAlert('tmpl-success-alert', {
                title: 'Аккаунт удалён',
                text: 'Нажмите кнопку ниже или кликните по пустой области, чтобы перейти на страницу входа.'
            });
            const redirectToLogin = () => {
                window.logout();
                window.location.href = '/login';
            };
            if (successOverlay) {
                const successBtn = successOverlay.querySelector('.alert-btn-primary');
                if (successBtn) {
                    successBtn.textContent = 'Перейти ко входу';
                    successBtn.onclick = redirectToLogin;
                }
                successOverlay.onclick = (e) => {
                    if (e.target === successOverlay) redirectToLogin();
                };
            }
            return;
        }

        passwordInput.classList.add('input-error');
        this.showAlert('tmpl-error-alert', { title: 'Ошибка', text: data.message || 'Не удалось удалить аккаунт' });
    } catch (e) {
        passwordInput.classList.add('input-error');
        this.showAlert('tmpl-error-alert', { title: 'Ошибка сети', text: 'Не удалось связаться с сервером' });
    }
}
