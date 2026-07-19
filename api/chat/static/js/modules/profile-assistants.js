const ASSISTANTS_UI_STATE_KEY = 'profile_assistants_ui_state_v1';

export function normalizeAssistantItem(rawAssistant = {}) {
    const config = rawAssistant.config || {};
    const botSettings = config.bot_settings || {};
    const theme = config.theme || {};
    const integrations = config.integrations || {};
    const integrationItems = [
        { key: 'widget', enabled: !!integrations.widget?.enabled, icon: '/api/chat/img/icon_earth.svg', label: 'Сайт' },
        { key: 'telegram', enabled: !!integrations.telegram?.enabled, icon: '/api/chat/img/icon_telegram.svg', label: 'Telegram' },
        { key: 'vk', enabled: !!integrations.vk?.enabled, icon: '/api/chat/img/icon_vk.svg', label: 'VK' },
        { key: 'max', enabled: !!integrations.max?.enabled, icon: '/api/chat/img/icon_max.svg', label: 'MAX' },
        { key: 'email', enabled: !!integrations.email?.enabled, icon: '/api/chat/img/icon_envelope.svg', label: 'Email' },
        { key: 'avito', enabled: !!integrations.avito?.enabled, icon: '/api/chat/img/icon_avito.svg', label: 'Avito' },
        { key: 'hh', enabled: !!integrations.hh?.enabled, icon: '/api/chat/img/icon_hh.svg', label: 'HeadHunter' },
        { key: 'whatsapp', enabled: !!integrations.whatsapp?.enabled, icon: '/api/chat/img/icon-whatsapp-business.svg', label: 'WhatsApp' }
    ].filter((item) => item.enabled);

    return {
        id: rawAssistant.assistant_id || rawAssistant.id,
        name: String(botSettings.bot_name || rawAssistant.name || '').trim() || 'Митя',
        role: String(botSettings.bot_role || rawAssistant.role || '').trim() || 'ИИ-ассистент',
        integrations: integrationItems,
        preview: this.getWidgetPreviewStyle(config.theme || theme || {}),
        isActive: !!rawAssistant.is_selected,
        isDefault: !!rawAssistant.is_default,
        config
    };
}

export function getAssistantsData(config = {}) {
    const backendItems = Array.isArray(this.state.assistants_backend_items) ? this.state.assistants_backend_items : [];
    if (backendItems.length) {
        return backendItems.map((item) => this.normalizeAssistantItem(item));
    }
    return [this.normalizeAssistantItem({
        assistant_id: config.assistant_id || 'main',
        name: config.bot_settings?.bot_name || 'Митя',
        role: config.bot_settings?.bot_role || 'ИИ-ассистент',
        is_selected: true,
        is_default: true,
        config
    })];
}

export function updateAssistantCard(config = {}) {
    const listEl = document.getElementById('profile-assistants-list');
    if (!listEl) return;

    const assistants = this.getAssistantsData(config);
    const removeBtn = document.getElementById('profile-remove-assistant-btn');
    const canDeleteAssistants = assistants.length > 1;
    if (removeBtn) {
        removeBtn.hidden = !canDeleteAssistants;
        if (!canDeleteAssistants) {
            this.state.assistants_selection_mode = false;
            this.state.assistants_selected_ids = new Set();
            removeBtn.classList.remove('menu-open');
            removeBtn.setAttribute('aria-pressed', 'false');
        }
    }
    const savedActiveAssistantId = this.state.savedActiveAssistantId || this.state.assistants_active_id || (assistants[0] ? assistants[0].id : null);
    const draftActiveAssistantId = this.state.draftActiveAssistantId || savedActiveAssistantId;
    this.state.savedActiveAssistantId = savedActiveAssistantId;
    this.state.draftActiveAssistantId = draftActiveAssistantId;
    this.state.assistants_active_id = savedActiveAssistantId;
    this.state.assistants_items = assistants.map((assistant, index) => ({
        ...assistant,
        isActive: assistant.id === savedActiveAssistantId,
        isDraftSelected: assistant.id === draftActiveAssistantId,
        isSystem: index === 0
    }));

    listEl.innerHTML = this.state.assistants_items.map((assistant) => {
        const integrationsHtml = assistant.integrations.length
            ? assistant.integrations.map((item) => `
                    <span class="assistant-integration-icon" title="${item.label}" aria-label="${item.label}">
                        <img src="${item.icon}" alt="${item.label}">
                    </span>
                `).join('')
            : `
                    <span class="assistant-integrations-empty" aria-label="Интеграции не подключены">
                        <span class="assistant-integrations-empty-icon" aria-hidden="true">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                            </svg>
                        </span>
                        <span class="assistant-integrations-empty-text">Интеграции не подключены</span>
                    </span>
                `;
        const isMultiSelected = Boolean(this.state.assistants_selected_ids?.has(assistant.id));
        const tileClasses = [
            'assistant-tile',
            'assistant-tile-profile',
            assistant.isDraftSelected ? ' is-selected' : '',
            this.state.assistants_selection_mode && !assistant.isSystem ? ' is-selection-mode' : '',
            isMultiSelected ? ' is-multi-selected' : ''
        ].filter(Boolean).join(' ');
        const toggleHtml = this.state.assistants_selection_mode && !assistant.isSystem
            ? '<span class="assistant-select-toggle" aria-hidden="true"></span>'
            : '';

        return `
                <button type="button" class="${tileClasses}" data-assistant-id="${assistant.id}" aria-label="Ассистент ${assistant.name}">
                    <div class="assistant-tile-main">
                        <div class="assistant-inline-head${toggleHtml ? ' with-toggle' : ''}">
                            <div class="assistant-inline-head">
                                ${this.renderAssistantAvatar(assistant.preview, 'assistant-widget-preview')}
                                <div class="assistant-inline-copy">
                                    <span class="assistant-name">${assistant.name}</span>
                                    <span class="assistant-role">${assistant.role}</span>
                                </div>
                            </div>
                            ${toggleHtml}
                        </div>
                        <span class="assistant-integrations" aria-label="Подключенные интеграции" style="display:flex;">${integrationsHtml}</span>
                    </div>
                </button>
            `;
    }).join('');

    listEl.querySelectorAll('[data-assistant-id]').forEach((tileEl) => {
        tileEl.addEventListener('click', async (event) => {
            event.preventDefault();
            const assistantId = tileEl.dataset.assistantId;
            if (!assistantId) return;

            const clickedAssistant = (this.state.assistants_items || []).find((assistant) => assistant.id === assistantId) || null;
            if (!clickedAssistant) return;

            if (this.state.assistants_selection_mode) {
                if (clickedAssistant.isSystem) return;
                const selectedIds = new Set(this.state.assistants_selected_ids || []);
                if (selectedIds.has(assistantId)) selectedIds.delete(assistantId);
                else selectedIds.add(assistantId);
                this.state.assistants_selected_ids = selectedIds;
                this.syncAssistantsSidebarState();
                this.updateAssistantCard(config);
                return;
            }

            if (assistantId === this.state.draftActiveAssistantId) return;

            this.state.draftActiveAssistantId = assistantId;
            this.state.assistants_items = (this.state.assistants_items || []).map((assistant) => ({
                ...assistant,
                isActive: assistant.id === this.state.savedActiveAssistantId,
                isDraftSelected: assistant.id === assistantId
            }));

            const selectedAssistant = (this.state.assistants_items || []).find((assistant) => assistant.id === assistantId) || null;

            this.updateAssistantCard({
                ...config,
                assistant_id: assistantId
            });

            if (selectedAssistant?.config?.theme && window.MityaWidget && typeof window.MityaWidget.applyTheme === 'function') {
                window.MityaWidget.applyTheme(selectedAssistant.config.theme, {
                    assistant_id: assistantId,
                    is_local_update: true,
                    force_position: true
                });
            }

            if (window.AdminApp && typeof window.AdminApp.setActiveAssistantId === 'function') {
                await window.AdminApp.setActiveAssistantId(assistantId, { silent: false, persist: false });
            }
        });
    });
}

export function getAssistantsUiStorageKey() {
    const clientId = this.state.client_id || localStorage.getItem('chat_client_id') || 'mitia_assistant';
    return `${ASSISTANTS_UI_STATE_KEY}:${clientId}`;
}

export function persistAssistantsUiState() {
    try {
        localStorage.setItem(this.getAssistantsUiStorageKey(), JSON.stringify({
            panelOpen: Boolean(this.state.assistants_panel_open),
            selectionMode: Boolean(this.state.assistants_selection_mode)
        }));
    } catch (_) {}
}

export function restoreAssistantsUiState() {
    this.state.assistants_panel_open = false;
    this.state.assistants_selection_mode = false;
    this.state.assistants_selected_ids = new Set();
    try {
        localStorage.removeItem(this.getAssistantsUiStorageKey());
    } catch (_) {}
}

export function initAssistantsMode() {
    this.state.assistants_panel_open = false;
    this.state.assistants_selection_mode = false;
    this.state.assistants_selected_ids = new Set();
    this.state.savedActiveAssistantId = null;
    this.state.draftActiveAssistantId = null;

    const sidebar = document.querySelector('.admin-sidebar');
    const backBtn = document.getElementById('assistants-sidebar-back-btn');
    const createBtn = document.getElementById('assistants-sidebar-create-btn');
    const editBtn = document.getElementById('assistants-sidebar-edit-btn');
    const deleteBtn = document.getElementById('assistants-sidebar-delete-btn');
    const globalDeleteBtn = document.getElementById('global-assistants-delete-btn');
    const saveBtn = document.getElementById('assistants-sidebar-save-btn');
    const removeBtn = document.getElementById('profile-remove-assistant-btn');

    this._assistantsHandlers = {
        onBack: () => this.closeAssistantsPanel(),
        onCreate: () => this.createAssistantFlow(),
        onEdit: () => this.toggleAssistantsSelectionMode(),
        onDelete: () => this.deleteSelectedAssistants(),
        onGlobalDelete: () => this.deleteSelectedAssistants(),
        onSave: () => this.saveActiveAssistantSelection(),
        onRemoveToggle: () => this.toggleAssistantsSelectionMode(),
        onEscape: (event) => {
            if (event.key === 'Escape' && this.state.assistants_panel_open) {
                this.closeAssistantsPanel();
            }
        }
    };

    if (backBtn) backBtn.addEventListener('click', this._assistantsHandlers.onBack);
    if (createBtn) createBtn.addEventListener('click', this._assistantsHandlers.onCreate);
    if (editBtn) editBtn.addEventListener('click', this._assistantsHandlers.onEdit);
    if (deleteBtn) deleteBtn.addEventListener('click', this._assistantsHandlers.onDelete);
    if (globalDeleteBtn) globalDeleteBtn.addEventListener('click', this._assistantsHandlers.onGlobalDelete);
    if (saveBtn) saveBtn.addEventListener('click', this._assistantsHandlers.onSave);
    if (removeBtn) removeBtn.addEventListener('click', this._assistantsHandlers.onRemoveToggle);
    document.addEventListener('keydown', this._assistantsHandlers.onEscape);

    this._assistantsSidebar = sidebar;
    this.restoreAssistantsUiState();
}

export function teardownAssistantsMode() {
    const backBtn = document.getElementById('assistants-sidebar-back-btn');
    const createBtn = document.getElementById('assistants-sidebar-create-btn');
    const editBtn = document.getElementById('assistants-sidebar-edit-btn');
    const deleteBtn = document.getElementById('assistants-sidebar-delete-btn');
    const globalDeleteBtn = document.getElementById('global-assistants-delete-btn');
    const saveBtn = document.getElementById('assistants-sidebar-save-btn');
    const removeBtn = document.getElementById('profile-remove-assistant-btn');

    if (this._assistantsHandlers) {
        if (backBtn) backBtn.removeEventListener('click', this._assistantsHandlers.onBack);
        if (createBtn) createBtn.removeEventListener('click', this._assistantsHandlers.onCreate);
        if (editBtn) editBtn.removeEventListener('click', this._assistantsHandlers.onEdit);
        if (deleteBtn) deleteBtn.removeEventListener('click', this._assistantsHandlers.onDelete);
        if (globalDeleteBtn) globalDeleteBtn.removeEventListener('click', this._assistantsHandlers.onGlobalDelete);
        if (saveBtn) saveBtn.removeEventListener('click', this._assistantsHandlers.onSave);
        if (removeBtn) removeBtn.removeEventListener('click', this._assistantsHandlers.onRemoveToggle);
        document.removeEventListener('keydown', this._assistantsHandlers.onEscape);
    }
    this.persistAssistantsUiState();
}

export function openAssistantsPanel() {}

export function closeAssistantsPanel() {}

export function toggleAssistantsSelectionMode() {
    const items = Array.isArray(this.state.assistants_items) ? this.state.assistants_items : [];
    if (!items.length) return;
    this.state.assistants_selection_mode = !this.state.assistants_selection_mode;
    if (!this.state.assistants_selection_mode) {
        this.state.assistants_selected_ids = new Set();
    }
    this.updateAssistantCard({ assistant_id: this.state.draftActiveAssistantId || this.state.savedActiveAssistantId });
    this.syncAssistantsSidebarState();
    this.renderAssistantsPanel();
    this.persistAssistantsUiState();
}

export function syncAssistantsSidebarState() {
    const editBtn = document.getElementById('assistants-sidebar-edit-btn');
    const deleteBtn = document.getElementById('assistants-sidebar-delete-btn');
    const globalDeleteBtn = document.getElementById('global-assistants-delete-btn');
    const saveBtn = document.getElementById('assistants-sidebar-save-btn');
    const removeBtn = document.getElementById('profile-remove-assistant-btn');
    const assistantItems = Array.isArray(this.state.assistants_items) ? this.state.assistants_items : [];
    const hasItems = assistantItems.length > 0;
    const hasSelection = this.state.assistants_selected_ids && this.state.assistants_selected_ids.size > 0;
    const canSwitchActiveAssistant = assistantItems.length > 1;

    if (editBtn) {
        editBtn.disabled = !hasItems;
        editBtn.classList.toggle('is-active', !!this.state.assistants_selection_mode);
    }
    if (removeBtn) {
        removeBtn.classList.toggle('menu-open', !!this.state.assistants_selection_mode);
        removeBtn.setAttribute('aria-pressed', this.state.assistants_selection_mode ? 'true' : 'false');
    }

    const shouldShowDelete = this.state.assistants_selection_mode && hasSelection;

    if (deleteBtn) {
        deleteBtn.hidden = !shouldShowDelete;
        deleteBtn.disabled = !shouldShowDelete;
        deleteBtn.classList.toggle('is-active', shouldShowDelete);
        deleteBtn.title = 'Удалить выбранных ассистентов';
    }
    if (globalDeleteBtn) {
        globalDeleteBtn.hidden = !shouldShowDelete;
        globalDeleteBtn.disabled = !shouldShowDelete;
        globalDeleteBtn.title = 'Удалить выбранных ассистентов';
    }
    if (saveBtn) {
        const hasDraftChanges = canSwitchActiveAssistant
            && !!this.state.draftActiveAssistantId
            && this.state.draftActiveAssistantId !== this.state.savedActiveAssistantId;
        saveBtn.disabled = !hasItems || !canSwitchActiveAssistant || !hasDraftChanges;
        saveBtn.classList.toggle('is-active', hasDraftChanges);
    }
}

export function renderAssistantsPanel() {
    this.syncAssistantsSidebarState();
}

export async function saveActiveAssistantSelection() {
    const nextAssistantId = this.state.draftActiveAssistantId || this.state.savedActiveAssistantId;
    if (!nextAssistantId || nextAssistantId === this.state.savedActiveAssistantId) return;

    const activeAssistant = (this.state.assistants_items || []).find((assistant) => assistant.id === nextAssistantId);
    if (!activeAssistant) return;

    this.state.savedActiveAssistantId = nextAssistantId;
    this.state.assistants_active_id = nextAssistantId;
    this.state.assistants_items = (this.state.assistants_items || []).map((assistant) => ({
        ...assistant,
        isActive: assistant.id === nextAssistantId,
        isDraftSelected: assistant.id === nextAssistantId
    }));
    this.persistAssistantsUiState();
    this.renderAssistantsPanel();
    if (window.AdminApp && typeof window.AdminApp.setActiveAssistantId === 'function') {
        await window.AdminApp.setActiveAssistantId(nextAssistantId, { silent: false, persist: true });
    }
    await this.loadData();

    if (typeof this.showAlert === 'function') {
        this.showAlert('tmpl-success-alert', {
            title: 'Сохранено',
            text: `Активный ассистент: ${activeAssistant.name}`
        });
    }
}

export async function deleteSelectedAssistants() {
    if (!this.state.assistants_selection_mode || !this.state.assistants_selected_ids.size) return;

    const selectedCount = this.state.assistants_selected_ids.size;
    const confirmed = await this.confirmAssistantsDeletion(selectedCount);
    if (!confirmed) return;

    const clientId = this.state.client_id || localStorage.getItem('chat_client_id') || 'mitia_assistant';
    const token = localStorage.getItem('chatadmin_auth_token');
    const selectedIds = Array.from(this.state.assistants_selected_ids);
    const systemAssistant = (this.state.assistants_items || []).find((assistant) => assistant.isSystem) || null;
    const activeRemoved = selectedIds.includes(this.state.savedActiveAssistantId);

    if (activeRemoved && systemAssistant) {
        this.state.savedActiveAssistantId = systemAssistant.id;
        this.state.draftActiveAssistantId = systemAssistant.id;
        this.state.assistants_active_id = systemAssistant.id;
        if (window.AdminApp && typeof window.AdminApp.setActiveAssistantId === 'function') {
            await window.AdminApp.setActiveAssistantId(systemAssistant.id, { silent: true, persist: true });
        }
    }

    if (token) {
        for (const assistantId of selectedIds) {
            await fetch(`/api/chat/admin/assistants/${encodeURIComponent(assistantId)}?client_id=${encodeURIComponent(clientId)}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        }
    }

    this.state.assistants_selected_ids = new Set();
    this.state.assistants_selection_mode = false;
    const removeBtn = document.getElementById('profile-remove-assistant-btn');
    if (removeBtn) removeBtn.classList.remove('menu-open');
    await this.loadData();
    this.syncAssistantsSidebarState();
    this.renderAssistantsPanel();
    this.persistAssistantsUiState();
}

export async function createAssistantFlow() {
    const assistants = Array.isArray(this.state.assistants_backend_items) ? this.state.assistants_backend_items : [];
    const assistantsLimit = Number(this.state.assistants_limit || 0);
    const tariffAssistantsLimit = Number(this.state.tariff_assistants_limit || 0);
    const extraAssistants = Number(this.state.extra_assistants_purchased || 0);
    const hardCap = Number(this.state.assistants_hard_cap || 0);
    const currentTariffId = this.getCurrentTariffId ? this.getCurrentTariffId() : 'start';
    if (hardCap > 0 && assistants.length >= hardCap) {
        this.showAlert('tmpl-error-alert', {
            title: 'Лимит ассистентов',
            text: `Достигнут технический предел аккаунта — максимум ${hardCap} ассистентов. Чтобы увеличить лимит выше, обратитесь в поддержку.`
        });
        return;
    }
    if (assistantsLimit > 0 && assistants.length >= assistantsLimit) {
        let text = `На аккаунте уже использован доступный лимит ассистентов — максимум ${assistantsLimit}. Сейчас это ${tariffAssistantsLimit} по тарифу + ${extraAssistants} куплено. Чтобы увеличить лимит, перейдите в раздел тарифов.`;
        if (currentTariffId === 'start' && extraAssistants <= 0) {
            text = 'На тарифе «Старт» доступен 1 ассистент. Чтобы создать ещё ассистентов, перейдите в раздел тарифов и купите дополнительные слоты или смените тариф.';
        }
        this.showAlert('tmpl-error-alert', { title: 'Лимит ассистентов', text });
        return;
    }

    const template = document.getElementById('tmpl-assistant-create-alert');
    if (!template) return;

    const clone = document.importNode(template.content, true);
    const overlay = clone.querySelector('.custom-alert-overlay');
    const nameInput = clone.getElementById('assistant-create-name');
    const roleInput = clone.getElementById('assistant-create-role');
    const cancelBtn = clone.getElementById('assistant-create-cancel');
    const confirmBtn = clone.getElementById('assistant-create-confirm');
    if (!overlay || !nameInput || !roleInput || !cancelBtn || !confirmBtn) return;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => { overlay.style.opacity = '1'; nameInput.focus(); });

    const close = () => {
        overlay.style.opacity = '0';
        document.body.style.overflow = '';
        setTimeout(() => overlay.remove(), 300);
    };

    const submit = async () => {
        const name = String(nameInput.value || '').trim();
        const role = String(roleInput.value || '').trim();
        if (!name && !role) {
            if (typeof window.showAlert === 'function') {
                window.showAlert('tmpl-error-alert', { title: 'Не сохранено', text: 'Заполните имя и должность.' });
            }
            nameInput.focus();
            return;
        }
        if (!name) {
            if (typeof window.showAlert === 'function') {
                window.showAlert('tmpl-error-alert', { title: 'Не сохранено', text: 'Заполните имя.' });
            }
            nameInput.focus();
            return;
        }
        if (!role) {
            if (typeof window.showAlert === 'function') {
                window.showAlert('tmpl-error-alert', { title: 'Не сохранено', text: 'Заполните должность.' });
            }
            roleInput.focus();
            return;
        }
        const clientId = this.state.client_id || localStorage.getItem('chat_client_id') || 'mitia_assistant';
        const token = localStorage.getItem('chatadmin_auth_token');
        if (!token) {
            close();
            return;
        }

        confirmBtn.disabled = true;
        const res = await fetch('/api/chat/admin/assistants', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ client_id: clientId, name, role })
        });
        const data = await res.json();
        if (data.status !== 'success') {
            confirmBtn.disabled = false;
            if (typeof window.showAlert === 'function') {
                window.showAlert('tmpl-error-alert', { title: 'Ошибка', text: data.message || data.detail || 'Не удалось создать ассистента' });
            }
            return;
        }
        close();
        const createdAssistant = data.assistant || null;
        const createdAssistantId = createdAssistant?.assistant_id || data.active_assistant_id || null;

        if (createdAssistantId && createdAssistant) {
            const backendItems = Array.isArray(this.state.assistants_backend_items)
                ? [...this.state.assistants_backend_items]
                : [];
            const exists = backendItems.some((item) => (item?.assistant_id || item?.id) === createdAssistantId);
            if (!exists) {
                backendItems.push(createdAssistant);
                this.state.assistants_backend_items = backendItems;
            }
        }

        this.state.savedActiveAssistantId = this.state.assistants_active_id || this.state.savedActiveAssistantId || null;
        this.state.draftActiveAssistantId = this.state.savedActiveAssistantId || null;
        this.updateAssistantCard({ assistant_id: this.state.savedActiveAssistantId });

        await this.loadData();
        this.state.draftActiveAssistantId = this.state.savedActiveAssistantId || null;
        this.updateAssistantCard({ assistant_id: this.state.savedActiveAssistantId });

        if (typeof this.showAlert === 'function') {
            this.showAlert('tmpl-success-alert', {
                title: 'Создано',
                text: 'Новый ассистент добавлен в карточку.'
            });
        }
    };

    cancelBtn.onclick = close;
    confirmBtn.onclick = submit;
    overlay.onclick = (event) => {
        if (event.target === overlay) close();
    };
    nameInput.onkeydown = (event) => {
        if (event.key === 'Enter') { event.preventDefault(); roleInput.focus(); }
        if (event.key === 'Escape') close();
    };
    roleInput.onkeydown = (event) => {
        if (event.key === 'Enter') { event.preventDefault(); submit(); }
        if (event.key === 'Escape') close();
    };
}

export async function confirmAssistantsDeletion(count) {
    const suffix = count > 1 ? 'ассистентов' : 'ассистента';
    const title = 'Подтвердите удаление';
    const text = `Удалить ${count} ${suffix}?`;

    if (typeof window.showAlert === 'function') {
        const overlay = window.showAlert('tmpl-confirm-alert', { title, text });
        if (overlay) {
            const confirmBtn = overlay.querySelector('#confirm-yes');
            const cancelBtn = overlay.querySelector('#confirm-cancel');
            return await new Promise((resolve) => {
                const close = (result) => {
                    overlay.style.opacity = '0';
                    document.body.style.overflow = '';
                    setTimeout(() => overlay.remove(), 300);
                    resolve(result);
                };
                if (confirmBtn) {
                    confirmBtn.textContent = 'Удалить';
                    confirmBtn.onclick = () => close(true);
                }
                if (cancelBtn) {
                    cancelBtn.onclick = () => close(false);
                }
                overlay.onclick = (event) => {
                    if (event.target === overlay) close(false);
                };
            });
        }
    }

    return window.confirm(text);
}
