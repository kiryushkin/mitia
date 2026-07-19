export function getWidgetPreviewStyle(theme = {}) {
    const normalizedTheme = theme && typeof theme === 'object' ? theme : {};
    const radiusRaw = String(normalizedTheme.widget_radius ?? '50').trim();
    const radiusValue = Number.parseFloat(radiusRaw);
    const normalizedRadius = Number.isFinite(radiusValue)
        ? `${Math.max(0, Math.min(50, radiusValue))}%`
        : '50%';
    const hasImage = !!(normalizedTheme.widget_img_enabled && normalizedTheme.widget_img);
    const bgColor = normalizedTheme.widget_bg_color || '#ff3300';
    const bgOpacityRaw = normalizedTheme.widget_bg_opacity;
    const bgOpacity = typeof bgOpacityRaw === 'number'
        ? (bgOpacityRaw > 1 ? bgOpacityRaw / 100 : bgOpacityRaw)
        : 1;
    const effectsEnabled = normalizedTheme.widget_effects_enabled !== false;
    const dotsEnabled = effectsEnabled && normalizedTheme.widget_dots_enabled !== false;
    const dotsColor = normalizedTheme.widget_dots_color || '#ffffff';
    const dotsOpacityRaw = normalizedTheme.widget_dots_opacity;
    const dotsOpacity = typeof dotsOpacityRaw === 'number'
        ? (dotsOpacityRaw > 1 ? dotsOpacityRaw / 100 : dotsOpacityRaw)
        : 1;

    const widgetBorderEnabled = normalizedTheme.widget_border_enabled !== false;
    const widgetBorderColor = String(normalizedTheme.widget_border_color || '').trim();
    const widgetBorderOpacityRaw = normalizedTheme.widget_border_opacity;
    const hasWidgetBorderSettings = widgetBorderColor || widgetBorderOpacityRaw !== undefined;

    const windowBorderEnabled = normalizedTheme.window_border_enabled !== false;
    const windowBorderColor = String(normalizedTheme.window_border_color || '').trim();
    const windowBorderOpacityRaw = normalizedTheme.window_border_opacity;
    const hasWindowBorderSettings = windowBorderColor || windowBorderOpacityRaw !== undefined;

    const brandBorderEnabled = normalizedTheme.brand_border_enabled === true;
    const brandBorderColor = String(normalizedTheme.brand_border || '').trim();
    const brandBorderOpacityRaw = normalizedTheme.brand_border_opacity;
    const hasBrandBorderSettings = brandBorderColor || brandBorderOpacityRaw !== undefined;

    const borderEnabled = (widgetBorderEnabled && hasWidgetBorderSettings)
        || (windowBorderEnabled && hasWindowBorderSettings)
        || (brandBorderEnabled && hasBrandBorderSettings);

    const borderColor = (widgetBorderEnabled && widgetBorderColor)
        || (windowBorderEnabled && windowBorderColor)
        || (brandBorderEnabled && brandBorderColor)
        || '#ffffff';

    const borderOpacityRaw = (widgetBorderEnabled && widgetBorderOpacityRaw !== undefined)
        ? widgetBorderOpacityRaw
        : ((windowBorderEnabled && windowBorderOpacityRaw !== undefined)
            ? windowBorderOpacityRaw
            : brandBorderOpacityRaw);
    const borderOpacity = typeof borderOpacityRaw === 'number'
        ? (borderOpacityRaw > 1 ? borderOpacityRaw / 100 : borderOpacityRaw)
        : 1;

    return {
        hasImage,
        image: hasImage ? normalizedTheme.widget_img : '',
        bgColor,
        bgOpacity,
        borderRadius: normalizedRadius,
        dotsEnabled,
        dotsColor,
        dotsOpacity,
        borderEnabled,
        borderColor,
        borderOpacity
    };
}

export function renderAssistantAvatar(preview = {}, className = 'assistant-panel-avatar') {
    const safeClass = `${className}${preview.hasImage ? ' has-image' : ''}${preview.borderEnabled ? ' has-border' : ''}`.trim();
    const backgroundValue = preview.hasImage
        ? 'transparent'
        : this.withOpacity(preview.bgColor || '#ff3300', preview.bgOpacity ?? 1);
    const resolvedBorderColor = this.withOpacity(preview.borderColor || '#ffffff', preview.borderOpacity ?? 1);
    const borderStyle = preview.borderEnabled
        ? `border:2px solid ${resolvedBorderColor};box-shadow:inset 0 0 0 1px ${resolvedBorderColor};`
        : 'border:2px solid transparent;box-shadow:none;';
    const styleAttr = ` style="background:${backgroundValue};border-radius:${preview.borderRadius || '50%'};${borderStyle}--assistant-dots-color:${preview.dotsColor || '#ffffff'};--assistant-dots-opacity:${preview.dotsOpacity ?? 1};--assistant-border-color:${preview.borderColor || '#ffffff'};--assistant-border-opacity:${preview.borderOpacity ?? 1};--assistant-border-width:2px;"`;
    if (preview.hasImage) {
        return `<span class="${safeClass}"${styleAttr}><img src="${preview.image}" alt="Иконка ассистента"></span>`;
    }
    const dotsHtml = preview.dotsEnabled === false ? '' : '<span class="assistant-widget-dots"><span></span></span>';
    return `<span class="${safeClass}"${styleAttr}>${dotsHtml}</span>`;
}

export function withOpacity(color, opacity = 1) {
    if (!color || color === 'transparent') return 'transparent';
    const alpha = Math.max(0, Math.min(1, Number(opacity) || 0));
    const raw = String(color).trim();
    if (raw.startsWith('rgba(')) {
        return raw.replace(/rgba\(([^)]+),\s*[^,]+\)$/i, 'rgba($1, ' + alpha + ')');
    }
    if (raw.startsWith('rgb(')) {
        return raw.replace(/^rgb\(([^)]+)\)$/i, 'rgba($1, ' + alpha + ')');
    }
    const hex = raw.replace('#', '');
    if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return raw;
}

export function applyAssistantPreview(containerEl, preview = {}) {
    if (!containerEl) return;
    containerEl.outerHTML = this.renderAssistantAvatar(preview, 'assistant-widget-preview');
}
