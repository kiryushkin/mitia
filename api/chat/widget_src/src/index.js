import { BOOTSTRAP, CONFIG, fetchGoldenStandard, getWidgetStorageScope } from './core/config';
import { $, formatDim, isMobile, escapeHtml, showChatAlert } from './utils/dom';
import { getCookie, setCookie, generateFingerprint } from './core/auth';
import { buildHTML } from './ui/html';
import { applyTheme, showTestButtons } from './ui/theme';
import { openImageLightbox } from './ui/lightbox';
import { renderMarkdown, updateAttachBtnVisibility, renderAttachedFiles, showAttachPreview, hideAttachPreview } from './ui/render';
import { addMessage, showTyping, toggleTypingIndicator, showImagePreview, showFileMessagePreview } from './ui/messages';
import { openChat, closeChat, toggleChat, scrollToBottom, toggleExpand, positionChatWindow, toggleVoiceAvatar, stopPresentation, startScenario } from './ui/window';
import { loadChatHistory, sendMessage } from './api/chat';
import { ChatAPI } from './api/websocket';
import { initDraggable } from './ui/drag-resize';
import { initWelcomeBubble, updateWelcomeBubblePosition, showWelcome, hideWelcome } from './ui/welcome';
import { renderQuickReplies } from './ui/quick-replies';
import { initMedia, updateMicState } from './core/media';

(function () {
  'use strict';

  if (window.__MITYA_WIDGET__) return;
  window.__MITYA_WIDGET__ = true;

  // Добавляем глобальную функцию для принудительного перезапуска виджета
  window.restartMityaWidget = async () => {
    const host = document.getElementById('mitya-widget-host');
    if (host) host.remove();
    window.__MITYA_WIDGET__ = false;
    if (window.historyUpdateInterval) clearInterval(window.historyUpdateInterval);
    await init();
  };

  window.els = {};
  window.shadow = null;
  window.chatToken = null;
  window.sessionId = null;
  window.attachedFiles = [];
  window.typingAbortController = null;
  window.isStopRequested = false;
  window.isPrinting = false;
  window.botPrintTarget = null;
  
  window.mitya_session_rect = null;
  window.preExpandedStyles = null;

  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  const MAX_FILES_COUNT = 2;

  async function init() {
    console.log('[ChatWidget] Initializing...');

    // 1. Сначала загружаем конфиг. Если сервер запретит (403), мы даже не будем создавать DOM.
    try {
      const isConfigLoaded = await loadConfig();
      if (!isConfigLoaded) {
        console.warn('[ChatWidget] Access denied or config load failed. Widget will not be initialized.');
        return;
      }
    } catch (e) {
      console.error('[ChatWidget] Critical error during config load:', e);
      return;
    }

    const defaults = await fetchGoldenStandard();
    CONFIG.theme = { ...defaults, ...CONFIG.theme };

    const storageScope = getWidgetStorageScope(CONFIG);
    const tokenKey = `chat_token_${storageScope}`;
    const sessionKey = `mitya_session_id_${storageScope}`;
    window.sessionId = localStorage.getItem(sessionKey) || null;
    let chatToken = getCookie(tokenKey) || localStorage.getItem(tokenKey);
    
    if (!chatToken) {
      chatToken = generateFingerprint(CONFIG.clientId);
      localStorage.setItem(tokenKey, chatToken);
      setCookie(tokenKey, chatToken, 365);
    }
    window.chatToken = chatToken;

    const host = document.getElementById('mitya-widget-host') || document.createElement('div');
    host.id = 'mitya-widget-host';
    host.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; z-index:2147483647; pointer-events:none;';
    if (!host.parentElement) document.body.appendChild(host);

    const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    window.shadow = shadow;

    const cssUrl = (CONFIG.serverUrl || '') + '/api/chat/chat-widget.css?v=' + Date.now();
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = cssUrl;
    shadow.appendChild(styleLink);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = buildHTML(CONFIG);
    shadow.appendChild(wrapper);

    window.els = {
      widget: shadow.querySelector('#chat-widget'),
      widgetContainer: shadow.querySelector('.chat-widget-container'),
      window: shadow.querySelector('#chat-window'),
      messages: shadow.querySelector('#chat-messages'),
      messagesContainer: shadow.querySelector('#chat-messages-container'),
      input: shadow.querySelector('#chat-input'),
      sendBtn: shadow.querySelector('#chat-send'),
      send: shadow.querySelector('#chat-send'),
      toggleBtn: shadow.querySelector('#chat-toggle'),
      closeBtn: shadow.querySelector('#chat-close-btn'),
      expandBtn: shadow.querySelector('#chat-expand-btn'),
      attachBtn: shadow.querySelector('#chat-attach-btn'),
      sendContainer: shadow.querySelector('.chat-send-container'),
      fileInput: shadow.querySelector('#chat-file-input'),
      attachedFilesBox: shadow.querySelector('#chat-attached-files'),
      welcome: shadow.querySelector('#chat-welcome-bubble'),
      welcomeClose: shadow.querySelector('#chat-welcome-close'),
      privacyNote: shadow.querySelector('#chat-privacy-note'),
      quickRepliesBox: shadow.querySelector('#chat-quick-replies') || shadow.querySelector('#chat-messages-container'),
      avatarOverlay: shadow.querySelector('#chat-avatar-overlay'),
      avatarFrame: shadow.querySelector('#chat-avatar-frame'),
    };
    
    const isAdminPage = window.location.pathname.includes('/admin') || 
                        window.location.search.includes('client_id=') ||
                        window.location.search.includes('superadmin_view=');
    
    // Отображение виджета управляется только тумблером интеграции.
    const isWidgetDisabled = CONFIG.theme?.widget_enabled === false;

    if (isWidgetDisabled) {
      console.log('Mitya AI: Widget is disabled by owner or administrator.');
      host.style.display = 'none';
      if (host.parentElement) host.remove();
      return;
    }

    setupEventListeners();
    
    const loadGoogleFont = (fontName) => {
      if (!fontName || fontName === 'inherit') return;
      const font = fontName.replace(/\s+/g, '+');
      const fontId = `mitya-font-${font.toLowerCase()}`;
      if (!document.getElementById(fontId)) {
        console.log('[ChatWidget] Loading font:', fontName);
        const link = document.createElement('link');
        link.id = fontId;
        link.href = `https://fonts.googleapis.com/css2?family=${font}:wght@400;700&display=swap`;
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
    };

    if (CONFIG.theme) {
      loadGoogleFont(CONFIG.theme.msg_bot_font_family);
      loadGoogleFont(CONFIG.theme.welcome_font_family);
      loadGoogleFont(CONFIG.theme.inline_btn_accent_font_family);
      loadGoogleFont(CONFIG.theme.inline_btn_neutral_font_family);
      loadGoogleFont(CONFIG.theme.inline_btn_info_font_family);
      loadGoogleFont(CONFIG.theme.alert_font_family);
    }
    
    applyTheme(CONFIG.theme, CONFIG, window.els, window.shadow);

    try {
      const localTheme = localStorage.getItem(`mitya_theme_${CONFIG.clientId}`);
      if (localTheme) {
        const parsed = JSON.parse(localTheme);
        console.log('[ChatWidget] Applying local theme override:', parsed);
        applyTheme(parsed, CONFIG, window.els, window.shadow, { is_local_update: true });
      }
    } catch (e) {}
    
    updateAttachBtnVisibility(window.els, CONFIG);
    initDraggable(window.els, CONFIG, () => updateWelcomeBubblePosition(window.els));
    initWelcomeBubble(window.els, CONFIG, () => window.Mitya.open());
    renderQuickReplies(window.els, CONFIG, (text) => handleSendMessage(text), () => saveCurrentDesign());
    
    initMedia(window.els, CONFIG);
    window.updateMicState = (e, c, f) => updateMicState(e || window.els, c || CONFIG, f || window.attachedFiles);
    window.updateMicState();

    applyTheme(CONFIG.theme, CONFIG, window.els, window.shadow, { is_initial_load: true, force_position: true });

    window.els.widget.classList.add('ready');

    const api = new ChatAPI(CONFIG);
    api.connect(window.chatToken, window.sessionId);
    window.MityaAPI = api;

    api.on('typing', (data) => {
        console.log('[WS] Typing event:', data);
        toggleTypingIndicator(data.is_typing, window.els, CONFIG, { author_role: data.author_role });
    });

    api.on('message', async (data) => {
        if (!data?.content || !window.els?.messagesContainer) return;

        const typewriterEnabled = CONFIG.theme?.chat_typewriter_enabled === true
          || CONFIG.theme?.chat_typewriter_enabled === 'true';
        const role = data.author_role === 'operator' ? 'operator' : 'bot';

        await addMessage(data.content, role, {
          author_role: data.author_role,
          files: (data.attachments || []).map(file => ({ ...file, isHistory: true })),
          isStreaming: typewriterEnabled,
          timestamp: data.timestamp
        }, CONFIG, window.els);
        scrollToBottom(window.els);
    });

    api.on('config_update', (data) => {
        console.log('[WS] Config update received:', data);
        if (data.config) {
            const oldEnabled = CONFIG.theme?.widget_enabled !== false;
            
            // Обновляем локальный конфиг
            if (data.config.theme) Object.assign(CONFIG.theme, data.config.theme);
            if (data.config.welcome_msg !== undefined) CONFIG.welcome_msg = data.config.welcome_msg;
            if (data.config.bot_settings) {
              CONFIG.bot_settings = { ...(CONFIG.bot_settings || {}), ...data.config.bot_settings };
            }
            if (data.config.is_active !== undefined) CONFIG.is_active = data.config.is_active;
            
            const newEnabled = CONFIG.theme?.widget_enabled !== false;
            
            if (oldEnabled && !newEnabled) {
                console.log('[ChatWidget] Widget disabled via remote config. Hiding...');
                if (window.els.widget) window.els.widget.style.display = 'none';
                const host = document.getElementById('mitya-widget-host');
                if (host) host.style.display = 'none';
            } else if (!oldEnabled && newEnabled) {
                console.log('[ChatWidget] Widget enabled via remote config. Showing...');
                if (window.els.widget) window.els.widget.style.display = 'block';
                const host = document.getElementById('mitya-widget-host');
                if (host) host.style.display = 'block';
                
                // Если виджет был полностью удален из DOM, может потребоваться перезапуск
                if (!window.els.widget) {
                    window.restartMityaWidget();
                }
            }
            
            // Применяем остальные изменения темы (цвета и т.д.)
            if (newEnabled) {
                applyTheme(CONFIG.theme, CONFIG, window.els, window.shadow, data.config);
            }
        }
    });

    let typingTimeout = null;
    window.els.input.addEventListener('input', () => {
        if (!typingTimeout) {
            api.send({ type: 'typing', is_typing: true });
        }
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            api.send({ type: 'typing', is_typing: false });
            typingTimeout = null;
        }, 3000);
    });

    window.Mitya = window.MityaWidget = {
      open: () => openChat(window.els, CONFIG, (c, t, e) => loadChatHistory(c, t, e, (txt, r, opt) => addMessage(txt, r, opt, CONFIG, window.els), scrollToBottom, generateFingerprint, setCookie), window.chatToken),
      close: () => closeChat(window.els, CONFIG),
      toggle: () => toggleChat(window.els, CONFIG, (c, t, e) => loadChatHistory(c, t, e, (txt, r, opt) => addMessage(txt, r, opt, CONFIG, window.els), scrollToBottom, generateFingerprint, setCookie), window.chatToken),
      sendMessage: (text) => handleSendMessage(text),
      updateBubble: () => updateWelcomeBubblePosition(window.els),
      showWelcome: () => showWelcome(window.els),
      hideWelcome: () => hideWelcome(window.els),
      showImagePreview: (show) => showImagePreview(show, window.els, CONFIG),
      hideImagePreview: () => {
        showImagePreview(false, window.els, CONFIG);
        window.parent.postMessage({ type: 'mitya_hide_image_preview' }, '*');
      },
      showFileMessagePreview: (show) => showFileMessagePreview(show, window.els, CONFIG),
      hideFileMessagePreview: () => {
        showFileMessagePreview(false, window.els, CONFIG);
        window.parent.postMessage({ type: 'mitya_hide_file_preview' }, '*');
      },
      showBotMessagePreview: (show) => showBotMessagePreview(show, window.els, CONFIG),
      showStopBtnPreview: (show) => {
        window.isStopBtnPreviewActive = show;
        updateMicState(window.els, CONFIG, window.attachedFiles);
      },
      showRecordBtnPreview: (show) => {
        window.isRecordBtnPreviewActive = show;
        updateMicState(window.els, CONFIG, window.attachedFiles);
      },
      showSendBtnPreview: (show) => {
        window.isSendBtnPreviewActive = show;
        updateMicState(window.els, CONFIG, window.attachedFiles);
      },
      showTestButtons: (show) => showTestButtons(show, window.els, window.shadow),
      showAttachPreview: (show) => showAttachPreview(window.attachedFiles, window.els),
      hideAttachPreview: () => {
        hideAttachPreview(window.attachedFiles, window.els);
        window.parent.postMessage({ type: 'mitya_hide_attach_preview' }, '*');
      },
      openLightbox: (src) => openImageLightbox(src, window.els.messagesContainer),
      showAlert: (text, type, isPreview) => showChatAlert(text, type, isPreview),
      closeAlert: () => {
        if (window.MityaWidget && typeof window.MityaWidget._closeAlertInternal === 'function') {
            window.MityaWidget._closeAlertInternal();
        }
      },
      applyTheme: (theme, data = {}) => {
        if (data.welcome_msg !== undefined) {
          CONFIG.welcome_msg = data.welcome_msg;
        }
        if (data.bot_settings) {
          CONFIG.bot_settings = { ...(CONFIG.bot_settings || {}), ...data.bot_settings };
        }

        if (theme) {
          Object.assign(CONFIG.theme, theme);

          loadGoogleFont(theme.msg_bot_font_family);            loadGoogleFont(theme.welcome_font_family);
            loadGoogleFont(theme.inline_btn_accent_font_family);
            loadGoogleFont(theme.inline_btn_neutral_font_family);
            loadGoogleFont(theme.inline_btn_info_font_family);
            loadGoogleFont(theme.alert_font_family);

            applyTheme(theme, CONFIG, window.els, window.shadow, data || {});
        }
      },
      toggleTTS: () => {
        if (window.MityaMedia) return window.MityaMedia.toggleTTS();
        return false;
      },
      startScenario: (id) => startScenario(id),
      stopPresentation: () => stopPresentation(),
      toggleVoiceAvatar: (show) => toggleVoiceAvatar(show),
      say: async (text, duration) => {
        if (!text) return;
        if (window.MityaMedia) {
          window.MityaMedia.config.tts = true;
          window.MityaMedia.speak(text);
          await addMessage(text, 'bot', { typewriter: true, charDelay: 40 }, CONFIG, window.els);
        }
      }
    };

    if (localStorage.getItem(`mitya_chat_open_${getWidgetStorageScope(CONFIG)}`) === 'true' || CONFIG.theme?.window_auto_open === true) {
      window.Mitya.open();
    } else {
      loadChatHistory(CONFIG, window.chatToken, window.els, (txt, r, opt) => addMessage(txt, r, opt, CONFIG, window.els), scrollToBottom, generateFingerprint, setCookie);
    }

    if (!window.historyUpdateInterval) {
      window.historyUpdateInterval = setInterval(() => {
        loadChatHistory(CONFIG, window.chatToken, window.els, (txt, r, opt) => addMessage(txt, r, opt, CONFIG, window.els), scrollToBottom, generateFingerprint, setCookie);
      }, 3000);
    }
  }

  async function loadConfig() {
    try {
      const assistantQuery = CONFIG.assistantId ? `&assistant_id=${encodeURIComponent(CONFIG.assistantId)}` : '';
      const res = await fetch(`${CONFIG.serverUrl}/api/chat/config?client_id=${CONFIG.clientId}${assistantQuery}&t=${Date.now()}`);
      if (res.status === 403) return false;
      
      if (res.ok) {
        const data = await res.json();
        Object.assign(CONFIG, data);
        CONFIG.assistantId = data.assistant_id || CONFIG.assistantId || 'main';
        if (data.session_id) {
          window.sessionId = data.session_id;
          localStorage.setItem(`mitya_session_id_${getWidgetStorageScope(CONFIG)}`, window.sessionId);
        }
        if (window.els && window.els.widget) {
          applyTheme(CONFIG.theme, CONFIG, window.els, window.shadow);
          updateAttachBtnVisibility(window.els, CONFIG);
        }
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[Chat] Failed to load remote config');
      return false;
    }
  }

  function handleSendMessage(manualText) {
    const isBotBusy = window.els.window.classList.contains('active-typing') || 
                     (window.MityaMedia && window.MityaMedia.isSpeaking);

    if (isBotBusy && !manualText) {
      window.isStopRequested = true;
      if (window.typingAbortController) window.typingAbortController.abort();
      if (window.MityaMedia) window.MityaMedia.stopSpeaking();
      return;
    }

    window.isStopRequested = false;
    const state = { isStopRequested: window.isStopRequested };
    return sendMessage(manualText, CONFIG, window.chatToken, window.sessionId, window.els, window.attachedFiles, state, {
      addMessage: (t, r, o) => addMessage(t, r, o, CONFIG, window.els),
      showTyping: (s) => showTyping(s, window.els),
      scrollToBottom: (e) => scrollToBottom(e),
      updateMicState: () => updateMicState(window.els, CONFIG, window.attachedFiles),
      onAbortController: (ac) => { window.typingAbortController = ac; },
      onFilesClear: () => {
        window.attachedFiles = [];
        renderAttachedFiles(window.attachedFiles, window.els);
        updateAttachBtnVisibility(window.els, CONFIG);
      }
    });
  }

  function saveCurrentDesign() {
    const theme = CONFIG.theme || {};
    fetch(`${CONFIG.serverUrl}/api/chat/config/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CONFIG.clientId,
        token: window.chatToken,
        theme: theme
      })
    }).then(res => {
      if (res.ok) showChatAlert('Дизайн сохранен!', 'success');
    });
  }

  window.handleSystemCommand = (command, text) => {
    console.log('[ChatWidget] System command received:', command, 'text:', text);
    
    if (command === 'hide_widget_permanently') {
      window.Mitya.applyTheme({ widget_enabled: false }, { is_local_update: true });
      showChatAlert('Виджет отключен. Чтобы вернуть его, обновите настройки в панели управления.', 'info');
      setTimeout(() => window.Mitya.close(), 1000);
      return;
    }
    
    if (command === 'reset_design') {
      window.Mitya.close();
      return;
    }

    handleSendMessage(text || command);
  };

  function setupEventListeners() {
    window.els.toggleBtn.onclick = () => {
      if (window.isDraggingIcon) return;
      window.Mitya.toggle();
    };
    window.els.closeBtn.onclick = () => window.Mitya.close();
    window.els.expandBtn.onclick = () => toggleExpand(window.els, CONFIG);
    
    window.els.input.onfocus = () => updateMicState(window.els, CONFIG, window.attachedFiles);
    window.els.window.onclick = (e) => {
      if (e.target.id !== 'chat-input') {
        updateMicState(window.els, CONFIG, window.attachedFiles);
      }
    };
    
    window.els.sendBtn.onclick = () => {
      const isListening = window.MityaMedia && window.MityaMedia.isListening;
      const hasText = window.els.input.value.trim().length > 0;
      const isBotBusy = window.els.window.classList.contains('active-typing') || 
                       window.isPrinting || 
                       window.isStreamingActive;
      
      if (isBotBusy) {
        const lastBotMsg = window.els.messagesContainer.querySelector('.message.bot:last-child .message-text');
        const currentTextToSave = lastBotMsg ? lastBotMsg.innerText : '';
        window.isStopRequested = true; 
        window.isPrinting = false; 
        window.isStreamingActive = false;
        if (window.typingAbortController) window.typingAbortController.abort();
        
        const serverUrl = CONFIG.serverUrl || '';
        if (window.chatToken && currentTextToSave) {
          fetch(`${serverUrl}/api/chat/stop`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({
              token: window.chatToken,
              client_id: CONFIG.clientId,
              last_text: currentTextToSave
            })
          }).catch(() => {});
        }
        window.els.window.classList.remove('active-typing', 'is-typing-stream');
        if (window.MityaWidget && window.MityaWidget.showTyping) {
            window.MityaWidget.showTyping(false, window.els);
        }
        updateMicState(window.els, CONFIG, window.attachedFiles);
        return;
      }

      if (isListening && !hasText) {
        window.MityaMedia.stopListening();
      } else if (!hasText && window.MityaMedia) {
        window.MityaMedia.startListening();
      } else {
        handleSendMessage();
      }
    };

    window.els.input.onfocus = () => {
      if (window.MityaMedia && window.MityaMedia.isListening) window.MityaMedia.stopListening();
    };

    window.els.input.onclick = () => {
      if (window.MityaMedia && window.MityaMedia.isListening) window.MityaMedia.stopListening();
    };

    window.els.input.oninput = () => {
      updateMicState(window.els, CONFIG, window.attachedFiles);
      
      if (window.els.input.value.trim().length > 0) {
        window.els.window.classList.remove('avatar-active');
        if (window.els.avatarOverlay) {
          window.els.avatarOverlay.style.opacity = '0';
          setTimeout(() => {
            if (window.els.avatarOverlay.style.opacity === '0') window.els.avatarOverlay.style.display = 'none';
          }, 500);
        }
      }
    };

    window.els.input.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        window.els.sendBtn.click();
      }
    };

    window.els.attachBtn.onclick = () => window.els.fileInput.click();
    window.els.fileInput.onchange = (e) => {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;

      if (window.attachedFiles.length + files.length > MAX_FILES_COUNT) {
        showChatAlert(`Максимум ${MAX_FILES_COUNT} файла`);
        window.els.fileInput.value = '';
        return;
      }

      const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt', '.xls', '.xlsx', '.ppt', '.pptx', '.jpg', '.jpeg', '.png', '.webp', '.tiff', '.bmp'];
      
      files.forEach(file => {
        const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
          showChatAlert(`Формат ${ext} не поддерживается`);
          return;
        }
        if (file.size > MAX_FILE_SIZE) {
          showChatAlert(`Файл ${file.name} слишком большой (макс. 5МБ)`);
          return;
        }
        window.attachedFiles.push(file);
      });

      renderAttachedFiles(window.attachedFiles, window.els);
      updateAttachBtnVisibility(window.els, CONFIG);
      updateMicState(window.els, CONFIG, window.attachedFiles);
      e.target.value = '';
    };

    window.addEventListener('mitya:command', (e) => {
      handleSendMessage(e.detail);
    });

    window.addEventListener('resize', () => {
      updateWelcomeBubblePosition(window.els);
    });

    window.addEventListener('mitya-audio-end', () => {
      window.els.window.classList.remove('avatar-active');
    });

    window.addEventListener('message', (e) => {
      if (!e.data || typeof e.data !== 'object') return;
      
      if (e.data.type === 'mitya_navigate' && e.data.url) {
        window.location.href = e.data.url;
        return;
      }

      if (!window.Mitya) return;

      switch (e.data.type) {
        case 'mitya_open': window.Mitya.open(); break;
        case 'mitya_close': window.Mitya.close(); break;
        case 'show_test_buttons': window.Mitya.showTestButtons(e.data.show); break;
        case 'mitya_send': window.Mitya.sendMessage(e.data.text); break;
        case 'apply_theme':
          console.log('[Chat] Applying theme from parent window...');
          window.Mitya.applyTheme(e.data.theme, e.data.data);
          break;
        case 'apply_theme_from_bot':
          if (e.data.theme) {
            window.Mitya.applyTheme(e.data.theme, { is_local_update: true });
          }
          break;
        case 'show_alert':
          if (window.Mitya.showAlert) {
            window.Mitya.showAlert(e.data.text, e.data.alert_type || 'info', e.data.is_preview || false);
          }
          break;
        case 'close_alert':
          if (window.Mitya.closeAlert) {
            window.Mitya.closeAlert();
          }
          break;
      }
    });

    document.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('#chat-welcome-close');
      if (closeBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (window.els.welcome) {
          window.els.welcome.classList.remove('is-visible', 'show');
          sessionStorage.setItem(`mitya_welcome_closed_${getWidgetStorageScope(CONFIG)}`, 'true');
          setTimeout(() => { window.els.welcome.style.display = 'none'; }, 400);
        }
      }
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();