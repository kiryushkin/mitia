import { MagicDesignModule } from '../magic-design.js';

export function initMessagesSettings(context) {
    ['bot', 'user', 'operator'].forEach(type => {
        const prefix = `msg-${type}`;
        const themePrefix = `msg_${type}`;

        context.setupToggle(`${prefix}-avatar-enabled-toggle`, `${prefix}-avatar-group`, `theme.${themePrefix}_avatar_enabled`);
        context.setupImageUpload(`${prefix}-avatar-upload`, `${prefix}-avatar-preview`, `${themePrefix}_avatar`);
        context.setupRange(`${prefix}-avatar-opacity-input`, `${prefix}-avatar-opacity-val`, '%', `${themePrefix}_avatar_opacity`, true);
        context.setupRange(`${prefix}-avatar-radius-input`, `${prefix}-avatar-radius-val`, '%', `${themePrefix}_avatar_radius`, false);
        context.setupFontSelect(`${prefix}-font-family-select-container`, `${prefix}-font-family-select`, `${prefix}-current-font-name`, `${themePrefix}_font_family`);
        context.setupColorSync(`${prefix}-text-picker`, `${prefix}-text-hex`, `${prefix}-text-preview`, `${themePrefix}_text_color`);
        context.setupRange(`${prefix}-text-opacity-input`, `${prefix}-text-opacity-val`, '%', `${themePrefix}_text_opacity`, true);
        context.setupRange(`${prefix}-font-size-input`, `${prefix}-font-size-val`, 'px', `${themePrefix}_font_size`, false);
        context.setupRange(`${prefix}-font-weight-input`, `${prefix}-font-weight-val`, '', `${themePrefix}_font_weight`, true);

        if (type === 'bot' || type === 'user' || type === 'operator') {
            context.setupColorSync(`msg-${type}-link-color-picker`, `msg-${type}-link-color-hex`, `msg-${type}-link-color-preview`, `msg_${type}_link_color`);
            context.setupRange(`msg-${type}-link-opacity-input`, `msg-${type}-link-opacity-val`, '%', `msg_${type}_link_opacity`, true);
            context.setupToggle(`msg-${type}-link-h-enabled-toggle`, `msg-${type}-link-h-group`, `theme.msg_${type}_link_h_enabled`);
            context.setupColorSync(`msg-${type}-link-h-color-picker`, `msg-${type}-link-h-color-hex`, `msg-${type}-link-h-color-preview`, `msg_${type}_link_color_h`);
            context.setupRange(`msg-${type}-link-h-opacity-input`, `msg-${type}-link-h-opacity-val`, '%', `msg_${type}_link_opacity_h`, true);
        }

        context.setupToggle(`${prefix}-bg-enabled-toggle`, `${prefix}-bg-group`, `theme.${themePrefix}_bg_enabled`);
        context.setupColorSync(`${prefix}-bg-picker`, `${prefix}-bg-hex`, `${prefix}-bg-preview`, `${themePrefix}_bg_color`);
        context.setupRange(`${prefix}-bg-opacity-input`, `${prefix}-bg-opacity-val`, '%', `${themePrefix}_bg_opacity`, true);
        context.setupToggle(`${prefix}-border-enabled-toggle`, `${prefix}-border-group`, `theme.${themePrefix}_border_enabled`);
        context.setupColorSync(`${prefix}-border-picker`, `${prefix}-border-hex`, `${prefix}-border-preview`, `${themePrefix}_border_color`);
        context.setupRange(`${prefix}-border-opacity-input`, `${prefix}-border-opacity-val`, '%', `${themePrefix}_border_opacity`, true);
        context.setupRange(`${prefix}-border-width-input`, `${prefix}-border-width-val`, 'px', `${themePrefix}_border_width`, false);
    });

    context.setupInput('prompt-bot-name', 'bot_name');
    context.setupInput('prompt-bot-role', 'bot_role');
    context.setupInput('prompt-welcome-msg', 'welcome_msg');
    
    // Инициализация переключателя моделей
    const modelSwitcher = document.getElementById('ai-model-switcher');
    const modelInput = document.getElementById('prompt-ai-model');
    if (modelSwitcher && modelInput) {
        modelSwitcher.querySelectorAll('.type-btn').forEach(btn => {
            btn.onclick = () => {
                modelSwitcher.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const val = btn.dataset.dnaVal;
                modelInput.value = val;
                
                // Сохраняем в стейт (в корень и в bot_settings для надежности)
                context.state.ai_model = val;
                if (!context.state.bot_settings) context.state.bot_settings = {};
                context.state.bot_settings.ai_model = val;
                
                // Принудительно обновляем значение в инпуте, чтобы saveData его подхватил
                if (modelInput) modelInput.value = val;
                
                console.log('[MessagesSettings] Model selected:', val);
                context.syncWithWidget();
            };
        });
    }

    // Инициализация переключателей ДНК (Обращение, Тон, Длина)
    const setupDnaSwitcher = (switcherId, inputId, stateKey) => {
        const switcher = document.getElementById(switcherId);
        const input = document.getElementById(inputId);
        if (switcher && input) {
            switcher.querySelectorAll('.type-btn').forEach(btn => {
                btn.onclick = () => {
                    switcher.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const val = btn.dataset.dnaVal;
                    input.value = val;
                    
                    if (!context.state.bot_settings) context.state.bot_settings = {};
                    context.state.bot_settings[stateKey] = val;
                    
                    console.log(`[MessagesSettings] DNA ${stateKey} selected:`, val);
                    context.syncWithWidget();
                };
            });
        }
    };

    setupDnaSwitcher('dna-addressing-switcher', 'dna-addressing', 'dna_addressing');
    setupDnaSwitcher('dna-tone-switcher', 'dna-tone', 'dna_tone');
    setupDnaSwitcher('dna-language-switcher', 'dna-language', 'dna_language');
    setupDnaSwitcher('dna-length-switcher', 'dna-length', 'dna_length');
    setupDnaSwitcher('dna-proactive-switcher', 'dna-proactive', 'dna_proactive');
    setupDnaSwitcher('dna-focus-switcher', 'dna-focus', 'dna_focus');

    // Инициализация ползунка креативности (температуры)
    const tempInput = document.getElementById('dna-temp-input');
    const tempVal = document.getElementById('dna-temp-val');
    if (tempInput && tempVal) {
        const updateFromValue = (val) => {
            const percent = Math.round(val);
            tempVal.textContent = percent + '%';
            if (!context.state.bot_settings) context.state.bot_settings = {};
            context.state.bot_settings.temperature = percent / 100;
        };

        tempInput.addEventListener('input', (e) => {
            updateFromValue(e.target.value);
            context.syncWithWidget();
        });

        // Функция синхронизации
        const syncTemp = () => {
            // Берем из стейта (0.1 - 1.0) или дефолт 0.3
            const currentTemp = context.state.bot_settings?.temperature || 0.3;
            const percent = Math.round(currentTemp * 100);
            tempInput.value = percent;
            tempVal.textContent = percent + '%';
        };
        
        window.syncTempUI = syncTemp;

        window.addEventListener('config_loaded', syncTemp);
        // Повторная попытка через секунду, если данные грузятся долго
        setTimeout(syncTemp, 1000);
    }

    // Правильная инициализация тумблера (чекбокса)
    context.setupToggle('dna-emojis', null, 'bot_settings.dna_emojis');

    // Функция для синхронизации визуального состояния кнопок с данными из стейта
    const syncDnaButtons = () => {
        const bot_settings = context.state.bot_settings || {};
        const switchers = [
            { id: 'dna-addressing-switcher', key: 'dna_addressing' },
            { id: 'dna-tone-switcher', key: 'dna_tone' },
            { id: 'dna-language-switcher', key: 'dna_language' },
            { id: 'dna-length-switcher', key: 'dna_length' },
            { id: 'dna-proactive-switcher', key: 'dna_proactive' },
            { id: 'dna-focus-switcher', key: 'dna_focus' },
            { id: 'ai-model-switcher', key: 'ai_model' }
        ];

        switchers.forEach(s => {
            const switcher = document.getElementById(s.id);
            if (!switcher) return;
            
            const val = bot_settings[s.key] || (s.key === 'ai_model' ? context.state.ai_model : null);
            if (val) {
                switcher.querySelectorAll('.type-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.dnaVal === val);
                });
                const input = switcher.parentElement.querySelector('input[type="hidden"]');
                if (input) input.value = val;
            }
        });

        // Синхронизация тумблера эмодзи
        const emojiToggle = document.getElementById('dna-emojis');
        if (emojiToggle) {
            const val = bot_settings.dna_emojis;
            // Поддерживаем и булево, и старое 'none' (которое означало Да)
            emojiToggle.checked = (val === true || val === 'none' || val === 'yes');
        }
    };

    // Делаем функцию доступной глобально для вызова из AppearanceModule
    window.syncDnaButtons = syncDnaButtons;

    // Вызываем синхронизацию с небольшой задержкой, чтобы данные успели загрузиться
    setTimeout(syncDnaButtons, 500);
    
    // Также вешаем на событие загрузки данных
    window.addEventListener('config_loaded', syncDnaButtons);

    context.setupToggle('msg-bot-preview-enabled-toggle', null, 'theme.msg_bot_preview_enabled');
    context.setupToggle('msg-user-preview-enabled-toggle', null, 'theme.msg_user_preview_enabled');
    context.setupToggle('msg-operator-preview-enabled-toggle', null, 'theme.msg_operator_preview_enabled');
    context.setupToggle('chat-date-enabled-toggle', 'chat-date-group', 'theme.chat_date_enabled');
    context.setupColorSync('chat-date-color-picker', 'chat-date-color-hex', 'chat-date-color-preview', 'chat_date_color');
    context.setupRange('chat-date-opacity-input', 'chat-date-opacity-val', '%', 'chat_date_opacity', true);
    context.setupFontSelect('chat-date-font-family-select-container', 'chat-date-font-family-select', 'chat-date-current-font-name', 'chat_date_font_family');
    context.setupRange('chat-date-font-weight-input', 'chat-date-font-weight-val', '', 'chat_date_font_weight', true);
    context.setupRange('chat-date-font-size-input', 'chat-date-font-size-val', 'px', 'chat_date_font_size', true);
    context.setupToggle('chat-time-enabled-toggle', 'chat-time-group', 'theme.chat_time_enabled');
    context.setupColorSync('chat-time-color-picker', 'chat-time-color-hex', 'chat-time-color-preview', 'chat_time_color');
    context.setupRange('chat-time-opacity-input', 'chat-time-opacity-val', '%', 'chat_time_opacity', true);
    context.setupFontSelect('chat-time-font-family-select-container', 'chat-time-font-family-select', 'chat-time-current-font-name', 'chat_time_font_family');
    context.setupRange('chat-time-font-weight-input', 'chat-time-font-weight-val', '', 'chat_time_font_weight', true);
    context.setupRange('chat-time-font-size-input', 'chat-time-font-size-val', 'px', 'chat_time_font_size', true);
    context.setupColorSync('chat-link-color-picker', 'chat-link-color-hex', 'chat-link-color-preview', 'chat_link_color');
    context.setupRange('chat-link-opacity-input', 'chat-link-opacity-val', '%', 'chat_link_opacity', true);
    context.setupToggle('chat-link-h-enabled-toggle', 'chat-link-h-group', 'theme.chat_link_h_enabled');
    context.setupColorSync('chat-link-h-color-picker', 'chat-link-h-color-hex', 'chat-link-h-color-preview', 'chat_link_color_h');
    context.setupRange('chat-link-h-opacity-input', 'chat-link-h-opacity-val', '%', 'chat_link_opacity_h', true);
    context.setupColorSync('chat-privacy-color-picker', 'chat-privacy-color-hex', 'chat-privacy-color-preview', 'chat_privacy_text_color');
    context.setupRange('chat-privacy-opacity-input', 'chat-privacy-opacity-val', '', 'chat_privacy_text_opacity', true);
    context.setupFontSelect('chat-privacy-font-family-select-container', 'chat-privacy-font-family-select', 'chat-privacy-current-font-name', 'chat_privacy_font_family');
    context.setupRange('chat-privacy-font-size-input', 'chat-privacy-font-size-val', 'px', 'chat_privacy_font_size', true);
    context.setupRange('chat-privacy-font-weight-input', 'chat-privacy-font-weight-val', '', 'chat_privacy_font_weight', true);
    context.setupToggle('chat-privacy-enabled-toggle', 'chat-privacy-group', 'theme.chat_privacy_enabled');
    context.setupInput('chat-privacy-url-input', 'chat_privacy_url');
    context.setupToggle('chat-privacy-target-toggle', null, 'theme.chat_privacy_target_blank');
    context.setupToggle('chat-typewriter-toggle', 'chat-typewriter-group', 'theme.chat_typewriter_enabled');
    context.setupToggle('chat-typing-indicator-toggle', 'chat-typing-indicator-group', 'theme.chat_typing_indicator_enabled');
    context.setupColorSync('chat-typing-indicator-color-picker', 'chat-typing-indicator-color-hex', 'chat-typing-indicator-color-preview', 'chat_typing_indicator_color');

    const typewriterToggle = document.getElementById('chat-typewriter-toggle');
    const typingIndicatorToggle = document.getElementById('chat-typing-indicator-toggle');
    const typewriterGroup = document.getElementById('chat-typewriter-group');
    const typingIndicatorGroup = document.getElementById('chat-typing-indicator-group');

    const updateGroupsVisibility = () => {
        if (typewriterToggle && typewriterGroup) {
            if (typewriterToggle.checked) {
                typewriterGroup.style.display = 'block';
                typewriterGroup.classList.remove('setting-group-disabled');
                typewriterGroup.querySelectorAll('input, select, button').forEach(el => el.disabled = false);
            } else {
                typewriterGroup.style.display = 'none';
                typewriterGroup.classList.add('setting-group-disabled');
                typewriterGroup.querySelectorAll('input, select, button').forEach(el => el.disabled = true);
            }
        }
        // Группа индикатора набора удалена из HTML, так как цвет теперь общий
    };

    if (typewriterToggle && typingIndicatorToggle) {
        typewriterToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                // Если включили машинку, выключаем индикатор
                if (typingIndicatorToggle.checked) {
                    typingIndicatorToggle.checked = false;
                    context.state.theme.chat_typing_indicator_enabled = false;
                }
            } else {
                // Если выключили машинку, ОБЯЗАТЕЛЬНО включаем индикатор
                if (!typingIndicatorToggle.checked) {
                    typingIndicatorToggle.checked = true;
                    context.state.theme.chat_typing_indicator_enabled = true;
                }
            }
            updateGroupsVisibility();
            context.syncWithWidget();
        });

        typingIndicatorToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                // Если включили индикатор, выключаем машинку
                if (typewriterToggle.checked) {
                    typewriterToggle.checked = false;
                    context.state.theme.chat_typewriter_enabled = false;
                }
            } else {
                // Если выключили индикатор, ОБЯЗАТЕЛЬНО включаем машинку
                if (!typewriterToggle.checked) {
                    typewriterToggle.checked = true;
                    context.state.theme.chat_typewriter_enabled = true;
                }
            }
            updateGroupsVisibility();
            context.syncWithWidget();
        });

        setTimeout(updateGroupsVisibility, 100);
    }

    window.resetMsgBotToDefault = () => {
        context.confirmAction('Сбросить дизайн бота?', 'Все настройки сообщений бота будут возвращены к золотому стандарту.', () => {
            const oldUrl = context.state.theme.msg_bot_avatar;
            const keys = [
                'msg_bot_avatar_enabled', 'msg_bot_avatar', 'msg_bot_avatar_opacity', 'msg_bot_avatar_radius',
                'msg_bot_font_family', 'msg_bot_text_color', 'msg_bot_text_opacity', 'msg_bot_font_size', 'msg_bot_font_weight',
                'msg_bot_link_color', 'msg_bot_link_opacity', 'msg_bot_link_h_enabled', 'msg_bot_link_color_h', 'msg_bot_link_opacity_h',
                'msg_bot_bg_enabled', 'msg_bot_bg_color', 'msg_bot_bg_opacity',
                'msg_bot_border_enabled', 'msg_bot_border_color', 'msg_bot_border_opacity', 'msg_bot_border_width',
                'msg_bot_preview_enabled', 'bot_name', 'bot_role', 'welcome_msg', 'ai_model',
                'dna_addressing', 'dna_tone', 'dna_language', 'dna_length', 'dna_proactive', 'temperature', 'dna_emojis', 'dna_focus',
                'enable_tts', 'tts_voice'
            ];
            keys.forEach(key => {
                const defaultValue = context.getFilteredDefaults('')[key];
                if (defaultValue !== undefined) {
                    context.state.theme[key] = defaultValue;
                    // Если это настройки бота, также обновляем их в bot_settings
                    if (key === 'bot_name' || key === 'bot_role' || key === 'ai_model' || key.startsWith('dna_') || key === 'temperature' || key === 'enable_tts' || key === 'tts_voice') {
                        if (!context.state.bot_settings) context.state.bot_settings = {};
                        context.state.bot_settings[key] = defaultValue;
                    }
                    if (key === 'welcome_msg') {
                        context.state.welcome_msg = defaultValue;
                    }
                }
            });

            context.state.theme.msg_bot_avatar = null;
            context.fillForm(context.state); // Передаем весь стейт, а не только тему
            context.updateImagePreview('msg-bot-avatar-preview', null, 'msg_bot_avatar');
            
            // Принудительно синхронизируем кнопки ДНК, Голоса и Температуры после сброса
            if (typeof window.syncDnaButtons === 'function') window.syncDnaButtons();
            if (typeof window.syncVoiceUI === 'function') window.syncVoiceUI();
            if (typeof window.syncTempUI === 'function') window.syncTempUI();
            
            context.syncWithWidget();            context.showSuccess('Дизайн бота сброшен');
            // УДАЛЕНО: немедленное удаление файла. Теперь он удалится только при нажатии "Сохранить"
            // if (oldUrl) context.deleteFileFromServer(oldUrl);
        });
    };

    window.resetMsgUserToDefault = () => {
        context.confirmAction('Сбросить дизайн пользователя?', 'Все настройки сообщений пользователя будут возвращены к золотому стандарту.', () => {
            const oldUrl = context.state.theme.msg_user_avatar;
            const keys = [
                'msg_user_avatar_enabled', 'msg_user_avatar', 'msg_user_avatar_opacity', 'msg_user_avatar_radius',
                'msg_user_font_family', 'msg_user_text_color', 'msg_user_text_opacity', 'msg_user_font_size', 'msg_user_font_weight',
                'msg_user_link_color', 'msg_user_link_opacity', 'msg_user_link_h_enabled', 'msg_user_link_color_h', 'msg_user_link_opacity_h',
                'msg_user_bg_enabled', 'msg_user_bg_color', 'msg_user_bg_opacity',
                'msg_user_border_enabled', 'msg_user_border_color', 'msg_user_border_opacity', 'msg_user_border_width',
                'msg_user_preview_enabled'
            ];
            keys.forEach(key => {
                const defaultValue = context.getFilteredDefaults('')[key];
                if (defaultValue !== undefined) context.state.theme[key] = defaultValue;
            });

            context.state.theme.msg_user_avatar = null;
            context.fillForm({ theme: context.state.theme });
            context.updateImagePreview('msg-user-avatar-preview', null, 'msg_user_avatar');
            context.syncWithWidget();
            context.showSuccess('Дизайн пользователя сброшен');
            // УДАЛЕНО: немедленное удаление файла. Теперь он удалится только при нажатии "Сохранить"
            // if (oldUrl) context.deleteFileFromServer(oldUrl);
        });
    };

    window.resetMsgOperatorToDefault = () => {
        context.confirmAction('Сбросить дизайн оператора?', 'Все настройки сообщений оператора будут возвращены к золотому стандарту.', () => {
            const oldUrl = context.state.theme.msg_operator_avatar;
            const keys = [
                'msg_operator_avatar_enabled', 'msg_operator_avatar', 'msg_operator_avatar_opacity', 'msg_operator_avatar_radius',
                'msg_operator_font_family', 'msg_operator_text_color', 'msg_operator_text_opacity', 'msg_operator_font_size', 'msg_operator_font_weight',
                'msg_operator_link_color', 'msg_operator_link_opacity', 'msg_operator_link_h_enabled', 'msg_operator_link_color_h', 'msg_operator_link_opacity_h',
                'msg_operator_bg_enabled', 'msg_operator_bg_color', 'msg_operator_bg_opacity',
                'msg_operator_border_enabled', 'msg_operator_border_color', 'msg_operator_border_opacity', 'msg_operator_border_width',
                'msg_operator_name', 'msg_operator_preview_enabled'
            ];
            keys.forEach(key => {
                const defaultValue = context.getFilteredDefaults('')[key];
                if (defaultValue !== undefined) context.state.theme[key] = defaultValue;
            });

            context.state.theme.msg_operator_avatar = null;
            context.fillForm({ theme: context.state.theme });
            context.updateImagePreview('msg-operator-avatar-preview', null, 'msg_operator_avatar');
            context.syncWithWidget();
            context.showSuccess('Дизайн оператора сброшен');
            // УДАЛЕНО: немедленное удаление файла. Теперь он удалится только при нажатии "Сохранить"
            // if (oldUrl) context.deleteFileFromServer(oldUrl);
        });
    };

    window.removeAvatar = async (type) => {
        const previewId = `msg-${type}-avatar-preview`;
        const settingKey = `msg_${type}_avatar`;
        const oldUrl = context.state.theme[settingKey];
        
        // Если это временный файл, удаляем его физически сразу
        if (oldUrl && oldUrl.includes('/uploads/temp/')) {
            if (context.deleteTempFile) await context.deleteTempFile(settingKey);
        }

        context.state.theme[settingKey] = null;
        context.updateImagePreview(previewId, null, settingKey);
        context.syncWithWidget();
    };

    window.resetChatToDefault = () => {
        context.confirmAction('Сбросить дизайн чата?', 'Все настройки политики, даты и времени будут возвращены к золотому стандарту.', () => {
            const keys = [
                'chat_privacy_enabled', 'chat_privacy_url', 'chat_privacy_target_blank',
                'chat_privacy_font_family', 'chat_privacy_text_color', 'chat_privacy_text_opacity', 'chat_privacy_font_size', 'chat_privacy_font_weight',
                'chat_link_color', 'chat_link_opacity', 'chat_link_h_enabled', 'chat_link_color_h', 'chat_link_opacity_h',
                'chat_date_enabled', 'chat_date_font_family', 'chat_date_color', 'chat_date_opacity', 'chat_date_font_size', 'chat_date_font_weight',
                'chat_time_enabled', 'chat_time_font_family', 'chat_time_color', 'chat_time_opacity', 'chat_time_font_size', 'chat_time_font_weight',
                'chat_typing_indicator_color', 'chat_typewriter_enabled', 'chat_typing_indicator_enabled'
            ];
            keys.forEach(key => {
                const defaultValue = context.getFilteredDefaults('')[key];
                if (defaultValue !== undefined) context.state.theme[key] = defaultValue;
            });

            context.fillForm({ theme: context.state.theme });
            
            // Эмулируем изменение для обновления видимости групп
            const typewriterToggle = document.getElementById('chat-typewriter-toggle');
            if (typewriterToggle) typewriterToggle.dispatchEvent(new Event('change'));
            
            context.syncWithWidget();
            context.showSuccess('Дизайн чата сброшен');
        });
    };


    window.randomizeChatDesign = () => MagicDesignModule.randomizeChatDesign(context);
    window.randomizeMessagesDesign = (type) => MagicDesignModule.randomizeMessagesDesign(context, type);

    context.initMessagesUI = (config) => {
        const t = config.theme || {};
        const bot_settings = config.bot_settings || {};
        
        ['bot', 'user', 'operator'].forEach(type => {
            const themePrefix = `msg_${type}`;
            const prefix = `msg-${type}`;
            if (t[`${themePrefix}_avatar`]) {
                context.updateImagePreview(`${prefix}-avatar-preview`, t[`${themePrefix}_avatar`], `${themePrefix}_avatar`);
            }
        });

        // Подсветка активной модели
        const activeModel = bot_settings.ai_model || 'gigachat';
        const modelSwitcher = document.getElementById('ai-model-switcher');
        if (modelSwitcher) {
            modelSwitcher.querySelectorAll('.type-btn').forEach(btn => {
                if (btn.dataset.dnaVal === activeModel) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }

        if (t.chat_time_color) {
            const preview = document.getElementById('chat-time-color-preview');
            if (preview) preview.style.backgroundColor = t.chat_time_color;
        }
    };
}
