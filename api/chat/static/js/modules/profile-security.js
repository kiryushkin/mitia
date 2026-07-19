export async function handlePasswordUpdate() {
    const result = await this.savePasswordCardChanges({ silent: false });
    return result.status === 'success';
}

export async function savePasswordCardChanges(options = {}) {
    const silent = Boolean(options.silent);

    const oldPasswordInput = document.getElementById('current-password');
    const newPasswordInput = document.getElementById('new-password');
    const confirmPasswordInput = document.getElementById('confirm-password');

    const oldPassword = oldPasswordInput?.value || '';
    const newPassword = newPasswordInput?.value || '';
    const confirmPassword = confirmPasswordInput?.value || '';

    if (!oldPassword && !newPassword && !confirmPassword) {
        return { status: 'skipped' };
    }

    if (!oldPassword || !newPassword || !confirmPassword) {
        const message = 'Заполните все поля паролей.';
        const missing = [];
        if (!oldPassword) missing.push(oldPasswordInput);
        if (!newPassword) missing.push(newPasswordInput);
        if (!confirmPassword) missing.push(confirmPasswordInput);
        this.markFieldsError(missing);
        if (!silent) this.showAlert('tmpl-error-alert', { title: 'Ошибка', text: message });
        return { status: 'failed', message };
    }

    if (newPassword !== confirmPassword) {
        const message = 'Пароли не совпадают.';
        this.markFieldsError([newPasswordInput, confirmPasswordInput]);
        if (!silent) this.showAlert('tmpl-error-alert', { title: 'Ошибка', text: message });
        return { status: 'failed', message };
    }

    if (newPassword.length < 6) {
        const message = 'Новый пароль должен быть не менее 6 символов.';
        this.markFieldsError([newPasswordInput]);
        if (!silent) this.showAlert('tmpl-error-alert', { title: 'Ошибка', text: message });
        return { status: 'failed', message };
    }

    try {
        const token = localStorage.getItem('chatadmin_auth_token');
        const response = await fetch('/api/chat/update-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ old_password: oldPassword, password: newPassword })
        });
        const data = await response.json();

        if (data.status === 'success') {
            ['current-password', 'new-password', 'confirm-password'].forEach((id) => {
                const input = document.getElementById(id);
                if (input) input.value = '';
            });
            if (!silent) {
                this.showAlert('tmpl-success-alert', { title: 'Пароль изменён', text: 'Теперь используйте новый пароль при входе.' });
            }
            return { status: 'success' };
        }

        const message = data.message || 'Не удалось сменить пароль.';
        this.markFieldsError([oldPasswordInput, newPasswordInput, confirmPasswordInput]);
        if (!silent) this.showAlert('tmpl-error-alert', { title: 'Ошибка', text: message });
        return { status: 'failed', message };
    } catch (error) {
        const message = 'Не удалось связаться с сервером.';
        this.markFieldsError([oldPasswordInput, newPasswordInput, confirmPasswordInput]);
        if (!silent) this.showAlert('tmpl-error-alert', { title: 'Ошибка сети', text: message });
        return { status: 'failed', message };
    }
}

export function bindSecurityControls() {
    const lockBtn = document.getElementById('security-lock-btn');
    if (lockBtn) {
        lockBtn.addEventListener('click', () => this.toggleSecurityLock());
    }
    this.toggleSecurityLock(false);
}

export function toggleSecurityLock(forceUnlocked = null) {
    const card = document.getElementById('card-security');
    const lockBtn = document.getElementById('security-lock-btn');
    if (!card || !lockBtn) return;

    const unlocked = forceUnlocked === null
        ? card.classList.contains('security-locked')
        : Boolean(forceUnlocked);

    card.classList.toggle('security-locked', !unlocked);

    const lockIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>';
    const unlockIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 7.5-2"></path></svg>';

    lockBtn.innerHTML = unlocked ? unlockIcon : lockIcon;
    lockBtn.classList.toggle('menu-open', unlocked);
    lockBtn.setAttribute('aria-label', unlocked ? 'Заблокировать поля безопасности' : 'Редактировать безопасность');

    const controls = card.querySelectorAll('input, textarea, select, button.toggle-password-btn, button.link-muted-btn, button.account-delete-submit');
    controls.forEach((el) => {
        if (el === lockBtn) return;
        el.disabled = !unlocked;
    });

    if (!unlocked) {
        ['current-password', 'new-password', 'confirm-password'].forEach((id) => {
            const input = document.getElementById(id);
            if (input) {
                input.value = '';
                input.classList.remove('input-error');
            }
        });
    }
}

export async function saveLockState(isLocked) {
    try {
        const clientId = new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id');
        const token = localStorage.getItem('chatadmin_auth_token');
        await fetch(`/api/chat/admin/config?client_id=${clientId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ ui_settings: { profile_locked: isLocked } })
        });
    } catch (error) { console.error('Error saving lock state:', error); }
}
