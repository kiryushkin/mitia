export const IntegrationsModule = {
    state: {
        integrations: {},
        loadedIntegrations: new Set(),
        dirtyIntegrations: new Set()
    },
    
    async init() {
        console.log('Integrations module initialized');
        this.bindEvents();
        await this.loadData();
        const params = new URLSearchParams(window.location.search);
        if (params.get('hh_authorized') === '1') {
            const hhToggle = document.querySelector('[data-integration="hh"][data-field="enabled"]');
            if (hhToggle) {
                hhToggle.checked = true;
                this.state.dirtyIntegrations.add('hh');
                const badge = document.getElementById('hh-status');
                if (badge) {
                    badge.className = 'status-badge connected';
                    badge.textContent = 'Проверено — сохраните изменения';
                }
            }
            window.history.replaceState({}, '', window.location.pathname);
        }
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
                return;
            }

            const modeButton = e.target.closest('[data-integration-mode-value]');
            if (modeButton) {
                const picker = modeButton.closest('[data-integration-mode]');
                if (picker) this.setIntegrationMode(picker.dataset.integrationMode, modeButton.dataset.integrationModeValue);
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

            const copyVkCallbackBtn = e.target.closest('#copy-vk-callback-btn');
            if (copyVkCallbackBtn) {
                const callbackUrl = document.getElementById('vk-callback-url')?.textContent?.trim();
                if (callbackUrl) {
                    navigator.clipboard.writeText(callbackUrl).then(() => {
                        const originalText = copyVkCallbackBtn.textContent;
                        copyVkCallbackBtn.textContent = 'Скопировано';
                        setTimeout(() => { copyVkCallbackBtn.textContent = originalText; }, 1500);
                    });
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
                        const assistantId = window.AdminApp?.getActiveAssistantId?.() || '';
                        const assistantQuery = assistantId ? `&assistant_id=${encodeURIComponent(assistantId)}` : '';
                        const res = await fetch(`/api/chat/telegram/check-token?client_id=${clientId}${assistantQuery}`, {
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
                            window.showAlert('tmpl-error-alert', { title: 'Ошибка проверки Telegram', text: err.message });
                        } else {
                            alert('Ошибка: ' + err.message);
                        }
                        // Временная ошибка proxy/API не должна стирать выбор пользователя.
                        const statusBadge = document.getElementById('telegram-status');
                        if (statusBadge) {
                            statusBadge.className = 'status-badge connecting';
                            statusBadge.textContent = 'Требуется повторная проверка';
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
                        const activeAssistantId = window.AdminApp?.getActiveAssistantId?.() || '';
                        const assistantQuery = activeAssistantId ? `&assistant_id=${encodeURIComponent(activeAssistantId)}` : '';
                        const res = await fetch(`/api/chat/max/check-token?client_id=${clientId}${assistantQuery}`, {
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

            if (target.matches('[data-integration="ok"][data-field="enabled"]')) {
                const isEnabled = target.checked;
                const tokenInput = document.getElementById('ok-access-token-input');
                const accessToken = tokenInput ? tokenInput.value.trim() : '';
                const statusBadge = document.getElementById('ok-status');

                if (!isEnabled) {
                    if (statusBadge) {
                        statusBadge.className = 'status-badge disconnected';
                        statusBadge.textContent = 'Не подключено';
                    }
                    this.syncInputsState();
                    return;
                }

                if (!accessToken) {
                    target.checked = false;
                    if (window.showAlert) {
                        window.showAlert('tmpl-error-alert', { title: 'Ошибка Одноклассников', text: 'Введите ключ доступа Bot API перед включением.' });
                    } else {
                        alert('Введите ключ доступа Bot API перед включением.');
                    }
                    this.syncInputsState();
                    return;
                }

                if (statusBadge) {
                    statusBadge.className = 'status-badge connecting';
                    statusBadge.textContent = 'Проверка...';
                }

                try {
                    const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
                    const authToken = localStorage.getItem('chatadmin_auth_token');
                    const assistantId = window.AdminApp?.getActiveAssistantId?.() || '';
                    const assistantQuery = assistantId ? `&assistant_id=${encodeURIComponent(assistantId)}` : '';
                    const response = await fetch(`/api/chat/ok/check-token?client_id=${clientId}${assistantQuery}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${authToken}`
                        },
                        body: JSON.stringify({ access_token: accessToken })
                    });
                    const data = await response.json();
                    if (!response.ok || data.status !== 'ok') {
                        throw new Error(data.error || 'Ключ Bot API не прошёл проверку.');
                    }
                    if (statusBadge) {
                        statusBadge.className = 'status-badge connected';
                        statusBadge.textContent = 'Проверено — сохраните изменения';
                    }
                    this.syncInputsState();
                } catch (err) {
                    target.checked = false;
                    if (statusBadge) {
                        statusBadge.className = 'status-badge disconnected';
                        statusBadge.textContent = 'Не подключено';
                    }
                    if (window.showAlert) {
                        window.showAlert('tmpl-error-alert', { title: 'Ошибка Одноклассников', text: err.message });
                    } else {
                        alert('Ошибка: ' + err.message);
                    }
                    this.syncInputsState();
                }
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
                        const activeAssistantId = window.AdminApp?.getActiveAssistantId?.() || '';
                        const assistantQuery = activeAssistantId ? `&assistant_id=${encodeURIComponent(activeAssistantId)}` : '';
                        const res = await fetch(`/api/chat/widget/verify?client_id=${clientId}${assistantQuery}`, {
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
                    try {
                        if (statusBadge) {
                            statusBadge.className = 'status-badge connecting';
                            statusBadge.textContent = 'Авторизация...';
                        }
                        const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
                        const authToken = localStorage.getItem('chatadmin_auth_token');
                        const assistantId = window.AdminApp?.getActiveAssistantId?.() || '';
                        const assistantQuery = assistantId ? `&assistant_id=${encodeURIComponent(assistantId)}` : '';
                        const response = await fetch(`/api/chat/hh/oauth/start?client_id=${clientId}${assistantQuery}`, {
                            headers: { 'Authorization': `Bearer ${authToken}` }
                        });
                        const data = await response.json();
                        if (!response.ok || data.status !== 'ok' || !data.auth_url) {
                            throw new Error(data.error || 'Не удалось начать авторизацию HeadHunter.');
                        }
                        window.location.href = data.auth_url;
                        return;
                    } catch (error) {
                        target.checked = false;
                        if (statusBadge) {
                            statusBadge.className = 'status-badge disconnected';
                            statusBadge.textContent = 'Не подключено';
                        }
                        if (window.showAlert) window.showAlert('tmpl-error-alert', { title: 'Ошибка HeadHunter', text: error.message });
                    }
                } else if (isEnabled) {
                    try {
                        if (statusBadge) {
                            statusBadge.className = 'status-badge connecting';
                            statusBadge.textContent = 'Проверка...';
                        }
                        const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
                        const authToken = localStorage.getItem('chatadmin_auth_token');
                        const assistantId = window.AdminApp?.getActiveAssistantId?.() || '';
                        const assistantQuery = assistantId ? `&assistant_id=${encodeURIComponent(assistantId)}` : '';
                        const response = await fetch(`/api/chat/hh/verify?client_id=${clientId}${assistantQuery}`, {
                            method: 'POST', headers: { 'Authorization': `Bearer ${authToken}` },
                        });
                        const result = await response.json();
                        if (!response.ok || result.status !== 'ok' || !result.connected) throw new Error(result.error || 'Авторизация HeadHunter истекла.');
                        this.state.integrations.hh.connected = true;
                        this.state.integrations.hh.account_name = result.account_name || this.state.integrations.hh.account_name;
                    } catch (error) {
                        target.checked = false;
                        if (statusBadge) {
                            statusBadge.className = 'status-badge disconnected';
                            statusBadge.textContent = 'Требуется подключение';
                        }
                        if (window.showAlert) window.showAlert('tmpl-error-alert', { title: 'HeadHunter недоступен', text: error.message });
                    }
                }

                const connected = !!(target.checked && (this.state.integrations.hh?.connected || this.state.integrations.hh?.access_token));
                if (statusBadge) {
                    statusBadge.className = `status-badge ${connected ? 'connected' : 'disconnected'}`;
                    statusBadge.textContent = connected ? 'Проверено — сохраните изменения' : 'Не подключено';
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
                            if (!this.state.integrations.email) this.state.integrations.email = {};
                            this.state.integrations.email.enabled = true;
                            this.state.integrations.email.connection_verified = true;
                            this.state.dirtyIntegrations.add('email');
                            if (statusBadge) {
                                statusBadge.className = 'status-badge connected';
                                statusBadge.textContent = 'Подключено';
                            }
                            this.syncInputsState();
                        } else {
                            throw new Error(data.error || data.detail || 'Не удалось подключиться к почте. Проверьте адрес, пароль приложения и настройки IMAP/SMTP.');
                        }
                    } catch (err) {
                        if (!this.state.integrations.email) this.state.integrations.email = {};
                        this.state.integrations.email.enabled = false;
                        this.state.integrations.email.connection_verified = false;
                        this.state.dirtyIntegrations.add('email');
                        if (window.showAlert) {
                            window.showAlert('tmpl-error-alert', { title: 'Ошибка Email', text: err.message || 'Не удалось подключиться к почте. Проверьте адрес, пароль приложения и настройки IMAP/SMTP.' });
                        } else {
                            alert(err.message || 'Не удалось подключиться к почте. Проверьте адрес, пароль приложения и настройки IMAP/SMTP.');
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
            const assistantId = window.AdminApp?.getActiveAssistantId?.();
            const assistantQuery = assistantId ? `&assistant_id=${encodeURIComponent(assistantId)}` : '';
            const [integrationsRes, configRes] = await Promise.all([
                fetch(`/api/chat/admin/integrations?client_id=${clientId}${assistantQuery}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }),
                fetch(`/api/chat/admin/config?client_id=${clientId}${assistantQuery}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
            ]);
            if (integrationsRes.ok) {
                const data = await integrationsRes.json();
                const receivedIntegrations = data.integrations;
                if (!receivedIntegrations || typeof receivedIntegrations !== 'object' || Array.isArray(receivedIntegrations)) {
                    throw new Error('Сервер вернул неполные настройки интеграций');
                }

                // Не затираем уже загруженную карточку пустым/частичным ответом API.
                // Это особенно важно после перехода между разделами и обновления страницы.
                this.state.integrations = {
                    ...this.state.integrations,
                    ...receivedIntegrations
                };
                Object.keys(receivedIntegrations).forEach((name) => this.state.loadedIntegrations.add(name));
                if (!this.state.integrations.hh) this.state.integrations.hh = {};

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

            // Всегда абсолютный URL Mitia (не URL сайта клиента).
            // На https-страницах клиентов http-скрипт блокируется браузером.
            const serverOrigin = (window.location.protocol === 'https:' || window.location.hostname === 'mitia.pro' || window.location.hostname.endsWith('.mitia.pro'))
                ? `${window.location.protocol}//${window.location.host}`
                : 'https://mitia.pro';
            const safeClientId = String(clientId || '').trim();
            const safeAssistantId = String(window.AdminApp?.getActiveAssistantId?.() || '').trim();
            const assistantQuery = safeAssistantId ? `&assistant_id=${encodeURIComponent(safeAssistantId)}` : '';
            const scriptUrl = `${serverOrigin}/api/chat/chat-widget.js?client_id=${encodeURIComponent(safeClientId)}${assistantQuery}`;

            // data-client + MITYA_CONFIG — чтобы client_id не терялся на Tilda/WordPress/конструкторах с defer/async.
            const scriptTag = [
                `<script>`,
                `  window.MITYA_CONFIG = {`,
                `    clientId: '${safeClientId}',`,
                ...(safeAssistantId ? [`    assistantId: '${safeAssistantId}',`] : []),
                `    serverUrl: '${serverOrigin}'`,
                `  };`,
                `<\/script>`,
                `<script src="${scriptUrl}" data-client="${safeClientId}"${safeAssistantId ? ` data-assistant-id="${safeAssistantId}"` : ''} defer><\/script>`
            ].join('\n');

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

        ['widget', 'email', 'telegram', 'max', 'vk', 'ok', 'avito', 'hh'].forEach((name) => {
            if (!this.state.integrations[name]) this.state.integrations[name] = {};
            const settings = this.state.integrations[name];
            // Modes are mutually exclusive. A partial response must not turn an
            // explicitly enabled assistant into the operator mode on reload.
            if (settings.assistant_enabled === undefined) settings.assistant_enabled = false;
            settings.autoreply_enabled = false;
            settings.autoreply_message = '';
        });

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
                        if (fieldId in data) {
                            input.checked = !!data[fieldId];
                        }
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
                        isConnected = !!(data.enabled && data.connection_verified);
                    } else {
                        isConnected = !!data.enabled;
                    }
                    
                    statusBadge.className = `status-badge ${isConnected ? 'connected' : 'disconnected'}`;
                    statusBadge.textContent = isConnected ? 'Подключено' : 'Не подключено';
                }
            });
        });

        ['widget', 'email', 'telegram', 'max', 'vk', 'ok', 'avito', 'hh'].forEach((name) => {
            const settings = this.state.integrations[name] || {};
            this.setIntegrationMode(name, settings.assistant_enabled ? 'assistant' : 'operator', { markDirty: false });
        });

        this._fillingData = false;
        this.syncInputsState();

        setTimeout(() => {
            const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
            this.generateWidgetCode(clientId);
        }, 100);
    },

    setIntegrationMode(name, mode, { markDirty = true } = {}) {
        const isAssistant = mode === 'assistant';
        const picker = document.querySelector(`[data-integration-mode="${name}"]`);
        const assistantInput = document.querySelector(`[data-integration="${name}"][data-field="assistant_enabled"]`);
        if (assistantInput) assistantInput.checked = isAssistant;
        picker?.querySelectorAll('[data-integration-mode-value]').forEach((button) => {
            button.classList.toggle('active', button.dataset.integrationModeValue === mode);
        });
        if (markDirty) {
            if (!this.state.integrations[name]) this.state.integrations[name] = {};
            this.state.integrations[name].assistant_enabled = isAssistant;
            this.state.integrations[name].autoreply_enabled = false;
            this.state.integrations[name].autoreply_message = '';
            this.state.dirtyIntegrations.add(name);
        }
    },

    updateStateFromUI() {
        if (!this.state.integrations) this.state.integrations = {};

        const inputs = document.querySelectorAll('[data-integration]');
        inputs.forEach(input => {
            const intId = input.dataset.integration;
            const fieldId = input.dataset.field || input.dataset.setting;
            if (!fieldId) return;
            if (!this.state.integrations[intId]) this.state.integrations[intId] = {};

            const previousValue = this.state.integrations[intId][fieldId];
            const nextValue = input.type === 'checkbox' ? input.checked : input.value.trim();
            if (previousValue !== nextValue) this.state.dirtyIntegrations.add(intId);
            this.state.integrations[intId][fieldId] = nextValue;
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
                if (window.showAlert) window.showAlert('tmpl-error-alert', { title: 'Ошибка Email', text: 'Укажите email и пароль приложения.' });
                return;
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
                        if (!this.state.integrations.email) this.state.integrations.email = {};
                        this.state.integrations.email.enabled = false;
                        this.state.integrations.email.connection_verified = false;
                        this.state.dirtyIntegrations.add('email');
                        if (emailBadge) { emailBadge.className = 'status-badge disconnected'; emailBadge.textContent = 'Не подключено'; }
                        console.error('Email pre-save check failed:', vData.error);
                        const errorText = vData.error || vData.detail || 'Не удалось подключиться к почте. Проверьте адрес, пароль приложения и настройки IMAP/SMTP.';
                        if (window.showAlert) window.showAlert('tmpl-error-alert', { title: 'Ошибка Email', text: errorText });
                        return;
                    }
                    if (!this.state.integrations.email) this.state.integrations.email = {};
                    this.state.integrations.email.connection_verified = true;
                    this.state.dirtyIntegrations.add('email');
                } catch (e) {
                    console.error('Email pre-save check error', e);
                    if (emailBadge) { emailBadge.className = 'status-badge disconnected'; emailBadge.textContent = 'Не подключено'; }
                    if (window.showAlert) window.showAlert('tmpl-error-alert', { title: 'Ошибка Email', text: 'Не удалось проверить подключение к почте.' });
                    return;
                }
            }
        }

        const telegramToggle = document.querySelector('[data-integration="telegram"][data-field="enabled"]');
        const telegramBadge = document.getElementById('telegram-status');
        if (telegramToggle && telegramToggle.checked) {
            const telegramToken = document.querySelector('[data-integration="telegram"][data-field="bot_token"]')?.value.trim();
            if (!telegramToken) {
                telegramToggle.checked = false;
                if (telegramBadge) { telegramBadge.className = 'status-badge disconnected'; telegramBadge.textContent = 'Не подключено'; }
                if (window.showAlert) window.showAlert('tmpl-error-alert', { title: 'Ошибка Telegram', text: 'Укажите токен Telegram-бота.' });
                return;
            }
        }


        const maxToggle = document.querySelector('[data-integration="max"][data-field="enabled"]');
        const maxBadge = document.getElementById('max-status');

        if (maxToggle && maxToggle.checked) {
            const maxToken = document.getElementById('max-bot-token-input')?.value.trim();

            if (!maxToken) {
                maxToggle.checked = false;
                if (maxBadge) { maxBadge.className = 'status-badge disconnected'; maxBadge.textContent = 'Не подключено'; }
                if (window.showAlert) window.showAlert('tmpl-error-alert', { title: 'Ошибка MAX', text: 'Укажите токен MAX-бота.' });
                return;
            } else {
                try {
                    if (maxBadge) { maxBadge.className = 'status-badge connecting'; maxBadge.textContent = 'Проверка...'; }
                    const activeAssistantId = window.AdminApp?.getActiveAssistantId?.() || '';
                    const assistantQuery = activeAssistantId ? `&assistant_id=${encodeURIComponent(activeAssistantId)}` : '';
                    const vRes = await fetch(`/api/chat/max/check-token?client_id=${clientId}${assistantQuery}`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ bot_token: maxToken })
                    });
                    const vData = await vRes.json();
                    if (!vRes.ok || vData.status !== 'ok') {
                        maxToggle.checked = false;
                        if (maxBadge) { maxBadge.className = 'status-badge disconnected'; maxBadge.textContent = 'Не подключено'; }
                        if (window.showAlert) window.showAlert('tmpl-error-alert', { title: 'Ошибка MAX', text: vData.error || 'Неверный токен MAX' });
                        return;
                    }
                } catch (e) {
                    console.error('Max pre-save check error', e);
                    if (maxBadge) { maxBadge.className = 'status-badge disconnected'; maxBadge.textContent = 'Не подключено'; }
                    if (window.showAlert) window.showAlert('tmpl-error-alert', { title: 'Ошибка MAX', text: 'Не удалось проверить токен MAX.' });
                    return;
                }
            }
        }

        const hhToggle = document.querySelector('[data-integration="hh"][data-field="enabled"]');
        const hhData = this.state.integrations.hh || {};
        if (hhToggle && !hhToggle.checked && this.state.dirtyIntegrations.has('hh')) {
            try {
                const assistantId = window.AdminApp?.getActiveAssistantId?.() || '';
                const assistantQuery = assistantId ? `&assistant_id=${encodeURIComponent(assistantId)}` : '';
                const response = await fetch(`/api/chat/hh/disconnect?client_id=${clientId}${assistantQuery}`, {
                    method: 'POST', headers: { 'Authorization': `Bearer ${token}` },
                });
                if (!response.ok) {
                    const result = await response.json().catch(() => ({}));
                    throw new Error(result.error || result.detail || 'Не удалось отключить HeadHunter.');
                }
                Object.assign(hhData, {
                    enabled: false, connected: false, access_token: '', refresh_token: '',
                    account_name: '', expires_in: 0,
                });
            } catch (error) {
                hhToggle.checked = true;
                if (window.showAlert) window.showAlert('tmpl-error-alert', { title: 'Ошибка HeadHunter', text: error.message });
                return;
            }
        }
        if (hhToggle?.checked) {
            try {
                const assistantId = window.AdminApp?.getActiveAssistantId?.() || '';
                const assistantQuery = assistantId ? `&assistant_id=${encodeURIComponent(assistantId)}` : '';
                const response = await fetch(`/api/chat/hh/verify?client_id=${clientId}${assistantQuery}`, {
                    method: 'POST', headers: { 'Authorization': `Bearer ${token}` },
                });
                const result = await response.json();
                if (!response.ok || result.status !== 'ok' || !result.connected) {
                    throw new Error(result.error || 'Авторизация HeadHunter истекла.');
                }
                hhData.connected = true;
                hhData.account_name = result.account_name || hhData.account_name;
            } catch (error) {
                hhToggle.checked = false;
                const badge = document.getElementById('hh-status');
                if (badge) { badge.className = 'status-badge disconnected'; badge.textContent = 'Требуется подключение'; }
                if (window.showAlert) window.showAlert('tmpl-error-alert', { title: 'Ошибка HeadHunter', text: error.message });
                return;
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

        const saveErrors = [];

        for (const name of presentIntegrations) {
            const data = this.state.integrations[name];
            if (!data || !this.state.dirtyIntegrations.has(name)) continue;

            if (Object.keys(data).length === 0) continue;

            console.log(`[SAVE] Sending ${name}:`, data);

            let endpoint;
            if (name === 'telegram') {
                const assistantId = window.AdminApp?.getActiveAssistantId?.() || '';
                const assistantQuery = assistantId ? `&assistant_id=${encodeURIComponent(assistantId)}` : '';
                endpoint = `/api/chat/telegram/setup?client_id=${clientId}${assistantQuery}`;
            } else if (name === 'max') {
                const assistantId = window.AdminApp?.getActiveAssistantId?.() || '';
                const assistantQuery = assistantId ? `&assistant_id=${encodeURIComponent(assistantId)}` : '';
                endpoint = `/api/chat/max/setup?client_id=${clientId}${assistantQuery}`;
            } else if (name === 'vk') {
                const assistantId = window.AdminApp?.getActiveAssistantId?.() || '';
                const assistantQuery = assistantId ? `&assistant_id=${encodeURIComponent(assistantId)}` : '';
                endpoint = `/api/chat/vk/setup?client_id=${clientId}${assistantQuery}`;
            } else if (name === 'ok') {
                const assistantId = window.AdminApp?.getActiveAssistantId?.() || '';
                const assistantQuery = assistantId ? `&assistant_id=${encodeURIComponent(assistantId)}` : '';
                endpoint = `/api/chat/ok/setup?client_id=${clientId}${assistantQuery}`;
            } else {
                const assistantId = window.AdminApp?.getActiveAssistantId?.() || '';
                const assistantQuery = assistantId ? `&assistant_id=${encodeURIComponent(assistantId)}` : '';
                endpoint = `/api/chat/admin/integrations/${name}?client_id=${clientId}${assistantQuery}`;
            }

            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(data)
                });

                if (!res.ok) {
                    let message = `Ошибка при сохранении ${name}`;
                    try {
                        const errData = await res.json();
                        message = errData.error || errData.detail || message;
                    } catch (_) {
                        try {
                            const raw = await res.text();
                            if (raw) message = raw;
                        } catch (_) {}
                    }
                    throw new Error(message);
                }
            } catch (e) {
                const isNetworkError = e instanceof TypeError;
                const details = isNetworkError
                    ? `Сетевая ошибка при сохранении ${name} (${endpoint}). Проверьте доступность сервера.`
                    : `${name}: ${e.message}`;

                console.error(`[SAVE] Failed for ${name} (${endpoint}):`, e);
                saveErrors.push(details);
            }
        }

        if (saveErrors.length) {
            const message = saveErrors.slice(0, 3).join('\n');
            if (window.showAlert) {
                window.showAlert('tmpl-error-alert', {
                    title: 'Ошибка сохранения',
                    text: message
                });
            } else {
                alert('Ошибка сохранения: ' + message);
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
                    const activeAssistantId = window.AdminApp?.getActiveAssistantId?.() || '';
                    const assistantQuery = activeAssistantId ? `&assistant_id=${encodeURIComponent(activeAssistantId)}` : '';
                    const vRes = await fetch(`/api/chat/widget/verify?client_id=${clientId}${assistantQuery}`, {
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

                const assistantId = window.AdminApp?.getActiveAssistantId?.();
                const assistantQuery = assistantId ? `&assistant_id=${encodeURIComponent(assistantId)}` : '';
                const res = await fetch(`/api/chat/admin/config?client_id=${clientId}${assistantQuery}`, {
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

        this.state.dirtyIntegrations.clear();
        await this.loadData();
    },

};
