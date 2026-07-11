import { RANDOM_FONTS } from './font-data.js';

export const MagicDesignModule = {
    // Вспомогательная функция для обновления тумблеров в UI
    _updateToggles(toggles) {
        for (const [id, enabled] of Object.entries(toggles)) {
            const el = document.getElementById(id);
            if (el) {
                el.checked = enabled;
                el.dispatchEvent(new Event('change'));
            }
        }
    },

    // Магический дизайн виджета
    randomizeWidgetDesign(module) {
        const randomColor = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        
        const isBgEnabled = Math.random() > 0.2;
        const isEffectsEnabled = Math.random() > 0.1;
        const isDotsEnabled = Math.random() > 0.2;
        const isPulseEnabled = Math.random() > 0.5;
        const isGlareEnabled = Math.random() > 0.5;
        const isBreathingEnabled = Math.random() > 0.5;

        const randomConfig = {
            widget_radius: Math.floor(Math.random() * 51) + '%',
            widget_bg_enabled: isBgEnabled,
            widget_effects_enabled: isEffectsEnabled,
            widget_dots_enabled: isDotsEnabled,
            widget_bg_color: randomColor(),
            widget_bg_opacity: parseFloat(Math.random().toFixed(2)),
            widget_bg_blur: Math.floor(Math.random() * 41) + 'px',
            widget_border_enabled: Math.random() > 0.4,
            widget_border_color: randomColor(),
            widget_border_opacity: parseFloat(Math.random().toFixed(2)),
            widget_border_width: Math.floor(Math.random() * 11) + 'px',
            widget_shadow_enabled: Math.random() > 0.3,
            widget_shadow_color: randomColor(),
            widget_shadow_opacity: parseFloat(Math.random().toFixed(2)),
            widget_shadow_blur: Math.floor(Math.random() * 101) + 'px',
            widget_dots_color: randomColor(),
            widget_dots_opacity: parseFloat(Math.random().toFixed(2)),
            widget_pulse_enabled: isPulseEnabled,
            widget_pulse_color: randomColor(),
            widget_pulse_opacity: parseFloat(Math.random().toFixed(2)),
            widget_pulse_size: (Math.random() * 2 + 1.0).toFixed(1) + 'px',
            widget_pulse_speed: (Math.random() * 4.5 + 0.5).toFixed(1) + 's',
            widget_pulse_pause: (Math.random() * 10).toFixed(1) + 's',
            widget_glare_enabled: isGlareEnabled,
            widget_glare_color: randomColor(),
            widget_glare_opacity: parseFloat(Math.random().toFixed(2)),
            widget_glare_size: Math.floor(Math.random() * 91 + 10) + '%',
            widget_glare_speed: (Math.random() * 9 + 1).toFixed(1) + 's',
            widget_glare_pause: (Math.random() * 10).toFixed(1) + 's',
            widget_breathing_enabled: isBreathingEnabled,
            widget_breathing_speed: (Math.random() * 4.5 + 0.5).toFixed(1) + 's',
            widget_breathing_pause: (Math.random() * 10).toFixed(1) + 's',
            widget_breathing_scale: Math.floor(Math.random() * 21)
        };

        module.state.theme = { ...module.state.theme, ...randomConfig };
        module.fillForm({ theme: module.state.theme });

        this._updateToggles({
            'widget-bg-toggle': isBgEnabled,
            'widget-effects-toggle': isEffectsEnabled,
            'widget-dots-toggle': isDotsEnabled,
            'widget-pulse-toggle': isPulseEnabled,
            'widget-glare-toggle': isGlareEnabled,
            'widget-breathing-toggle': isBreathingEnabled
        });

        module.syncWithWidget();
    },

    // Магический дизайн окна
    randomizeWindowDesign(module) {
        const randomColor = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        
        const isBorderEnabled = Math.random() > 0.5;
        const isShadowEnabled = Math.random() > 0.3;

        const randomConfig = {
            window_radius: Math.floor(Math.random() * 41) + 'px',
            window_bg: randomColor(),
            window_bg_opacity: parseFloat(Math.random().toFixed(2)),
            window_bg_blur: Math.floor(Math.random() * 26) + 'px',
            window_border_enabled: isBorderEnabled,
            window_border_color: randomColor(),
            window_border_opacity: parseFloat(Math.random().toFixed(2)),
            window_border_width: Math.floor(Math.random() * 6) + 'px',
            window_shadow_enabled: isShadowEnabled,
            window_shadow_color: randomColor(),
            window_shadow_opacity: parseFloat(Math.random().toFixed(2)),
            window_shadow_blur: Math.floor(Math.random() * 101) + 'px'
        };

        module.state.theme = { ...module.state.theme, ...randomConfig };
        module.fillForm({ theme: module.state.theme });

        this._updateToggles({
            'chat-border-toggle': isBorderEnabled,
            'chat-shadow-toggle': isShadowEnabled
        });

        module.syncWithWidget({ force_position: true });
    },

    // Магический дизайн кнопки закрытия облака
    randomizeWelcomeCloseDesign(module) {
        const randomColor = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        
        const isColorHEnabled = Math.random() > 0.3;
        const isBgEnabled = Math.random() > 0.2;
        const isBgHEnabled = Math.random() > 0.3;
        const isBorderEnabled = Math.random() > 0.7;
        const isBorderHEnabled = Math.random() > 0.7;
        const isShadowEnabled = Math.random() > 0.6;
        const isShadowHEnabled = Math.random() > 0.6;

        const randomConfig = {
            welcome_close_radius: Math.random() > 0.5 ? '50%' : Math.floor(Math.random() * 12) + 'px',
            welcome_close_color: randomColor(),
            welcome_close_opacity: parseFloat(Math.random().toFixed(2)),
            welcome_close_color_h_enabled: isColorHEnabled,
            welcome_close_hover_color: randomColor(),
            welcome_close_hover_opacity: parseFloat(Math.random().toFixed(2)),
            welcome_close_bg_enabled: isBgEnabled,
            welcome_close_bg: randomColor(),
            welcome_close_bg_opacity: parseFloat(Math.random().toFixed(2)),
            welcome_close_hover_bg_enabled: isBgHEnabled,
            welcome_close_hover_bg: randomColor(),
            welcome_close_hover_bg_opacity: parseFloat(Math.random().toFixed(2)),
            welcome_close_border_enabled: isBorderEnabled,
            welcome_close_border_color: randomColor(),
            welcome_close_border_opacity: parseFloat(Math.random().toFixed(2)),
            welcome_close_border_width: Math.floor(Math.random() * 4) + 'px',
            welcome_close_border_h_enabled: isBorderHEnabled,
            welcome_close_border_color_h: randomColor(),
            welcome_close_border_opacity_h: parseFloat(Math.random().toFixed(2)),
            welcome_close_border_width_h: Math.floor(Math.random() * 4) + 'px',
            welcome_close_btn_shadow_enabled: isShadowEnabled,
            welcome_close_btn_shadow_color: randomColor(),
            welcome_close_btn_shadow_opacity: parseFloat(Math.random().toFixed(2)),
            welcome_close_btn_shadow_blur: Math.floor(Math.random() * 16) + 'px',
            welcome_close_btn_shadow_h_enabled: isShadowHEnabled,
            welcome_close_btn_shadow_color_h: randomColor(),
            welcome_close_btn_shadow_opacity_h: parseFloat(Math.random().toFixed(2)),
            welcome_close_btn_shadow_blur_h: Math.floor(Math.random() * 16) + 'px'
        };

        module.state.theme = { ...module.state.theme, ...randomConfig };
        module.fillForm({ theme: module.state.theme });

        this._updateToggles({
            'welcome-close-color-h-toggle': isColorHEnabled,
            'welcome-close-bg-toggle': isBgEnabled,
            'welcome-close-hover-bg-toggle': isBgHEnabled,
            'welcome-close-border-toggle': isBorderEnabled,
            'welcome-close-border-h-toggle': isBorderHEnabled,
            'welcome-close-btn-shadow-toggle': isShadowEnabled,
            'welcome-close-btn-shadow-h-toggle': isShadowHEnabled
        });

        module.syncWithWidget();
    },

    // Магический дизайн облака
    randomizeWelcomeDesign(module) {
        const randomColor = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        const randomFont = RANDOM_FONTS[Math.floor(Math.random() * RANDOM_FONTS.length)].id;
        
        const isBgEnabled = Math.random() > 0.1;
        const isBorderEnabled = Math.random() > 0.5;
        const isShadowEnabled = Math.random() > 0.3;

        const randomConfig = {
            welcome_radius: Math.floor(Math.random() * 33) + 'px',
            welcome_text_color: randomColor(),
            welcome_text_opacity: parseFloat(Math.random().toFixed(2)),
            welcome_font_family: randomFont,
            welcome_font_size: Math.floor(Math.random() * (16 - 14 + 1) + 14) + 'px',
            welcome_font_weight: [300, 400, 500, 600, 700][Math.floor(Math.random() * 5)],
            welcome_text_align: ['left', 'center', 'right'][Math.floor(Math.random() * 3)],
            welcome_text_valign: ['top', 'center', 'bottom'][Math.floor(Math.random() * 3)],
            welcome_bg_enabled: isBgEnabled,
            welcome_bg: randomColor(),
            welcome_bg_opacity: parseFloat(Math.random().toFixed(2)),
            welcome_bg_blur: Math.floor(Math.random() * 21) + 'px',
            welcome_border_enabled: isBorderEnabled,
            welcome_border: randomColor(),
            welcome_border_opacity: parseFloat(Math.random().toFixed(2)),
            welcome_border_width: Math.floor(Math.random() * 6) + 'px',
            welcome_shadow_enabled: isShadowEnabled,
            welcome_shadow_color: randomColor(),
            welcome_shadow_opacity: parseFloat(Math.random().toFixed(2)),
            welcome_shadow_blur: Math.floor(Math.random() * 51) + 'px'
        };

        module.state.theme = { ...module.state.theme, ...randomConfig };
        module.fillForm({ theme: module.state.theme });

        this._updateToggles({
            'welcome-bg-toggle': isBgEnabled,
            'welcome-border-toggle': isBorderEnabled,
            'welcome-shadow-toggle': isShadowEnabled
        });

        if (typeof module.initWelcomeUI === 'function') {
            module.initWelcomeUI(module.state);
        }

        module.syncWithWidget();
    },

    // Магический дизайн уведомлений
    randomizeAlertDesign(module) {
        const randomColor = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        const randomFont = RANDOM_FONTS[Math.floor(Math.random() * RANDOM_FONTS.length)].id;

        const randomConfig = {
            alert_text_color: randomColor(),
            alert_text_opacity: parseFloat(Math.random().toFixed(2)),
            alert_font_family: randomFont,
            alert_font_weight: [300, 400, 500, 600, 700][Math.floor(Math.random() * 5)],
            alert_font_size: Math.floor(Math.random() * (24 - 14 + 1) + 14) + 'px',
            alert_bg_color: randomColor(),
            alert_bg_opacity: parseFloat(Math.random().toFixed(2)),
            alert_bg_blur: Math.floor(Math.random() * 21) + 'px'
        };

        module.state.theme = { ...module.state.theme, ...randomConfig };
        module.fillForm({ theme: module.state.theme });
        
        const fontSelect = document.getElementById('alert-font-family-select-container');
        if (fontSelect && fontSelect._updateFont) {
            fontSelect._updateFont(randomConfig.alert_font_family);
        }

        module.syncWithWidget();
    },

    // Магический дизайн шапки
    randomizeHeaderDesign(module) {
        const randomColor = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        
        const isBgEnabled = Math.random() > 0.2;
        const isMaskEnabled = Math.random() > 0.3;
        const isShadowEnabled = Math.random() > 0.4;

        const randomConfig = {
            header_bg_enabled: isBgEnabled,
            header_bg: randomColor(),
            header_bg_opacity: parseFloat(Math.random().toFixed(2)),
            header_bg_blur: Math.floor(Math.random() * 21) + 'px',
            header_mask_enabled: isMaskEnabled,
            header_mask_height: Math.floor(Math.random() * 51) + 'px',
            header_mask_smoothness: Math.floor(Math.random() * 101) + 'px',
            header_shadow_enabled: isShadowEnabled,
            header_shadow_color: randomColor(),
            header_shadow_opacity: parseFloat(Math.random().toFixed(2)),
            header_shadow_blur: Math.floor(Math.random() * 31) + 'px',
            header_shadow_offset_y: Math.floor(Math.random() * 11) + 'px'
        };

        module.state.theme = { ...module.state.theme, ...randomConfig };
        module.fillForm({ theme: module.state.theme });

        this._updateToggles({
            'header-bg-enabled-toggle': isBgEnabled,
            'header-mask-toggle': isMaskEnabled,
            'header-shadow-toggle': isShadowEnabled
        });

        module.syncWithWidget();
    },

    // Магический дизайн футера
    randomizeFooter(module) {
        const randomColor = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        
        const isBgEnabled = Math.random() > 0.2;
        const isMaskEnabled = Math.random() > 0.3;
        const isShadowEnabled = Math.random() > 0.4;

        const randomConfig = {
            footer_bg_enabled: isBgEnabled,
            footer_bg: randomColor(),
            footer_bg_opacity: parseFloat(Math.random().toFixed(2)),
            footer_bg_blur: Math.floor(Math.random() * 21) + 'px',
            footer_mask_enabled: isMaskEnabled,
            footer_mask_height: Math.floor(Math.random() * 51) + 'px',
            footer_mask_smoothness: Math.floor(Math.random() * 101) + 'px',
            footer_shadow_enabled: isShadowEnabled,
            footer_shadow_color: randomColor(),
            footer_shadow_opacity: parseFloat(Math.random().toFixed(2)),
            footer_shadow_blur: Math.floor(Math.random() * 31) + 'px',
            footer_shadow_offset_y: Math.floor(Math.random() * 11) + 'px'
        };

        Object.assign(module.state.theme, randomConfig);
        module.fillForm({ theme: module.state.theme });

        this._updateToggles({
            'footer-bg-toggle': isBgEnabled,
            'footer-mask-toggle': isMaskEnabled,
            'footer-shadow-toggle': isShadowEnabled
        });

        module.syncWithWidget();
    },

    // Магический дизайн карточки ЧАТ
    randomizeChatDesign(module) {
        const randomColor = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        const randomFont = RANDOM_FONTS[Math.floor(Math.random() * RANDOM_FONTS.length)].id;
        
        const isLinkHEnabled = Math.random() > 0.3;

        const randomConfig = {
            chat_privacy_font_family: randomFont,
            chat_privacy_text_color: randomColor(),
            chat_privacy_text_opacity: Math.floor(Math.random() * 101),
            chat_privacy_font_size: Math.floor(Math.random() * (18 - 12 + 1) + 12) + 'px',
            chat_privacy_font_weight: [300, 400, 500, 600, 700][Math.floor(Math.random() * 5)],
            
            chat_link_color: randomColor(),
            chat_link_opacity: Math.floor(Math.random() * 101),
            chat_link_h_enabled: isLinkHEnabled,
            chat_link_color_h: randomColor(),
            chat_link_opacity_h: Math.floor(Math.random() * 101),
            
            chat_date_font_family: randomFont,
            chat_date_color: randomColor(),
            chat_date_opacity: Math.floor(Math.random() * 101),
            chat_date_font_size: Math.floor(Math.random() * (16 - 12 + 1) + 12) + 'px',
            chat_date_font_weight: [300, 400, 500, 600, 700][Math.floor(Math.random() * 5)],
            
            chat_time_font_family: randomFont,
            chat_time_color: randomColor(),
            chat_time_opacity: Math.floor(Math.random() * 101),
            chat_time_font_size: Math.floor(Math.random() * (14 - 10 + 1) + 10) + 'px',
            chat_time_font_weight: [300, 400, 500, 600, 700][Math.floor(Math.random() * 5)],
            chat_typing_indicator_color: randomColor()
        };

        module.state.theme = { ...module.state.theme, ...randomConfig };
        module.fillForm({ theme: module.state.theme });

        this._updateToggles({
            'chat-link-h-enabled-toggle': isLinkHEnabled
        });

        module.syncWithWidget();
    },

    // Магический дизайн кнопок шапки
    randomizeHeaderButtonsDesign(module) {
        const randomColor = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        
        const types = ['close', 'expand'];
        const randomConfig = {};

        types.forEach(type => {
            const prefix = `header_btn_${type}`;
            const isColorHEnabled = Math.random() > 0.3;
            const isBgEnabled = Math.random() > 0.2;
            const isBgHEnabled = Math.random() > 0.3;
            const isBorderEnabled = Math.random() > 0.7;
            const isBorderHEnabled = Math.random() > 0.7;
            const isShadowEnabled = Math.random() > 0.6;
            const isShadowHEnabled = Math.random() > 0.6;

            Object.assign(randomConfig, {
                [`${prefix}_radius`]: Math.random() > 0.5 ? '50%' : Math.floor(Math.random() * 12) + 'px',
                [`${prefix}_color`]: randomColor(),
                [`${prefix}_opacity`]: parseFloat(Math.random().toFixed(2)),
                [`${prefix}_color_h_enabled`]: isColorHEnabled,
                [`${prefix}_color_h`]: randomColor(),
                [`${prefix}_opacity_h`]: parseFloat(Math.random().toFixed(2)),
                [`${prefix}_bg_enabled`]: isBgEnabled,
                [`${prefix}_bg`]: randomColor(),
                [`${prefix}_bg_opacity`]: parseFloat(Math.random().toFixed(2)),
                [`${prefix}_bg_blur`]: Math.floor(Math.random() * 21) + 'px',
                [`${prefix}_bg_h_enabled`]: isBgHEnabled,
                [`${prefix}_bg_h`]: randomColor(),
                [`${prefix}_bg_opacity_h`]: parseFloat(Math.random().toFixed(2)),
                [`${prefix}_bg_h_blur`]: Math.floor(Math.random() * 21) + 'px',
                [`${prefix}_border_enabled`]: isBorderEnabled,
                [`${prefix}_border_color`]: randomColor(),
                [`${prefix}_border_opacity`]: parseFloat(Math.random().toFixed(2)),
                [`${prefix}_border_width`]: Math.floor(Math.random() * 4) + 'px',
                [`${prefix}_border_h_enabled`]: isBorderHEnabled,
                [`${prefix}_border_color_h`]: randomColor(),
                [`${prefix}_border_opacity_h`]: parseFloat(Math.random().toFixed(2)),
                [`${prefix}_border_width_h`]: Math.floor(Math.random() * 4) + 'px',
                [`${prefix}_shadow_enabled`]: isShadowEnabled,
                [`${prefix}_shadow_color`]: randomColor(),
                [`${prefix}_shadow_opacity`]: parseFloat(Math.random().toFixed(2)),
                [`${prefix}_shadow_blur`]: Math.floor(Math.random() * 16) + 'px',
                [`${prefix}_shadow_h_enabled`]: isShadowHEnabled,
                [`${prefix}_shadow_color_h`]: randomColor(),
                [`${prefix}_shadow_opacity_h`]: parseFloat(Math.random().toFixed(2)),
                [`${prefix}_shadow_blur_h`]: Math.floor(Math.random() * 16) + 'px'
            });
        });

        module.state.theme = { ...module.state.theme, ...randomConfig };
        module.fillForm({ theme: module.state.theme });

        // Обновляем тумблеры для текущего выбранного типа кнопки в UI
        const currentType = module.currentHeaderBtnType || 'close';
        this._updateToggles({
            'header-btn-color-h-toggle': randomConfig[`header_btn_${currentType}_color_h_enabled`],
            'header-btn-bg-enabled-toggle': randomConfig[`header_btn_${currentType}_bg_enabled`],
            'header-btn-bg-h-toggle': randomConfig[`header_btn_${currentType}_bg_h_enabled`],
            'header-btn-border-enabled-toggle': randomConfig[`header_btn_${currentType}_border_enabled`],
            'header-btn-border-h-toggle': randomConfig[`header_btn_${currentType}_border_h_enabled`],
            'header-btn-shadow-toggle': randomConfig[`header_btn_${currentType}_shadow_enabled`],
            'header-btn-shadow-h-toggle': randomConfig[`header_btn_${currentType}_shadow_h_enabled`]
        });

        module.syncWithWidget();
    },

    // Магический дизайн сообщений
    randomizeMessagesDesign(module, type) {
        const randomColor = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        const randomFont = RANDOM_FONTS[Math.floor(Math.random() * RANDOM_FONTS.length)].id;
        
        const prefix = `msg_${type}`;
        const isBgEnabled = Math.random() > 0.2;
        const isBorderEnabled = Math.random() > 0.5;
        const isLinkHEnabled = Math.random() > 0.5;

        const randomConfig = {
            [`${prefix}_font_family`]: randomFont,
            [`${prefix}_text_color`]: randomColor(),
            [`${prefix}_text_opacity`]: parseFloat(Math.random().toFixed(2)),
            [`${prefix}_font_size`]: Math.floor(Math.random() * (20 - 14 + 1) + 14) + 'px',
            [`${prefix}_font_weight`]: [300, 400, 500, 600, 700][Math.floor(Math.random() * 5)],
            [`${prefix}_bg_enabled`]: isBgEnabled,
            [`${prefix}_bg_color`]: randomColor(),
            [`${prefix}_bg_opacity`]: parseFloat(Math.random().toFixed(2)),
            [`${prefix}_border_enabled`]: isBorderEnabled,
            [`${prefix}_border_color`]: randomColor(),
            [`${prefix}_border_opacity`]: parseFloat(Math.random().toFixed(2)),
            [`${prefix}_border_width`]: Math.floor(Math.random() * 6) + 'px',
            
            // Ссылки
            [`${prefix}_link_color`]: randomColor(),
            [`${prefix}_link_opacity`]: parseFloat(Math.random().toFixed(2)),
            [`${prefix}_link_h_enabled`]: isLinkHEnabled,
            [`${prefix}_link_color_h`]: randomColor(),
            [`${prefix}_link_opacity_h`]: parseFloat(Math.random().toFixed(2))
        };

        module.state.theme = { ...module.state.theme, ...randomConfig };
        module.fillForm({ theme: module.state.theme });

        this._updateToggles({
            [`msg-${type}-bg-enabled-toggle`]: isBgEnabled,
            [`msg-${type}-border-enabled-toggle`]: isBorderEnabled,
            [`msg-${type}-link-h-enabled-toggle`]: isLinkHEnabled
        });

        module.syncWithWidget();
    },

    // Магический дизайн изображений
    randomizeMediaDesign(module) {
        const randomColor = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        
        const isBorderEnabled = Math.random() > 0.5;
        const isBorderHEnabled = Math.random() > 0.5;
        const isShadowEnabled = Math.random() > 0.4;
        const isShadowHEnabled = Math.random() > 0.4;

        const randomConfig = {
            msg_img_radius: Math.floor(Math.random() * 33) + 'px',
            msg_img_border_enabled: isBorderEnabled,
            msg_img_border_color: randomColor(),
            msg_img_border_opacity: parseFloat(Math.random().toFixed(2)),
            msg_img_border_width: Math.floor(Math.random() * 6) + 'px',
            msg_img_border_h_enabled: isBorderHEnabled,
            msg_img_border_color_h: randomColor(),
            msg_img_border_opacity_h: parseFloat(Math.random().toFixed(2)),
            msg_img_border_width_h: Math.floor(Math.random() * 6) + 'px',
            msg_img_shadow_enabled: isShadowEnabled,
            msg_img_shadow_color: randomColor(),
            msg_img_shadow_opacity: parseFloat(Math.random().toFixed(2)),
            msg_img_shadow_blur: Math.floor(Math.random() * 31) + 'px',
            msg_img_shadow_h_enabled: isShadowHEnabled,
            msg_img_shadow_color_h: randomColor(),
            msg_img_shadow_opacity_h: parseFloat(Math.random().toFixed(2)),
            msg_img_shadow_blur_h: Math.floor(Math.random() * 51) + 'px'
        };

        module.state.theme = { ...module.state.theme, ...randomConfig };
        module.fillForm({ theme: module.state.theme });

        this._updateToggles({
            'msg-img-border-toggle': isBorderEnabled,
            'msg-img-border-h-toggle': isBorderHEnabled,
            'msg-img-shadow-toggle': isShadowEnabled,
            'msg-img-shadow-h-toggle': isShadowHEnabled
        });

        module.syncWithWidget();
    },

    // Магический дизайн кнопок
    randomizeButtonsDesign(module) {
        const randomColor = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        const randomFont = RANDOM_FONTS[Math.floor(Math.random() * RANDOM_FONTS.length)].id;
        
        const types = ['accent', 'neutral', 'info'];
        const randomConfig = {};

        types.forEach(type => {
            const isBgEnabled = Math.random() > 0.1;
            const isBgHEnabled = Math.random() > 0.2;
            const isTextHEnabled = Math.random() > 0.2;
            const isBorderEnabled = Math.random() > 0.5;
            const isBorderHEnabled = Math.random() > 0.5;
            const isShadowEnabled = Math.random() > 0.4;
            const isShadowHEnabled = Math.random() > 0.4;

            Object.assign(randomConfig, {
                [`inline_btn_${type}_radius`]: Math.floor(Math.random() * 31) + 'px',
                [`inline_btn_${type}_font_family`]: randomFont,
                [`inline_btn_${type}_font_size`]: Math.floor(Math.random() * (18 - 12 + 1) + 12) + 'px',
                [`inline_btn_${type}_font_weight`]: [300, 400, 500, 600, 700][Math.floor(Math.random() * 5)],
                [`inline_btn_${type}_text`]: randomColor(),
                [`inline_btn_${type}_text_opacity`]: parseFloat(Math.random().toFixed(2)),
                [`inline_btn_${type}_text_h_enabled`]: isTextHEnabled,
                [`inline_btn_${type}_text_h`]: randomColor(),
                [`inline_btn_${type}_text_opacity_h`]: parseFloat(Math.random().toFixed(2)),
                [`inline_btn_${type}_bg_enabled`]: isBgEnabled,
                [`inline_btn_${type}_bg`]: randomColor(),
                [`inline_btn_${type}_bg_opacity`]: parseFloat(Math.random().toFixed(2)),
                [`inline_btn_${type}_bg_h_enabled`]: isBgHEnabled,
                [`inline_btn_${type}_bg_h`]: randomColor(),
                [`inline_btn_${type}_bg_opacity_h`]: parseFloat(Math.random().toFixed(2)),
                [`inline_btn_${type}_border_enabled`]: isBorderEnabled,
                [`inline_btn_${type}_border_color`]: randomColor(),
                [`inline_btn_${type}_border_width`]: Math.floor(Math.random() * 5 + 1) + 'px',
                [`inline_btn_${type}_border_opacity`]: parseFloat(Math.random().toFixed(2)),
                [`inline_btn_${type}_border_h_enabled`]: isBorderHEnabled,
                [`inline_btn_${type}_border_color_h`]: randomColor(),
                [`inline_btn_${type}_border_width_h`]: Math.floor(Math.random() * 5 + 1) + 'px',
                [`inline_btn_${type}_border_opacity_h`]: parseFloat(Math.random().toFixed(2)),
                [`inline_btn_${type}_shadow_enabled`]: isShadowEnabled,
                [`inline_btn_${type}_shadow_color`]: randomColor(),
                [`inline_btn_${type}_shadow_opacity`]: parseFloat(Math.random().toFixed(2)),
                [`inline_btn_${type}_shadow_blur`]: Math.floor(Math.random() * 40 + 5) + 'px',
                [`inline_btn_${type}_shadow_h_enabled`]: isShadowHEnabled,
                [`inline_btn_${type}_shadow_color_h`]: randomColor(),
                [`inline_btn_${type}_shadow_opacity_h`]: parseFloat(Math.random().toFixed(2)),
                [`inline_btn_${type}_shadow_blur_h`]: Math.floor(Math.random() * 40 + 5) + 'px'
            });
        });

        module.state.theme = { ...module.state.theme, ...randomConfig };
        
        if (module.updateButtonForm) {
            module.updateButtonForm();
        }

        const currentType = module.currentButtonStyle || 'accent';
        this._updateToggles({
            'inline-btn-bg-toggle': randomConfig[`inline_btn_${currentType}_bg_enabled`],
            'inline-btn-bg-h-toggle': randomConfig[`inline_btn_${currentType}_bg_h_enabled`],
            'inline-btn-text-h-toggle': randomConfig[`inline_btn_${currentType}_text_h_enabled`],
            'inline-btn-border-toggle': randomConfig[`inline_btn_${currentType}_border_enabled`],
            'inline-btn-border-h-toggle': randomConfig[`inline_btn_${currentType}_border_h_enabled`],
            'inline-btn-shadow-toggle': randomConfig[`inline_btn_${currentType}_shadow_enabled`],
            'inline-btn-shadow-h-toggle': randomConfig[`inline_btn_${currentType}_shadow_h_enabled`]
        });

        module.syncWithWidget();
    },

    // Магический дизайн кнопки отправки
    randomizeSendBtn(module) {
        const randomColor = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        
        const isIconHEnabled = Math.random() > 0.3;
        const isBgEnabled = Math.random() > 0.1;
        const isBgHEnabled = Math.random() > 0.2;
        const isBorderEnabled = Math.random() > 0.7;
        const isBorderHEnabled = Math.random() > 0.7;
        const isShadowEnabled = Math.random() > 0.5;
        const isShadowHEnabled = Math.random() > 0.5;

        const randomConfig = {
            "btn_send_radius": Math.random() > 0.5 ? "50%" : Math.floor(Math.random() * 21) + "px",
            "btn_send_icon_color": randomColor(),
            "btn_send_icon_opacity": parseFloat(Math.random().toFixed(2)),
            "btn_send_icon_h_enabled": isIconHEnabled,
            "btn_send_icon_color_h": randomColor(),
            "btn_send_icon_opacity_h": parseFloat(Math.random().toFixed(2)),
            "btn_send_bg_enabled": isBgEnabled,
            "btn_send_bg_color": randomColor(),
            "btn_send_bg_opacity": parseFloat(Math.random().toFixed(2)),
            "btn_send_bg_h_enabled": isBgHEnabled,
            "btn_send_bg_color_h": randomColor(),
            "btn_send_bg_opacity_h": parseFloat(Math.random().toFixed(2)),
            "btn_send_border_enabled": isBorderEnabled,
            "btn_send_border_color": randomColor(),
            "btn_send_border_opacity": parseFloat(Math.random().toFixed(2)),
            "btn_send_border_width": Math.floor(Math.random() * 5 + 1) + "px",
            "btn_send_border_h_enabled": isBorderHEnabled,
            "btn_send_border_color_h": randomColor(),
            "btn_send_border_opacity_h": parseFloat(Math.random().toFixed(2)),
            "btn_send_border_width_h": Math.floor(Math.random() * 5 + 1) + "px",
            "btn_send_shadow_enabled": isShadowEnabled,
            "btn_send_shadow_color": randomColor(),
            "btn_send_shadow_opacity": parseFloat(Math.random().toFixed(2)),
            "btn_send_shadow_blur": Math.floor(Math.random() * 31) + "px",
            "btn_send_shadow_h_enabled": isShadowHEnabled,
            "btn_send_shadow_color_h": randomColor(),
            "btn_send_shadow_opacity_h": parseFloat(Math.random().toFixed(2)),
            "btn_send_shadow_blur_h": Math.floor(Math.random() * 31) + "px"
        };

        module.state.theme = { ...module.state.theme, ...randomConfig };
        module.fillForm({ theme: module.state.theme });

        this._updateToggles({
            'btn-send-icon-h-toggle': isIconHEnabled,
            'btn-send-bg-toggle': isBgEnabled,
            'btn-send-bg-h-toggle': isBgHEnabled,
            'btn-send-border-toggle': isBorderEnabled,
            'btn-send-border-h-toggle': isBorderHEnabled,
            'btn-send-shadow-toggle': isShadowEnabled,
            'btn-send-shadow-h-toggle': isShadowHEnabled
        });

        module.syncWithWidget();
    },

    // Магический дизайн кнопки паузы
    randomizeStopBtn(module) {
        const randomColor = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        
        const isIconHEnabled = Math.random() > 0.3;
        const isBgEnabled = Math.random() > 0.1;
        const isBgHEnabled = Math.random() > 0.2;
        const isBorderEnabled = Math.random() > 0.7;
        const isBorderHEnabled = Math.random() > 0.7;
        const isShadowEnabled = Math.random() > 0.5;
        const isShadowHEnabled = Math.random() > 0.5;

        const randomConfig = {
            "btn_stop_radius": Math.random() > 0.5 ? "50%" : Math.floor(Math.random() * 21) + "px",
            "btn_stop_icon_color": randomColor(),
            "btn_stop_icon_opacity": parseFloat(Math.random().toFixed(2)),
            "btn_stop_icon_h_enabled": isIconHEnabled,
            "btn_stop_icon_color_h": randomColor(),
            "btn_stop_icon_opacity_h": parseFloat(Math.random().toFixed(2)),
            "btn_stop_bg_enabled": isBgEnabled,
            "btn_stop_bg_color": randomColor(),
            "btn_stop_bg_opacity": parseFloat(Math.random().toFixed(2)),
            "btn_stop_bg_h_enabled": isBgHEnabled,
            "btn_stop_bg_color_h": randomColor(),
            "btn_stop_bg_opacity_h": parseFloat(Math.random().toFixed(2)),
            "btn_stop_border_enabled": isBorderEnabled,
            "btn_stop_border_color": randomColor(),
            "btn_stop_border_opacity": parseFloat(Math.random().toFixed(2)),
            "btn_stop_border_width": Math.floor(Math.random() * 5 + 1) + "px",
            "btn_stop_border_h_enabled": isBorderHEnabled,
            "btn_stop_border_color_h": randomColor(),
            "btn_stop_border_opacity_h": parseFloat(Math.random().toFixed(2)),
            "btn_stop_border_width_h": Math.floor(Math.random() * 5 + 1) + "px",
            "btn_stop_shadow_enabled": isShadowEnabled,
            "btn_stop_shadow_color": randomColor(),
            "btn_stop_shadow_opacity": parseFloat(Math.random().toFixed(2)),
            "btn_stop_shadow_blur": Math.floor(Math.random() * 31) + "px",
            "btn_stop_shadow_h_enabled": isShadowHEnabled,
            "btn_stop_shadow_color_h": randomColor(),
            "btn_stop_shadow_opacity_h": parseFloat(Math.random().toFixed(2)),
            "btn_stop_shadow_blur_h": Math.floor(Math.random() * 31) + "px"
        };

        module.state.theme = { ...module.state.theme, ...randomConfig };
        module.fillForm({ theme: module.state.theme });

        this._updateToggles({
            'btn-stop-icon-h-toggle': isIconHEnabled,
            'btn-stop-bg-toggle': isBgEnabled,
            'btn-stop-bg-h-toggle': isBgHEnabled,
            'btn-stop-border-toggle': isBorderEnabled,
            'btn-stop-border-h-toggle': isBorderHEnabled,
            'btn-stop-shadow-toggle': isShadowEnabled,
            'btn-stop-shadow-h-toggle': isShadowHEnabled
        });

        module.syncWithWidget();
    },

    // Магический дизайн кнопки микрофона
    randomizeMicBtn(module) {
        const randomColor = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        
        const isIconHEnabled = Math.random() > 0.3;
        const isBgEnabled = Math.random() > 0.1;
        const isBgHEnabled = Math.random() > 0.2;
        const isBorderEnabled = Math.random() > 0.7;
        const isBorderHEnabled = Math.random() > 0.7;
        const isShadowEnabled = Math.random() > 0.5;
        const isShadowHEnabled = Math.random() > 0.5;

        const randomConfig = {
            "btn_mic_radius": Math.random() > 0.5 ? "50%" : Math.floor(Math.random() * 21) + "px",
            "btn_mic_icon_color": randomColor(),
            "btn_mic_icon_opacity": parseFloat(Math.random().toFixed(2)),
            "btn_mic_icon_h_enabled": isIconHEnabled,
            "btn_mic_icon_color_h": randomColor(),
            "btn_mic_icon_opacity_h": parseFloat(Math.random().toFixed(2)),
            "btn_mic_bg_enabled": isBgEnabled,
            "btn_mic_bg_color": randomColor(),
            "btn_mic_bg_opacity": parseFloat(Math.random().toFixed(2)),
            "btn_mic_bg_h_enabled": isBgHEnabled,
            "btn_mic_bg_color_h": randomColor(),
            "btn_mic_bg_opacity_h": parseFloat(Math.random().toFixed(2)),
            "btn_mic_border_enabled": isBorderEnabled,
            "btn_mic_border_color": randomColor(),
            "btn_mic_border_opacity": parseFloat(Math.random().toFixed(2)),
            "btn_mic_border_width": Math.floor(Math.random() * 5 + 1) + "px",
            "btn_mic_border_h_enabled": isBorderHEnabled,
            "btn_mic_border_color_h": randomColor(),
            "btn_mic_border_opacity_h": parseFloat(Math.random().toFixed(2)),
            "btn_mic_border_width_h": Math.floor(Math.random() * 5 + 1) + "px",
            "btn_mic_shadow_enabled": isShadowEnabled,
            "btn_mic_shadow_color": randomColor(),
            "btn_mic_shadow_opacity": parseFloat(Math.random().toFixed(2)),
            "btn_mic_shadow_blur": Math.floor(Math.random() * 31) + "px",
            "btn_mic_shadow_h_enabled": isShadowHEnabled,
            "btn_mic_shadow_color_h": randomColor(),
            "btn_mic_shadow_opacity_h": parseFloat(Math.random().toFixed(2)),
            "btn_mic_shadow_blur_h": Math.floor(Math.random() * 31) + "px"
        };

        module.state.theme = { ...module.state.theme, ...randomConfig };
        module.fillForm({ theme: module.state.theme });

        this._updateToggles({
            'btn-mic-icon-h-toggle': isIconHEnabled,
            'btn-mic-bg-toggle': isBgEnabled,
            'btn-mic-bg-h-toggle': isBgHEnabled,
            'btn-mic-border-toggle': isBorderEnabled,
            'btn-mic-border-h-toggle': isBorderHEnabled,
            'btn-mic-shadow-toggle': isShadowEnabled,
            'btn-mic-shadow-h-toggle': isShadowHEnabled
        });

        module.syncWithWidget();
    },

    // Магический дизайн кнопки вложений
    randomizeAttachBtn(module) {
        const randomColor = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        
        const isIconHEnabled = Math.random() > 0.3;
        const isBgEnabled = Math.random() > 0.1;
        const isBgHEnabled = Math.random() > 0.2;
        const isBorderEnabled = Math.random() > 0.7;
        const isBorderHEnabled = Math.random() > 0.7;
        const isShadowEnabled = Math.random() > 0.5;
        const isShadowHEnabled = Math.random() > 0.5;

        const randomConfig = {
            "btn_attach_enabled": true,
            "btn_attach_radius": Math.random() > 0.5 ? "50%" : Math.floor(Math.random() * 21) + "px",
            "btn_attach_icon_color": randomColor(),
            "btn_attach_icon_opacity": parseFloat(Math.random().toFixed(2)),
            "btn_attach_icon_h_enabled": isIconHEnabled,
            "btn_attach_icon_color_h": randomColor(),
            "btn_attach_icon_opacity_h": parseFloat(Math.random().toFixed(2)),
            "btn_attach_bg_enabled": isBgEnabled,
            "btn_attach_bg_color": randomColor(),
            "btn_attach_bg_opacity": parseFloat(Math.random().toFixed(2)),
            "btn_attach_bg_h_enabled": isBgHEnabled,
            "btn_attach_bg_color_h": randomColor(),
            "btn_attach_bg_opacity_h": parseFloat(Math.random().toFixed(2)),
            "btn_attach_border_enabled": isBorderEnabled,
            "btn_attach_border_color": randomColor(),
            "btn_attach_border_opacity": parseFloat(Math.random().toFixed(2)),
            "btn_attach_border_width": Math.floor(Math.random() * 5 + 1) + "px",
            "btn_attach_border_h_enabled": isBorderHEnabled,
            "btn_attach_border_color_h": randomColor(),
            "btn_attach_border_opacity_h": parseFloat(Math.random().toFixed(2)),
            "btn_attach_border_width_h": Math.floor(Math.random() * 5 + 1) + "px",
            "btn_attach_shadow_enabled": isShadowEnabled,
            "btn_attach_shadow_color": randomColor(),
            "btn_attach_shadow_opacity": parseFloat(Math.random().toFixed(2)),
            "btn_attach_shadow_blur": Math.floor(Math.random() * 31) + "px",
            "btn_attach_shadow_h_enabled": isShadowHEnabled,
            "btn_attach_shadow_color_h": randomColor(),
            "btn_attach_shadow_opacity_h": parseFloat(Math.random().toFixed(2)),
            "btn_attach_shadow_blur_h": Math.floor(Math.random() * 31) + "px"
        };

        module.state.theme = { ...module.state.theme, ...randomConfig };
        module.fillForm({ theme: module.state.theme });

        this._updateToggles({
            'btn-attach-enabled-toggle': true,
            'btn-attach-icon-h-toggle': isIconHEnabled,
            'btn-attach-bg-toggle': isBgEnabled,
            'btn-attach-bg-h-toggle': isBgHEnabled,
            'btn-attach-border-toggle': isBorderEnabled,
            'btn-attach-border-h-toggle': isBorderHEnabled,
            'btn-attach-shadow-toggle': isShadowEnabled,
            'btn-attach-shadow-h-toggle': isShadowHEnabled
        });

        module.syncWithWidget();
    },

    // Магический дизайн кнопки записи
    randomizeRecordBtn(module) {
        const randomColor = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        
        const isIconHEnabled = Math.random() > 0.3;
        const isBgEnabled = Math.random() > 0.1;
        const isBgHEnabled = Math.random() > 0.2;
        const isBorderEnabled = Math.random() > 0.7;
        const isBorderHEnabled = Math.random() > 0.7;
        const isShadowEnabled = Math.random() > 0.5;
        const isShadowHEnabled = Math.random() > 0.5;

        const randomConfig = {
            "btn_record_radius": Math.random() > 0.5 ? "50%" : Math.floor(Math.random() * 21) + "px",
            "btn_record_icon_color": randomColor(),
            "btn_record_icon_opacity": parseFloat(Math.random().toFixed(2)),
            "btn_record_icon_h_enabled": isIconHEnabled,
            "btn_record_icon_color_h": randomColor(),
            "btn_record_icon_opacity_h": parseFloat(Math.random().toFixed(2)),
            "btn_record_bg_enabled": isBgEnabled,
            "btn_record_bg_color": randomColor(),
            "btn_record_bg_opacity": parseFloat(Math.random().toFixed(2)),
            "btn_record_bg_h_enabled": isBgHEnabled,
            "btn_record_bg_color_h": randomColor(),
            "btn_record_bg_opacity_h": parseFloat(Math.random().toFixed(2)),
            "btn_record_border_enabled": isBorderEnabled,
            "btn_record_border_color": randomColor(),
            "btn_record_border_opacity": parseFloat(Math.random().toFixed(2)),
            "btn_record_border_width": Math.floor(Math.random() * 5 + 1) + "px",
            "btn_record_border_h_enabled": isBorderHEnabled,
            "btn_record_border_color_h": randomColor(),
            "btn_record_border_opacity_h": parseFloat(Math.random().toFixed(2)),
            "btn_record_border_width_h": Math.floor(Math.random() * 5 + 1) + "px",
            "btn_record_shadow_enabled": isShadowEnabled,
            "btn_record_shadow_color": randomColor(),
            "btn_record_shadow_opacity": parseFloat(Math.random().toFixed(2)),
            "btn_record_shadow_blur": Math.floor(Math.random() * 31) + "px",
            "btn_record_shadow_h_enabled": isShadowHEnabled,
            "btn_record_shadow_color_h": randomColor(),
            "btn_record_shadow_opacity_h": parseFloat(Math.random().toFixed(2)),
            "btn_record_shadow_blur_h": Math.floor(Math.random() * 31) + "px"
        };

        module.state.theme = { ...module.state.theme, ...randomConfig };
        module.fillForm({ theme: module.state.theme });

        this._updateToggles({
            'btn-record-icon-h-toggle': isIconHEnabled,
            'btn-record-bg-toggle': isBgEnabled,
            'btn-record-bg-h-toggle': isBgHEnabled,
            'btn-record-border-toggle': isBorderEnabled,
            'btn-record-border-h-toggle': isBorderHEnabled,
            'btn-record-shadow-toggle': isShadowEnabled,
            'btn-record-shadow-h-toggle': isShadowHEnabled
        });

        module.syncWithWidget();
    },

    // Магический дизайн вложений
    randomizeAttachmentsDesign(module) {
        const randomColor = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        const randomFont = RANDOM_FONTS[Math.floor(Math.random() * RANDOM_FONTS.length)].id;
        
        const isBgEnabled = Math.random() > 0.1;
        const isBorderEnabled = Math.random() > 0.5;
        const isShadowEnabled = Math.random() > 0.4;

        const randomConfig = {
            attach_item_height: Math.floor(Math.random() * (48 - 24 + 1) + 24) + 'px',
            attach_item_radius: Math.floor(Math.random() * 21) + 'px',
            attach_item_font_family: randomFont,
            attach_item_text_color: randomColor(),
            attach_item_text_opacity: parseFloat(Math.random().toFixed(2)),
            attach_item_font_size: Math.floor(Math.random() * (16 - 11 + 1) + 11) + 'px',
            attach_item_font_weight: [300, 400, 500, 600, 700][Math.floor(Math.random() * 5)],
            attach_item_bg_enabled: isBgEnabled,
            attach_item_bg_color: randomColor(),
            attach_item_bg_opacity: parseFloat(Math.random().toFixed(2)),
            attach_item_bg_blur: Math.floor(Math.random() * 11) + 'px',
            attach_item_border_enabled: isBorderEnabled,
            attach_item_border_color: randomColor(),
            attach_item_border_opacity: parseFloat(Math.random().toFixed(2)),
            attach_item_border_width: Math.floor(Math.random() * 4) + 'px',
            attach_item_shadow_enabled: isShadowEnabled,
            attach_item_shadow_color: randomColor(),
            attach_item_shadow_opacity: parseFloat(Math.random().toFixed(2)),
            attach_item_shadow_blur: Math.floor(Math.random() * 21) + 'px'
        };

        module.state.theme = { ...module.state.theme, ...randomConfig };
        module.fillForm({ theme: module.state.theme });

        this._updateToggles({
            'attach-item-bg-toggle': isBgEnabled,
            'attach-item-border-toggle': isBorderEnabled,
            'attach-item-shadow-toggle': isShadowEnabled
        });

        const fontSelect = document.getElementById('attach-item-font-family-select-container');
        if (fontSelect && fontSelect._updateFont) {
            fontSelect._updateFont(randomConfig.attach_item_font_family);
        }

        module.syncWithWidget();
    },

    // Магический дизайн поля ввода
    randomizeInputDesign(module) {
        const randomColor = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        
        const isBgEnabled = Math.random() > 0.2;
        const isBorderEnabled = Math.random() > 0.5;
        const isShadowEnabled = Math.random() > 0.4;

        const randomConfig = {
            input_radius: Math.floor(Math.random() * 33) + 'px',
            input_text_color: randomColor(),
            input_text_opacity: parseFloat(Math.random().toFixed(2)),
            input_placeholder_color: randomColor(),
            input_placeholder_opacity: parseFloat(Math.random().toFixed(2)),
            input_bg: randomColor(),
            input_bg_opacity: parseFloat(Math.random().toFixed(2)),
            input_bg_blur: Math.floor(Math.random() * 21) + 'px',
            input_border_enabled: isBorderEnabled,
            input_border_color: randomColor(),
            input_border_opacity: parseFloat(Math.random().toFixed(2)),
            input_border_width: Math.floor(Math.random() * 6) + 'px',
            input_active_border_enabled: Math.random() > 0.3,
            input_active_border_color: randomColor(),
            input_active_border_opacity: parseFloat(Math.random().toFixed(2)),
            input_active_border_width: Math.floor(Math.random() * 6) + 'px',
            input_shadow_enabled: isShadowEnabled,
            input_shadow_color: randomColor(),
            input_shadow_opacity: parseFloat(Math.random().toFixed(2)),
            input_shadow_blur: Math.floor(Math.random() * 31) + 'px',
            input_active_shadow_enabled: Math.random() > 0.4,
            input_active_shadow_color: randomColor(),
            input_active_shadow_opacity: parseFloat(Math.random().toFixed(2)),
            input_active_shadow_blur: Math.floor(Math.random() * 31) + 'px'
        };

        module.state.theme = { ...module.state.theme, ...randomConfig };
        module.fillForm({ theme: module.state.theme });

        this._updateToggles({
            'input-border-toggle': isBorderEnabled,
            'input-active-border-toggle': randomConfig.input_active_border_enabled,
            'input-shadow-toggle': isShadowEnabled,
            'input-active-shadow-toggle': randomConfig.input_active_shadow_enabled
        });

        module.syncWithWidget();
    },

    applyMagicDesign(module) {
        console.log('[MagicDesign] Applying Global Magic Design...');
        this.randomizeWidgetDesign(module);
        this.randomizeWelcomeDesign(module);
        this.randomizeWelcomeCloseDesign(module);
        this.randomizeWindowDesign(module);
        this.randomizeHeaderDesign(module);
        this.randomizeHeaderButtonsDesign(module);
        this.randomizeChatDesign(module);
        this.randomizeMediaDesign(module);
        this.randomizeButtonsDesign(module);
        this.randomizeSendBtn(module);
        this.randomizeStopBtn(module);
        this.randomizeMicBtn(module);
        this.randomizeRecordBtn(module);
        this.randomizeAttachBtn(module);
        this.randomizeFooter(module);
        this.randomizeInputDesign(module);
        
        module.syncWithWidget();
    }
};
