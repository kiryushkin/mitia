/**
 * API-слой модуля диалогов — только HTTP-запросы, без DOM и без state
 */

function authHeaders() {
    return { 'Authorization': `Bearer ${localStorage.getItem('chatadmin_auth_token')}` };
}

function clientId() {
    // Получаем client_id из URL параметра в первую очередь
    const urlParams = new URLSearchParams(window.location.search);
    const urlClientId = urlParams.get('client_id');
    if (urlClientId && urlClientId !== 'undefined') {
        return urlClientId;
    }
    // Fallback на localStorage
    return localStorage.getItem('chat_client_id');
}

/**
 * Загрузка списка сессий
 */
export async function fetchSessions(searchQuery = '') {
    let url = `/api/chat/admin/sessions?client_id=${clientId()}`;
    if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;

    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

/**
 * Загрузка истории сообщений диалога
 */
export async function fetchHistory(sessionId, activeClientId) {
    const cid = activeClientId || clientId();
    let url = `/api/chat/history?token=${sessionId}&limit=100&t=${Date.now()}`;
    if (cid) url += `&client_id=${cid}`;

    const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('chatadmin_auth_token')}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

/**
 * Загрузка конфига виджета (для аватаров)
 */
export async function fetchWidgetConfig(activeClientId) {
    const cid = activeClientId || clientId();
    try {
        const ts = Date.now();
        const res = await fetch(`/api/chat/config?client_id=${cid}&t=${ts}`);
        if (res.ok) return res.json();

        // Для новых клиентов без allowed_origins показываем общий виджет платформы
        if (res.status === 403 && cid !== 'mitia_assistant') {
            const fallback = await fetch(`/api/chat/config?client_id=mitia_assistant&t=${ts}`);
            if (fallback.ok) return fallback.json();
        }

        return { theme: {} };
    } catch (err) {
        return { theme: {} };
    }
}

/**
 * Отметить диалог прочитанным
 */
export async function markSessionRead(sessionId) {
    const res = await fetch(`/api/chat/admin/sessions/${sessionId}/read`, {
        method: 'POST',
        headers: authHeaders()
    });
    return res.ok;
}

/**
 * Переключение режима оператора/ассистента
 */
export async function toggleOperatorMode(sessionId, enable) {
    const action = enable ? 'takeover' : 'release';
    const res = await fetch(`/api/chat/admin/sessions/${sessionId}/${action}`, {
        method: 'POST',
        headers: authHeaders()
    });
    return res.ok;
}

/**
 * Удаление сессии
 */
export async function deleteSession(sessionId) {
    const res = await fetch(`/api/chat/admin/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: authHeaders()
    });
    return res.ok;
}

/**
 * Обновление метаданных сессии
 */
export async function updateSessionMetadata(sessionId, metadata) {
    const res = await fetch(`/api/chat/admin/sessions/${sessionId}/metadata`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders()
        },
        body: JSON.stringify({ metadata })
    });
    return res.ok;
}

/**
 * Обновление статуса сессии (lead, archive, new и т.д.)
 */
export async function updateSessionStatus(sessionId, status) {
    const res = await fetch(`/api/chat/admin/history/${sessionId}/status`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders()
        },
        body: JSON.stringify({ status })
    });
    return res.ok;
}

/**
 * Архивация / разархивация сессии
 */
export async function archiveSession(sessionId, archived = true, userCloseReasonId = null) {
    const payload = { is_archived: archived };
    if (archived && userCloseReasonId !== null && userCloseReasonId !== undefined) {
        payload.user_close_reason_id = Number(userCloseReasonId);
    }

    const res = await fetch(`/api/chat/admin/sessions/${sessionId}/archive`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders()
        },
        body: JSON.stringify(payload)
    });
    return res.ok;
}


/**
 * Отправка сообщения оператора
 */
export async function sendOperatorMessage(sessionId, text, files = []) {
    const formData = new FormData();
    formData.append('session_id', sessionId);
    formData.append('message', text);
    files.forEach(file => formData.append('files', file));

    const res = await fetch('/api/chat/admin/operator/send', {
        method: 'POST',
        headers: authHeaders(),
        body: formData
    });
    return res;
}

export async function fetchGlobalOperatorStatus() {
    const res = await fetch(`/api/chat/admin/global-operator-status?client_id=${clientId()}`, {
        headers: authHeaders()
    });
    if (!res.ok) return { enabled: false };
    return res.json();
}

export async function saveGlobalOperatorStatus(enabled) {
    const res = await fetch(`/api/chat/admin/global-operator-status`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders()
        },
        body: JSON.stringify({ client_id: clientId(), enabled })
    });
    return res.ok;
}

export async function fetchIntegrations(activeClientId) {
    const cid = activeClientId || clientId();
    const res = await fetch(`/api/chat/admin/integrations?client_id=${cid}`, {
        headers: authHeaders()
    });
    if (!res.ok) return {};
    const data = await res.json();
    return data.integrations || {};
}

export async function fetchAdminConfig(activeClientId) {
    const cid = activeClientId || clientId();
    const res = await fetch(`/api/chat/admin/config?client_id=${cid}`, {
        headers: authHeaders()
    });
    if (!res.ok) return {};
    const data = await res.json();
    return data.config || {};
}

export async function fetchCloseReasons(activeClientId, includeInactive = false) {
    const cid = activeClientId || clientId();
    const url = `/api/chat/admin/close-reasons?client_id=${encodeURIComponent(cid)}${includeInactive ? '&include_inactive=true' : ''}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) return [];
    const data = await res.json();
    return data.reasons || [];
}

export async function createCloseReason(title, activeClientId) {
    const cid = activeClientId || clientId();
    const res = await fetch('/api/chat/admin/close-reasons', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders()
        },
        body: JSON.stringify({ client_id: cid, title })
    });
    if (!res.ok) return { ok: false, reason: null, status: res.status };
    const data = await res.json();
    return { ok: data.status === 'success', reason: data.reason || null, status: res.status };
}

export async function updateCloseReason(reasonId, patch, activeClientId) {
    const cid = activeClientId || clientId();
    const res = await fetch(`/api/chat/admin/close-reasons/${reasonId}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders()
        },
        body: JSON.stringify({ client_id: cid, ...(patch || {}) })
    });
    if (!res.ok) return { ok: false, reason: null, status: res.status };
    const data = await res.json();
    return { ok: data.status === 'success', reason: data.reason || null, status: res.status };
}

export async function saveAdminConfig(partialConfig, activeClientId) {
    const cid = activeClientId || clientId();
    const res = await fetch(`/api/chat/admin/config?client_id=${cid}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders()
        },
        body: JSON.stringify(partialConfig || {})
    });

    if (!res.ok) return { ok: false, config: null };
    const data = await res.json();
    return { ok: data.status === 'success', config: data.config || null };
}
