export const IntegrationsModule = {
    state: {
        integrations: {}
    },
    
    async init() {
        console.log('Integrations module initialized');
        this.bindEvents();
        await this.loadData();
        this.syncInputsState();
    },

    syncInputsState() {
        const cards = document.querySelectorAll('.bento-card');
        cards.forEach(card => {
            const toggle = card.querySelector('input[type="checkbox"][data-field="enabled"]');
            if (!toggle) return;

            const isEnabled = toggle.checked;
            
            if (isEnabled) {
                card.classList.add('integration-active');
            } else {
                card.classList.remove('integration-active');
            }

            const inputs = card.querySelectorAll('.settings-form input:not([data-field="enabled"]), .settings-form button, .settings-form select');
            
            inputs.forEach(input => {
                input.disabled = false;
                
                if (input.classList.contains('delete-admin-btn')) {
                    input.style.opacity = '1';
                    input.style.pointerEvents = 'auto';
                }
            });

            const addAdminBtn = card.querySelector('#add-tg-admin-btn');
            if (addAdminBtn) {
                addAdminBtn.disabled = false;
                addAdminBtn.style.opacity = '1';
                addAdminBtn.style.pointerEvents = 'auto';
            }
        });

        this.updateNotificationsDependencyHint();
    },

    hasTelegramBotToken() {
        const tokenInput = document.getElementById('tg-bot-token-input');
        const tokenFromInput = tokenInput ? tokenInput.value.trim() : '';
        const tokenFromState = this.state.integrations?.telegram?.bot_token || '';
        return !!(tokenFromInput || String(tokenFromState).trim());
    },

    updateNotificationsDependencyHint() {
        const hint = document.getElementById('notifications-telegram-hint');
        if (!hint) return;

        const hasToken = this.hasTelegramBotToken();
        if (hasToken) {
            hint.textContent = 'Telegram-бот подключен. Выберите, какие события отправлять получателям.';
            hint.style.color = '';
        } else {
            hint.textContent = 'Для отправки уведомлений в Telegram подключите бота в карточке Telegram (укажите токен).';
            hint.style.color = 'var(--danger-color, #ff4d4f)';
        }
    },

    bindEvents() {
        
        if (this._eventsBound) return;
        this._eventsBound = true;

        const domainInput = document.getElementById('widget-origin-field');
        if (domainInput) {
            domainInput.addEventListener('input', () => {
                const clientId = new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id');
                this.generateWidgetCode(clientId);
                
                if (!domainInput.value.trim()) {
                    const statusBadge = document.getElementById('widget-status');
                    if (statusBadge) {
                        statusBadge.className = 'status-badge disconnected';
                        statusBadge.textContent = 'Не подключено';
                    }
                    const toggle = document.querySelector('[data-integration="widget"][data-field="enabled"]');
                    if (toggle) toggle.checked = false;
                }
            });
        }

        const emailInput = document.querySelector('[data-integration="email"][data-field="email_address"]');
        const emailPassInput = document.querySelector('[data-integration="email"][data-field="email_password"]');
        const emailSyncCheckbox = document.getElementById('email-sync-history-checkbox');
        
        if (emailSyncCheckbox) {
            emailSyncCheckbox.addEventListener('change', () => {
                if (this._fillingData) return;
                
                const modeContainer = document.getElementById('email-sync-mode-container');
                if (modeContainer) {
                    modeContainer.style.display = emailSyncCheckbox.checked ? 'block' : 'none';
                }
            });
        }

        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.sync-mode-btn');
            if (btn) {
                const container = btn.closest('.type-switcher');
                if (container) {
                    container.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const input = document.getElementById('email-sync-mode-input');
                    if (input) input.value = btn.dataset.mode;
                }
            }
        });

        [emailInput, emailPassInput].forEach(input => {
            if (input) {
                input.addEventListener('input', () => {
                    if (!emailInput.value.trim() || !emailPassInput.value.trim()) {
                        const statusBadge = document.getElementById('email-status');
                        if (statusBadge) {
                            statusBadge.className = 'status-badge disconnected';
                            statusBadge.textContent = 'Не подключено';
                        }
                        const toggle = document.querySelector('[data-integration="email"][data-field="enabled"]');
                        if (toggle) toggle.checked = false;
                    }
                });
            }
        });

        document.addEventListener('click', async (e) => {
            const copyBtn = e.target.closest('#copy-widget-script-btn');
            if (copyBtn) {
                this.copyWidgetScript();
                return;
            }

            const hhConnectBtn = e.target.closest('#hh-connect-btn');
            if (hhConnectBtn) {
                try {
                    const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
                    const authToken = localStorage.getItem('chatadmin_auth_token');
                    const res = await fetch(`/api/chat/hh/oauth/start?client_id=${clientId}`, {
                        headers: { 'Authorization': `Bearer ${authToken}` }
                    });
                    const data = await res.json();
                    if (!res.ok || data.status !== 'ok' || !data.auth_url) {
                        throw new Error(data.error || 'Не удалось начать авторизацию HeadHunter');
                    }

                    const popup = window.open(data.auth_url, 'hhOAuth', 'width=640,height=760,menubar=no,toolbar=no,status=no');
                    if (!popup) {
                        window.location.href = data.auth_url;
                        return;
                    }

                    const pollStart = Date.now();
                    const poll = async () => {
                        try {
                            const statusRes = await fetch(`/api/chat/hh/status?client_id=${clientId}`, {
                                headers: { 'Authorization': `Bearer ${authToken}` }
                            });
                            if (statusRes.ok) {
                                const statusData = await statusRes.json();
                                if (statusData.connected) {
                                    if (!this.state.integrations.hh) this.state.integrations.hh = {};
                                    this.state.integrations.hh.connected = true;
                                    this.state.integrations.hh.enabled = true;
                                    this.state.integrations.hh.account_name = statusData.account_name || '';
                                    const hhToggle = document.querySelector('[data-integration="hh"][data-field="enabled"]');
                                    if (hhToggle) hhToggle.checked = true;
                                    this.fillData();
                                    const hhBtn = document.getElementById('hh-connect-btn');
                                    if (hhBtn) hhBtn.textContent = 'Переподключить через hh.ru';
                                    if (window.showAlert) {
                                        window.showAlert('tmpl-success-alert', { title: 'Готово', text: 'HeadHunter успешно подключен.' });
                                    }
                                    return;
                                }
                            }
                        } catch (_) {}

                        const popupClosed = popup.closed;
                        const timedOut = Date.now() - pollStart > 180000;
                        if (!popupClosed && !timedOut) {
                            setTimeout(poll, 1500);
                        }
                    };

                    setTimeout(poll, 1500);
                } catch (err) {
                    if (window.showAlert) {
                        window.showAlert('tmpl-error-alert', { title: 'Ошибка', text: err.message });
                    } else {
                        alert('Ошибка: ' + err.message);
                    }
                }
                return;
            }


        });

        document.addEventListener('change', async (e) => {
            if (this._fillingData) return;

            const target = e.target;
            
            if (target.matches('[data-integration="telegram"][data-field="enabled"]')) {
                const isEnabled = target.checked;
                const tokenInput = document.getElementById('tg-bot-token-input');
                const token = tokenInput ? tokenInput.value.trim() : '';

                if (isEnabled) {
                    if (!token) {
                        if (window.showAlert) {
                            window.showAlert('tmpl-error-alert', { title: 'Ошибка', text: 'Введите токен бота перед включением.' });
                        } else {
                            alert('Введите токен бота перед включением.');
                        }
                        target.checked = false;
                        return;
                    }

                    const statusBadge = document.getElementById('telegram-status');
                    if (statusBadge) {
                        statusBadge.className = 'status-badge connecting';
                        statusBadge.textContent = 'Подключение...';
                    }

                    try {
                        const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
                        const authToken = localStorage.getItem('chatadmin_auth_token');
                        const res = await fetch(`/api/chat/telegram/check-token?client_id=${clientId}`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${authToken}`
                            },
                            body: JSON.stringify({ bot_token: token })
                        });
                        const data = await res.json();

                        if (res.ok && data.status === 'ok') {
                            const statusBadge = document.getElementById('telegram-status');
                            if (statusBadge) {
                                statusBadge.className = 'status-badge connected';
                                statusBadge.textContent = 'Подключено';
                            }
                            this.syncInputsState();
                        } else {
                            throw new Error(data.error || 'Неверный токен');
                        }
                    } catch (err) {
                        if (window.showAlert) {
                            window.showAlert('tmpl-error-alert', { title: 'Ошибка', text: err.message });
                        } else {
                            alert('Ошибка: ' + err.message);
                        }
                        target.checked = false;
                        const statusBadge = document.getElementById('telegram-status');
                        if (statusBadge) {
                            statusBadge.className = 'status-badge disconnected';
                            statusBadge.textContent = 'Не подключено';
                        }
                    }
                } else {
                    const statusBadge = document.getElementById('telegram-status');
                    if (statusBadge) {
                        statusBadge.className = 'status-badge disconnected';
                        statusBadge.textContent = 'Не подключено';
                    }
                    if (!this.state.integrations.telegram) this.state.integrations.telegram = {};
                    this.state.integrations.telegram.enabled = false;
                    this.syncInputsState();
                }
            }

            if (target.matches('[data-integration="telegram"][data-field="autoreply_enabled"]')) {
                const assistantCheckbox = document.getElementById('tg-assistant-enabled-checkbox');
                const assistantSettings = document.getElementById('tg-assistant-settings');
                const autoreplySettings = document.getElementById('tg-autoreply-settings');

                if (target.checked && assistantCheckbox) {
                    assistantCheckbox.checked = false;
                    if (assistantSettings) {
                        assistantSettings.style.display = 'none';
                    }
                }

                if (autoreplySettings) {
                    autoreplySettings.style.display = target.checked ? 'block' : 'none';
                }
            }

            if (target.matches('[data-integration="telegram"][data-field="assistant_enabled"]')) {
                const assistantSettings = document.getElementById('tg-assistant-settings');
                const autoreplyCheckbox = document.getElementById('tg-autoreply-enabled-checkbox');
                const autoreplySettings = document.getElementById('tg-autoreply-settings');

                if (assistantSettings) {
                    assistantSettings.style.display = target.checked ? 'block' : 'none';
                }
                if (target.checked && autoreplyCheckbox) {
                    autoreplyCheckbox.checked = false;
                    if (autoreplySettings) {
                        autoreplySettings.style.display = 'none';
                    }
                }
            }

            if (target.matches('[data-integration="email"][data-field="assistant_enabled"]')) {
                const autoreplyCheckbox = document.getElementById('email-autoreply-enabled-checkbox');
                const autoreplySettings = document.getElementById('email-autoreply-settings');
                if (target.checked && autoreplyCheckbox) {
                    autoreplyCheckbox.checked = false;
                    if (autoreplySettings) {
                        autoreplySettings.style.display = 'none';
                    }
                }
            }

            if (target.matches('[data-integration="max"][data-field="assistant_enabled"]')) {
                const autoreplyCheckbox = document.getElementById('max-autoreply-enabled-checkbox');
                const autoreplySettings = document.getElementById('max-autoreply-settings');
                if (target.checked && autoreplyCheckbox) {
                    autoreplyCheckbox.checked = false;
                    if (autoreplySettings) {
                        autoreplySettings.style.display = 'none';
                    }
                }
            }

            if (target.matches('[data-integration="vk"][data-field="assistant_enabled"]')) {
                const autoreplyCheckbox = document.getElementById('vk-autoreply-enabled-checkbox');
                const autoreplySettings = document.getElementById('vk-autoreply-settings');
                if (target.checked && autoreplyCheckbox) {
                    autoreplyCheckbox.checked = false;
                    if (autoreplySettings) {
                        autoreplySettings.style.display = 'none';
                    }
                }
            }

            if (target.matches('[data-integration="widget"][data-field="assistant_enabled"]')) {
                const autoreplyCheckbox = document.getElementById('widget-autoreply-enabled-checkbox');
                const autoreplySettings = document.getElementById('widget-autoreply-settings');
                if (target.checked && autoreplyCheckbox) {
                    autoreplyCheckbox.checked = false;
                    if (autoreplySettings) {
                        autoreplySettings.style.display = 'none';
                    }
                }
            }

            if (target.matches('[data-integration="email"][data-field="autoreply_enabled"]')) {
                const assistantCheckbox = document.getElementById('email-assistant-enabled-checkbox');
                const autoreplySettings = document.getElementById('email-autoreply-settings');
                if (target.checked && assistantCheckbox) {
                    assistantCheckbox.checked = false;
                }
                if (autoreplySettings) {
                    autoreplySettings.style.display = target.checked ? 'block' : 'none';
                }
            }

            if (target.matches('[data-integration="max"][data-field="autoreply_enabled"]')) {
                const assistantCheckbox = document.querySelector('[data-integration="max"][data-field="assistant_enabled"]');
                const autoreplySettings = document.getElementById('max-autoreply-settings');
                if (target.checked && assistantCheckbox) {
                    assistantCheckbox.checked = false;
                }
                if (autoreplySettings) {
                    autoreplySettings.style.display = target.checked ? 'block' : 'none';
                }
            }

            if (target.matches('[data-integration="vk"][data-field="autoreply_enabled"]')) {
                const assistantCheckbox = document.getElementById('vk-assistant-enabled-checkbox');
                const autoreplySettings = document.getElementById('vk-autoreply-settings');
                if (target.checked && assistantCheckbox) {
                    assistantCheckbox.checked = false;
                }
                if (autoreplySettings) {
                    autoreplySettings.style.display = target.checked ? 'block' : 'none';
                }
            }

            if (target.matches('[data-integration="widget"][data-field="autoreply_enabled"]')) {
                const assistantCheckbox = document.getElementById('widget-assistant-enabled-checkbox');
                const autoreplySettings = document.getElementById('widget-autoreply-settings');
                if (target.checked && assistantCheckbox) {
                    assistantCheckbox.checked = false;
                }
                if (autoreplySettings) {
                    autoreplySettings.style.display = target.checked ? 'block' : 'none';
                }
            }

            if (target.matches('[data-integration="max"][data-field="enabled"]')) {
                const isEnabled = target.checked;
                const tokenInput = document.getElementById('max-bot-token-input');
                const token = tokenInput ? tokenInput.value.trim() : '';
                const statusBadge = document.getElementById('max-status');

                if (isEnabled) {
                    if (!token) {
                        if (window.showAlert) {
                            window.showAlert('tmpl-error-alert', { title: 'Ошибка', text: 'Введите токен бота перед включением.' });
                        } else {
                            alert('Введите токен бота перед включением.');
                        }
                        target.checked = false;
                        if (statusBadge) {
                            statusBadge.className = 'status-badge disconnected';
                            statusBadge.textContent = 'Не подключено';
                        }
                        this.syncInputsState();
                        return;
                    }

                    if (statusBadge) {
                        statusBadge.className = 'status-badge connecting';
                        statusBadge.textContent = 'Подключение...';
                    }

                    try {
                        const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
                        const authToken = localStorage.getItem('chatadmin_auth_token');
                        const res = await fetch(`/api/chat/max/check-token?client_id=${clientId}`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${authToken}`
                            },
                            body: JSON.stringify({ bot_token: token })
                        });
                        const data = await res.json();

                        if (res.ok && data.status === 'ok') {
                            if (statusBadge) {
                                statusBadge.className = 'status-badge connected';
                                statusBadge.textContent = 'Подключено';
                            }
                        } else {
                            throw new Error(data.error || 'Неверный токен MAX');
                        }
                    } catch (err) {
                        if (window.showAlert) {
                            window.showAlert('tmpl-error-alert', { title: 'Ошибка', text: err.message });
                        } else {
                            alert('Ошибка: ' + err.message);
                        }
                        target.checked = false;
                        if (statusBadge) {
                            statusBadge.className = 'status-badge disconnected';
                            statusBadge.textContent = 'Не подключено';
                        }
                    }
                } else {
                    if (statusBadge) {
                        statusBadge.className = 'status-badge disconnected';
                        statusBadge.textContent = 'Не подключено';
                    }
                }

                this.syncInputsState();
            }

            if (target.matches('[data-integration="vk"][data-field="enabled"]')) {
                const isEnabled = target.checked;
                const tokenInput = document.getElementById('vk-access-token-input');
                const groupInput = document.getElementById('vk-group-id-input');
                const token = tokenInput ? tokenInput.value.trim() : '';
                const groupId = groupInput ? groupInput.value.trim() : '';

                if (isEnabled) {
                    if (!token || !groupId) {
                        const msg = 'Введите ключ доступа и ID сообщества перед включением.';
                        if (window.showAlert) {
                            window.showAlert('tmpl-error-alert', { title: 'Ошибка', text: msg });
                        } else {
                            alert(msg);
                        }
                        target.checked = false;
                        return;
                    }

                    const statusBadge = document.getElementById('vk-status');
                    if (statusBadge) {
                        statusBadge.className = 'status-badge connecting';
                        statusBadge.textContent = 'Подключение...';
                    }

                    try {
                        const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
                        const authToken = localStorage.getItem('chatadmin_auth_token');
                        const res = await fetch(`/api/chat/vk/check-token?client_id=${clientId}`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${authToken}`
                            },
                            body: JSON.stringify({ access_token: token, group_id: groupId })
                        });
                        const data = await res.json();

                        if (res.ok && data.status === 'ok') {
                            const statusBadge = document.getElementById('vk-status');
                            if (statusBadge) {
                                statusBadge.className = 'status-badge connected';
                                statusBadge.textContent = 'Подключено';
                            }
                            this.syncInputsState();
                        } else {
                            throw new Error(data.error || 'Ошибка проверки');
                        }
                    } catch (err) {
                        if (window.showAlert) {
                            window.showAlert('tmpl-error-alert', { title: 'Ошибка', text: err.message });
                        } else {
                            alert('Ошибка: ' + err.message);
                        }
                        target.checked = false;
                        const statusBadge = document.getElementById('vk-status');
                        if (statusBadge) {
                            statusBadge.className = 'status-badge disconnected';
                            statusBadge.textContent = 'Не подключено';
                        }
                    }
                } else {
                    const statusBadge = document.getElementById('vk-status');
                    if (statusBadge) {
                        statusBadge.className = 'status-badge disconnected';
                        statusBadge.textContent = 'Не подключено';
                    }
                    this.syncInputsState();
                }
            }

            if (target.matches('[data-integration="widget"][data-field="enabled"]')) {
                const isEnabled = target.checked;
                const domainInput = document.getElementById('widget-origin-field');
                const domain = domainInput ? domainInput.value.trim() : '';

                if (isEnabled) {
                    if (!domain) {
                        const msg = 'Укажите домен.';
                        if (window.showAlert) {
                            window.showAlert('tmpl-error-alert', { title: 'Ошибка', text: msg });
                        } else {
                            alert(msg);
                        }
                        target.checked = false;
                        return;
                    }

                    const statusBadge = document.getElementById('widget-status');
                    if (statusBadge) {
                        statusBadge.className = 'status-badge connecting';
                        statusBadge.textContent = 'Проверка...';
                    }

                    try {
                        const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
                        const authToken = localStorage.getItem('chatadmin_auth_token');
                        const res = await fetch(`/api/chat/widget/verify?client_id=${clientId}`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${authToken}`
                            },
                            body: JSON.stringify({ domain: domain })
                        });
                        const data = await res.json();

                        if (res.ok && data.found) {
                            var host = document.getElementById('mitya-widget-host');
                            if (host) host.style.display = '';
                            if (window.MityaWidget && window.MityaWidget.applyTheme) {
                                window.MityaWidget.applyTheme({ widget_enabled: true });
                            }

                            var badge = document.getElementById('widget-status');
                            if (badge) {
                                badge.className = 'status-badge connected';
                                badge.textContent = 'Подключено';
                            }
                            this.syncInputsState();
                        } else {
                            throw new Error(data.message || 'Скрипт виджета не найден на сайте');
                        }
                    } catch (err) {
                        if (window.showAlert) {
                            window.showAlert('tmpl-error-alert', { title: 'Ошибка', text: err.message });
                        } else {
                            alert('Ошибка: ' + err.message);
                        }
                        target.checked = false;
                        var badge = document.getElementById('widget-status');
                        if (badge) {
                            badge.className = 'status-badge disconnected';
                            badge.textContent = 'Не подключено';
                        }
                    }
                } else {
                    var host = document.getElementById('mitya-widget-host');
                    if (host) host.style.display = 'none';
                    if (window.MityaWidget && window.MityaWidget.applyTheme) {
                        window.MityaWidget.applyTheme({ widget_enabled: false });
                    }

                    var badge = document.getElementById('widget-status');
                    if (badge) {
                        badge.className = 'status-badge disconnected';
                        badge.textContent = 'Не подключено';
                    }
                    if (!this.state.integrations.widget) this.state.integrations.widget = {};
                    this.state.integrations.widget.enabled = false;
                    this.syncInputsState();
                }
            }

            if (target.matches('[data-integration="hh"][data-field="enabled"]')) {
                const isEnabled = target.checked;
                const hhData = this.state.integrations.hh || {};
                const isConnected = !!(hhData.connected || hhData.access_token);
                const statusBadge = document.getElementById('hh-status');

                if (isEnabled && !isConnected) {
                    if (window.showAlert) {
                        window.showAlert('tmpl-error-alert', { title: 'Ошибка', text: 'Сначала выполните подключение через кнопку «Подключить через hh.ru».' });
                    } else {
                        alert('Сначала подключите HeadHunter через OAuth.');
                    }
                    target.checked = false;
                }

                if (!isEnabled) {
                    try {
                        const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
                        const authToken = localStorage.getItem('chatadmin_auth_token');
                        await fetch(`/api/chat/hh/disconnect?client_id=${clientId}`, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${authToken}` }
                        });
                        if (!this.state.integrations.hh) this.state.integrations.hh = {};
                        this.state.integrations.hh.connected = false;
                        this.state.integrations.hh.enabled = false;
                        this.state.integrations.hh.account_name = '';
                        this.state.integrations.hh.access_token = '';
                        this.state.integrations.hh.refresh_token = '';
                    } catch (err) {
                        console.error('HH disconnect error:', err);
                    }
                }

                const connected = !!(target.checked && isConnected);
                if (statusBadge) {
                    statusBadge.className = `status-badge ${connected ? 'connected' : 'disconnected'}`;
                    statusBadge.textContent = connected ? 'Подключено' : 'Не подключено';
                }
                this.syncInputsState();
            }

            if (target.matches('[data-integration="avito"][data-field="enabled"]')) {
                const isEnabled = target.checked;
                const clientIdInput = document.getElementById('avito-client-id-input');
                const clientSecretInput = document.getElementById('avito-client-secret-input');
                const avitoClientId = clientIdInput ? clientIdInput.value.trim() : '';
                const avitoClientSecret = clientSecretInput ? clientSecretInput.value.trim() : '';

                if (isEnabled) {
                    if (!avitoClientId && !avitoClientSecret) {
                        showError('Введите Client ID и Client Secret.');
                        return;
                    }
                    if (!avitoClientId) {
                        showError('Введите Client ID.');
                        return;
                    }
                    if (!avitoClientSecret) {
                        showError('Введите Client Secret.');
                        return;
                    }

                    function showError(msg) {
                        if (window.showAlert) {
                            window.showAlert('tmpl-error-alert', { title: 'Ошибка', text: msg });
                        } else {
                            alert(msg);
                        }
                        target.checked = false;
                    }

                    const statusBadge = document.getElementById('avito-status');
                    if (statusBadge) {
                        statusBadge.className = 'status-badge connecting';
                        statusBadge.textContent = 'Подключение...';
                    }

                    try {
                        const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
                        const authToken = localStorage.getItem('chatadmin_auth_token');
                        const res = await fetch(`/api/chat/avito/check-token?client_id=${clientId}`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${authToken}`
                            },
                            body: JSON.stringify({ client_id: avitoClientId, client_secret: avitoClientSecret })
                        });
                        const data = await res.json();

                        if (res.ok && data.status === 'ok') {
                            const statusBadge = document.getElementById('avito-status');
                            if (statusBadge) {
                                statusBadge.className = 'status-badge connected';
                                statusBadge.textContent = 'Подключено';
                            }
                            this.syncInputsState();
                        } else {
                            throw new Error(data.error || 'Ошибка проверки');
                        }
                    } catch (err) {
                        if (window.showAlert) {
                            window.showAlert('tmpl-error-alert', { title: 'Ошибка', text: err.message });
                        } else {
                            alert('Ошибка: ' + err.message);
                        }
                        target.checked = false;
                        const statusBadge = document.getElementById('avito-status');
                        if (statusBadge) {
                            statusBadge.className = 'status-badge disconnected';
                            statusBadge.textContent = 'Не подключено';
                        }
                    }
                } else {
                    const statusBadge = document.getElementById('avito-status');
                    if (statusBadge) {
                        statusBadge.className = 'status-badge disconnected';
                        statusBadge.textContent = 'Не подключено';
                    }
                    this.syncInputsState();
                }
            }

            if (target.matches('[data-integration="email"][data-field="enabled"]')) {
                const isEnabled = target.checked;
                const statusBadge = document.getElementById('email-status');
                
                if (isEnabled) {
                    const email = document.querySelector('[data-integration="email"][data-field="email_address"]')?.value.trim();
                    const pass = document.querySelector('[data-integration="email"][data-field="email_password"]')?.value.trim();
                    const imap = document.querySelector('[data-integration="email"][data-field="imap_server"]')?.value.trim();
                    const smtp = document.querySelector('[data-integration="email"][data-field="smtp_server"]')?.value.trim();
                    
                    if (!email || !pass) {
                        if (window.showAlert) {
                            window.showAlert('tmpl-error-alert', { title: 'Ошибка', text: 'Введите Email и пароль.' });
                        } else {
                            alert('Введите Email и пароль.');
                        }
                        target.checked = false;
                        return;
                    }

                    if (statusBadge) {
                        statusBadge.className = 'status-badge connecting';
                        statusBadge.textContent = 'Проверка...';
                    }

                    try {
                        const authToken = localStorage.getItem('chatadmin_auth_token');
                        const res = await fetch('/api/chat/email/check-auth', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${authToken}`
                            },
                            body: JSON.stringify({
                                email_address: email,
                                email_password: pass,
                                imap_server: imap,
                                smtp_server: smtp
                            })
                        });
                        const data = await res.json();

                        if (res.ok && data.status === 'ok') {
                            if (statusBadge) {
                                statusBadge.className = 'status-badge connected';
                                statusBadge.textContent = 'Подключено';
                            }
                            this.syncInputsState();
                            
                            const cId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
                            if (this.startEmailSyncPolling) {
                                this.startEmailSyncPolling(cId);
                            }
                        } else {
                            throw new Error(data.error || 'Ошибка авторизации почты');
                        }
                    } catch (err) {
                        if (window.showAlert) {
                            window.showAlert('tmpl-error-alert', { title: 'Ошибка', text: err.message });
                        } else {
                            alert('Ошибка: ' + err.message);
                        }
                        target.checked = false;
                        if (statusBadge) {
                            statusBadge.className = 'status-badge disconnected';
                            statusBadge.textContent = 'Не подключено';
                        }
                        return;
                    }
                } else {
                    if (statusBadge) {
                        statusBadge.className = 'status-badge disconnected';
                        statusBadge.textContent = 'Не подключено';
                    }
                    this.syncInputsState();
                }
                
                if (!this.state.integrations.email) this.state.integrations.email = {};
                this.state.integrations.email.enabled = isEnabled;
            }
        });

        document.addEventListener('click', (e) => {
            const btn = e.target.closest('#add-tg-admin-btn');
            if (btn) {
                this.promptAddAdmin();
            }

            const togglePassBtn = e.target.closest('.toggle-password-btn');
            if (togglePassBtn) {
                const fieldId = togglePassBtn.dataset.target;
                const card = togglePassBtn.closest('.bento-card');
                const input = card ? card.querySelector(`[data-field="${fieldId}"]`) : document.querySelector(`[data-field="${fieldId}"]`);
                if (input) {
                    if (input.dataset.secretField === 'true' || input.classList.contains('tg-secret-input')) {
                        if (!input.dataset.secretField) {
                            input.dataset.secretField = 'true';
                        }
                        
                        const isVisible = !input.classList.contains('tg-secret-input');
                        if (isVisible) {
                            input.classList.add('tg-secret-input');
                        } else {
                            input.classList.remove('tg-secret-input');
                        }
                        togglePassBtn.classList.toggle('active', !isVisible);
                    } else {
                        const isPassword = input.type === 'password';
                        input.type = isPassword ? 'text' : 'password';
                        togglePassBtn.classList.toggle('active', !isPassword);
                    }
                }
            }
            
            const delBtn = e.target.closest('.delete-admin-btn');
            if (delBtn) {
                delBtn.closest('.setting-item').remove();
                this.syncAdminIdsHidden();
            }
        });
    },

    addAdminRow(val = '', shouldFocus = false) {
        const container = document.getElementById('tg-admins-container');
        if (!container) return;

        let label = 'ID пользователя';
        let id = val;

        if (val.includes(':')) {
            const parts = val.split(':');
            label = parts[0];
            id = parts[1];
        }
        
        const row = document.createElement('div');
        row.className = 'setting-item';
        row.innerHTML = `
            <label class="subtitle-card">${label}</label>
            <div class="flex-row-gap-10">
                <input type="text" class="hex-input-full tg-admin-id-field flex-1" value="${id}" data-label="${label}" placeholder="Введите ID" spellcheck="false">
                <button type="button" class="action-btn-circle sm btn-danger delete-admin-btn" title="Удалить">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>
            </div>
        `;
        container.appendChild(row);
        
        const input = row.querySelector('input');
        input.addEventListener('input', () => this.syncAdminIdsHidden());
        if (shouldFocus) input.focus();
        
        this.syncAdminIdsHidden();
        this.syncInputsState();
    },

    syncAdminIdsHidden() {
        const adminFields = document.querySelectorAll('.tg-admin-id-field');
        const ids = Array.from(adminFields).map(f => {
            const label = f.dataset.label || 'Администратор';
            const val = f.value.trim();
            return val ? `${label}:${val}` : '';
        }).filter(v => v);
        
        const hiddenInput = document.getElementById('tg-admin-ids-hidden');
        if (hiddenInput) {
            hiddenInput.value = ids.join(',');
        }
    },

    async promptAddAdmin() {
        if (typeof window.showAlert !== 'function') {
            const label = prompt('Введите название:', 'ID пользователя');
            if (label)                 this.addAdminRow(label + ':', true);
            return;
        }

        const overlay = window.showAlert('tmpl-prompt-alert', {});
        if (overlay) {
            const titleEl = overlay.querySelector('.alert-title');
            const textEl = overlay.querySelector('.alert-text');
            if (titleEl) titleEl.textContent = 'Добавить ID';
            if (textEl) textEl.textContent = 'Введите название';

            const input = overlay.querySelector('#prompt-input');
            const confirmBtn = overlay.querySelector('#prompt-confirm');
            const cancelBtn = overlay.querySelector('#prompt-cancel');
            const close = () => {
                overlay.style.opacity = '0';
                document.body.style.overflow = '';
                setTimeout(() => overlay.remove(), 300);
            };

            if (input) {
                input.placeholder = "Например: Менеджер";
                setTimeout(() => input.focus(), 100);
            }

            if (confirmBtn) {
                confirmBtn.onclick = () => {
                    const val = input.value.trim();
                    if (val) {
                        this.addAdminRow(val + ':');
                        close();
                    }
                };
            }
            if (cancelBtn) cancelBtn.onclick = close;
            
            input.onkeydown = (e) => {
                if (e.key === 'Enter') confirmBtn.click();
                if (e.key === 'Escape') close();
            };
        }
    },

    async loadData() {
        try {
            const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
            const token = localStorage.getItem('chatadmin_auth_token');
            const [integrationsRes, configRes] = await Promise.all([
                fetch(`/api/chat/admin/integrations?client_id=${clientId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }),
                fetch(`/api/chat/admin/config?client_id=${clientId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
            ]);
            if (integrationsRes.ok) {
                const data = await integrationsRes.json();
                this.state.integrations = data.integrations || {};
                if (!this.state.integrations.hh) this.state.integrations.hh = {};
                const hhBtn = document.getElementById('hh-connect-btn');
                if (hhBtn) {
                    const hhConnected = !!(this.state.integrations.hh.connected || this.state.integrations.hh.access_token);
                    hhBtn.textContent = hhConnected ? 'Переподключить через hh.ru' : 'Подключить через hh.ru';
                }

                if (!this.state.integrations.notifications) {
                    const legacyAdminIds = this.state.integrations.telegram?.admin_id || '';
                    if (legacyAdminIds) {
                        this.state.integrations.notifications = {
                            enabled: true,
                            admin_id: legacyAdminIds
                        };
                    }
                }

                if (this.state.integrations.notifications) {
                    const n = this.state.integrations.notifications;
                    n.notify_leads = n.notify_leads !== undefined ? !!n.notify_leads : true;
                    n.notify_contacts = n.notify_contacts !== undefined ? !!n.notify_contacts : true;
                    n.notify_messages = n.notify_messages !== undefined ? !!n.notify_messages : true;
                }

                this.fillData();
                this.updateNotificationsDependencyHint();
            }
            if (configRes.ok) {
                const configData = await configRes.json();
                if (configData.status === 'success') {
                    const config = configData.json ? configData.json : configData.config;
                    const allowedOrigins = config.allowed_origins || [];
                    const domainInput = document.getElementById('widget-origin-field');
                    if (domainInput) {
                        domainInput.value = Array.isArray(allowedOrigins) ? (allowedOrigins[0] || '') : '';
                    }

                    const widgetEnabled = config.theme?.widget_enabled;
                    const widgetToggle = document.querySelector('[data-integration="widget"][data-field="enabled"]');
                    if (widgetToggle && widgetEnabled !== undefined) {
                        widgetToggle.checked = !!widgetEnabled;
                        const statusBadge = document.getElementById('widget-status');
                        if (statusBadge) {
                            statusBadge.className = `status-badge ${widgetEnabled ? 'connected' : 'disconnected'}`;
                            statusBadge.textContent = widgetEnabled ? 'Подключено' : 'Не подключено';
                        }
                        if (!this.state.integrations.widget) this.state.integrations.widget = {};
                        this.state.integrations.widget.enabled = !!widgetEnabled;

                        var host = document.getElementById('mitya-widget-host');
                        if (widgetEnabled) {
                            if (host) host.style.display = '';
                            if (window.MityaWidget && window.MityaWidget.applyTheme) {
                                window.MityaWidget.applyTheme({ widget_enabled: true });
                            }
                        } else {
                            if (host) host.style.display = 'none';
                            if (window.MityaWidget && window.MityaWidget.applyTheme) {
                                window.MityaWidget.applyTheme({ widget_enabled: false });
                            }
                        }
                    }

                    this.generateWidgetCode(clientId);
                }
            }
        } catch (e) {
            console.error('Load error', e);
        }
    },

    generateWidgetCode(clientId) {
        const codeEl = document.getElementById('widget-script-code');
        const copyBtn = document.getElementById('copy-widget-script-btn');
        if (codeEl) {
            const siteDomain = document.getElementById('widget-origin-field')?.value?.trim() || '';

            if (!siteDomain) {
                codeEl.textContent = 'Укажите домен, чтобы получить код виджета';
                if (copyBtn) copyBtn.disabled = true;
                return;
            }

            if (copyBtn) copyBtn.disabled = false;

            const protocol = window.location.protocol;
            const host = window.location.host;
            const scriptUrl = `${protocol}//${host}/api/chat/chat-widget.js?client_id=${clientId}`;
            const scriptTag = `<script src="${scriptUrl}" defer><\/script>`;
            codeEl.textContent = scriptTag;
        }
    },

    copyWidgetScript() {
        const codeEl = document.getElementById('widget-script-code');
        if (!codeEl) return;

        const text = codeEl.textContent;
        navigator.clipboard.writeText(text).then(() => {
            const btn = document.getElementById('copy-widget-script-btn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Скопировано!';
            btn.classList.add('success-bg-btn');
            
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.classList.remove('success-bg-btn');
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy:', err);
        });
    },

    fillData() {
        this._fillingData = true;

        Object.keys(this.state.integrations).forEach(intId => {
            const data = this.state.integrations[intId];
            if (typeof data !== 'object') return;

            const fields = Object.keys(data);
            const textFields = fields.filter(f => {
                const el = document.querySelector(`[data-integration="${intId}"][data-field="${f}"]`);
                return el && el.type !== 'checkbox';
            });
            const checkboxFields = fields.filter(f => {
                const el = document.querySelector(`[data-integration="${intId}"][data-field="${f}"]`);
                return el && el.type === 'checkbox';
            });
            const orderedFields = [...textFields, ...checkboxFields];

            orderedFields.forEach(fieldId => {
                const inputs = document.querySelectorAll(`[data-integration="${intId}"][data-field="${fieldId}"]`);
                inputs.forEach(input => {
                    if (input.type === 'checkbox') {
                        input.checked = !!data[fieldId];
                    } else {
                        if (document.activeElement !== input) {
                            if (input.id === 'widget-origin-field') return;
                            const newValue = data[fieldId] || '';
                            if (input.value !== newValue) {
                                input.value = newValue;
                            }
                        }
                    }
                });

                if (intId === 'notifications' && fieldId === 'admin_id') {
                    const container = document.getElementById('tg-admins-container');
                    if (container) {
                        container.innerHTML = '';
                        const val = data[fieldId] || '';
                        val.split(',').forEach(id => {
                            if (id.trim()) this.addAdminRow(id.trim(), false);
                        });
                    }
                }

                if (intId === 'email' && fieldId === 'sync_history') {
                    const modeContainer = document.getElementById('email-sync-mode-container');
                    if (modeContainer) {
                        modeContainer.style.display = data[fieldId] ? 'block' : 'none';
                    }
                }

                if (intId === 'telegram') {
                    if (fieldId === 'autoreply_enabled') {
                        const autoreplySettings = document.getElementById('tg-autoreply-settings');
                        if (autoreplySettings) {
                            autoreplySettings.style.display = data[fieldId] ? 'block' : 'none';
                        }
                    }
                    if (fieldId === 'assistant_enabled') {
                        const assistantSettings = document.getElementById('tg-assistant-settings');
                        if (assistantSettings) {
                            assistantSettings.style.display = data[fieldId] ? 'block' : 'none';
                        }
                    }
                }

                if (intId === 'email' && fieldId === 'autoreply_enabled') {
                    const autoreplySettings = document.getElementById('email-autoreply-settings');
                    if (autoreplySettings) {
                        autoreplySettings.style.display = data[fieldId] ? 'block' : 'none';
                    }
                }

                if (intId === 'max' && fieldId === 'autoreply_enabled') {
                    const autoreplySettings = document.getElementById('max-autoreply-settings');
                    if (autoreplySettings) {
                        autoreplySettings.style.display = data[fieldId] ? 'block' : 'none';
                    }
                }

                if (intId === 'vk' && fieldId === 'autoreply_enabled') {
                    const autoreplySettings = document.getElementById('vk-autoreply-settings');
                    if (autoreplySettings) {
                        autoreplySettings.style.display = data[fieldId] ? 'block' : 'none';
                    }
                }

                if (intId === 'widget' && fieldId === 'autoreply_enabled') {
                    const autoreplySettings = document.getElementById('widget-autoreply-settings');
                    if (autoreplySettings) {
                        autoreplySettings.style.display = data[fieldId] ? 'block' : 'none';
                    }
                }

                if (intId === 'email' && fieldId === 'sync_mode') {
                    const mode = data[fieldId] || 'sync_only';
                    const input = document.getElementById('email-sync-mode-input');
                    if (input) input.value = mode;
                    
                    document.querySelectorAll('.sync-mode-btn').forEach(btn => {
                        if (btn.dataset.mode === mode) {
                            btn.classList.add('active');
                        } else {
                            btn.classList.remove('active');
                        }
                    });
                }
                
                const statusBadge = document.getElementById(`${intId}-status`);
                if (statusBadge) {
                    let isConnected = false;
                    if (intId === 'telegram') {
                        isConnected = !!(data.enabled && data.bot_token);
                    } else if (intId === 'notifications') {
                        const hasAnyEvent = !!(data.notify_leads || data.notify_contacts || data.notify_messages);
                        isConnected = !!(data.enabled && data.admin_id && hasAnyEvent);
                    } else if (intId === 'avito') {
                        isConnected = !!(data.enabled && data.client_id && data.client_secret);
                    } else if (intId === 'hh') {
                        isConnected = !!(data.enabled && (data.connected || data.access_token));
                    } else if (intId === 'widget') {
                        isConnected = !!data.enabled;
                    } else if (intId === 'email') {
                        isConnected = !!(data.enabled && data.email_address && data.email_password);
                        if (isConnected) {
                            const cId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
                            this.startEmailSyncPolling(cId);
                        }
                    } else {
                        isConnected = !!data.enabled;
                    }
                    
                    statusBadge.className = `status-badge ${isConnected ? 'connected' : 'disconnected'}`;
                    statusBadge.textContent = isConnected ? 'Подключено' : 'Не подключено';
                }
            });
        });

        this._fillingData = false;
        this.syncInputsState();

        setTimeout(() => {
            const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
            this.generateWidgetCode(clientId);
        }, 100);
    },

    updateStateFromUI() {
        if (!this.state.integrations) this.state.integrations = {};

        const inputs = document.querySelectorAll('[data-integration]');
        inputs.forEach(input => {
            const intId = input.dataset.integration;
            const fieldId = input.dataset.field || input.dataset.setting;
            
            if (!fieldId) return;
            if (!this.state.integrations[intId]) this.state.integrations[intId] = {};

            if (input.type === 'checkbox') {
                this.state.integrations[intId][fieldId] = input.checked;
            } else {
                this.state.integrations[intId][fieldId] = input.value.trim();
            }
        });

        console.log('[Integrations] State updated from UI:', this.state.integrations);
    },

    async saveData() {
        const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
        const token = localStorage.getItem('chatadmin_auth_token');

        const emailToggle = document.querySelector('[data-integration="email"][data-field="enabled"]');
        const emailBadge = document.getElementById('email-status');
        
        if (emailToggle && emailToggle.checked) {
            const email = document.querySelector('[data-integration="email"][data-field="email_address"]')?.value.trim();
            const pass = document.querySelector('[data-integration="email"][data-field="email_password"]')?.value.trim();
            const imap = document.querySelector('[data-integration="email"][data-field="imap_server"]')?.value.trim();
            const smtp = document.querySelector('[data-integration="email"][data-field="smtp_server"]')?.value.trim();

            if (!email || !pass) {
                emailToggle.checked = false;
                if (emailBadge) { emailBadge.className = 'status-badge disconnected'; emailBadge.textContent = 'Не подключено'; }
            } else {
                try {
                    if (emailBadge) { emailBadge.className = 'status-badge connecting'; emailBadge.textContent = 'Проверка...'; }
                    const vRes = await fetch('/api/chat/email/check-auth', {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ email_address: email, email_password: pass, imap_server: imap, smtp_server: smtp })
                    });
                    const vData = await vRes.json();
                    if (!vRes.ok || vData.status !== 'ok') {
                        emailToggle.checked = false;
                        if (emailBadge) { emailBadge.className = 'status-badge disconnected'; emailBadge.textContent = 'Не подключено'; }
                        if (window.showAlert) window.showAlert('tmpl-error-alert', { title: 'Ошибка Email', text: vData.error || 'Не удалось подключиться к почте' });
                    }
                } catch (e) { console.error('Email pre-save check error', e); }
            }
        }

        const maxToggle = document.querySelector('[data-integration="max"][data-field="enabled"]');
        const maxBadge = document.getElementById('max-status');

        if (maxToggle && maxToggle.checked) {
            const maxToken = document.getElementById('max-bot-token-input')?.value.trim();

            if (!maxToken) {
                maxToggle.checked = false;
                if (maxBadge) { maxBadge.className = 'status-badge disconnected'; maxBadge.textContent = 'Не подключено'; }
            } else {
                try {
                    if (maxBadge) { maxBadge.className = 'status-badge connecting'; maxBadge.textContent = 'Проверка...'; }
                    const vRes = await fetch(`/api/chat/max/check-token?client_id=${clientId}`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ bot_token: maxToken })
                    });
                    const vData = await vRes.json();
                    if (!vRes.ok || vData.status !== 'ok') {
                        maxToggle.checked = false;
                        if (maxBadge) { maxBadge.className = 'status-badge disconnected'; maxBadge.textContent = 'Не подключено'; }
                        if (window.showAlert) window.showAlert('tmpl-error-alert', { title: 'Ошибка MAX', text: vData.error || 'Неверный токен MAX' });
                    }
                } catch (e) { console.error('Max pre-save check error', e); }
            }
        }

        const hhToggle = document.querySelector('[data-integration="hh"][data-field="enabled"]');
        const hhData = this.state.integrations.hh || {};
        if (hhToggle && hhToggle.checked && !(hhData.connected || hhData.access_token)) {
            hhToggle.checked = false;
            if (window.showAlert) {
                window.showAlert('tmpl-error-alert', { title: 'Ошибка HeadHunter', text: 'HeadHunter не авторизован. Нажмите «Подключить через hh.ru».' });
            }
        }

        this.updateStateFromUI();

        const notificationsData = this.state.integrations.notifications || {};
        const hasAnyNotificationsEvent = !!(
            notificationsData.notify_leads ||
            notificationsData.notify_contacts ||
            notificationsData.notify_messages
        );
        if (notificationsData.enabled && hasAnyNotificationsEvent && !this.hasTelegramBotToken()) {
            const msg = 'Для уведомлений подключите Telegram-бота в карточке Telegram (укажите токен бота).';
            if (window.showAlert) {
                window.showAlert('tmpl-error-alert', { title: 'Требуется Telegram бот', text: msg });
            } else {
                alert(msg);
            }
            return;
        }
        
        const presentIntegrations = new Set();
        document.querySelectorAll('[data-integration]').forEach(el => {
            presentIntegrations.add(el.dataset.integration);
        });

        try {
            for (const name of presentIntegrations) {
                const data = this.state.integrations[name];
                if (!data) continue;
                
                if (Object.keys(data).length === 0) continue;

                console.log(`[SAVE] Sending ${name}:`, data);

                let endpoint;
                if (name === 'telegram') {
                    endpoint = `/api/chat/telegram/setup?client_id=${clientId}`;
                } else if (name === 'max') {
                    endpoint = `/api/chat/max/setup?client_id=${clientId}`;
                } else if (name === 'vk') {
                    endpoint = `/api/chat/vk/setup?client_id=${clientId}`;
                } else {
                    endpoint = `/api/chat/admin/integrations/${name}?client_id=${clientId}`;
                }

                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(data)
                });

                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.error || `Ошибка при сохранении ${name}`);
                }
            }
        } catch (e) {
            console.error('Save error:', e);
            if (window.showAlert) {
                window.showAlert('tmpl-error-alert', {
                    title: 'Ошибка сохранения',
                    text: e.message
                });
            } else {
                alert('Ошибка сохранения: ' + e.message);
            }
            return;
        }

        const siteDomainInput = document.getElementById('widget-origin-field');
        const widgetToggle = document.querySelector('[data-integration="widget"][data-field="enabled"]');
        
        if (siteDomainInput || widgetToggle) {
            let siteDomain = siteDomainInput?.value?.trim() || '';
            let widgetEnabled = widgetToggle ? widgetToggle.checked : false;

            if (!siteDomain && widgetEnabled) {
                widgetEnabled = false;
                if (widgetToggle) widgetToggle.checked = false;
                if (window.showAlert) {
                    window.showAlert('tmpl-error-alert', {
                        title: 'Внимание',
                        text: 'Виджет был выключен, так как не указан домен.'
                    });
                }
            }

            if (siteDomain && widgetEnabled) {
                try {
                    const badge = document.getElementById('widget-status');
                    if (badge) { badge.className = 'status-badge connecting'; badge.textContent = 'Проверка...'; }
                    const vRes = await fetch(`/api/chat/widget/verify?client_id=${clientId}`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ domain: siteDomain })
                    });
                    const vData = await vRes.json();
                    if (!vRes.ok || !vData.found) {
                        widgetEnabled = false;
                        if (widgetToggle) widgetToggle.checked = false;
                        if (badge) { badge.className = 'status-badge disconnected'; badge.textContent = 'Не подключено'; }
                        if (window.showAlert) window.showAlert('tmpl-error-alert', { title: 'Ошибка', text: vData.message || 'Скрипт виджета не найден на сайте.' });
                    }
                } catch (e) {
                    widgetEnabled = false;
                    if (widgetToggle) widgetToggle.checked = false;
                    const badge = document.getElementById('widget-status');
                    if (badge) { badge.className = 'status-badge disconnected'; badge.textContent = 'Не подключено'; }
                    if (window.showAlert) window.showAlert('tmpl-error-alert', { title: 'Ошибка', text: 'Не удалось проверить домен.' });
                }
            }

            console.log(`[SAVE] Widget config: domain=${siteDomain}, enabled=${widgetEnabled}`);

            try {
                const widgetData = {
                    allowed_origins: siteDomain ? [siteDomain] : [],
                    theme: { 
                        widget_enabled: widgetEnabled 
                    }
                };

                const res = await fetch(`/api/chat/admin/config?client_id=${clientId}`, {
                    method: 'POST', 
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(widgetData)
                });
                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.error || 'Ошибка при сохранении домена');
                }
            } catch (e) {
                console.error('Widget save error:', e);
            }
        }

        const syncHistoryCheckbox = document.getElementById('email-sync-history-checkbox');
        if (syncHistoryCheckbox && syncHistoryCheckbox.checked) {
            const syncMode = document.getElementById('email-sync-mode-input')?.value || 'sync_only';
            try {
                await fetch('/api/chat/email/sync', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        client_id: clientId,
                        mode: syncMode,
                        force: true
                    })
                });
                this.startEmailSyncPolling(clientId);
                syncHistoryCheckbox.checked = false;
            } catch (e) {
                console.error('Failed to start email sync:', e);
            }
        }
        
        await this.loadData();
    },

    async startEmailSyncPolling(clientId) {
        if (this._emailSyncPolling) return;
        this._emailSyncPolling = true;

        const progressContainer = document.getElementById('email-sync-progress-container');
        const progressBar = document.getElementById('email-sync-bar');
        const progressPercent = document.getElementById('email-sync-percent');
        const progressStatus = document.getElementById('email-sync-status-text');

        const poll = async () => {
            try {
                const token = localStorage.getItem('chatadmin_auth_token');
                const res = await fetch(`/api/chat/email/status/${clientId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) return;
                
                const data = await res.json();
                const statusBadge = document.getElementById('email-status');
                
                if (data.status === 'syncing') {
                    if (statusBadge) {
                        statusBadge.className = 'status-badge connecting';
                        statusBadge.textContent = 'Синхронизация...';
                    }
                    
                    if (progressContainer) progressContainer.style.display = 'block';
                    
                    if (data.progress) {
                        const current = data.progress.current || 0;
                        const total = data.progress.total || 0;
                        const percent = total > 0 ? Math.round((current / total) * 100) : 0;
                        
                        if (progressBar) progressBar.style.width = `${percent}%`;
                        if (progressPercent) progressPercent.textContent = `${percent}%`;
                        if (progressStatus) progressStatus.textContent = `Обработано ${current} из ${total} писем`;
                    }
                    
                    setTimeout(poll, 2000);
                } else {
                    if (statusBadge) {
                        const isConnected = !!(this.state.integrations.email?.enabled && this.state.integrations.email?.email_address);
                        statusBadge.className = `status-badge ${isConnected ? 'connected' : 'disconnected'}`;
                        statusBadge.textContent = isConnected ? 'Подключено' : 'Не подключено';
                    }
                    
                    if (data.status === 'completed') {
                        if (progressStatus) progressStatus.textContent = 'Синхронизация завершена!';
                        if (progressBar) progressBar.style.width = '100%';
                        if (progressPercent) progressPercent.textContent = '100%';
                        setTimeout(() => {
                            if (progressContainer) progressContainer.style.display = 'none';
                        }, 5000);
                    } else if (data.status === 'error') {
                        let errorMsg = data.progress.error || 'неизвестно';
                        if (errorMsg.includes('Application-specific password required')) {
                            errorMsg = 'Требуется пароль приложения Google';
                        }
                        if (progressStatus) {
                            progressStatus.textContent = 'Ошибка: ' + errorMsg;
                            progressStatus.style.color = '#ff4d4f';
                        }
                    } else {
                        if (progressContainer) progressContainer.style.display = 'none';
                    }
                    
                    this._emailSyncPolling = false;
                }
            } catch (e) {
                console.error('Email sync poll error:', e);
                this._emailSyncPolling = false;
            }
        };

        poll();
    }
};
