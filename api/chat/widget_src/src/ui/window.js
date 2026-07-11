import { isMobile, formatDim } from '../utils/dom';

  // ─── Вспомогательные функции блокировки скролла ────────────

  function lockBodyScroll() {
    document.body.style.overflow = 'hidden';
    document.body.style.height = '100vh';
    document.body.style.touchAction = 'none';
  }

  function unlockBodyScroll() {
    document.body.style.overflow = '';
    document.body.style.height = '';
    document.body.style.touchAction = '';
  }

  // ─── Позиционирование окна чата ───────────────────────────

  /**
   * Рассчитывает и устанавливает позицию окна чата на экране.
   * ПОЛНАЯ КОПИЯ ИЗ ОРИГИНАЛА (строки 2330-2386).
   */
  export function positionChatWindow(els, config, data = {}) {
    if (isMobile() || els.window.classList.contains('expanded')) {
      Object.assign(els.window.style, {
        top: '0px', left: '0px', bottom: '0px', right: '0px',
        width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%',
        margin: '0px', borderRadius: '0px'
      });
      return;
    }

    const winW = window.innerWidth;
    const winH = window.innerHeight;
    
    const wLeftPct = parseFloat(config.theme.window_left !== undefined ? config.theme.window_left : (config.theme.widget_left || 99));
    const wTopPct = parseFloat(config.theme.window_top !== undefined ? config.theme.window_top : (config.theme.widget_top || 98));
    
    const root = window.shadow ? (window.shadow.querySelector('.chat-widget') || window.shadow.querySelector('#chat-widget')) : document.documentElement;
    
    let targetW, targetH;
    if (window.mitya_session_rect && !data.force_position) {
        targetW = parseFloat(window.mitya_session_rect.width);
        targetH = parseFloat(window.mitya_session_rect.height);
    } else {
        // Если мы в режиме force_position, сбрасываем сессионные данные, чтобы ползунки работали
        if (data.force_position) window.mitya_session_rect = null;
        
        // Используем getPropertyValue напрямую из root, где хранятся актуальные переменные темы
        const styleW = root.style.getPropertyValue('--chat-window-width') || getComputedStyle(root).getPropertyValue('--chat-window-width');
        const styleH = root.style.getPropertyValue('--chat-window-height') || getComputedStyle(root).getPropertyValue('--chat-window-height');
        
        if (styleW.includes('px')) targetW = parseFloat(styleW);
        else targetW = (parseFloat(styleW || 35) / 100) * winW;

        if (styleH.includes('px')) targetH = parseFloat(styleH);
        else if (styleH.includes('vh')) targetH = (parseFloat(styleH) / 100) * winH;
        else targetH = (parseFloat(styleH || 80) / 100) * winH;
    }

    let left, top;

    if (window.mitya_session_rect && !data.force_position) {
        left = parseFloat(window.mitya_session_rect.left);
        top = parseFloat(window.mitya_session_rect.top);
        Object.assign(els.window.style, {
            right: 'auto',
            bottom: 'auto',
            left: left + 'px',
            top: top + 'px'
        });
    } else {
        // ПЛАВНОЕ ПОЗИЦИОНИРОВАНИЕ БЕЗ ПРЫЖКОВ
        // Используем расчет в пикселях на основе процентов от свободного пространства
        const availableW = winW - targetW;
        const availableH = winH - targetH;

        const leftPx = (wLeftPct / 100) * availableW;
        const topPx = (wTopPct / 100) * availableH;

        Object.assign(els.window.style, {
            left: leftPx + 'px',
            top: topPx + 'px',
            right: 'auto',
            bottom: 'auto'
        });
    }

    els.window.style.margin = '0';
    els.window.style.transformOrigin = (wLeftPct > 50 ? 'right' : 'left') + ' ' + (wTopPct > 50 ? 'bottom' : 'top');
  }

  // ─── Прокрутка к низу ─────────────────────────────────────

  export function scrollToBottom(els) {
    const e = els || window.els;
    if (!e) return;
    
    // Пробуем прокрутить оба контейнера, так как в зависимости от CSS скролл может быть на любом из них
    const containers = [e.messages, e.messagesContainer];
    
    containers.forEach(container => {
      if (container) {
        container.scrollTop = container.scrollHeight;
        container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });
      }
    });
  }

  // ─── Развернуть / свернуть окно ───────────────────────────

  export function toggleExpand(els, config) {
    const isExpanded = els.window.classList.contains('expanded');
    const header = els.window.querySelector('.chat-header');

    if (isExpanded) {
      els.window.classList.remove('expanded');
      localStorage.setItem('mitya_chat_expanded', 'false');
      
      // Восстанавливаем стили из темы
      const themeRadius = config.theme?.window_radius || '32px';
      const themeBorderWidth = config.theme?.window_border_width || '1px';
      
      Object.assign(els.window.style, { 
        width: '', 
        height: '', 
        top: '', 
        left: '', 
        bottom: '', 
        right: '', 
        borderRadius: formatDim(themeRadius, 'px'),
        borderWidth: formatDim(themeBorderWidth, 'px')
      });
      
      if (header) {
        header.style.cursor = (config.theme?.window_draggable !== false && !isMobile()) ? 'move' : 'default';
      }

      if (window.preExpandedStyles) {
        Object.assign(els.window.style, {
          position: 'fixed', 
          top: window.preExpandedStyles.top, 
          left: window.preExpandedStyles.left,
          width: window.preExpandedStyles.width, 
          height: window.preExpandedStyles.height,
          bottom: 'auto', 
          right: 'auto', 
          borderRadius: window.preExpandedStyles.borderRadius,
          borderWidth: window.preExpandedStyles.borderWidth || formatDim(themeBorderWidth, 'px')
        });
      } else {
        positionChatWindow(els, config);
      }
      unlockBodyScroll();
    } else {
      localStorage.setItem('mitya_chat_expanded', 'true');
      const rect = els.window.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(els.window);
      
      window.preExpandedStyles = { 
        top: rect.top + 'px', 
        left: rect.left + 'px', 
        width: rect.width + 'px', 
        height: rect.height + 'px', 
        borderRadius: computedStyle.borderRadius,
        borderWidth: computedStyle.borderWidth
      };
      
      els.window.classList.add('expanded');
      Object.assign(els.window.style, { 
        top: '0px', 
        left: '0px', 
        width: '100vw', 
        height: '100vh', 
        bottom: '0px', 
        right: '0px', 
        borderRadius: '0px',
        borderWidth: '0px'
      });
      
      if (header) {
        header.style.cursor = 'default';
      }

      lockBodyScroll();
    }
  }

  // ─── Открытие чата ────────────────────────────────────────

  export async function openChat(els, config, loadHistoryFn, chatToken) {
    const expandDefault = config.theme?.window_expand_default === true;
    const isExpanded = expandDefault || localStorage.getItem('mitya_chat_expanded') === 'true';
    const header = els.window.querySelector('.chat-header');

    if (isMobile() || isExpanded) {
      els.window.classList.add('expanded');
      Object.assign(els.window.style, { top: '0px', left: '0px', width: '100vw', height: '100vh', bottom: '0px', right: '0px', borderRadius: '0px' });
      if (header) header.style.cursor = 'default';
      lockBodyScroll();
    } else {
      if (window.mitya_session_rect) {
          Object.assign(els.window.style, { width: window.mitya_session_rect.width, height: window.mitya_session_rect.height, top: window.mitya_session_rect.top, left: window.mitya_session_rect.left, right: 'auto', bottom: 'auto', position: 'fixed', display: 'flex' });
      } else {
          positionChatWindow(els, config);
      }
      if (header) {
        header.style.cursor = (config.theme?.window_draggable !== false && !isMobile()) ? 'move' : 'default';
      }
    }
    els.window.classList.add('is-active');
    els.window.style.display = 'flex';
    els.widget.classList.add('is-open', 'chat-state-opened');
    const pulse = document.querySelector('#chat-widget .chat-button-pulse');
    if (pulse) pulse.style.opacity = '0';
    els.toggleBtn.style.display = 'none';
    if (els.welcome) { els.welcome.style.display = 'none'; els.welcome.classList.remove('is-visible', 'show'); }
    localStorage.setItem('mitya_chat_open', 'true');
    
    // Загружаем историю или просто прокручиваем, если она уже есть
    const realMessages = Array.from(els.messagesContainer.children).filter(msg => msg.id !== 'mitya-test-bot-preview');
    if (realMessages.length === 0) {
        await loadHistoryFn(config, chatToken, els);
    } else {
        setTimeout(() => scrollToBottom(els), 50);
    }
    
    setTimeout(() => { if (els.input) els.input.focus(); }, 350);
  }

  export function closeChat(els) {
    const e = els || window.els;
    if (window.MityaMedia) window.MityaMedia.stopSpeaking();
    e.window.classList.remove('is-active', 'expanded');
    e.window.style.display = 'none';
    e.widget.classList.remove('is-open', 'chat-state-opened');
    if (window.historyUpdateInterval) { clearInterval(window.historyUpdateInterval); window.historyUpdateInterval = null; }
    e.toggleBtn.style.display = 'flex';
    e.toggleBtn.style.opacity = '1';
    const pulse = document.querySelector('#chat-widget .chat-button-pulse');
    if (pulse) pulse.style.opacity = '1';
    if (e.welcome && sessionStorage.getItem('mitya_welcome_closed') !== 'true') e.welcome.style.display = 'block';
    localStorage.setItem('mitya_chat_open', 'false');
    unlockBodyScroll();
  }

  export function toggleChat(els, config, loadHistoryFn, chatToken) {
    els.window.classList.contains('is-active') ? closeChat(els) : openChat(els, config, loadHistoryFn, chatToken);
  }

  export function toggleVoiceAvatar(show) {
    if (!window.els.avatarOverlay) return;
    const isActive = show !== undefined ? show : !window.els.avatarOverlay.classList.contains('is-active');
    if (isActive) {
      window.els.avatarOverlay.style.display = 'flex';
      setTimeout(() => { window.els.avatarOverlay.style.opacity = '1'; window.els.window.classList.add('avatar-active'); }, 10);
    } else {
      window.els.avatarOverlay.style.opacity = '0'; window.els.window.classList.remove('avatar-active');
      setTimeout(() => { if (window.els.avatarOverlay.style.opacity === '0') window.els.avatarOverlay.style.display = 'none'; }, 500);
    }
  }

  export function stopPresentation() {
    window.isPresentationActive = window.presentationModeActive = false;
    document.body.classList.remove('presentation-mode');
    const overlay = document.getElementById('chat-presentation-overlay');
    if (overlay) overlay.remove();
    if (window.MityaMedia) window.MityaMedia.stopSpeaking();
    window.dispatchEvent(new CustomEvent('mitya-presentation-stopped'));
  }

  export async function startScenario(scenarioId) {
    if (!window.els.window.classList.contains('is-active')) await window.Mitya.openChat();
    if (window.Mitya?.sendMessage) window.Mitya.sendMessage('[scenario]:' + scenarioId);
  }
