import { escapeHtml } from '../utils/dom';

export function startScenario(scenarioId, handleSendMessage) {
  handleSendMessage(`[scenario]:${scenarioId}`);
}

export async function handleAction(action, data, sendMessage, renderLeadForm, saveCurrentDesign) {
  const label = (data.label || '').toLowerCase();
  const saveWords = ['сохранить', 'save', 'подтвердить', 'confirm', 'ок', 'ok', 'оставить', 'применить'];
  
  if (saveWords.some(word => label.includes(word))) {
      await saveCurrentDesign();
      return;
  }

  switch (action) {
    case 'send_message':
      if (data.value) sendMessage(data.value, data.label);
      break;
    case 'open_form':
      renderLeadForm({ prefill: data.value });
      break;
    case 'start_scenario':
      sendMessage(`[scenario]:${data.value}`, data.label);
      break;
    case 'link':
      if (data.value) window.open(data.value, '_blank');
      break;
    default:
      if (data.value) sendMessage(data.value, data.label);
  }
}

export function renderLeadForm(options, els, config, chatToken, sessionId) {
  const wrap = document.createElement('div');
  wrap.className = 'message bot chat-lead-form-msg';
  wrap.innerHTML = `
    <form class="chat-lead-form">
      <div class="chat-lead-row"><input type="text" name="name" placeholder="Ваше имя" required></div>
      <div class="chat-lead-row"><input type="text" name="contact" placeholder="Телефон или Email" required></div>
      <div class="chat-lead-row"><textarea name="message" placeholder="Ваш вопрос">${escapeHtml(options.prefill || '')}</textarea></div>
      <button type="submit" class="chat-cta-btn">Отправить</button>
      <div class="chat-lead-status"></div>
    </form>
  `;

  els.messagesContainer.appendChild(wrap);
  els.messages.scrollTop = els.messages.scrollHeight;

  const form = wrap.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      name: fd.get('name'),
      contact: fd.get('contact'),
      message: fd.get('message'),
      client_id: config.clientId,
      token: chatToken,
      session_id: sessionId
    };

    try {
      const res = await fetch(`${config.serverUrl}/api/chat/lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        form.innerHTML = `<div class="chat-lead-success">${escapeHtml(config.leadSuccessMsg)}</div>`;
      }
    } catch (err) {
      wrap.querySelector('.chat-lead-status').textContent = 'Ошибка при отправке.';
    }
  };
}

export async function saveCurrentDesign(config) {
  console.log('[ChatWidget] Saving design...');
  try {
    const res = await fetch(`${config.serverUrl}/api/chat/config/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: config.clientId,
        theme: config.theme
      })
    });
    return res.ok;
  } catch (e) {
    console.error('Failed to save design', e);
    return false;
  }
}
