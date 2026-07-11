/**
 * Модуль STT (Speech-to-Text) — голосовой ввод пользователя.
 * Инициализирует Web Speech API, управляет микрофоном и передаёт транскрипцию.
 */

/**
 * Создаёт и возвращает STT-менеджер, привязанный к экземпляру MityaMedia.
 * @param {object} media — ссылка на родительский объект MityaMedia
 * @returns {object} API: { init, startListening, stopListening, toggleListening }
 */
export function createSTT(media) {

  /**
   * Инициализация Web Speech Recognition API.
   */
  function init() {
    try {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        console.warn('[MityaMedia] Speech Recognition API не поддерживается браузером');
        media.recognition = null;
        return;
      }

      media.recognition = new SpeechRecognition();
      media.recognition.lang = 'ru-RU';
      media.recognition.interimResults = true;   // промежуточные результаты во время речи
      media.recognition.maxAlternatives = 1;
      media.recognition.continuous = false;       // останавливается после паузы

      media.recognition.onresult = (event) => {
        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            final += transcript;
          } else {
            interim += transcript;
          }
        }

        // Промежуточный результат (для отображения в плейсхолдере)
        if (interim && typeof media.onTranscript === 'function') {
          media.onTranscript(interim, false);
        }

        // Финальный результат
        if (final && typeof media.onTranscript === 'function') {
          media.onTranscript(final, true);
        }
      };

      media.recognition.onerror = (event) => {
        console.error('[MityaMedia] STT Error:', event.error);
        media.isListening = false;
        media._updateUI();

        if (event.error === 'no-speech' || event.error === 'audio-capture') {
          // Пользователь просто ничего не сказал — не перезапускаем
        } else if (event.error === 'aborted') {
          // Штатная остановка — ничего не делаем
        } else {
          alert('Ошибка распознавания речи: ' + event.error);
        }
      };

      media.recognition.onend = () => {
        media.isListening = false;
        media._updateUI();
      };

      console.log('[MityaMedia] STT инициализирован (ru-RU)');
    } catch (e) {
      console.error('[MityaMedia] Ошибка инициализации STT:', e);
      media.recognition = null;
    }
  }

  /**
   * Переключает микрофон (вкл/выкл).
   * @returns {boolean} Текущее состояние isListening
   */
  function toggleListening() {
    if (!media.recognition) {
      alert('Ваш браузер не поддерживает голосовой ввод');
      return false;
    }
    if (media.isListening) {
      stopListening();
    } else {
      startListening();
    }
    return media.isListening;
  }

  /**
   * Включает микрофон.
   */
  function startListening() {
    if (!media.recognition || media.isListening) return;

    // Останавливаем озвучку перед записью
    if (media.tts) media.tts.stopSpeaking();

    try {
      media.recognition.start();
      media.isListening = true;
      playBeep(660, 0.1, 0.1); // Приятный «динь» при включении
      media._updateUI();
      console.log('[MityaMedia] Микрофон включен, слушаю...');
    } catch (e) {
      console.error('[MityaMedia] Start error:', e);
    }
  }

  /**
   * Выключает микрофон.
   */
  function stopListening() {
    if (!media.recognition || !media.isListening) return;

    media.recognition.stop();
    media.isListening = false;
    media._updateUI();
  }

  /**
   * Звуковой сигнал при включении микрофона.
   */
  function playBeep(freq, duration, volume) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = volume;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
      osc.onended = () => ctx.close();
    } catch (e) {
      // Без звука — не критично
    }
  }

  return { init, startListening, stopListening, toggleListening };
}
