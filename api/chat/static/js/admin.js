import { ProfileModule } from './profile.js?v=107';
import { FAQModule } from './modules/faq.js?v=103';
import { AppearanceModule } from './settings.js?v=103';
import { PromptsModule } from './assistant.js?v=103';
import { IntegrationsModule } from './integrations.js?v=103';
import { DialogsModule } from './dialogs/index.js?v=103';
import { StorageModule } from './modules/storage.js?v=103';
import { AnalyticsModule } from './analytics.js?v=120';
import { TariffsModule } from './tariffs.js?v=104';
import { NewsPageModule } from './news.js?v=103';
import { NewsModule } from './modules/news.js?v=103';
import { TransactionsModule } from './modules/transactions.js?v=101';

const SUPERADMIN_VIEW_PARAM = 'superadmin_view';
const SUPERADMIN_VIEW_TOKEN_KEY = 'mitia_superadmin_view_token';
const scopedStorageKeys = new Set(['chatadmin_auth_token', 'chat_client_id']);

function setupSuperadminClientView(params) {
    if (params.get(SUPERADMIN_VIEW_PARAM) !== '1') return Promise.resolve(false);

    const originalGetItem = Storage.prototype.getItem;
    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    const originalClear = Storage.prototype.clear;
    const scopedValues = new Map();
    const clientId = params.get('client_id');
    if (clientId) scopedValues.set('chat_client_id', clientId);

    const applyScopedStorage = () => {
        Storage.prototype.getItem = function(key) {
            if (this === window.localStorage && scopedStorageKeys.has(key)) {
                return scopedValues.has(key) ? scopedValues.get(key) : null;
            }
            return originalGetItem.call(this, key);
        };
        Storage.prototype.setItem = function(key, value) {
            if (this === window.localStorage && scopedStorageKeys.has(key)) {
                scopedValues.set(key, String(value));
                return;
            }
            return originalSetItem.call(this, key, value);
        };
        Storage.prototype.removeItem = function(key) {
            if (this === window.localStorage && scopedStorageKeys.has(key)) {
                scopedValues.delete(key);
                return;
            }
            return originalRemoveItem.call(this, key);
        };
        Storage.prototype.clear = function() {
            if (this === window.localStorage) {
                scopedValues.clear();
                return;
            }
            return originalClear.call(this);
        };
    };

    const storedToken = sessionStorage.getItem(SUPERADMIN_VIEW_TOKEN_KEY);
    if (storedToken) {
        scopedValues.set('chatadmin_auth_token', storedToken);
        applyScopedStorage();
        return Promise.resolve(true);
    }

    return new Promise((resolve) => {
        const receiveToken = (event) => {
            if (event.origin !== window.location.origin || event.source !== window.opener) return;
            if (event.data?.type !== 'mitia-superadmin-view-token' || !event.data.token) return;
            sessionStorage.setItem(SUPERADMIN_VIEW_TOKEN_KEY, event.data.token);
            scopedValues.set('chatadmin_auth_token', event.data.token);
            window.removeEventListener('message', receiveToken);
            applyScopedStorage();
            resolve(true);
        };
        window.addEventListener('message', receiveToken);
        setTimeout(() => {
            window.removeEventListener('message', receiveToken);
            resolve(false);
        }, 6000);
    });
}

function localizeConnectionError(message) {
    const text = String(message || '').trim();
    if (!text) return text;
    if (/failed to fetch|networkerror|network request failed|load failed|network error|connection (?:failed|refused|closed|reset|timeout)|timeout|internal server error/i.test(text)) {
        return 'Не удалось подключиться к серверу. Проверьте интернет-соединение и повторите попытку.';
    }
    return text;
}

function installRussianNetworkErrors() {
    window.MityaI18n = window.MityaI18n || {};
    window.MityaI18n.localizeConnectionError = localizeConnectionError;
    if (window.__mitiaRussianFetchInstalled) return;
    window.__mitiaRussianFetchInstalled = true;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
        try {
            return await nativeFetch(...args);
        } catch (error) {
            if (error instanceof TypeError || error?.name === 'AbortError') {
                throw new Error(localizeConnectionError(error.message) || 'Не удалось подключиться к серверу. Проверьте интернет-соединение и повторите попытку.');
            }
            throw error;
        }
    };
}

const AdminApp = {
    assistantContext: {
        assistantId: null,
        dialogsAssistantFilterApplied: [],
        analyticsAssistantFilterApplied: [],
        assistantsList: [],
        listeners: new Set(),
    },
    modules: {
        profile: ProfileModule,
        faq: FAQModule,
        settings: AppearanceModule,
        assistant: PromptsModule,
        integrations: IntegrationsModule,
        dialogs: DialogsModule,
        storage: StorageModule,
        analytics: AnalyticsModule,
        tariffs: TariffsModule,
        news: NewsPageModule,
        newsShared: NewsModule,
        transactions: TransactionsModule
    },

    async init() {
        console.log('Admin App V2 initializing...');

        window.MityaWidget = window.MityaWidget || {};
        window.MityaWidget.applyTheme = (theme, data) => {
            window.postMessage({ type: 'apply_theme', theme, data }, '*');
        };
        window.MityaWidget.open = () => {
            window.postMessage({ type: 'mitya_open' }, '*');
        };
        window.MityaWidget.showAlert = (text, type, isPreview) => {
            window.postMessage({ type: 'show_alert', text, alert_type: type, is_preview: isPreview }, '*');
        };
        window.MityaWidget.showTestButtons = (show) => {
            window.postMessage({ type: 'show_test_buttons', show }, '*');
        };
        window.MityaWidget.showStopBtnPreview = (show) => {
            window.postMessage({ type: 'show_stop_btn_preview', show }, '*');
        };
        window.MityaWidget.showRecordBtnPreview = (show) => {
            window.postMessage({ type: 'show_record_btn_preview', show }, '*');
        };
        window.MityaWidget.showSendBtnPreview = (show) => {
            window.postMessage({ type: 'show_send_btn_preview', show }, '*');
        };
        window.MityaWidget.closeAlert = () => {
            window.postMessage({ type: 'close_alert' }, '*');
        };

        const params = new URLSearchParams(window.location.search);
        installRussianNetworkErrors();
        const isSuperadminClientView = await setupSuperadminClientView(params);
        if (params.get(SUPERADMIN_VIEW_PARAM) === '1' && !isSuperadminClientView) {
            document.body.innerHTML = '<div class="error-state">Не удалось подтвердить доступ супер-администратора. Вернитесь в суперпанель и откройте админку клиента заново.</div>';
            return;
        }

        const token = localStorage.getItem('chatadmin_auth_token');
        if (!token) {
            window.location.href = '/login';
            return;
        }

        const urlClientId = params.get('client_id');
        if (urlClientId && urlClientId !== 'undefined' && !isSuperadminClientView) {
            localStorage.setItem('chat_client_id', urlClientId);
        }

        this.renderSidebar();
        this.bindNavigation();
        await this.initAssistantContext();
        this.clearAllMyTempFiles();
        
        const pathParts = window.location.pathname.split('/').filter(p => p);
        let initialTab = 'profile';

        if (pathParts.length >= 2) {
            if (pathParts[1] === 'dialogs') {
                initialTab = 'dialogs';
                if (pathParts[2]) {
                    const slug = pathParts[2];
                    const idMarkers = ['-tg-', '-avito-', '-ct-'];
                    let foundId = null;
                    
                    for (const marker of idMarkers) {
                        const idx = slug.indexOf(marker);
                        if (idx !== -1) {
                            foundId = slug.substring(idx + 1);
                            break;
                        }
                    }
                    
                    if (!foundId) {
                        const emailIdx = slug.indexOf('email_');
                        if (emailIdx !== -1) {
                            foundId = slug.substring(emailIdx);
                        }
                    }
                    
                    window.deepSessionId = foundId || slug;
                }
            } else {
                initialTab = pathParts[1];
            }
        }
        
        this.syncSidebarState(initialTab);
        
        await this.loadModule(initialTab);

        this.startNotificationCheck();

        this.hidePreloader();

        window.addEventListener('message', (e) => {
            console.log('!!! MESSAGE RECEIVED IN ADMIN.JS !!!', e.data);
            if (e.data && e.data.type && (
                e.data.type.startsWith('apply_theme') || 
                e.data.type === 'trigger_save_from_bot' ||
                e.data.type === 'mitya_hide_attach_preview' ||
                e.data.type === 'mitya_hide_image_preview' ||
                e.data.type === 'mitya_hide_welcome_preview' ||
                e.data.type === 'show_test_buttons' ||
                e.data.type === 'show_stop_btn_preview' ||
                e.data.type === 'show_record_btn_preview' ||
                e.data.type === 'show_send_btn_preview'
            )) {
                console.log('[Admin] Forwarding message to active module:', e.data);
                if (this.modules.settings && this.modules.settings.handleBotMessage) {
                    this.modules.settings.handleBotMessage(e.data);
                }
                if (this.modules.profile && this.modules.profile.handleBotMessage) {
                    this.modules.profile.handleBotMessage(e.data);
                }
            }
        });
    },

    showPreloader(container = null) {
        const preloader = document.getElementById('app-preloader');
        if (preloader) {
            if (container) {
                preloader.classList.add('local');
                container.appendChild(preloader);
            } else {
                preloader.classList.remove('local');
                document.body.appendChild(preloader);
            }
            
            preloader.style.transition = 'none';
            preloader.style.visibility = 'visible';
            preloader.style.opacity = '1';
            preloader.offsetHeight;
            preloader.style.transition = 'opacity 0.3s ease';
        }
    },

    hidePreloader() {
        const preloader = document.getElementById('app-preloader');
        if (preloader) {
            preloader.style.opacity = '0';
            setTimeout(() => {
                preloader.style.visibility = 'hidden';
                if (preloader.parentNode !== document.body) {
                    document.body.appendChild(preloader);
                }
            }, 300);
        }
    },

    startNotificationCheck() {
        this.checkNotifications();
        setInterval(() => this.checkNotifications(), 10000);
    },

    async checkNotifications() {
        try {
            const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
            const token = localStorage.getItem('chatadmin_auth_token');
            if (!token) return;

            const res = await fetch(`/api/chat/admin/sessions?client_id=${clientId}&limit=10`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                const sessions = await res.json();
                const hasUnread = sessions.some(s => !s.is_read);
                
                const dialogsTab = document.querySelector('.nav-item[data-tab="dialogs"]');
                if (dialogsTab) {
                    if (hasUnread) {
                        dialogsTab.classList.add('active-notify');
                    } else {
                        dialogsTab.classList.remove('active-notify');
                    }
                }
            }
        } catch (e) {
            console.warn('Notification check failed', e);
        }
    },

    renderSidebar() {
        const sidebarRoot = document.getElementById('sidebar-root');
        const template = document.getElementById('tmpl-sidebar');
        if (sidebarRoot && template) {
            sidebarRoot.innerHTML = template.innerHTML;
        }
    },

    async initAssistantContext() {
        const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
        const token = localStorage.getItem('chatadmin_auth_token');
        if (!token) return;
        try {
            const res = await fetch(`/api/chat/admin/assistants/active?client_id=${encodeURIComponent(clientId)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data && data.assistant_id) {
                this.assistantContext.assistantId = data.assistant_id;
                localStorage.setItem(`chat_active_assistant_id:${clientId}`, data.assistant_id);
            }
        } catch (_) {
            const cached = localStorage.getItem(`chat_active_assistant_id:${clientId}`);
            if (cached) this.assistantContext.assistantId = cached;
        }
    },

    getActiveAssistantId() {
        const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
        return this.assistantContext.assistantId || localStorage.getItem(`chat_active_assistant_id:${clientId}`) || null;
    },

    async setActiveAssistantId(assistantId, { silent = false, persist = true } = {}) {
        const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
        const token = localStorage.getItem('chatadmin_auth_token');
        this.assistantContext.assistantId = assistantId || null;
        if (assistantId) localStorage.setItem(`chat_active_assistant_id:${clientId}`, assistantId);
        else localStorage.removeItem(`chat_active_assistant_id:${clientId}`);
        if (persist && token && assistantId) {
            try {
                await fetch('/api/chat/admin/assistants/active', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ client_id: clientId, assistant_id: assistantId })
                });
            } catch (_) {}
        }
        if (!silent) {
            this.assistantContext.listeners.forEach((listener) => {
                try { listener(assistantId); } catch (_) {}
            });
        }
    },

    onAssistantChange(listener) {
        if (typeof listener !== 'function') return () => {};
        this.assistantContext.listeners.add(listener);
        return () => this.assistantContext.listeners.delete(listener);
    },

    getDialogsAssistantFilter() {
        return Array.isArray(this.assistantContext.dialogsAssistantFilterApplied)
            ? [...this.assistantContext.dialogsAssistantFilterApplied]
            : [];
    },

    setDialogsAssistantFilter(value) {
        this.assistantContext.dialogsAssistantFilterApplied = Array.isArray(value) ? [...value] : [];
    },

    getAnalyticsAssistantFilter() {
        return Array.isArray(this.assistantContext.analyticsAssistantFilterApplied)
            ? [...this.assistantContext.analyticsAssistantFilterApplied]
            : [];
    },

    setAnalyticsAssistantFilter(value) {
        this.assistantContext.analyticsAssistantFilterApplied = Array.isArray(value) ? [...value] : [];
    },

    getAssistantsList() {
        return Array.isArray(this.assistantContext.assistantsList) ? this.assistantContext.assistantsList : [];
    },

    setAssistantsList(items) {
        this.assistantContext.assistantsList = Array.isArray(items) ? items : [];
    },

    setSidebarMode(mode = null) {
        const sidebar = document.querySelector('.admin-sidebar');
        if (!sidebar) return;
        sidebar.classList.remove('storage-mode', 'analytics-mode', 'dialog-mode', 'assistants-mode', 'integrations-mode', 'news-mode', 'tariffs-mode', 'transactions-mode');
        if (mode) {
            sidebar.classList.add(`${mode}-mode`);
        }
    },

    syncSidebarState(tab) {
        this.setSidebarMode(tab === 'storage' ? 'storage' : (tab === 'tariffs' ? 'tariffs' : (tab === 'news' ? 'news' : (tab === 'transactions' ? 'transactions' : null))));

        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        if (tab === 'tariffs') return;
        if (tab === 'transactions') {
            const txBtn = document.getElementById('transactions-sidebar-active-btn');
            if (txBtn) txBtn.classList.add('active');
            return;
        }
        const item = document.querySelector(`.nav-item[data-tab="${tab}"]`);
        if (item) item.classList.add('active');
    },

    async navigateToTab(tab) {
        if (!tab || tab === 'logout') return;

        const newPath = tab === 'profile' ? '/admin' : `/admin/${tab}`;
        this.syncSidebarState(tab);

        if (window.location.pathname !== newPath) {
            history.pushState({ tab }, '', newPath);
        }

        await this.loadModule(tab);
    },

    async handleSidebarSave(buttons = []) {
        if (this._sidebarSaveInProgress) return;

        let currentTab = null;
        if (document.querySelector('.admin-sidebar.tariffs-mode')) {
            currentTab = 'tariffs';
        } else if (document.querySelector('.admin-sidebar.transactions-mode')) {
            currentTab = 'transactions';
        } else if (document.querySelector('.admin-sidebar.news-mode')) {
            currentTab = 'news';
        } else if (document.querySelector('.admin-sidebar.dialog-mode')) {
            currentTab = 'dialogs';
        } else {
            const activeNavItem = document.querySelector('.nav-item.active');
            currentTab = activeNavItem?.dataset.tab || null;
        }

        if (!currentTab) return;
        const module = this.modules[currentTab];
        if (!module || typeof module.saveData !== 'function') return;

        const DISKETTE_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v13a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`;
        const SUCCESS_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        const SPINNER_SVG = `<span class="save-spinner" aria-hidden="true"></span>`;
        const targets = buttons.filter(Boolean);
        if (!targets.length) return;

        this._sidebarSaveInProgress = true;
        targets.forEach((btn) => {
            btn.disabled = true;
            btn.classList.remove('save-success');
            btn.classList.add('save-loading');
            btn.innerHTML = SPINNER_SVG;
        });

        try {
            await module.saveData();
        } catch (err) {
            console.error('Save failed:', err);
            targets.forEach((btn) => {
                btn.disabled = false;
                btn.classList.remove('save-loading', 'save-success');
                btn.innerHTML = DISKETTE_SVG;
            });
            this._sidebarSaveInProgress = false;
            return;
        }

        targets.forEach((btn) => {
            btn.classList.remove('save-loading');
            btn.classList.add('save-success');
            btn.innerHTML = SUCCESS_SVG;
        });

        setTimeout(() => {
            targets.forEach((btn) => {
                btn.disabled = false;
                btn.classList.remove('save-loading', 'save-success');
                btn.innerHTML = DISKETTE_SVG;
            });
            this._sidebarSaveInProgress = false;
        }, 1500);
    },

    bindNavigation() {
        const saveBtn = document.getElementById('global-save-btn');
        const integrationsSaveBtn = document.getElementById('integrations-sidebar-save-btn');
        const dialogSaveBtn = document.getElementById('dialog-sidebar-save-btn');
        const newsReadBtn = document.getElementById('news-sidebar-read-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const buttons = [saveBtn];
                if (window.location.pathname === '/admin/integrations' && integrationsSaveBtn) {
                    buttons.push(integrationsSaveBtn);
                }
                if (document.querySelector('.admin-sidebar.dialog-mode') && dialogSaveBtn) {
                    buttons.push(dialogSaveBtn);
                }
                await this.handleSidebarSave(buttons);
            });
        }

        const integrationsBackBtn = document.getElementById('integrations-sidebar-back-btn');
        if (integrationsBackBtn) {
            integrationsBackBtn.addEventListener('click', async () => {
                await this.navigateToTab('profile');
            });
        }
        if (integrationsSaveBtn) {
            integrationsSaveBtn.addEventListener('click', async () => {
                const buttons = [integrationsSaveBtn];
                if (saveBtn) buttons.push(saveBtn);
                await this.handleSidebarSave(buttons);
            });
        }

        const dialogBackBtn = document.getElementById('dialog-sidebar-back-btn');
        if (dialogBackBtn) {
            dialogBackBtn.addEventListener('click', () => {
                if (window.handleDialogBack) {
                    window.handleDialogBack();
                } else {
                    window.closeActiveDialog?.();
                }
            });
        }
        if (dialogSaveBtn) {
            dialogSaveBtn.addEventListener('click', async () => {
                const buttons = [dialogSaveBtn];
                if (saveBtn) buttons.push(saveBtn);
                await this.handleSidebarSave(buttons);
            });
        }

        const storageBackBtn = document.getElementById('storage-sidebar-back-btn');
        if (storageBackBtn) {
            storageBackBtn.addEventListener('click', async () => {
                await this.navigateToTab('profile');
            });
        }

        const tariffsBackBtn = document.getElementById('tariffs-sidebar-back-btn');
        if (tariffsBackBtn) {
            tariffsBackBtn.addEventListener('click', async () => {
                await this.navigateToTab('profile');
            });
        }

        const newsBackBtn = document.getElementById('news-sidebar-back-btn');
        if (newsBackBtn) {
            newsBackBtn.addEventListener('click', async () => {
                await this.navigateToTab('profile');
            });
        }

        const txBackBtn = document.getElementById('transactions-sidebar-back-btn');
        if (txBackBtn) {
            txBackBtn.addEventListener('click', async () => {
                await this.navigateToTab('profile');
            });
        }
        if (newsReadBtn) {
            newsReadBtn.addEventListener('click', async () => {
                const module = this.modules.news;
                if (module && typeof module.markAllAsRead === 'function') {
                    await module.markAllAsRead();
                }
            });
        }

        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                const action = e.currentTarget.dataset.action;
                if (action === 'open-assistants-panel') {
                    e.preventDefault();
                    if (window.location.pathname !== '/admin') {
                        await this.navigateToTab('profile');
                    }
                    return;
                }

                const tab = e.currentTarget.dataset.tab;
                if (tab === 'logout' || !tab) return;

                const newPath = tab === 'profile' ? '/admin' : `/admin/${tab}`;
                if (window.location.pathname !== newPath) {
                    await this.navigateToTab(tab);
                }
            });
        });

        window.addEventListener('popstate', () => {
            const pathParts = window.location.pathname.split('/');
            const tab = pathParts[pathParts.length - 1] === 'admin' ? 'profile' : pathParts[pathParts.length - 1];
            
            if (tab) {
                this.syncSidebarState(tab);
                this.loadModule(tab).catch(() => {});
            }
        });
    },

    updateMetaForModule(moduleName) {
        const metaByModule = {
            profile: {
                title: 'Профиль — MITIA AI',
                description: 'Профиль клиента, тарифы, баланс и персональная аналитика в MITIA AI.',
                keywords: 'MITIA, профиль, тариф, баланс, аналитика'
            },
            assistant: {
                title: 'Интеллект — MITIA AI',
                description: 'Настройки интеллекта, базы знаний и регламентов ассистента MITIA AI.',
                keywords: 'MITIA, интеллект, база знаний, промпт, ассистент'
            },
            integrations: {
                title: 'Интеграции — MITIA AI',
                description: 'Подключение Telegram, VK, Email и других каналов в MITIA AI.',
                keywords: 'MITIA, интеграции, telegram, vk, email, avito'
            },
            settings: {
                title: 'Внешний вид — MITIA AI',
                description: 'Гибкая настройка внешнего вида и поведения виджета MITIA AI.',
                keywords: 'MITIA, внешний вид, тема, дизайн, виджет'
            },
            dialogs: {
                title: 'Диалоги — MITIA AI',
                description: 'Управление диалогами, фильтрами и статусами обращений в MITIA AI.',
                keywords: 'MITIA, диалоги, чаты, лиды, заявки'
            },
            storage: {
                title: 'Хранилище — MITIA AI',
                description: 'Файлы, медиа и управление хранилищем клиента в MITIA AI.',
                keywords: 'MITIA, хранилище, файлы, медиа'
            },
            transactions: {
                title: 'История операций — MITIA AI',
                description: 'История пополнения баланса и операций в MITIA AI.',
                keywords: 'MITIA, история, операции, пополнения'
            },
            analytics: {
                title: 'Аналитика — MITIA AI',
                description: 'Аналитика обращений, каналов и конверсии в формате независимых колонок MITIA AI.',
                keywords: 'MITIA, аналитика, отчеты, конверсия, каналы'
            }
        };

        const current = metaByModule[moduleName] || {
            title: 'Панель управления — MITIA AI',
            description: 'Панель управления вашими ИИ-ассистентами MITIA.',
            keywords: 'MITIA, админ-панель'
        };

        document.title = current.title;

        const setMeta = (selector, content) => {
            const el = document.querySelector(selector);
            if (el) el.setAttribute('content', content);
        };

        setMeta('meta[name="description"]', current.description);
        setMeta('meta[name="keywords"]', current.keywords);
        setMeta('meta[property="og:title"]', current.title);
        setMeta('meta[property="og:description"]', current.description);
        setMeta('meta[property="twitter:title"]', current.title);
        setMeta('meta[property="twitter:description"]', current.description);

        const canonical = document.querySelector('link[rel="canonical"]');
        if (canonical) {
            const canonicalPath = moduleName === 'profile' ? '/admin' : `/admin/${moduleName}`;
            canonical.setAttribute('href', `https://mitia.pro${canonicalPath}`);
        }
    },

    async loadModule(moduleName) {
        const appContainer = document.getElementById('app');
        if (!appContainer) return;

        this.showPreloader();
        
        appContainer.style.visibility = 'hidden';
        appContainer.innerHTML = '';

        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 100)));

        try {
            const response = await fetch(`/admin/${moduleName}?ajax=1`, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            if (!response.ok) throw new Error(`Module ${moduleName} not found`);
            
            const html = await response.text();
            appContainer.innerHTML = html;
            this.updateMetaForModule(moduleName);

            if (this._currentModule && this._currentModule !== moduleName) {
                const prev = this.modules[this._currentModule];
                if (prev && prev.destroy) prev.destroy();
            }
            this._currentModule = moduleName;

            // Сбрасываем dialog-mode при уходе с карточки диалога / смене раздела
            if (moduleName !== 'dialogs' && document.querySelector('.admin-sidebar.dialog-mode')) {
                this.setSidebarMode(
                    moduleName === 'storage' ? 'storage'
                    : moduleName === 'tariffs' ? 'tariffs'
                    : moduleName === 'news' ? 'news'
                    : moduleName === 'transactions' ? 'transactions'
                    : null
                );
            }

            if (this.modules[moduleName]) {
                await this.modules[moduleName].init();
            }

            if (window.MityaWidget && window.MityaWidget.applyTheme) {
                const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
                const token = localStorage.getItem('chatadmin_auth_token');
                if (token) {
                    fetch(`/api/chat/admin/config?client_id=${clientId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    })
                    .then(res => res.json())
                    .then(data => {
                        if (data.status === 'success' && data.config) {
                            window.MityaWidget.applyTheme(data.config.theme, { 
                                bot_settings: data.config.bot_settings,
                                welcome_msg: data.config.welcome_msg,
                                force_position: true
                            });
                        }
                    })
                    .catch(err => console.warn('Widget sync skipped:', err));
                }
            }

            console.log(`Module ${moduleName} loaded`);
        } catch (error) {
            console.error(`Error loading module ${moduleName}:`, error);
            appContainer.innerHTML = `<div class="error-state">Ошибка загрузки модуля ${moduleName}</div>`;
        } finally {
            appContainer.style.visibility = 'visible';
            this.hidePreloader();
        }
    },

    showAlert(templateId, data = {}) {
        const template = document.getElementById(templateId);
        if (!template) return;
        const clone = document.importNode(template.content, true);
        const overlay = clone.querySelector('.custom-alert-overlay');
        if (data.title) overlay.querySelector('.alert-title').textContent = data.title;
        if (data.text) overlay.querySelector('.alert-text').textContent = localizeConnectionError(data.text);
        document.body.appendChild(overlay);
        
        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
        });

        document.body.style.overflow = 'hidden';
        const close = () => { overlay.style.opacity = '0'; document.body.style.overflow = ''; setTimeout(() => overlay.remove(), 300); };
        const closeBtn = overlay.querySelector('.alert-btn-primary') || overlay.querySelector('.alert-btn-secondary');
        if (closeBtn) closeBtn.onclick = close;
        overlay.onclick = (e) => { if(e.target === overlay) close(); };
        return overlay;
    },

    handleLogout() {
        const overlay = this.showAlert('tmpl-confirm-alert', { 
            title: 'Выйти из аккаунта?', 
            text: 'Вы уверены, что хотите завершить текущую сессию?' 
        });
        if (!overlay) return;

        const confirmBtn = overlay.querySelector('#confirm-yes');
        const cancelBtn = overlay.querySelector('#confirm-cancel');
        
        confirmBtn.textContent = 'Выйти';
        confirmBtn.classList.remove('warning-bg');
        confirmBtn.style.backgroundColor = 'var(--brand)';
        confirmBtn.style.color = 'white';

        const close = () => {
            overlay.style.opacity = '0';
            document.body.style.overflow = '';
            setTimeout(() => overlay.remove(), 300);
        };

        cancelBtn.onclick = close;
        confirmBtn.onclick = () => {
            localStorage.removeItem('chatadmin_auth_token');
            localStorage.removeItem('chat_client_id');
            localStorage.removeItem('chat_user_email');

            try {
                Object.keys(localStorage).forEach((key) => {
                    if (key.startsWith('profile_storage_ui_state_v1:')) localStorage.removeItem(key);
                    if (key.startsWith('profile_assistants_ui_state_v1:')) localStorage.removeItem(key);
                });
            } catch (_) {}

            if (window.location.pathname !== '/admin') {
                history.replaceState({ tab: 'profile' }, '', '/admin');
            }
            window.location.href = '/login';
        };
    },

    async clearAllMyTempFiles() {
        const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
        const token = localStorage.getItem('chatadmin_auth_token');
        if (!token) return;

        const allFields = [
            'knowledge_file',
            'widget_img', 'msg_bot_avatar', 'msg_user_avatar', 'msg_operator_avatar',
            'profile_avatar', 'window_bg_img', 'header_logo', 'welcome_img',
            'inline_btn_accent_img', 'inline_btn_neutral_img', 'inline_btn_info_img'
        ];

        console.log('[Admin] Global temp cleanup started...');
        for (const field of allFields) {
            fetch(`/api/chat/admin/delete-temp-file?client_id=${clientId}&field_id=${field}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            }).catch(() => {});
        }
    }
};

window.AdminApp = AdminApp;
window.logout = () => AdminApp.handleLogout();
window.showAlert = (id, data) => AdminApp.showAlert(id, data);

document.addEventListener('DOMContentLoaded', () => {
    AdminApp.init();
});
