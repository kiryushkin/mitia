import { isMobile, formatDim } from '../utils/dom';

/**
 * Инициализирует логику перетаскивания и изменения размера.
 */
export function initDraggable(els, config, updateWelcomeBubblePosition) {
    if (!els.toggleBtn) return;

    const resizers = els.window.querySelectorAll('.chat-resizer');
    let isResizing = false;
    let currentHandle = null;
    let startX, startY, startWidth, startHeight, startLeft, startTop;
    let lastPosSentTime = 0;

    resizers.forEach(resizer => {
      resizer.onmousedown = (e) => {
        if (isMobile()) return;
        if (config.theme?.window_resizable === false) return;
        e.preventDefault();
        e.stopPropagation();
        
        // НЕ фиксируем стили сразу при нажатии!
        // Только запоминаем начальные данные
        const rect = els.window.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        startWidth = rect.width;
        startHeight = rect.height;
        startTop = rect.top;
        startLeft = rect.left;
        
        isResizing = false; // Пока еще не ресайзим
        
        const type = resizer.className.split(' ').find(c => c.startsWith('resizer-'));
        currentHandle = {
            isRight: type === 'resizer-r' || type === 'resizer-tr' || type === 'resizer-br',
            isLeft: type === 'resizer-l' || type === 'resizer-tl' || type === 'resizer-bl',
            isTop: type === 'resizer-t' || type === 'resizer-tl' || type === 'resizer-tr',
            isBottom: type === 'resizer-b' || type === 'resizer-bl' || type === 'resizer-br'
        };

        const onMouseMove = (e) => {
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;

          // Активируем ресайз только после преодоления порога в 5 пикселей
          if (!isResizing) {
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
              isResizing = true;
              document.body.classList.add('is-resizing');
              els.window.style.transition = 'none';
              
              // ТОЛЬКО ТЕПЕРЬ фиксируем стили в пикселях
              Object.assign(els.window.style, {
                left: startLeft + 'px',
                top: startTop + 'px',
                width: startWidth + 'px',
                height: startHeight + 'px',
                right: 'auto',
                bottom: 'auto',
                margin: '0'
              });
            } else {
              return;
            }
          }
          
          const winW = window.innerWidth;
          const winH = window.innerHeight;

          let newWidth = startWidth;
          let newHeight = startHeight;
          let newLeft = startLeft;
          let newTop = startTop;

          // Горизонтальная ось
          if (currentHandle.isLeft) {
            const requestedWidth = startWidth - dx;
            if (requestedWidth > 300) {
              const requestedLeft = startLeft + dx;
              if (requestedLeft >= 0) {
                newWidth = requestedWidth;
                newLeft = requestedLeft;
              } else {
                newWidth = startLeft + startWidth;
                newLeft = 0;
              }
            } else {
              newWidth = 300;
              newLeft = startLeft + (startWidth - 300);
            }
          } else if (currentHandle.isRight) {
            newWidth = Math.max(300, startWidth + dx);
            if (startLeft + newWidth > winW) newWidth = winW - startLeft;
            newLeft = startLeft; // Фиксируем левый край
          } else {
            newLeft = startLeft; // Если не тянем по горизонтали, фиксируем X
          }

          // Вертикальная ось
          if (currentHandle.isTop) {
            const requestedHeight = startHeight - dy;
            if (requestedHeight > 200) {
              const requestedTop = startTop + dy;
              if (requestedTop >= 0) {
                newHeight = requestedHeight;
                newTop = requestedTop;
              } else {
                newHeight = startTop + startHeight;
                newTop = 0;
              }
            } else {
              newHeight = 200;
              newTop = startTop + (startHeight - 200);
            }
          } else if (currentHandle.isBottom) {
            newHeight = Math.max(200, startHeight + dy);
            if (startTop + newHeight > winH) newHeight = winH - startTop;
            newTop = startTop; // Фиксируем верхний край
          } else {
            newTop = startTop; // Если не тянем по вертикали, фиксируем Y
          }

          // Применяем стили только если значения реально изменились
          if (newWidth !== parseFloat(els.window.style.width) || 
              newHeight !== parseFloat(els.window.style.height) ||
              newLeft !== parseFloat(els.window.style.left) ||
              newTop !== parseFloat(els.window.style.top)) {
            
            Object.assign(els.window.style, {
              width: newWidth + 'px',
              height: newHeight + 'px',
              left: newLeft + 'px',
              top: newTop + 'px',
              right: 'auto',
              bottom: 'auto',
              margin: '0'
            });
          }

          const now = Date.now();
          if (now - lastPosSentTime > 50) {
              if (newHeight >= winH - 10 || newWidth >= winW - 10) {
                  els.window.style.borderRadius = '0px';
                  els.window.style.borderWidth = '0px';
              } else {
                  const themeRadius = config.theme?.window_radius || '32px';
                  const themeBorderWidth = config.theme?.window_border_width || '1px';
                  els.window.style.borderRadius = formatDim(themeRadius, 'px');
                  els.window.style.borderWidth = formatDim(themeBorderWidth, 'px');
              }

              window.mitya_session_rect = {
                  width: newWidth + 'px',
                  height: newHeight + 'px',
                  top: newTop + 'px',
                  left: newLeft + 'px'
              };

              window.parent.postMessage({
                  type: 'mitya_update_position',
                  window_width_pct: Math.round((newWidth / winW) * 100),
                  window_height_pct: Math.round((newHeight / winH) * 100),
                  chat_left: (winW - newWidth) === 0 ? 0 : Math.round((newLeft / (winW - newWidth)) * 100),
                  chat_top: (winH - newHeight) === 0 ? 0 : Math.round((newTop / (winH - newHeight)) * 100)
              }, '*');
              lastPosSentTime = now;
          }
        };

        const onMouseUp = () => {
          isResizing = false;
          document.body.classList.remove('is-resizing');
          els.window.style.transition = '';
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      };
    });

    let isDraggingIcon = false;
    let iconDragStartX, iconDragStartY, iconInitialX, iconInitialY;

    const onIconMouseDown = (e) => {
      if (els.window.classList.contains('is-active')) return;
      if (config.theme?.widget_draggable === false) return;
      isDraggingIcon = false;
      const event = e.touches ? e.touches[0] : e;
      iconDragStartX = event.clientX;
      iconDragStartY = event.clientY;
      const rect = els.widgetContainer.getBoundingClientRect();
      iconInitialX = rect.left;
      iconInitialY = rect.top;
      document.addEventListener('mousemove', onIconMouseMove);
      document.addEventListener('mouseup', onIconMouseUp);
      document.addEventListener('touchmove', onIconMouseMove, { passive: false });
      document.addEventListener('touchend', onIconMouseUp);
    };

    const onIconMouseMove = (e) => {
      const event = e.touches ? e.touches[0] : e;
      const dx = event.clientX - iconDragStartX;
      const dy = event.clientY - iconDragStartY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        isDraggingIcon = true;
        let newX = iconInitialX + dx;
        let newY = iconInitialY + dy;
        const rect = els.widgetContainer.getBoundingClientRect();
        const maxX = document.documentElement.clientWidth - rect.width;
        const maxY = document.documentElement.clientHeight - rect.height;
        newX = Math.max(0, Math.min(newX, maxX));
        newY = Math.max(0, Math.min(newY, maxY));
        els.widgetContainer.style.left = newX + 'px';
        els.widgetContainer.style.top = newY + 'px';
        els.widgetContainer.style.bottom = 'auto';
        els.widgetContainer.style.right = 'auto';
        const now = Date.now();
        if (now - lastPosSentTime > 50) {
            const winW = window.innerWidth;
            const winH = window.innerHeight;
            window.parent.postMessage({
                type: 'mitya_update_position',
                widget_left_pct: Math.round((newX / (winW - rect.width)) * 100),
                widget_top_pct: Math.round((newY / (winH - rect.height)) * 100)
            }, '*');
            lastPosSentTime = now;
        }
        if (updateWelcomeBubblePosition) updateWelcomeBubblePosition();
        if (e.cancelable) e.preventDefault();
      }
    };

        const onIconMouseUp = () => {
      if (isDraggingIcon) {
        window.isDraggingIcon = true;
        const rect = els.widgetContainer.getBoundingClientRect();
        localStorage.setItem('mitya_widget_pos', JSON.stringify({ left: rect.left, top: rect.top }));

        const winW = window.innerWidth;
        const winH = window.innerHeight;
        const leftPct = Math.round((rect.left / (winW - rect.width)) * 100);
        const topPct = Math.round((rect.top / (winH - rect.height)) * 100);

        window.parent.postMessage({
            type: 'mitya_update_position',
            widget_left_pct: leftPct,
            widget_top_pct: topPct
        }, '*');
        
        setTimeout(() => { window.isDraggingIcon = false; }, 200);
      }
      document.removeEventListener('mousemove', onIconMouseMove);
      document.removeEventListener('mouseup', onIconMouseUp);
      document.removeEventListener('touchmove', onIconMouseMove);
      document.removeEventListener('touchend', onIconMouseUp);
    };

    els.toggleBtn.addEventListener('mousedown', onIconMouseDown);
    els.toggleBtn.addEventListener('touchstart', onIconMouseDown, { passive: true });

    const header = els.window.querySelector('.chat-header');
    if (header) {
      let isDraggingWindow = false;
      let winDragStartX, winDragStartY, winInitialX, winInitialY;

      const onWindowMouseDown = (e) => {
        if (e.target.closest('.chat-header-btn')) return;
        if (config.theme?.window_draggable === false) return;
        isDraggingWindow = true;
        const event = e.touches ? e.touches[0] : e;
        winDragStartX = event.clientX;
        winDragStartY = event.clientY;
        const rect = els.window.getBoundingClientRect();
        winInitialX = rect.left;
        winInitialY = rect.top;
        els.window.style.left = winInitialX + 'px';
        els.window.style.top = winInitialY + 'px';
        els.window.style.right = 'auto';
        els.window.style.bottom = 'auto';
        els.window.style.margin = '0';
        els.window.style.transition = 'none';
        els.window.classList.add('is-dragging');
        document.addEventListener('mousemove', onWindowMouseMove);
        document.addEventListener('mouseup', onWindowMouseUp);
        document.addEventListener('touchmove', onWindowMouseMove, { passive: false });
        document.addEventListener('touchend', onWindowMouseUp);
        if (e.cancelable) e.preventDefault();
      };

      const onWindowMouseMove = (e) => {
        if (!isDraggingWindow) return;
        const event = e.touches ? e.touches[0] : e;
        let newX = winInitialX + (event.clientX - winDragStartX);
        let newY = winInitialY + (event.clientY - winDragStartY);
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        const chatW = els.window.offsetWidth;
        const chatH = els.window.offsetHeight;
        newX = Math.max(0, Math.min(newX, winW - chatW));
        newY = Math.max(0, Math.min(newY, winH - chatH));
        els.window.style.left = newX + 'px';
        els.window.style.top = newY + 'px';
        const now = Date.now();
        if (now - lastPosSentTime > 50) {
            window.parent.postMessage({
                type: 'mitya_update_position',
                chat_left: Math.round((newX / (winW - chatW)) * 100),
                chat_top: Math.round((newY / (winH - chatH)) * 100)
            }, '*');
            lastPosSentTime = now;
        }
      };

      const onWindowMouseUp = () => {
        if (isDraggingWindow) {
          const rect = els.window.getBoundingClientRect();
          const winW = window.innerWidth;
          const winH = window.innerHeight;
          window.mitya_session_rect = { width: rect.width + 'px', height: rect.height + 'px', top: els.window.style.top, left: els.window.style.left };
          window.parent.postMessage({ type: 'mitya_update_position', chat_left: Math.round((rect.left / (winW - rect.width)) * 100), chat_top: Math.round((rect.top / (winH - rect.height)) * 100) }, '*');
        }
        isDraggingWindow = false;
        els.window.classList.remove('is-dragging');
        els.window.style.transition = '';
        document.removeEventListener('mousemove', onWindowMouseMove);
        document.removeEventListener('mouseup', onWindowMouseUp);
        document.removeEventListener('touchmove', onWindowMouseMove);
        document.removeEventListener('touchend', onWindowMouseUp);
      };

      header.addEventListener('mousedown', onWindowMouseDown);
      header.addEventListener('touchstart', onWindowMouseDown, { passive: false });
    }
}
