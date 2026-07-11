/**
 * Модуль управления мессенджерами (Telegram, WhatsApp) для раздела Интеллект
 */
export const MessengersSettings = {
    init(context) {
        this.context = context;
        this.bindEvents();
    },

    bindEvents() {
        const addTgBtn = document.getElementById('add-extra-tg-btn');
        if (addTgBtn) {
            addTgBtn.onclick = () => this.showAddPrompt('tg');
        }

        const addWaBtn = document.getElementById('add-extra-wa-btn');
        if (addWaBtn) {
            addWaBtn.onclick = () => this.showAddPrompt('wa');
        }

        const addMaxBtn = document.getElementById('add-extra-max-btn');
        if (addMaxBtn) {
            addMaxBtn.onclick = () => this.showAddPrompt('max');
        }

        const addVkBtn = document.getElementById('add-extra-vk-btn');
        if (addVkBtn) {
            addVkBtn.onclick = () => this.showAddPrompt('vk');
        }
    },

    showAddPrompt(messengerType) {
        const titles = {
            tg: 'Добавить Telegram',
            wa: 'Добавить WhatsApp',
            max: 'Добавить Max',
            vk: 'Добавить VK'
        };
        const title = titles[messengerType] || 'Добавить мессенджер';
        
        if (typeof window.showAlert !== 'function') {
            const label = prompt(`Введите название для нового ${messengerType.toUpperCase()}:`);
            if (label) this.addMessenger(messengerType, label);
            return;
        }

        const overlay = window.showAlert('tmpl-prompt-alert', {});
        if (overlay) {
            const titleEl = overlay.querySelector('.alert-title');
            const textEl = overlay.querySelector('.alert-text');
            if (titleEl) titleEl.textContent = title;
            if (textEl) textEl.textContent = 'Введите название';

            const input = overlay.querySelector('#prompt-input');
            const confirmBtn = overlay.querySelector('#prompt-confirm');
            const cancelBtn = overlay.querySelector('#prompt-cancel');
            const close = () => { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 300); };

            if (input) {
                input.placeholder = "Например: Новости";
                setTimeout(() => input.focus(), 100);
            }
            
            if (confirmBtn) {
                confirmBtn.onclick = () => {
                    const val = input.value.trim();
                    if (val) {
                        this.addMessenger(messengerType, val);
                        close();
                    }
                };
            }
            if (cancelBtn) cancelBtn.onclick = close;
        }
    },

    addMessenger(messengerType, label) {
        const stateKeyMap = {
            tg: 'extra_tg',
            wa: 'extra_wa',
            max: 'extra_max',
            vk: 'extra_vk'
        };
        const stateKey = stateKeyMap[messengerType];
        if (!this.context.state.contacts[stateKey]) this.context.state.contacts[stateKey] = [];
        
        let defaultMode = 'user';

        this.context.state.contacts[stateKey].push({
            id: Date.now(),
            label: label,
            value: '',
            mode: defaultMode
        });
        
        this.render(messengerType);
    },

    render(messengerType) {
        const stateKeyMap = {
            tg: 'extra_tg',
            wa: 'extra_wa',
            max: 'extra_max',
            vk: 'extra_vk'
        };
        const containerIdMap = {
            tg: 'extra-tg-container',
            wa: 'extra-wa-container',
            max: 'extra-max-container',
            vk: 'extra-vk-container'
        };
        const wrapperIdMap = {
            tg: 'extra-tg-wrapper',
            wa: 'extra-wa-wrapper',
            max: 'extra-max-wrapper',
            vk: 'extra-vk-wrapper'
        };

        const stateKey = stateKeyMap[messengerType];
        const containerId = containerIdMap[messengerType];
        const wrapperId = wrapperIdMap[messengerType];
        
        const container = document.getElementById(containerId);
        const wrapper = document.getElementById(wrapperId);
        if (!container) return;

        const accounts = this.context.state.contacts[stateKey] || [];
        
        if (wrapper) {
            wrapper.style.display = accounts.length > 0 ? 'block' : 'none';
        }

        let modes = { user: 'Пользователь', group: 'Группа' };
        if (messengerType === 'vk') {
            modes = { user: 'Пользователь', link: 'Ссылка' };
        }

        container.innerHTML = accounts.map((a, index) => `

            <div class="setting-item ${index === 0 ? '' : 'mt-10'}" data-id="${a.id}">
                <label class="subtitle-card">${a.label}</label>
                <div class="flex-row-gap-10">
                    <div class="custom-select messenger-mode-select" style="width: 138px;">
                        <div class="select-trigger" onclick="window.MessengersModule.toggleSelect(this, event)">
                            <span>${modes[a.mode] || 'Пользователь'}</span>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6"></path></svg>
                        </div>
                        <div class="select-options">
                            ${Object.entries(modes).map(([m_id, m_label]) => `
                                <div class="option ${a.mode === m_id ? 'active' : ''}" 
                                     onclick="window.MessengersModule.updateMode('${messengerType}', ${a.id}, '${m_id}')">${m_label}</div>
                            `).join('')}
                        </div>
                    </div>
                    <input type="text" class="hex-input-full" 
                           placeholder="${this.getPlaceholder(messengerType, a.mode)}" 
                           value="${a.value || ''}" 
                           readonly
                           onfocus="setTimeout(() => this.removeAttribute('readonly'), 50);"
                           onblur="this.setAttribute('readonly', true);"
                           oninput="window.MessengersModule.updateValue('${messengerType}', ${a.id}, this.value)">
                    <button type="button" class="action-btn-circle sm btn-danger" onclick="window.MessengersModule.removeMessenger('${messengerType}', ${a.id})" title="Удалить">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                </div>
            </div>
        `).join('');

        if (!this._clickBound) {
            document.addEventListener('click', () => {
                document.querySelectorAll('.custom-select.open').forEach(el => el.classList.remove('open'));
            });
            this._clickBound = true;
        }
    },

    toggleSelect(trigger, event) {
        event.stopPropagation();
        const currentSelect = trigger.parentElement;
        const isOpen = currentSelect.classList.contains('open');
        
        // Закрываем ВСЕ: и мессенджеры, и выпадающие списки стран
        document.querySelectorAll('.custom-select.open, .country-dropdown.show').forEach(el => {
            el.classList.remove('open', 'show');
        });
        
        // Если текущий был закрыт - открываем его
        if (!isOpen) {
            currentSelect.classList.add('open');
        }
    },

    getPlaceholder(type, mode) {
        if (type === 'tg') {
            if (mode === 'user') return '@username';
            return 't.me/joinchat/...';
        } else if (type === 'wa') {
            if (mode === 'user') return '+79991234567';
            return 'chat.whatsapp.com/...';
        } else if (type === 'max') {
            if (mode === 'user') return 'https://max.ru/c/...';
            return 'https://max.ru/join/...';
        } else if (type === 'vk') {
            if (mode === 'user') return '@username';
            return 'https://vk.me/...';
        }
    },

    updateMode(type, id, mode) {
        const stateKeyMap = { tg: 'extra_tg', wa: 'extra_wa', max: 'extra_max', vk: 'extra_vk' };
        const stateKey = stateKeyMap[type];
        const account = this.context.state.contacts[stateKey].find(a => a.id === id);
        if (account) {
            account.mode = mode;
            this.render(type);
        }
    },

    updateValue(type, id, value) {
        const stateKeyMap = { tg: 'extra_tg', wa: 'extra_wa', max: 'extra_max', vk: 'extra_vk' };
        const stateKey = stateKeyMap[type];
        const account = this.context.state.contacts[stateKey].find(a => a.id === id);
        if (account) {
            account.value = value.trim();
        }
    },

    removeMessenger(type, id) {
        const stateKeyMap = { tg: 'extra_tg', wa: 'extra_wa', max: 'extra_max', vk: 'extra_vk' };
        const stateKey = stateKeyMap[type];
        this.context.state.contacts[stateKey] = this.context.state.contacts[stateKey].filter(a => a.id !== id);
        this.render(type);
    },

    // Алиасы для совместимости с assistant.js
    renderExtraTg() { this.render('tg'); },
    renderExtraWa() { this.render('wa'); },
    renderExtraMax() { this.render('max'); },
    renderExtraVk() { this.render('vk'); }
};

window.MessengersModule = MessengersSettings;
