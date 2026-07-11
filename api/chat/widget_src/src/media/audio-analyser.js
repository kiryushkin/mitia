/**
 * Модуль аудио-анализатора — отслеживание громкости для анимации аватара.
 * Использует Web Audio API (AnalyserNode) для получения данных о частотах в реальном времени.
 */

/**
 * Инициализирует AudioContext + AnalyserNode для элемента <audio>.
 * Возвращает объект с методом startVolumeTracking() для запуска цикла обновления громкости.
 *
 * @param {object} media — ссылка на MityaMedia (для доступа к isSpeaking, audioCtx, analyser)
 * @param {HTMLAudioElement} audio — элемент аудио, к которому подключается анализатор
 * @returns {{ startVolumeTracking: () => void } | null}
 */
export function initAudioAnalyser(media, audio) {
  if (!audio) return null;

  if (!media.audioCtx) {
    media.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (media.audioCtx.state === 'suspended') {
    media.audioCtx.resume();
  }

  // Создаём источник и анализатор
  const source = media.audioCtx.createMediaElementSource(audio);
  media.analyser = media.audioCtx.createAnalyser();
  media.analyser.fftSize = 256;
  source.connect(media.analyser);
  media.analyser.connect(media.audioCtx.destination);

  const dataArray = new Uint8Array(media.analyser.frequencyBinCount);

  /**
   * Запускает requestAnimationFrame-цикл обновления window.currentAudioVolume.
   */
  function startVolumeTracking() {
    function update() {
      if (!media.isSpeaking) {
        window.currentAudioVolume = 0;
        return;
      }
      media.analyser.getByteFrequencyData(dataArray);
      let max = 0;
      for (let i = 0; i < dataArray.length; i++) {
        if (dataArray[i] > max) max = dataArray[i];
      }
      const vol = max / 255;
      window.currentAudioVolume = vol;
      if (window.top) window.top.currentAudioVolume = vol; // Для главной страницы
      requestAnimationFrame(update);
    }
    update();
  }

  return { startVolumeTracking };
}
