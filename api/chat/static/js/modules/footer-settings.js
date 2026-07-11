export function initFooterSettings(context) {
    context.setupToggle('footer-bg-toggle', 'footer-bg-settings-group', 'theme.footer_bg_enabled');
    context.setupColorSync('footer-bg-picker', 'footer-bg-hex', 'footer-bg-preview', 'footer_bg');
    context.setupRange('footer-bg-opacity-input', 'footer-bg-opacity-val', '%', 'footer_bg_opacity', true);
    context.setupRange('footer-bg-blur-input', 'footer-bg-blur-val', 'px', 'footer_bg_blur', true);
    context.setupToggle('footer-mask-toggle', 'footer-mask-settings-group', 'theme.footer_mask_enabled');
    context.setupRange('footer-mask-height-input', 'footer-mask-height-val', 'px', 'footer_mask_height', true);
    context.setupRange('footer-mask-smoothness-input', 'footer-mask-smoothness-val', 'px', 'footer_mask_smoothness', true);
    context.setupToggle('footer-shadow-toggle', 'footer-shadow-settings-group', 'theme.footer_shadow_enabled');
    context.setupColorSync('footer-shadow-picker', 'footer-shadow-hex', 'footer-shadow-preview', 'footer_shadow_color');
    context.setupRange('footer-shadow-opacity-input', 'footer-shadow-opacity-val', '%', 'footer_shadow_opacity', true);
    context.setupRange('footer-shadow-blur-input', 'footer-shadow-blur-val', 'px', 'footer_shadow_blur', false);
    context.setupRange('footer-shadow-offset-y-input', 'footer-shadow-offset-y-val', 'px', 'footer_shadow_offset_y', false);
    context.setupRange('btn-send-radius-input', 'btn-send-radius-val', '%', 'btn_send_radius', false);
    context.setupColorSync('btn-send-icon-picker', 'btn-send-icon-hex', 'btn-send-icon-preview', 'btn_send_icon_color');
    context.setupRange('btn-send-icon-opacity-input', 'btn-send-icon-opacity-val', '%', 'btn_send_icon_opacity', true);
    context.setupToggle('btn-send-icon-h-toggle', 'btn-send-icon-h-settings', 'theme.btn_send_icon_h_enabled');
    context.setupColorSync('btn-send-icon-h-picker', 'btn-send-icon-h-hex', 'btn-send-icon-h-preview', 'btn_send_icon_color_h');
    context.setupRange('btn-send-icon-h-opacity-input', 'btn-send-icon-h-opacity-val', '%', 'btn_send_icon_opacity_h', true);
    context.setupToggle('btn-send-bg-toggle', 'btn-send-bg-settings', 'theme.btn_send_bg_enabled');
    context.setupColorSync('btn-send-bg-picker', 'btn-send-bg-hex', 'btn-send-bg-preview', 'btn_send_bg_color');
    context.setupRange('btn-send-bg-opacity-input', 'btn-send-bg-opacity-val', '%', 'btn_send_bg_opacity', true);
    context.setupToggle('btn-send-bg-h-toggle', 'btn-send-bg-h-settings', 'theme.btn_send_bg_h_enabled');
    context.setupColorSync('btn-send-bg-h-picker', 'btn-send-bg-h-hex', 'btn-send-bg-h-preview', 'btn_send_bg_color_h');
    context.setupRange('btn-send-bg-h-opacity-input', 'btn-send-bg-h-opacity-val', '%', 'btn_send_bg_opacity_h', true);
    context.setupToggle('btn-send-border-toggle', 'btn-send-border-settings', 'theme.btn_send_border_enabled');
    context.setupColorSync('btn-send-border-picker', 'btn-send-border-hex', 'btn-send-border-preview', 'btn_send_border_color');
    context.setupRange('btn-send-border-opacity-input', 'btn-send-border-opacity-val', '%', 'btn_send_border_opacity', true);
    context.setupRange('btn-send-border-width-input', 'btn-send-border-width-val', 'px', 'btn_send_border_width', false);
    context.setupToggle('btn-send-border-h-toggle', 'btn-send-border-h-settings', 'theme.btn_send_border_h_enabled');
    context.setupColorSync('btn-send-border-h-picker', 'btn-send-border-h-hex', 'btn-send-border-h-preview', 'btn_send_border_color_h');
    context.setupRange('btn-send-border-h-opacity-input', 'btn-send-border-h-opacity-val', '%', 'btn_send_border_opacity_h', true);
    context.setupRange('btn-send-border-h-width-input', 'btn-send-border-h-width-val', 'px', 'btn_send_border_width_h', false);
    context.setupToggle('btn-send-shadow-toggle', 'btn-send-shadow-settings', 'theme.btn_send_shadow_enabled');
    context.setupColorSync('btn-send-shadow-picker', 'btn-send-shadow-hex', 'btn-send-shadow-preview', 'btn_send_shadow_color');
    context.setupRange('btn-send-shadow-opacity-input', 'btn-send-shadow-opacity-val', '%', 'btn_send_shadow_opacity', true);
    context.setupRange('btn-send-shadow-blur-input', 'btn-send-shadow-blur-val', 'px', 'btn_send_shadow_blur', false);
    context.setupToggle('btn-send-shadow-h-toggle', 'btn-send-shadow-h-settings', 'theme.btn_send_shadow_h_enabled');
    context.setupColorSync('btn-send-shadow-h-picker', 'btn-send-shadow-h-hex', 'btn-send-shadow-h-preview', 'btn_send_shadow_color_h');
    context.setupRange('btn-send-shadow-h-opacity-input', 'btn-send-shadow-h-opacity-val', '%', 'btn_send_shadow_opacity_h', true);
    context.setupRange('btn-send-shadow-h-blur-input', 'btn-send-shadow-h-blur-val', 'px', 'btn_send_shadow_blur_h', false);

    const sendPreviewToggle = document.getElementById('btn-send-preview-toggle');
    const stopPreviewToggle = document.getElementById('btn-stop-preview-toggle');
    const recordPreviewToggle = document.getElementById('btn-record-preview-toggle');

    const syncPreviewToggles = (activeId) => {
        const toggles = [
            { id: 'btn-send-preview-toggle', key: 'btn_send_preview_enabled', fn: 'showSendBtnPreview' },
            { id: 'btn-stop-preview-toggle', key: 'btn_stop_preview_enabled', fn: 'showStopBtnPreview' },
            { id: 'btn-record-preview-toggle', key: 'btn_record_preview_enabled', fn: 'showRecordBtnPreview' }
        ];

        toggles.forEach(t => {
            if (t.id !== activeId) {
                const el = document.getElementById(t.id);
                if (el && el.checked) {
                    el.checked = false;
                    context.state.theme[t.key] = false;
                    if (window.MityaWidget && window.MityaWidget[t.fn]) {
                        window.MityaWidget[t.fn](false);
                    }
                }
            }
        });
    };

    if (sendPreviewToggle) {
        sendPreviewToggle.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            if (isEnabled) syncPreviewToggles('btn-send-preview-toggle');
            context.state.theme.btn_send_preview_enabled = isEnabled;
            if (window.MityaWidget && window.MityaWidget.showSendBtnPreview) {
                window.MityaWidget.showSendBtnPreview(isEnabled);
            }
            context.syncWithWidget();
        });
    }

    if (stopPreviewToggle) {
        stopPreviewToggle.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            if (isEnabled) syncPreviewToggles('btn-stop-preview-toggle');
            context.state.theme.btn_stop_preview_enabled = isEnabled;
            if (window.MityaWidget && window.MityaWidget.showStopBtnPreview) {
                window.MityaWidget.showStopBtnPreview(isEnabled);
            }
            context.syncWithWidget();
        });
    }

    if (recordPreviewToggle) {
        recordPreviewToggle.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            if (isEnabled) syncPreviewToggles('btn-record-preview-toggle');
            context.state.theme.btn_record_preview_enabled = isEnabled;
            if (window.MityaWidget && window.MityaWidget.showRecordBtnPreview) {
                window.MityaWidget.showRecordBtnPreview(isEnabled);
            }
            context.syncWithWidget();
        });
    }

    context.setupToggle('btn-attach-enabled-toggle', null, 'theme.btn_attach_enabled');
    context.setupRange('btn-attach-radius-input', 'btn-attach-radius-val', '%', 'btn_attach_radius', false);
    context.setupColorSync('btn-attach-icon-picker', 'btn-attach-icon-hex', 'btn-attach-icon-preview', 'btn_attach_icon_color');
    context.setupRange('btn-attach-icon-opacity-input', 'btn-attach-icon-opacity-val', '%', 'btn_attach_icon_opacity', true);
    context.setupToggle('btn-attach-icon-h-toggle', 'btn-attach-icon-h-settings', 'theme.btn_attach_icon_h_enabled');
    context.setupColorSync('btn-attach-icon-h-picker', 'btn-attach-icon-h-hex', 'btn-attach-icon-h-preview', 'btn_attach_icon_color_h');
    context.setupRange('btn-attach-icon-h-opacity-input', 'btn-attach-icon-h-opacity-val', '%', 'btn_attach_icon_opacity_h', true);
    context.setupToggle('btn-attach-bg-toggle', 'btn-attach-bg-settings', 'theme.btn_attach_bg_enabled');
    context.setupColorSync('btn-attach-bg-picker', 'btn-attach-bg-hex', 'btn-attach-bg-preview', 'btn_attach_bg_color');
    context.setupRange('btn-attach-bg-opacity-input', 'btn-attach-bg-opacity-val', '%', 'btn_attach_bg_opacity', true);
    context.setupToggle('btn-attach-bg-h-toggle', 'btn-attach-bg-h-settings', 'theme.btn_attach_bg_h_enabled');
    context.setupColorSync('btn-attach-bg-h-picker', 'btn-attach-bg-h-hex', 'btn-attach-bg-h-preview', 'btn_attach_bg_color_h');
    context.setupRange('btn-attach-bg-h-opacity-input', 'btn-attach-bg-h-opacity-val', '%', 'btn_attach_bg_opacity_h', true);
    context.setupToggle('btn-attach-border-toggle', 'btn-attach-border-settings', 'theme.btn_attach_border_enabled');
    context.setupColorSync('btn-attach-border-picker', 'btn-attach-border-hex', 'btn-attach-border-preview', 'btn_attach_border_color');
    context.setupRange('btn-attach-border-opacity-input', 'btn-attach-border-opacity-val', '%', 'btn_attach_border_opacity', true);
    context.setupRange('btn-attach-border-width-input', 'btn-attach-border-width-val', 'px', 'btn_attach_border_width', false);
    context.setupToggle('btn-attach-border-h-toggle', 'btn-attach-border-h-settings', 'theme.btn_attach_border_h_enabled');
    context.setupColorSync('btn-attach-border-h-picker', 'btn-attach-border-h-hex', 'btn-attach-border-h-preview', 'btn_attach_border_color_h');
    context.setupRange('btn-attach-border-h-opacity-input', 'btn-attach-border-h-opacity-val', '%', 'btn_attach_border_opacity_h', true);
    context.setupRange('btn-attach-border-h-width-input', 'btn-attach-border-h-width-val', 'px', 'btn_attach_border_width_h', false);
    context.setupToggle('btn-attach-shadow-toggle', 'btn-attach-shadow-settings', 'theme.btn_attach_shadow_enabled');
    context.setupColorSync('btn-attach-shadow-picker', 'btn-attach-shadow-hex', 'btn-attach-shadow-preview', 'btn_attach_shadow_color');
    context.setupRange('btn-attach-shadow-opacity-input', 'btn-attach-shadow-opacity-val', '%', 'btn_attach_shadow_opacity', true);
    context.setupRange('btn-attach-shadow-blur-input', 'btn-attach-shadow-blur-val', 'px', 'btn_attach_shadow_blur', false);
    context.setupToggle('btn-attach-shadow-h-toggle', 'btn-attach-shadow-h-settings', 'theme.btn_attach_shadow_h_enabled');
    context.setupColorSync('btn-attach-shadow-h-picker', 'btn-attach-shadow-h-hex', 'btn-attach-shadow-h-preview', 'btn_attach_shadow_color_h');
    context.setupRange('btn-attach-shadow-h-opacity-input', 'btn-attach-shadow-h-opacity-val', '%', 'btn_attach_shadow_opacity_h', true);
    context.setupRange('btn-attach-shadow-h-blur-input', 'btn-attach-shadow-h-blur-val', 'px', 'btn_attach_shadow_blur_h', false);
    context.setupRange('input-radius-input', 'input-radius-val', 'px', 'input_radius', true);
    context.setupRange('input-file-radius-input', 'input-file-radius-val', 'px', 'input_file_radius', true);
    context.setupToggle('input-bg-toggle', 'input-bg-settings-group', 'theme.input_bg_enabled');
    context.setupColorSync('input-bg-picker', 'input-bg-hex', 'input-bg-preview', 'input_bg');
    context.setupRange('input-opacity-input', 'input-opacity-val', '%', 'input_bg_opacity', true);
    context.setupRange('input-bg-blur-input', 'input-bg-blur-val', 'px', 'input_bg_blur', true);
    context.setupToggle('input-footer-bg-toggle', 'input-footer-bg-settings-group', 'theme.input_footer_bg_enabled');
    context.setupColorSync('input-footer-bg-picker', 'input-footer-bg-hex', 'input-footer-bg-preview', 'input_footer_bg');
    context.setupRange('input-footer-opacity-input', 'input-footer-opacity-val', '%', 'input_footer_bg_opacity', true);
    context.setupRange('input-footer-blur-input', 'input-footer-blur-val', 'px', 'input_footer_bg_blur', true);
    context.setupColorSync('input-text-picker', 'input-text-hex', 'input-text-preview', 'input_text_color');
    context.setupRange('input-text-opacity-input', 'input-text-opacity-val', '%', 'input_text_opacity', true);
    context.setupColorSync('input-placeholder-picker', 'input-placeholder-hex', 'input-placeholder-preview', 'input_placeholder_color');
    context.setupRange('input-placeholder-opacity-input', 'input-placeholder-opacity-val', '%', 'input_placeholder_opacity', true);
    context.setupColorSync('input-icons-picker', 'input-icons-hex', 'input-icons-preview', 'input_icons_color');
    context.setupRange('input-icons-opacity-input', 'input-icons-opacity-val', '%', 'input_icons_opacity', true);
    context.setupColorSync('input-icons-h-picker', 'input-icons-h-hex', 'input-icons-h-preview', 'input_icons_color_h');
    context.setupRange('input-icons-h-opacity-input', 'input-icons-h-opacity-val', '%', 'input_icons_opacity_h', true);
    context.setupToggle('input-border-toggle', 'input-border-settings-group', 'theme.input_border_enabled');
    context.setupRange('input-border-width-input', 'input-border-width-val', 'px', 'input_border_width', true);
    context.setupRange('input-border-opacity-input', 'input-border-opacity-val', '%', 'input_border_opacity', true);
    context.setupColorSync('input-border-picker', 'input-border-hex', 'input-border-preview', 'input_border_color');
    context.setupToggle('input-active-border-toggle', 'input-active-border-settings-group', 'theme.input_active_border_enabled');
    context.setupRange('input-active-border-width-input', 'input-active-border-width-val', 'px', 'input_active_border_width', true);
    context.setupRange('input-active-border-opacity-input', 'input-active-border-opacity-val', '%', 'input_active_border_opacity', true);
    context.setupColorSync('input-active-border-picker', 'input-active-border-hex', 'input-active-border-preview', 'input_active_border_color');
    context.setupToggle('input-shadow-toggle', 'input-shadow-settings-group', 'theme.input_shadow_enabled');
    context.setupRange('input-shadow-opacity-input', 'input-shadow-opacity-val', '%', 'input_shadow_opacity', true);
    context.setupRange('input-shadow-blur-input', 'input-shadow-blur-val', 'px', 'input_shadow_blur', true);
    context.setupColorSync('input-shadow-color-picker', 'input-shadow-color-hex', 'input-shadow-color-preview', 'input_shadow_color');
    context.setupToggle('input-active-shadow-toggle', 'input-active-shadow-settings-group', 'theme.input_active_shadow_enabled');
    context.setupRange('input-active-shadow-opacity-input', 'input-active-shadow-opacity-val', '%', 'input_active_shadow_opacity', true);
    context.setupRange('input-active-shadow-blur-input', 'input-active-shadow-blur-val', 'px', 'input_active_shadow_blur', true);
    context.setupColorSync('input-active-shadow-picker', 'input-active-shadow-hex', 'input-active-shadow-preview', 'input_active_shadow_color');
    context.setupRange('input-mask-height-input', 'input-mask-height-val', 'px', 'input_mask_height', true);
    context.setupRange('input-mask-smoothness-input', 'input-mask-smoothness-val', '%', 'input_mask_smoothness', true);
    window.resetFooterToDefault = () => {
        context.confirmAction('Сбросить дизайн футера?', 'Все настройки футера будут возвращены к золотому стандарту.', () => {
            const defaults = context.getFilteredDefaults('footer_');
            Object.assign(context.state.theme, defaults);
            const toggles = {
                'footer-bg-toggle': defaults.footer_bg_enabled,
                'footer-mask-toggle': defaults.footer_mask_enabled,
                'footer-shadow-toggle': defaults.footer_shadow_enabled
            };
            for (const [id, enabled] of Object.entries(toggles)) {
                const el = document.getElementById(id);
                if (el) { el.checked = enabled; el.dispatchEvent(new Event('change')); }
            }
            context.fillForm({ theme: context.state.theme });
            context.syncWithWidget();
            context.showSuccess('Дизайн футера сброшен');
        });
    };

    window.resetInputToDefault = () => {
        context.confirmAction('Сбросить дизайн поля ввода?', 'Все настройки поля ввода будут возвращены к золотому стандарту.', () => {
            const defaults = context.getFilteredDefaults('input_');
            Object.assign(context.state.theme, defaults);
            
            const toggles = {
                'input-bg-toggle': defaults.input_bg_enabled,
                'input-footer-bg-toggle': defaults.input_footer_bg_enabled,
                'input-border-toggle': defaults.input_border_enabled,
                'input-active-border-toggle': defaults.input_active_border_enabled,
                'input-shadow-toggle': defaults.input_shadow_enabled,
                'input-active-shadow-toggle': defaults.input_active_shadow_enabled
            };
            
            for (const [id, enabled] of Object.entries(toggles)) {
                const el = document.getElementById(id);
                if (el) { el.checked = enabled; el.dispatchEvent(new Event('change')); }
            }

            context.fillForm({ theme: context.state.theme });
            context.syncWithWidget();
            context.showSuccess('Дизайн поля ввода сброшен');
        });
    };

    window.randomizeInputDesign = () => window.MagicDesignModule.randomizeInputDesign(context);
    window.randomizeFooterDesign = () => window.MagicDesignModule.randomizeFooter(context);
    window.randomizeSendBtnDesign = () => window.MagicDesignModule.randomizeSendBtn(context);
    window.randomizeStopBtnDesign = () => window.MagicDesignModule.randomizeStopBtn(context);
    window.randomizeMicBtnDesign = () => window.MagicDesignModule.randomizeMicBtn(context);
    window.randomizeRecordBtnDesign = () => window.MagicDesignModule.randomizeRecordBtn(context);
    window.randomizeAttachBtnDesign = () => window.MagicDesignModule.randomizeAttachBtn(context);

    window.resetSendBtnToDefault = () => {
        context.confirmAction('Сбросить дизайн кнопки отправки?', 'Настройки кнопки отправки будут возвращены к золотому стандарту.', () => {
            const defaults = context.getFilteredDefaults('btn_send_');
            Object.assign(context.state.theme, defaults);
            const toggles = {
                'btn-send-bg-toggle': defaults.btn_send_bg_enabled,
                'btn-send-bg-h-toggle': defaults.btn_send_bg_h_enabled,
                'btn-send-icon-h-toggle': defaults.btn_send_icon_h_enabled,
                'btn-send-border-toggle': defaults.btn_send_border_enabled,
                'btn-send-border-h-toggle': defaults.btn_send_border_h_enabled,
                'btn-send-shadow-toggle': defaults.btn_send_shadow_enabled,
                'btn-send-shadow-h-toggle': defaults.btn_send_shadow_h_enabled
            };
            for (const [id, enabled] of Object.entries(toggles)) {
                const el = document.getElementById(id);
                if (el) { el.checked = enabled; el.dispatchEvent(new Event('change')); }
            }
            context.fillForm({ theme: context.state.theme });
            context.syncWithWidget();
        });
    };

    window.resetStopBtnToDefault = () => {
        context.confirmAction('Сбросить дизайн кнопки паузы?', 'Настройки кнопки паузы будут возвращены к золотому стандарту.', () => {
            const defaults = context.getFilteredDefaults('btn_stop_');
            Object.assign(context.state.theme, defaults);
            const toggles = {
                'btn-stop-bg-toggle': defaults.btn_stop_bg_enabled,
                'btn-stop-bg-h-toggle': defaults.btn_stop_bg_h_enabled,
                'btn-stop-icon-h-toggle': defaults.btn_stop_icon_h_enabled,
                'btn-stop-border-toggle': defaults.btn_stop_border_enabled,
                'btn-stop-border-h-toggle': defaults.btn_stop_border_h_enabled,
                'btn-stop-shadow-toggle': defaults.btn_stop_shadow_enabled,
                'btn-stop-shadow-h-toggle': defaults.btn_stop_shadow_h_enabled
            };
            for (const [id, enabled] of Object.entries(toggles)) {
                const el = document.getElementById(id);
                if (el) { el.checked = enabled; el.dispatchEvent(new Event('change')); }
            }
            context.fillForm({ theme: context.state.theme });
            context.syncWithWidget();
        });
    };

    window.resetMicBtnToDefault = () => {
        context.confirmAction('Сбросить дизайн кнопки микрофона?', 'Настройки кнопки микрофона будут возвращены к золотому стандарту.', () => {
            const defaults = context.getFilteredDefaults('btn_mic_');
            Object.assign(context.state.theme, defaults);
            const toggles = {
                'btn-mic-bg-toggle': defaults.btn_mic_bg_enabled,
                'btn-mic-bg-h-toggle': defaults.btn_mic_bg_h_enabled,
                'btn-mic-icon-h-toggle': defaults.btn_mic_icon_h_enabled,
                'btn-mic-border-toggle': defaults.btn_mic_border_enabled,
                'btn-mic-border-h-toggle': defaults.btn_mic_border_h_enabled,
                'btn-mic-shadow-toggle': defaults.btn_mic_shadow_enabled,
                'btn-mic-shadow-h-toggle': defaults.btn_mic_shadow_h_enabled
            };
            for (const [id, enabled] of Object.entries(toggles)) {
                const el = document.getElementById(id);
                if (el) { el.checked = enabled; el.dispatchEvent(new Event('change')); }
            }
            context.fillForm({ theme: context.state.theme });
            context.syncWithWidget();
        });
    };

    window.resetRecordBtnToDefault = () => {
        context.confirmAction('Сбросить дизайн кнопки записи?', 'Настройки кнопки записи будут возвращены к золотому стандарту.', () => {
            const defaults = context.getFilteredDefaults('btn_record_');
            Object.assign(context.state.theme, defaults);
            const toggles = {
                'btn-record-icon-h-toggle': defaults.btn_record_icon_h_enabled,
                'btn-record-bg-toggle': defaults.btn_record_bg_enabled,
                'btn-record-bg-h-toggle': defaults.btn_record_bg_h_enabled,
                'btn-record-border-toggle': defaults.btn_record_border_enabled,
                'btn-record-border-h-toggle': defaults.btn_record_border_h_enabled,
                'btn-record-shadow-toggle': defaults.btn_record_shadow_enabled,
                'btn-record-shadow-h-toggle': defaults.btn_record_shadow_h_enabled
            };
            for (const [id, enabled] of Object.entries(toggles)) {
                const el = document.getElementById(id);
                if (el) { el.checked = enabled; el.dispatchEvent(new Event('change')); }
            }
            context.fillForm({ theme: context.state.theme });
            context.syncWithWidget();
        });
    };

    window.resetAttachBtnToDefault = () => {
        context.confirmAction('Сбросить дизайн кнопки вложений?', 'Настройки кнопки вложений будут возвращены к золотому стандарту.', () => {
            const defaults = context.getFilteredDefaults('btn_attach_');
            Object.assign(context.state.theme, defaults);
            const toggles = {
                'btn-attach-enabled-toggle': defaults.btn_attach_enabled,
                'btn-attach-icon-h-toggle': defaults.btn_attach_icon_h_enabled,
                'btn-attach-bg-toggle': defaults.btn_attach_bg_enabled,
                'btn-attach-bg-h-toggle': defaults.btn_attach_bg_h_enabled,
                'btn-attach-border-toggle': defaults.btn_attach_border_enabled,
                'btn-attach-border-h-toggle': defaults.btn_attach_border_h_enabled,
                'btn-attach-shadow-toggle': defaults.btn_attach_shadow_enabled,
                'btn-attach-shadow-h-toggle': defaults.btn_attach_shadow_h_enabled
            };
            for (const [id, enabled] of Object.entries(toggles)) {
                const el = document.getElementById(id);
                if (el) { el.checked = enabled; el.dispatchEvent(new Event('change')); }
            }
            context.fillForm({ theme: context.state.theme });
            context.syncWithWidget();
        });
    };

    window.resetInputToDefault = () => {
        context.confirmAction('Сбросить дизайн поля ввода?', 'Все настройки поля ввода будут возвращены к золотому стандарту.', () => {
            context.state.theme = { ...context.state.theme, ...context.getFilteredDefaults('input_') };
            context.fillForm({ theme: context.state.theme });
            context.syncWithWidget();
            context.showSuccess('Дизайн поля ввода сброшен');
        });
    };
}