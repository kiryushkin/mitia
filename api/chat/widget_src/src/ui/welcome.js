/**
 * Обновляет позицию приветственного облака относительно кнопки.
 * ПОЛНАЯ КОПИЯ ИЗ ОРИГИНАЛА (строки 4240-4274).
 */
export function updateWelcomeBubblePosition(els) {
    if (!els.welcome || !els.toggleBtn) return;
    
    const btnRect = els.toggleBtn.getBoundingClientRect();
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    
    els.welcome.classList.remove('pos-top', 'pos-bottom', 'align-right', 'align-left');
    
    els.welcome.style.top = '';
    els.welcome.style.bottom = '';
    els.welcome.style.left = '';
    els.welcome.style.right = '';

    const distance = '15px';
    if (btnRect.top < 200) {
      els.welcome.classList.add('pos-bottom');
      els.welcome.style.top = `calc(100% + ${distance})`;
      els.welcome.style.bottom = 'auto';
    } else {
      els.welcome.classList.add('pos-top');
      els.welcome.style.bottom = `calc(100% + ${distance})`;
      els.welcome.style.top = 'auto';
    }
    
    if (btnRect.left > winW / 2) {
      els.welcome.classList.add('align-right');
      els.welcome.style.right = '0';
      els.welcome.style.left = 'auto';
    } else {
      els.welcome.classList.add('align-left');
      els.welcome.style.left = '0';
      els.welcome.style.right = 'auto';
    }
}

/**
 * Инициализирует и управляет показом приветственного облака.
 * ПОЛНАЯ КОПИЯ ИЗ ОРИГИНАЛА (строки 4279-4392).
 */
export function initWelcomeBubble(els, config, openChat) {
    if (window.__mitya_welcome_timer__) {
      clearTimeout(window.__mitya_welcome_timer__);
    }

    const isEnabled = (config.theme && config.theme.welcome_bubble_enabled !== undefined) ? config.theme.welcome_bubble_enabled : (config.welcomeBubbleEnabled !== false);
    
    if (!isEnabled) {
      if (els.welcome) {
        els.welcome.classList.remove('is-visible', 'show');
        els.welcome.style.display = 'none';
      }
      return;
    }

    if (!els.welcome) return;
    
    if (config.ignore_welcome_limits) {
      localStorage.removeItem('mitya_welcome_last_closed');
      sessionStorage.removeItem('mitya_welcome_show_count');
      console.log('[ChatWidget] Welcome limits reset');
    }

    const bubbleText = config.theme?.welcome_bubble_text || config.welcome_bubble_text || config.welcomeBubbleText || '';
    let textContainer = els.welcome.querySelector('.chat-welcome-text') || els.welcome.querySelector('span') || els.welcome;
    
    if (textContainer === els.welcome) {
      const closeBtn = els.welcome.querySelector('.chat-welcome-close');
      els.welcome.textContent = bubbleText;
      if (closeBtn) els.welcome.appendChild(closeBtn);
    } else {
      textContainer.textContent = bubbleText;
    }

    const delay = parseInt(config.theme?.welcome_trigger_delay_ms) || 20000;
    
    const showBubble = () => {
      const isChatOpen = els.window && (els.window.classList.contains('is-active') || els.window.classList.contains('active'));
      
      const currentRetryCount = parseInt(config.theme?.welcome_retry_count || config.welcome_retry_count || 0);
      const currentRetryDelaySec = parseInt(config.theme?.welcome_retry_delay_sec || config.welcome_retry_delay_sec || 0);

      const lastClosed = localStorage.getItem('mitya_welcome_last_closed');
      const showCount = parseInt(sessionStorage.getItem('mitya_welcome_show_count') || '0');

      if (currentRetryCount > 0 && showCount >= currentRetryCount) {
        console.log('[ChatWidget] Welcome bubble limit reached:', showCount, '/', currentRetryCount);
        return;
      }

      if (lastClosed && currentRetryDelaySec > 0) {
        const secondsSinceClosed = (Date.now() - parseInt(lastClosed)) / 1000;
        if (secondsSinceClosed < currentRetryDelaySec) {
          console.log('[ChatWidget] Welcome bubble retry delay not met:', Math.round(currentRetryDelaySec - secondsSinceClosed), 's left');
          const timeLeft = (currentRetryDelaySec - secondsSinceClosed) * 1000;
          if (window.__mitya_welcome_timer__) clearTimeout(window.__mitya_welcome_timer__);
          window.__mitya_welcome_timer__ = setTimeout(showBubble, Math.max(1000, timeLeft));
          return;
        }
      }

      if (!isChatOpen) {
        els.welcome.style.display = 'block';
        updateWelcomeBubblePosition(els);
        setTimeout(() => {
          els.welcome.classList.add('show', 'is-visible');
          const newCount = showCount + 1;
          sessionStorage.setItem('mitya_welcome_show_count', newCount.toString());
          console.log('[ChatWidget] Welcome bubble SHOWING. Count now:', newCount, 'Limit:', currentRetryCount || '∞');
        }, 50);
      }
    };

    window.__mitya_welcome_timer__ = setTimeout(showBubble, delay);

    if (els.welcome && !els.welcome.__has_click_handler__) {
      els.welcome.addEventListener('click', (e) => {
        const closeBtn = e.target.closest('.chat-welcome-close');
        if (closeBtn) {
          e.preventDefault();
          e.stopPropagation();
          localStorage.setItem('mitya_welcome_last_closed', Date.now().toString());
          els.welcome.classList.remove('is-visible', 'show');
          
          // Уведомляем админку о закрытии облака (для выключения тумблера предпросмотра)
          window.parent.postMessage({ type: 'mitya_hide_welcome_preview' }, '*');

          setTimeout(() => { 
            els.welcome.style.display = 'none'; 
            
            const retryDelay = parseInt(config.theme?.welcome_retry_delay_sec || config.welcome_retry_delay_sec) || 0;
            if (retryDelay > 0) {
              console.log('[ChatWidget] Planning next show in', retryDelay, 's');
              if (window.__mitya_welcome_timer__) clearTimeout(window.__mitya_welcome_timer__);
              window.__mitya_welcome_timer__ = setTimeout(showBubble, retryDelay * 1000);
            }
          }, 400);
        }
      });
      els.welcome.__has_click_handler__ = true;
    }

    els.welcome.onclick = (e) => {
      if (e.target.closest('.chat-welcome-close')) return;
      
      const action = config.theme?.welcome_click_action || 'chat';
      let url = config.theme?.welcome_click_url || config.theme?.welcome_link_url;

      if (action === 'link' && url) {
        // Если ссылка не начинается с протокола, добавляем https://
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = 'https://' + url;
        }
        
        const targetBlank = config.theme?.welcome_click_target_blank !== false;
        if (targetBlank) {
          window.open(url, '_blank');
        } else {
          window.location.href = url;
        }
      } else {
        openChat();
      }
    };
}

export function showWelcome(els) {
    if (!els.welcome) return;
    els.welcome.style.display = 'block';
    updateWelcomeBubblePosition(els);
    setTimeout(() => {
        els.welcome.classList.add('show', 'is-visible');
    }, 50);
}

export function hideWelcome(els) {
    if (!els.welcome) return;
    els.welcome.classList.remove('is-visible', 'show');
    setTimeout(() => {
        els.welcome.style.display = 'none';
    }, 400);
}
