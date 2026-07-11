
  /**
   * ==========================================================================
   * [SECTION] UTILS & HELPERS
   * Вспомогательные функции для форматирования, валидации и работы с DOM.
   * ==========================================================================
   */

  /**
   * Блокировка скролла страницы.
   */
  export const lockBodyScroll = () => {
    document.body.style.overflow = 'hidden';
    document.body.style.height = '100vh';
    document.body.style.touchAction = 'none';
  };

  /**
   * Разблокировка скролла страницы.
   */
  export const unlockBodyScroll = () => {
    document.body.style.overflow = '';
    document.body.style.height = '';
    document.body.style.touchAction = '';
  };

  /**
   * Форматирует числовые значения в единицы измерения CSS (px, %, vh, vw).
   */
  export const formatDim = (val, unit = 'px') => {
    if (val === 'auto' || val === undefined || val === null) return 'auto';
    const s = String(val);
    
    if (unit === 'pos%_x' || unit === 'pos%_y') {
      let num = parseFloat(s);
      if (isNaN(num)) num = 95;
      const size = 64; 
      const isX = unit === 'pos%_x';
      const viewSize = isX ? (window.innerWidth || document.documentElement.clientWidth) : (window.innerHeight || document.documentElement.clientHeight);
      const safeArea = Math.max(0, viewSize - size);
      let px = (num * safeArea / 100);
      px = Math.max(0, Math.min(px, safeArea));
      return px + 'px';
    }

    if (s.includes('px') || s.includes('%') || s.includes('vh') || s.includes('vw')) return s;
    return s + unit;
  };

  /**
   * Быстрый поиск элемента внутри Shadow DOM или документа.
   */
  export const $ = (sel, root = (window.shadow || document)) => root.querySelector(sel);

  /**
   * Экранирует HTML-символы.
   */
  export const escapeHtml = (s) => String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#39;');

  /**
   * Проверяет, является ли текущее устройство мобильным.
   */
  export const isMobile = () =>
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    (window.innerWidth <= 768);

  /**
   * Показывает системное уведомление внутри чата.
   */
  export const showChatAlert = (text, type = 'error', isPreview = false) => {
    const chatWindow = window.els?.window;
    if (!chatWindow) return;
    
    const oldAlert = chatWindow.querySelector('.chat-alert');
    if (oldAlert) oldAlert.remove();

    const t = window.currentThemeData || {};
    const bgOpacity = t.alert_bg_opacity !== undefined ? (parseFloat(t.alert_bg_opacity) > 1 ? parseFloat(t.alert_bg_opacity) / 100 : parseFloat(t.alert_bg_opacity)) : 0.85;
    const bgColor = t.alert_bg_color || '#000000';
    const textColor = t.alert_text_color || '#ffffff';
    const textOpacity = t.alert_text_opacity !== undefined ? (parseFloat(t.alert_text_opacity) > 1 ? parseFloat(t.alert_text_opacity) / 100 : parseFloat(t.alert_text_opacity)) : 1;
    const fontSize = formatDim(t.alert_font_size || '18px', 'px');
    const fontWeight = t.alert_font_weight || '500';
    const fontFamily = t.alert_font_family || 'inherit';
    const blur = formatDim(t.alert_bg_blur || '10px', 'px');

    const alertDiv = document.createElement('div');
    alertDiv.className = `chat-alert ${type} ${isPreview ? 'is-preview' : ''}`;
    alertDiv.innerHTML = `
      <div class="chat-alert-content">
        <span class="chat-alert-text">${text}</span>
      </div>
    `;
    
    // Основные стили теперь в CSS, здесь только динамические перекрытия если нужно
    alertDiv.style.cssText = `
      position: absolute;
      inset: 0;
      background: var(--chat-alert-bg-rgba, ${hexToRgba(bgColor, bgOpacity)});
      color: var(--chat-alert-text-rgba, ${hexToRgba(textColor, textOpacity)});
      z-index: 10000;
      font-size: var(--chat-alert-font-size, ${fontSize});
      font-family: var(--chat-alert-font-family, ${fontFamily}) !important;
      font-weight: var(--chat-alert-font-weight, ${fontWeight});
      line-height: 1.25;

      backdrop-filter: blur(var(--chat-alert-bg-blur, ${blur})) !important;
      -webkit-backdrop-filter: blur(var(--chat-alert-bg-blur, ${blur})) !important;
      opacity: 0;
      transform: translateZ(0);
      -webkit-transform: translateZ(0);
    `;

    chatWindow.appendChild(alertDiv);

    const headerButtons = chatWindow.querySelector('.chat-header-buttons');
    const headerLogo = chatWindow.querySelector('.chat-header-logo');
    const footer = chatWindow.querySelector('.footer-chat');
    const messages = chatWindow.querySelector('.chat-messages');

    if (headerButtons) headerButtons.style.pointerEvents = 'none';
    if (headerLogo) headerLogo.style.pointerEvents = 'none';
    if (footer) footer.style.pointerEvents = 'none';
    if (messages) messages.style.pointerEvents = 'none';

    requestAnimationFrame(() => {
      alertDiv.style.opacity = '1';
    });

    const closeAlert = () => {
      if (!alertDiv.parentNode) return;
      alertDiv.style.opacity = '0';
      if (headerButtons) headerButtons.style.pointerEvents = 'auto';
      if (headerLogo) headerLogo.style.pointerEvents = 'auto';
      if (footer) footer.style.pointerEvents = 'auto';
      if (messages) messages.style.pointerEvents = 'auto';

      setTimeout(() => {
        if (alertDiv.parentNode) alertDiv.remove();
      }, 300);
    };

    if (window.MityaWidget) window.MityaWidget.closeAlert = closeAlert;

    if (!isPreview) {
      alertDiv.onclick = closeAlert;
      setTimeout(closeAlert, 3000);
    } else {
      alertDiv.style.pointerEvents = 'none';
      alertDiv.style.cursor = 'default';
    }
  };

  /**
   * Преобразует HEX цвет в RGBA.
   */
  export const hexToRgba = (hex, opacity) => {
    if (!hex || hex === 'transparent') return 'transparent';
    let op = parseFloat(opacity);
    if (isNaN(op)) op = 1;
    if (op > 1) op = op / 100;
    let r = 0, g = 0, b = 0;
    const cleanHex = String(hex).replace('#', '');
    if (cleanHex.length === 3) {
      r = parseInt(cleanHex[0] + cleanHex[0], 16);
      g = parseInt(cleanHex[1] + cleanHex[1], 16);
      b = parseInt(cleanHex[2] + cleanHex[2], 16);
    } else if (cleanHex.length === 6) {
      r = parseInt(cleanHex.substring(0, 2), 16);
      g = parseInt(cleanHex.substring(2, 4), 16);
      b = parseInt(cleanHex.substring(4, 6), 16);
    } else if (String(hex).startsWith('rgba')) {
      return hex.replace(/[\d.]+\)$/g, op + ')');
    } else if (String(hex).startsWith('rgb')) {
      return hex.replace('rgb', 'rgba').replace(')', ', ' + op + ')');
    } else { return hex; }
    return `rgba(${r}, ${g}, ${b}, ${op})`;
  };

  /**
   * Открывает изображение в полноэкранном режиме (Lightbox).
   */
  export const openImageLightbox = (src) => {
    const root = window.shadow || document;
    const allImages = Array.from(root.querySelectorAll('.chat-inline-image, .message-image-preview'));
    let currentIndex = allImages.findIndex(img => img.src === src);
    if (currentIndex === -1) currentIndex = 0;

    const overlay = document.createElement('div');
    overlay.className = 'chat-lightbox-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.95); z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      animation: chatFadeIn 0.3s ease-out;
      backdrop-filter: blur(15px);
      user-select: none;
    `;

    const updateImage = (index) => {
      const currentImg = allImages[index];
      if (!currentImg) return;

      const imgUrl = currentImg.src;
      const fileName = imgUrl.split('/').pop().split('?')[0] || 'image.webp';

      overlay.innerHTML = `
        <div class="lightbox-header" style="position:absolute; top:0; left:0; width:100%; padding:20px; display:flex; justify-content:flex-end; gap:15px; z-index:10;">
          <a href="${imgUrl}" download="${fileName}" class="lightbox-btn" title="Скачать" style="color:white; background:rgba(255,255,255,0.1); width:40px; height:40px; display:flex; align-items:center; justify-content:center; border-radius:50%; transition:0.2s;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </a>
          <button class="lightbox-btn close-btn" title="Закрыть" style="color:white; background:rgba(255,255,255,0.1); border:none; width:40px; height:40px; display:flex; align-items:center; justify-content:center; border-radius:50%; cursor:pointer; transition:0.2s;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        ${allImages.length > 1 ? `
          <button class="nav-btn prev-btn" style="position:absolute; left:20px; color:white; background:rgba(255,255,255,0.1); border:none; width:50px; height:50px; display:flex; align-items:center; justify-content:center; border-radius:50%; cursor:pointer; z-index:10;">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <button class="nav-btn next-btn" style="position:absolute; right:20px; color:white; background:rgba(255,255,255,0.1); border:none; width:50px; height:50px; display:flex; align-items:center; justify-content:center; border-radius:50%; cursor:pointer; z-index:10;">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
        ` : ''}

        <img src="${imgUrl}" style="max-width:90%; max-height:85%; object-fit:contain; border-radius:4px; box-shadow:0 0 50px rgba(0,0,0,0.5); animation:chatScaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);">

        <div class="lightbox-counter" style="position:absolute; bottom:20px; color:white; font-size:14px; opacity:0.7;">
          ${index + 1} / ${allImages.length}
        </div>
      `;

      overlay.querySelector('.close-btn').onclick = close;
      const downloadBtn = overlay.querySelector('a[download]');
      if (downloadBtn) {
        downloadBtn.onclick = (e) => e.stopPropagation();
      }
      if (allImages.length > 1) {
        overlay.querySelector('.prev-btn').onclick = (e) => { e.stopPropagation(); navigate(-1); };
        overlay.querySelector('.next-btn').onclick = (e) => { e.stopPropagation(); navigate(1); };
      }

      overlay.querySelectorAll('.lightbox-btn, .nav-btn').forEach(btn => {
        btn.onmouseenter = () => btn.style.background = 'rgba(255,255,255,0.2)';
        btn.onmouseleave = () => btn.style.background = 'rgba(255,255,255,0.1)';
      });
    };

    const navigate = (step) => {
      currentIndex = (currentIndex + step + allImages.length) % allImages.length;
      updateImage(currentIndex);
    };

    const close = () => {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.3s ease';
      setTimeout(() => {
        overlay.remove();
        unlockBodyScroll();
      }, 300);
    };

    overlay.onclick = (e) => { if (e.target.tagName !== 'IMG' && e.target.tagName !== 'SVG') close(); };

    const keyHandler = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') navigate(-1);
      if (e.key === 'ArrowRight') navigate(1);
    };
    window.addEventListener('keydown', keyHandler, { once: true });

    updateImage(currentIndex);
    document.body.appendChild(overlay);
    lockBodyScroll();
  };

  // Пробрасываем функции в глобальный объект для совместимости
  if (window.MityaWidget) {
    window.MityaWidget.openLightbox = openImageLightbox;
    window.MityaWidget.lockBodyScroll = lockBodyScroll;
    window.MityaWidget.unlockBodyScroll = unlockBodyScroll;
  }
