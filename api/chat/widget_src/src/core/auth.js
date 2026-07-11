/**
 * Устанавливает значение куки.
 */
export const setCookie = (name, value, days) => {
  const d = new Date();
  d.setTime(d.getTime() + days * 86400000);
  document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/;SameSite=Lax`;
};

/**
 * Получает значение куки по имени.
 */
export const getCookie = (name) => {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
};

/**
 * Генерирует уникальный отпечаток браузера (Fingerprint) для идентификации сессии.
 * ПОЛНАЯ КОПИЯ ИЗ ОРИГИНАЛА.
 */
export function generateFingerprint(clientId) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const txt = 'MityaAI-Fingerprint-1.0';
  ctx.textBaseline = "top";
  ctx.font = "14px 'Arial'";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#f60";
  ctx.fillRect(125,1,62,20);
  ctx.fillStyle = "#069";
  ctx.fillText(txt, 2, 15);
  ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
  ctx.fillText(txt, 4, 17);
  const b64 = canvas.toDataURL().slice(-50);
  
  const screenData = window.screen.width + 'x' + window.screen.height + 'x' + window.screen.colorDepth;
  const language = navigator.language || navigator.userLanguage;
  const platform = navigator.platform;
  
  const rawId = `${platform}-${language}-${screenData}-${b64}`;
  
  let hash = 0;
  for (let i = 0; i < rawId.length; i++) {
      const char = rawId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
  }
  return 'ct-' + Math.abs(hash).toString(36) + '-' + clientId.slice(0, 5);
}
