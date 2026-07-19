export const TariffsModule = {
    state: {
        currentTariff: 'start',
        billingPeriods: {
            business: 'month',
            neuro: 'month'
        },
        balanceStatus: null,
        isBuyingPack: false,
        isBuyingAssistantPack: false,
        isChangingTariff: false,
    },

    // Цены приходят с бэкенда (/api/chat/admin/tariffs-pricing) — единый источник
    // истины. Значения ниже используются только как запасной вариант, если запрос
    // не удался.
    pricing: {
        start: { month: 'Бесплатно', year: 'Бесплатно' },
        business: { month: '3 900 ₽', year: '39 000 ₽' },
        neuro: { month: '9 900 ₽', year: '99 000 ₽' }
    },

    async init() {
        console.log('Tariffs module initialized');
        await this.loadPricing();
        await this.loadCurrentTariff();
        this.bindEvents();
        this.syncSelectionUI();
        this.syncBillingUI();
        this.syncQuotaUi();
    },

    async loadPricing() {
        const token = this.getToken();
        if (!token) return;
        try {
            const response = await fetch('/api/chat/admin/tariffs-pricing', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) return;
            const data = await response.json();
            const tariffs = data?.tariffs || {};
            const pricing = {};
            Object.keys(tariffs).forEach((tariffId) => {
                pricing[tariffId] = {
                    month: tariffs[tariffId].month_label,
                    year: tariffs[tariffId].year_label
                };
            });
            if (Object.keys(pricing).length) {
                this.pricing = pricing;
            }
        } catch (error) {
            console.warn('Failed to load tariffs pricing, using fallback:', error);
        }
    },

    getClientId() {
        return new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id') || 'mitia_assistant';
    },

    getToken() {
        return localStorage.getItem('chatadmin_auth_token');
    },

    showAlert(templateId, payload) {
        if (window.AdminApp?.modules?.profile?.showAlert) {
            return window.AdminApp.modules.profile.showAlert(templateId, payload);
        }
        if (typeof window.showAlert === 'function') {
            return window.showAlert(templateId, payload);
        }
        return null;
    },

    formatPrice(value) {
        return `${Number(value || 0).toLocaleString('ru-RU')} ₽`;
    },

    confirmAction({ title, text, confirmLabel = 'Подтвердить', danger = false }) {
        const overlay = this.showAlert('tmpl-confirm-alert', { title, text });
        if (!overlay) {
            return Promise.resolve(window.confirm(text));
        }
        const confirmBtn = overlay.querySelector('#confirm-yes');
        const cancelBtn = overlay.querySelector('#confirm-cancel');
        return new Promise((resolve) => {
            const close = (result) => {
                overlay.style.opacity = '0';
                document.body.style.overflow = '';
                setTimeout(() => overlay.remove(), 300);
                resolve(result);
            };
            if (confirmBtn) {
                confirmBtn.textContent = confirmLabel;
                confirmBtn.classList.remove('warning-bg', 'success-bg', 'error-bg');
                confirmBtn.style.backgroundColor = '';
                confirmBtn.style.color = '';
                // Purchase/connect actions are positive (green); only destructive
                // confirmations retain the product error color.
                confirmBtn.classList.add(danger ? 'error-bg' : 'success-bg');
                confirmBtn.onclick = () => close(true);
            }
            if (cancelBtn) cancelBtn.onclick = () => close(false);
            overlay.onclick = (event) => { if (event.target === overlay) close(false); };
        });
    },

    async loadCurrentTariff() {
        const clientId = this.getClientId();
        const token = this.getToken();
        if (!token) return null;

        try {
            const response = await fetch(`/api/chat/admin/balance?client_id=${clientId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            const normalized = String(data?.tariff || 'start').toLowerCase();
            this.state.currentTariff = normalized;
            this.state.balanceStatus = data;
            return data;
        } catch (error) {
            console.warn('Failed to load current tariff:', error);
            return null;
        }
    },

    applyBalanceStatus(data) {
        if (!data || typeof data !== 'object') return;
        const normalized = String(data?.tariff || this.state.currentTariff || 'start').toLowerCase();
        this.state.currentTariff = normalized;
        this.state.balanceStatus = data;
    },

    bindEvents() {
        document.querySelectorAll('.tariff-billing-btn').forEach((button) => {
            button.addEventListener('click', () => {
                const nextPeriod = button.dataset.billingPeriod;
                const card = button.closest('.tariff-plan-card');
                const tariffId = card?.dataset.tariff;
                if (!nextPeriod || !tariffId || !this.state.billingPeriods[tariffId]) return;
                if (nextPeriod === this.state.billingPeriods[tariffId]) return;
                this.state.billingPeriods[tariffId] = nextPeriod;
                this.syncBillingUI();
            });
        });

        document.querySelectorAll('.tariff-pack-buy-btn').forEach((button) => {
            button.addEventListener('click', () => {
                const packId = button.dataset.packId;
                if (packId) this.purchasePack(packId, button);
            });
        });

        document.querySelectorAll('.tariff-assistant-pack-buy-btn').forEach((button) => {
            button.addEventListener('click', () => {
                const packId = button.dataset.assistantPackId;
                if (packId) this.purchaseAssistantPack(packId, button);
            });
        });

        document.querySelectorAll('.tariff-storage-pack-buy-btn').forEach((button) => {
            button.addEventListener('click', () => {
                const packId = button.dataset.storagePackId;
                if (packId) this.purchaseStoragePack(packId, button);
            });
        });

        document.querySelectorAll('[data-select-tariff]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const tariffId = button.dataset.selectTariff;
                if (!tariffId) return;
                this.connectTariff(tariffId, button);
            });
        });
    },

    syncSelectionUI() {
        document.querySelectorAll('.tariff-plan-card').forEach((card) => {
            const tariffId = card.dataset.tariff;
            const isCurrent = tariffId === this.state.currentTariff;
            const selectBtn = card.querySelector('[data-select-tariff]');
            card.classList.toggle('is-current-tariff', isCurrent);
            if (selectBtn) {
                selectBtn.textContent = isCurrent ? 'Подключён' : 'Подключить';
                selectBtn.disabled = isCurrent || this.state.isChangingTariff;
            }
        });
    },

    async connectTariff(tariffId, button) {
        if (this.state.isChangingTariff) return;
        if (tariffId === this.state.currentTariff) return;

        const billingPeriod = this.state.billingPeriods[tariffId] || 'month';
        const priceText = this.pricing?.[tariffId]?.[billingPeriod];
        const isFree = tariffId === 'start';
        const periodText = billingPeriod === 'year' ? 'год' : 'месяц';
        const text = isFree
            ? 'Тариф «Старт» бесплатный. Перейти на него? Неиспользованные сообщения, включённые в текущий тариф, сгорят. Отдельно купленные пакеты сообщений сохранятся.'
            : `Тариф будет подключён на ${periodText}. С баланса единоразово спишется ${priceText}. Продолжить?`;
        const confirmed = await this.confirmAction({
            title: 'Сменить тариф?',
            text,
            confirmLabel: 'Подключить'
        });
        if (!confirmed) return;

        if (!window.AdminApp?.modules?.profile?.performTariffChange) return;

        this.state.isChangingTariff = true;
        if (button) button.disabled = true;

        try {
            const result = await window.AdminApp.modules.profile.performTariffChange(tariffId, {
                silent: false,
                billingPeriod,
            });
            if (result && result.status === 'success') {
                this.state.currentTariff = tariffId;
                await this.loadCurrentTariff();
                this.syncSelectionUI();
                this.syncBillingUI();
                this.syncQuotaUi();
                window.AdminApp?.modules?.profile?.pollBalance?.();
                this.showAlert('tmpl-success-alert', {
                    title: 'Тариф обновлён',
                    text: result.message || 'Новый тариф сохранён и уже активен.'
                });
            }
        } finally {
            this.state.isChangingTariff = false;
            this.syncSelectionUI();
        }
    },

    syncBillingUI() {
        document.querySelectorAll('.tariff-plan-card').forEach((card) => {
            const tariffId = card.dataset.tariff;
            const priceNote = card.querySelector('[data-price-note]');
            const billingPeriod = this.state.billingPeriods[tariffId] || 'month';
            const priceText = this.pricing?.[tariffId]?.[billingPeriod];

            card.querySelectorAll('.tariff-billing-btn').forEach((button) => {
                button.classList.toggle('is-active', button.dataset.billingPeriod === billingPeriod);
            });

            if (priceNote && priceText) {
                priceNote.textContent = billingPeriod === 'year' ? `${priceText}/год` : `${priceText}/мес`;
            }

            const monthlyMessageLabel = card.querySelector('[data-monthly-message-label]');
            if (monthlyMessageLabel) {
                monthlyMessageLabel.textContent = billingPeriod === 'year'
                    ? 'сообщений ассистента в месяц'
                    : 'сообщений ассистента';
            }
        });
    },

    syncQuotaUi() {
        const status = this.state.balanceStatus || {};
        const packs = Array.isArray(status.available_message_packs) ? status.available_message_packs : [];
        packs.forEach((pack) => {
            const card = document.querySelector(`[data-pack-card="${pack.pack_id}"]`);
            if (!card) return;
            const buyBtn = card.querySelector('.tariff-pack-buy-btn');
            if (buyBtn) buyBtn.disabled = this.state.isBuyingPack;
        });

        const assistantPacks = Array.isArray(status.available_assistant_slot_packs) ? status.available_assistant_slot_packs : [];
        assistantPacks.forEach((pack) => {
            const card = document.querySelector(`[data-assistant-pack-card="${pack.pack_id}"]`);
            if (!card) return;
            const buyBtn = card.querySelector('.tariff-assistant-pack-buy-btn');
            if (buyBtn) {
                buyBtn.disabled = this.state.isBuyingAssistantPack;
            }
        });

        const storagePacks = Array.isArray(status.available_storage_packs) ? status.available_storage_packs : [];
        storagePacks.forEach((pack) => {
            const card = document.querySelector(`[data-storage-pack-card="${pack.pack_id}"]`);
            if (!card) return;
            const buyBtn = card.querySelector('.tariff-storage-pack-buy-btn');
            const isActive = String(status.storage_plan_pack_id || '') === String(pack.pack_id);
            card.classList.toggle('is-current-tariff', isActive);
            if (buyBtn) {
                buyBtn.disabled = this.state.isBuyingPack;
                buyBtn.textContent = isActive ? 'Отключить' : 'Подключить';
            }
        });
    },


    async purchasePack(packId, button) {
        if (this.state.isBuyingPack) return;
        const token = this.getToken();
        const clientId = this.getClientId();
        if (!token) return;

        const packs = Array.isArray(this.state.balanceStatus?.available_message_packs) ? this.state.balanceStatus.available_message_packs : [];
        const pack = packs.find((p) => String(p.pack_id) === String(packId));
        const price = Number(pack?.price || 0);
        const label = pack?.label || 'пакет сообщений';
        const confirmed = await this.confirmAction({
            title: 'Купить пакет сообщений?',
            text: `Будет подключён «${label}». С баланса единоразово спишется ${this.formatPrice(price)}. Продолжить?`,
            confirmLabel: 'Купить'
        });
        if (!confirmed) return;

        this.state.isBuyingPack = true;
        if (button) button.disabled = true;
        this.syncQuotaUi();

        try {
            const response = await fetch(`/api/chat/admin/purchase-message-pack?client_id=${clientId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ pack_id: packId })
            });
            const data = await response.json();
            if (data.status !== 'success') {
                this.showAlert('tmpl-error-alert', {
                    title: 'Не удалось купить пакет',
                    text: data.message || 'Проверьте соединение и попробуйте ещё раз.'
                });
                return;
            }

            await this.loadCurrentTariff();
            this.syncSelectionUI();
            this.syncBillingUI();
            this.syncQuotaUi();
            window.AdminApp?.modules?.profile?.pollBalance?.();
            this.showAlert('tmpl-success-alert', {
                title: 'Пакет сообщений куплен',
                text: data.message || 'Дополнительные сообщения уже добавлены к вашему лимиту.'
            });
        } catch (error) {
            this.showAlert('tmpl-error-alert', {
                title: 'Не удалось купить пакет',
                text: 'Проверьте соединение и попробуйте ещё раз.'
            });
        } finally {
            this.state.isBuyingPack = false;
            if (button) button.disabled = false;
            this.syncQuotaUi();
        }
    },

    async purchaseStoragePack(packId, button) {
        if (this.state.isBuyingPack) return;
        const token = this.getToken();
        const clientId = this.getClientId();
        if (!token) return;

        const isActive = String(this.state.balanceStatus?.storage_plan_pack_id || '') === String(packId);
        const packs = Array.isArray(this.state.balanceStatus?.available_storage_packs) ? this.state.balanceStatus.available_storage_packs : [];
        const pack = packs.find((p) => String(p.pack_id) === String(packId));
        const monthlyPrice = Number(pack?.monthly_price || 0);
        const label = pack?.label || 'расширение хранилища';
        const confirmed = isActive
            ? await this.confirmAction({
                title: 'Отключить расширение хранилища?',
                text: `«${label}» будет отключено, ежемесячная плата ${this.formatPrice(monthlyPrice)}/мес больше списываться не будет. Если занятое место превысит тарифный лимит, загрузка новых файлов заблокируется. Продолжить?`,
                confirmLabel: 'Отключить',
                danger: true
            })
            : await this.confirmAction({
                title: 'Подключить расширение хранилища?',
                text: `«${label}» будет подключено. Это ежемесячная подписка: ${this.formatPrice(monthlyPrice)}/мес будет списываться с баланса при каждом продлении тарифа. Продолжить?`,
                confirmLabel: 'Подключить'
            });
        if (!confirmed) return;

        this.state.isBuyingPack = true;
        if (button) button.disabled = true;
        this.syncQuotaUi();

        try {
            const response = await fetch(`/api/chat/admin/${isActive ? 'cancel-storage-pack' : 'purchase-storage-pack'}?client_id=${clientId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: isActive ? null : JSON.stringify({ pack_id: packId })
            });
            const data = await response.json();
            if (data.status !== 'success') {
                this.showAlert('tmpl-error-alert', {
                    title: 'Не удалось подключить расширение хранилища',
                    text: data.message || 'Проверьте соединение и попробуйте ещё раз.'
                });
                return;
            }

            if (data.balance && typeof data.balance === 'object') {
                this.applyBalanceStatus(data.balance);
            } else {
                await this.loadCurrentTariff();
            }
            await window.AdminApp?.modules?.profile?.loadData?.();
            this.syncSelectionUI();
            this.syncBillingUI();
            this.syncQuotaUi();
            window.AdminApp?.modules?.profile?.pollBalance?.();
            this.showAlert('tmpl-success-alert', {
                title: isActive ? 'Расширение хранилища отключено' : 'Расширение хранилища подключено',
                text: data.message || (isActive ? 'Расширение отключено.' : 'Новая надбавка к хранилищу начнёт учитываться в ежемесячном продлении.')
            });
        } catch (error) {
            this.showAlert('tmpl-error-alert', {
                title: 'Не удалось подключить расширение хранилища',
                text: 'Проверьте соединение и попробуйте ещё раз.'
            });
        } finally {
            this.state.isBuyingPack = false;
            if (button) button.disabled = false;
            this.syncQuotaUi();
        }
    },

    async purchaseAssistantPack(packId, button) {
        if (this.state.isBuyingAssistantPack) return;
        const token = this.getToken();
        const clientId = this.getClientId();
        if (!token) return;

        const packs = Array.isArray(this.state.balanceStatus?.available_assistant_slot_packs) ? this.state.balanceStatus.available_assistant_slot_packs : [];
        const pack = packs.find((p) => String(p.pack_id) === String(packId));
        const price = Number(pack?.price || 0);
        const label = pack?.label || 'слоты ассистентов';
        const confirmed = await this.confirmAction({
            title: 'Купить слоты ассистентов?',
            text: `Будет подключено «${label}». С баланса единоразово спишется ${this.formatPrice(price)}. Слоты постоянные и не сгорают. Продолжить?`,
            confirmLabel: 'Купить'
        });
        if (!confirmed) return;

        this.state.isBuyingAssistantPack = true;
        if (button) button.disabled = true;
        this.syncQuotaUi();

        try {
            const response = await fetch(`/api/chat/admin/purchase-assistant-pack?client_id=${clientId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ pack_id: packId })
            });
            const data = await response.json();
            if (data.status !== 'success') {
                this.showAlert('tmpl-error-alert', {
                    title: 'Не удалось купить слоты',
                    text: data.message || 'Проверьте соединение и попробуйте ещё раз.'
                });
                return;
            }

            await this.loadCurrentTariff();
            await window.AdminApp?.modules?.profile?.loadData?.();
            this.syncSelectionUI();
            this.syncBillingUI();
            this.syncQuotaUi();
            window.AdminApp?.modules?.profile?.pollBalance?.();
            this.showAlert('tmpl-success-alert', {
                title: 'Слоты ассистентов куплены',
                text: data.message || 'Постоянные слоты уже добавлены к вашему аккаунту.'
            });
        } catch (error) {
            this.showAlert('tmpl-error-alert', {
                title: 'Не удалось купить слоты',
                text: 'Проверьте соединение и попробуйте ещё раз.'
            });
        } finally {
            this.state.isBuyingAssistantPack = false;
            if (button) button.disabled = false;
            this.syncQuotaUi();
        }
    },

    destroy() {}
};
