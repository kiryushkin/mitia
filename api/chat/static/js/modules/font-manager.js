import { FONT_WEIGHT_CONFIG, RANDOM_FONTS } from '../font-data.js';

export const FontManager = {
    async loadFont(fontName) {
        if (!fontName || typeof fontName !== 'string') return;
        
        const systemFonts = [
            'inherit', 'undefined', 'null', 'none', 'default', '',
            'arial', 'times new roman', 'georgia', 'verdana', 
            'courier new', 'comic sans ms', 'trebuchet ms', 'impact', 'geist'
        ];
        
        const trimmedName = fontName.replace(/['"]/g, '').trim();
        const lowerName = trimmedName.toLowerCase();
        
        if (!trimmedName || systemFonts.includes(lowerName) || trimmedName.length < 2) {
            return true; // Системные шрифты считаем всегда загруженными
        }

        const fontId = `font-${trimmedName.replace(/\s+/g, '-').toLowerCase()}`;
        
        // Если линк уже есть, просто ждем готовности шрифта в браузере
        if (!document.getElementById(fontId)) {
            const link = document.createElement('link');
            link.id = fontId;
            link.rel = 'stylesheet';
            
            const familyParam = trimmedName
                .split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join('+');
            
            const isSpecial = lowerName.includes('press start') || lowerName.includes('monsterrat');
            const weights = isSpecial ? '400' : '400;700';
            
            link.href = `https://fonts.googleapis.com/css2?family=${familyParam}:wght@${weights}&display=block`;
            document.head.appendChild(link);
        }

        try {
            // Ждем, пока браузер реально загрузит шрифт
            await document.fonts.load(`1em "${trimmedName}"`);
            return true;
        } catch (e) {
            console.warn(`[FontManager] Failed to load font: ${trimmedName}`);
            return false;
        }
    },

    setupFontSelect(context, containerId, hiddenInputId, currentNameId, themeKey) {
        const customSelect = document.getElementById(containerId);
        const fontHiddenInput = document.getElementById(hiddenInputId);
        const currentFontName = document.getElementById(currentNameId);
        
        if (!customSelect) return;

        const optionsContainer = customSelect.querySelector('.select-options');
        const initialFont = fontHiddenInput ? fontHiddenInput.value : (context.state.theme[themeKey] || 'Geist');
        
        if (optionsContainer && (optionsContainer.children.length === 0 || optionsContainer.innerHTML.trim() === "")) {
            optionsContainer.innerHTML = RANDOM_FONTS.map(font => {
                const isActive = font.id === initialFont ? 'active' : '';
                return `<div class="option ${isActive}" data-font="${font.id}" style="font-family: '${font.id}', sans-serif;">${font.name}</div>`;
            }).join('');
        }

        // 2. Функция обновления (теперь асинхронная)
        const updateFontUI = async (fontName) => {
            if (!fontName) return;

            // Находим элементы превью, которые нужно временно скрыть
            let prefix = '';
            if (containerId.includes('welcome')) prefix = 'welcome';
            else if (containerId.includes('msg-bot')) prefix = 'msg-bot';
            else if (containerId.includes('msg-user')) prefix = 'msg-user';
            else if (containerId.includes('msg-operator')) prefix = 'msg-operator';
            else if (containerId.includes('chat-privacy')) prefix = 'chat-privacy';
            else if (containerId.includes('chat-date')) prefix = 'chat-date';
            else if (containerId.includes('chat-time')) prefix = 'chat-time';
            else if (containerId.includes('alert')) prefix = 'alert';
            else if (containerId.includes('attach-item')) prefix = 'attach-item';
            else if (containerId.includes('inline-btn')) prefix = 'inline-btn';

            const previewElements = prefix ? document.querySelectorAll(`[id*="${prefix}"][id*="preview"], [id*="${prefix}"][id*="current-font"], [id*="${prefix}"][class*="bubble"]`) : [];
            
            // Скрываем текст перед сменой шрифта
            previewElements.forEach(el => {
                if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
                    el.style.opacity = '0';
                    el.style.transition = 'opacity 0.2s';
                }
            });

            // Загружаем шрифт
            await this.loadFont(fontName);
            
            // Применяем шрифт
            this.updateWeightSlider(containerId, fontName, themeKey, context);
            
            if (fontHiddenInput) fontHiddenInput.value = fontName;
            if (currentFontName) {
                currentFontName.textContent = fontName;
                currentFontName.style.fontFamily = `'${fontName}', sans-serif`;
            }
            
            const opts = customSelect.querySelectorAll('.option');
            opts.forEach(opt => {
                opt.classList.toggle('active', opt.dataset.font === fontName);
            });

            // Показываем текст обратно (он уже будет в новом шрифте)
            setTimeout(() => {
                previewElements.forEach(el => {
                    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
                        el.style.opacity = '1';
                    }
                });
            }, 50);
        };

        customSelect._updateFont = updateFontUI;

        // 3. События
        const trigger = customSelect.querySelector('.select-trigger');
        if (trigger) {
            trigger.onclick = (e) => {
                e.stopPropagation();
                document.querySelectorAll('.custom-select').forEach(s => {
                    if (s !== customSelect) s.classList.remove('open');
                });
                
                const isOpen = customSelect.classList.toggle('open');
                
                if (isOpen) {
                    // Ленивая загрузка шрифтов для превью
                    RANDOM_FONTS.forEach(font => this.loadFont(font.id));
                }
            };
        }

        if (optionsContainer) {
            optionsContainer.onclick = (e) => {
                const option = e.target.closest('.option');
                if (!option) return;

                e.stopPropagation();
                const font = option.dataset.font;
                updateFontUI(font);
                
                const fullKey = (typeof themeKey === 'function') ? themeKey() : themeKey;
                context.state.theme[fullKey] = font;
                context.syncWithWidget();
            };
        }

        document.addEventListener('click', () => customSelect.classList.remove('open'));

        if (initialFont) {
            updateFontUI(initialFont);
        }
    },

    updateWeightSlider(containerId, fontName, themeKey, context) {
        let prefix = '';
        if (containerId.includes('welcome')) prefix = 'welcome';
        else if (containerId.includes('msg-bot')) prefix = 'msg-bot';
        else if (containerId.includes('msg-user')) prefix = 'msg-user';
        else if (containerId.includes('msg-operator')) prefix = 'msg-operator';
        else if (containerId.includes('chat-privacy')) prefix = 'chat-privacy';
        else if (containerId.includes('chat-date')) prefix = 'chat-date';
        else if (containerId.includes('chat-time')) prefix = 'chat-time';
        else if (containerId.includes('alert')) prefix = 'alert';
        else if (containerId.includes('attach-item')) prefix = 'attach-item';
        else if (containerId.includes('inline-btn')) prefix = 'inline-btn';
        
        if (!prefix) return;

        const previewElements = document.querySelectorAll(`[id*="${prefix}"][id*="preview"], [id*="${prefix}"][id*="current-font"], [id*="${prefix}"][class*="bubble"]`);
        previewElements.forEach(el => {
            if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
                el.style.fontFamily = `'${fontName}', sans-serif`;
            }
        });
        
        const slider = document.getElementById(`${prefix}-font-weight-input`);
        const valDisplay = document.getElementById(`${prefix}-font-weight-val`);
        const config = FONT_WEIGHT_CONFIG[fontName] || { min: 400, max: 700 };
        
        if (slider) {
            slider.min = config.min;
            slider.max = config.max;
            if (parseInt(slider.value) > config.max) {
                slider.value = config.max;
                if (valDisplay) valDisplay.textContent = config.max;
                const currentKey = (typeof themeKey === 'function') ? themeKey() : themeKey;
                const weightKey = currentKey.replace('font_family', 'font_weight');
                context.state.theme[weightKey] = config.max;
            }
            if (parseInt(slider.value) < config.min) {
                slider.value = config.min;
                if (valDisplay) valDisplay.textContent = config.min;
                const currentKey = (typeof themeKey === 'function') ? themeKey() : themeKey;
                const weightKey = currentKey.replace('font_family', 'font_weight');
                context.state.theme[weightKey] = config.min;
            }
        }
    }
};
