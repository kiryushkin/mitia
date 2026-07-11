/**
 * Модуль TTS (Text-to-Speech) — озвучка ответов бота.
 * Управляет очередью фраз, запросами к серверному TTS API и воспроизведением аудио.
 */

import { initAudioAnalyser } from './audio-analyser.js';

/**
 * Создаёт и возвращает TTS-менеджер, привязанный к экземпляру MityaMedia.
 * @param {object} media — ссылка на родительский объект MityaMedia (для доступа к isSpeaking, audio и т.д.)
 * @returns {object} API: { speak, processQueue, playAudioUrl, stopSpeaking, clearQueue }
 */
export function createTTS(media) {
  const speechQueue = [];
  let isProcessingQueue = false;

  /**
   * Добавляет текст в очередь озвучки.
   * Возвращает Promise, который резолвится после воспроизведения.
   */
  async function speak(text) {
    if (!media.config.tts || !text) return null;

    return new Promise((resolve) => {
      speechQueue.push({ text, resolve });
      if (!isProcessingQueue) {
        processQueue();
      }
    });
  }

  /**
   * Последовательно обрабатывает очередь фраз.
   */
  async function processQueue() {
    if (speechQueue.length === 0) {
      isProcessingQueue = false;
      media.isSpeaking = false;
      return;
    }

    isProcessingQueue = true;
    const { text, resolve } = speechQueue.shift();

    try {
      // Определяем clientId из разных источников
      let clientId = 'default';
      if (window.presentationModeActive) {
        clientId = 'mitia_assistant';
      } else {
        const widgetEl = document.getElementById('chat-widget');
        clientId = (widgetEl && widgetEl.dataset.client) ||
                   (window.MITYA_CONFIG && window.MITYA_CONFIG.clientId) ||
                   'default';
      }

      console.log('[MityaMedia] Requesting TTS for:', text.substring(0, 30) + '...', 'Client:', clientId);

      const res = await fetch('/api/chat/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit', // Не отправляем куки, чтобы избежать проблем с сессиями
        body: JSON.stringify({ text, client_id: clientId })
      });
      const data = await res.json();

      if (data.url) {
        console.log('[MityaMedia] TTS Success, audio URL:', data.url);
        await playAudioUrl(data.url);
        resolve(true);
      } else {
        console.warn('[MityaMedia] TTS returned no URL:', data);
        resolve(null);
      }
    } catch (e) {
      console.error('[MityaMedia] TTS Error:', e);
      resolve(null);
    }

    processQueue();
  }

  /**
   * Проигрывает аудио по прямому URL с поддержкой анализатора громкости.
   */
  async function playAudioUrl(url) {
    if (!url) return;

    // Защита от объекта вместо строки
    if (typeof url === 'object' && url.url) {
      url = url.url;
    }
    if (typeof url !== 'string') {
      console.error('[MityaMedia] Invalid URL type:', typeof url, url);
      return;
    }

    return new Promise((resolve, reject) => {
      stopSpeaking();

      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.src = url;
      media.audio = audio;

      // Инициализация анализатора для аватара
      try {
        const analyserCtx = initAudioAnalyser(media, audio);

        audio.onplay = () => {
          media.isSpeaking = true;
          media._updateUI();
          if (analyserCtx) analyserCtx.startVolumeTracking();
          window.dispatchEvent(new CustomEvent('mitya-audio-start', {
            detail: { audio: media.audio, duration: media.audio.duration }
          }));
        };
      } catch (e) {
        console.warn('[MityaMedia] Analyser init failed:', e);
        audio.onplay = () => {
          media.isSpeaking = true;
          media._updateUI();
          window.dispatchEvent(new CustomEvent('mitya-audio-start', {
            detail: { audio: media.audio, duration: media.audio.duration }
          }));
        };
      }

      audio.onended = () => {
        media.isSpeaking = false;
        media._updateUI();
        window.dispatchEvent(new CustomEvent('mitya-audio-end'));
        resolve(true);
      };

      audio.onerror = (e) => {
        console.error('[MityaMedia] Audio play error:', e, 'URL:', url);
        media.isSpeaking = false;
        media._updateUI();
        reject(e);
      };

      // Принудительная загрузка и запуск
      audio.load();
      audio.muted = false;
      audio.volume = 1.0;

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          console.log('[MityaMedia] Playback started successfully');
        }).catch(error => {
          console.warn('[MityaMedia] Playback failed, trying fallback:', error);
          // Повторная попытка через 100мс (помогает при гонке условий)
          setTimeout(() => {
            audio.muted = false;
            audio.play().catch(e => console.error('[MityaMedia] Fallback play failed:', e));
          }, 100);
        });
      }
    });
  }

  /**
   * Принудительная остановка озвучки: очищает очередь, останавливает аудио.
   */
  function stopSpeaking() {
    console.log('[MityaMedia] Принудительная остановка озвучки');
    speechQueue.length = 0;
    isProcessingQueue = false;
    media.isSpeaking = false;

    if (media.audio) {
      media.audio.pause();
      media.audio.src = ''; // Очищаем источник, чтобы прервать загрузку
      media.audio.currentTime = 0;
    }
    if (media.synth) {
      media.synth.cancel();
    }
    media._updateUI();
  }

  /**
   * Очищает очередь без остановки текущего воспроизведения.
   */
  function clearQueue() {
    speechQueue.length = 0;
  }

  return { speak, processQueue, playAudioUrl, stopSpeaking, clearQueue };
}
