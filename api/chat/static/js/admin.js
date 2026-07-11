/**
 * Основной контроллер админки
 */
import { ProfileModule } from './profile.js';
import { FAQModule } from './modules/faq.js';
import { AppearanceModule } from './settings.js';
import { PromptsModule } from './assistant.js';
import { IntegrationsModule } from './integrations.js';
import { DialogsModule } from './dialogs/index.js';
import { StorageModule } from './modules/storage.js';
import { AnalyticsModule } from './analytics.js';

const AdminApp = {
    modules: {
        profile: ProfileModule,
        faq: FAQModule,
        settings: AppearanceModule,
        assistant: PromptsModule,
        integrations: IntegrationsModule,
        dialogs: DialogsModule,
        storage: StorageModule,
        analytics: AnalyticsModule
    },

    async init() {
        console.log('Admin App V2 initializing...');
        
        // Глобальная очистка временных файлов при входе в админку
        this.clearAllMyTempFiles();

        // Инициализация пульта управления виджетом (ДО загрузки модулей)
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

        // ПРОВЕРКА АВТОРИЗАЦИИ
        const token = localStorage.getItem('chatadmin_auth_token');
        if (!token) {
            window.location.href = '/login';
            return;
        }

        // Синхронизируем client_id из URL сразу при входе в админку,
        // чтобы модули не успели взять устаревшее значение из localStorage.
        const urlClientId = new URLSearchParams(window.location.search).get('client_id');
        if (urlClientId && urlClientId !== 'undefined') {
            localStorage.setItem('chat_client_id', urlClientId);
        }

        this.renderSidebar();
        this.bindNavigation();
        
        // Определяем вкладку из URL пути или ставим profile по умолчанию
        const pathParts = window.location.pathname.split('/').filter(p => p);
        let initialTab = 'profile';

        if (pathParts.length >= 2) {
            if (pathParts[1] === 'dialogs') {
                initialTab = 'dialogs';
                if (pathParts[2]) {
                    // Извлекаем sessionId из slug (например, ivan-ivanov-tg-bot-123)
                    const slug = pathParts[2];
                    const idMarkers = ['-tg-', '-avito-', '-ct-'];
                    let foundId = null;
                    
                    for (const marker of idMarkers) {
                        const idx = slug.indexOf(marker);
                        if (idx !== -1) {
                            foundId = slug.substring(idx + 1); // +1 чтобы убрать начальный дефис
                            break;
                        }
                    }
                    
                    // Для email-сессий (начинаются с email_)
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
        
        // Подсвечиваем активный пункт в сайдбаре
        const activeItem = document.querySelector(`.nav-item[data-tab="${initialTab}"]`);
        if (activeItem) activeItem.classList.add('active');
        
        await this.loadModule(initialTab);

        // Запускаем фоновую проверку уведомлений
        this.startNotificationCheck();

        // Скрываем прелоадер после полной инициализации
        this.hidePreloader();

        // СУПЕРСИЛА: Слушаем сообщения от виджета и пересылаем их в активный модуль
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
                // Пересылаем сообщение всем модулям (они сами решат, что с ним делать)
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
                // Возвращаем в body, чтобы не потерять при удалении контейнера
                if (preloader.parentNode !== document.body) {
                    document.body.appendChild(preloader);
                }
            }, 300);
        }
    },

    startNotificationCheck() {
        // Проверяем каждые 10 секунд
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

    bindNavigation() {
        // Глобальная кнопка сохранения в сайдбаре
        const saveBtn = document.getElementById('global-save-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const activeNavItem = document.querySelector('.nav-item.active');
                if (!activeNavItem) return;
                
                const currentTab = activeNavItem.dataset.tab;
                if (this.modules[currentTab] && typeof this.modules[currentTab].saveData === 'function') {
                    const originalHTML = saveBtn.innerHTML;
                    saveBtn.classList.add('save-success');
                    saveBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                    
                    try {
                        await this.modules[currentTab].saveData();
                    } catch (err) {
                        console.error('Save failed:', err);
                        saveBtn.classList.remove('save-success');
                        saveBtn.innerHTML = originalHTML;
                        return;
                    }
                    
                    setTimeout(() => {
                        saveBtn.classList.remove('save-success');
                        saveBtn.innerHTML = originalHTML;
                    }, 1500);
                }
            });
        }

        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                const tab = e.currentTarget.dataset.tab;
                if (tab === 'logout' || !tab) return; 
                
                // Обновляем URL без перезагрузки
                const newPath = tab === 'profile' ? '/admin' : `/admin/${tab}`;
                if (window.location.pathname !== newPath) {
                    history.pushState({ tab }, '', newPath);

                    // Убираем активный класс у всех
                    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
                    // Добавляем текущему
                    e.currentTarget.classList.add('active');
                    
                    await this.loadModule(tab);
                }
            });
        });

        // Слушаем кнопки назад/вперед в браузере
        window.addEventListener('popstate', () => {
            const pathParts = window.location.pathname.split('/');
            const tab = pathParts[pathParts.length - 1] === 'admin' ? 'profile' : pathParts[pathParts.length - 1];
            
            if (tab) {
                document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
                const item = document.querySelector(`.nav-item[data-tab="${tab}"]`);
                if (item) item.classList.add('active');
                this.loadModule(tab);
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

        // 1. Мгновенно показываем прелоадер
        this.showPreloader();
        
        // 2. Сразу очищаем контент, чтобы его не было видно
        appContainer.style.visibility = 'hidden';
        appContainer.innerHTML = '';

        // 3. Даем браузеру время на отрисовку прелоадера
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 100)));

        try {
            // 4. Загружаем HTML модуля из папки templates (через роуты FastAPI)
            const response = await fetch(`/admin/${moduleName}?ajax=1`, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            if (!response.ok) throw new Error(`Module ${moduleName} not found`);
            
            const html = await response.text();
            appContainer.innerHTML = html;
            this.updateMetaForModule(moduleName);

            // 5. Останавливаем предыдущий модуль
            if (this._currentModule && this._currentModule !== moduleName) {
                const prev = this.modules[this._currentModule];
                if (prev && prev.destroy) prev.destroy();
            }
            this._currentModule = moduleName;

            // 6. Инициализируем JS модуля
            if (this.modules[moduleName]) {
                await this.modules[moduleName].init();
            }

            // 6. Синхронизируем виджет с актуальными настройками из БД
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
                            // Принудительно применяем тему, чтобы сбросить закэшированные позиции перетаскивания
                            window.MityaWidget.applyTheme(data.config.theme, { 
                                bot_settings: data.config.bot_settings,
                                force_position: true // Флаг для виджета, чтобы он встал по координатам из темы
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
            // 6. Делаем контент видимым и плавно скрываем прелоадер
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
        if (data.text) overlay.querySelector('.alert-text').textContent = data.text;
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
            window.location.href = '/login';
        };
    },

    async clearAllMyTempFiles() {
        const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
        const token = localStorage.getItem('chatadmin_auth_token');
        if (!token) return;

        // Список всех возможных полей
        const allFields = [
            'knowledge_file',
            'widget_img', 'msg_bot_avatar', 'msg_user_avatar', 'msg_operator_avatar',
            'profile_avatar', 'window_bg_img', 'header_logo', 'welcome_img',
            'inline_btn_accent_img', 'inline_btn_neutral_img', 'inline_btn_info_img'
        ];

        console.log('[Admin] Global temp cleanup started...');
        for (const field of allFields) {
            // Теперь передаем только field_id, бэкенд сам знает где искать в temp
            fetch(`/api/chat/admin/delete-temp-file?client_id=${clientId}&field_id=${field}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            }).catch(() => {});
        }
    }
};

// Глобальные функции
window.AdminApp = AdminApp;
window.logout = () => AdminApp.handleLogout();
window.showAlert = (id, data) => AdminApp.showAlert(id, data);

// Запуск при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    AdminApp.init();
});
