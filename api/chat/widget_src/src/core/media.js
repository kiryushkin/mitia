/**
 * Интеграция медиа-модуля с UI виджета.
 * Обновляет состояние иконки микрофона/отправки и обрабатывает транскрипцию.
 */

import { registerMityaMedia } from '../media/index.js';

// Регистрируем глобальный MityaMedia при импорте модуля
registerMityaMedia();

/**
 * Обновляет состояние иконки микрофона/отправки в зависимости от контекста.
 */
export function updateMicState(els, config, attachedFiles = []) {
    if (!els.send) return;

    const hasText = els.input.value.trim().length > 0 || window.isSendBtnPreviewActive;
    const hasFiles = attachedFiles && attachedFiles.length > 0;
    const isBotBusy = els.window.classList.contains('active-typing') || 
                     els.window.classList.contains('is-typing-stream') ||
                     window.isPrinting || 
                     window.isStreamingActive ||
                     window.isStopBtnPreviewActive ||
                     (window.MityaMedia && window.MityaMedia.isSpeaking);
    const isListening = ((window.MityaMedia && window.MityaMedia.isListening) || window.isRecordBtnPreviewActive) && !window.isSendBtnPreviewActive;
    
    console.log('[MicState] isBotBusy:', isBotBusy, 'hasText:', hasText, 'isPrinting:', window.isPrinting, 'isStreamingActive:', window.isStreamingActive);

    if (isBotBusy) {
      console.log('[MicState] Setting STOP icon');
      // В режиме печати показываем иконку стоп (квадратик), используя стили из темы
      els.send.innerHTML = '<svg class="icon-stop" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>'; 
      els.send.title = 'Остановить генерацию';
      els.send.classList.add('is-thinking-stop', 'chat-stop-btn');
      els.send.classList.remove('mic-active', 'send-active', 'is-thinking');
      els.input.placeholder = 'Сообщение...';
    } else if (isListening) {
      els.send.innerHTML = '<div class="mic-pulse-circle"></div>';
      els.send.title = 'Слушаю...';
      els.send.classList.add('is-thinking');
      els.send.classList.remove('mic-active', 'send-active', 'is-thinking-stop', 'chat-stop-btn');
      els.input.placeholder = 'Слушаю...';
    } else if (hasText) {
      els.send.innerHTML = '<svg class="icon-send" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"><path d="M50,7v86.07M84.37,41.37L50,7,15.63,41.37"/></svg>';
      els.send.title = 'Отправить';
      els.send.classList.add('send-active');
      els.send.classList.remove('is-thinking', 'mic-active', 'is-thinking-stop', 'chat-stop-btn');
      els.input.placeholder = 'Сообщение...';
    } else {
      els.send.innerHTML = '<svg class="icon-mic" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"><path d="M50,62.82h0c-6.97,0-12.62-5.65-12.62-12.62v-30.59c0-6.97,5.65-12.62,12.62-12.62h0c6.97,0,12.62,5.65,12.62,12.62v30.59c0,6.97-5.65,12.62-12.62,12.62ZM21.36,41.44v8.15c0,15.82,12.82,28.64,28.64,28.64s28.64-12.82,28.64-28.64v-8.15M31.49,93.06h37.03M50,78.23v14.84"/></svg>';
      els.send.title = 'Голосовой ввод';
      els.send.classList.add('mic-active');
      els.send.classList.remove('is-thinking', 'send-active', 'is-thinking-stop', 'chat-stop-btn');
      els.input.placeholder = 'Сообщение...';
    }
}

/**
 * Инициализирует медиа-события и обработчики транскрибации.
 */
export function initMedia(els, config) {
  if (window.MityaMedia) {
    window.MityaMedia.onTranscript = (text, isFinal, audioBlob = null) => {
      if (!text) return;
      
      if (isFinal) {
        const currentVal = els.input.value.trim();
        els.input.value = currentVal ? (currentVal + ' ' + text) : text;
        els.input.placeholder = "Сообщение...";
        updateMicState(els, config);
        els.input.focus();
      } else {
        els.input.placeholder = text + "...";
        els.send.classList.add('is-listening');
      }
    };

    window.addEventListener('mitya-media-update', () => {
      updateMicState(els, config);
    });
  }
}
