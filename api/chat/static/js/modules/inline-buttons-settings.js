import { MagicDesignModule } from '../magic-design.js';

export function initInlineButtonsSettings(context) {
    // Загружаем сохраненную вкладку или ставим accent по умолчанию
    context.currentButtonStyle = localStorage.getItem('mitya_active_button_tab') || 'accent';

    context.getButtonKey = function(baseKey) {
        const commonKeys = ['preview_enabled'];
        if (commonKeys.includes(baseKey)) {
            return `inline_btn_${baseKey}`;
        }
        const suffix = this.currentButtonStyle;
        return `inline_btn_${suffix}_${baseKey}`;
    };

    context.setupButtonRange = function(inputId, valId, unit, key) {
        const input = document.getElementById(inputId);
        const display = document.getElementById(valId);
        if (!input || !display) return;
        input.addEventListener('input', (e) => {
            let val = e.target.value;
            display.textContent = val + unit;
            let finalVal = (unit === '%') ? parseFloat(val) / 100 : val + unit;
            
            const fullKey = context.getButtonKey(key);
            context.state.theme[fullKey] = finalVal;
            
            console.log(`[Buttons] Setting ${fullKey} to ${finalVal}`);
            context.syncWithWidget();
        });
        input.addEventListener('change', () => context.syncWithWidget());
    };

    context.setupButtonColor = function(pickerId, hexId, previewId, key) {
        const picker = document.getElementById(pickerId);
        const hex = document.getElementById(hexId);
        const preview = document.getElementById(previewId);
        if (!picker || !hex || !preview) return;
        const update = (val) => {
            if (val && val !== 'transparent' && !val.startsWith('#') && /^[0-9A-F]{3,6}$/i.test(val)) {
                val = '#' + val;
            }
            const finalVal = val || 'transparent';
            if (picker && finalVal !== 'transparent') picker.value = finalVal;
            hex.value = val;
            preview.style.backgroundColor = finalVal;
            context.state.theme[context.getButtonKey(key)] = finalVal;
            context.syncWithWidget();
        };
        picker.addEventListener('input', (e) => update(e.target.value));
        hex.addEventListener('input', (e) => {
            const v = e.target.value;
            if (v.length === 7 || v.length === 4 || v === '' || v === 'transparent') update(v);
        });
        hex.addEventListener('change', () => context.syncWithWidget());
    };

    context.setupButtonToggle = function(id, groupId, key) {
        const toggle = document.getElementById(id);
        const group = document.getElementById(groupId);
        if (!toggle) return;
        toggle.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            if (group) {
                if (isEnabled) {
                    group.classList.remove('collapsed');
                    group.classList.remove('setting-group-disabled');
                } else {
                    group.classList.add('collapsed');
                    group.classList.add('setting-group-disabled');
                }
                
                group.querySelectorAll('input, select, button').forEach(el => {
                    el.disabled = !isEnabled;
                });

                group.querySelectorAll('.setting-item, .setting-item-compact').forEach(item => {
                    item.classList.toggle('setting-disabled', !isEnabled);
                });
            }
            context.state.theme[context.getButtonKey(key)] = isEnabled;
            if (!e._isInitialFill) {
                context.syncWithWidget();
            }
        });
    };

    const updateButtonForm = () => {
        const theme = context.state.theme;
        
        // Список полей для обновления
        const fields = [
            { id: 'inline-btn-height-input', key: 'height', type: 'range' },
            { id: 'inline-btn-width-input', key: 'width', type: 'range' },
            { id: 'inline-btn-radius-input', key: 'radius', type: 'range' },
            { id: 'inline-btn-font-size-input', key: 'font_size', type: 'range' },
            { id: 'inline-btn-font-weight-input', key: 'font_weight', type: 'range' },
            { id: 'inline-btn-bg-hex', key: 'bg', type: 'color' },
            { id: 'inline-btn-bg-opacity-input', key: 'bg_opacity', type: 'range' },
            { id: 'inline-btn-bg-h-hex', key: 'bg_h', type: 'color' },
            { id: 'inline-btn-bg-h-opacity-input', key: 'bg_opacity_h', type: 'range' },
            { id: 'inline-btn-text-hex', key: 'text', type: 'color' },
            { id: 'inline-btn-text-opacity-input', key: 'text_opacity', type: 'range' },
            { id: 'inline-btn-text-h-hex', key: 'text_h', type: 'color' },
            { id: 'inline-btn-text-h-opacity-input', key: 'text_opacity_h', type: 'range' },
            { id: 'inline-btn-border-color-hex', key: 'border_color', type: 'color' },
            { id: 'inline-btn-border-h-hex', key: 'border_color_h', type: 'color' },
            { id: 'inline-btn-border-width-input', key: 'border_width', type: 'range' },
            { id: 'inline-btn-border-opacity-input', key: 'border_opacity', type: 'range' },
            { id: 'inline-btn-border-h-width-input', key: 'border_width_h', type: 'range' },
            { id: 'inline-btn-border-h-opacity-input', key: 'border_opacity_h', type: 'range' },
            { id: 'inline-btn-shadow-color-hex', key: 'shadow_color', type: 'color' },
            { id: 'inline-btn-shadow-opacity-input', key: 'shadow_opacity', type: 'range' },
            { id: 'inline-btn-shadow-blur-input', key: 'shadow_blur', type: 'range' },
            { id: 'inline-btn-shadow-h-hex', key: 'shadow_color_h', type: 'color' },
            { id: 'inline-btn-shadow-h-opacity-input', key: 'shadow_opacity_h', type: 'range' },
            { id: 'inline-btn-shadow-h-blur-input', key: 'shadow_blur_h', type: 'range' },
            { id: 'inline-btn-bg-toggle', key: 'bg_enabled', type: 'checkbox' },
            { id: 'inline-btn-bg-h-toggle', key: 'bg_h_enabled', type: 'checkbox' },
            { id: 'inline-btn-text-h-toggle', key: 'text_h_enabled', type: 'checkbox' },
            { id: 'inline-btn-border-toggle', key: 'border_enabled', type: 'checkbox' },
            { id: 'inline-btn-border-h-toggle', key: 'border_h_enabled', type: 'checkbox' },
            { id: 'inline-btn-shadow-toggle', key: 'shadow_enabled', type: 'checkbox' },
            { id: 'inline-btn-shadow-h-toggle', key: 'shadow_h_enabled', type: 'checkbox' }
        ];

        fields.forEach(f => {
            const el = document.getElementById(f.id);
            if (!el) return;
            
            const fullKey = context.getButtonKey(f.key);
            const val = theme[fullKey];
            
            if (f.type === 'checkbox') {
                el.checked = !!val;
                // Вызываем обработчик, чтобы раскрыть/скрыть группу, но без синхронизации с виджетом, чтобы не спамить
                const event = new Event('change');
                event._isInitialFill = true; 
                el.dispatchEvent(event);
            } else if (f.type === 'color') {
                const finalColor = val || 'transparent';
                el.value = (finalColor === 'transparent') ? '' : finalColor;
                const pickerId = f.id.replace('-hex', '-picker');
                const picker = document.getElementById(pickerId);
                if (picker && finalColor !== 'transparent') picker.value = finalColor;
                const previewId = f.id.replace('-hex', '-preview');
                const preview = document.getElementById(previewId);
                if (preview) preview.style.backgroundColor = finalColor;
            } else {
                // Устанавливаем значение в ползунок
                if (val !== undefined) {
                    let numericVal = val;
                    if (typeof val === 'string') {
                        numericVal = parseFloat(val.replace('px', '').replace('%', ''));
                        if (f.id.includes('opacity') && !val.includes('%')) {
                            numericVal = numericVal * 100;
                        }
                    } else if (typeof val === 'number') {
                        numericVal = val;
                        if (f.id.includes('opacity') && val <= 1) {
                            numericVal = val * 100;
                        }
                    }
                    el.value = isNaN(numericVal) ? 0 : numericVal;
                    
                    // Сразу обновляем текстовое значение рядом
                    const valId = f.id.replace('-input', '-val').replace('-hex', '-val');
                    const valDisplay = document.getElementById(valId);
                    if (valDisplay) {
                        let displayValue = Math.round(numericVal);
                        if (f.id.includes('opacity')) {
                            displayValue += '%';
                        } else if (f.id.includes('size') || f.id.includes('width') || f.id.includes('radius') || f.id.includes('blur') || f.id.includes('height') || f.id.includes('weight')) {
                            displayValue += (f.id.includes('weight')) ? '' : 'px';
                        }
                        valDisplay.textContent = displayValue;
                    }
                }
            }
        });

        // Обновляем шрифт
        const fontSelect = document.getElementById('inline-btn-font-family-custom-select');
        if (fontSelect && fontSelect._updateFont) {
            fontSelect._updateFont(theme[context.getButtonKey('font_family')] || 'Geist');
        }
    };

    context.updateButtonForm = updateButtonForm;

    const styleSwitcher = document.getElementById('button-style-switcher');
    if (styleSwitcher) {
        // Подсвечиваем активную вкладку при загрузке
        styleSwitcher.querySelectorAll('.type-btn').forEach(t => {
            t.classList.toggle('active', t.dataset.styleId === context.currentButtonStyle);
        });

        styleSwitcher.querySelectorAll('.type-btn').forEach(tab => {
            tab.onclick = () => {
                styleSwitcher.querySelectorAll('.type-btn').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                context.currentButtonStyle = tab.dataset.styleId;
                localStorage.setItem('mitya_active_button_tab', context.currentButtonStyle);
                updateButtonForm();
            };
        });
    }

    const testButtonsToggle = document.getElementById('show-test-buttons-toggle');
    if (testButtonsToggle) {
        testButtonsToggle.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            context.state.theme.inline_btn_preview_enabled = isEnabled;
            
            if (window.MityaWidget && window.MityaWidget.showTestButtons) {
                window.MityaWidget.showTestButtons(isEnabled);
            }
            context.syncWithWidget();
        });
    }

    context.setupToggle('inline-buttons-enabled-toggle', null, 'theme.inline_buttons_enabled');
    context.setupButtonRange('inline-btn-height-input', 'inline-btn-height-val', 'px', 'height');
    context.setupButtonRange('inline-btn-width-input', 'inline-btn-width-val', 'px', 'width');
    context.setupButtonRange('inline-btn-radius-input', 'inline-btn-radius-val', 'px', 'radius');
    
    context.setupButtonRange('inline-btn-font-size-input', 'inline-btn-font-size-val', 'px', 'font_size');
    context.setupButtonRange('inline-btn-text-opacity-input', 'inline-btn-text-opacity-val', '%', 'text_opacity');
    context.setupButtonRange('inline-btn-text-h-opacity-input', 'inline-btn-text-h-opacity-val', '%', 'text_opacity_h');
    context.setupButtonRange('inline-btn-bg-opacity-input', 'inline-btn-bg-opacity-val', '%', 'bg_opacity');
    context.setupButtonRange('inline-btn-bg-h-opacity-input', 'inline-btn-bg-h-opacity-val', '%', 'bg_opacity_h');
    context.setupButtonRange('inline-btn-border-width-input', 'inline-btn-border-width-val', 'px', 'border_width');
    context.setupButtonRange('inline-btn-border-opacity-input', 'inline-btn-border-opacity-val', '%', 'border_opacity');
    context.setupButtonRange('inline-btn-border-h-width-input', 'inline-btn-border-h-width-val', 'px', 'border_width_h');
    context.setupButtonRange('inline-btn-border-h-opacity-input', 'inline-btn-border-h-opacity-val', '%', 'border_opacity_h');
    context.setupButtonRange('inline-btn-shadow-opacity-input', 'inline-btn-shadow-opacity-val', '%', 'shadow_opacity');
    context.setupButtonRange('inline-btn-shadow-blur-input', 'inline-btn-shadow-blur-val', 'px', 'shadow_blur');
    context.setupButtonRange('inline-btn-shadow-h-opacity-input', 'inline-btn-shadow-h-opacity-val', '%', 'shadow_opacity_h');
    context.setupButtonRange('inline-btn-shadow-h-blur-input', 'inline-btn-shadow-h-blur-val', 'px', 'shadow_blur_h');
    
    context.setupButtonColor('inline-btn-bg-picker', 'inline-btn-bg-hex', 'inline-btn-bg-preview', 'bg');
    context.setupButtonColor('inline-btn-bg-h-picker', 'inline-btn-bg-h-hex', 'inline-btn-bg-h-preview', 'bg_h');
    context.setupButtonColor('inline-btn-text-picker', 'inline-btn-text-hex', 'inline-btn-text-preview', 'text');
    context.setupButtonColor('inline-btn-text-h-picker', 'inline-btn-text-h-hex', 'inline-btn-text-h-preview', 'text_h');
    context.setupButtonColor('inline-btn-border-color-picker', 'inline-btn-border-color-hex', 'inline-btn-border-color-preview', 'border_color');
    context.setupButtonColor('inline-btn-border-h-picker', 'inline-btn-border-h-hex', 'inline-btn-border-h-preview', 'border_color_h');
    context.setupButtonColor('inline-btn-shadow-color-picker', 'inline-btn-shadow-color-hex', 'inline-btn-shadow-color-preview', 'shadow_color');
    context.setupButtonColor('inline-btn-shadow-h-picker', 'inline-btn-shadow-h-hex', 'inline-btn-shadow-h-preview', 'shadow_color_h');
    
    context.setupButtonToggle('inline-btn-bg-toggle', 'inline-btn-bg-group', 'bg_enabled');
    context.setupButtonToggle('inline-btn-bg-h-toggle', 'inline-btn-bg-h-group', 'bg_h_enabled');
    context.setupButtonToggle('inline-btn-text-h-toggle', 'inline-btn-text-h-group', 'text_h_enabled');
    context.setupButtonToggle('inline-btn-border-toggle', 'inline-btn-border-group', 'border_enabled');
    context.setupButtonToggle('inline-btn-border-h-toggle', 'inline-btn-border-h-group', 'border_h_enabled');
    context.setupButtonToggle('inline-btn-shadow-toggle', 'inline-btn-shadow-group', 'shadow_enabled');
    context.setupButtonToggle('inline-btn-shadow-h-toggle', 'inline-btn-shadow-h-group', 'shadow_h_enabled');
    
    // Инициализация шрифта кнопок
    context.setupFontSelect('inline-btn-font-family-custom-select', 'inline-btn-font-family-select', 'current-inline-btn-font-name', () => context.getButtonKey('font_family'));

    const btnWeightInput = document.getElementById('inline-btn-font-weight-input');
    const btnWeightVal = document.getElementById('inline-btn-font-weight-val');
    if (btnWeightInput) {
        btnWeightInput.addEventListener('input', (e) => {
            const val = e.target.value;
            if (btnWeightVal) btnWeightVal.textContent = val;
            context.state.theme[context.getButtonKey('font_weight')] = val;
            context.syncWithWidget();
        });
    }

    ['inline-btn-text-label-input', 'inline-btn-right-text-label-input'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', (e) => {
                const key = input.dataset.setting.split('.')[1];
                context.state.theme[key] = e.target.value;
                context.syncWithWidget();
            });
        }
    });

    window.randomizeButtonsDesign = () => MagicDesignModule.randomizeButtonsDesign(context);
    
    window.resetButtonsToDefault = () => {
        context.confirmAction('Сбросить дизайн ВСЕХ кнопок?', 'Настройки всех типов кнопок (Акцентная, Нейтральная, Инфо) будут возвращены к золотому стандарту.', () => {
            const defaults = context.getFilteredDefaults('inline_btn_');
            context.state.theme = { ...context.state.theme, ...defaults };
            
            // Сбрасываем тумблер предпросмотра в UI
            const previewToggle = document.getElementById('show-test-buttons-toggle');
            if (previewToggle) previewToggle.checked = false;

            updateButtonForm();
            context.syncWithWidget();
            context.showSuccess('Дизайн всех кнопок сброшен');
        });
    };

    // Вызываем обновление при инициализации
    setTimeout(updateButtonForm, 100);
}
