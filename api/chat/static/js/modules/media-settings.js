import { MagicDesignModule } from '../magic-design.js';

export function initMediaSettings(context) {
    context.setupRange('msg-img-width-input', 'msg-img-width-val', '%', 'msg_img_max_width', true);
    context.setupRange('msg-img-radius-input', 'msg-img-radius-val', 'px', 'msg_img_radius', true);
    
    context.setupToggle('msg-img-border-toggle', 'msg-img-border-settings-group', 'theme.msg_img_border_enabled');
    context.setupColorSync('msg-img-border-picker', 'msg-img-border-hex', 'msg-img-border-preview', 'msg_img_border_color');
    context.setupRange('msg-img-border-opacity-input', 'msg-img-border-opacity-val', '%', 'msg_img_border_opacity', true);
    context.setupRange('msg-img-border-width-input', 'msg-img-border-width-val', 'px', 'msg_img_border_width', true);

    context.setupToggle('msg-img-border-h-toggle', 'msg-img-border-h-settings-group', 'theme.msg_img_border_h_enabled');
    context.setupColorSync('msg-img-border-h-picker', 'msg-img-border-h-hex', 'msg-img-border-h-preview', 'msg_img_border_color_h');
    context.setupRange('msg-img-border-opacity-h-input', 'msg-img-border-opacity-h-val', '%', 'msg_img_border_opacity_h', true);
    context.setupRange('msg-img-border-width-h-input', 'msg-img-border-width-h-val', 'px', 'msg_img_border_width_h', true);

    context.setupToggle('msg-img-shadow-toggle', 'msg-img-shadow-settings-group', 'theme.msg_img_shadow_enabled');
    context.setupColorSync('msg-img-shadow-picker', 'msg-img-shadow-hex', 'msg-img-shadow-preview', 'msg_img_shadow_color');
    context.setupRange('msg-img-shadow-opacity-input', 'msg-img-shadow-opacity-val', '%', 'msg_img_shadow_opacity', true);
    context.setupRange('msg-img-shadow-blur-input', 'msg-img-shadow-blur-val', 'px', 'msg_img_shadow_blur', true);

    context.setupToggle('msg-img-shadow-h-toggle', 'msg-img-shadow-h-settings-group', 'theme.msg_img_shadow_h_enabled');
    context.setupColorSync('msg-img-shadow-h-picker', 'msg-img-shadow-h-hex', 'msg-img-shadow-h-preview', 'msg_img_shadow_color_h');
    context.setupRange('msg-img-shadow-opacity-h-input', 'msg-img-shadow-opacity-h-val', '%', 'msg_img_shadow_opacity_h', true);
    context.setupRange('msg-img-shadow-blur-h-input', 'msg-img-shadow-blur-h-val', 'px', 'msg_img_shadow_blur_h', true);

    const imgPreviewToggle = document.getElementById('msg-img-preview-toggle');
    if (imgPreviewToggle) {
        imgPreviewToggle.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            context.state.theme.msg_img_preview_enabled = isEnabled;
            
            if (isEnabled) {
                if (window.MityaWidget && window.MityaWidget.showImagePreview) {
                    window.MityaWidget.showImagePreview(true);
                }
            } else {
                if (window.MityaWidget && window.MityaWidget.hideImagePreview) {
                    window.MityaWidget.hideImagePreview();
                }
            }
            context.syncWithWidget();
        });
    }

    const attachPreviewToggle = document.getElementById('attach-item-preview-toggle');
    context.setupRange('attach-item-height-input', 'attach-item-height-val', 'px', 'attach_item_height', true);
    context.setupRange('attach-item-radius-input', 'attach-item-radius-val', 'px', 'attach_item_radius', true);

    // Инициализация текста вложений
    context.setupFontSelect('attach-item-font-family-select-container', 'attach-item-font-family-select', 'attach-item-current-font-name', 'attach_item_font_family');
    context.setupColorSync('attach-item-text-picker', 'attach-item-text-hex', 'attach-item-text-preview', 'attach_item_text_color');
    context.setupRange('attach-item-text-opacity-input', 'attach-item-text-opacity-val', '%', 'attach_item_text_opacity', true);
    context.setupRange('attach-item-font-size-input', 'attach-item-font-size-val', 'px', 'attach_item_font_size', true);
    context.setupRange('attach-item-font-weight-input', 'attach-item-font-weight-val', '', 'attach_item_font_weight', true);

    // Инициализация фона вложений
    context.setupToggle('attach-item-bg-toggle', 'attach-item-bg-settings-group', 'theme.attach_item_bg_enabled');
    context.setupColorSync('attach-item-bg-picker', 'attach-item-bg-hex', 'attach-item-bg-preview', 'attach_item_bg_color');
    context.setupRange('attach-item-bg-opacity-input', 'attach-item-bg-opacity-val', '%', 'attach_item_bg_opacity', true);
    context.setupRange('attach-item-bg-blur-input', 'attach-item-bg-blur-val', 'px', 'attach_item_bg_blur', true);

    // Инициализация обводки вложений
    context.setupToggle('attach-item-border-toggle', 'attach-item-border-settings-group', 'theme.attach_item_border_enabled');
    context.setupColorSync('attach-item-border-picker', 'attach-item-border-hex', 'attach-item-border-preview', 'attach_item_border_color');
    context.setupRange('attach-item-border-opacity-input', 'attach-item-border-opacity-val', '%', 'attach_item_border_opacity', true);
    context.setupRange('attach-item-border-width-input', 'attach-item-border-width-val', 'px', 'attach_item_border_width', true);

    // Инициализация тени вложений
    context.setupToggle('attach-item-shadow-toggle', 'attach-item-shadow-settings-group', 'theme.attach_item_shadow_enabled');
    
    const shadowPicker = document.getElementById('attach-item-shadow-picker');
    const shadowHex = document.getElementById('attach-item-shadow-hex');
    const shadowPreview = document.getElementById('attach-item-shadow-preview');
    
    if (shadowPicker && shadowHex && shadowPreview) {
        const updateShadow = (val) => {
            const finalVal = (val === '' || val === null) ? 'transparent' : (val.startsWith('#') ? val : '#' + val);
            if (finalVal !== 'transparent') shadowPicker.value = finalVal;
            shadowHex.value = val;
            shadowPreview.style.backgroundColor = finalVal;
            context.state.theme.attach_item_shadow_color = finalVal;
            context.syncWithWidget();
        };
        shadowPicker.addEventListener('input', (e) => updateShadow(e.target.value));
        shadowHex.addEventListener('input', (e) => {
            const v = e.target.value;
            if (v.length === 7 || v.length === 4 || v === '' || v === 'transparent') updateShadow(v);
        });
    }

    context.setupRange('attach-item-shadow-opacity-input', 'attach-item-shadow-opacity-val', '%', 'attach_item_shadow_opacity', true);
    context.setupRange('attach-item-shadow-blur-input', 'attach-item-shadow-blur-val', 'px', 'attach_item_shadow_blur', true);

    if (attachPreviewToggle) {
        attachPreviewToggle.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            context.state.theme.attach_item_preview_enabled = isEnabled;
            
            if (isEnabled) {
                if (window.MityaWidget && window.MityaWidget.showAttachPreview) {
                    window.MityaWidget.showAttachPreview(true);
                }
            } else {
                if (window.MityaWidget && window.MityaWidget.hideAttachPreview) {
                    window.MityaWidget.hideAttachPreview();
                }
            }
            context.syncWithWidget();
        });
    }

    context.setupRange('attach-item-radius-input', 'attach-item-radius-val', 'px', 'attach_item_radius', true);
    context.setupColorSync('attach-item-bg-picker', 'attach-item-bg-hex', 'attach-item-bg-preview', 'attach_item_bg_color');
    context.setupColorSync('attach-item-text-picker', 'attach-item-text-hex', 'attach-item-text-preview', 'attach_item_text_color');

    [
        'msg-img-width-input', 'msg-img-radius-input', 'attach-item-radius-input',
        'attach-item-shadow-opacity-input', 'attach-item-shadow-blur-input',
        'attach-item-bg-opacity-input', 'attach-item-bg-blur-input',
        'attach-item-border-opacity-input', 'attach-item-border-width-input'
    ].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => context.syncWithWidget());
            el.addEventListener('change', () => context.syncWithWidget());
        }
    });

    window.randomizeMediaDesign = () => MagicDesignModule.randomizeMediaDesign(context);

    context.handleMediaBotMessage = (data) => {
        console.log('[MediaSettings] Received bot message:', data);
        if (data.type === 'mitya_hide_image_preview') {
            const toggle = document.getElementById('msg-img-preview-toggle');
            if (toggle) {
                toggle.checked = false;
                context.state.theme.msg_img_preview_enabled = false;
            }
        }
        if (data.type === 'mitya_hide_attach_preview') {

            const toggle = document.getElementById('attach-item-preview-toggle');
            if (toggle) {
                toggle.checked = false;
                context.state.theme.attach_item_preview_enabled = false;
            }
        }
    };

    window.resetMediaToDefault = () => {
        context.confirmAction('Сбросить дизайн изображений?', 'Все настройки изображений будут возвращены к золотому стандарту.', () => {
            const mediaFields = [
                'msg_img_preview_enabled', 'msg_img_max_width', 'msg_img_radius',
                'msg_img_border_enabled', 'msg_img_border_color', 'msg_img_border_opacity', 'msg_img_border_width',
                'msg_img_border_h_enabled', 'msg_img_border_color_h', 'msg_img_border_opacity_h', 'msg_img_border_width_h',
                'msg_img_shadow_enabled', 'msg_img_shadow_color', 'msg_img_shadow_opacity', 'msg_img_shadow_blur',
                'msg_img_shadow_h_enabled', 'msg_img_shadow_color_h', 'msg_img_shadow_opacity_h', 'msg_img_shadow_blur_h'
            ];
            
            const defaults = context.getFilteredDefaults('');
            mediaFields.forEach(f => {
                if (defaults[f] !== undefined) context.state.theme[f] = defaults[f];
            });

            // Сбрасываем тумблеры в UI
            const toggles = {
                'msg-img-preview-toggle': context.state.theme.msg_img_preview_enabled,
                'msg-img-border-toggle': context.state.theme.msg_img_border_enabled,
                'msg-img-border-h-toggle': context.state.theme.msg_img_border_h_enabled,
                'msg-img-shadow-toggle': context.state.theme.msg_img_shadow_enabled,
                'msg-img-shadow-h-toggle': context.state.theme.msg_img_shadow_h_enabled
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
            context.showSuccess('Дизайн изображений сброшен');
        });
    };

    window.randomizeAttachmentsDesign = () => MagicDesignModule.randomizeAttachmentsDesign(context);
    window.resetAttachmentsToDefault = () => {
        context.confirmAction('Сбросить дизайн вложений?', 'Все настройки файлов и документов будут возвращены к золотому стандарту.', () => {
            const fields = [
                'attach_item_preview_enabled', 'attach_item_height', 'attach_item_radius',
                'attach_item_font_family', 'attach_item_text_color', 'attach_item_text_opacity',
                'attach_item_font_size', 'attach_item_font_weight', 'attach_item_bg_enabled',
                'attach_item_bg_color', 'attach_item_bg_opacity', 'attach_item_bg_blur',
                'attach_item_border_enabled', 'attach_item_border_color', 'attach_item_border_opacity',
                'attach_item_border_width', 'attach_item_shadow_enabled', 'attach_item_shadow_color',
                'attach_item_shadow_opacity', 'attach_item_shadow_blur'
            ];
            const defaults = context.getFilteredDefaults('');
            fields.forEach(f => {
                if (defaults[f] !== undefined) context.state.theme[f] = defaults[f];
            });

            // Сбрасываем тумблеры в UI (кроме предпросмотра)
            const toggles = {
                'attach-item-bg-toggle': context.state.theme.attach_item_bg_enabled,
                'attach-item-border-toggle': context.state.theme.attach_item_border_enabled,
                'attach-item-shadow-toggle': context.state.theme.attach_item_shadow_enabled
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
            context.showSuccess('Дизайн вложений сброшен');
        });
    };
}
