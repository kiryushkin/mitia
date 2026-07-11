import { MagicDesignModule } from '../magic-design.js';

export function initWindowSettings(context) {
    context.setupToggle('chat-auto-open-toggle', null, 'theme.window_auto_open');
    context.setupToggle('chat-draggable-toggle', null, 'theme.window_draggable');
    context.setupToggle('chat-expand-default-toggle', null, 'theme.window_expand_default');
    context.setupToggle('chat-resizable-toggle', null, 'theme.window_resizable');
    context.setupRange('chat-width-input', 'chat-width-val', '%', 'window_width', true);
    context.setupRange('chat-height-input', 'chat-height-val', '%', 'window_height', true);
    context.setupRange('chat-left-input', 'chat-left-val', '%', 'window_left', true);
    context.setupRange('chat-top-input', 'chat-top-val', '%', 'window_top', true);
    context.setupRange('chat-radius-input', 'chat-radius-val', 'px', 'window_radius', false);
    context.setupToggle('chat-window-img-enabled-toggle', 'chat-window-img-group', 'theme.window_bg_img_enabled');
    context.setupImageUpload('chat-window-img-upload', 'chat-window-img-preview', 'window_bg_img');
    context.setupRange('chat-window-img-opacity-input', 'chat-window-img-opacity-val', '%', 'window_bg_img_opacity', true);
    context.setupToggle('chat-bg-toggle', 'chat-bg-group', 'theme.window_bg_enabled');
    context.setupColorSync('chat-bg-picker', 'chat-bg-hex', 'chat-bg-preview', 'window_bg');
    context.setupRange('chat-opacity-input', 'chat-opacity-val', '%', 'window_bg_opacity', true);
    context.setupRange('chat-blur-input', 'chat-blur-val', 'px', 'window_bg_blur', true);
    context.setupToggle('chat-border-toggle', 'chat-border-group', 'theme.window_border_enabled');
    context.setupColorSync('chat-border-picker', 'chat-border-hex', 'chat-border-preview', 'window_border_color');
    context.setupRange('chat-border-width-input', 'chat-border-width-val', 'px', 'window_border_width', true);
    context.setupRange('chat-border-opacity-input', 'chat-border-opacity-val', '%', 'window_border_opacity', true);
    context.setupToggle('chat-shadow-toggle', 'chat-shadow-settings', 'theme.window_shadow_enabled');
    context.setupColorSync('chat-shadow-picker', 'chat-shadow-hex', 'chat-shadow-preview', 'window_shadow_color');
    context.setupRange('chat-shadow-opacity-input', 'chat-shadow-opacity-val', '%', 'window_shadow_opacity', true);
    context.setupRange('chat-shadow-blur-input', 'chat-shadow-blur-val', 'px', 'window_shadow_blur', true);

    window.randomizeWindowDesign = () => MagicDesignModule.randomizeWindowDesign(context);
    window.resetWindowToDefault = () => {
        context.confirmAction('Сбросить дизайн окна?', 'Все настройки окна чата будут возвращены к золотому стандарту.', () => {
            const windowKeys = [
                'window_auto_open', 'window_draggable', 'window_expand_default', 'window_resizable',
                'window_width', 'window_height', 'window_left', 'window_top', 'window_radius',
                'window_bg_img_enabled', 'window_bg_img', 'window_bg_img_opacity',
                'window_bg_enabled', 'window_bg', 'window_bg_opacity', 'window_bg_blur',
                'window_border_enabled', 'window_border_color', 'window_border_opacity', 'window_border_width',
                'window_shadow_enabled', 'window_shadow_color', 'window_shadow_opacity', 'window_shadow_blur'
            ];
            
            const defaults = {};
            windowKeys.forEach(key => {
                const val = context.getFilteredDefaults(key)[key];
                if (val !== undefined) defaults[key] = val;
            });

            // Явно зануляем картинку для сервера
            defaults.window_bg_img = null;

            Object.assign(context.state.theme, defaults);
            context.fillForm({ theme: context.state.theme });
            context.updateImagePreview('chat-window-img-preview', null, 'window_bg_img');
            context.syncWithWidget();
            context.showSuccess('Дизайн окна сброшен');
        });
    };

    window.removeChatWindowImage = async () => {
        const preview = document.getElementById('chat-window-img-preview');
        const oldUrl = context.state.theme.window_bg_img;
        
        // Если это временный файл, удаляем его физически сразу
        if (oldUrl && oldUrl.includes('/uploads/temp/')) {
            if (context.deleteTempFile) await context.deleteTempFile('window_bg_img');
        }

        context.state.theme.window_bg_img = null;
        context.updateImagePreview('chat-window-img-preview', null, 'window_bg_img');
        context.syncWithWidget();
    };

    window.resetChatToDefault = () => {
        context.confirmAction('Сбросить дизайн чата?', 'Все настройки оформления чата (даты, ссылки, эффекты) будут возвращены к золотому стандарту.', () => {
            const defaults = context.getFilteredDefaults('chat_');
            Object.assign(context.state.theme, defaults);
            context.fillForm({ theme: context.state.theme });
            context.syncWithWidget();
            context.showSuccess('Дизайн чата сброшен');
        });
    };

    context.initWindowUI = (config) => {
        if (config.theme?.window_bg_img) {
            context.updateImagePreview('chat-window-img-preview', config.theme.window_bg_img, 'window_bg_img');
        }
    };

    context.handleWindowBotMessage = (data) => {
        if (data.type === 'mitya_update_position') {
            let changed = false;
            
            if (data.window_width_pct !== undefined && !isNaN(data.window_width_pct) && context.state.theme.window_width != data.window_width_pct) {
                context.state.theme.window_width = data.window_width_pct + '%';
                const input = document.getElementById('chat-width-input');
                const display = document.getElementById('chat-width-val');
                if (input) input.value = data.window_width_pct;
                if (display) display.textContent = data.window_width_pct + '%';
                changed = true;
            }
            if (data.window_height_pct !== undefined && !isNaN(data.window_height_pct) && context.state.theme.window_height != data.window_height_pct) {
                context.state.theme.window_height = data.window_height_pct + '%';
                const input = document.getElementById('chat-height-input');
                const display = document.getElementById('chat-height-val');
                if (input) input.value = data.window_height_pct;
                if (display) display.textContent = data.window_height_pct + '%';
                changed = true;
            }
            
            if (data.chat_left !== undefined && !isNaN(data.chat_left) && context.state.theme.window_left != data.chat_left) {
                context.state.theme.window_left = data.chat_left;
                const input = document.getElementById('chat-left-input');
                const display = document.getElementById('chat-left-val');
                if (input) input.value = data.chat_left;
                if (display) display.textContent = data.chat_left + '%';
                changed = true;
            }
            if (data.chat_top !== undefined && !isNaN(data.chat_top) && context.state.theme.window_top != data.chat_top) {
                context.state.theme.window_top = data.chat_top;
                const input = document.getElementById('chat-top-input');
                const display = document.getElementById('chat-top-val');
                if (input) input.value = data.chat_top;
                if (display) display.textContent = data.chat_top + '%';
                changed = true;
            }
            return changed;
        }
        return false;
    };
}
