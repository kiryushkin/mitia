
  /** Устанавливает значение куки. */
  export const setCookie = (name, value, days) => {
    const d = new Date();
    d.setTime(d.getTime() + days * 86400000);
    document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/;SameSite=Lax`;
  };

  /** Получает значение куки по имени. */
  export const getCookie = (name) => {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[1]) : null;
  };
  
  /** Генерирует уникальный отпечаток браузера (Fingerprint) для идентификации сессии. */
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

  /** Обновляет видимость кнопки прикрепления файлов в зависимости от настроек темы. */
  export function updateAttachBtnVisibility(els, config) {
    if (els.attachBtn) {
      const isEnabled = config.theme && config.theme.btn_attach_enabled !== false;
      els.attachBtn.style.setProperty('display', isEnabled ? 'flex' : 'none', 'important');
    }
  }

  const scriptEl = document.currentScript ||
    document.querySelector('script[src*="chat-widget"]') ||
    document.querySelector('script[data-client]');

  const userCfg = window.MITYA_CONFIG || {};
  const dataset = (scriptEl && scriptEl.dataset) || {};

  function readClientIdFromScript(el) {
    if (!el || !el.src) return '';
    try {
      const fromQuery = new URL(el.src, window.location.href).searchParams.get('client_id');
      if (fromQuery) return fromQuery.trim();
    } catch (_) {}
    return '';
  }

  function readClientIdFromPage() {
    try {
      return new URLSearchParams(window.location.search).get('client_id') || '';
    } catch (_) {
      return '';
    }
  }

  function readAssistantIdFromScript(el) {
    if (!el || !el.src) return '';
    try {
      return new URL(el.src, window.location.href).searchParams.get('assistant_id') || '';
    } catch (_) {}
    return '';
  }

  const resolvedClientId = (
    userCfg.clientId
    || dataset.client
    || dataset.clientId
    || readClientIdFromScript(scriptEl)
    || readClientIdFromPage()
    || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'mitia_assistant' : '')
  ).trim();

  export const BOOTSTRAP = {
    clientId: resolvedClientId || 'default',
    assistantId: userCfg.assistantId || dataset.assistantId || readAssistantIdFromScript(scriptEl),
    serverUrl: userCfg.serverUrl || dataset.server ||
      ((location.port === '5007')
        ? `http://${location.hostname}:5007`
        : (scriptEl && scriptEl.src ? new URL(scriptEl.src).origin : location.origin)),
  };

  /** Загружается динамически с сервера золотой стандарт темы для обеспечения единства настроек. */
  export let GOLDEN_STANDARD = {};

  export async function fetchGoldenStandard() {
    try {
      const res = await fetch(`${BOOTSTRAP.serverUrl}/api/chat/theme-defaults`);
      if (res.ok) {
        GOLDEN_STANDARD = await res.json();
        return GOLDEN_STANDARD;
      }
    } catch (e) {
      console.warn('[Chat] Failed to fetch golden standard');
    }
    return {};
  }

  export function getWidgetStorageScope(config = CONFIG) {
    const clientId = String(config.clientId || 'default').trim() || 'default';
    const assistantId = String(config.assistantId || 'main').trim() || 'main';
    return `${clientId}_${assistantId}`;
  }

  export let CONFIG = {
    clientId: BOOTSTRAP.clientId,
    assistantId: BOOTSTRAP.assistantId || '',
    serverUrl: BOOTSTRAP.serverUrl,
    botName: 'Ассистент',
    avatar: '',
    leadSuccessMsg: 'Заявка отправлена! Мы свяжемся с вами.',
    scenarioSuccessMsg: 'Данные успешно отправлены! Мы свяжемся с вами.',
    privacyUrl: '/privacy',
    welcome_msg: 'Привет! Я ваш интеллектуальный ассистент. Чем могу помочь?',
    quickReplies: [],
    quickRepliesByUrl: {},
    quickRepliesTree: {},
    contacts: {},
    theme: {}
  };