export function bindEvents() {
    const getEl = (id) => document.getElementById(id);

    const bindPressEffect = (selector) => {
        const btn = document.querySelector(selector);
        if (!btn) return;
        const addPress = () => btn.classList.add('is-pressed');
        const removePress = () => btn.classList.remove('is-pressed');
        btn.addEventListener('pointerdown', addPress);
        btn.addEventListener('pointerup', removePress);
        btn.addEventListener('pointercancel', removePress);
        btn.addEventListener('mouseleave', removePress);
        btn.addEventListener('blur', removePress);
    };

    bindPressEffect('#topup-btn-trigger');
    bindPressEffect('#update-password-btn');

    if (this._onProfileInput) document.removeEventListener('input', this._onProfileInput);
    if (this._onProfileChange) document.removeEventListener('change', this._onProfileChange);
    if (this._onProfileClickCapture) document.removeEventListener('click', this._onProfileClickCapture, true);

    this._onProfileInput = (e) => {
        const target = e.target;
        if (target && target.classList && target.classList.contains('input-error')) {
            target.classList.remove('input-error');
        }
    };
    document.addEventListener('input', this._onProfileInput);

    this._onProfileChange = (e) => {
        const target = e.target;
        if (target && target.classList && target.classList.contains('input-error')) {
            target.classList.remove('input-error');
        }
    };
    document.addEventListener('change', this._onProfileChange);

    this._onProfileClickCapture = (e) => {
        // Клик в пустую область — сбрасываем все ошибки валидации
        const isInteractive = e.target.closest('input, button, .toggle-password-btn, .topup-inline-row, .balance-actions-row');
        if (!isInteractive) {
            document.querySelectorAll('.input-error').forEach((el) => el.classList.remove('input-error'));
        }

        const topupPlusBtn = e.target.closest('#topup-plus-inline');
        if (topupPlusBtn) {
            e.preventDefault();
            e.stopPropagation();
            const input = document.getElementById('topup-amount-inline');
            if (input) {
                const base = parseInt(input.value || input.placeholder || '1000', 10);
                const safeBase = Number.isFinite(base) ? base : 1000;
                input.value = String(safeBase + 500);
                input.classList.remove('input-error');
            }
            return false;
        }

        const topupMinusBtn = e.target.closest('#topup-minus-inline');
        if (topupMinusBtn) {
            e.preventDefault();
            e.stopPropagation();
            const input = document.getElementById('topup-amount-inline');
            if (input) {
                const base = parseInt(input.value || input.placeholder || '1000', 10);
                const safeBase = Number.isFinite(base) ? base : 1000;
                input.value = String(safeBase > 500 ? safeBase - 500 : 100);
                input.classList.remove('input-error');
            }
            return false;
        }

        const topUpBtn = e.target.closest('#topup-btn-trigger');
        if (topUpBtn) {
            e.preventDefault();
            e.stopPropagation();
            this.handleTopUp();
            return false;
        }

        const historyToggle = e.target.closest('#balance-history-toggle');
        if (historyToggle) {
            e.preventDefault();
            e.stopPropagation();
            this.toggleBalanceHistory();
            return false;
        }
    };
    document.addEventListener('click', this._onProfileClickCapture, true);

    window.updatePassword = () => this.handlePasswordUpdate();

    if (getEl('lock-profile-btn')) {
        getEl('lock-profile-btn').addEventListener('click', () => this.toggleLock());
    }

    const supportBtn = getEl('btn-support-chat');
    if (supportBtn) {
        supportBtn.addEventListener('click', () => {
            if (window.MityaWidget && typeof window.MityaWidget.open === 'function') {
                window.MityaWidget.open();
            } else {
                alert('Чат поддержки временно недоступен. Пожалуйста, напишите нам на email.');
            }
        });
    }

    const helpCenterBtn = getEl('profile-help-center-btn');
    const helpModal = getEl('profile-help-modal');
    const helpOkBtn = getEl('profile-help-ok');

    if (helpCenterBtn && helpModal) {
        const openHelpModal = () => {
            helpModal.classList.add('is-open');
            helpModal.setAttribute('aria-hidden', 'false');
        };
        const closeHelpModal = () => {
            helpModal.classList.remove('is-open');
            helpModal.setAttribute('aria-hidden', 'true');
        };

        helpCenterBtn.addEventListener('click', (event) => {
            event.preventDefault();
            openHelpModal();
        });

        if (helpOkBtn) helpOkBtn.addEventListener('click', closeHelpModal);

        helpModal.addEventListener('click', (event) => {
            if (event.target === helpModal) {
                closeHelpModal();
            }
        });
    }

    const newsBtn = getEl('profile-news-btn');
    if (newsBtn) {
        newsBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (window.AdminApp?.navigateToTab) {
                await window.AdminApp.navigateToTab('news');
            }
        });
    }

    const storageOpenBtn = getEl('storage-lock-btn');
    if (storageOpenBtn) {
        storageOpenBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (window.AdminApp?.navigateToTab) {
                await window.AdminApp.navigateToTab('storage');
            }
        });
    }

    const tariffInfoBtn = getEl('tariff-info-btn');
    if (tariffInfoBtn) {
        tariffInfoBtn.addEventListener('click', (event) => {
            event.preventDefault();
            if (window.AdminApp && typeof window.AdminApp.navigateToTab === 'function') {
                window.AdminApp.navigateToTab('tariffs');
            }
        });
    }

    const addAssistantBtn = getEl('profile-add-assistant-btn');
    if (addAssistantBtn) {
        addAssistantBtn.addEventListener('click', (event) => {
            event.preventDefault();
            this.createAssistantFlow();
        });
    }

    const saveBtn = document.querySelector('.save-config-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => this.saveData());
    }

    let resizeRafId = null;
    let resizeCleanupTimer = null;
    const handleResize = () => {
        document.body.classList.add('is-resizing');
        if (resizeCleanupTimer) clearTimeout(resizeCleanupTimer);
        resizeCleanupTimer = setTimeout(() => {
            document.body.classList.remove('is-resizing');
        }, 120);

        if (resizeRafId) cancelAnimationFrame(resizeRafId);
        resizeRafId = requestAnimationFrame(() => {
            resizeRafId = null;
            if (this.state.charts) {
                Object.values(this.state.charts).forEach((chart) => {
                    if (chart && typeof chart.resize === 'function') {
                        chart.resize();
                    }
                });
            }
        });
    };

    window.addEventListener('resize', handleResize, { passive: true });

    document.querySelectorAll('.toggle-password-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = btn.parentElement.querySelector('input');
            btn.classList.toggle('active');
            if (input.type === 'password') {
                input.type = 'text';
            } else {
                input.type = 'password';
            }
        });
    });
}
