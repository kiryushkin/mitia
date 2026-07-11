import { escapeHtml } from '../utils/dom';

// Преобразует Markdown-разметку в HTML
export function renderMarkdown(text, config, isFinal = false) {
    let s = text;
    
    // СКРЫВАЕМ ТЕХНИЧЕСКИЕ КОМАНДЫ И НЕЗАВЕРШЕННЫЕ ТЕГИ ПРИ ПЕЧАТИ
    if (!isFinal) {
        s = s.replace(/\[button:[^\]]+\]/g, '');
        s = s.replace(/\[widget_preview\]/g, '');
        s = s.replace(/[a-z_]+\([^\)]*\)/g, '');
        s = s.replace(/\[[^\]]*$/g, '');
    } else {
        s = s.replace(/[a-z_]+\([^\)]*\)/g, '');
        s = s.replace(/^[a-z_]{3,50}\s*$/gm, '');
    }

    if (s.endsWith('[') || s.endsWith('[s')) {
        s = s.slice(0, s.lastIndexOf('['));
    }
    
    if (s.includes('!') && !s.includes('](')) {
        s = s.replace(/^!(.+)$/gm, (match, prompt) => {
            return `![${prompt}](image://generate?prompt=${encodeURIComponent(prompt)})`;
        });
    }

    const images = [];
    const links = [];

    s = s.replace(/!\[([^\]]*?)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g, (match, alt, url) => {
      const id = images.length;
      images.push({ url, alt });
      return `___IMG_${id}___`;
    });

    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|tel:[^\s)]+|\/?[^\s)]*)\)/g, (match, label, url) => {
      const id = links.length;
      links.push({ label, url });
      return `___LINK_${id}___`;
    });

    s = escapeHtml(s);

    images.forEach((img, id) => {
      let fullUrl = img.url;
      if (fullUrl.startsWith('/')) {
        fullUrl = config.serverUrl + fullUrl;
      }
      if (fullUrl.startsWith('image://')) {
        const fileId = fullUrl.replace('image://', '');
        fullUrl = `https://gigachat.devices.sberbank.ru/api/v1/files/${fileId}/content`;
      }
      else if (!fullUrl.includes('/') && fullUrl.length > 20) {
        fullUrl = `https://gigachat.devices.sberbank.ru/api/v1/files/${fullUrl}/content`;
      }
      
      const imgHtml = `<img src="${fullUrl}" alt="${escapeHtml(img.alt)}" class="chat-inline-image" onclick="window.MityaWidget.openLightbox(this.src)" onerror="this.parentNode.innerHTML='<div style=\"padding:10px;border:1px dashed #ccc;border-radius:8px;font-size:12px;opacity:0.7;\">Изображение генерируется или недоступно</div>'">`;
      s = s.replace(`___IMG_${id}___`, imgHtml);
    });

    links.forEach((link, id) => {
      let finalUrl = link.url;
      let label = escapeHtml(link.label);
      
      if (finalUrl.startsWith('popup:')) {
        const popupUrl = finalUrl.replace('popup:', '');
        s = s.replace(`___LINK_${id}___`, `<a href="#" onclick="window.open('${popupUrl}', 'popup', 'width=600,height=600'); return false;" class="chat-link-popup" style="pointer-events: auto !important;">${label}</a>`);
      } else if (finalUrl.startsWith('cmd:')) {
        const cmd = finalUrl.replace('cmd:', '');
        s = s.replace(`___LINK_${id}___`, `<a href="#" onclick="window.dispatchEvent(new CustomEvent('mitya:command', {detail: '${cmd}'})); return false;" class="chat-link-cmd" style="pointer-events: auto !important;">${label}</a>`);
      } else {
        if (!finalUrl.includes('://') && !finalUrl.startsWith('mailto:') && !finalUrl.startsWith('tel:') && !finalUrl.startsWith('/')) {
          finalUrl = '/' + finalUrl;
        }
        
        if (finalUrl.startsWith('image://') || (finalUrl.includes('sberbank.ru') && finalUrl.includes('/files/'))) {
            let imgUrl = finalUrl;
            if (imgUrl.startsWith('image://')) {
                imgUrl = `https://gigachat.devices.sberbank.ru/api/v1/files/${imgUrl.replace('image://', '')}/content`;
            }
            s = s.replace(`___LINK_${id}___`, `<img src="${imgUrl}" alt="${label}" class="chat-inline-image">`);
        } else {
            s = s.replace(`___LINK_${id}___`, `<a href="${finalUrl}" target="_blank" rel="noopener noreferrer nofollow" style="pointer-events: auto !important;">${label}</a>`);
        }
      }
    });

    s = s.replace(/\[видео\]\((https?:\/\/(?:rutube\.ru|vk\.com\/video|vkvideo\.ru)[^\s)]+)\)/gi,
      (_, url) => {
        let embedUrl = url;
        if (url.includes('rutube.ru')) {
          const id = url.match(/\/video\/([a-z0-9]+)/i)?.[1];
          if (id) embedUrl = `https://rutube.ru/play/embed/${id}`;
        }
        return `<div class="chat-video-container" style="margin-top:10px;border-radius:12px;overflow:hidden;aspect-ratio:16/9;">
                  <iframe src="${embedUrl}" width="100%" height="100%" frameborder="0" allowfullscreen allow="autoplay; encrypted-media"></iframe>
                </div>`;
      });

    // ОБРАБОТКА КНОПОК (До Markdown, чтобы не создавались пустые списки)
    const buttonRegex = /\[button:([^\]|]+)\|([^\]|]*)(?:\|([^\]]*))?\]/g;
    let buttonsHtml = '';
    
    const matches = [...s.matchAll(buttonRegex)];
    if (matches.length > 0) {
        buttonsHtml = '<div class="chat-inline-buttons-container">';
        matches.forEach((match, index) => {
            const [fullMatch, label, cmd, type] = match;
            
            const forbiddenLabels = ['далее', 'продолжить', 'next', 'continue', 'ок', 'ok'];
            if (forbiddenLabels.includes(label.toLowerCase().trim())) return;

            let btnClass = 'btn-info';
            const t = type ? type.toLowerCase().trim() : '';
            
            if (t === 'accent' || t === 'left' || t === 'primary') {
                btnClass = 'btn-left';
            } else if (t === 'neutral' || t === 'right' || t === 'secondary') {
                btnClass = 'btn-right';
            } else {
                if (index === 0) btnClass = 'btn-left';
                else if (index === 1) btnClass = 'btn-right';
                else btnClass = 'btn-info';
            }
            
            buttonsHtml += `<button class="chat-inline-btn ${btnClass}" onclick="event.stopPropagation(); window.dispatchEvent(new CustomEvent('mitya:command', {detail: '${cmd.trim()}'}))"><span>${label.trim()}</span></button>`;
        });
        buttonsHtml += '</div>';
        s = s.replace(buttonRegex, '').trim();
    }
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');

    // АВТОЛИНКОВКА (превращаем обычные URL в кликабельные ссылки)
    // Исключаем те, что уже внутри тегов или атрибутов
    const urlRegex = /(?<!["'])(https?:\/\/[^\s<]+[^.,\s<])/g;
    s = s.replace(urlRegex, (url) => {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow" style="pointer-events: auto !important;">${url}</a>`;
    });

    // ОБРАБОТКА СПИСКОВ (Добавляем поддержку во время печати)
    if (!isFinal) {
      // Во время печати просто заменяем переносы на <br>, чтобы текст не пропадал
      s = s.replace(/^[ \t]*[-*+]\s+/gm, '• '); 
      s = s.replace(/^[ \t]*(\d+)\.\s+/gm, '$1. ');
    } else {
      s = s.replace(/(?:^|\n)((?:[-*] .+\n?)+)/g, (_match, block) => {
        const items = block.trim().split('\n').map(l => l.replace(/^[-*]\s+/, '').trim());
        const filteredItems = items.filter(i => i.length > 0);
        if (filteredItems.length === 0) return '';
        return '\n<ul>' + filteredItems.map(i => `<li>${i}</li>`).join('') + '</ul>';
      });
      s = s.replace(/^#+\s+(.+)$/gm, '<strong>$1</strong>');
    }

    s = s.split(/\n{2,}/).map(p => p.trim() ? `<p>${p.replace(/\n/g, '<br>')}</p>` : '').join('<div style="height:12px"></div>');

    if (buttonsHtml) {
        s += buttonsHtml;
    }

    return s || '';
}

export function updateAttachBtnVisibility(els, config) {
  if (els.attachBtn) {
    const isEnabled = config.theme && config.theme.btn_attach_enabled !== false;
    els.attachBtn.style.setProperty('display', isEnabled ? 'flex' : 'none', 'important');
  }
}

function truncateFileName(name, maxLength = 20) {
  if (!name || name.length <= maxLength) return name;
  const extIndex = name.lastIndexOf('.');
  if (extIndex !== -1 && name.length - extIndex < 6) {
    const ext = name.substring(extIndex);
    const base = name.substring(0, extIndex);
    return base.substring(0, maxLength - ext.length - 3) + '...' + ext;
  }
  return name.substring(0, maxLength - 3) + '...';
}

export function renderAttachedFiles(attachedFiles, els) {
  if (!els.attachedFilesBox) return;
  const validFiles = (attachedFiles || []).filter(f => f && f.name);
  if (validFiles.length === 0) {
    els.attachedFilesBox.innerHTML = '';
    els.attachedFilesBox.classList.remove('has-files');
    return;
  }
  els.attachedFilesBox.classList.add('has-files');
  els.attachedFilesBox.innerHTML = validFiles.map((file, index) => `
    <div class="attached-file-item" title="${escapeHtml(file.name)}">
      <span class="file-name">${escapeHtml(truncateFileName(file.name))}</span>
      <button class="remove-file" data-index="${index}">×</button>
    </div>
  `).join('');

  els.attachedFilesBox.querySelectorAll('.remove-file').forEach(btn => {
    btn.onclick = (e) => {
      const index = parseInt(e.target.dataset.index);
      attachedFiles.splice(index, 1);
      if (attachedFiles.length === 0) {
        if (window.MityaWidget && window.MityaWidget.hideAttachPreview) {
            window.MityaWidget.hideAttachPreview();
        } else {
            renderAttachedFiles(attachedFiles, els);
        }
      } else {
        renderAttachedFiles(attachedFiles, els);
      }
    };
  });
}

export function showAttachPreview(attachedFiles, els) {
    const demoFile = { name: 'demo-document.pdf', size: 1024 * 150 };
    const currentFiles = [...attachedFiles, demoFile];
    renderAttachedFiles(currentFiles, els);
}

export function hideAttachPreview(attachedFiles, els) {
    renderAttachedFiles(attachedFiles, els);
}

export function replaceContactPlaceholders(text, config) {
    const contacts = config.contacts || {};
    let result = text;

    if (contacts.phone) {
      const cleanPhone = contacts.phone.replace(/\D/g, '');
      const phoneMarkdown = `[${contacts.phone}](tel:${cleanPhone})`;
      const phoneRegex = new RegExp(contacts.phone.replace(/[-\s()]/g, '[-\\s()]?'), 'g');
      if (phoneRegex.test(result)) {
        result = result.replace(phoneRegex, phoneMarkdown);
      }
      result = result.replace(/(мой телефон|телефон|позвонить)(?: мне)?/gi, (match) => {
        return `${match} ${phoneMarkdown}`;
      });
    }

    if (contacts.email) {
      const emailMarkdown = `[${contacts.email}](mailto:${contacts.email})`;
      const emailRegex = new RegExp(contacts.email.replace(/[.+]/g, '\\$&'), 'g');
      if (emailRegex.test(result)) {
        result = result.replace(emailRegex, emailMarkdown);
      }
      result = result.replace(/(мо[йя] почт[ау]|email|электронн[аяу] почт[ау]|напишите мне)(?: на)?/gi, (match) => {
        return `${match} ${emailMarkdown}`;
      });
    }

    result = result.replace(/\[контактные данные\]/gi, () => {
      const links = [];
      if (contacts.phone) {
        const cleanPhone = contacts.phone.replace(/\D/g, '');
        links.push(`[${contacts.phone}](tel:${cleanPhone})`);
      }
      if (contacts.email) {
        links.push(`[${contacts.email}](mailto:${contacts.email})`);
      }
      if (contacts.telegram) {
        const tgUser = contacts.telegram.replace('@', '');
        links.push(`[Telegram](https://t.me/${tgUser})`);
      }
      if (contacts.whatsapp) {
        const waPhone = contacts.whatsapp.replace(/\D/g, '');
        links.push(`[WhatsApp](https://wa.me/${waPhone})`);
      }
      if (contacts.vk_url) {
        const vkUser = contacts.vk_url.replace('@', '').replace('https://vk.me/', '').replace('https://vk.com/', '');
        links.push(`[ВКонтакте](https://vk.com/${vkUser})`);
      }
      return links.join(', ');
    });

    return result;
}
