import { escapeHtml } from '../utils/dom';

/**
 * Отрисовывает быстрые ответы.
 * ПОЛНАЯ КОПИЯ ИЗ ОРИГИНАЛА (строки 4843-4949).
 */
export function renderQuickReplies(els, config, sendMessage) {
    if (!els.quickRepliesBox) return;
    
    let replies = [];
    const path = location.pathname || '/';
    const byUrl = config.quickRepliesByUrl || {};
    
    for (const pattern of Object.keys(byUrl)) {
      if (path.includes(pattern)) {
        replies = byUrl[pattern];
        break;
      }
    }
    
    if (replies.length === 0) {
      replies = config.quickReplies || [];
    }

    const theme = config.theme || {};
    
    if (replies.length === 0) {
      els.quickRepliesBox.innerHTML = '';
      return;
    }

    els.quickRepliesBox.innerHTML = replies.map(qr => `
      <button class="chat-qr-btn" 
              data-action="${qr.action || 'send_message'}" 
              data-value="${escapeHtml(qr.msg || qr.label)}"
              data-label="${escapeHtml(qr.label)}"
              style="${qr.style || ''}">
        <span>${qr.label}</span>
      </button>
    `).join('');

    els.quickRepliesBox.querySelectorAll('.chat-qr-btn').forEach(btn => {
      btn.onclick = () => {
        const action = btn.dataset.action;
        const value = btn.dataset.value;
        const label = btn.dataset.label;
        
        if (action === 'save_design' || label.toLowerCase().includes('сохранить')) {
            console.log('[ChatWidget] Action Key: save_design triggered');
            if (window.MityaWidget && window.MityaWidget.saveCurrentDesign) {
                window.MityaWidget.saveCurrentDesign();
            }
            return;
        }

        if (action === 'reset_design' || label.toLowerCase().includes('отменить')) {
            location.reload();
            return;
        }

        if (action === 'url') {
          window.open(value, '_blank');
        } else {
          sendMessage(value);
        }
      };
    });
}
