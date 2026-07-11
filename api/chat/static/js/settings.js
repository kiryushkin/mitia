import { FontManager } from './modules/font-manager.js';
import { MagicDesignModule } from './magic-design.js';
import { PromptsModule } from './assistant.js';
import { initWidgetSettings } from './modules/widget-settings.js';
import { initWelcomeSettings } from './modules/welcome-settings.js';
import { initWindowSettings } from './modules/window-settings.js';
import { initMessagesSettings } from './modules/messages-settings.js';
import { initHeaderSettings } from './modules/header-settings.js';
import { initFooterSettings } from './modules/footer-settings.js';
import { initInlineButtonsSettings } from './modules/inline-buttons-settings.js';
import { initMediaSettings } from './modules/media-settings.js';
import { initAlertSettings } from './modules/alert-settings.js';
import { initVoiceSettings } from './modules/voice-settings.js';

let GOLDEN_STANDARD = {};

async function loadGoldenStandard() {
    try {
        const res = await fetch('/api/chat/theme-defaults');
        const data = await res.json();
        GOLDEN_STANDARD = data;
        return data;
    } catch (e) {
        return null;
    }
}

window.getCollapsedCardsStorageKey = function() {
    const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
    return `collapsed_cards:${clientId}`;
};

window.toggleCardCollapse = function(headerEl) {
    const card = headerEl.closest('.bento-card');
    if (card) {
        card.classList.toggle('collapsed');

        const cardId = card.id;
        const isCollapsed = card.classList.contains('collapsed');
        const storageKey = window.getCollapsedCardsStorageKey
            ? window.getCollapsedCardsStorageKey()
            : 'collapsed_cards';
        const collapsedCards = JSON.parse(localStorage.getItem(storageKey) || '{}');
        collapsedCards[cardId] = isCollapsed;
        localStorage.setItem(storageKey, JSON.stringify(collapsedCards));
    }
};

window.initCardsCollapse = function() {
    const storageKey = window.getCollapsedCardsStorageKey
        ? window.getCollapsedCardsStorageKey()
        : 'collapsed_cards';

    let raw = localStorage.getItem(storageKey);
    if (!raw) {
        const legacyRaw = localStorage.getItem('collapsed_cards');
        if (legacyRaw) {
            raw = legacyRaw;
            localStorage.setItem(storageKey, legacyRaw);
        }
    }

    const collapsedCards = JSON.parse(raw || '{}');
    Object.entries(collapsedCards).forEach(([cardId, isCollapsed]) => {
        const card = document.getElementById(cardId);
        if (card) {
            if (isCollapsed) {
                card.classList.add('collapsed');
            } else {
                card.classList.remove('collapsed');
            }
        }
    });
};

export const AppearanceModule = {
    state: {
        theme: {},
        bot_settings: {
            tts_voice: 'Nec_24000',
            enable_tts: false
        },
        contacts: {},
        legal: {},
        legal_data: {},
        ui_settings: {},
        notifications: {},
        allowed_origins: [],
        snapshot: {}
    },

    getFilteredDefaults(prefix) {
        const filtered = {};
        Object.keys(GOLDEN_STANDARD).forEach(key => {
            if (key.startsWith(prefix)) {
                filtered[key] = GOLDEN_STANDARD[key];
            }
        });
        return filtered;
    },

    async init() {
        await loadGoldenStandard();
        
        this.clearAllMyTempFiles();

        this.state.theme = { ...GOLDEN_STANDARD };

        const modules = [
            { name: 'Widget', init: initWidgetSettings },
            { name: 'Welcome', init: initWelcomeSettings },
            { name: 'Window', init: initWindowSettings },
            { name: 'Messages', init: initMessagesSettings },
            { name: 'Header', init: initHeaderSettings },
            { name: 'Footer', init: initFooterSettings },
            { name: 'InlineButtons', init: initInlineButtonsSettings },
            { name: 'Media', init: initMediaSettings },
            { name: 'Alert', init: initAlertSettings },
            { name: 'Voice', init: initVoiceSettings }
        ];

        modules.forEach(m => {
            try {
                if (typeof m.init === 'function') {
                    m.init(this);
                }
            } catch (e) {
                console.error(`[Appearance] Error initializing module ${m.name}:`, e);
            }
        });

        this.fillForm({ theme: this.state.theme });

        this.bindEvents();
        
        await this.loadData();
        
        setTimeout(() => {
            this.syncWithWidget({ force_position: true });
            console.log('[Appearance] Lazy widget sync completed');
        }, 500);

        if (window.initCardsCollapse) {
            window.initCardsCollapse();
        }
        
        if (typeof this.initWelcomeUI === 'function') {
            this.initWelcomeUI(this.state);
        }

        if (typeof this.initWindowUI === 'function') {
            this.initWindowUI(this.state);
        }

        if (typeof this.initMessagesUI === 'function') {
            this.initMessagesUI(this.state);
        }

        if (typeof this.initHeaderUI === 'function') {
            this.initHeaderUI(this.state);
        }

        window.MagicDesignModule = MagicDesignModule;
        window.PromptsModule = PromptsModule;

        window.addEventListener('message', (e) => {
            if (e.data.type === 'mitya_hide_attach_preview' || e.data.type === 'mitya_hide_image_preview') {
                this.handleBotMessage(e.data);
                return;
            }
            if (e.data.type === 'show_test_buttons') {
                const iframe = document.getElementById('widget-preview-iframe');
                if (iframe && iframe.contentWindow) {
                    iframe.contentWindow.postMessage(e.data, '*');
                }
                return;
            }
            if (e.data.type === 'trigger_reset_all') {                this.resetAllToDefault();
                return;
            }
            if (e.data.type === 'trigger_magic_design') {
                MagicDesignModule.applyMagicDesign(this);
                return;
            }
            if (e.data.type === 'mitya_update_position') {
                let changed = this.handleWidgetBotMessage ? this.handleWidgetBotMessage(e.data) : false;
                if (!changed && this.handleWindowBotMessage) {
                    changed = this.handleWindowBotMessage(e.data);
                }
            }
            if (e.data.type === 'apply_theme_from_bot') {
                if (e.data.theme) {
                    this.state.theme = { ...this.state.theme, ...e.data.theme };
                }
                if (e.data.bot_settings) {
                    this.state.bot_settings = { ...this.state.bot_settings, ...e.data.bot_settings };
                }
                this.fillForm(this.state);
                this.syncWithWidget({ force_position: true });
                return;
            }
            if (e.data.type === 'trigger_save_from_bot') {
                this.saveData();
            }
        });

        this.bindStorageDeleteSync();
    },

    handleBotMessage(data) {
        if (this.handleMediaBotMessage) this.handleMediaBotMessage(data);
        if (this.handleWidgetBotMessage) this.handleWidgetBotMessage(data);
        if (this.handleWelcomeBotMessage) this.handleWelcomeBotMessage(data);
        
        if (data.type === 'apply_theme_from_bot') {
            if (data.theme) {
                this.state.theme = { ...this.state.theme, ...data.theme };
                this.fillForm({ theme: this.state.theme });
            }
            if (data.bot_settings) {
                this.state.bot_settings = { ...this.state.bot_settings, ...data.bot_settings };
                this.fillForm({ bot_settings: this.state.bot_settings });
            }
        }
        if (data.type === 'trigger_save_from_bot') {
            this.saveData();
        }
    },

    normalizeFileUrl(url) {
        if (!url) return '';
        const asString = String(url).trim();
        if (!asString) return '';

        try {
            const parsed = new URL(asString, window.location.origin);
            return parsed.pathname;
        } catch (_) {
            return asString.split('?')[0].split('#')[0];
        }
    },

    getFileBasename(url) {
        const normalized = this.normalizeFileUrl(url);
        if (!normalized) return '';
        const parts = normalized.split('/').filter(Boolean);
        return parts.length ? parts[parts.length - 1] : '';
    },

    bindStorageDeleteSync() {
        if (this._storageDeleteSyncBound) return;

        const imageFieldMappings = [
            { key: 'widget_img', previewId: 'widget-img-preview' },
            { key: 'header_logo', previewId: 'header-logo-preview' },
            { key: 'window_bg_img', previewId: 'chat-window-img-preview' },
            { key: 'chat_window_bg_img', previewId: 'chat-window-img-preview' },
            { key: 'welcome_img', previewId: 'welcome-img-preview' },
            { key: 'msg_bot_avatar', previewId: 'msg-bot-avatar-preview' },
            { key: 'msg_user_avatar', previewId: 'msg-user-avatar-preview' },
            { key: 'msg_operator_avatar', previewId: 'msg-operator-avatar-preview' },
            { key: 'bot_avatar', previewId: 'bot-avatar-preview' },
            { key: 'user_avatar', previewId: 'user-avatar-preview' },
            { key: 'operator_avatar', previewId: 'operator-avatar-preview' },
            { key: 'profile_avatar', previewId: null },
            { key: 'inline_btn_accent_img', previewId: null },
            { key: 'inline_btn_neutral_img', previewId: null },
            { key: 'inline_btn_info_img', previewId: null }
        ];

        this._onStorageFileDeletedForAppearance = (event) => {
            const filePaths = (event && event.detail && Array.isArray(event.detail.filePaths))
                ? event.detail.filePaths
                : [];
            if (!filePaths.length || !this.state || !this.state.theme) return;

            const deletedPaths = new Set(
                filePaths
                    .map((p) => this.normalizeFileUrl(p))
                    .filter(Boolean)
            );
            if (!deletedPaths.size) return;

            const deletedNames = new Set(
                Array.from(deletedPaths)
                    .map((p) => this.getFileBasename(p))
                    .filter(Boolean)
            );

            let hasChanges = false;

            imageFieldMappings.forEach(({ key, previewId }) => {
                const currentUrl = this.state.theme[key];
                const normalizedCurrent = this.normalizeFileUrl(currentUrl);
                if (!normalizedCurrent) return;

                const currentName = this.getFileBasename(normalizedCurrent);
                const matchesByPath = deletedPaths.has(normalizedCurrent);
                const matchesByName = !!currentName && deletedNames.has(currentName);
                if (!matchesByPath && !matchesByName) return;

                this.state.theme[key] = null;
                hasChanges = true;

                if (previewId && document.getElementById(previewId)) {
                    this.updateImagePreview(previewId, null, key);
                }
            });

            if (hasChanges) {
                this.syncWithWidget();
            }
        };

        window.addEventListener('storage:file-deleted', this._onStorageFileDeletedForAppearance);
        this._storageDeleteSyncBound = true;
    },

    loadFont(fontName) {
        FontManager.loadFont(fontName);
    },

    setupFontSelect(containerId, hiddenInputId, currentNameId, themeKey) {
        FontManager.setupFontSelect(this, containerId, hiddenInputId, currentNameId, themeKey);
    },

    setupInput(id, settingKey) {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('input', (e) => {
            const val = e.target.value;
            
            const path = settingKey.split('.');
            if (path.length === 2) {
                if (!this.state[path[0]]) this.state[path[0]] = {};
                this.state[path[0]][path[1]] = val;
            } else {
                this.state.theme[settingKey] = val;
                if (settingKey === 'bot_name' || settingKey === 'bot_role') {
                    if (!this.state.bot_settings) this.state.bot_settings = {};
                    this.state.bot_settings[settingKey] = val;
                }
                if (settingKey === 'welcome_msg') {
                    this.state.welcome_msg = val;
                }
            }
            
            const counter = document.querySelector(`.char-counter[data-for="${id}"]`);
            if (counter) {
                const max = input.getAttribute('maxlength') || 0;
                counter.textContent = `${val.length} / ${max}`;
            }
            
            this.syncWithWidget();
        });
    },

    bindEvents() {
        if (typeof this.bindHeaderButtonsEvents === 'function') {
            this.bindHeaderButtonsEvents();
        }

        window.applyMagicDesign = () => MagicDesignModule.applyMagicDesign(this);
        window.resetAllToDefault = () => this.resetAllToDefault();
    },

    applyMagicDesign() {
        MagicDesignModule.applyMagicDesign(this);
    },

    setFieldValue(field, value) {
        if (value === undefined) return;

        if (field.type === 'checkbox') {
            field.checked = !!value;
            const event = new Event('change');
            event._isInitialFill = true;
            field.dispatchEvent(event);
        } else if (field.classList.contains('color_hex')) {
            let finalColor = value || '';
            if (finalColor && typeof finalColor === 'string' && finalColor.toLowerCase() === 'transparent') finalColor = '';
            
            if (finalColor && finalColor.startsWith('#')) finalColor = finalColor.toUpperCase();
            
            field.setAttribute('spellcheck', 'false');
            
            field.value = finalColor;
            const pickerId = field.id.replace('-hex', '-picker').replace('-color-hex', '-color-picker');
            const picker = document.getElementById(pickerId);
            if (picker && finalColor) picker.value = finalColor;
            const previewId = field.id.replace('-hex', '-preview').replace('-color-hex', '-color-preview');
            const preview = document.getElementById(previewId);
            if (preview) preview.style.backgroundColor = finalColor || 'transparent';
        } else if (field.type === 'hidden' && field.id.includes('font-family-select')) {
            field.value = value || 'Geist';
            const containerId = field.id + '-container';
            const currentNameId = field.id.replace('select', 'current-font-name');
            const currentNameEl = document.getElementById(currentNameId);
            if (currentNameEl) {
                currentNameEl.textContent = value || 'Geist';
                currentNameEl.style.fontFamily = `'${value || 'Geist'}', sans-serif`;
            }
            
            const container = document.getElementById(containerId);
            if (container) {
                container.querySelectorAll('.option').forEach(opt => {
                    opt.classList.toggle('active', opt.dataset.font === value);
                });
                if (container._updateFont) {
                    container._updateFont(value || 'Geist');
                }
            }
            if (value) FontManager.loadFont(value);
        } else {
            let finalVal = value || '';
            if (finalVal && typeof finalVal === 'string' && finalVal.toLowerCase() === 'transparent') finalVal = '';
            
            if (field.type === 'range') {
                if (field.id.includes('opacity')) {
                    const num = parseFloat(value);
                    finalVal = (!isNaN(num) && num <= 1 && num >= 0) ? Math.round(num * 100) : num;
                } 
                else if ((field.id === 'welcome-delay-input' || field.id === 'chat-typing-indicator-time-input') && typeof value === 'number') {
                    finalVal = value / 1000;
                } 
                else if (typeof value === 'string') {
                    finalVal = value.replace('px', '').replace('%', '').replace('s', '');
                } else if (typeof value === 'number') {
                    finalVal = value;
                }
            }
            
            field.value = finalVal;
            
            const switcher = field.parentElement.querySelector('.type-switcher');
            if (switcher) {
                switcher.querySelectorAll('.type-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.dnaVal === finalVal || btn.dataset.styleId === finalVal);
                });
            }
            
            const valId = field.id.replace('-input', '-val');
            const valDisplay = document.getElementById(valId);
            if (valDisplay) {
                let displayValue = finalVal;
                if (field.id.includes('opacity')) displayValue += '%';
                else if (field.id === 'welcome-retry-count-input') {
                    displayValue = (parseInt(finalVal) === 0) ? '&infin;' : finalVal;
                } else if (field.id === 'chat-typing-indicator-time-input') {
                    displayValue = parseFloat(finalVal).toFixed(1) + 's';
                } else if (field.id.includes('size') || field.id.includes('width') || field.id.includes('radius') || field.id.includes('blur') || field.id.includes('height')) {
                    displayValue += 'px';
                }
                valDisplay.innerHTML = displayValue;
            }
            field.dispatchEvent(new Event('input'));
        }
    },

    fillForm(config) {
        const fields = document.querySelectorAll('[data-setting]');
        fields.forEach(field => {
            const settingPath = field.dataset.setting;
            const path = settingPath.split('.');
            let value = config;
            let found = true;
            
            for (const key of path) { 
                if (value !== null && typeof value === 'object' && key in value) {
                    value = value[key];
                } else { 
                    found = false; 
                    break; 
                } 
            }
            
            if (!found) {
                if (settingPath === 'bot_name' && config.bot_settings?.bot_name) {
                    value = config.bot_settings.bot_name;
                    found = true;
                } else if (settingPath === 'bot_role' && config.bot_settings?.bot_role) {
                    value = config.bot_settings.bot_role;
                    found = true;
                } else if (settingPath === 'welcome_msg' && config.welcome_msg) {
                    value = config.welcome_msg;
                    found = true;
                } else if (settingPath === 'ai_model' && config.bot_settings?.ai_model) {
                    value = config.bot_settings.ai_model;
                    found = true;
                }
            }
            
            if (found) {
                this.setFieldValue(field, value);
            } else if (settingPath.includes('preview_enabled') || settingPath.includes('show_test_buttons')) {
                this.setFieldValue(field, false);
                return;
            }
        });

        if (config.theme) {
            if (typeof this.initWelcomeUI === 'function') this.initWelcomeUI(config);
            if (typeof this.initWindowUI === 'function') this.initWindowUI(config);
            if (typeof this.initMessagesUI === 'function') this.initMessagesUI(config);
            if (typeof this.fillHeaderButtonsForm === 'function') this.fillHeaderButtonsForm();
            if (typeof this.updateButtonForm === 'function') this.updateButtonForm();
        }
    },

    showSuccess(msg) {
    },

    async loadData() {
        try {
            const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
            const token = localStorage.getItem('chatadmin_auth_token');
            const res = await fetch(`/api/chat/admin/config?client_id=${clientId}`, { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            if (data.status === 'success') {
                this.state.theme = data.config.theme || {};
                this.state.bot_settings = data.config.bot_settings || {};
                this.state.welcome_msg = data.config.welcome_msg || '';
                this.state.ai_model = data.config.bot_settings?.ai_model || 'gigachat';
                this.state.contacts = data.config.contacts || {};
                this.state.legal = data.config.legal || {};
            this.state.legal_data = data.config.legal_data || {};
            this.state.ui_settings = data.config.ui_settings || {};
            this.state.notifications = data.config.notifications || {};
            this.state.allowed_origins = data.config.allowed_origins || [];

                this.state.snapshot = {
                    theme: JSON.parse(JSON.stringify(this.state.theme)),
                    bot_settings: JSON.parse(JSON.stringify(this.state.bot_settings))
                };
                
                if (this.state.theme) {
                    const previewKeys = [
                        'msg_bot_preview_enabled', 
                        'msg_user_preview_enabled', 
                        'msg_operator_preview_enabled',
                        'welcome_preview_enabled'
                    ];
                    previewKeys.forEach(key => {
                        this.state.theme[key] = false;
                    });
                }

                this.fillForm(data.config);
                
                window.dispatchEvent(new Event('config_loaded'));
                
                if (typeof this.syncInlineButtonsForm === 'function') {
                    this.syncInlineButtonsForm();
                } else if (typeof this.updateButtonForm === 'function') {
                    this.updateButtonForm();
                }
                
                if (this.state.theme) {
                    const theme = this.state.theme;
                    const imageMappings = [
                        { id: 'widget-img-preview', url: theme.widget_img, key: 'widget_img' },
                        { id: 'header-logo-preview', url: theme.header_logo, key: 'header_logo' },
                        { id: 'chat-window-img-preview', url: theme.chat_window_bg_img || theme.window_bg_img, key: 'window_bg_img' },
                        { id: 'welcome-img-preview', url: theme.welcome_img, key: 'welcome_img' },
                        { id: 'bot-avatar-preview', url: theme.bot_avatar, key: 'bot_avatar' },
                        { id: 'user-avatar-preview', url: theme.user_avatar, key: 'user_avatar' },
                        { id: 'operator-avatar-preview', url: theme.operator_avatar, key: 'operator_avatar' }
                    ];

                    imageMappings.forEach(m => {
                        if (m.url) {
                            this.updateImagePreview(m.id, m.url, m.key);
                        }
                    });
                }

                this.syncWithWidget();
            }
        } catch (e) { console.error(e); }
    },

    async saveData() {
        const clientId = localStorage.getItem('chat_client_id');
        const token = localStorage.getItem('chatadmin_auth_token');
        
        const urlInput = document.getElementById('welcome-link-url-input');
        if (urlInput) {
            this.state.theme.welcome_click_url = urlInput.value;
            this.state.theme.welcome_link_url = urlInput.value;
        }

        const payload = {
            client_id: clientId,
            theme: { ...this.state.theme },
            welcome_msg: this.state.welcome_msg,
            bot_settings: { ...this.state.bot_settings },
            contacts: this.state.contacts,
            legal: this.state.legal,
            legal_data: this.state.legal_data,
            ui_settings: this.state.ui_settings,
            notifications: this.state.notifications,
            allowed_origins: this.state.allowed_origins
        };
        
        const modelInput = document.getElementById('prompt-ai-model');
        const actualModel = modelInput ? modelInput.value : this.state.ai_model;
        
        if (actualModel) {
            payload.bot_settings.ai_model = actualModel;
            if (payload.theme) delete payload.theme.ai_model;
        }

        const saveBtn = document.getElementById('save-appearance-btn');
        const originalHTML = saveBtn ? saveBtn.innerHTML : '';
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
        }

        try {
            const res = await fetch(`/api/chat/admin/config?client_id=${clientId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });
            const result = await res.json();
            if (result.status === 'success') {
                if (saveBtn) {
                    saveBtn.classList.add('btn-success-state');
                    saveBtn.innerHTML = '<span>Сохранено!</span>';
                }

                this.syncWithWidget();

                setTimeout(() => {
                    if (saveBtn) {
                        saveBtn.classList.remove('btn-success-state');
                        saveBtn.innerHTML = originalHTML;
                        saveBtn.disabled = false;
                    }
                }, 2000);
            } else {
                throw new Error(result.message);
            }
        } catch (err) {
            console.error('Save error:', err);
            if (saveBtn) {
                saveBtn.classList.add('btn-error-state');
                saveBtn.innerHTML = '<span>Ошибка</span>';
                setTimeout(() => {
                    saveBtn.classList.remove('btn-error-state');
                    saveBtn.innerHTML = originalHTML;
                    saveBtn.disabled = false;
                }, 2000);
            }
        }
    },

    setupToggle(id, groupId, settingKey) {
        const toggle = document.getElementById(id);
        const group = document.getElementById(groupId);
        if (!toggle) return;
        toggle.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            const isWelcomeToggle = id === 'welcome-enabled-toggle';

            if (group && !isWelcomeToggle) {
                if (isEnabled) {
                    group.classList.remove('collapsed', 'setting-group-disabled');
                } else {
                    group.classList.add('collapsed', 'setting-group-disabled');
                }
                group.querySelectorAll('input, select, button').forEach(el => el.disabled = !isEnabled);
                group.querySelectorAll('.setting-item, .setting-item-compact').forEach(item => item.classList.toggle('setting-disabled', !isEnabled));
            }
            
            const path = settingKey.split('.');
            let finalKey = settingKey;
            let targetState = this.state.theme;
            if (path.length === 2) {
                targetState = this.state[path[0]];
                finalKey = path[1];
            }

            if (finalKey.startsWith('header_btn_')) {
                const baseKey = finalKey.replace('header_btn_', '');
                const mappedKey = this.getHeaderBtnKey(baseKey);
                this.state.theme[mappedKey] = isEnabled;
            } else if (finalKey.startsWith('bg_blur') || finalKey.startsWith('bg_h_blur')) {
                const mappedKey = this.getHeaderBtnKey(finalKey);
                this.state.theme[mappedKey] = isEnabled;
            } else {
                targetState[finalKey] = isEnabled;
            }
            this.syncWithWidget();
        });
    },

    setupColorSync(pickerId, hexId, previewId, settingKey) {
        const picker = document.getElementById(pickerId);
        const hex = document.getElementById(hexId);
        const preview = document.getElementById(previewId);
        if (!picker || !hex || !preview) return;
        const update = (val) => {
            if (val && val !== 'transparent' && !val.startsWith('#') && /^[0-9A-F]{3,6}$/i.test(val)) val = '#' + val;
            const finalVal = (val === '' || val === null) ? 'transparent' : val;
            if (finalVal !== 'transparent') picker.value = finalVal;
            hex.value = val;
            preview.style.backgroundColor = finalVal;
            const finalKey = (settingKey.startsWith('header_btn_') || settingKey.startsWith('bg_blur') || settingKey.startsWith('bg_h_blur')) 
                ? this.getHeaderBtnKey(settingKey.replace('header_btn_', '')) 
                : settingKey;
            this.state.theme[finalKey] = finalVal;
            this.syncWithWidget();
        };
        picker.addEventListener('input', (e) => update(e.target.value));
        hex.addEventListener('input', (e) => { 
            const v = e.target.value;
            if (v.length === 7 || v.length === 4 || v === '' || v === 'transparent') update(v);
        });
    },

    setupRange(inputId, valId, unit, settingKey, isNumeric = false) {
        const input = document.getElementById(inputId);
        const display = document.getElementById(valId);
        if (!input || !display) return;
        
        const updateDisplay = (val) => {
            if (settingKey === 'welcome_retry_count' || inputId === 'welcome-retry-count-input') {
                display.innerHTML = (parseInt(val) === 0) ? '&infin;' : val;
            } else if (settingKey === 'msg_typing_indicator_time' || inputId === 'chat-typing-indicator-time-input') {
                display.textContent = parseFloat(val).toFixed(1) + 's';
            } else {
                display.textContent = val + (unit || '');
            }
        };

        input.addEventListener('input', (e) => {
            let val = e.target.value;
            updateDisplay(val);
            let finalVal = isNumeric ? parseFloat(val) : (val + (unit === '%' ? '%' : 'px'));
            if (settingKey === 'welcome_trigger_delay_ms' || settingKey === 'msg_typing_indicator_time') {
                finalVal = parseFloat(val) * 1000;
            } else if (isNumeric && unit === '%' && settingKey.includes('opacity')) {
                finalVal = finalVal / 100;
            }
            const finalKey = (settingKey.startsWith('header_btn_') || settingKey.startsWith('bg_blur') || settingKey.startsWith('bg_h_blur')) 
                ? this.getHeaderBtnKey(settingKey.replace('header_btn_', '')) 
                : settingKey;
            this.state.theme[finalKey] = finalVal;
            
            const isWindowKey = settingKey.includes('window_');
            const isWidgetPosKey = settingKey.includes('widget_left') || settingKey.includes('widget_top');

            if (isWidgetPosKey) {
                const host = document.getElementById('mitya-widget-host');
                if (host && host.shadowRoot) {
                    const container = host.shadowRoot.querySelector('.chat-widget-container');
                    if (container) {
                        const valPct = parseFloat(val);
                        if (settingKey === 'widget_left') {
                            if (valPct > 50) { container.style.right = (100 - valPct) + '%'; container.style.left = 'auto'; }
                            else { container.style.left = valPct + '%'; container.style.right = 'auto'; }
                        } else {
                            if (valPct > 50) { container.style.bottom = (100 - valPct) + '%'; container.style.top = 'auto'; }
                            else { container.style.top = valPct + '%'; container.style.bottom = 'auto'; }
                        }
                    }
                }
                this.syncWithWidget();
            } else if (isWindowKey) {
                this.syncWithWidget({ force_position: true });
            } else {
                this.syncWithWidget();
            }
        });
        updateDisplay(input.value);
    },

    syncWithWidget(extraData = {}) {
        if (extraData.force_position) {
            if (window.mitya_session_rect) window.mitya_session_rect = null;
            if (window.MityaWidget) window.mitya_session_rect = null;
        }
        
        const fullData = { 
            bot_settings: this.state.bot_settings, 
            welcome_msg: this.state.welcome_msg,
            ...extraData 
        };

        if (window.MityaWidget && window.MityaWidget.applyTheme) {
            window.MityaWidget.applyTheme(this.state.theme, fullData);
        }
        const iframe = document.getElementById('widget-preview-iframe');
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({ 
                type: 'apply_theme', 
                theme: this.state.theme, 
                data: fullData 
            }, '*');
        }
    },

    async deleteFileFromServer(url) {
        if (!url) return;
        try {
            const token = localStorage.getItem('chatadmin_auth_token');
            await fetch('/api/chat/admin/delete-file', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ file_url: url })
            });
        } catch (e) {
            console.error('Error deleting file:', e);
        }
    },

    confirmAction(title, text, onConfirm) {
        const overlay = document.getElementById('confirm-modal-overlay');
        const titleEl = document.getElementById('confirm-modal-title');
        const textEl = document.getElementById('confirm-modal-text');
        const yesBtn = document.getElementById('confirm-btn-yes');
        const noBtn = document.getElementById('confirm-btn-no');
        if (!overlay || !titleEl || !textEl || !yesBtn || !noBtn) return;
        titleEl.textContent = title;
        textEl.textContent = text;
        const close = () => { overlay.classList.remove('active'); document.body.style.overflow = ''; };
        yesBtn.onclick = () => { onConfirm(); close(); };
        noBtn.onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        document.body.style.overflow = 'hidden';
        setTimeout(() => overlay.classList.add('active'), 10);
    },

    setSettingDisabled(settingKey, isDisabled) {
        const field = document.querySelector(`[data-setting="${settingKey}"]`);
        const item = field?.closest('.setting-item');
        if (!item) return;
        if (isDisabled) {
            item.classList.add('setting-disabled');
            item.querySelectorAll('input, select, button').forEach(i => i.disabled = true);
        } else {
            item.classList.remove('setting-disabled');
            item.querySelectorAll('input, select, button').forEach(i => i.disabled = false);
        }
    },

    setupImageUpload(inputId, previewId, settingKey) {
        const input = document.getElementById(inputId);
        const preview = document.getElementById(previewId);
        if (!input || !preview) return;

        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (file.size > 500 * 1024) {
                if (window.showAlert) {
                    window.showAlert('tmpl-error-alert', { 
                        title: 'Файл слишком большой', 
                        text: 'Максимальный вес: 500 KB' 
                    });
                } else {
                    alert('Файл слишком большой (макс. 500 KB)');
                }
                input.value = '';
                return;
            }

            preview.innerHTML = '<span style="font-size: 10px;">Загрузка...</span>';
            const formData = new FormData();
            formData.append('file', file);

            try {
                const clientId = localStorage.getItem('chat_client_id');
                const token = localStorage.getItem('chatadmin_auth_token');
                const res = await fetch(`/api/chat/admin/upload-file?client_id=${clientId}&field_id=${settingKey}`, { 
                    method: 'POST', 
                    headers: { 'Authorization': `Bearer ${token}` }, 
                    body: formData 
                });
                const data = await res.json();

                if (data.status === 'success') {
                    const oldUrl = this.state.theme[settingKey];
                    
                    if (oldUrl && oldUrl.includes('/uploads/temp/')) {
                        this.deleteTempFile(settingKey);
                    }

                    const cacheBuster = `?t=${Date.now()}`;
                    const finalUrl = data.file_url + cacheBuster;

                    this.state.theme[settingKey] = finalUrl;
                    this.updateImagePreview(previewId, finalUrl, settingKey);
                    this.syncWithWidget();
                }
                input.value = '';
            } catch (err) { 
                preview.innerHTML = 'Ошибка'; 
                input.value = ''; 
            }
        });
    },

    async deleteTempFile(fieldId) {
        try {
            const clientId = localStorage.getItem('chat_client_id');
            const token = localStorage.getItem('chatadmin_auth_token');
            await fetch(`/api/chat/admin/delete-temp-file?client_id=${clientId}&field_id=${fieldId}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            console.log('Temp file deleted for field:', fieldId);
        } catch (e) { console.error('Failed to delete temp file:', e); }
    },

    async clearAllMyTempFiles() {
        const clientId = localStorage.getItem('chat_client_id');
        if (!clientId) return;

        const imageFields = [
            'widget_img', 'msg_bot_avatar', 'msg_user_avatar', 'msg_operator_avatar',
            'profile_avatar', 'window_bg_img', 'header_logo', 'welcome_img',
            'inline_btn_accent_img', 'inline_btn_neutral_img', 'inline_btn_info_img'
        ];

        for (const field of imageFields) {
            this.deleteTempFile(field);
        }
    },

    updateImagePreview(previewId, url, settingKey) {
        const preview = document.getElementById(previewId);
        if (!preview) return;

        preview.innerHTML = '';
        if (url && url !== 'none' && url !== 'null' && url !== '') {
            preview.style.backgroundImage = `url(${url})`;
            preview.style.backgroundSize = 'cover';
            preview.style.backgroundPosition = 'center';
            preview.style.backgroundRepeat = 'no-repeat';
            preview.dataset.url = url;
            preview.classList.add('has-image');

            let removeFn = '';
            if (previewId === 'header-logo-preview') removeFn = 'window.removeHeaderLogo()';
            else if (previewId === 'widget-img-preview') removeFn = 'window.removeWidgetImage()';
            else if (previewId === 'chat-window-img-preview') removeFn = 'window.removeChatWindowImage()';
            else if (previewId === 'welcome-img-preview') removeFn = 'window.removeWelcomeImage()';
            else if (previewId.includes('avatar')) {
                const type = previewId.includes('bot') ? 'bot' : (previewId.includes('user') ? 'user' : 'operator');
                removeFn = `window.removeAvatar('${type}')`;
            } else {
                const btnKey = settingKey.includes('_img_h') ? 'inline_btn_img_h' : 'inline_btn_img';
                removeFn = `window.removeButtonImage('${previewId}', '${btnKey}')`;
            }

            preview.insertAdjacentHTML('beforeend', `
                <button class="avatar-remove-btn" style="display: flex;" onclick="event.stopPropagation(); ${removeFn}">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            `);
        } else {
            preview.style.backgroundImage = '';
            preview.style.backgroundColor = '';
            preview.dataset.url = '';
            preview.classList.remove('has-image');
            preview.insertAdjacentHTML('afterbegin', `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="placeholder-icon">
                    <circle cx="12" cy="12" r="1"></circle>
                    <circle cx="19" cy="12" r="1"></circle>
                    <circle cx="5" cy="12" r="1"></circle>
                </svg>
            `);
        }
        this.syncWithWidget();
    }
};
