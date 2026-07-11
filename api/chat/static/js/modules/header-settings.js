import { MagicDesignModule } from '../magic-design.js';

export function initHeaderSettings(context) {
    context.currentHeaderBtnType = 'close';

    window.removeHeaderLogo = async () => {
        const imgPreview = document.getElementById('header-logo-preview');
        if (!imgPreview) return;
        const oldUrl = context.state.theme.header_logo;
        
        // Если это временный файл, удаляем его физически сразу
        if (oldUrl && oldUrl.includes('/uploads/temp/')) {
            if (context.deleteTempFile) await context.deleteTempFile('header_logo');
        }

        context.state.theme.header_logo = null;
        context.updateImagePreview('header-logo-preview', null, 'header_logo');
        context.syncWithWidget();
    };

    context.getHeaderBtnKey = function(suffix) {
        return `header_btn_${this.currentHeaderBtnType}_${suffix}`;
    };

    context.setupColorSync('header-bg-picker', 'header-bg-hex', 'header-bg-preview', 'header_bg');
    context.setupRange('header-opacity-input', 'header-opacity-val', '%', 'header_bg_opacity', true);
    context.setupRange('header-blur-input', 'header-blur-val', 'px', 'header_bg_blur', false);
    context.setupToggle('header-logo-enabled-toggle', 'header-logo-settings-group', 'theme.header_logo_enabled');
    context.setupImageUpload('header-logo-upload', 'header-logo-preview', 'header_logo');
    context.setupRange('header-logo-size-input', 'header-logo-size-val', 'px', 'header_logo_size', true);
    context.setupRange('header-logo-opacity-input', 'header-logo-opacity-val', '%', 'header_logo_opacity', true);
    context.setupRange('header-logo-radius-input', 'header-logo-radius-val', 'px', 'header_logo_radius', false);
    context.setupInput('header-logo-url-input', 'header_logo_url');
    context.setupToggle('header-logo-target-toggle', null, 'theme.header_logo_target_blank');
    context.setupColorSync('header-icons-picker', 'header-icons-hex', 'header-icons-preview', 'header_icons_color');
    context.setupColorSync('header-icons-h-picker', 'header-icons-h-hex', 'header-icons-h-preview', 'header_icons_hover_color');
    context.setupColorSync('header-icons-bg-picker', 'header-icons-bg-hex', 'header-icons-bg-preview', 'header_icons_bg');
    context.setupRange('header-icons-opacity-input', 'header-icons-opacity-val', '%', 'header_icons_bg_opacity', true);
    context.setupRange('header-icons-radius-input', 'header-icons-radius-val', 'px', 'header_icons_radius', true);
    context.setupColorSync('header-icons-h-bg-picker', 'header-icons-h-bg-hex', 'header-icons-h-bg-preview', 'header_icons_hover_bg');
    context.setupRange('header-icons-h-bg-opacity-input', 'header-icons-h-bg-opacity-val', '%', 'header_icons_hover_bg_opacity', true);
    context.setupColorSync('header-icons-border-picker', 'header-icons-border-hex', 'header-icons-border-preview', 'header_icons_border');
    context.setupRange('header-icons-border-width-input', 'header-icons-border-width-val', 'px', 'header_icons_border_width', true);
    context.setupRange('header-icons-border-opacity-input', 'header-icons-border-opacity-val', '%', 'header_icons_border_opacity', true);
    context.setupColorSync('header-icons-border-h-picker', 'header-icons-border-h-hex', 'header-icons-border-h-preview', 'header_icons_border_h');
    context.setupRange('header-icons-border-width-h-input', 'header-icons-border-width-h-val', 'px', 'header_icons_border_width_h', true);
    context.setupRange('header-icons-border-opacity-h-input', 'header-icons-border-opacity-h-val', '%', 'header_icons_border_opacity_h', true);
    context.setupColorSync('header-icons-shadow-picker', 'header-icons-shadow-hex', 'header-icons-shadow-preview', 'header_icons_shadow_color');
    context.setupRange('header-icons-shadow-blur-input', 'header-icons-shadow-blur-val', 'px', 'header_icons_shadow_blur', true);
    context.setupRange('header-icons-shadow-opacity-input', 'header-icons-shadow-opacity-val', '%', 'header_icons_shadow_opacity', true);
    context.setupColorSync('header-icons-hover-shadow-picker', 'header-icons-hover-shadow-hex', 'header-icons-hover-shadow-preview', 'header_icons_hover_shadow_color');
    context.setupRange('header-icons-hover-blur-input', 'header-icons-hover-blur-val', 'px', 'header_icons_hover_blur', true);
    context.setupRange('header-icons-hover-shadow-opacity-input', 'header-icons-hover-shadow-opacity-val', '%', 'header_icons_hover_shadow_opacity', true);
    context.setupToggle('header-bg-enabled-toggle', 'header-bg-settings-group', 'theme.header_bg_enabled');
    context.setupToggle('header-mask-toggle', 'header-mask-settings-group', 'theme.header_mask_enabled');
    context.setupRange('header-mask-height-input', 'header-mask-height-val', 'px', 'header_mask_height', false);
    context.setupRange('header-mask-smoothness-input', 'header-mask-smoothness-val', 'px', 'header_mask_smoothness', false);
    
    context.setupToggle('header-shadow-toggle', 'header-shadow-settings-group', 'theme.header_shadow_enabled');
    context.setupColorSync('header-shadow-picker', 'header-shadow-hex', 'header-shadow-preview', 'header_shadow_color');
    context.setupRange('header-shadow-opacity-input', 'header-shadow-opacity-val', '%', 'header_shadow_opacity', true);
    context.setupRange('header-shadow-blur-input', 'header-shadow-blur-val', 'px', 'header_shadow_blur', true);
    context.setupRange('header-shadow-offset-y-input', 'header-shadow-offset-y-val', 'px', 'header_shadow_offset_y', true);
    
    window.randomizeHeaderDesign = () => MagicDesignModule.randomizeHeaderDesign(context);
    window.randomizeHeaderButtonsDesign = () => MagicDesignModule.randomizeHeaderButtonsDesign(context);

    context.bindHeaderButtonsEvents = () => {
        context.setupToggle('header-close-toggle', null, 'theme.header_close_enabled');
        context.setupToggle('header-expand-toggle', null, 'theme.header_expand_enabled');
        context.setupRange('header-btn-size-input', 'header-btn-size-val', 'px', 'header_btn_size', false);
        context.setupRange('header-btn-radius-input', 'header-btn-radius-val', '%', 'header_btn_radius', false);
        context.setupColorSync('header-btn-color-picker', 'header-btn-color-hex', 'header-btn-color-preview', 'header_btn_color');
        context.setupRange('header-btn-opacity-input', 'header-btn-opacity-val', '%', 'header_btn_opacity', true);
        context.setupToggle('header-btn-color-h-toggle', 'header-btn-color-h-settings', 'header_btn_color_h_enabled');
        context.setupColorSync('header-btn-color-hover-picker', 'header-btn-color-hover-hex', 'header-btn-color-hover-preview', 'header_btn_color_h');
        context.setupRange('header-btn-opacity-h-input', 'header-btn-opacity-h-val', '%', 'header_btn_opacity_h', true);
        context.setupToggle('header-btn-bg-enabled-toggle', 'header-btn-bg-settings', 'header_btn_bg_enabled');
        context.setupColorSync('header-btn-bg-picker', 'header-btn-bg-hex', 'header-btn-bg-preview', 'header_btn_bg');
        context.setupRange('header-btn-bg-opacity-input', 'header-btn-bg-opacity-val', '%', 'header_btn_bg_opacity', true);
        context.setupRange('header-btn-bg-blur-input', 'header-btn-bg-blur-val', 'px', 'header_btn_bg_blur', false);
        context.setupToggle('header-btn-bg-h-toggle', 'header-btn-bg-h-settings', 'header_btn_bg_h_enabled');
        context.setupColorSync('header-btn-bg-h-picker', 'header-btn-bg-h-hex', 'header-btn-bg-h-preview', 'header_btn_bg_h');
        context.setupRange('header-btn-bg-h-opacity-input', 'header-btn-bg-h-opacity-val', '%', 'header_btn_bg_opacity_h', true);
        context.setupRange('header-btn-bg-h-blur-input', 'header-btn-bg-h-blur-val', 'px', 'header_btn_bg_h_blur', false);
        context.setupToggle('header-btn-border-enabled-toggle', 'header-btn-border-settings', 'header_btn_border_enabled');
        context.setupColorSync('header-btn-border-picker', 'header-btn-border-hex', 'header-btn-border-preview', 'header_btn_border_color');
        context.setupRange('header-btn-border-opacity-input', 'header-btn-border-opacity-val', '%', 'header_btn_border_opacity', true);
        context.setupRange('header-btn-border-width-input', 'header-btn-border-width-val', 'px', 'header_btn_border_width', false);
        context.setupToggle('header-btn-border-h-toggle', 'header-btn-border-h-settings', 'header_btn_border_h_enabled');
        context.setupColorSync('header-btn-border-h-picker', 'header-btn-border-h-hex', 'header-btn-border-h-preview', 'header_btn_border_color_h');
        context.setupRange('header-btn-border-h-opacity-input', 'header-btn-border-h-opacity-val', '%', 'header_btn_border_opacity_h', true);
        context.setupRange('header-btn-border-h-width-input', 'header-btn-border-h-width-val', 'px', 'header_btn_border_width_h', false);
        context.setupToggle('header-btn-shadow-toggle', 'header-btn-shadow-settings', 'header_btn_shadow_enabled');
        context.setupColorSync('header-btn-shadow-picker', 'header-btn-shadow-hex', 'header-btn-shadow-preview', 'header_btn_shadow_color');
        context.setupRange('header-btn-shadow-opacity-input', 'header-btn-shadow-opacity-val', '%', 'header_btn_shadow_opacity', true);
        context.setupRange('header-btn-shadow-blur-input', 'header-btn-shadow-blur-val', 'px', 'header_btn_shadow_blur', false);
        context.setupToggle('header-btn-shadow-h-toggle', 'header-btn-shadow-h-settings', 'header_btn_shadow_h_enabled');
        context.setupColorSync('header-btn-shadow-h-picker', 'header-btn-shadow-h-hex', 'header-btn-shadow-h-preview', 'header_btn_shadow_color_h');
        context.setupRange('header-btn-shadow-h-opacity-input', 'header-btn-shadow-h-opacity-val', '%', 'header_btn_shadow_opacity_h', true);
        context.setupRange('header-btn-shadow-h-blur-input', 'header-btn-shadow-h-blur-val', 'px', 'header_btn_shadow_blur_h', false);
    };

    context.fillHeaderButtonsForm = () => {
        const fields = [
            { id: 'header-btn-size', key: 'size', type: 'range', unit: 'px' },
            { id: 'header-btn-radius', key: 'radius', type: 'range', unit: '%' },
            { id: 'header-btn-color', key: 'color', type: 'color' },
            { id: 'header-btn-opacity', key: 'opacity', type: 'range', isOpacity: true },
            { id: 'header-btn-color-hover', key: 'color_h', type: 'color' },
            { id: 'header-btn-opacity-h', key: 'opacity_h', type: 'range', isOpacity: true },
            { id: 'header-btn-bg', key: 'bg', type: 'color' },
            { id: 'header-btn-bg-opacity', key: 'bg_opacity', type: 'range', isOpacity: true },
            { id: 'header-btn-bg-blur', key: 'bg_blur', type: 'range', unit: 'px' },
            { id: 'header-btn-bg-h', key: 'bg_h', type: 'color' },
            { id: 'header-btn-bg-h-opacity', key: 'bg_opacity_h', type: 'range', isOpacity: true },
            { id: 'header-btn-bg-h-blur', key: 'bg_h_blur', type: 'range', unit: 'px' },
            { id: 'header-btn-border', key: 'border_color', type: 'color' },
            { id: 'header-btn-border-opacity', key: 'border_opacity', type: 'range', isOpacity: true },
            { id: 'header-btn-border-width', key: 'border_width', type: 'range', unit: 'px' },
            { id: 'header-btn-border-h', key: 'border_color_h', type: 'color' },
            { id: 'header-btn-border-h-opacity', key: 'border_opacity_h', type: 'range', isOpacity: true },
            { id: 'header-btn-border-h-width', key: 'border_width_h', type: 'range', unit: 'px' },
            { id: 'header-btn-shadow', key: 'shadow_color', type: 'color' },
            { id: 'header-btn-shadow-opacity', key: 'shadow_opacity', type: 'range', isOpacity: true },
            { id: 'header-btn-shadow-blur', key: 'shadow_blur', type: 'range', unit: 'px' },
            { id: 'header-btn-shadow-h', key: 'shadow_color_h', type: 'color' },
            { id: 'header-btn-shadow-h-opacity', key: 'shadow_opacity_h', type: 'range', isOpacity: true },
            { id: 'header-btn-shadow-h-blur', key: 'shadow_blur_h', type: 'range', unit: 'px' }
        ];

        fields.forEach(f => {
            const fullKey = (f.key === 'bg_blur' || f.key === 'bg_h_blur') 
                ? context.getHeaderBtnKey(f.key) 
                : context.getHeaderBtnKey(f.key);
            const val = context.state.theme[fullKey];

            if (f.type === 'color') {
                const picker = document.getElementById(`${f.id}-picker`);
                const hex = document.getElementById(`${f.id}-hex`);
                const preview = document.getElementById(`${f.id}-preview`);
                if (picker) picker.value = val || '#000000';
                if (hex) hex.value = (val || '').toUpperCase();
                if (preview) preview.style.backgroundColor = val || 'transparent';
            } else if (f.type === 'range') {
                const input = document.getElementById(`${f.id}-input`);
                const valDisplay = document.getElementById(`${f.id}-val`);
                if (input) {
                    let numVal = parseFloat(val) || 0;
                    if (f.isOpacity) numVal = Math.round(numVal * 100);
                    input.value = numVal;
                    if (valDisplay) valDisplay.textContent = numVal + (f.unit || (f.isOpacity ? '%' : ''));
                }
            }
        });

        const toggles = [
            { id: 'header-btn-color-h-toggle', key: 'color_h_enabled' },
            { id: 'header-btn-bg-enabled-toggle', key: 'bg_enabled' },
            { id: 'header-btn-bg-h-toggle', key: 'bg_h_enabled' },
            { id: 'header-btn-border-enabled-toggle', key: 'border_enabled' },
            { id: 'header-btn-border-h-toggle', key: 'border_h_enabled' },
            { id: 'header-btn-shadow-toggle', key: 'shadow_enabled' },
            { id: 'header-btn-shadow-h-toggle', key: 'shadow_h_enabled' }
        ];

        toggles.forEach(t => {
            const el = document.getElementById(t.id);
            if (el) {
                el.checked = context.state.theme[context.getHeaderBtnKey(t.key)] !== false;
                el.dispatchEvent(new Event('change'));
            }
        });
    };

    const headerBtnSwitcher = document.getElementById('header-button-type-switcher');
    if (headerBtnSwitcher) {
        headerBtnSwitcher.querySelectorAll('.type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                headerBtnSwitcher.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                context.currentHeaderBtnType = btn.dataset.btnType;
                context.fillHeaderButtonsForm();
            });
        });
    }

    window.setHeaderSide = (side) => {
        const input = document.getElementById('header-side-input');
        if (input) {
            input.value = side;
            context.state.theme.header_icons_side = side;
            document.querySelectorAll('.side-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.sideVal === side);
            });
            context.syncWithWidget();
        }
    };

    window.resetHeaderToDefault = () => {
        context.confirmAction('Сбросить дизайн шапки?', 'Все настройки шапки будут возвращены к золотому стандарту.', () => {
            const oldUrl = context.state.theme.header_logo;
            const defaults = context.getFilteredDefaults('header_');
            
            // Сбрасываем только те ключи, которые относятся к самой шапке, но НЕ к кнопкам
            Object.keys(defaults).forEach(key => {
                if (!key.startsWith('header_btn_') && key !== 'header_icons_side') {
                    context.state.theme[key] = defaults[key];
                }
            });
            
            // Явно сбрасываем логотип
            context.state.theme.header_logo = null;

            // Обновляем основную форму
            context.fillForm({ theme: context.state.theme });
            
            // Обновляем превью логотипа
            context.updateImagePreview('header-logo-preview', null, 'header_logo');
            
            // Обновляем сторону иконок
            if (context.state.theme.header_icons_side) {
                window.setHeaderSide(context.state.theme.header_icons_side);
            }
            
            context.syncWithWidget();
        });
    };

    window.resetHeaderButtonsToDefault = () => {
        context.confirmAction('Сбросить дизайн кнопок шапки?', 'Все настройки кнопок (закрыть/развернуть) будут возвращены к золотому стандарту.', () => {
            const defaults = context.getFilteredDefaults('header_btn_');
            
            // Сбрасываем все ключи кнопок
            Object.keys(defaults).forEach(key => {
                context.state.theme[key] = defaults[key];
            });

            // Также сбрасываем сторону расположения кнопок
            const sideKey = 'header_icons_side';
            const sideDefault = context.getFilteredDefaults(sideKey)[sideKey];
            if (sideDefault) {
                context.state.theme[sideKey] = sideDefault;
                window.setHeaderSide(sideDefault);
            }
            
            // Обновляем форму кнопок
            if (typeof context.fillHeaderButtonsForm === 'function') {
                context.fillHeaderButtonsForm();
            }

            context.syncWithWidget();
        });
    };

    context.initHeaderUI = (config) => {
        if (config.theme?.header_logo) {
            context.updateImagePreview('header-logo-preview', config.theme.header_logo, 'header_logo');
        }
    };
}