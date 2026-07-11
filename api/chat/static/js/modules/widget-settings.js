import { MagicDesignModule } from '../magic-design.js';

export function initWidgetSettings(context) {
    context.setupToggle('widget-draggable-toggle', null, 'theme.widget_draggable');
    context.setupRange('widget-size-input', 'widget-size-val', 'px', 'widget_size', false);
    context.setupRange('widget-top-input', 'widget-top-val', '%', 'widget_top', true);
    context.setupRange('widget-left-input', 'widget-left-val', '%', 'widget_left', true);
    context.setupRange('widget-radius-input', 'widget-radius-val', '%', 'widget_radius', false);
    context.setupToggle('widget-img-enabled-toggle', 'widget-img-settings-group', 'theme.widget_img_enabled');
    context.setupImageUpload('widget-img-upload', 'widget-img-preview', 'widget_img');
    context.setupRange('widget-img-opacity-input', 'widget-img-opacity-val', '%', 'widget_img_opacity', true);
    context.setupToggle('widget-bg-toggle', 'widget-bg-settings-group', 'theme.widget_bg_enabled');
    context.setupColorSync('brand-color-picker', 'brand-color-hex', 'brand-color-preview', 'widget_bg_color');
    context.setupRange('brand-opacity-input', 'brand-opacity-val', '%', 'widget_bg_opacity', true);
    context.setupRange('brand-blur-input', 'brand-blur-val', 'px', 'widget_bg_blur', true);
    context.setupToggle('widget-border-toggle', 'widget-border-settings-group', 'theme.widget_border_enabled');
    context.setupColorSync('brand-border-picker', 'brand-border-hex', 'brand-border-preview', 'widget_border_color');
    context.setupRange('brand-border-opacity-input', 'brand-border-opacity-val', '%', 'widget_border_opacity', true);
    context.setupRange('brand-border-width-input', 'brand-border-width-val', 'px', 'widget_border_width', false);
    context.setupToggle('widget-shadow-toggle', 'shadow-settings-group', 'theme.widget_shadow_enabled');
    context.setupColorSync('shadow-color-picker', 'shadow-color-hex', 'shadow-color-preview', 'widget_shadow_color');
    context.setupRange('shadow-opacity-input', 'shadow-opacity-val', '%', 'widget_shadow_opacity', true);
    context.setupRange('shadow-blur-input', 'shadow-blur-val', 'px', 'widget_shadow_blur', true);
    context.setupToggle('widget-effects-toggle', 'widget-effects-group', 'theme.widget_effects_enabled');
    context.setupToggle('widget-dots-toggle', 'dots-settings-group', 'theme.widget_dots_enabled');
    context.setupColorSync('icon-color-picker', 'icon-color-hex', 'icon-color-preview', 'widget_dots_color');
    context.setupRange('widget-dots-opacity-input', 'widget-dots-opacity-val', '%', 'widget_dots_opacity', true);
    context.setupToggle('widget-pulse-toggle', 'pulse-settings-group', 'theme.widget_pulse_enabled');
    context.setupColorSync('pulse-color-picker', 'pulse-color-hex', 'pulse-color-preview', 'widget_pulse_color');
    context.setupRange('pulse-opacity-input', 'pulse-opacity-val', '%', 'widget_pulse_opacity', true);
    context.setupRange('pulse-size-input', 'pulse-size-val', 'px', 'widget_pulse_size', true);
    context.setupRange('pulse-speed-input', 'pulse-speed-val', 's', 'widget_pulse_speed', true);
    context.setupRange('pulse-pause-input', 'pulse-pause-val', 's', 'widget_pulse_pause', true);
    context.setupToggle('widget-glare-toggle', 'glare-settings-group', 'theme.widget_glare_enabled');
    context.setupColorSync('glare-color-picker', 'glare-color-hex', 'glare-color-preview', 'widget_glare_color');
    context.setupRange('widget-glare-opacity-input', 'widget-glare-opacity-val', '%', 'widget_glare_opacity', true);
    context.setupRange('widget-glare-size-input', 'widget-glare-size-val', '%', 'widget_glare_size', false);
    context.setupRange('widget-glare-speed-input', 'widget-glare-speed-val', 's', 'widget_glare_speed', true);
    context.setupRange('widget-glare-pause-input', 'widget-glare-pause-val', 's', 'widget_glare_pause', true);
    context.setupToggle('widget-breathing-toggle', 'breathing-settings-group', 'theme.widget_breathing_enabled');
    context.setupRange('widget-breathing-speed-input', 'widget-breathing-speed-val', 's', 'widget_breathing_speed', true);
    context.setupRange('widget-breathing-pause-input', 'widget-breathing-pause-val', 's', 'widget_breathing_pause', true);
    context.setupRange('widget-breathing-scale-input', 'widget-breathing-scale-val', '%', 'widget_breathing_scale', true);

    window.randomizeWidgetDesign = () => MagicDesignModule.randomizeWidgetDesign(context);
    window.resetWidgetToDefault = () => {
        context.confirmAction('Сбросить дизайн виджета?', 'Все настройки виджета будут возвращены к золотому стандарту.', () => {
            const oldUrl = context.state.theme.widget_img;
            const defaults = context.getFilteredDefaults('widget_');
            defaults.widget_img = null;
            context.state.theme = { ...context.state.theme, ...defaults };
            context.fillForm({ theme: context.state.theme });
            context.updateImagePreview('widget-img-preview', null, 'widget_img');
            context.syncWithWidget();
        });
    };

    window.removeWidgetImage = async () => {
        const imgPreview = document.getElementById('widget-img-preview');
        if (!imgPreview) return;
        
        const oldUrl = context.state.theme.widget_img;
        
        // Если это временный файл, удаляем его физически сразу
        if (oldUrl && oldUrl.includes('/uploads/temp/')) {
            if (context.deleteTempFile) await context.deleteTempFile('widget_img');
        }

        context.state.theme.widget_img = null;
        context.updateImagePreview('widget-img-preview', null, 'widget_img');
        context.syncWithWidget();
    };

    context.handleWidgetBotMessage = (data) => {
        if (data.type === 'mitya_update_position') {
            let changed = false;
            
            if (data.widget_left_pct !== undefined && !isNaN(data.widget_left_pct) && context.state.theme.widget_left != data.widget_left_pct) {
                context.state.theme.widget_left = data.widget_left_pct;
                const input = document.getElementById('widget-left-input');
                const display = document.getElementById('widget-left-val');
                if (input) input.value = data.widget_left_pct;
                if (display) display.textContent = data.widget_left_pct + '%';
                changed = true;
            }
            if (data.widget_top_pct !== undefined && !isNaN(data.widget_top_pct) && context.state.theme.widget_top != data.widget_top_pct) {
                context.state.theme.widget_top = data.widget_top_pct;
                const input = document.getElementById('widget-top-input');
                const display = document.getElementById('widget-top-val');
                if (input) input.value = data.widget_top_pct;
                if (display) display.textContent = data.widget_top_pct + '%';
                changed = true;
            }
            return changed;
        }
        return false;
    };
}