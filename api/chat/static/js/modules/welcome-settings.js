import { MagicDesignModule } from '../magic-design.js';

export function initWelcomeSettings(context) {
    context.setupToggle('welcome-enabled-toggle', 'welcome-settings-group', 'theme.welcome_bubble_enabled');
    context.setupRange('welcome-delay-input', 'welcome-delay-val', 's', 'welcome_trigger_delay_ms', true);
    context.setupRange('welcome-retry-delay-input', 'welcome-retry-delay-val', 's', 'welcome_retry_delay_sec', true);
    context.setupRange('welcome-retry-count-input', 'welcome-retry-count-val', '', 'welcome_retry_count', true);
    
    const welcomePreviewToggle = document.getElementById('welcome-preview-toggle');
    if (welcomePreviewToggle) {
        welcomePreviewToggle.addEventListener('change', (e) => {
            if (e._isInitialFill) return;
            
            const isEnabled = e.target.checked;
            context.state.theme.welcome_preview_enabled = isEnabled;
            
            // Синхронизируем с тумблером предпросмотра кнопки закрытия
            const closePreviewToggle = document.getElementById('welcome-close-preview-toggle');
            if (closePreviewToggle) {
                closePreviewToggle.checked = isEnabled;
                context.state.theme.welcome_close_preview_enabled = isEnabled;
            }
            
            if (isEnabled) {
                // Отправляем команду в виджет показать облако принудительно
                if (window.MityaWidget && window.MityaWidget.showWelcome) {
                    window.MityaWidget.showWelcome(true);
                }
            } else {
                // Отправляем команду скрыть облако
                if (window.MityaWidget && window.MityaWidget.hideWelcome) {
                    window.MityaWidget.hideWelcome();
                }
            }
            context.syncWithWidget();
        });
    }

    context.setupRange('welcome-width-input', 'welcome-width-val', 'px', 'welcome_max_width', false);
    context.setupRange('welcome-height-input', 'welcome-height-val', 'px', 'welcome_height', false);
    context.setupRange('welcome-radius-input', 'welcome-radius-val', 'px', 'welcome_radius', false);
    context.setupToggle('welcome-text-toggle', 'welcome-content-group', 'theme.welcome_text_enabled');
    context.setupColorSync('welcome-text-picker', 'welcome-text-hex', 'welcome-text-preview', 'welcome_text_color');
    context.setupRange('welcome-text-opacity-input', 'welcome-text-opacity-val', '%', 'welcome_text_opacity', true);
    
    // Принудительная синхронизация прозрачности текста
    const opacityInput = document.getElementById('welcome-text-opacity-input');
    if (opacityInput) {
        opacityInput.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value) / 100;
            console.log('[WelcomeSettings] Setting opacity to:', val);
            context.state.theme.welcome_text_opacity = val;
            
            // Устанавливаем переменную напрямую в DOM, чтобы не ждать пересборки JS
            document.documentElement.style.setProperty('--chat-welcome-text-opacity', val);
            const host = document.getElementById('mitya-widget-host');
            if (host) host.style.setProperty('--chat-welcome-text-opacity', val);
            
            context.syncWithWidget();
        });
    }
    context.setupRange('welcome-font-size-input', 'welcome-font-size-val', 'px', 'welcome_font_size', false);
    context.setupFontSelect('welcome-font-family-select-container', 'welcome-font-family-select', 'welcome-current-font-name', 'welcome_font_family');

    const welcomeActionSwitcher = document.getElementById('welcome-action-switcher');
    if (welcomeActionSwitcher) {
        welcomeActionSwitcher.querySelectorAll('.welcome-action-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                welcomeActionSwitcher.querySelectorAll('.welcome-action-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const action = btn.dataset.actionVal;
                context.state.theme.welcome_click_action = action;
                
                const urlInput = document.getElementById('welcome-link-url-input');
                const urlItem = document.getElementById('welcome-link-url-item');
                const targetItem = document.getElementById('welcome-link-target-item');
                
                if (urlInput) {
                    const isLink = action === 'link';
                    urlInput.disabled = !isLink;
                    if (urlItem) urlItem.classList.toggle('setting-disabled', !isLink);
                    
                    const targetToggle = document.getElementById('welcome-link-target-toggle');
                    if (targetToggle) targetToggle.disabled = !isLink;
                    if (targetItem) targetItem.classList.toggle('setting-disabled', !isLink);
                }
                
                context.syncWithWidget();
            });
        });
    }

    const textAlignSwitcher = document.getElementById('welcome-text-align-switcher');
    if (textAlignSwitcher) {
        textAlignSwitcher.querySelectorAll('.type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                textAlignSwitcher.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const align = btn.dataset.alignVal;
                context.state.theme.welcome_text_align = align;
                const input = document.getElementById('welcome-text-align-input');
                if (input) input.value = align;
                context.syncWithWidget();
            });
        });
    }

    const textValignSwitcher = document.getElementById('welcome-text-valign-switcher');
    if (textValignSwitcher) {
        textValignSwitcher.querySelectorAll('.type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                textValignSwitcher.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const valign = btn.dataset.valignVal;
                context.state.theme.welcome_text_valign = valign;
                const input = document.getElementById('welcome-text-valign-input');
                if (input) input.value = valign;
                context.syncWithWidget();
            });
        });
    }

    const welcomeTextInput = document.getElementById('welcome-bubble-text-input');
    const welcomeTextCounter = document.getElementById('welcome-text-counter');
    if (welcomeTextInput) {
        const updateCounter = () => {
            if (welcomeTextCounter) {
                welcomeTextCounter.textContent = `${welcomeTextInput.value.length} / 200`;
            }
        };
        
        welcomeTextInput.addEventListener('input', (e) => {
            context.state.theme.welcome_bubble_text = e.target.value;
            updateCounter();
            context.syncWithWidget();
        });
        
        setTimeout(updateCounter, 500);
    }

    const welcomeUrlInput = document.getElementById('welcome-link-url-input');
    if (welcomeUrlInput) {
        welcomeUrlInput.addEventListener('input', (e) => {
            context.state.theme.welcome_click_url = e.target.value;
            context.state.theme.welcome_link_url = e.target.value;
            context.syncWithWidget();
        });
    }

    const welcomeTargetToggle = document.getElementById('welcome-link-target-toggle');
    if (welcomeTargetToggle) {
        welcomeTargetToggle.addEventListener('change', (e) => {
            context.state.theme.welcome_click_target_blank = e.target.checked;
            context.syncWithWidget();
        });
    }

    const welcomeWeightInput = document.getElementById('welcome-font-weight-input');
    const welcomeWeightVal = document.getElementById('welcome-font-weight-val');
    if (welcomeWeightInput && welcomeWeightVal) {
        welcomeWeightInput.addEventListener('input', (e) => {
            const val = e.target.value;
            welcomeWeightVal.textContent = val;
            context.state.theme.welcome_font_weight = val;
            context.syncWithWidget();
        });
    }

    context.setupToggle('welcome-img-enabled-toggle', 'welcome-img-settings-group', 'theme.welcome_img_enabled');
    context.setupImageUpload('welcome-img-upload', 'welcome-img-preview', 'welcome_img');

    context.setupRange('welcome-img-opacity-input', 'welcome-img-opacity-val', '%', 'welcome_img_opacity', true);
    context.setupToggle('welcome-bg-toggle', 'welcome-bg-group', 'theme.welcome_bg_enabled');
    context.setupColorSync('welcome-bg-picker', 'welcome-bg-hex', 'welcome-bg-preview', 'welcome_bg');
    context.setupRange('welcome-opacity-input', 'welcome-opacity-val', '%', 'welcome_bg_opacity', true);
    context.setupRange('welcome-blur-input', 'welcome-blur-val', 'px', 'welcome_bg_blur', true);
    context.setupToggle('welcome-bg-h-toggle', 'welcome-bg-h-group', 'theme.welcome_bg_h_enabled');
    context.setupColorSync('welcome-bg-h-picker', 'welcome-bg-h-hex', 'welcome-bg-h-preview', 'welcome_bg_h');
    context.setupRange('welcome-opacity-h-input', 'welcome-opacity-h-val', '%', 'welcome_bg_opacity_h', true);
    context.setupToggle('welcome-border-toggle', 'welcome-border-group', 'theme.welcome_border_enabled');
    context.setupColorSync('welcome-border-picker', 'welcome-border-hex', 'welcome-border-preview', 'welcome_border');
    context.setupRange('welcome-border-opacity-input', 'welcome-border-opacity-val', '%', 'welcome_border_opacity', true);
    context.setupRange('welcome-border-width-input', 'welcome-border-width-val', 'px', 'welcome_border_width', false);
    context.setupToggle('welcome-shadow-toggle', 'welcome-shadow-group', 'theme.welcome_shadow_enabled');
    context.setupColorSync('welcome-shadow-picker', 'welcome-shadow-hex', 'welcome-shadow-preview', 'welcome_shadow_color');
    context.setupRange('welcome-shadow-opacity-input', 'welcome-shadow-opacity-val', '%', 'welcome_shadow_opacity', true);
    context.setupRange('welcome-shadow-blur-input', 'welcome-shadow-blur-val', 'px', 'welcome_shadow_blur', false);
    context.setupToggle('welcome-shadow-h-toggle', 'welcome-shadow-h-group', 'theme.welcome_shadow_h_enabled');
    context.setupColorSync('welcome-shadow-h-picker', 'welcome-shadow-h-hex', 'welcome-shadow-h-preview', 'welcome_shadow_h_color');
    context.setupRange('welcome-shadow-h-opacity-input', 'welcome-shadow-h-opacity-val', '%', 'welcome_shadow_h_opacity', true);
    context.setupRange('welcome-shadow-h-blur-input', 'welcome-shadow-h-blur-val', 'px', 'welcome_shadow_h_blur', false);
    context.setupRange('welcome-close-size-input', 'welcome-close-size-val', 'px', 'welcome_close_size', false);
    context.setupRange('welcome-close-radius-input', 'welcome-close-radius-val', 'px', 'welcome_close_radius', false);
    context.setupColorSync('welcome-close-color-picker', 'welcome-close-color-hex', 'welcome-close-color-preview', 'welcome_close_color');
    context.setupRange('welcome-close-opacity-input', 'welcome-close-opacity-val', '%', 'welcome_close_opacity', true);
    context.setupToggle('welcome-close-bg-toggle', 'welcome-close-bg-group', 'theme.welcome_close_bg_enabled');
    context.setupColorSync('welcome-close-bg-picker', 'welcome-close-bg-hex', 'welcome-close-bg-preview', 'welcome_close_bg');
    context.setupRange('welcome-close-bg-opacity-input', 'welcome-close-bg-opacity-val', '%', 'welcome_close_bg_opacity', true);
    context.setupToggle('welcome-close-color-h-toggle', 'welcome-close-color-h-group', 'theme.welcome_close_color_h_enabled');
    context.setupColorSync('welcome-close-hover-color-picker', 'welcome-close-hover-color-hex', 'welcome-close-hover-color-preview', 'welcome_close_hover_color');
    context.setupRange('welcome-close-hover-opacity-input', 'welcome-close-hover-opacity-val', '%', 'welcome_close_hover_opacity', true);
    context.setupToggle('welcome-close-hover-bg-toggle', 'welcome-close-hover-bg-group', 'theme.welcome_close_hover_bg_enabled');
    context.setupColorSync('welcome-close-hover-bg-picker', 'welcome-close-hover-bg-hex', 'welcome-close-hover-bg-preview', 'welcome_close_hover_bg');
    context.setupRange('welcome-close-hover-bg-opacity-input', 'welcome-close-hover-bg-opacity-val', '%', 'welcome_close_hover_bg_opacity', true);
    context.setupToggle('welcome-close-border-toggle', 'welcome-close-border-group', 'theme.welcome_close_border_enabled');
    context.setupColorSync('welcome-close-border-picker', 'welcome-close-border-hex', 'welcome-close-border-preview', 'welcome_close_border_color');
    context.setupRange('welcome-close-border-width-input', 'welcome-close-border-width-val', 'px', 'welcome_close_border_width', false);
    context.setupRange('welcome-close-border-opacity-input', 'welcome-close-border-opacity-val', '%', 'welcome_close_border_opacity', true);
    context.setupToggle('welcome-close-border-h-toggle', 'welcome-close-border-h-group', 'theme.welcome_close_border_h_enabled');
    context.setupColorSync('welcome-close-border-h-picker', 'welcome-close-border-h-hex', 'welcome-close-border-h-preview', 'welcome_close_border_color_h');
    context.setupRange('welcome-close-border-width-h-input', 'welcome-close-border-width-h-val', 'px', 'welcome_close_border_width_h', false);
    context.setupRange('welcome-close-border-opacity-h-input', 'welcome-close-border-opacity-h-val', '%', 'welcome_close_border_opacity_h', true);
    context.setupToggle('welcome-close-btn-shadow-toggle', 'welcome-close-btn-shadow-group', 'theme.welcome_close_btn_shadow_enabled');
    context.setupColorSync('welcome-close-btn-shadow-picker', 'welcome-close-btn-shadow-hex', 'welcome-close-btn-shadow-preview', 'welcome_close_btn_shadow_color');
    context.setupRange('welcome-close-btn-shadow-opacity-input', 'welcome-close-btn-shadow-opacity-val', '%', 'welcome_close_btn_shadow_opacity', true);
    context.setupRange('welcome-close-btn-shadow-blur-input', 'welcome-close-btn-shadow-blur-val', 'px', 'welcome_close_btn_shadow_blur', false);
    context.setupToggle('welcome-close-btn-shadow-h-toggle', 'welcome-close-btn-shadow-h-group', 'theme.welcome_close_btn_shadow_h_enabled');
    context.setupColorSync('welcome-close-btn-shadow-h-picker', 'welcome-close-btn-shadow-h-hex', 'welcome-close-btn-shadow-h-preview', 'welcome_close_btn_shadow_color_h');
    context.setupRange('welcome-close-btn-shadow-opacity-h-input', 'welcome-close-btn-shadow-opacity-h-val', '%', 'welcome_close_btn_shadow_opacity_h', true);
    context.setupRange('welcome-close-btn-shadow-blur-h-input', 'welcome-close-btn-shadow-blur-h-val', 'px', 'welcome_close_btn_shadow_blur_h', false);

    const welcomeCloseSideSwitcher = document.getElementById('welcome-close-side-switcher');
    if (welcomeCloseSideSwitcher) {
        welcomeCloseSideSwitcher.querySelectorAll('.type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                welcomeCloseSideSwitcher.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const side = btn.dataset.sideVal;
                context.state.theme.welcome_close_side = side;
                const input = document.getElementById('welcome-close-side-input');
                if (input) input.value = side;
                context.syncWithWidget();
            });
        });
    }

    const welcomeClosePreviewToggle = document.getElementById('welcome-close-preview-toggle');
    if (welcomeClosePreviewToggle) {
        welcomeClosePreviewToggle.addEventListener('change', (e) => {
            if (e._isInitialFill) return; // Игнорируем программную установку из fillForm
            
            const isEnabled = e.target.checked;
            context.state.theme.welcome_close_preview_enabled = isEnabled;
            
            // Синхронизируем с основным тумблером предпросмотра облака
            const mainPreviewToggle = document.getElementById('welcome-preview-toggle');
            if (mainPreviewToggle) {
                mainPreviewToggle.checked = isEnabled;
                context.state.theme.welcome_preview_enabled = isEnabled;
            }

            if (isEnabled) {
                if (window.MityaWidget && window.MityaWidget.showWelcome) {
                    window.MityaWidget.showWelcome(true);
                }
            } else {
                if (window.MityaWidget && window.MityaWidget.hideWelcome) {
                    window.MityaWidget.hideWelcome();
                }
            }
            context.syncWithWidget();
        });
    }

    window.randomizeWelcomeDesign = () => MagicDesignModule.randomizeWelcomeDesign(context);
    window.randomizeWelcomeCloseDesign = () => MagicDesignModule.randomizeWelcomeCloseDesign(context);

    context.handleWelcomeBotMessage = (data) => {
        if (data.type === 'mitya_hide_welcome_preview') {
            const toggle = document.getElementById('welcome-preview-toggle');
            if (toggle) {
                toggle.checked = false;
                context.state.theme.welcome_preview_enabled = false;
            }
            const closeToggle = document.getElementById('welcome-close-preview-toggle');
            if (closeToggle) {
                closeToggle.checked = false;
                context.state.theme.welcome_close_preview_enabled = false;
            }
        }
    };

    window.resetWelcomeToDefault = () => {        context.confirmAction('Сбросить дизайн облака?', 'Все настройки приветственного облака будут возвращены к золотому стандарту.', () => {
            const allWelcomeDefaults = context.getFilteredDefaults('welcome_');
            const filteredDefaults = {};
            
            Object.keys(allWelcomeDefaults).forEach(key => {
                if (!key.startsWith('welcome_close_')) {
                    filteredDefaults[key] = allWelcomeDefaults[key];
                }
            });

            // Явно зануляем картинку для сервера
            filteredDefaults.welcome_img = null;

            Object.assign(context.state.theme, filteredDefaults);
            context.fillForm({ theme: context.state.theme });

            // Явно очищаем поле URL, если оно есть
            const urlInput = document.getElementById('welcome-link-url-input');
            if (urlInput) urlInput.value = filteredDefaults.welcome_click_url || '';

            context.updateImagePreview('welcome-img-preview', null, 'welcome_img');
            context.syncWithWidget();
            context.showSuccess('Дизайн облака сброшен');
        });
    };

    window.resetWelcomeCloseToDefault = () => {
        context.confirmAction('Сбросить дизайн кнопки закрытия?', 'Все настройки кнопки закрытия облака будут возвращены к золотому стандарту.', () => {
            const defaults = context.getFilteredDefaults('welcome_close_');
            Object.assign(context.state.theme, defaults);
            
            const toggles = {
                'welcome-close-color-h-toggle': defaults.welcome_close_color_h_enabled,
                'welcome-close-bg-toggle': defaults.welcome_close_bg_enabled,
                'welcome-close-hover-bg-toggle': defaults.welcome_close_hover_bg_enabled,
                'welcome-close-border-toggle': defaults.welcome_close_border_enabled,
                'welcome-close-border-h-toggle': defaults.welcome_close_border_h_enabled,
                'welcome-close-btn-shadow-toggle': defaults.welcome_close_btn_shadow_enabled,
                'welcome-close-btn-shadow-h-toggle': defaults.welcome_close_btn_shadow_h_enabled
            };
            
            for (const [id, enabled] of Object.entries(toggles)) {
                const el = document.getElementById(id);
                if (el) {
                    el.checked = enabled;
                    el.dispatchEvent(new Event('change'));
                }
            }
            context.fillForm({ theme: context.state.theme });
            context.syncWithWidget();
            context.showSuccess('Дизайн кнопки закрытия сброшен');
        });
    };

    window.removeWelcomeImage = async () => {
        const imgPreview = document.getElementById('welcome-img-preview');
        if (!imgPreview) return;
        const oldUrl = context.state.theme.welcome_img;
        
        // Если это временный файл, удаляем его физически сразу
        if (oldUrl && oldUrl.includes('/uploads/temp/')) {
            if (context.deleteTempFile) await context.deleteTempFile('welcome_img');
        }

        context.state.theme.welcome_img = null;
        context.updateImagePreview('welcome-img-preview', null, 'welcome_img');
        context.syncWithWidget();
    };

    context.initWelcomeUI = (config) => {
        if (config.theme?.welcome_img) {
            context.updateImagePreview('welcome-img-preview', config.theme.welcome_img, 'welcome_img');
        }
        const initialWelcomeFont = config.theme?.welcome_font_family || 'inherit';
        const welcomeFontContainer = document.getElementById('welcome-font-family-select-container');
        const welcomeFontName = document.getElementById('welcome-current-font-name');
        if (welcomeFontContainer && welcomeFontName) {
            const options = welcomeFontContainer.querySelectorAll('.option');
            options.forEach(opt => {
                if (opt.dataset.font === initialWelcomeFont) {
                    opt.classList.add('active');
                    welcomeFontName.textContent = opt.textContent;
                } else {
                    opt.classList.remove('active');
                }
            });
        }

        if (config.theme?.welcome_text_align) {
            const align = config.theme.welcome_text_align;
            const switcher = document.getElementById('welcome-text-align-switcher');
            if (switcher) {
                switcher.querySelectorAll('.type-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.alignVal === align);
                });
            }
            const input = document.getElementById('welcome-text-align-input');
            if (input) input.value = align;
        }

        if (config.theme?.welcome_text_valign) {
            const valign = config.theme.welcome_text_valign;
            const switcher = document.getElementById('welcome-text-valign-switcher');
            if (switcher) {
                switcher.querySelectorAll('.type-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.valignVal === valign);
                });
            }
            const input = document.getElementById('welcome-text-valign-input');
            if (input) input.value = valign;
        }

        if (config.theme?.welcome_close_side) {
            const side = config.theme.welcome_close_side;
            const switcher = document.getElementById('welcome-close-side-switcher');
            if (switcher) {
                switcher.querySelectorAll('.type-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.sideVal === side);
                });
            }
            const input = document.getElementById('welcome-close-side-input');
            if (input) input.value = side;
        }

        if (config.theme?.welcome_click_action) {
            const action = config.theme.welcome_click_action;
            const switcher = document.getElementById('welcome-action-switcher');
            if (switcher) {
                switcher.querySelectorAll('.welcome-action-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.actionVal === action);
                });
            }
            const urlInput = document.getElementById('welcome-link-url-input');
            if (urlInput) {
                const isLink = action === 'link';
                urlInput.disabled = !isLink;
                const urlItem = document.getElementById('welcome-link-url-item');
                if (urlItem) urlItem.classList.toggle('setting-disabled', !isLink);
            }
        }
    };
}
