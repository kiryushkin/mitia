import { renderMarkdown } from './render';
import { escapeHtml } from '../utils/dom';
import { applyTheme } from './theme';
import { scrollToBottom } from './window';
import { updateMicState } from '../core/media';
import { openImageLightbox } from './lightbox';

/**
 * Добавляет сообщение в контейнер чата.
 */
export async function addMessage(text, role, options = {}, config, els) {
    if (!els || !els.messagesContainer) {
        console.warn('[ChatWidget] addMessage: els.messagesContainer is missing');
        return null;
    }
    const oldIndicator = els.messagesContainer.querySelector('#mitya-typing-indicator, .is-typing-dots');
    if (oldIndicator && !options.isTypingDots) {
        oldIndicator.remove();
    }

    if (!text && (!options.files || options.files.length === 0) && !options.isTypingDots) return null;

    const msgDate = options.timestamp ? new Date(options.timestamp) : new Date();
    const now = new Date();
    const dateOptions = { day: 'numeric', month: 'long' };
    if (msgDate.getFullYear() !== now.getFullYear()) dateOptions.year = 'numeric';
    const dateStr = msgDate.toLocaleDateString('ru-RU', dateOptions);
    
    const separators = els.messagesContainer.querySelectorAll('.date-separator');
    const lastSeparator = separators[separators.length - 1];
    if (!options.isWelcome && (!lastSeparator || lastSeparator.textContent !== dateStr)) {
        const dateDiv = document.createElement('div');
        dateDiv.className = 'date-separator';
        dateDiv.textContent = dateStr;
        els.messagesContainer.appendChild(dateDiv);
    }

    const msgDiv = document.createElement('div');
    let finalRole = role;
    let cleanText = text || '';

    const appearanceMatch = cleanText.match(/\[UPDATE_WIDGET_APPEARANCE\s+([^\]]+)\]/);
    if (appearanceMatch) {
        const paramsStr = appearanceMatch[1];
        const params = {};
        paramsStr.replace(/(\w+)='([^']+)'/g, (m, key, value) => { params[key] = value; });
        cleanText = cleanText.replace(/\[UPDATE_WIDGET_APPEARANCE\s+[^\]]+\]/g, '').trim();
        if (window.applyTheme && Object.keys(params).length > 0) {
            window.applyTheme(params, config, els, window.shadow, { is_local_update: true });
        }
    }

    const buttons = [];
    const buttonRegex = /\[button:([^\]|]+)\|([^\]|]+)(?:\|([^\]|]+))?\]/g;
    let match;
    while ((match = buttonRegex.exec(cleanText)) !== null) {
        buttons.push({ text: match[1], command: match[2], style: match[3] || 'accent' });
    }
    cleanText = cleanText.replace(buttonRegex, '').trim();

    const inlineButtonsEnabled = config.theme?.inline_buttons_enabled !== false;
    const operatorPreviewEnabled = config.theme?.msg_operator_preview_enabled === true || config.theme?.msg_operator_preview_enabled === 'true';
    
    // Сообщение считается операторским, если роль явно указана как operator 
    // ИЛИ если текст начинается с "Менеджер:" или содержит имя оператора из конфига
    const operatorName = config.theme?.msg_operator_name || 'Оператор';
    const isOperatorMsg = role === 'operator' || options.author_role === 'operator' || 
                         (cleanText && (cleanText.startsWith('Менеджер:') || cleanText.startsWith(`${operatorName}:`)));
    
    if (isOperatorMsg) {
        finalRole = 'operator';
        cleanText = cleanText.replace(/^Менеджер:\s*/, '').replace(new RegExp(`^${operatorName}:\\s*`), '');
    } else if (role === 'assistant') {
        finalRole = 'bot';
    }
    
    msgDiv.className = `message ${finalRole}`;
    if (options.isWelcome) msgDiv.classList.add('is-welcome');

    const wrapperDiv = document.createElement('div');
    wrapperDiv.className = 'message-wrapper';
    msgDiv.appendChild(wrapperDiv);

    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'message-avatar';
    wrapperDiv.appendChild(avatarDiv);
    
    const bodyDiv = document.createElement('div');
    bodyDiv.className = 'message-body';
    wrapperDiv.appendChild(bodyDiv);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    bodyDiv.appendChild(contentDiv);

    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    contentDiv.appendChild(textDiv);

    // Имя оператора показываем только в панели, не в виджете на сайте

    if (buttons.length > 0 && inlineButtonsEnabled) {
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'chat-inline-buttons-container';
        buttons.forEach(btn => {
            const button = document.createElement('button');
            button.className = `chat-inline-btn btn-${btn.style}`;
            const span = document.createElement('span');
            span.textContent = btn.text;
            button.appendChild(span);
            button.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                if (window.handleSystemCommand) {
                    window.handleSystemCommand(btn.command, btn.text);
                } else {
                    // Фолбэк если обработчик не определен
                    const input = els.input;
                    if (input) {
                        input.value = btn.text || btn.command;
                        const sendBtn = els.sendBtn || els.window.querySelector('#chat-send');
                        if (sendBtn) sendBtn.click();
                    }
                }
            };
            buttonsContainer.appendChild(button);
        });
        contentDiv.appendChild(buttonsContainer);
    }

    if (options.files && options.files.length > 0) {
      const filesContainer = document.createElement('div');
      filesContainer.className = 'message-files';
      options.files.forEach(file => {
        if (!file) return;
        const fileEl = document.createElement('div');
        fileEl.className = 'message-file-item';
        const fileType = file.type || '';
        const fileName = file.name || '';
        const isImage = fileType.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(fileName);
        if (isImage) {
          const img = document.createElement('img');
          img.className = 'message-image-preview chat-inline-image';
          try {
            img.src = file.isHistory
              ? (file.url || (file.data ? `data:${file.type || 'image/png'};base64,${file.data}` : ''))
              : (file instanceof Blob ? URL.createObjectURL(file) : '');
          } catch (e) { console.error('Error creating image URL', e); }
          img.onclick = () => {
            if (window.MityaWidget && window.MityaWidget.openLightbox) window.MityaWidget.openLightbox(img.src);
            else if (typeof openImageLightbox !== 'undefined') openImageLightbox(img.src, els.messagesContainer);
          };
          fileEl.appendChild(img);
        } else {
          fileEl.classList.add('is-document');
          let fileUrl = '';
          try {
            fileUrl = file.isHistory
              ? (file.url || (file.data ? `data:${file.type || 'application/octet-stream'};base64,${file.data}` : ''))
              : (file instanceof Blob ? URL.createObjectURL(file) : '');
          } catch (e) { console.error('Error creating file URL', e); }
          fileEl.innerHTML = `<div class="file-info"><a href="${fileUrl}" download="${escapeHtml(file.name || 'file')}" class="file-name" title="${escapeHtml(file.name || 'file')}">${escapeHtml(file.name || 'file')}</a></div>`;
        }
        filesContainer.appendChild(fileEl);
      });
      contentDiv.appendChild(filesContainer);
    }

    if (!options.isWelcome && !options.isTypingDots) {
        const timeSpan = document.createElement('span');
        timeSpan.className = 'message-time';
        // Если включена машинка, скрываем время изначально
        const typewriterEnabled = config.theme?.chat_typewriter_enabled === true || config.theme?.chat_typewriter_enabled === 'true';
        if (typewriterEnabled && role === 'bot' && !options.isHistory) {
            timeSpan.style.display = 'none';
        }
        timeSpan.textContent = msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        bodyDiv.appendChild(timeSpan);
        msgDiv.timeSpan = timeSpan; // Сохраняем ссылку для последующего показа
    }

    cleanText = cleanText.replace(/\[widget_preview\]/g, '').replace(/\[scenario:[^\]]*\]/g, '').replace(/\[update_widget_appearance:[^\]]*\]/g, '');
    if (options.isHistory) cleanText = cleanText.replace(/\[button:[^\]]*\]/g, '');

    els.messagesContainer.appendChild(msgDiv);

    let displayIndex = 0;
    let isAnimating = false;
    let queue = '';

    msgDiv.updateStreamingText = (newText) => {
        let processedText = newText || '';
        const operatorName = config.theme?.msg_operator_name || 'Оператор';
        if (isOperatorMsg) {
            processedText = processedText.replace(/^Менеджер:\s*/, '').replace(new RegExp(`^${operatorName}:\\s*`), '');
        }
        processedText = processedText.replace(/\[widget_preview\]/g, '').replace(/\[scenario:[^\]]*\]/g, '').replace(/\[update_widget_appearance:[^\]]*\]/g, '');
        if (options.isHistory) processedText = processedText.replace(/\[button:[^\]]*\]/g, '');
        queue = processedText;
        const typewriterEnabled = config.theme?.chat_typewriter_enabled === true || config.theme?.chat_typewriter_enabled === 'true';
        if (!typewriterEnabled) {
            textDiv.innerHTML = renderMarkdown(queue, config, false);
            if (els.messages) els.messages.scrollTop = els.messages.scrollHeight;
            return;
        }
        if (!isAnimating) startAnimation();
    };

    const startAnimation = () => {
        if (isAnimating || window.isStopRequested) return;
        isAnimating = true;
        window.isPrinting = true;
        msgDiv.classList.add('is-printing'); // Добавляем класс в начале анимации
        if (window.updateMicState) window.updateMicState(els, config, window.attachedFiles);

        // Сначала показываем анимацию точек внутри сообщения
        const dotColor = "var(--chat-typing-indicator-color, currentColor)";
        const dotStyle = `width:6px;height:6px;background:${dotColor};border-radius:50%;display:inline-block;margin:0 2px;animation:chat-dot-bounce 1.4s infinite ease-in-out both;`;
        textDiv.innerHTML = `<div style="display:flex;align-items:center;justify-content:flex-start;height:20px;"><div style="${dotStyle}animation-delay:-0.32s"></div><div style="${dotStyle}animation-delay:-0.16s"></div><div style="${dotStyle}animation-delay:0s"></div></div>`;

        const animate = () => {
            if (window.isStopRequested) {
                isAnimating = false; window.isPrinting = false;
                msgDiv.classList.remove('is-printing');
                if (msgDiv.timeSpan) msgDiv.timeSpan.style.display = ''; // Показываем время при прерывании
                const currentText = queue.substring(0, displayIndex);
                textDiv.innerHTML = renderMarkdown(currentText + "\n\n*Прервано пользователем*", config, true);
                window.lastHistoryHash = "stopped_" + Date.now(); 
                if (window.updateMicState) window.updateMicState(els, config, window.attachedFiles);
                return;
            }
            if (displayIndex < queue.length) {
                const remaining = queue.length - displayIndex;
                const charsToPrint = remaining > 50 ? 3 : (remaining > 10 ? 2 : 1);
                displayIndex += charsToPrint;
                const currentText = queue.substring(0, displayIndex);
                const isMarkdown = currentText.includes('*') || currentText.includes('[') || currentText.includes('#') || currentText.includes('`');
                if (!isMarkdown) textDiv.textContent = currentText;
                else textDiv.innerHTML = renderMarkdown(currentText, config, false);
                if (els.messages) els.messages.scrollTop = els.messages.scrollHeight;
                setTimeout(animate, 20);
            } else {
                isAnimating = false;
                msgDiv.classList.remove('is-printing');
                if (msgDiv.timeSpan) msgDiv.timeSpan.style.display = ''; // Показываем время
                if (!msgDiv.isStreaming) {
                    textDiv.innerHTML = renderMarkdown(queue, config, true);
                    window.isPrinting = false;
                    showTyping(false, els);
                    if (window.updateMicState) window.updateMicState(els, config, window.attachedFiles);
                }
            }
        };

        // Запускаем печать с задержкой 1.5 секунды, чтобы пользователь увидел точки
        setTimeout(animate, 1500);
    };

    msgDiv.prepareForText = () => {
        msgDiv.classList.remove('is-typing-dots');
        textDiv.innerHTML = '';
        msgDiv.isStreaming = true;
    };

    msgDiv.startPrinting = () => {
        msgDiv.isPrintingStarted = true;
        window.isPrinting = true;
        const typewriterEnabled = config.theme?.chat_typewriter_enabled === true || config.theme?.chat_typewriter_enabled === 'true';
        const typingIndicatorEnabled = config.theme?.chat_typing_indicator_enabled === true || config.theme?.chat_typing_indicator_enabled === 'true';
        if ((!typewriterEnabled || typingIndicatorEnabled) && queue) {
            textDiv.innerHTML = renderMarkdown(queue, config, false);
        }
    };

    if (options.isTypingDots) {
        msgDiv.classList.add('is-typing-dots');
        if (options.author_role === 'operator' || options.is_operator) {
            msgDiv.classList.remove('bot'); msgDiv.classList.add('operator');
        }
        
        // Определяем цвет индикатора (используем общий цвет индикации)
        const indicatorColor = config.theme?.chat_typing_indicator_color || 'currentColor';
        
        const dotStyle = `width:6px;height:6px;background:${indicatorColor};border-radius:50%;display:inline-block;margin:0 2px;animation:chat-dot-bounce 1.4s infinite ease-in-out both;`;
        textDiv.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;"><div style="${dotStyle}animation-delay:-0.32s"></div><div style="${dotStyle}animation-delay:-0.16s"></div><div style="${dotStyle}animation-delay:0s"></div></div>`;
        if (!options.noScroll) scrollToBottom(els);
    } else if (options.isStreaming) {
        if (els.messages) els.messages.style.scrollBehavior = 'auto';
        msgDiv.isStreaming = options.isStreaming;
        msgDiv.isPrintingStarted = true;
        if (cleanText) msgDiv.updateStreamingText(cleanText);
    } else {
        textDiv.innerHTML = renderMarkdown(cleanText, config, true);
    }

    if (options.isHistory && !options.isLastInHistory) {
        msgDiv.querySelectorAll('.chat-inline-btn').forEach(btn => {
            btn.classList.add('is-disabled'); btn.onclick = null; btn.style.pointerEvents = 'none';
        });
    }

    if (!options.noScroll) scrollToBottom(els);
    return msgDiv;
}

export function showTyping(show, els, options = {}) {
  const config = window.CONFIG || {};
  if (show) {
    const typewriterEnabled = config.theme?.chat_typewriter_enabled === true || config.theme?.chat_typewriter_enabled === 'true';
    const isOperatorMode = document.body.classList.contains('mitya-operator-active');
    
    // Класс active-typing добавляем ВСЕГДА, он нужен для кнопки Stop в media.js
    els.window.classList.add('active-typing');
    if (window.updateMicState) window.updateMicState(els, config, window.attachedFiles);

    // А вот индикатор точек показываем только если машинка выключена (или это оператор)
    if (typewriterEnabled && !isOperatorMode && !options.is_operator) return;
    
    toggleTypingIndicator(true, els, config, options);
  } else {
    els.window.classList.remove('active-typing');
    toggleTypingIndicator(false, els, config);
    
    // Удаляем только динамически созданную кнопку, не трогаем основную кнопку отправки
    const stopBtn = els.sendContainer?.querySelector('.chat-stop-btn');
    if (stopBtn && stopBtn.id !== 'chat-send') {
      stopBtn.remove();
    }
    
    // Обязательно обновляем состояние микрофона/отправки
    if (window.updateMicState) window.updateMicState(els, config, window.attachedFiles);
  }
}

let isTypingActive = false;
export function toggleTypingIndicator(show, els, config, options = {}) {
    const indicatorId = 'mitya-typing-indicator';
    let indicator = els.messagesContainer.querySelector(`#${indicatorId}`);
    if (!show) { if (indicator) indicator.remove(); isTypingActive = false; return; }
    if (indicator || isTypingActive) return;
    isTypingActive = true;
    addMessage('', 'bot', { isTypingDots: true, noScroll: false, ...options }, config, els).then(msgEl => {
        if (msgEl) msgEl.id = indicatorId;
        isTypingActive = false;
    }).catch(() => { isTypingActive = false; });
}

export function showBotMessagePreview(show, els, config) {
    const testId = 'mitya-test-bot-preview';
    let container = els.messagesContainer.querySelector(`#${testId}`);
    if (!show) { if (container) container.remove(); return; }
    if (container) return;
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const avatarStyle = `display: var(--chat-msg-bot-avatar-display, none) !important; background-image: var(--chat-msg-bot-avatar-url, none) !important;`;
    const timeStyle = `display: var(--chat-time-display, block) !important;`;
    const msgDiv = document.createElement('div');
    msgDiv.id = testId; msgDiv.dataset.isPreview = 'true'; msgDiv.className = 'message bot';
    msgDiv.innerHTML = `<div class="message-wrapper"><div class="message-avatar" style="${avatarStyle}"></div><div class="message-body"><div class="message-content"><div class="message-text">Это пример сообщения от бота с прикрепленным файлом.</div><div class="message-files"><div class="message-file-item is-document"><div class="file-info"><a href="#" class="file-name" title="Презентация_услуг.pdf" onclick="return false;">Презентация_услуг.pdf</a></div></div></div></div><span class="message-time" style="${timeStyle}">${timeStr}</span></div></div>`;
    
    // Добавляем в конец, но без принудительного скролла, если окно закрыто
    els.messagesContainer.appendChild(msgDiv);
    if (els.window.classList.contains('is-active')) {
        scrollToBottom(els);
    }
}

export function showUserMessagePreview(show, els, config) {
    const testId = 'mitya-test-user-preview';
    let container = els.messagesContainer.querySelector(`#${testId}`);
    if (!show) { if (container) container.remove(); return; }
    if (container) return;
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const avatarStyle = `display: var(--chat-msg-user-avatar-display, none) !important; background-image: var(--chat-msg-user-avatar-url, none) !important;`;
    const timeStyle = `display: var(--chat-time-display, block) !important;`;
    const msgDiv = document.createElement('div');
    msgDiv.id = testId; msgDiv.dataset.isPreview = 'true'; msgDiv.className = 'message user';
    msgDiv.innerHTML = `<div class="message-wrapper"><div class="message-avatar" style="${avatarStyle}"></div><div class="message-body"><div class="message-content"><div class="message-text">Это пример сообщения от пользователя с прикрепленным файлом.</div><div class="message-files"><div class="message-file-item is-document"><div class="file-info"><a href="#" class="file-name" title="Мой_документ.pdf" onclick="return false;">Мой_документ.pdf</a></div></div></div></div><span class="message-time" style="${timeStyle}">${timeStr}</span></div></div>`;
    
    els.messagesContainer.appendChild(msgDiv);
    if (els.window.classList.contains('is-active')) {
        scrollToBottom(els);
    }
}

export function showOperatorMessagePreview(show, els, config) {
    const testId = 'mitya-test-operator-preview';
    let container = els.messagesContainer.querySelector(`#${testId}`);
    if (!show) { if (container) container.remove(); return; }
    if (container) return;
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const avatarStyle = `display: var(--chat-msg-operator-avatar-display, none) !important; background-image: var(--chat-msg-operator-avatar-url, none) !important;`;
    const timeStyle = `display: var(--chat-time-display, block) !important;`;
    const msgDiv = document.createElement('div');
    msgDiv.id = testId; msgDiv.dataset.isPreview = 'true'; msgDiv.className = 'message operator';
    msgDiv.innerHTML = `<div class="message-wrapper"><div class="message-avatar" style="${avatarStyle}"></div><div class="message-body"><div class="message-content"><div class="message-text">Это пример сообщения от оператора с прикрепленным файлом.</div><div class="message-files"><div class="message-file-item is-document"><div class="file-info"><a href="#" class="file-name" title="Прайс_лист.pdf" onclick="return false;">Прайс_лист.pdf</a></div></div></div></div><span class="message-time" style="${timeStyle}">${timeStr}</span></div></div>`;
    els.messagesContainer.appendChild(msgDiv);
    if (els.window.classList.contains('is-active')) {
        scrollToBottom(els);
    }
}

export function showImagePreview(show, els, config) {
    const testId = 'mitya-test-image';
    let container = els.messagesContainer.querySelector(`#${testId}`);
    if (!show) { if (container) container.remove(); return; }
    if (container) return;
    const demoImageUrl = '/api/chat/static/img/demo-img.jpeg';
    const msgDiv = document.createElement('div');
    msgDiv.id = testId;
    msgDiv.dataset.isPreview = 'true';
    msgDiv.className = 'message bot';
    msgDiv.innerHTML = `<div class="message-wrapper"><div class="message-avatar"></div><div class="message-body"><div class="message-files"><div class="message-file-item"><img src="${demoImageUrl}" class="message-image-preview chat-inline-image" style="display: block;"></div></div><div class="message-content" style="display:none"></div></div></div>`;
    els.messagesContainer.appendChild(msgDiv);
    const img = msgDiv.querySelector('img');
    if (img) {
        img.onclick = () => {
            if (window.MityaWidget && window.MityaWidget.openLightbox) window.MityaWidget.openLightbox(img.src);
            else if (typeof openImageLightbox !== 'undefined') openImageLightbox(img.src, els.messagesContainer);
        };
    }
    if (els.window.classList.contains('is-active')) {
        scrollToBottom(els);
    }
}

export function showFileMessagePreview(show, els, config) {
    const testId = 'mitya-test-file';
    let container = els.messagesContainer.querySelector(`#${testId}`);
    if (!show) { if (container) container.remove(); return; }
    if (container) return;
    const msgDiv = document.createElement('div');
    msgDiv.id = testId;
    msgDiv.dataset.isPreview = 'true';
    msgDiv.className = 'message user';
    msgDiv.innerHTML = `<div class="message-wrapper"><div class="message-avatar"></div><div class="message-body"><div class="message-files"><div class="message-file-item is-document"><div class="file-info"><a href="#" class="file-name" title="Акт №23 от 29.04.2025.pdf" onclick="return false;">Акт №23 от 29.04.2025.pdf</a></div></div></div></div></div>`;
    els.messagesContainer.appendChild(msgDiv);
    if (els.window.classList.contains('is-active')) {
        scrollToBottom(els);
    }
}
