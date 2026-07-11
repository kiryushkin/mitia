/**
 * Точка входа модуля media — собирает MityaMedia из подмодулей TTS, STT, AudioAnalyser.
 * Экспортирует класс MityaMedia и регистрирует глобальный экземпляр window.MityaMedia.
 */

import { createTTS } from './tts.js';
import { createSTT } from './stt.js';

export class MityaMedia {
  constructor() {
    this.config = {
      tts: false, // Озвучка бота
      stt: false, // Голосовой ввод пользователя
      video: false // Видеосвязь
    };

    this.synth = window.speechSynthesis;
    this.recognition = null;
    this.isListening = false;
    this.isSpeaking = false;
    this.audio = null;
    this.audioCtx = null;
    this.analyser = null;
    this.currentUtterance = null;
    this.onTranscript = null; // Колбэк для передачи транскрипции в виджет

    // Инициализация подмодулей
    this.tts = createTTS(this);
    this.stt = createSTT(this);
    this.stt.init();
  }

  // ─── TTS (делегирование) ───────────────────────────────────

  toggleTTS() {
    this.config.tts = !this.config.tts;
    if (!this.config.tts) this.tts.stopSpeaking();
    this._updateUI();
    return this.config.tts;
  }

  speak(text) {
    return this.tts.speak(text);
  }

  playAudioUrl(url) {
    return this.tts.playAudioUrl(url);
  }

  stopSpeaking() {
    return this.tts.stopSpeaking();
  }

  // ─── STT (делегирование) ───────────────────────────────────

  toggleListening() {
    return this.stt.toggleListening();
  }

  startListening() {
    return this.stt.startListening();
  }

  stopListening() {
    return this.stt.stopListening();
  }

  // ─── Видеозвонок (заглушка) ────────────────────────────────

  startVideoCall() {
    alert('Функция видеозвонка будет доступна в ближайшем обновлении');
  }

  // ─── UI ────────────────────────────────────────────────────

  _updateUI() {
    const event = new CustomEvent('mitya-media-update', { detail: this.config });
    window.dispatchEvent(event);
  }
}

/**
 * Создаёт и регистрирует глобальный экземпляр MityaMedia.
 * Вызывается один раз при загрузке.
 */
export function registerMityaMedia() {
  if (!window.MityaMedia) {
    window.MityaMedia = new MityaMedia();
  }
  return window.MityaMedia;
}
