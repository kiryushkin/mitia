import { BOOTSTRAP } from '../core/config';

/**
 * Класс для управления WebSocket соединением и API запросами.
 * Сохраняем оригинальную логику работы с сервером.
 */
export class ChatAPI {
  constructor(config) {
    this.config = config;
    this.socket = null;
    this.handlers = new Map();
  }

  connect(token, sessionId) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${new URL(this.config.serverUrl).host}/ws/chat/${this.config.clientId}?token=${token}${sessionId ? `&session_id=${sessionId}` : ''}`;
    
    console.log('[ChatAPI] Connecting to:', wsUrl);
    this.socket = new WebSocket(wsUrl);
    
    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.emit(data.type || 'message', data);
      } catch (e) {
        console.error('[ChatAPI] Error parsing message:', e);
      }
    };

    this.socket.onclose = (e) => {
      const expectedClose = document.visibilityState === 'hidden' || [1000, 1001].includes(e.code);
      if (expectedClose) {
        console.debug('[ChatAPI] Connection closed (expected):', e.code, e.reason || '');
      } else {
        console.warn('[ChatAPI] Connection closed:', e.code, e.reason || '', e);
      }
      this.emit('close', e);
    };

    this.socket.onerror = (error) => {
      // В фоне/при suspension браузера это штатно — не засоряем консоль ошибками
      if (document.visibilityState === 'hidden') {
        console.debug('[ChatAPI] WebSocket error while hidden/suspended');
      } else {
        console.warn('[ChatAPI] WebSocket error:', error);
      }
      this.emit('error', error);
    };
  }

  send(data) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    } else {
      console.warn('[ChatAPI] Cannot send message: socket not open');
    }
  }

  async ask(formData, signal) {
    const response = await fetch(`${this.config.serverUrl}/api/chat/ask`, {
      method: 'POST',
      body: formData,
      signal: signal
    });
    return response;
  }

  stop(token, sessionId, lastText) {
    return fetch(`${this.config.serverUrl}/api/chat/stop`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        token, 
        session_id: sessionId,
        last_text: lastText 
      })
    });
  }

  on(type, handler) {
    this.handlers.set(type, handler);
  }

  emit(type, data) {
    if (this.handlers.has(type)) {
      this.handlers.get(type)(data);
    }
  }
}
