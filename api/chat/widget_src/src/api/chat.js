import { renderMarkdown } from '../ui/render';
import { applyTheme } from '../ui/theme';
import { getWidgetStorageScope } from '../core/config';

export async function loadChatHistory(config, chatToken, els, addMessage, scrollToBottom, generateFingerprint, setCookie) {
    try {
      if (!chatToken) return;


      const isPrivacyEnabled = config.theme?.chat_privacy_enabled !== false;

      if (isPrivacyEnabled && !els.messagesContainer.querySelector('.chat-privacy-note')) {
        const privacyDiv = document.createElement('div');
        privacyDiv.className = 'chat-privacy-note';
        privacyDiv.id = 'chat-privacy-note';
        privacyDiv.style.marginBottom = '15px';
        
        const privacyUrl = config.theme?.chat_privacy_url || config.privacyUrl || 'https://mitia.pro/privacy';
        const privacyTarget = config.theme?.chat_privacy_target_blank !== false ? '_blank' : '_self';
        
        privacyDiv.innerHTML = `Отправляя сообщения в чат, вы соглашаетесь с&nbsp;<a href="${privacyUrl}" target="${privacyTarget}">политикой конфиденциальности</a>`;
        els.messagesContainer.appendChild(privacyDiv);
        els.privacyNote = privacyDiv;
      } else if (!isPrivacyEnabled) {
        const existingPrivacy = els.messagesContainer.querySelector('.chat-privacy-note');
        if (existingPrivacy) existingPrivacy.remove();
      }

      const res = await fetch(`${config.serverUrl}/api/chat/history?token=${chatToken}&client_id=${config.clientId}&t=${Date.now()}`);
      
      if (window.isStreamingActive || window.isPrinting || els.window.classList.contains('active-typing')) {
        console.log('[Chat] History update skipped: streaming in progress');
        return;
      }

      if (res.status === 404 || res.status === 401 || res.status === 403) {
        console.log('[Chat] Session invalid or deleted (403/404). Resetting token...');
        const tokenKey = `chat_token_${getWidgetStorageScope(config)}`;
        localStorage.removeItem(tokenKey);
        const newToken = generateFingerprint(config.clientId);
        localStorage.setItem(tokenKey, newToken);
        setCookie(tokenKey, newToken, 365);
        window.chatToken = newToken;
        return;
      }

      if (!res.ok) return;

      const data = await res.json();
      const history = data.history || [];
      const welcomeKey = `mitya_welcome_message_${getWidgetStorageScope(config)}_${chatToken}`;
      const canShowWelcome = history.length === 0
        && config.welcome_msg?.trim()
        && !sessionStorage.getItem(welcomeKey)
        && !els.messagesContainer.querySelector('.message.is-welcome');
      
      if (window.isPrinting || window.isStreamingActive || els.window.classList.contains('active-typing')) {
          return;
      }

      const lastMsg = history.length > 0 ? history[history.length - 1] : null;
      const currentHash = history.length + (lastMsg ? lastMsg.content + (lastMsg.timestamp || '') : '');
      
      if (window.lastHistoryHash === currentHash) return;
      window.lastHistoryHash = currentHash;

      els.messagesContainer.querySelectorAll('.message:not(.is-welcome):not([data-is-preview="true"])').forEach(m => m.remove());
      els.messagesContainer.querySelectorAll('.date-separator').forEach(m => m.remove());

      history.forEach((msg, index) => {
        if (msg.content === config.welcome_msg && msg.role === 'assistant') return;
        const isLast = index === history.length - 1;
        const role = msg.author_role === 'operator'
          ? 'operator'
          : (msg.role === 'assistant' ? 'bot' : 'user');
        addMessage(msg.content, role, {
          author_role: msg.author_role,
          noScroll: true,
          isHistory: true,
          isLastInHistory: isLast,
          timestamp: msg.timestamp,
          files: msg.attachments ? msg.attachments.map(att => ({
            name: att.name || att.file_name,
            type: att.content_type || att.type,
            size: att.file_size || att.size || 0,
            data: att.data,
            url: att.url || att.file_url || att.local_url || att.file_path,
            isHistory: true
          })) : []
        }, config, els);
      });

      if (canShowWelcome) {
        addMessage(config.welcome_msg, 'bot', { noScroll: true, isWelcome: true }, config, els);
        sessionStorage.setItem(welcomeKey, 'true');
      }
      
      if (els.window.classList.contains('is-active')) {
          setTimeout(() => {
            scrollToBottom(els);
            setTimeout(() => scrollToBottom(els), 200);
          }, 50);
      }
    } catch (e) {
      console.warn('[Chat] Failed to load history:', e);
    }
}

async function getClientIp() {
    try {
        const res = await fetch('https://api.ipify.org?format=json');
        const data = await res.json();
        return data.ip;
    } catch (e) {
        return null;
    }
}

export async function sendMessage(manualText, config, chatToken, sessionId, els, attachedFiles, state, options = {}) {
    const text = (manualText || els.input.value).trim();
    if (!text && attachedFiles.length === 0) return;

    els.messagesContainer.querySelectorAll('.chat-inline-btn').forEach(btn => {
        btn.classList.add('is-disabled');
        btn.style.pointerEvents = 'none';
    });

    const filesToSend = [...attachedFiles];
    if (options.onFilesClear) options.onFilesClear();

    if (text || filesToSend.length > 0) {
        await options.addMessage(text || '', 'user', { 
            files: filesToSend,
            timestamp: new Date().toISOString() 
        }, config, els);
    }

    if (!manualText) {
      els.input.value = '';
      els.input.style.height = 'auto';
    }

    state.isStopRequested = false;
    window.isStopRequested = false;
    window.isStreamingActive = true;
    
    if (window.updateMicState) window.updateMicState(els, config, window.attachedFiles);

    const typewriterEnabled = config.theme?.chat_typewriter_enabled === true || config.theme?.chat_typewriter_enabled === 'true';
    const typingIndicatorEnabled = config.theme?.chat_typing_indicator_enabled === true || config.theme?.chat_typing_indicator_enabled === 'true';
    const isOperatorMode = document.body.classList.contains('mitya-operator-active');

    if (typingIndicatorEnabled) {
        options.showTyping(true, els);
    }

    let botMsgDiv = null;

    try {
      const typingAbortController = new AbortController();
      window.typingAbortController = typingAbortController;
      if (options.onAbortController) options.onAbortController(typingAbortController);
      
      const clientIp = await getClientIp();
      
      const formData = new FormData();
      formData.append('client_id', config.clientId);
      if (config.assistantId) formData.append('assistant_id', config.assistantId);
      formData.append('token', chatToken);
      formData.append('message', text || '');
      formData.append('session_id', sessionId || '');
      formData.append('source', 'widget');
      formData.append('stream', typewriterEnabled ? 'true' : 'false');
      formData.append('context', JSON.stringify({ 
        url: location.href, 
        title: document.title,
        inline_buttons_enabled: config.theme?.inline_buttons_enabled !== false
      }));
      
      if (clientIp) {
        formData.append('metadata', JSON.stringify({ client_ip: clientIp }));
      }
      
      filesToSend.forEach(file => formData.append('files', file));

      const response = await fetch(`${config.serverUrl}/api/chat/ask`, {
        method: 'POST',
        body: formData,
        signal: typingAbortController.signal
      });

      const contentType = response.headers.get('content-type');
      
      if (!typewriterEnabled || (contentType && contentType.includes('application/json'))) {
        const data = await response.json();
        
        if (data.status === 'waiting_for_operator') {
            options.showTyping(false, els);
            window.isStreamingActive = false;
            window.isPrinting = false;
            const msg = data.message || data.response || 'Ассистент временно недоступен, я передал ваш вопрос оператору. Оставьте контакты, мы ответим в ближайшее время.';

            if (typewriterEnabled) {
                botMsgDiv = await options.addMessage('', 'bot', {
                    isStreaming: true,
                    timestamp: new Date().toISOString()
                }, config, els);

                if (botMsgDiv && typeof botMsgDiv.updateStreamingText === 'function') {
                    botMsgDiv.updateStreamingText(msg);
                    botMsgDiv.isStreaming = false;
                } else {
                    await options.addMessage(msg, 'bot', { timestamp: new Date().toISOString() }, config, els);
                }
            } else {
                await options.addMessage(msg, 'bot', { timestamp: new Date().toISOString() }, config, els);
            }
            return;
        }

        if (typingIndicatorEnabled) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        window.isStreamingActive = false;
        window.isPrinting = false;
        options.showTyping(false, els);

        if (data.audio_url && window.MityaMedia) {
            window.MityaMedia.playAudioUrl(data.audio_url);
        }

        if (data.response) {
          if (botMsgDiv) {
            botMsgDiv.updateStreamingText(data.response);
            botMsgDiv.isStreaming = false;
          } else {
            await options.addMessage(data.response, 'bot', { 
                typewriter: false,
                timestamp: new Date().toISOString()
            }, config, els);
          }
        } else if (data.error) {
          options.addMessage(`Ошибка: ${data.error}`, 'bot', {}, config, els);
        }
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullBotText = '';
      let streamBuffer = '';

      if (typingIndicatorEnabled) {
          await new Promise(resolve => setTimeout(resolve, 2000));
      }

      while (true) {
        const { done, value } = await reader.read();
        
        if (value) {
          streamBuffer += decoder.decode(value, { stream: true });
          const lines = streamBuffer.split('\n');
          streamBuffer = lines.pop();
          
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;
            
            try {
              const data = JSON.parse(trimmedLine.slice(6));
              
              if (data.audio_url && window.MityaMedia) {
                window.MityaMedia.playAudioUrl(data.audio_url);
              }

              if (data.done) {
                console.log('[Chat] Stream finished via done flag');
                if (botMsgDiv) botMsgDiv.isStreaming = false;
                window.isStreamingActive = false;
                break;
              }

              if (data.theme_update || data.bot_update || data.trigger_save) {
                if (data.theme_update) {
                    applyTheme(data.theme_update, config, els, window.shadow, { is_local_update: true });
                }
                window.parent.postMessage({ 
                    type: 'apply_theme_from_bot', 
                    theme: data.theme_update,
                    bot_settings: data.bot_update
                }, '*');
              }

              if (data.status === 'function_call' || data.function_call) {
                console.log('[Chat] AI requested function call:', data.function || data.function_call);
                continue;
              }

              if (data.content) {
                fullBotText += data.content;
                
                const currentRole = data.role || 'bot';

                if (!botMsgDiv) {
                  botMsgDiv = await options.addMessage(fullBotText, currentRole, { 
                    typewriter: true, 
                    isStreaming: true,
                    timestamp: new Date().toISOString()
                  }, config, els);
                } else {
                  if (!botMsgDiv.isPrintingStarted && botMsgDiv.startPrinting) {
                    botMsgDiv.startPrinting();
                  }
                  if (botMsgDiv.updateStreamingText && !window.isStopRequested) {
                    botMsgDiv.updateStreamingText(fullBotText);
                  }
                }
              }
            } catch (e) {}
          }
        }

        if (done || state.isStopRequested || window.isStopRequested) {
          if (streamBuffer && streamBuffer.trim().startsWith('data: ')) {
            try {
              const data = JSON.parse(streamBuffer.trim().slice(6));
              
              if (data.audio_url && window.MityaMedia) {
                window.MityaMedia.playAudioUrl(data.audio_url);
              }

              if (data.content) {
                fullBotText += data.content;
                if (botMsgDiv) {
                    botMsgDiv.updateStreamingText(fullBotText);
                } else {
                    await options.addMessage(fullBotText, 'bot', { 
                        typewriter: true, 
                        timestamp: new Date().toISOString() 
                    }, config, els);
                }
              }
            } catch (e) {}
          }

          options.showTyping(false, els);

          if (state.isStopRequested || window.isStopRequested) {
            window.isStreamingActive = false;
            window.isPrinting = false;
            window.lastHistoryHash = "manual_stop_" + Date.now();
            options.showTyping(false, els);
            if (window.updateMicState) window.updateMicState(els, config, window.attachedFiles);
            break;
          }

          if (botMsgDiv) {
            botMsgDiv.isStreaming = false;
            if (fullBotText && botMsgDiv.updateStreamingText) {
              botMsgDiv.updateStreamingText(fullBotText);
            }
          }
          
          window.isStreamingActive = false;
          if (window.updateMicState) window.updateMicState(els, config, window.attachedFiles);
          break;
        }
      }

      window.parent.postMessage({ type: 'mitya:new-message' }, '*');
      if (window.updateMicState) window.updateMicState(els, config, window.attachedFiles);

    } catch (err) {
      console.error('[Chat] Error in sendMessage:', err);
      window.isStreamingActive = false;
      window.isPrinting = false;
      options.showTyping(false, els);
      if (window.updateMicState) window.updateMicState(els, config, window.attachedFiles);
    }
}
