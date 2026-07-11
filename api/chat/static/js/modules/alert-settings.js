export function initAlertSettings(context) {
    context.setupRange('alert-font-size-input', 'alert-font-size-val', 'px', 'alert_font_size', true);
    context.setupRange('alert-font-weight-input', 'alert-font-weight-val', '', 'alert_font_weight', true);
    context.setupFontSelect('alert-font-family-select-container', 'alert-font-family-select', 'alert-current-font-name', 'alert_font_family');
    context.setupRange('alert-text-opacity-input', 'alert-text-opacity-val', '%', 'alert_text_opacity', true);
    context.setupRange('alert-bg-opacity-input', 'alert-bg-opacity-val', '%', 'alert_bg_opacity', true);
    context.setupRange('alert-bg-blur-input', 'alert-bg-blur-val', 'px', 'alert_bg_blur', true);
    context.setupColorSync('alert-bg-picker', 'alert-bg-hex', 'alert-bg-preview', 'alert_bg_color');
    context.setupColorSync('alert-text-picker', 'alert-text-hex', 'alert-text-preview', 'alert_text_color');
    
    const alertPreviewToggle = document.getElementById('alert-preview-toggle');
    if (alertPreviewToggle) {
        alertPreviewToggle.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            context.state.theme.alert_preview_enabled = isEnabled;
            
            if (isEnabled) {
                // Отправляем команду в виджет показать тестовое уведомление
                if (window.MityaWidget && window.MityaWidget.showAlert) {
                    window.MityaWidget.showAlert('Это тестовое уведомление для настройки дизайна', 'info', true);
                }
            } else {
                // Отправляем команду скрыть уведомление
                if (window.MityaWidget && window.MityaWidget.closeAlert) {
                    window.MityaWidget.closeAlert();
                }
            }
            context.syncWithWidget();
        });
    }

    window.resetAlertToDefault = () => {
        context.confirmAction('Сбросить дизайн уведомлений?', 'Все настройки уведомлений будут возвращены к золотому стандарту.', () => {
            const defaults = context.getFilteredDefaults('alert_');
            
            Object.assign(context.state.theme, defaults);
            
            context.fillForm({ theme: context.state.theme });
            context.syncWithWidget();
            context.showSuccess('Дизайн уведомлений сброшен');
        });
    };

    window.randomizeAlertDesign = () => window.MagicDesignModule.randomizeAlertDesign(context);
}
