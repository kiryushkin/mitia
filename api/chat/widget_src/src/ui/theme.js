import { formatDim, escapeHtml, isMobile, hexToRgba } from '../utils/dom';
import { renderMarkdown } from './render';
import { positionChatWindow, scrollToBottom } from './window';
import { showBotMessagePreview, showUserMessagePreview, showOperatorMessagePreview } from './messages';

// Показывает тестовые кнопки в чате для настройки дизайна 
export function showTestButtons(show, els, shadow) {
    const testId = 'mitya-test-buttons';
    let container = shadow ? shadow.getElementById(testId) : document.getElementById(testId);
    
    if (!show) {
        if (container) container.remove();
        return;
    }
    
    if (container) return;

    container = document.createElement('div');
    container.id = testId;
    container.className = 'message bot chat-test-buttons-msg';
    container.innerHTML = `
        <div class="message-content">
            <div class="chat-inline-buttons-container">
                <button class="chat-inline-btn btn-left"><span>Да</span></button>
                <button class="chat-inline-btn btn-right"><span>Нет</span></button>
                <button class="chat-inline-btn btn-info"><span>Выбор</span></button>
            </div>
        </div>
    `;
    
    if (els.messagesContainer) {
        els.messagesContainer.appendChild(container);
        scrollToBottom(els);
    }
}

// Загружает шрифт из Google Fonts
function loadGoogleFont(fontName) {
    if (!fontName || typeof fontName !== 'string') return;
    
    const forbidden = ['inherit', 'undefined', 'null', 'none', 'default'];
    if (forbidden.includes(fontName.toLowerCase().trim())) return;
    
    const cleanName = fontName.replace(/['"]/g, '').trim();
    if (!cleanName || cleanName.length < 2) return;

    const fontId = `mitya-font-${cleanName.replace(/\s+/g, '-').toLowerCase()}`;
    if (!document.getElementById(fontId)) {
        const link = document.createElement('link');
        link.id = fontId;
        link.rel = 'stylesheet';
        // Используем перечисление весов вместо диапазона для лучшей совместимости
        link.href = `https://fonts.googleapis.com/css2?family=${cleanName.replace(/\s+/g, '+')}:wght@400;700&display=swap`;
        document.head.appendChild(link);
    }
}

// Применяет настройки темы к элементам виджета
export function applyTheme(theme, config, els, shadow, data = {}) {
    if (!theme) return;

    // Загружаем шрифты
    if (theme.welcome_font_family) loadGoogleFont(theme.welcome_font_family);
    if (theme.msg_bot_font_family) loadGoogleFont(theme.msg_bot_font_family);
    if (theme.msg_user_font_family) loadGoogleFont(theme.msg_user_font_family);
    if (theme.msg_operator_font_family) loadGoogleFont(theme.msg_operator_font_family);
    if (theme.inline_btn_font_family) loadGoogleFont(theme.inline_btn_font_family);
    
    // СУПЕР-СИЛА: Если админка шлет force_position, сбрасываем ручные координаты
    if (data.force_position) {
        window.mitya_session_rect = null;
    }
    
    // Объединяем тему сразу, чтобы корректно определять отсутствие параметров (например, удаленный логотип)
    const t = { ...config.theme, ...theme };
    config.theme = t;

    console.log('[ChatWidget] Applying theme:', theme, 'Data:', data);
    window.currentThemeData = t;

    const host = document.getElementById('mitya-widget-host');
    const root = shadow ? (shadow.querySelector('.chat-widget') || shadow.querySelector('#chat-widget')) : document.documentElement;
    
    const setProp = (name, val) => {
        if (root) root.style.setProperty(name, val);
        if (host) host.style.setProperty(name, val);
        if (document.documentElement) document.documentElement.style.setProperty(name, val);
    };

    // СУПЕР-СИЛА: Если админка шлет force_position, сбрасываем ручные координаты
    if (data.force_position) {
        window.mitya_session_rect = null;
        if (els.window) {
            els.window.style.width = '';
            els.window.style.height = '';
            els.window.style.left = '';
            els.window.style.top = '';
        }
    }

    // Сбрасываем mitya_session_rect только если параметры окна ДЕЙСТВИТЕЛЬНО изменились
    // Это предотвратит прыжки окна при загрузке логотипа или смене цветов
    const isWindowSizeChanged = (theme.window_width !== undefined && theme.window_width !== config.theme.window_width) ||
                                (theme.window_height !== undefined && theme.window_height !== config.theme.window_height);
    const isWindowPosChanged = (theme.window_left !== undefined && theme.window_left !== config.theme.window_left) ||
                               (theme.window_top !== undefined && theme.window_top !== config.theme.window_top);

    if ((isWindowSizeChanged || isWindowPosChanged) && !data.is_local_update && !data.is_initial_load) {
        window.mitya_session_rect = null;
        if (els.window) {
            els.window.style.width = '';
            els.window.style.height = '';
            els.window.style.left = '';
            els.window.style.top = '';
        }
    }

    if (theme.widget_enabled !== undefined) {
        const displayValue = theme.widget_enabled ? 'flex' : 'none';
        if (els.widget) els.widget.style.display = displayValue;
        if (els.widgetContainer) els.widgetContainer.style.display = displayValue;
        if (els.welcome) els.welcome.style.display = theme.widget_enabled ? '' : 'none';
    }

    // Проверка: находимся ли мы в админке или режиме предпросмотра
    const isFromAdmin = window.location.pathname.includes('/admin') || 
                        window.location.search.includes('client_id=');

    if (isFromAdmin) {
        if (t.msg_bot_preview_enabled !== undefined) {
            showBotMessagePreview(t.msg_bot_preview_enabled, els, config);
        }

        if (t.msg_user_preview_enabled !== undefined) {
            showUserMessagePreview(t.msg_user_preview_enabled, els, config);
        }

        if (t.msg_operator_preview_enabled !== undefined) {
            showOperatorMessagePreview(t.msg_operator_preview_enabled, els, config);
        }
    }

    if (t.welcome_bubble_text !== undefined && els.welcome) {
        const textSpan = els.welcome.querySelector('span');
        if (textSpan) {
            textSpan.textContent = t.welcome_bubble_text;
            textSpan.style.display = t.welcome_text_enabled === false ? 'none' : '';
        }
    }

    // ШРИФТЫ
    if (t.welcome_font_family) setProp('--chat-welcome-font-family', t.welcome_font_family);
    if (t.msg_bot_font_family) setProp('--chat-font-family', t.msg_bot_font_family);
    if (t.inline_btn_font_family) setProp('--chat-inline-btn-font-family', t.inline_btn_font_family);

    if (t.welcome_text_align) setProp('--chat-welcome-text-align', t.welcome_text_align);
    if (t.welcome_text_valign) setProp('--chat-welcome-text-valign', t.welcome_text_valign);

    // ПОЛИТИКА
    const privacyNote = els.privacyNote || (els.messagesContainer && els.messagesContainer.querySelector('.chat-privacy-note'));
    if (privacyNote) {
        privacyNote.style.display = t.chat_privacy_enabled !== false ? 'block' : 'none';
        const link = privacyNote.querySelector('a');
        if (link) {
            link.href = t.chat_privacy_url || 'https://mitia.pro/privacy';
            link.target = t.chat_privacy_target_blank !== false ? '_blank' : '_self';
        }
    }

    if (t.chat_link_color) {
        const linkOpacity = t.chat_link_opacity !== undefined ? t.chat_link_opacity : 100;
        setProp('--chat-link-color', hexToRgba(t.chat_link_color, linkOpacity));
    }
    
    if (t.chat_link_h_enabled) {
        const linkHOpacity = t.chat_link_opacity_h !== undefined ? t.chat_link_opacity_h : 100;
        setProp('--chat-link-color-hover', hexToRgba(t.chat_link_color_h || t.chat_link_color, linkHOpacity));
    } else {
        setProp('--chat-link-color-hover', 'var(--chat-link-color)');
    }

    if (t.chat_typing_indicator_color) {
        setProp('--chat-typing-indicator-color', t.chat_typing_indicator_color);
    }
    if (t.chat_typewriter_color) {
        setProp('--chat-typewriter-indicator-color', t.chat_typewriter_color);
    }

    if (els.widgetContainer) {
        const wLeft = parseFloat(theme.widget_left ?? config.theme.widget_left);
        const wTop = parseFloat(theme.widget_top ?? config.theme.widget_top);
        const hasManualPos = els.widgetContainer.style.left && els.widgetContainer.style.left.includes('px');

        if (!data.force_position && hasManualPos) {
        } else {
            els.widgetContainer.style.left = '';
            els.widgetContainer.style.top = '';
            els.widgetContainer.style.right = '';
            els.widgetContainer.style.bottom = '';

            if (wLeft > 50) {
                els.widgetContainer.style.right = (100 - wLeft) + '%';
                els.widgetContainer.style.left = 'auto';
            } else {
                els.widgetContainer.style.left = wLeft + '%';
                els.widgetContainer.style.right = 'auto';
            }
            if (wTop > 50) {
                els.widgetContainer.style.bottom = (100 - wTop) + '%';
                els.widgetContainer.style.top = 'auto';
            } else {
                els.widgetContainer.style.top = wTop + '%';
                els.widgetContainer.style.bottom = 'auto';
            }
        }
        const isLeft = wLeft < 50;
        const isTop = wTop < 50;
        els.widgetContainer.style.transformOrigin = (isLeft ? 'left' : 'right') + ' ' + (isTop ? 'top' : 'bottom');
    }
    
    if (!isFromAdmin && data.is_local_update) {
        try {
            const localTheme = JSON.parse(localStorage.getItem(`mitya_theme_${config.clientId}`) || '{}');
            const updatedTheme = { ...localTheme, ...theme };
            localStorage.setItem(`mitya_theme_${config.clientId}`, JSON.stringify(updatedTheme));
        } catch (e) { console.error('Failed to save local theme', e); }
    }

    config.theme = { ...config.theme, ...theme };
    if (data.bot_settings) {
        config.bot_settings = { ...config.bot_settings, ...data.bot_settings };
    }
    
    if (!root) return;

    const isBgEnabled = theme.window_bg_enabled !== false;
    const isImgEnabled = theme.window_bg_img_enabled !== false;

    // ФОНОВОЕ ИЗОБРАЖЕНИЕ
    if (theme.window_bg_img && theme.window_bg_img !== 'none' && theme.window_bg_img !== '' && isImgEnabled) {
        let bgUrl = theme.window_bg_img;
        if (bgUrl.startsWith('/') && config.serverUrl) bgUrl = config.serverUrl + bgUrl;
        setProp('--chat-window-bg-img', `url("${bgUrl}")`);
        let imgOpacity = 1;
        if (theme.window_bg_img_opacity !== undefined) {
            imgOpacity = parseFloat(theme.window_bg_img_opacity);
            if (imgOpacity > 1) imgOpacity = imgOpacity / 100;
        }
        setProp('--chat-window-bg-img-opacity', imgOpacity);
    } else {
        setProp('--chat-window-bg-img', 'none');
        setProp('--chat-window-bg-img-opacity', '0');
    }

    // ЦВЕТ ФОНА И РАЗМЫТИЕ - ПЕРЕНЕСЕНО НИЖЕ В БЛОК ОКНА ЧАТА
    
    const bgEnabled = t.widget_bg_enabled !== false;
    const brandOpacity = t.widget_bg_opacity;
    
    let brandBgValue = 'transparent';
    if (bgEnabled && t.widget_bg_color && t.widget_bg_color !== 'transparent') {
        brandBgValue = t.widget_bg_color.includes('gradient') ? t.widget_bg_color : hexToRgba(t.widget_bg_color, brandOpacity);
    }
    setProp('--chat-brand-rgba', brandBgValue);
    setProp('--chat-brand', (bgEnabled && !t.widget_bg_color?.includes('gradient')) ? t.widget_bg_color : 'transparent');
    setProp('--chat-brand-opacity', bgEnabled ? brandOpacity : 0);

    const imgEnabled = t.widget_img_enabled !== false;
    const imgOpacity = t.widget_img_opacity;

    if (t.widget_img && imgEnabled) {
        setProp('--chat-widget-img', `url("${t.widget_img}")`);
        setProp('--chat-widget-img-opacity', imgOpacity);
    } else {
        setProp('--chat-widget-img', 'none');
        setProp('--chat-widget-img-opacity', '0');
    }

    // ШАПКА - ПЕРЕНЕСЕНО НИЖЕ В БЛОК ОБРАБОТКИ ШАПКИ
    
    // МАСКА ШАПКИ
    const headerMaskEnabled = t.header_mask_enabled === true;
    if (headerMaskEnabled) {
        setProp('--chat-header-mask-height', formatDim(t.header_mask_height, 'px'));
        setProp('--chat-header-mask-smoothness', formatDim(t.header_mask_smoothness, 'px'));
    } else {
        setProp('--chat-header-mask-height', '0px');
        setProp('--chat-header-mask-smoothness', '0px');
    }

    // Кнопки шапки
    ['close', 'expand'].forEach(type => {
        const prefix = `--chat-header-btn-${type}`;
        const keyPrefix = `header_btn_${type}`;
        
        const bgEnabled = t[`${keyPrefix}_bg_enabled`] !== false;
        const bg = t[`${keyPrefix}_bg`];
        const bgOpacity = t[`${keyPrefix}_bg_opacity`] !== undefined ? t[`${keyPrefix}_bg_opacity`] : 1;
        const bgValue = bgEnabled ? hexToRgba(bg, bgOpacity) : 'transparent';
        setProp(`${prefix}-bg`, bgValue);
        
        const bgHEnabled = t[`${keyPrefix}_bg_h_enabled`] !== false;
        const bgH = t[`${keyPrefix}_bg_h`];
        const bgOpacityH = t[`${keyPrefix}_bg_opacity_h`];
        const bgValueH = bgHEnabled ? hexToRgba(bgH, bgOpacityH) : bgValue;
        setProp(`${prefix}-bg-hover`, bgValueH);
        
        if (type === 'close') {
            console.log(`[Theme] Header ${type} bg:`, { bgEnabled, bgValue, bgHEnabled, bgValueH });
        }
        
        // Цвет и прозрачность иконки
        const iconColor = t[`${keyPrefix}_color`];
        const iconOpacity = t[`${keyPrefix}_opacity`];
        setProp(`${prefix}-color`, hexToRgba(iconColor, iconOpacity));
        
        const iconHEnabled = t[`${keyPrefix}_color_h_enabled`] === true;
        const iconColorH = t[`${keyPrefix}_color_h`];
        const iconOpacityH = t[`${keyPrefix}_opacity_h`];
        setProp(`${prefix}-color-hover`, iconHEnabled ? hexToRgba(iconColorH, iconOpacityH) : hexToRgba(iconColor, iconOpacity));
        
        setProp(`${prefix}-radius`, formatDim(t[`${keyPrefix}_radius`], '%'));
        setProp(`${prefix}-size`, formatDim(t[`${keyPrefix}_size`], 'px'));
        
        // Обводка
        const bEnabled = t[`${keyPrefix}_border_enabled`] !== false;
        const bWidth = parseFloat(t[`${keyPrefix}_border_width`]);
        const bOpacity = t[`${keyPrefix}_border_opacity`];
        const bColor = t[`${keyPrefix}_border_color`];
        const borderValue = (bEnabled && bWidth > 0) ? `${bWidth}px solid ${hexToRgba(bColor, bOpacity)}` : 'none';
        setProp(`${prefix}-border`, borderValue);
        
        const bEnabledH = t[`${keyPrefix}_border_h_enabled`] !== false;
        const bWidthH = parseFloat(t[`${keyPrefix}_border_width_h`]);
        const bOpacityH = t[`${keyPrefix}_border_opacity_h`];
        const bColorH = t[`${keyPrefix}_border_color_h`];
        setProp(`${prefix}-border-hover`, (bEnabledH && bWidthH > 0) ? `${bWidthH}px solid ${hexToRgba(bColorH, bOpacityH)}` : borderValue);

        // Тень
        const sEnabled = t[`${keyPrefix}_shadow_enabled`] !== false;
        const sBlur = formatDim(t[`${keyPrefix}_shadow_blur`], 'px');
        const sOpacity = t[`${keyPrefix}_shadow_opacity`];
        const sColor = t[`${keyPrefix}_shadow_color`];
        const shadowValue = sEnabled ? `0 0 ${sBlur} ${hexToRgba(sColor, sOpacity)}` : 'none';
        setProp(`${prefix}-shadow`, shadowValue);
        
        const sEnabledH = t[`${keyPrefix}_shadow_h_enabled`] !== false;
        const sBlurH = formatDim(t[`${keyPrefix}_shadow_blur_h`], 'px');
        const sOpacityH = t[`${keyPrefix}_shadow_opacity_h`];
        const sColorH = t[`${keyPrefix}_shadow_color_h`];
        setProp(`${prefix}-shadow-hover`, sEnabledH ? `0 0 ${sBlurH} ${hexToRgba(sColorH, sOpacityH)}` : shadowValue);

        // Размытие фона (Blur)
        const blurVal = formatDim(t[`${keyPrefix}_bg_blur`], 'px');
        setProp(`${prefix}-blur`, bgEnabled ? blurVal : '0px');
        
        const blurValH = formatDim(t[`${keyPrefix}_bg_h_blur`], 'px');
        setProp(`${prefix}-blur-hover`, bgHEnabled ? blurValH : '0px');
    });

    // ЭФФЕКТ ТОЧКИ
    const dotsEnabled = t.widget_dots_enabled !== false && t.widget_effects_enabled !== false;
    const dotsOpacity = t.widget_dots_opacity;
    
    setProp('--chat-widget-dots-display', dotsEnabled ? 'flex' : 'none');
    setProp('--chat-widget-dots-opacity', dotsOpacity);
    setProp('--chat-widget-dots-visibility', dotsEnabled ? 'visible' : 'hidden');
    setProp('--chat-widget-dots-size', formatDim(t.widget_dots_size, '%'));
    setProp('--chat-widget-dots-speed', formatDim(t.widget_dots_speed, 's'));
    if (t.widget_dots_color) setProp('--chat-icon-color', t.widget_dots_color);

    const borderEnabled = t.widget_border_enabled !== false;
    const brandBorderOpacity = t.widget_border_opacity;
    const brandBorderWidth = parseFloat(t.widget_border_width);
    setProp('--chat-brand-border', (t.widget_border_color && brandBorderOpacity > 0 && borderEnabled && brandBorderWidth > 0) ? t.widget_border_color : 'transparent');
    setProp('--chat-brand-border-opacity', borderEnabled ? brandBorderOpacity : 0);
    setProp('--chat-brand-border-width', (borderEnabled ? brandBorderWidth : 0) + 'px');
    setProp('--chat-brand-blur', bgEnabled ? formatDim(t.widget_bg_blur, 'px') : '0px');
    if (t.widget_dots_color) setProp('--chat-icon-color', t.widget_dots_color);

    const isPulseEnabled = (t.widget_pulse_enabled === true || t.pulse === 'block') && t.widget_effects_enabled !== false;
    setProp('--chat-widget-pulse', isPulseEnabled ? 'block' : 'none');
    if (isPulseEnabled) {
        const pOpacity = t.widget_pulse_opacity;
        setProp('--chat-widget-pulse-color', t.widget_pulse_color ? hexToRgba(t.widget_pulse_color, pOpacity) : 'transparent');
        setProp('--chat-widget-pulse-size', parseFloat(t.widget_pulse_size));
        
        const pSpeed = parseFloat(t.widget_pulse_speed);
        const pPause = parseFloat(t.widget_pulse_pause);
        const pTotal = pSpeed + pPause;
        
        const pEnd = (pSpeed / pTotal) * 100;
        
        setProp('--chat-widget-pulse-duration', pTotal + 's');

        // Генерируем динамический стиль для пульсации
        const styleId = 'mitya-pulse-dynamic-style';
        const keyframes = `
            @keyframes mitya-pulse-anim {
                0% { transform: scale(1); opacity: ${pOpacity}; }
                ${pEnd.toFixed(2)}% { transform: scale(${parseFloat(t.widget_pulse_size)}); opacity: 0; }
                100% { transform: scale(1); opacity: 0; }
            }
        `;

        [document, shadow].forEach(root => {
            if (!root) return;
            let styleEl = root.getElementById ? root.getElementById(styleId) : root.querySelector(`#${styleId}`);
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = styleId;
                (root.head || root).appendChild(styleEl);
            }
            styleEl.innerHTML = keyframes;
        });
    }
    setProp('--chat-widget-size', formatDim(t.widget_size, 'px'));
    setProp('--chat-widget-radius', formatDim(t.widget_radius, 'px'));

    const shadowEnabled = t.widget_shadow_enabled !== false;
    const shadowOpacity = t.widget_shadow_opacity;
    setProp('--chat-widget-shadow', shadowEnabled ? `0 0 ${formatDim(t.widget_shadow_blur, 'px')} ${hexToRgba(t.widget_shadow_color, shadowOpacity)}` : 'none');

    // ЭФФЕКТ БЛИК
    const glareEnabled = t.widget_glare_enabled === true && t.widget_effects_enabled !== false;
    setProp('--chat-widget-glare', glareEnabled ? 'block' : 'none');
    if (glareEnabled) {
        const gSpeed = parseFloat(t.widget_glare_speed);
        const gPause = parseFloat(t.widget_glare_pause || 0);
        const gTotal = gSpeed + gPause;
        const gEnd = (gSpeed / gTotal) * 100;

        setProp('--chat-widget-glare-color', hexToRgba(t.widget_glare_color, t.widget_glare_opacity));
        setProp('--chat-widget-glare-speed', gTotal + 's');
        setProp('--chat-widget-glare-size', formatDim(t.widget_glare_size, '%'));

        // Генерируем динамический стиль для блика
        const styleId = 'mitya-glare-dynamic-style';
        const keyframes = `
            @keyframes mitya-glare-anim {
                0% { left: -150%; }
                ${gEnd.toFixed(2)}% { left: 150%; }
                100% { left: 150%; }
            }
        `;

        [document, shadow].forEach(root => {
            if (!root) return;
            let styleEl = root.getElementById ? root.getElementById(styleId) : root.querySelector(`#${styleId}`);
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = styleId;
                (root.head || root).appendChild(styleEl);
            }
            styleEl.innerHTML = keyframes;
        });
    }

    // ЭФФЕКТ ДЫХАНИЕ
    const breathingEnabled = t.widget_breathing_enabled === true && t.widget_effects_enabled !== false;
    setProp('--chat-widget-breathing', breathingEnabled ? 'mitya-breathing-anim' : 'none');
    if (breathingEnabled) {
        const speed = parseFloat(t.widget_breathing_speed);
        const pause = parseFloat(t.widget_breathing_pause);
        const totalDuration = speed + pause;
        
        const moveEnd = (speed / totalDuration) * 100;
        const moveMid = moveEnd / 2;
        
        setProp('--chat-widget-breathing-duration', totalDuration + 's');
        
        const scalePercent = parseFloat(t.widget_breathing_scale);
        const scaleValue = 1 + (scalePercent / 100);

        // Генерируем динамический стиль внутри Shadow DOM или документа
        const styleId = 'mitya-breathing-dynamic-style';
        const keyframes = `
            @keyframes mitya-breathing-anim {
                0% { transform: scale(1); }
                ${moveMid.toFixed(2)}% { transform: scale(${scaleValue}); }
                ${moveEnd.toFixed(2)}% { transform: scale(1); }
                100% { transform: scale(1); }
            }
        `;

        // Добавляем стили и в основной документ, и в Shadow DOM (для надежности)
        [document, shadow].forEach(root => {
            if (!root) return;
            let styleEl = root.getElementById ? root.getElementById(styleId) : root.querySelector(`#${styleId}`);
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = styleId;
                (root.head || root).appendChild(styleEl);
            }
            styleEl.innerHTML = keyframes;
        });
    }


    // ОБЛАКО
    if (t.welcome_max_width) setProp('--chat-welcome-max-width', formatDim(t.welcome_max_width, 'px'));
    if (t.welcome_radius) setProp('--chat-welcome-radius', formatDim(t.welcome_radius, 'px'));
    
    const welcomeBgEnabled = t.welcome_bg_enabled !== false;
    if (welcomeBgEnabled) {
        if (t.welcome_bg) {
            const welcomeBgOpacity = t.welcome_bg_opacity;
            setProp('--chat-welcome-bg', hexToRgba(t.welcome_bg, welcomeBgOpacity));
        }
        setProp('--chat-welcome-bg-blur', formatDim(t.welcome_bg_blur, 'px'));
    } else {
        setProp('--chat-welcome-bg', 'transparent');
        setProp('--chat-welcome-bg-blur', '0px');
    }

    const welcomeImgEnabled = t.welcome_img_enabled !== false;
    if (welcomeImgEnabled && t.welcome_img) {
        setProp('--chat-welcome-img', `url("${t.welcome_img}")`);
        let welcomeImgOpacity = 1;
        if (t.welcome_img_opacity !== undefined) {
            welcomeImgOpacity = parseFloat(t.welcome_img_opacity);
            if (welcomeImgOpacity > 1) welcomeImgOpacity = welcomeImgOpacity / 100;
        }
        setProp('--chat-welcome-img-opacity', welcomeImgOpacity);
    } else {
        setProp('--chat-welcome-img', 'none');
        setProp('--chat-welcome-img-opacity', '0');
    }

    const welcomeTextOpacity = t.welcome_text_opacity !== undefined ? parseFloat(t.welcome_text_opacity) : 1;
    const normalizedTextOpacity = welcomeTextOpacity > 1 ? welcomeTextOpacity / 100 : welcomeTextOpacity;
    
    if (t.welcome_text_color) {
        setProp('--chat-welcome-text', hexToRgba(t.welcome_text_color, normalizedTextOpacity));
    }
    setProp('--chat-welcome-text-opacity', normalizedTextOpacity);
    if (t.welcome_text_align) setProp('--chat-welcome-text-align', t.welcome_text_align);
    
    // Принудительно устанавливаем размер, толщину и шрифт для облака
    const wFontSize = formatDim(t.welcome_font_size, 'px');
    setProp('--chat-welcome-font-size', wFontSize);
    
    if (t.welcome_font_weight) {
        setProp('--chat-welcome-font-weight', String(t.welcome_font_weight));
    }
    
    const wFontFamily = t.welcome_font_family;
    setProp('--chat-welcome-font-family', wFontFamily === 'inherit' ? 'inherit' : `'${wFontFamily}'`);

    if (t.welcome_max_width) setProp('--chat-welcome-max-width', formatDim(t.welcome_max_width, 'px'));
    if (t.welcome_height) setProp('--chat-welcome-height', formatDim(t.welcome_height, 'px'));

    // КНОПКА ЗАКРЫТИЯ ОБЛАКА
    const closeIconColor = t.welcome_close_color;
    const closeIconOpacity = parseFloat(t.welcome_close_opacity);
    setProp('--chat-welcome-close-color', hexToRgba(closeIconColor, closeIconOpacity));
    setProp('--chat-welcome-close-opacity', closeIconOpacity);

    const closeIconHEnabled = t.welcome_close_color_h_enabled === true;
    const closeIconColorH = t.welcome_close_hover_color;
    const closeIconOpacityH = parseFloat(t.welcome_close_hover_opacity);
    
    setProp('--chat-welcome-close-hover-color', closeIconHEnabled ? hexToRgba(closeIconColorH, closeIconOpacityH) : hexToRgba(closeIconColor, closeIconOpacity));
    setProp('--chat-welcome-close-hover-opacity', closeIconHEnabled ? closeIconOpacityH : closeIconOpacity);

    // ФОН КНОПКИ ЗАКРЫТИЯ
    const closeBgEnabled = t.welcome_close_bg_enabled !== false;
    const closeBgColor = t.welcome_close_bg;
    const closeBgOpacity = parseFloat(t.welcome_close_bg_opacity);
    const closeBgValue = closeBgEnabled ? hexToRgba(closeBgColor, closeBgOpacity) : 'transparent';
    setProp('--chat-welcome-close-bg', closeBgValue);

    const closeBgHEnabled = t.welcome_close_hover_bg_enabled === true;
    const closeBgColorH = t.welcome_close_hover_bg;
    const closeBgOpacityH = parseFloat(t.welcome_close_hover_bg_opacity);
    setProp('--chat-welcome-close-hover-bg', closeBgHEnabled ? hexToRgba(closeBgColorH, closeBgOpacityH) : closeBgValue);
    
    // Геометрия кнопки крестика
    if (t.welcome_close_size) {
        const closeSize = formatDim(t.welcome_close_size, 'px');
        const closeSizeNum = parseFloat(closeSize);
        setProp('--chat-welcome-close-size', closeSize);
        
        // Размер иконки × делаем пропорциональным (50% от размера кнопки для SVG)
        const iconSize = (closeSizeNum * 0.5) + 'px';
        setProp('--chat-welcome-close-icon-size', iconSize);

        // Динамические отступы облака зависят от РАЗМЕРА кнопки
        const isLeft = t.welcome_close_side === 'left';
        const dynamicPadding = (closeSizeNum + 12) + 'px';
        
        setProp('--chat-welcome-padding-left', isLeft ? dynamicPadding : '16px');
        setProp('--chat-welcome-padding-right', isLeft ? '16px' : dynamicPadding);
        
        if (t.welcome_close_side) {
            setProp('--chat-welcome-close-left', isLeft ? '8px' : 'auto');
            setProp('--chat-welcome-close-right', isLeft ? 'auto' : '8px');
        }
    }
    if (t.welcome_close_radius) setProp('--chat-welcome-close-radius', formatDim(t.welcome_close_radius, '%'));

    // Обводка кнопки крестика
    const closeBorderEnabled = t.welcome_close_border_enabled !== false;
    const closeBWidth = parseFloat(t.welcome_close_border_width) || 0;
    if (closeBorderEnabled && closeBWidth > 0 && t.welcome_close_border_color) {
        const closeBOpacity = t.welcome_close_border_opacity;
        setProp('--chat-welcome-close-border', `${closeBWidth}px solid ${hexToRgba(t.welcome_close_border_color, closeBOpacity)}`);
    } else {
        setProp('--chat-welcome-close-border', 'none');
    }

    const closeBorderHEnabled = t.welcome_close_border_h_enabled === true;
    const closeBWidthH = parseFloat(t.welcome_close_border_width_h) || closeBWidth;
    const closeBColorH = t.welcome_close_border_color_h || t.welcome_close_border_color;
    const closeBOpacityH = parseFloat(t.welcome_close_border_opacity_h ?? t.welcome_close_border_opacity ?? 1);

    if (closeBorderHEnabled && closeBWidthH > 0) {
        setProp('--chat-welcome-close-border-h', `${closeBWidthH}px solid ${hexToRgba(closeBColorH, closeBOpacityH)}`);
    } else {
        setProp('--chat-welcome-close-border-h', closeBorderEnabled ? `${closeBWidth}px solid ${hexToRgba(t.welcome_close_border_color, t.welcome_close_border_opacity)}` : 'none');
    }

    // Тень кнопки крестика
    const closeShadowEnabled = t.welcome_close_btn_shadow_enabled !== false;
    const closeSBlur = formatDim(t.welcome_close_btn_shadow_blur, 'px');
    const closeSOpacity = t.welcome_close_btn_shadow_opacity;
    const shadowValue = closeShadowEnabled ? `0 0 ${closeSBlur} ${hexToRgba(t.welcome_close_btn_shadow_color, closeSOpacity)}` : 'none';
    setProp('--chat-welcome-close-shadow', shadowValue);

    const closeShadowHEnabled = t.welcome_close_btn_shadow_h_enabled === true;
    if (closeShadowHEnabled && t.welcome_close_btn_shadow_color_h) {
        const closeSOpacityH = t.welcome_close_btn_shadow_opacity_h;
        const closeSBlurH = formatDim(t.welcome_close_btn_shadow_blur_h, 'px');
        setProp('--chat-welcome-close-shadow-h', `0 0 ${closeSBlurH} ${hexToRgba(t.welcome_close_btn_shadow_color_h, closeSOpacityH)}`);
    } else {
        setProp('--chat-welcome-close-shadow-h', shadowValue);
    }

    const welcomeBorderEnabled = t.welcome_border_enabled !== false;
    const welcomeBWidth = parseFloat(t.welcome_border_width) || 0;
    if (welcomeBorderEnabled && welcomeBWidth > 0) {
        const welcomeBOpacity = t.welcome_border_opacity;
        // Используем box-shadow spread для идеально точной обводки контура
        setProp('--chat-welcome-border', `0 0 0 ${welcomeBWidth}px ${hexToRgba(t.welcome_border, welcomeBOpacity)}`);
    } else {
        setProp('--chat-welcome-border', 'none');
    }

    const welcomeShadowEnabled = t.welcome_shadow_enabled !== false;
    if (welcomeShadowEnabled) {
        const welcomeSOpacity = t.welcome_shadow_opacity;
        const welcomeSBlur = formatDim(t.welcome_shadow_blur, 'px');
        setProp('--chat-welcome-shadow', `0 0 ${welcomeSBlur} ${hexToRgba(t.welcome_shadow_color, welcomeSOpacity)}`);
    } else {
        setProp('--chat-welcome-shadow', 'none');
    }

    // ШАПКА ОКНА
    try {
        const headerLogoEl = els.window?.querySelector('#chat-header-logo');
        const header = els.window?.querySelector('.chat-header');
        const side = t.header_icons_side;
        const isLogoEnabled = t.header_logo_enabled !== false && !!t.header_logo;

        // Обновляем активную кнопку в админке, если мы там
        const sideBtns = document.querySelectorAll('.side-btn');
        if (sideBtns.length > 0) {
            sideBtns.forEach(btn => {
                if (btn.dataset.sideVal === side) btn.classList.add('active');
                else btn.classList.remove('active');
            });
        }

        setProp('--chat-header-logo-order', side === 'left' ? '2' : '1');
        setProp('--chat-header-buttons-order', side === 'left' ? '1' : '2');

        // Порядок самих кнопок внутри контейнера кнопок
        setProp('--chat-header-btn-close-order', side === 'left' ? '1' : '2');
        setProp('--chat-header-btn-expand-order', side === 'left' ? '2' : '1');
        
        if (!isLogoEnabled) {
            setProp('--chat-header-buttons-justify', side === 'left' ? 'flex-start' : 'flex-end');
        } else {
            setProp('--chat-header-buttons-justify', 'space-between');
        }

        if (headerLogoEl) {
            if (isLogoEnabled) {
                headerLogoEl.style.display = 'block';
                headerLogoEl.style.backgroundImage = `url("${t.header_logo}")`;
                const logoSize = formatDim(t.header_logo_size, 'px');
                headerLogoEl.style.width = logoSize;
                headerLogoEl.style.height = logoSize;
                
                let logoOpacity = 1;
                if (t.header_logo_opacity !== undefined) {
                    logoOpacity = parseFloat(t.header_logo_opacity);
                    if (logoOpacity > 1) logoOpacity = logoOpacity / 100;
                }
                headerLogoEl.style.opacity = logoOpacity;
                headerLogoEl.style.borderRadius = formatDim(t.header_logo_radius, 'px');
                
                // Обновляем превью в админке, если мы там
                const adminPreview = document.getElementById('header-logo-preview');
                if (adminPreview) {
                    adminPreview.classList.add('has-image');
                    adminPreview.style.backgroundImage = `url("${t.header_logo}")`;
                }

                if (t.header_logo_url) {
                    headerLogoEl.style.cursor = 'pointer';
                    headerLogoEl.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        let url = t.header_logo_url;
                        // Если нет протокола, добавляем https://
                        if (url && !url.startsWith('http') && !url.startsWith('mailto') && !url.startsWith('tel')) {
                            url = 'https://' + url;
                        }

                        const targetBlank = t.header_logo_target_blank !== false;

                        try {
                            if (targetBlank) {
                                window.open(url, '_blank');
                            } else {
                                if (window.top.location.href.includes(url)) window.top.location.reload();
                                else window.top.location.href = url;
                            }
                        } catch (err) {
                            if (targetBlank) {
                                window.open(url, '_blank');
                            } else {
                                window.parent.postMessage({ type: 'mitya_navigate', url }, '*');
                                window.location.href = url;
                            }
                        }
                    };
                } else {
                    headerLogoEl.onclick = null;
                    headerLogoEl.style.cursor = 'default';
                }
            } else {
                headerLogoEl.style.display = 'none';
                
                // Восстанавливаем превью в админке (точки), если логотип удален
                const adminPreview = document.getElementById('header-logo-preview');
                if (adminPreview) {
                    adminPreview.classList.remove('has-image');
                    adminPreview.style.backgroundImage = 'none';
                }
            }
        }

        const expandBtn = els.window?.querySelector('#chat-expand-btn');
        const closeBtn = els.window?.querySelector('#chat-close-btn');
        
        if (expandBtn) {
            if (t.header_expand_enabled === false || isMobile()) {
                expandBtn.setAttribute('style', 'display: none !important');
            } else {
                expandBtn.setAttribute('style', 'display: flex !important');
            }
        }
        if (closeBtn) {
            if (t.header_close_enabled === false) {
                closeBtn.setAttribute('style', 'display: none !important');
            } else {
                closeBtn.setAttribute('style', 'display: flex !important');
            }
        }

        const headerBgEnabled = t.header_bg_enabled !== false;
        const hOpacity = t.header_bg_opacity;
        const hBgColor = t.header_bg;
        const hBlurRaw = t.header_bg_blur || '0px';
        const hBlurNum = parseFloat(hBlurRaw);

        setProp('--chat-header-bg', headerBgEnabled ? hexToRgba(hBgColor, hOpacity) : 'transparent');
        setProp('--chat-header-bg-blur', (headerBgEnabled && hBlurNum > 0) ? formatDim(hBlurRaw, 'px') : '0px');
        
        const headerShadowEnabled = t.header_shadow_enabled !== false;
        const hsBlur = formatDim(t.header_shadow_blur, 'px');
        const hsOffsetY = formatDim(t.header_shadow_offset_y || '0px', 'px');
        
        if (headerShadowEnabled) {
            const hsColor = t.header_shadow_color;
            const hsOpacity = t.header_shadow_opacity;
            setProp('--chat-header-shadow', `0 ${hsOffsetY} ${hsBlur} ${hexToRgba(hsColor, hsOpacity)}`);
        } else {
            setProp('--chat-header-shadow', 'none');
        }
        
        // Убираем все прямые манипуляции стилями и принудительно отключаем блюр, если он 0 или фон выключен
        const headerEl = els.window?.querySelector('.chat-header');
        if (headerEl) {
            headerEl.style.background = '';
            headerEl.style.boxShadow = headerShadowEnabled ? `0 ${hsOffsetY} ${hsBlur} ${hexToRgba(t.header_shadow_color, t.header_shadow_opacity)}` : 'none';
            
            if (!headerBgEnabled || hBlurNum <= 0) {
                headerEl.style.backdropFilter = 'none';
                headerEl.style.webkitBackdropFilter = 'none';
            } else {
                const blurVal = formatDim(hBlurRaw, 'px');
                headerEl.style.backdropFilter = `blur(${blurVal})`;
                headerEl.style.webkitBackdropFilter = `blur(${blurVal})`;
            }
        }
    } catch (err) {
        console.error('[ChatWidget] Error applying header theme:', err);
    }

    // ОКНО ЧАТА
    let rawW = String(t.window_width);
    let rawH = String(t.window_height);
    let wWidth = rawW.includes('px') || rawW.includes('%') || rawW.includes('vw') ? rawW : (parseFloat(rawW) <= 100 ? rawW + '%' : rawW + 'px');
    let wHeight = rawH.includes('px') || rawH.includes('%') || rawH.includes('vh') ? rawH : (parseFloat(rawH) <= 100 ? rawH + 'vh' : rawH + 'px');
    const isFullScreen = (parseFloat(wWidth) >= 98) || (parseFloat(wHeight) >= 98);
    const wRadius = isFullScreen ? '0px' : formatDim(t.window_radius, 'px');
    const wBorderWidth = isFullScreen ? '0px' : formatDim(t.window_border_width, 'px');
    setProp('--chat-window-width', wWidth);
    setProp('--chat-window-height', wHeight);
    setProp('--chat-window-radius', wRadius);
    setProp('--chat-window-border-width', wBorderWidth);
    if (els.window) { 
        els.window.style.borderRadius = wRadius; 
        els.window.style.borderWidth = wBorderWidth;
        
        // Управление возможностью изменения размера (курсоры)
        if (t.window_resizable !== false) {
            els.window.classList.add('is-resizable');
        } else {
            els.window.classList.remove('is-resizable');
        }

        // Управление возможностью перемещения (курсоры)
        if (t.window_draggable !== false) {
            els.window.classList.add('is-draggable');
        } else {
            els.window.classList.remove('is-draggable');
        }
    }

    const winBgOpacity = t.window_bg_opacity;
    setProp('--chat-bg', isBgEnabled ? (t.window_bg?.includes('gradient') ? t.window_bg : hexToRgba(t.window_bg, winBgOpacity)) : 'transparent');
    const blurValue = isBgEnabled ? formatDim(t.window_bg_blur, 'px') : '0px';
    setProp('--chat-blur', blurValue);
    
    // Шрифт
    const defaultFont = t.msg_bot_font_family;
    setProp('--chat-font-family', defaultFont === 'inherit' ? 'inherit' : `'${defaultFont}'`);
    setProp('--chat-font-weight', t.msg_bot_font_weight);
    
    const windowBorderEnabled = t.window_border_enabled !== false;
    const bWidth = parseFloat(t.window_border_width);
    const bOpacity = t.window_border_opacity;
    if (windowBorderEnabled && bWidth > 0) {
        setProp('--chat-window-border', hexToRgba(t.window_border_color, bOpacity));
        setProp('--chat-window-border-width', bWidth + 'px');
        if (els.window) els.window.style.borderWidth = bWidth + 'px';
    } else {
        setProp('--chat-window-border', 'transparent');
        setProp('--chat-window-border-width', '0px');
        if (els.window) els.window.style.borderWidth = '0px';
    }
    const winShadowOpacity = t.window_shadow_opacity;
    setProp('--chat-window-shadow', t.window_shadow_enabled !== false ? `0 0 ${formatDim(t.window_shadow_blur, 'px')} ${hexToRgba(t.window_shadow_color, winShadowOpacity)}` : 'none');

    // Настройки алертов
    setProp('--chat-alert-bg', t.alert_bg_color);
    setProp('--chat-alert-text', t.alert_text_color);
    const aOpacity = t.alert_bg_opacity;
    setProp('--chat-alert-bg-opacity', aOpacity);
    setProp('--chat-alert-bg-rgba', hexToRgba(t.alert_bg_color, aOpacity));
    
    const aTextOpacity = t.alert_text_opacity !== undefined ? (parseFloat(t.alert_text_opacity) > 1 ? parseFloat(t.alert_text_opacity) / 100 : parseFloat(t.alert_text_opacity)) : 1;
    setProp('--chat-alert-text-opacity', aTextOpacity);
    setProp('--chat-alert-text-rgba', hexToRgba(t.alert_text_color, aTextOpacity));
    setProp('--chat-alert-font-size', formatDim(t.alert_font_size, 'px'));
    setProp('--chat-alert-font-family', t.alert_font_family || 'inherit');
    setProp('--chat-alert-font-weight', t.alert_font_weight || '500');
    setProp('--chat-alert-bg-blur', formatDim(t.alert_bg_blur, 'px'));


    // Прямое обновление открытого алерта для real-time превью
    const activeAlert = root ? root.querySelector('.chat-alert') : null;
    if (activeAlert) {
        const blurVal = formatDim(t.alert_bg_blur, 'px');
        console.log('[Theme] Updating active alert blur:', blurVal);
        activeAlert.style.setProperty('backdrop-filter', `blur(${blurVal})`, 'important');
        activeAlert.style.setProperty('-webkit-backdrop-filter', `blur(${blurVal})`, 'important');
    }

    if (t.chat_typing_indicator_color) setProp('--chat-typing-indicator-color', t.chat_typing_indicator_color);
    
    if (t.chat_link_color) {
        const linkOpacity = t.chat_link_opacity !== undefined ? t.chat_link_opacity : 100;
        setProp('--chat-link-color', hexToRgba(t.chat_link_color, linkOpacity));
    }
    
    if (t.chat_link_h_enabled) {
        const linkHOpacity = t.chat_link_opacity_h !== undefined ? t.chat_link_opacity_h : 100;
        setProp('--chat-link-color-hover', hexToRgba(t.chat_link_color_h || t.chat_link_color, linkHOpacity));
    } else {
        setProp('--chat-link-color-hover', 'var(--chat-link-color)');
    }

    setProp('--chat-msg-img-max-width', formatDim(t.msg_img_max_width, '%'));
    setProp('--chat-msg-img-radius', formatDim(t.msg_img_radius, 'px'));

    const imgBorderEnabled = t.msg_img_border_enabled !== false;
    const imgBorderWidth = parseFloat(t.msg_img_border_width);
    if (imgBorderEnabled && imgBorderWidth > 0) {
        setProp('--chat-msg-img-border', `${imgBorderWidth}px solid ${hexToRgba(t.msg_img_border_color, t.msg_img_border_opacity)}`);
    } else {
        setProp('--chat-msg-img-border', 'none');
    }

    const imgBorderHEnabled = t.msg_img_border_h_enabled === true;
    const imgBorderWidthH = parseFloat(t.msg_img_border_width_h);
    if (imgBorderHEnabled && imgBorderWidthH > 0) {
        setProp('--chat-msg-img-border-hover', `${imgBorderWidthH}px solid ${hexToRgba(t.msg_img_border_color_h || t.msg_img_border_color, t.msg_img_border_opacity_h)}`);
    } else {
        setProp('--chat-msg-img-border-hover', 'var(--chat-msg-img-border)');
    }

    const imgShadowEnabled = t.msg_img_shadow_enabled !== false;
    if (imgShadowEnabled) {
        setProp('--chat-msg-img-shadow', `0 0 ${formatDim(t.msg_img_shadow_blur, 'px')} ${hexToRgba(t.msg_img_shadow_color, t.msg_img_shadow_opacity)}`);
    } else {
        setProp('--chat-msg-img-shadow', 'none');
    }

    const imgShadowHEnabled = t.msg_img_shadow_h_enabled === true;
    if (imgShadowHEnabled) {
        setProp('--chat-msg-img-shadow-hover', `0 0 ${formatDim(t.msg_img_shadow_blur_h, 'px')} ${hexToRgba(t.msg_img_shadow_color_h || t.msg_img_shadow_color, t.msg_img_shadow_opacity_h)}`);
    } else {
        setProp('--chat-msg-img-shadow-hover', 'var(--chat-msg-img-shadow)');
    }

    setProp('--chat-msg-file-bg', t.msg_file_bg);
    setProp('--chat-msg-file-text', t.msg_file_text);
    setProp('--chat-msg-file-radius', formatDim(t.msg_file_radius, 'px'));

    // ВЛОЖЕНИЯ (Attached items)
    setProp('--chat-attach-item-height', formatDim(t.attach_item_height, 'px'));
    setProp('--chat-attach-item-radius', formatDim(t.attach_item_radius, 'px'));
    setProp('--chat-attach-item-font-family', t.attach_item_font_family || 'inherit');
    setProp('--chat-attach-item-font-size', formatDim(t.attach_item_font_size, 'px'));
    setProp('--chat-attach-item-font-weight', t.attach_item_font_weight || '400');

    const itmBgEnabled = t.attach_item_bg_enabled !== false;
    const itmBg = itmBgEnabled ? hexToRgba(t.attach_item_bg_color, t.attach_item_bg_opacity) : 'transparent';
    setProp('--chat-attach-item-bg', itmBg);
    setProp('--chat-attach-item-bg-blur', (itmBgEnabled && parseFloat(t.attach_item_bg_blur) > 0) ? formatDim(t.attach_item_bg_blur, 'px') : '0px');

    const itmShadowEnabled = t.attach_item_shadow_enabled !== false;
    const itmShadowBlur = formatDim(t.attach_item_shadow_blur, 'px');
    const itmShadowColor = hexToRgba(t.attach_item_shadow_color, t.attach_item_shadow_opacity);
    const itmShadowFull = itmShadowEnabled ? `0 0 ${itmShadowBlur} ${itmShadowColor}` : 'none';
    
    setProp('--chat-attach-item-shadow', itmShadowFull);

    const itmBorderEnabled = t.attach_item_border_enabled !== false;
    const itmBorderWidth = formatDim(t.attach_item_border_width, 'px');
    const itmBorderFull = (itmBorderEnabled && parseFloat(itmBorderWidth) > 0) 
        ? `${itmBorderWidth} solid ${hexToRgba(t.attach_item_border_color, t.attach_item_border_opacity)}` 
        : 'none';
    
    setProp('--chat-attach-item-border', itmBorderFull);
    
    const itmTextColor = hexToRgba(t.attach_item_text_color, t.attach_item_text_opacity);
    setProp('--chat-attach-item-text', itmTextColor);

    // Прямое обновление для вложений (для real-time превью)
    const attachItems = shadow ? shadow.querySelectorAll('.attached-file-item') : document.querySelectorAll('.attached-file-item');
    attachItems.forEach(item => {
        item.style.backgroundColor = itmBg;
        const blurVal = (itmBgEnabled && parseFloat(t.attach_item_bg_blur) > 0) ? formatDim(t.attach_item_bg_blur, 'px') : 'none';
        item.style.backdropFilter = blurVal !== 'none' ? `blur(${blurVal})` : 'none';
        item.style.webkitBackdropFilter = blurVal !== 'none' ? `blur(${blurVal})` : 'none';
        item.style.boxShadow = itmShadowFull;
        item.style.border = itmBorderFull;
        item.style.color = itmTextColor;
    });

    setProp('--chat-date-color', hexToRgba(t.chat_date_color, t.chat_date_opacity));
    setProp('--chat-date-font-family', t.chat_date_font_family === 'inherit' ? 'inherit' : `'${t.chat_date_font_family}'`);
    setProp('--chat-date-font-weight', t.chat_date_font_weight);
    setProp('--chat-date-font-size', formatDim(t.chat_date_font_size, 'px'));
    setProp('--chat-date-display', t.chat_date_enabled !== false ? 'flex' : 'none');

    setProp('--chat-time-color', hexToRgba(t.chat_time_color, t.chat_time_opacity));
    setProp('--chat-time-font-family', t.chat_time_font_family === 'inherit' ? 'inherit' : `'${t.chat_time_font_family}'`);
    setProp('--chat-time-font-weight', t.chat_time_font_weight);
    setProp('--chat-time-font-size', formatDim(t.chat_time_font_size, 'px'));
    setProp('--chat-time-display', t.chat_time_enabled !== false ? 'block' : 'none');

    // ПОЛИТИКА
    setProp('--chat-privacy-display', 'block');
    setProp('--chat-privacy-color', hexToRgba(t.chat_privacy_text_color, t.chat_privacy_text_opacity));
    setProp('--chat-privacy-font-family', t.chat_privacy_font_family === 'inherit' ? 'inherit' : `'${t.chat_privacy_font_family}'`);
    setProp('--chat-privacy-font-size', formatDim(t.chat_privacy_font_size, 'px'));
    setProp('--chat-privacy-font-weight', t.chat_privacy_font_weight);

    // ПРИНУДИТЕЛЬНОЕ ПОЗИЦИОНИРОВАНИЕ ОКНА
    if (els.window && (theme.window_left !== undefined || theme.window_top !== undefined || data.force_position)) {
        positionChatWindow(els, config, data);
    }

    // КНОПКИ (Buttons)
    const applyBtnStyle = (prefix, styleKey) => {
        // ФОН
        const isBtnBgEnabled = t[`inline_btn_${styleKey}_bg_enabled`] !== false;
        const btnBgColor = isBtnBgEnabled ? hexToRgba(t[`inline_btn_${styleKey}_bg`], t[`inline_btn_${styleKey}_bg_opacity`]) : 'transparent';
        setProp(`--chat-inline-btn-${prefix}-bg`, btnBgColor);

        const isBtnBgHEnabled = t[`inline_btn_${styleKey}_bg_h_enabled`] === true;
        const btnBgColorH = (isBtnBgHEnabled && t[`inline_btn_${styleKey}_bg_h`]) 
            ? hexToRgba(t[`inline_btn_${styleKey}_bg_h`], t[`inline_btn_${styleKey}_bg_opacity_h`]) 
            : btnBgColor;
        setProp(`--chat-inline-btn-${prefix}-bg-hover`, btnBgColorH);

        // ТЕКСТ
        const bFontSize = formatDim(t[`inline_btn_${styleKey}_font_size`], 'px');
        const bFontWeight = t[`inline_btn_${styleKey}_font_weight`];
        const bFontFamily = t[`inline_btn_${styleKey}_font_family`] && t[`inline_btn_${styleKey}_font_family`] !== 'inherit' 
            ? `'${t[`inline_btn_${styleKey}_font_family`]}'` 
            : 'inherit';

        const textColor = hexToRgba(t[`inline_btn_${styleKey}_text`] || '#ffffff', t[`inline_btn_${styleKey}_text_opacity`]);
        setProp(`--chat-inline-btn-${prefix}-text`, textColor);
        
        const isTextHEnabled = t[`inline_btn_${styleKey}_text_h_enabled`] !== false;
        const textColorH = (isTextHEnabled && t[`inline_btn_${styleKey}_text_h`]) 
            ? hexToRgba(t[`inline_btn_${styleKey}_text_h`], t[`inline_btn_${styleKey}_text_opacity_h`]) 
            : textColor;
        setProp(`--chat-inline-btn-${prefix}-text-hover`, textColorH);

        setProp(`--chat-inline-btn-${prefix}-font-size`, bFontSize);
        setProp(`--chat-inline-btn-${prefix}-font-weight`, bFontWeight);
        setProp(`--chat-inline-btn-${prefix}-font-family`, bFontFamily);
        
        // ОБВОДКА
        const isBorderEnabled = t[`inline_btn_${styleKey}_border_enabled`] !== false;
        const bColor = t[`inline_btn_${styleKey}_border_color`];
        const bWidth = formatDim(t[`inline_btn_${styleKey}_border_width`], 'px');
        const bOpacity = t[`inline_btn_${styleKey}_border_opacity`];
        const borderColor = (isBorderEnabled && bColor) ? hexToRgba(bColor, bOpacity) : 'transparent';
        setProp(`--chat-inline-btn-${prefix}-border-color`, borderColor);
        setProp(`--chat-inline-btn-${prefix}-border-width`, bWidth);

        // Обводка при наведении
        const isBorderHEnabled = t[`inline_btn_${styleKey}_border_h_enabled`] === true;
        const bColorH = t[`inline_btn_${styleKey}_border_color_h`];
        const bWidthH = formatDim(t[`inline_btn_${styleKey}_border_width_h`], 'px');
        const bOpacityH = t[`inline_btn_${styleKey}_border_opacity_h`];
        const borderColorH = (isBorderHEnabled && bColorH) ? hexToRgba(bColorH, bOpacityH) : borderColor;
        setProp(`--chat-inline-btn-${prefix}-border-color-h`, borderColorH);
        setProp(`--chat-inline-btn-${prefix}-border-width-h`, isBorderHEnabled ? bWidthH : bWidth);

        // ТЕНЬ
        const isShadowEnabled = t[`inline_btn_${styleKey}_shadow_enabled`] !== false;
        const sColor = t[`inline_btn_${styleKey}_shadow_color`];
        const sOpacity = t[`inline_btn_${styleKey}_shadow_opacity`];
        const sBlur = formatDim(t[`inline_btn_${styleKey}_shadow_blur`], 'px');
        const shadowValue = (isShadowEnabled && sColor) ? `0 0 ${sBlur} ${hexToRgba(sColor, sOpacity)}` : 'none';
        setProp(`--chat-inline-btn-${prefix}-shadow`, shadowValue);

        // Тень при наведении
        const isShadowHEnabled = t[`inline_btn_${styleKey}_shadow_h_enabled`] === true;
        const sColorH = t[`inline_btn_${styleKey}_shadow_color_h`];
        const sOpacityH = t[`inline_btn_${styleKey}_shadow_opacity_h`];
        const sBlurH = formatDim(t[`inline_btn_${styleKey}_shadow_blur_h`], 'px');
        const shadowHValue = (isShadowHEnabled && sColorH) ? `0 0 ${sBlurH} ${hexToRgba(sColorH, sOpacityH)}` : shadowValue;
        setProp(`--chat-inline-btn-${prefix}-shadow-hover`, shadowHValue);
        
        // ИЗОБРАЖЕНИЕ КНОПКИ
        const imgEnabled = t[`inline_btn_${styleKey}_img_enabled`] !== false;
        const imgUrl = t[`inline_btn_${styleKey}_img`];
        if (imgEnabled && imgUrl) {
            setProp(`--chat-inline-btn-${prefix}-img`, `url("${imgUrl}")`);
            let op = parseFloat(t[`inline_btn_${styleKey}_img_opacity`]);
            setProp(`--chat-inline-btn-${prefix}-img-opacity`, op);
        } else {
            setProp(`--chat-inline-btn-${prefix}-img`, 'none');
            setProp(`--chat-inline-btn-${prefix}-img-opacity`, '0');
        }
    };
    applyBtnStyle('left', 'accent');
    applyBtnStyle('right', 'neutral');
    applyBtnStyle('info', 'info');
    
    // Применяем общие параметры ко всем типам кнопок
    ['left', 'right', 'info'].forEach(prefix => {
        const styleKey = prefix === 'left' ? 'accent' : (prefix === 'right' ? 'neutral' : 'info');
        
        const btnRadius = formatDim(t[`inline_btn_${styleKey}_radius`], 'px');
        const btnHeight = formatDim(t[`inline_btn_${styleKey}_height`], 'px');
        const btnWidth = formatDim(t[`inline_btn_${styleKey}_width`], 'px');

        setProp(`--chat-inline-btn-${prefix}-radius`, btnRadius);
        setProp(`--chat-inline-btn-${prefix}-height`, btnHeight);
        setProp(`--chat-inline-btn-${prefix}-width`, btnWidth);
    });

    // ПОЛЕ ВВОДА
    const inputBgEnabled = t.input_bg_enabled !== false;
    const inputBlurRaw = t.input_bg_blur || '0px';
    const inputBlurNum = parseFloat(inputBlurRaw);
    const inputBg = inputBgEnabled ? hexToRgba(t.input_bg, t.input_bg_opacity) : 'transparent';
    
    setProp('--chat-input-bg', inputBg);
    setProp('--chat-input-text', hexToRgba(t.input_text_color, t.input_text_opacity));
    setProp('--chat-input-placeholder', hexToRgba(t.input_placeholder_color, t.input_placeholder_opacity));
    setProp('--chat-input-radius', formatDim(t.input_radius, 'px'));
    
    const inputContainer = shadow ? shadow.querySelector('.chat-input-container') : document.querySelector('.chat-input-container');
    if (inputContainer) {
        inputContainer.style.backgroundColor = inputBg;
        
        if (!inputBgEnabled || inputBlurNum <= 0) {
            inputContainer.style.backdropFilter = 'none';
            inputContainer.style.webkitBackdropFilter = 'none';
        } else {
            const blurVal = formatDim(inputBlurRaw, 'px');
            inputContainer.style.backdropFilter = `blur(${blurVal})`;
            inputContainer.style.webkitBackdropFilter = `blur(${blurVal})`;
        }
    }

    // ФУТЕР
    const footerBgEnabled = t.footer_bg_enabled !== false;
    const footerBg = footerBgEnabled ? hexToRgba(t.footer_bg, t.footer_bg_opacity) : 'transparent';
    const footerBlur = footerBgEnabled ? formatDim(t.footer_bg_blur, 'px') : '0px';
    
    setProp('--chat-footer-bg', footerBg);
    setProp('--chat-footer-blur', footerBlur);

    const footerShadowEnabled = t.footer_shadow_enabled !== false;
    const fsBlur = formatDim(t.footer_shadow_blur, 'px');
    const fsOffsetY = formatDim(-parseFloat(t.footer_shadow_offset_y), 'px');
    const footerShadow = footerShadowEnabled ? `0 ${fsOffsetY} ${fsBlur} ${hexToRgba(t.footer_shadow_color, t.footer_shadow_opacity)}` : 'none';
    setProp('--chat-footer-shadow', footerShadow);

    const footer = shadow ? shadow.querySelector('.footer-chat') : document.querySelector('.footer-chat');
    if (footer) {
        footer.style.backgroundColor = footerBg;
        if (footerBgEnabled && parseFloat(footerBlur) > 0) {
            footer.style.backdropFilter = `blur(${footerBlur})`;
            footer.style.webkitBackdropFilter = `blur(${footerBlur})`;
        } else {
            footer.style.backdropFilter = 'none';
            footer.style.webkitBackdropFilter = 'none';
        }
        footer.style.boxShadow = footerShadow;
    }

    // Кнопка отправки (стрелка) - НОВАЯ СТРУКТУРА
    setProp('--chat-btn-send-radius', formatDim(t.btn_send_radius, '%'));
    setProp('--chat-btn-send-icon-color', hexToRgba(t.btn_send_icon_color, parseFloat(t.btn_send_icon_opacity)));
    
    const sendIconHEnabled = t.btn_send_icon_h_enabled !== false;
    setProp('--chat-btn-send-icon-color-hover', sendIconHEnabled ? hexToRgba(t.btn_send_icon_color_h, parseFloat(t.btn_send_icon_opacity_h)) : hexToRgba(t.btn_send_icon_color, parseFloat(t.btn_send_icon_opacity)));
    
    const sendBgEnabled = t.btn_send_bg_enabled !== false;
    setProp('--chat-btn-send-bg', sendBgEnabled ? hexToRgba(t.btn_send_bg_color, parseFloat(t.btn_send_bg_opacity)) : 'transparent');
    
    const sendBgHoverEnabled = t.btn_send_bg_h_enabled !== false;
    setProp('--chat-btn-send-bg-hover', sendBgHoverEnabled ? hexToRgba(t.btn_send_bg_color_h, parseFloat(t.btn_send_bg_opacity_h)) : 'transparent');

    const sendBorderEnabled = t.btn_send_border_enabled !== false;
    if (sendBorderEnabled) {
        const bWidth = formatDim(t.btn_send_border_width, 'px');
        const bColor = hexToRgba(t.btn_send_border_color, t.btn_send_border_opacity);
        setProp('--chat-btn-send-border', `${bWidth} solid ${bColor}`);
    } else {
        setProp('--chat-btn-send-border', 'none');
    }

    const sendBorderHEnabled = t.btn_send_border_h_enabled !== false;
    if (sendBorderHEnabled) {
        const bWidthH = formatDim(t.btn_send_border_width_h, 'px');
        const bColorH = hexToRgba(t.btn_send_border_color_h, t.btn_send_border_opacity_h);
        setProp('--chat-btn-send-border-hover', `${bWidthH} solid ${bColorH}`);
    } else {
        setProp('--chat-btn-send-border-hover', 'none');
    }

    const sendShadowEnabled = t.btn_send_shadow_enabled !== false;
    if (sendShadowEnabled) {
        const sBlur = formatDim(t.btn_send_shadow_blur, 'px');
        const sColor = hexToRgba(t.btn_send_shadow_color, t.btn_send_shadow_opacity);
        setProp('--chat-btn-send-shadow', `0 0 ${sBlur} ${sColor}`);
    } else {
        setProp('--chat-btn-send-shadow', 'none');
    }

    const sendShadowHEnabled = t.btn_send_shadow_h_enabled !== false;
    if (sendShadowHEnabled) {
        const sBlurH = formatDim(t.btn_send_shadow_blur_h, 'px');
        const sColorH = hexToRgba(t.btn_send_shadow_color_h, t.btn_send_shadow_opacity_h);
        setProp('--chat-btn-send-shadow-hover', `0 0 ${sBlurH} ${sColorH}`);
    } else {
        setProp('--chat-btn-send-shadow-hover', 'none');
    }

    // Кнопка остановки (пауза) - НОВАЯ СТРУКТУРА
    setProp('--chat-btn-stop-radius', formatDim(t.btn_stop_radius, '%'));
    
    const stopIconColor = hexToRgba(t.btn_stop_icon_color, parseFloat(t.btn_stop_icon_opacity ?? 1));
    setProp('--chat-btn-stop-icon-color', stopIconColor);
    
    const stopIconHEnabled = t.btn_stop_icon_h_enabled !== false;
    if (stopIconHEnabled) {
        setProp('--chat-btn-stop-icon-color-hover', hexToRgba(t.btn_stop_icon_color_h, parseFloat(t.btn_stop_icon_opacity_h ?? 1)));
    } else {
        setProp('--chat-btn-stop-icon-color-hover', stopIconColor);
    }
    
    const stopBgEnabled = t.btn_stop_bg_enabled !== false;
    const stopBgColor = stopBgEnabled ? hexToRgba(t.btn_stop_bg_color, parseFloat(t.btn_stop_bg_opacity ?? 1)) : 'transparent';
    setProp('--chat-btn-stop-bg', stopBgColor);
    
    const stopBgHoverEnabled = t.btn_stop_bg_h_enabled !== false;
    if (stopBgHoverEnabled) {
        setProp('--chat-btn-stop-bg-hover', hexToRgba(t.btn_stop_bg_color_h, parseFloat(t.btn_stop_bg_opacity_h ?? 1)));
    } else {
        setProp('--chat-btn-stop-bg-hover', stopBgColor);
    }

    const stopShadowEnabled = t.btn_stop_shadow_enabled !== false;
    const stopShadowValue = stopShadowEnabled ? `0 0 ${formatDim(t.btn_stop_shadow_blur, 'px')} ${hexToRgba(t.btn_stop_shadow_color, t.btn_stop_shadow_opacity)}` : 'none';
    setProp('--chat-btn-stop-shadow', stopShadowValue);

    const stopShadowHEnabled = t.btn_stop_shadow_h_enabled !== false;
    if (stopShadowHEnabled) {
        const sBlurH = formatDim(t.btn_stop_shadow_blur_h, 'px');
        const sColorH = hexToRgba(t.btn_stop_shadow_color_h, t.btn_stop_shadow_opacity_h);
        setProp('--chat-btn-stop-shadow-hover', `0 0 ${sBlurH} ${sColorH}`);
    } else {
        setProp('--chat-btn-stop-shadow-hover', stopShadowValue);
    }

    const stopBorderEnabled = t.btn_stop_border_enabled !== false;
    const stopBorderValue = stopBorderEnabled ? `${formatDim(t.btn_stop_border_width, 'px')} solid ${hexToRgba(t.btn_stop_border_color, t.btn_stop_border_opacity)}` : 'none';
    setProp('--chat-btn-stop-border', stopBorderValue);

    const stopBorderHEnabled = t.btn_stop_border_h_enabled !== false;
    if (stopBorderHEnabled) {
        const bWidthH = formatDim(t.btn_stop_border_width_h, 'px');
        const bColorH = hexToRgba(t.btn_stop_border_color_h, t.btn_stop_border_opacity_h);
        setProp('--chat-btn-stop-border-hover', `${bWidthH} solid ${bColorH}`);
    } else {
        setProp('--chat-btn-stop-border-hover', stopBorderValue);
    }

    // Кнопка микрофона - НОВАЯ СТРУКТУРА
    setProp('--chat-btn-mic-radius', formatDim(t.btn_mic_radius, '%'));
    
    const micIconColor = hexToRgba(t.btn_mic_icon_color, parseFloat(t.btn_mic_icon_opacity ?? 1));
    const micIconOpacity = parseFloat(t.btn_mic_icon_opacity ?? 1);
    setProp('--chat-btn-mic-icon-color', micIconColor);
    setProp('--chat-btn-mic-icon-opacity', micIconOpacity);

    const micIconHEnabled = t.btn_mic_icon_h_enabled !== false;
    if (micIconHEnabled) {
        setProp('--chat-btn-mic-icon-color-hover', hexToRgba(t.btn_mic_icon_color_h, parseFloat(t.btn_mic_icon_opacity_h ?? 1)));
        setProp('--chat-btn-mic-icon-opacity-h', parseFloat(t.btn_mic_icon_opacity_h ?? 1));
    } else {
        setProp('--chat-btn-mic-icon-color-hover', micIconColor);
        setProp('--chat-btn-mic-icon-opacity-h', micIconOpacity);
    }
    
    const micBgEnabled = t.btn_mic_bg_enabled !== false;
    const micBgColor = micBgEnabled ? hexToRgba(t.btn_mic_bg_color, parseFloat(t.btn_mic_bg_opacity ?? 1)) : 'transparent';
    setProp('--chat-btn-mic-bg', micBgColor);
    
    const micBgHoverEnabled = t.btn_mic_bg_h_enabled !== false;
    if (micBgHoverEnabled) {
        setProp('--chat-btn-mic-bg-hover', hexToRgba(t.btn_mic_bg_color_h, parseFloat(t.btn_mic_bg_opacity_h ?? 1)));
    } else {
        setProp('--chat-btn-mic-bg-hover', micBgColor);
    }

    const micShadowEnabled = t.btn_mic_shadow_enabled !== false;
    const micShadowValue = micShadowEnabled ? `0 0 ${formatDim(t.btn_mic_shadow_blur, 'px')} ${hexToRgba(t.btn_mic_shadow_color, t.btn_mic_shadow_opacity)}` : 'none';
    setProp('--chat-btn-mic-shadow', micShadowValue);

    const micShadowHEnabled = t.btn_mic_shadow_h_enabled !== false;
    if (micShadowHEnabled) {
        const sBlurH = formatDim(t.btn_mic_shadow_blur_h, 'px');
        const sColorH = hexToRgba(t.btn_mic_shadow_color_h, t.btn_mic_shadow_opacity_h);
        setProp('--chat-btn-mic-shadow-hover', `0 0 ${sBlurH} ${sColorH}`);
    } else {
        setProp('--chat-btn-mic-shadow-hover', micShadowValue);
    }

    const micBorderEnabled = t.btn_mic_border_enabled !== false;
    const micBorderValue = micBorderEnabled ? `${formatDim(t.btn_mic_border_width, 'px')} solid ${hexToRgba(t.btn_mic_border_color, t.btn_mic_border_opacity)}` : 'none';
    setProp('--chat-btn-mic-border', micBorderValue);

    const micBorderHEnabled = t.btn_mic_border_h_enabled !== false;
    if (micBorderHEnabled) {
        const bWidthH = formatDim(t.btn_mic_border_width_h, 'px');
        const bColorH = hexToRgba(t.btn_mic_border_color_h, t.btn_mic_border_opacity_h);
        setProp('--chat-btn-mic-border-hover', `${bWidthH} solid ${bColorH}`);
    } else {
        setProp('--chat-btn-mic-border-hover', micBorderValue);
    }

    // Кнопка записи (пульсация) - НОВАЯ СТРУКТУРА
    setProp('--chat-btn-record-radius', formatDim(t.btn_record_radius, '%'));
    
    const recordIconColor = hexToRgba(t.btn_record_icon_color, parseFloat(t.btn_record_icon_opacity ?? 1));
    const recordIconOpacity = parseFloat(t.btn_record_icon_opacity ?? 1);
    setProp('--chat-v3-pulse-color', recordIconColor);
    setProp('--chat-btn-record-icon-opacity', recordIconOpacity);

    const recordIconHEnabled = t.btn_record_icon_h_enabled !== false;
    if (recordIconHEnabled) {
        setProp('--chat-v3-pulse-color-hover', hexToRgba(t.btn_record_icon_color_h, parseFloat(t.btn_record_icon_opacity_h ?? 1)));
        setProp('--chat-btn-record-icon-opacity-h', parseFloat(t.btn_record_icon_opacity_h ?? 1));
    } else {
        setProp('--chat-v3-pulse-color-hover', recordIconColor);
        setProp('--chat-btn-record-icon-opacity-h', recordIconOpacity);
    }
    
    const recordBgEnabled = t.btn_record_bg_enabled !== false;
    const recordBgColor = recordBgEnabled ? hexToRgba(t.btn_record_bg_color, parseFloat(t.btn_record_bg_opacity ?? 1)) : 'transparent';
    setProp('--chat-btn-record-bg', recordBgColor);
    
    const recordBgHoverEnabled = t.btn_record_bg_h_enabled !== false;
    if (recordBgHoverEnabled) {
        setProp('--chat-btn-record-bg-hover', hexToRgba(t.btn_record_bg_color_h, parseFloat(t.btn_record_bg_opacity_h ?? 1)));
    } else {
        setProp('--chat-btn-record-bg-hover', recordBgColor);
    }

    const recordShadowEnabled = t.btn_record_shadow_enabled !== false;
    const recordShadowValue = recordShadowEnabled ? `0 0 ${formatDim(t.btn_record_shadow_blur, 'px')} ${hexToRgba(t.btn_record_shadow_color, t.btn_record_shadow_opacity)}` : 'none';
    setProp('--chat-btn-record-shadow', recordShadowValue);

    const recordShadowHEnabled = t.btn_record_shadow_h_enabled !== false;
    if (recordShadowHEnabled) {
        const rsBlurH = formatDim(t.btn_record_shadow_blur_h, 'px');
        const rsColorH = hexToRgba(t.btn_record_shadow_color_h, t.btn_record_shadow_opacity_h);
        setProp('--chat-btn-record-shadow-hover', `0 0 ${rsBlurH} ${rsColorH}`);
    } else {
        setProp('--chat-btn-record-shadow-hover', recordShadowValue);
    }

    const recordBorderEnabled = t.btn_record_border_enabled !== false;
    const recordBorderValue = recordBorderEnabled ? `${formatDim(t.btn_record_border_width, 'px')} solid ${hexToRgba(t.btn_record_border_color, t.btn_record_border_opacity)}` : 'none';
    setProp('--chat-btn-record-border', recordBorderValue);

    const recordBorderHEnabled = t.btn_record_border_h_enabled !== false;
    if (recordBorderHEnabled) {
        const rbWidthH = formatDim(t.btn_record_border_width_h, 'px');
        const rbColorH = hexToRgba(t.btn_record_border_color_h, t.btn_record_border_opacity_h);
        setProp('--chat-btn-record-border-hover', `${rbWidthH} solid ${rbColorH}`);
    } else {
        setProp('--chat-btn-record-border-hover', recordBorderValue);
    }

    // Кнопка вложений
    const attachEnabled = t.btn_attach_enabled !== false;
    if (els.attachBtn) {
        els.attachBtn.style.setProperty('display', attachEnabled ? 'flex' : 'none', 'important');
    }

    setProp('--chat-btn-attach-radius', formatDim(t.btn_attach_radius, '%'));
    
    const attachIconColor = hexToRgba(t.btn_attach_icon_color, parseFloat(t.btn_attach_icon_opacity ?? 1));
    const attachIconOpacity = parseFloat(t.btn_attach_icon_opacity ?? 1);
    setProp('--chat-btn-attach-icon-color', attachIconColor);
    setProp('--chat-btn-attach-icon-opacity', attachIconOpacity);

    const attachIconHEnabled = t.btn_attach_icon_h_enabled !== false;
    if (attachIconHEnabled) {
        setProp('--chat-btn-attach-icon-color-hover', hexToRgba(t.btn_attach_icon_color_h, parseFloat(t.btn_attach_icon_opacity_h ?? 1)));
        setProp('--chat-btn-attach-icon-opacity-h', parseFloat(t.btn_attach_icon_opacity_h ?? 1));
    } else {
        setProp('--chat-btn-attach-icon-color-hover', attachIconColor);
        setProp('--chat-btn-attach-icon-opacity-h', attachIconOpacity);
    }
    
    const attachBgEnabled = t.btn_attach_bg_enabled !== false;
    const attachBgColor = attachBgEnabled ? hexToRgba(t.btn_attach_bg_color, parseFloat(t.btn_attach_bg_opacity ?? 1)) : 'transparent';
    setProp('--chat-btn-attach-bg', attachBgColor);
    
    const attachBgHoverEnabled = t.btn_attach_bg_h_enabled !== false;
    if (attachBgHoverEnabled) {
        setProp('--chat-btn-attach-bg-hover', hexToRgba(t.btn_attach_bg_color_h, parseFloat(t.btn_attach_bg_opacity_h ?? 1)));
    } else {
        setProp('--chat-btn-attach-bg-hover', attachBgColor);
    }

    const attachShadowEnabled = t.btn_attach_shadow_enabled !== false;
    const attachShadowValue = attachShadowEnabled ? `0 0 ${formatDim(t.btn_attach_shadow_blur, 'px')} ${hexToRgba(t.btn_attach_shadow_color, t.btn_attach_shadow_opacity)}` : 'none';
    setProp('--chat-btn-attach-shadow', attachShadowValue);

    const attachShadowHEnabled = t.btn_attach_shadow_h_enabled !== false;
    if (attachShadowHEnabled) {
        const asBlurH = formatDim(t.btn_attach_shadow_blur_h, 'px');
        const asColorH = hexToRgba(t.btn_attach_shadow_color_h, t.btn_attach_shadow_opacity_h);
        setProp('--chat-btn-attach-shadow-hover', `0 0 ${asBlurH} ${asColorH}`);
    } else {
        setProp('--chat-btn-attach-shadow-hover', attachShadowValue);
    }

    const attachBorderEnabled = t.btn_attach_border_enabled !== false;
    const attachBorderValue = attachBorderEnabled ? `${formatDim(t.btn_attach_border_width, 'px')} solid ${hexToRgba(t.btn_attach_border_color, t.btn_attach_border_opacity)}` : 'none';
    setProp('--chat-btn-attach-border', attachBorderValue);

    const attachBorderHEnabled = t.btn_attach_border_h_enabled !== false;
    if (attachBorderHEnabled) {
        const abWidthH = formatDim(t.btn_attach_border_width_h, 'px');
        const abColorH = hexToRgba(t.btn_attach_border_color_h, t.btn_attach_border_opacity_h);
        setProp('--chat-btn-attach-border-hover', `${abWidthH} solid ${abColorH}`);
    } else {
        setProp('--chat-btn-attach-border-hover', attachBorderValue);
    }

    // МАСКА ЗАТУХАНИЯ ТЕКСТА
    const maskEnabled = t.footer_mask_enabled !== false;
    if (maskEnabled) {
        const maskHeight = formatDim(t.footer_mask_height, 'px');
        const maskSmoothness = formatDim(t.footer_mask_smoothness, 'px');
        setProp('--chat-mask-height', maskHeight);
        setProp('--chat-mask-smoothness', maskSmoothness);
    } else {
        setProp('--chat-mask-height', '0px');
        setProp('--chat-mask-smoothness', '0px');
    }
    
    const inputBorderEnabled = t.input_border_enabled !== false;
    if (inputBorderEnabled) {
        const ibWidth = formatDim(t.input_border_width, 'px');
        const ibColor = hexToRgba(t.input_border_color, t.input_border_opacity);
        setProp('--chat-input-border', `${ibWidth} solid ${ibColor}`);
    } else {
        setProp('--chat-input-border', 'none');
    }

    const inputActiveBorderEnabled = t.input_active_border_enabled !== false;
    if (inputActiveBorderEnabled) {
        setProp('--chat-input-active-border-width', formatDim(t.input_active_border_width, 'px'));
        setProp('--chat-input-active-border-color', hexToRgba(t.input_active_border_color, t.input_active_border_opacity));
    } else {
        // Если выключено, используем параметры обычной обводки
        const ibWidth = inputBorderEnabled ? formatDim(t.input_border_width, 'px') : '0px';
        const ibColor = inputBorderEnabled ? hexToRgba(t.input_border_color, t.input_border_opacity) : 'transparent';
        setProp('--chat-input-active-border-width', ibWidth);
        setProp('--chat-input-active-border-color', ibColor);
    }

    const inputShadowEnabled = t.input_shadow_enabled !== false;
    const inputShadowValue = inputShadowEnabled ? `0 0 ${formatDim(t.input_shadow_blur, 'px')} ${hexToRgba(t.input_shadow_color, t.input_shadow_opacity)}` : 'none';
    setProp('--chat-input-shadow', inputShadowValue);

    const inputActiveShadowEnabled = t.input_active_shadow_enabled !== false;
    if (inputActiveShadowEnabled) {
        const isBlur = formatDim(t.input_active_shadow_blur, 'px');
        const isColor = hexToRgba(t.input_active_shadow_color, t.input_active_shadow_opacity);
        setProp('--chat-input-active-shadow', `0 0 ${isBlur} ${isColor}`);
    } else {
        // Если выключено, используем параметры обычной тени
        setProp('--chat-input-active-shadow', inputShadowValue);
    }

    // СООБЩЕНИЯ: БОТ, ПОЛЬЗОВАТЕЛЬ, ОПЕРАТОР
    ['bot', 'user', 'operator'].forEach(type => {
        const prefix = `--chat-msg-${type}`;
        const themePrefix = `msg_${type}`;

        // Аватар
        const avatarEnabled = t[`${themePrefix}_avatar_enabled`] !== false;
        const avatarUrl = t[`${themePrefix}_avatar`];
        const avatarOpacity = t[`${themePrefix}_avatar_opacity`] !== undefined ? t[`${themePrefix}_avatar_opacity`] : 1;
        setProp(`${prefix}-avatar-display`, avatarEnabled && avatarUrl ? 'block' : 'none');
        setProp(`${prefix}-avatar-url`, avatarUrl ? `url("${avatarUrl}")` : 'none');
        setProp(`${prefix}-avatar-opacity`, avatarOpacity > 1 ? avatarOpacity / 100 : avatarOpacity);
        setProp(`${prefix}-avatar-radius`, formatDim(t[`${themePrefix}_avatar_radius`], '%'));

        // Текст
        const textColor = t[`${themePrefix}_text_color`];
        const textOpacity = t[`${themePrefix}_text_opacity`] !== undefined ? t[`${themePrefix}_text_opacity`] : 1;
        setProp(`${prefix}-text-color`, hexToRgba(textColor, textOpacity > 1 ? textOpacity / 100 : textOpacity));
        
        const fontFamily = t[`${themePrefix}_font_family`];
        setProp(`${prefix}-font-family`, fontFamily && fontFamily !== 'inherit' ? `'${fontFamily}'` : 'inherit');
        
        setProp(`${prefix}-font-size`, formatDim(t[`${themePrefix}_font_size`], 'px'));
        setProp(`${prefix}-font-weight`, t[`${themePrefix}_font_weight`]);

        // Ссылки (для бота, пользователя и оператора)
        if (type === 'bot' || type === 'user' || type === 'operator') {
            const linkColor = t[`msg_${type}_link_color`] || t.chat_link_color;
            const linkOpacity = t[`msg_${type}_link_opacity`] !== undefined ? t[`msg_${type}_link_opacity`] : (t.chat_link_opacity || 100);
            setProp(`--chat-msg-${type}-link-color`, hexToRgba(linkColor, linkOpacity));

            if (t[`msg_${type}_link_h_enabled`] !== false) {
                const linkColorH = t[`msg_${type}_link_color_h`] || linkColor;
                const linkOpacityH = t[`msg_${type}_link_opacity_h`] !== undefined ? t[`msg_${type}_link_opacity_h`] : linkOpacity;
                setProp(`--chat-msg-${type}-link-color-hover`, hexToRgba(linkColorH, linkOpacityH));
            } else {
                setProp(`--chat-msg-${type}-link-color-hover`, hexToRgba(linkColor, linkOpacity));
            }
        }

        // Фон
        const bgEnabled = t[`${themePrefix}_bg_enabled`] === true || t[`${themePrefix}_bg_enabled`] === 'true';
        const bgColor = t[`${themePrefix}_bg_color`];
        const bgOpacity = t[`${themePrefix}_bg_opacity`] !== undefined ? t[`${themePrefix}_bg_opacity`] : 1;
        setProp(`${prefix}-bg`, bgEnabled ? hexToRgba(bgColor, bgOpacity > 1 ? bgOpacity / 100 : bgOpacity) : 'transparent');

        // Обводка
        const borderEnabled = t[`${themePrefix}_border_enabled`] === true || t[`${themePrefix}_border_enabled`] === 'true';
        const borderColor = t[`${themePrefix}_border_color`];
        const borderOpacity = t[`${themePrefix}_border_opacity`] !== undefined ? t[`${themePrefix}_border_opacity`] : 1;
        const borderWidth = formatDim(t[`${themePrefix}_border_width`], 'px');
        
        const borderValue = borderEnabled ? `${borderWidth} solid ${hexToRgba(borderColor, borderOpacity)}` : 'none';
        setProp(`${prefix}-border`, borderValue);

        // Динамическое смещение (в реальном времени)
        // Смещение срабатывает только если выключен и фон, и обводка (сообщение без границ)
        const hasBubble = bgEnabled || borderEnabled;
        const avatarMargin = hasBubble ? '0px' : '12px';
        const timeMargin = hasBubble ? '4px' : '-8px';
        const msgMargin = hasBubble ? '30px' : '15px';
        const msgPadding = hasBubble ? '12px 16px' : '12px 0px';
        const timePadding = hasBubble ? '0 14px' : '0px';

        setProp(`${prefix}-margin-top`, msgMargin);
        setProp(`${prefix}-avatar-margin-top`, avatarMargin);
        setProp(`${prefix}-time-margin-top`, timeMargin);
        setProp(`${prefix}-padding`, msgPadding);
        setProp(`${prefix}-time-padding`, timePadding);

        console.log(`[Theme] ${type} layout:`, { bgEnabled, borderEnabled, hasBubble, msgMargin, avatarMargin, timeMargin });
    });

    if (data.welcome_msg !== undefined && els.messagesContainer) {
        let welcomeMsgEl = Array.from(els.messagesContainer.children).find(msg => 
            msg.classList.contains('is-welcome')
        );
        
        if (data.welcome_msg && data.welcome_msg.trim() !== '') {
            if (welcomeMsgEl) {
                const textEl = welcomeMsgEl.querySelector('.message-text');
                if (textEl) textEl.innerHTML = renderMarkdown(data.welcome_msg, config, true);
            } else {
                // Если приветствия нет в DOM, создаем его на лету
                import('./messages').then(m => {
                    m.addMessage(data.welcome_msg, 'bot', { noScroll: true, isWelcome: true }, config, els).then(newEl => {
                        if (newEl && els.messagesContainer) {
                            // Вставляем в самое начало контейнера
                            els.messagesContainer.prepend(newEl);
                        }
                    });
                });
            }
        } else if (welcomeMsgEl) {
            // Если текст стерли в админке, удаляем пузырь из чата
            welcomeMsgEl.remove();
        }
    }

    // Предпросмотр сообщений (только внутри админки)
    const isInsideAdmin = window.location.pathname.includes('/admin') || (window.parent !== window);
    
    if (isInsideAdmin) {
        if (t.msg_bot_preview_enabled !== undefined) {
            showBotMessagePreview(t.msg_bot_preview_enabled, els, config);
        }
        if (t.msg_user_preview_enabled !== undefined) {
            showUserMessagePreview(t.msg_user_preview_enabled, els, config);
        }
        if (t.msg_operator_preview_enabled !== undefined) {
            showOperatorMessagePreview(t.msg_operator_preview_enabled, els, config);
        }
    }
}
