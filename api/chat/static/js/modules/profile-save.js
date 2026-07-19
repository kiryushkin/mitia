export async function saveData() {
    console.log('Saving profile data...');
    this.clearProfileValidationErrors();

    const clientId = new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id');
    const token = localStorage.getItem('chatadmin_auth_token');

    const successfulOps = [];
    const failedOps = [];

    const nextAssistantId = this.state.draftActiveAssistantId || this.state.savedActiveAssistantId;
    const activeAssistantChanged = !!nextAssistantId && nextAssistantId !== this.state.savedActiveAssistantId;
    if (activeAssistantChanged) {
        try {
            await this.saveActiveAssistantSelection();
            successfulOps.push('активный ассистент');
        } catch (error) {
            console.error('Assistant selection save error:', error);
            failedOps.push('Не удалось сохранить выбранного ассистента.');
        }
    }

    const accountResult = await this.saveAccountCardChanges({ silent: true });
    if (accountResult.status === 'success') successfulOps.push('email');
    if (accountResult.status === 'failed') failedOps.push(accountResult.message || 'Не удалось обновить email.');

    const platformNews = document.querySelector('.platform-news-checkbox')?.checked;
    const autoRenew = document.querySelector('.auto-renew-checkbox')?.checked;

    const prevPlatformNews = !!(this.state.notifications && this.state.notifications.platform_news);
    const prevAutoRenew = !!this.state.auto_renew;
    const platformNewsChanged = prevPlatformNews !== !!platformNews;
    const autoRenewChanged = prevAutoRenew !== !!autoRenew;

    const updates = {
        ui_settings: {
            ...this.state.ui_settings,
            profile_locked: this.state.ui_settings?.profile_locked
        },
        notifications: {
            ...this.state.notifications,
            platform_news: platformNews
        },
        auto_renew: autoRenew
    };

    try {
        const response = await fetch(`/api/chat/admin/config?client_id=${clientId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(updates)
        });
        const result = await response.json();

        if (result.status === 'success') {
            this.state = { ...this.state, ...updates };

            if (platformNewsChanged) successfulOps.push('уведомления платформы');
            if (autoRenewChanged) successfulOps.push('автопродление тарифа');
            if (!platformNewsChanged && !autoRenewChanged) successfulOps.push('настройки профиля');

            if (typeof window.restartMityaWidget === 'function') {
                window.restartMityaWidget();
            } else {
                const host = document.getElementById('mitya-widget-host');
                if (host) host.remove();
                window.__MITYA_WIDGET__ = false;

                const oldScript = document.querySelector('script[src*="chat-widget.js"]');
                if (oldScript) {
                    const newScript = document.createElement('script');
                    newScript.src = oldScript.src.split('?')[0] + '?t=' + Date.now();
                    newScript.defer = true;
                    document.head.appendChild(newScript);
                    oldScript.remove();
                }
            }
        } else {
            failedOps.push(result.message || 'Не удалось сохранить настройки профиля.');
        }
    } catch (error) {
        console.error('Config save error:', error);
        failedOps.push('Не удалось сохранить настройки профиля (ошибка сети).');
    }

    const tariffResult = await this.saveTariffCardChanges({ silent: true });
    if (tariffResult.status === 'success') successfulOps.push('тариф');
    if (tariffResult.status === 'failed') failedOps.push(tariffResult.message || 'Не удалось сменить тариф.');

    const passwordResult = await this.savePasswordCardChanges({ silent: true });
    if (passwordResult.status === 'success') successfulOps.push('пароль');
    if (passwordResult.status === 'failed') failedOps.push(passwordResult.message || 'Не удалось обновить пароль.');

    if (failedOps.length === 0) {
        return;
    }

    const formattedFailedOps = failedOps.map((message) => this.formatSaveFailureMessage(message));

    this.showAlert('tmpl-error-alert', {
        title: successfulOps.length ? 'Не всё сохранилось' : 'Ошибка сохранения',
        report: { success: [], failed: formattedFailedOps }
    });
}

export function showAlert(templateId, data = {}) {
    const template = document.getElementById(templateId);
    if (!template) return;
    const clone = document.importNode(template.content, true);
    const overlay = clone.querySelector('.custom-alert-overlay');
    const titleEl = overlay.querySelector('.alert-title');
    const textEl = overlay.querySelector('.alert-text');

    if (data.title && titleEl) titleEl.textContent = data.title;
    if (data.text && textEl) {
        const localize = window.MityaI18n?.localizeConnectionError || ((message) => message);
        textEl.textContent = localize(data.text);
    }

    if (data.report && textEl) {
        const successItems = Array.isArray(data.report.success) ? data.report.success : [];
        const failedItems = Array.isArray(data.report.failed) ? data.report.failed : [];

        overlay.classList.add('alert-report-overlay');
        textEl.textContent = '';

        const createSection = (heading, items, sectionClass) => {
            const section = document.createElement('div');
            section.className = `alert-report-section ${sectionClass}`;

            const headingEl = document.createElement('div');
            headingEl.className = 'alert-report-heading';
            headingEl.textContent = heading;
            section.appendChild(headingEl);

            const list = document.createElement('ul');
            list.className = 'alert-report-list';
            items.forEach((item) => {
                const li = document.createElement('li');
                li.textContent = item;
                list.appendChild(li);
            });
            section.appendChild(list);
            return section;
        };

        if (successItems.length) {
            textEl.appendChild(createSection('Успешно:', successItems, 'is-success'));
        }
        if (failedItems.length) {
            textEl.appendChild(createSection('Ошибки', failedItems, 'is-error'));
        }
    } else if (data.text && textEl) {
        textEl.textContent = data.text;
    }

    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
    });

    document.body.style.overflow = 'hidden';
    const close = () => { overlay.style.opacity = '0'; document.body.style.overflow = ''; setTimeout(() => overlay.remove(), 300); };
    const closeBtn = overlay.querySelector('.alert-btn-primary') || overlay.querySelector('.alert-btn-secondary');
    if (closeBtn) closeBtn.onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    return overlay;
}
