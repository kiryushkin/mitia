export async function loadData() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        let clientId = urlParams.get('client_id') || localStorage.getItem('chat_client_id') || 'mitia_assistant';

        if (urlParams.get('client_id') && urlParams.get('client_id') !== localStorage.getItem('chat_client_id')) {
            localStorage.setItem('chat_client_id', clientId);
        }

        if (this._lastClientId && this._lastClientId !== clientId) {
            this.state = { charts: {} };
            if (window.AdminApp && window.AdminApp.modules.faq) {
                window.AdminApp.modules.faq.state = {};
            }
        }
        this._lastClientId = clientId;

        const token = localStorage.getItem('chatadmin_auth_token');

        const activeAssistantId = (window.AdminApp && typeof window.AdminApp.getActiveAssistantId === 'function')
            ? window.AdminApp.getActiveAssistantId()
            : (this.state.assistants_active_id || null);
        const assistantQuery = activeAssistantId ? `&assistant_id=${encodeURIComponent(activeAssistantId)}` : '';
        const [balanceRes, configRes, assistantsRes] = await Promise.all([
            fetch(`/api/chat/admin/balance?client_id=${clientId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
            fetch(`/api/chat/admin/config?client_id=${clientId}${assistantQuery}`, { headers: { 'Authorization': `Bearer ${token}` } }),
            fetch(`/api/chat/admin/assistants?client_id=${clientId}`, { headers: { 'Authorization': `Bearer ${token}` } })
        ]);

        if (balanceRes.status === 401) { window.location.href = '/login'; return; }

        const balanceData = await balanceRes.json();
        const configData = await configRes.json();
        const assistantsData = assistantsRes.ok ? await assistantsRes.json() : { assistants: [] };

        if (balanceData.status === 'success' && configData.status === 'success') {
            const config = configData.json ? configData.json : configData.config;
                const fullData = {
                    ...config,
                    balance: balanceData.balance,
                    tariff_name: balanceData.tariff_name,
                    tariff_billing_period: balanceData.tariff_billing_period,
                    tariff_expires_at: balanceData.tariff_expires_at,
                    messages_used: balanceData.messages_consumed,
                    messages_limit: balanceData.messages_limit,
                    extra_messages_limit: balanceData.extra_messages_limit,
                    extra_messages_remaining: balanceData.extra_messages_remaining,
                    messages_total_remaining: balanceData.messages_total_remaining,
                    messages_reset_at: balanceData.messages_reset_at,
                    tariff_assistants_limit: balanceData.tariff_assistants_limit,
                    extra_assistants_purchased: balanceData.extra_assistants_purchased,
                    assistants_limit: balanceData.assistants_limit,
                    assistants_hard_cap: balanceData.assistants_hard_cap,
                    storage_limit: balanceData.storage_limit,
                    extra_storage_purchased_bytes: balanceData.extra_storage_purchased_bytes,
                    storage_plan_pack_id: balanceData.storage_plan_pack_id,
                    available_storage_packs: balanceData.available_storage_packs,
                    context_limit: balanceData.context_limit,
                    max_index_pages: balanceData.max_index_pages,
                    auto_renew: balanceData.auto_renew,
                    is_active: balanceData.is_active,
                    created_at: balanceData.created_at
                };

            this.state.assistants_backend_items = Array.isArray(assistantsData.assistants) ? assistantsData.assistants : [];
            this.state.assistants_active_id = assistantsData.active_assistant_id || configData.assistant_id || activeAssistantId || null;
            this.state.savedActiveAssistantId = this.state.assistants_active_id;
            this.state.draftActiveAssistantId = this.state.assistants_active_id;
            if (window.AdminApp && typeof window.AdminApp.setAssistantsList === 'function') {
                window.AdminApp.setAssistantsList(this.state.assistants_backend_items.map((item) => ({
                    assistant_id: item.assistant_id,
                    name: item.name || item.config?.bot_settings?.bot_name || item.assistant_id,
                })));
            }
            this.state = { ...this.state, ...fullData };
            this.fillForm(fullData);
            this.updateUI(fullData, clientId);
            this.renderStorageDonut();
            await this.loadNewsPreview();
        }

    } catch (error) {
        console.error('Error loading profile data:', error);
    } finally {
        const loader = document.getElementById('admin-preloader');
        if (loader) loader.style.display = 'none';
    }
}

export function fillForm(config) {
    const fields = document.querySelectorAll('[data-setting]');
    fields.forEach(field => {
        const settingPath = field.dataset.setting;
        const path = settingPath.split('.');
        let value = config;
        for (const key of path) { value = value ? value[key] : ''; }

        if (field.tagName === 'INPUT') field.value = value || '';
        else field.textContent = value || '';
    });
}

export function updateUI(config) {
    const getEl = (id) => document.getElementById(id);

    this.updateAssistantCard(config);

    if (getEl('display-user-email')) getEl('display-user-email').textContent = config.email || '...';

    const createdAtEl = getEl('display-user-created-at');
    if (createdAtEl) {
        if (config.created_at) {
            const date = new Date(config.created_at);
            createdAtEl.textContent = Number.isNaN(date.getTime())
                ? '—'
                : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
        } else {
            createdAtEl.textContent = '—';
        }
    }

    if (getEl('user-balance')) getEl('user-balance').textContent = `${config.balance || 0} ₽`;
    if (getEl('tariff-name')) getEl('tariff-name').textContent = config.tariff_name || 'Старт';
    this.updateTariffInlineUI();

    const autoRenewContainer = getEl('auto-renew-container');
    const autoRenewToggle = document.querySelector('.auto-renew-checkbox');
    if (autoRenewContainer && autoRenewToggle) {
        autoRenewContainer.style.display = 'flex';
        autoRenewToggle.checked = !!config.auto_renew;
    }

    const platformNewsToggle = document.querySelector('.platform-news-checkbox');
    if (platformNewsToggle) {
        platformNewsToggle.checked = !!(config.notifications && config.notifications.platform_news);
    }

    const expiryEl = getEl('tariff-expiry');
    if (expiryEl) {
        if (config.tariff_expires_at && config.tariff_name !== 'Старт') {
            const date = new Date(config.tariff_expires_at);
            expiryEl.textContent = `Оплачено до: ${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`;
            expiryEl.style.display = 'block';
        } else { expiryEl.style.display = 'none'; }
    }

    const limitText = getEl('tariff-limit-text');
    const assistantsLimitText = getEl('assistants-limit-text');
    const progressBar = getEl('tariff-progress-bar');
    const assistantsProgressBar = getEl('assistants-limit-progress-bar');
    const resetEl = getEl('tariff-reset');
    const contextEl = getEl('profile-context-limit');
    const pagesEl = getEl('profile-index-pages-limit');
    const storageEl = getEl('profile-storage-limit');
    const assistantsHardCapEl = getEl('profile-assistants-hard-cap');
    if (limitText && progressBar) {
        // Match the live poll exactly: the API is the single source of truth
        // for monthly quota plus permanent purchased message packs.
        const baseLimit = Math.max(Number(config.messages_limit || 0), 0);
        const extraRemaining = Math.max(Number(config.extra_messages_remaining || 0), 0);
        const totalLimit = baseLimit + extraRemaining;
        const totalRemaining = Math.max(Number(config.messages_total_remaining ?? Math.max(baseLimit - Number(config.messages_used || 0), 0)), 0);
        const consumedTotal = Math.max(totalLimit - totalRemaining, 0);
        limitText.textContent = `${consumedTotal}/${totalLimit}`;
        progressBar.style.width = `${Math.min((consumedTotal / Math.max(totalLimit, 1)) * 100, 100)}%`;
    }
    if (assistantsLimitText) {
        const usedAssistants = Array.isArray(this.state.assistants_backend_items) ? this.state.assistants_backend_items.length : 0;
        const limitAssistants = Number(config.assistants_limit || 0);
        assistantsLimitText.textContent = `${usedAssistants}/${limitAssistants}`;
        if (assistantsProgressBar) {
            assistantsProgressBar.style.width = `${Math.min((usedAssistants / Math.max(limitAssistants, 1)) * 100, 100)}%`;
        }
    }
    if (contextEl) {
        const total = Number(config.context_limit || 0);
        contextEl.textContent = `${total.toLocaleString('ru-RU')}`;
    }
    if (pagesEl) {
        const total = Number(config.max_index_pages || 0);
        pagesEl.textContent = `${total.toLocaleString('ru-RU')}`;
    }
    if (storageEl) {
        const total = Number(config.storage_limit || 0) / (1024 * 1024 * 1024);
        storageEl.textContent = `${total.toLocaleString('ru-RU')} ГБ`;
    }
    if (assistantsHardCapEl) {
        const total = Number(config.assistants_hard_cap || 0);
        assistantsHardCapEl.textContent = `${total.toLocaleString('ru-RU')}`;
    }
    const subsGroup = getEl('tariff-subscriptions-group');
    const subsList = getEl('tariff-subscriptions-list');
    if (subsGroup && subsList) {
        const items = [];
        const storagePackId = config.storage_plan_pack_id;
        if (storagePackId) {
            const packs = Array.isArray(config.available_storage_packs) ? config.available_storage_packs : [];
            const pack = packs.find((p) => String(p.pack_id) === String(storagePackId));
            const label = pack?.label || 'Расширение хранилища';
            const price = Number(pack?.monthly_price || 0);
            items.push({ label, price });
        }
        if (items.length) {
            subsList.innerHTML = items.map((item) => `
                <div class="tariff-subscription-item">
                    <span class="tariff-subscription-name">${item.label}</span>
                    <span class="tariff-subscription-price">+${item.price.toLocaleString('ru-RU')} ₽<span>/мес</span></span>
                </div>`).join('');
            subsGroup.style.display = 'block';
        } else {
            subsList.innerHTML = '';
            subsGroup.style.display = 'none';
        }
    }

    if (resetEl) resetEl.style.display = 'none';
}
