/**
 * WebSocket-соединение для диалогов
 */

import { state } from './state.js';

/**
 * Подключение WebSocket для сессии
 * @param {function} onMessage — колбэк при получении сообщения
 */
export function connectWebSocket(sessionId, onMessage) {
    if (state.socket) {
        state.socket.close();
    }

    const urlClientId = new URLSearchParams(window.location.search).get('client_id');
    const cid = (urlClientId && urlClientId !== 'undefined')
        ? urlClientId
        : localStorage.getItem('chat_client_id');
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const adminToken = localStorage.getItem('chatadmin_auth_token');
    const params = new URLSearchParams();
    params.set('session_id', sessionId);
    if (adminToken) params.set('token', adminToken);
    params.set('role', 'operator');
    const wsUrl = `${protocol}//${location.host}/ws/chat/${cid}?${params.toString()}`;

    state.socket = new WebSocket(wsUrl);

    state.socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (onMessage) onMessage(data);
        } catch (e) {
            console.error('[WS] Error:', e);
        }
    };

    state.socket.onclose = () => {
        console.log('[WS] Connection closed');
    };
}

/**
 * Закрыть WebSocket
 */
export function disconnectWebSocket() {
    if (state.socket) {
        state.socket.close();
        state.socket = null;
    }
}

/**
 * Обновление индикатора печатания
 */
export function updateTypingStatus(isTyping, role = 'user') {
    const statusEl = document.getElementById('user-typing-status');
    if (statusEl) {
        if (isTyping) {
            const label = role === 'assistant' ? 'Ассистент печатает...' : 'Пользователь печатает...';
            statusEl.textContent = label;
            statusEl.style.display = 'block';
        } else {
            statusEl.style.display = 'none';
        }
    }
}

/**
 * Отправка статуса печатания оператора
 */
export function sendTypingStatus(isTyping) {
    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
        state.socket.send(JSON.stringify({
            type: 'typing',
            is_typing: isTyping,
            author_role: 'operator'
        }));
    }
}
