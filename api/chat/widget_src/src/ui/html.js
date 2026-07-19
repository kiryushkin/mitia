import { escapeHtml } from '../utils/dom';

// Генерирует HTML-структуру виджета.
export function buildHTML(config) {
  return `
    <div class="chat-widget" id="chat-widget" data-client="${escapeHtml(config.clientId)}" style="opacity: 0; transition: opacity 0.3s ease; pointer-events: none;">
      <div class="chat-widget-container">
        <div class="chat-welcome-bubble" id="chat-welcome-bubble">
          <button class="chat-welcome-close" id="chat-welcome-close" aria-label="Закрыть">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          <span></span>
        </div>
        <div class="chat-button-pulse"></div>
        <button class="chat-button" id="chat-toggle" aria-label="Открыть чат">
          <div class="chat-button-dots">
            <span class="chat-dot"></span>
            <span class="chat-dot"></span>
            <span class="chat-dot"></span>
          </div>
          <div class="chat-button-glare"></div>
          <div class="chat-button-border"></div>
        </button>
      </div>
      <div class="chat-window" id="chat-window" data-lenis-prevent role="dialog" aria-label="Чат-ассистент">
          <div class="chat-resizer resizer-t"></div>
          <div class="chat-resizer resizer-r"></div>
          <div class="chat-resizer resizer-b"></div>
          <div class="chat-resizer resizer-l"></div>
          <div class="chat-resizer resizer-tl"></div>
          <div class="chat-resizer resizer-tr"></div>
          <div class="chat-resizer resizer-bl"></div>
          <div class="chat-resizer resizer-br"></div>

          <div id="chat-avatar-overlay" class="chat-avatar-overlay" style="display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: transparent; z-index: 1; align-items: center; justify-content: center; transition: opacity 0.5s ease; pointer-events: none; overflow: visible;">
            <iframe id="chat-avatar-frame" style="width: 100%; height: 100%; border: none; background: transparent; display: block; pointer-events: none; transform-origin: center center;"></iframe>
          </div>
          <div class="chat-header">
            <div class="chat-header-container" id="chat-header-container">
              <a class="chat-header-logo" id="chat-header-logo" target="_blank" style="display: none;"></a>
              <div class="chat-header-buttons" id="chat-header-buttons">
                <button class="chat-header-btn btn-expand" id="chat-expand-btn" title="Изменить размер">
                  <svg class="icon-expand" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 6l6 0l0 6M12 18l-6 0l0 -6"/>
                  </svg>
                  <svg class="icon-shrink" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:none">
                    <path d="M18 10l-5 0l0 -5M6 14l5 0l0 5"/>
                  </svg>
                </button>
                <button class="chat-header-btn btn-close" id="chat-close-btn" title="Закрыть">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
              <div class="chat-media-panel" id="chat-media-panel" style="display: none;"></div>
            </div>
          </div>
          <div class="chat-messages" id="chat-messages" aria-live="polite">
            <div class="chat-messages-container" id="chat-messages-container"></div>
          </div>
          <div class="footer-chat">
            <div id="chat-attached-files" class="chat-attached-files"></div>
            <div class="chat-input-container">
              <button class="chat-attach-btn" id="chat-attach-btn" title="Прикрепить файл">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                <input type="file" id="chat-file-input" style="display:none" accept=".pdf,.doc,.docx,.txt,.rtf,.odt,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.tiff,.bmp">
              </button>
              <textarea class="chat-input" id="chat-input" placeholder="Сообщение..." maxlength="2000" rows="1" autocomplete="off"></textarea>
              <div class="chat-send-container">
                <div class="chat-mic-pulse" id="chat-mic-pulse"></div>
                <button class="chat-send" id="chat-send" aria-label="Отправить">
                  <svg class="icon-send" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: block;"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                  <svg class="icon-mic" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: none;"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                </button>
              </div>
            </div>
          </div>
      </div>
    </div>
  `;
}
