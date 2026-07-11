export const ProfileModule = {
    state: {
        charts: {}
    },
    init() {
        console.log('Profile module V2 initialized');
        this.state.selected_tariff = null;
        this.state.storage_lock_bound = false;
        this.state.storage_edit_bound = false;
        this.state.storage_delete_bound = false;
        this.state.storage_files_click_bound = false;
        
        this.bindEvents();
        this.loadData();
        this.startPolling();
        this.renderStorageDonut();
        this.initOrb();
        this.bindAccountControls();
        this.bindSecurityControls();
        this.bindTariffInlineControls();
    },

    initOrb() {
        const canvas = document.getElementById('profile-orb-canvas');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const centerX = width / 2;
        const centerY = height / 2;
        
        let particles = [];
        const sphereRadius = 120;
        const numToAddEachFrame = 12;
        
        const r = 112, g = 255, b = 140;
        const rgbString = `rgba(${r},${g},${b},`;
        
        class Particle {
            constructor(x, y, z, vx, vy, vz) {
                this.x = x;
                this.y = y;
                this.z = z;
                this.vx = vx;
                this.vy = vy;
                this.vz = vz;
                this.age = 0;
                this.stuckTime = 90 + Math.random() * 20;
                this.alpha = 0;
            }
            
            update() {
                this.age++;
                
                if (this.age > this.stuckTime) {
                    this.vx += (Math.random() - 0.5) * 0.2;
                    this.vy += (Math.random() - 0.5) * 0.2;
                    this.vz += (Math.random() - 0.5) * 0.2;
                    this.x += this.vx;
                    this.y += this.vy;
                    this.z += this.vz;
                }
                
                if (this.age < 50) {
                    this.alpha = this.age / 50;
                } else if (this.age > 150) {
                    this.alpha = Math.max(0, 1 - (this.age - 150) / 50);
                } else {
                    this.alpha = 1;
                }
            }
            
            isDead() {
                return this.age > 200;
            }
        }
        
        function generateParticles() {
            for (let i = 0; i < numToAddEachFrame; i++) {
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(Math.random() * 2 - 1);
                const x = sphereRadius * Math.sin(phi) * Math.cos(theta);
                const y = sphereRadius * Math.sin(phi) * Math.sin(theta);
                const z = sphereRadius * Math.cos(phi);
                const vMult = 0.002;
                particles.push(new Particle(x, y, z, vMult * x, vMult * y, vMult * z));
            }
        }
        
        for (let i = 0; i < 200; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(Math.random() * 2 - 1);
            const x = sphereRadius * Math.sin(phi) * Math.cos(theta);
            const y = sphereRadius * Math.sin(phi) * Math.sin(theta);
            const z = sphereRadius * Math.cos(phi);
            particles.push(new Particle(x, y, z, 0.001 * x, 0.001 * y, 0.001 * z));
        }
        
        let angleY = 0;
        let angleX = 0;
        let frameCount = 0;
        
        function rotatePoint(px, py, pz, angY, angX) {
            const cosY = Math.cos(angY), sinY = Math.sin(angY);
            let x1 = cosY * px + sinY * pz;
            let z1 = -sinY * px + cosY * pz;
            let y1 = py;
            
            const cosX = Math.cos(angX), sinX = Math.sin(angX);
            let y2 = cosX * y1 - sinX * z1;
            let z2 = sinX * y1 + cosX * z1;
            let x2 = x1;
            
            return { x: x2, y: y2, z: z2 };
        }
        
        function animate() {
            ctx.clearRect(0, 0, width, height);
            
            angleY += 0.005;
            angleX = Math.sin(frameCount * 0.01) * 0.3;
            frameCount++;
            
            if (frameCount % 2 === 0) {
                generateParticles();
            }
            
            const fLen = 320;
            const projCenterX = centerX;
            const projCenterY = centerY;
            
            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                p.update();
                
                if (p.isDead()) {
                    particles.splice(i, 1);
                    continue;
                }
                
                const rotated = rotatePoint(p.x, p.y, p.z, angleY, angleX);
                const finalZ = rotated.z;
                
                const projScale = fLen / (fLen - finalZ);
                const projX = rotated.x * projScale + projCenterX;
                const projY = rotated.y * projScale + projCenterY;
                
                const depthAlpha = Math.max(0, Math.min(1, 1 - finalZ / -750));
                const finalAlpha = depthAlpha * p.alpha;
                
                const size = 1.2 * projScale;
                ctx.fillStyle = rgbString + (finalAlpha * 0.8) + ')';
                ctx.beginPath();
                ctx.arc(projX, projY, size, 0, Math.PI * 2);
                ctx.fill();
                
                const cDist = Math.hypot(projX - projCenterX, projY - projCenterY);
                const maxCDist = sphereRadius * projScale * 0.8;
                if (cDist < maxCDist) {
                    const cAlpha = finalAlpha * (1 - cDist / maxCDist);
                    ctx.beginPath();
                    ctx.moveTo(projX, projY);
                    ctx.lineTo(projCenterX, projCenterY);
                    ctx.strokeStyle = rgbString + (cAlpha * 0.4) + ')';
                    ctx.lineWidth = 0.3 * cAlpha;
                    ctx.stroke();
                }
                
                for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
                    const other = particles[j];
                    const otherRotated = rotatePoint(other.x, other.y, other.z, angleY, angleX);
                    const otherProjScale = fLen / (fLen - otherRotated.z);
                    const otherProjX = otherRotated.x * otherProjScale + projCenterX;
                    const otherProjY = otherRotated.y * otherProjScale + projCenterY;
                    
                    const pDist = Math.hypot(projX - otherProjX, projY - otherProjY);
                    if (pDist < 80 && Math.abs(p.z - other.z) < 150) {
                        const lineAlpha = finalAlpha * (1 - pDist / 80);
                        ctx.beginPath();
                        ctx.moveTo(projX, projY);
                        ctx.lineTo(otherProjX, otherProjY);
                        ctx.strokeStyle = rgbString + (lineAlpha * 0.4) + ')';
                        ctx.lineWidth = 0.4 * lineAlpha;
                        ctx.stroke();
                    }
                }
            }
            
            ctx.fillStyle = rgbString + '0.8)';
            ctx.beginPath();
            ctx.arc(projCenterX, projCenterY, 3, 0, Math.PI * 2);
            ctx.fill();
            
            requestAnimationFrame(animate);
        }
        
        animate();
    },

    startPolling() {
        if (this._pollTimer) clearInterval(this._pollTimer);
        this._pollTimer = setInterval(() => this.pollBalance(), 5000);
    },

    stopPolling() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    },

    destroy() {
        this.stopPolling();
        this.state.storage_lock_bound = false;
        this.state.storage_edit_bound = false;
        this.state.storage_delete_bound = false;
        this.state.storage_files_click_bound = false;
    },


    async pollBalance() {
        try {
            const clientId = new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id') || 'mitia_assistant';
            const token = localStorage.getItem('chatadmin_auth_token');
            const res = await fetch(`/api/chat/admin/balance?client_id=${clientId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.status === 401) { this.stopPolling(); return; }
            const data = await res.json();
            if (data.status === 'success') {
                const used = data.messages_consumed || 0;
                const limit = data.messages_limit || 100;
                const limitText = document.getElementById('tariff-limit-text');
                const progressBar = document.getElementById('tariff-progress-bar');
                const resetEl = document.getElementById('tariff-reset');
                if (limitText) limitText.textContent = `${used}/${limit}`;
                if (progressBar) progressBar.style.width = `${Math.min((used / limit) * 100, 100)}%`;
                if (resetEl) {
                    if (data.messages_reset_at) {
                        const date = new Date(data.messages_reset_at);
                        resetEl.textContent = `Лимит обновится: ${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`;
                        resetEl.style.display = 'block';
                    } else {
                        resetEl.style.display = 'none';
                    }
                }
                const balanceEl = document.getElementById('user-balance');
                if (balanceEl) balanceEl.textContent = `${data.balance || 0} ₽`;
            }
        } catch (e) { /* тихо игнорируем ошибки polling */ }
    },

    bindEvents() {
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

        document.addEventListener('input', (e) => {
            const target = e.target;
            if (target && target.classList && target.classList.contains('input-error')) {
                target.classList.remove('input-error');
            }
        });

        document.addEventListener('change', (e) => {
            const target = e.target;
            if (target && target.classList && target.classList.contains('input-error')) {
                target.classList.remove('input-error');
            }
        });

        document.addEventListener('click', (e) => {
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
        }, true);

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
        const newsModal = getEl('profile-news-modal');
        const newsOkBtn = getEl('profile-news-ok');

        if (newsBtn && newsModal) {
            const openNewsModal = () => {
                newsModal.classList.add('is-open');
                newsModal.setAttribute('aria-hidden', 'false');
            };
            const closeNewsModal = () => {
                newsModal.classList.remove('is-open');
                newsModal.setAttribute('aria-hidden', 'true');
            };

            newsBtn.addEventListener('click', (event) => {
                event.preventDefault();
                openNewsModal();
            });

            if (newsOkBtn) newsOkBtn.addEventListener('click', closeNewsModal);

            newsModal.addEventListener('click', (event) => {
                if (event.target === newsModal) {
                    closeNewsModal();
                }
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
    },

    async loadData() {
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
            
            const [balanceRes, configRes] = await Promise.all([
                fetch(`/api/chat/admin/balance?client_id=${clientId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
                fetch(`/api/chat/admin/config?client_id=${clientId}`, { headers: { 'Authorization': `Bearer ${token}` } })
            ]);

            if (balanceRes.status === 401) { window.location.href = '/login'; return; }

            const balanceData = await balanceRes.json();
            const configData = await configRes.json();
            
            if (balanceData.status === 'success' && configData.status === 'success') {
                const config = configData.json ? configData.json : configData.config;
                const fullData = {
                    ...config,
                    balance: balanceData.balance,
                    tariff_name: balanceData.tariff_name,
                    tariff_expires_at: balanceData.tariff_expires_at,
                    messages_used: balanceData.messages_consumed,
                    messages_limit: balanceData.messages_limit,
                    messages_reset_at: balanceData.messages_reset_at,
                    auto_renew: balanceData.auto_renew,
                    is_active: balanceData.is_active
                };
                
                this.state = { ...this.state, ...fullData };
                this.fillForm(fullData);
                this.updateUI(fullData, clientId);
                this.renderStorageDonut();
            }


        } catch (error) {
            console.error('Error loading profile data:', error);
        } finally {
            const loader = document.getElementById('admin-preloader');
            if (loader) loader.style.display = 'none';
        }
    },

    fillForm(config) {
        const fields = document.querySelectorAll('[data-setting]');
        fields.forEach(field => {
            const settingPath = field.dataset.setting;
            const path = settingPath.split('.');
            let value = config;
            for (const key of path) { value = value ? value[key] : ''; }
            
            if (field.tagName === 'INPUT') field.value = value || '';
            else field.textContent = value || '';
        });
    },

    updateUI(config) {
        const getEl = (id) => document.getElementById(id);
        
        if (getEl('display-user-email')) getEl('display-user-email').textContent = config.email || '...';

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
        const progressBar = getEl('tariff-progress-bar');
        const resetEl = getEl('tariff-reset');
        if (limitText && progressBar) {
            const used = config.messages_used || 0;
            const limit = config.messages_limit || 100;
            limitText.textContent = `${used}/${limit}`;
            progressBar.style.width = `${Math.min((used / limit) * 100, 100)}%`;
        }
        if (resetEl) {
            if (config.messages_reset_at) {
                const date = new Date(config.messages_reset_at);
                resetEl.textContent = `Лимит обновится: ${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`
                resetEl.style.display = 'block';
            } else {
                resetEl.style.display = 'none';
            }
        }

    },

    async renderStorageDonut() {
        const canvas = document.getElementById('storage-donut-chart');
        const cardEl = document.getElementById('card-storage');
        const filesGridEl = document.getElementById('storage-files-grid');
        const lockBtn = document.getElementById('storage-lock-btn');
        const editBtn = document.getElementById('storage-edit-btn');
        const deleteBtn = document.getElementById('storage-delete-btn');
        if (!Array.isArray(this.state.storage_selected_ids)) this.state.storage_selected_ids = [];
        if (typeof this.state.storage_edit_mode !== 'boolean') this.state.storage_edit_mode = false;
        if (!canvas || !cardEl) return;

        const clientId = new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id') || 'mitia_assistant';
        const token = localStorage.getItem('chatadmin_auth_token');

        const formatSize = (bytes) => {
            if (!bytes || bytes === 0) return '0 Б';
            const k = 1024;
            const sizes = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
            const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        };

        const isPreviewSupported = (fileName) => {
            const ext = ((fileName || '').split('.').pop() || '').toLowerCase();
            const supported = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'pdf', 'txt', 'mp4', 'webm', 'mp3', 'wav', 'ogg'];
            return supported.includes(ext);
        };

        const openOrDownloadFile = (item) => {
            if (!item || !item.file_path) return;
            const url = item.file_path;
            if (isPreviewSupported(item.file_name)) {
                window.open(url, '_blank', 'noopener,noreferrer');
                return;
            }
            const a = document.createElement('a');
            a.href = url;
            a.download = item.file_name || 'file';
            document.body.appendChild(a);
            a.click();
            a.remove();
        };

        const iconByType = {
            image: '🖼️',
            video: '🎬',
            audio: '🎵',
            document: '📄',
            text: '📝',
            other: '📦'
        };

        const escapeHtml = (value) => {
            const div = document.createElement('div');
            div.textContent = String(value || '');
            return div.innerHTML;
        };

        const updateStorageActionButtons = () => {
            const filesMode = cardEl.classList.contains('storage-files-mode');
            const selectedCount = (this.state.storage_selected_ids || []).length;
            if (editBtn) {
                editBtn.style.display = filesMode ? 'flex' : 'none';
                editBtn.classList.toggle('is-active', !!this.state.storage_edit_mode);
            }
            if (deleteBtn) {
                deleteBtn.style.display = (filesMode && this.state.storage_edit_mode && selectedCount > 0) ? 'flex' : 'none';
                deleteBtn.title = selectedCount > 0 ? `Удалить выбранные файлы (${selectedCount})` : 'Удалить выбранные файлы';
                deleteBtn.setAttribute('aria-label', deleteBtn.title);
            }
        };

        const renderFilesGrid = () => {
            if (!filesGridEl) return;
            const items = Array.isArray(this.state.storage_items) ? this.state.storage_items : [];

            if (!items.length) {
                filesGridEl.innerHTML = '<div class="storage-files-empty">Объекты хранилища не найдены.</div>';
                return;
            }

            const toTs = (item) => {
                const raw = item && item.created_at ? Date.parse(item.created_at) : NaN;
                return Number.isFinite(raw) ? raw : 0;
            };

            const sortedItems = [...items].sort((a, b) => toTs(b) - toTs(a));

            filesGridEl.innerHTML = sortedItems.map((item) => {
                const kind = item.object_kind || 'file';
                const type = item.file_type || 'other';
                const icon = iconByType[type] || iconByType.other;
                const safeName = escapeHtml(item.file_name || (kind === 'text_data' ? 'Текстовый объект' : 'Файл'));
                const sizeLabel = formatSize(item.file_size || 0);
                const canSelect = this.state.storage_edit_mode && kind === 'file' && !!item.file_path;
                const isSelected = (this.state.storage_selected_ids || []).includes(String(item.id));
                const classes = `storage-file-tile ${kind === 'text_data' ? 'storage-file-tile-text' : ''} ${canSelect ? 'storage-file-tile-selectable' : ''} ${isSelected ? 'is-selected' : ''}`;
                const safePath = escapeHtml(item.file_path || '');
                const iconHtml = (type === 'image' && safePath)
                    ? `<img src="${safePath}" alt="${safeName}" class="storage-file-preview-img" loading="lazy">`
                    : icon;
                return `<button type="button" class="${classes}" data-storage-file-id="${item.id}" title="${safeName}">
                    ${canSelect ? `<span class="storage-file-check">✓</span>` : ''}
                    <div class="storage-file-icon ${type === 'image' && safePath ? 'storage-file-icon-preview' : ''}">${iconHtml}</div>
                    <div class="storage-file-name">${safeName}</div>
                    <div class="storage-file-size">${sizeLabel}</div>
                </button>`;
            }).join('');
            updateStorageActionButtons();
        };

        if (!this.state.storage_lock_bound && lockBtn) {
            lockBtn.addEventListener('click', () => {
                cardEl.classList.toggle('storage-files-mode');
                const filesMode = cardEl.classList.contains('storage-files-mode');
                lockBtn.classList.toggle('menu-open', filesMode);
                lockBtn.setAttribute('aria-label', filesMode ? 'Закрыть файловый режим' : 'Открыть файловый режим');
                lockBtn.setAttribute('title', filesMode ? 'Закрыть файловый режим' : 'Открыть файловый режим');
                if (!filesMode) {
                    this.state.storage_edit_mode = false;
                    this.state.storage_selected_ids = [];
                }
                if (filesMode) renderFilesGrid();
                updateStorageActionButtons();
            });
            this.state.storage_lock_bound = true;
        }

        if (!this.state.storage_edit_bound && editBtn) {
            editBtn.addEventListener('click', () => {
                if (!cardEl.classList.contains('storage-files-mode')) return;
                this.state.storage_edit_mode = !this.state.storage_edit_mode;
                if (!this.state.storage_edit_mode) {
                    this.state.storage_selected_ids = [];
                }
                renderFilesGrid();
                updateStorageActionButtons();
            });
            this.state.storage_edit_bound = true;
        }

        if (!this.state.storage_delete_bound && deleteBtn) {
            deleteBtn.addEventListener('click', async () => {
                const selectedIds = this.state.storage_selected_ids || [];
                if (!selectedIds.length) return;
                const allItems = Array.isArray(this.state.storage_items) ? this.state.storage_items : [];
                const selectedItems = allItems.filter((it) => selectedIds.includes(String(it.id)) && it.object_kind === 'file' && it.file_path);
                if (!selectedItems.length) return;

                const doDelete = async () => {
                    try {
                        for (const item of selectedItems) {
                            await fetch('/api/chat/admin/delete-file', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${token}`
                                },
                                body: JSON.stringify({ file_url: item.file_path })
                            });
                        }

                        window.dispatchEvent(new CustomEvent('storage:file-deleted', {
                            detail: { filePaths: selectedItems.map((it) => it.file_path).filter(Boolean) }
                        }));

                        this.state.storage_selected_ids = [];
                        this.state.storage_edit_mode = false;
                        await this.renderStorageDonut();
                    } catch (err) {
                        console.error('Storage delete failed:', err);
                        this.showAlert('tmpl-error-alert', {
                            title: 'Ошибка',
                            text: 'Не удалось удалить выбранные файлы.'
                        });
                    }
                    updateStorageActionButtons();
                };

                const overlay = this.showAlert('tmpl-confirm-alert', {
                    title: 'Удалить файлы?',
                    text: `Будут удалены выбранные файлы (${selectedItems.length}) без возможности восстановления.`
                });

                if (!overlay) {
                    if (window.confirm(`Удалить выбранные файлы (${selectedItems.length}) без возможности восстановления?`)) {
                        await doDelete();
                    }
                    return;
                }

                const confirmBtn = overlay.querySelector('#confirm-yes');
                const cancelBtn = overlay.querySelector('#confirm-cancel');
                const close = () => {
                    overlay.style.opacity = '0';
                    document.body.style.overflow = '';
                    setTimeout(() => overlay.remove(), 300);
                };

                if (confirmBtn) {
                    confirmBtn.textContent = 'Удалить';
                    confirmBtn.onclick = async () => {
                        close();
                        await doDelete();
                    };
                }
                if (cancelBtn) cancelBtn.onclick = close;
            });
            this.state.storage_delete_bound = true;
        }

        if (!this.state.storage_files_click_bound && filesGridEl) {
            filesGridEl.addEventListener('click', (e) => {
                const tile = e.target.closest('[data-storage-file-id]');
                if (!tile) return;
                const id = String(tile.getAttribute('data-storage-file-id'));
                const items = Array.isArray(this.state.storage_items) ? this.state.storage_items : [];
                const item = items.find((it) => String(it.id) === id);
                if (!item) return;

                if (this.state.storage_edit_mode) {
                    if (item.object_kind !== 'file' || !item.file_path) return;
                    const selected = new Set(this.state.storage_selected_ids || []);
                    if (selected.has(id)) selected.delete(id);
                    else selected.add(id);
                    this.state.storage_selected_ids = Array.from(selected);
                    renderFilesGrid();
                    return;
                }

                if (item.object_kind === 'text_data' || !item.file_path) return;
                openOrDownloadFile(item);
            });
            this.state.storage_files_click_bound = true;
        }

        try {
            const res = await fetch(`/api/chat/admin/storage-usage?client_id=${clientId}&limit=500`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.status !== 'success') return;

            const colorMap = {
                image: '#e6194b',
                video: '#3cb44b',
                audio: '#ffe119',
                document: '#4363d8',
                other: '#f58231',
                text: '#911eb4'
            };

            const typeNames = {
                image: 'Фото',
                video: 'Видео',
                audio: 'Аудио',
                document: 'Документы',
                other: 'Прочее',
                text: 'Текст'
            };

            const byType = data.by_type || [];
            const textTotal = data.text_total || 0;
            const filesTotal = data.files_total || 0;
            const items = Array.isArray(data.items) ? data.items : [];
            this.state.storage_items = items;

            const typeOrder = ['image', 'video', 'audio', 'document', 'other', 'text'];
            const totalsByType = {
                image: 0,
                video: 0,
                audio: 0,
                document: 0,
                other: 0,
                text: 0
            };

            byType.forEach((t) => {
                const ft = t.file_type || 'other';
                if (Object.prototype.hasOwnProperty.call(totalsByType, ft)) {
                    totalsByType[ft] += (t.total_size || 0);
                } else {
                    totalsByType.other += (t.total_size || 0);
                }
            });

            totalsByType.text = textTotal || 0;

            const labels = [];
            const counts = [];
            const colors = [];
            let totalUsed = 0;

            typeOrder.forEach((typeKey) => {
                const label = typeNames[typeKey] || typeKey;
                const value = totalsByType[typeKey] || 0;
                labels.push(label);
                counts.push(value);
                colors.push(colorMap[typeKey] || '#808080');
                totalUsed += value;
            });

            totalUsed = filesTotal + textTotal;

            const hasAnyFiles = counts.some((value) => value > 0);

            if (!hasAnyFiles) {
                labels.push('Пусто');
                counts.push(1);
                colors.push('rgba(255,255,255,0.08)');
            }

            const tariffLimits = {
                start: 1 * 1024 * 1024 * 1024,
                business: 5 * 1024 * 1024 * 1024,
                neuro: 10 * 1024 * 1024 * 1024
            };
            const tariffMap = { 'старт': 'start', 'бизнес': 'business', 'нейро': 'neuro', 'start': 'start', 'business': 'business', 'neuro': 'neuro' };
            const tariffKey = tariffMap[(this.state.tariff_name || 'start').toLowerCase()] || 'start';
            const limit = data.storage_limit || this.state.storage_limit || tariffLimits[tariffKey] || tariffLimits.start;
            const free = Math.max(0, limit - totalUsed);

            if (free > 0) {
                labels.push('Свободно');
                counts.push(free);
                colors.push('rgba(255,255,255,0.05)');
            }

            const valEl = document.getElementById('storage-donut-value');
            const totalLimitEl = document.getElementById('storage-total-limit');
            const freeSpaceEl = document.getElementById('storage-free-space');

            if (valEl) {
                const percent = limit > 0 ? Math.min(100, Math.round((totalUsed / limit) * 100)) : 0;
                valEl.textContent = `${percent}%`;
            }
            if (totalLimitEl) totalLimitEl.textContent = `Общая: ${formatSize(limit)}`;
            if (freeSpaceEl) freeSpaceEl.textContent = `Свободно: ${formatSize(free)}`;

            const ctx = canvas.getContext('2d');
            if (this.state.charts.storage) this.state.charts.storage.destroy();

            this.state.charts.storage = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels,
                    datasets: [{
                        data: counts,
                        backgroundColor: colors,
                        borderWidth: 0,
                        hoverOffset: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => ` ${ctx.label}: ${formatSize(ctx.raw)}`
                            }
                        }
                    },
                    cutout: '70%'
                }
            });

            const legendEl = document.getElementById('storage-legend');
            if (legendEl) {
                let legendHtml = '';
                labels.forEach((label, i) => {
                    if (label === 'Свободно' || label === 'Пусто') return;
                    const typeClassMap = {
                        'Фото': 'storage-type-image',
                        'Видео': 'storage-type-video',
                        'Аудио': 'storage-type-audio',
                        'Документы': 'storage-type-document',
                        'Прочее': 'storage-type-other',
                        'Текст': 'storage-type-text'
                    };
                    const typeClass = typeClassMap[label] || '';
                    legendHtml += `<div class="storage-type-chip ${typeClass}">
                        <span class="storage-type-dot" style="background:${colors[i]};"></span>
                        <span class="storage-type-name">${label}</span>
                        <span class="storage-type-size">${formatSize(counts[i])}</span>
                    </div>`;
                });
                legendHtml += `<div class="storage-type-chip storage-type-total-row">
                    <span class="storage-type-name">Файлы / Текстовые данные</span>
                    <span class="storage-type-size">${formatSize(filesTotal)} / ${formatSize(textTotal)}</span>
                </div>`;
                legendEl.innerHTML = legendHtml;
            }

            if (cardEl.classList.contains('storage-files-mode')) {
                renderFilesGrid();
            }
            updateStorageActionButtons();

        } catch (e) {
            console.warn('Storage donut error:', e);
        }
    },

    async saveData() {
        console.log('Saving profile data...');
        this.clearProfileValidationErrors();

        const clientId = new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id');
        const token = localStorage.getItem('chatadmin_auth_token');

        const successfulOps = [];
        const failedOps = [];

        const accountResult = await this.saveAccountCardChanges({ silent: true });
        if (accountResult.status === 'success') successfulOps.push('email');
        if (accountResult.status === 'failed') failedOps.push(accountResult.message || 'Не удалось обновить email.');

        const platformNews = document.querySelector('.platform-news-checkbox')?.checked;
        const autoRenew = document.querySelector('.auto-renew-checkbox')?.checked;

        const prevPlatformNews = !!(this.state.notifications && this.state.notifications.platform_news);
        const prevAutoRenew = !!this.state.auto_renew;
        const platformNewsChanged = prevPlatformNews !== !!platformNews;
        const autoRenewChanged = prevAutoRenew !== !!autoRenew;

        const updates = {
            ui_settings: {
                ...this.state.ui_settings,
                profile_locked: this.state.ui_settings?.profile_locked
            },
            notifications: {
                ...this.state.notifications,
                platform_news: platformNews
            },
            auto_renew: autoRenew
        };

        try {
            const response = await fetch(`/api/chat/admin/config?client_id=${clientId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(updates)
            });
            const result = await response.json();

            if (result.status === 'success') {
                this.state = { ...this.state, ...updates };

                if (platformNewsChanged) successfulOps.push('уведомления платформы');
                if (autoRenewChanged) successfulOps.push('автопродление тарифа');
                if (!platformNewsChanged && !autoRenewChanged) successfulOps.push('настройки профиля');

                if (typeof window.restartMityaWidget === 'function') {
                    window.restartMityaWidget();
                } else {
                    const host = document.getElementById('mitya-widget-host');
                    if (host) host.remove();
                    window.__MITYA_WIDGET__ = false;

                    const oldScript = document.querySelector('script[src*="chat-widget.js"]');
                    if (oldScript) {
                        const newScript = document.createElement('script');
                        newScript.src = oldScript.src.split('?')[0] + '?t=' + Date.now();
                        newScript.defer = true;
                        document.head.appendChild(newScript);
                        oldScript.remove();
                    }
                }
            } else {
                failedOps.push(result.message || 'Не удалось сохранить настройки профиля.');
            }
        } catch (error) {
            console.error('Config save error:', error);
            failedOps.push('Не удалось сохранить настройки профиля (ошибка сети).');
        }

        const tariffResult = await this.saveTariffCardChanges({ silent: true });
        if (tariffResult.status === 'success') successfulOps.push('тариф');
        if (tariffResult.status === 'failed') failedOps.push(tariffResult.message || 'Не удалось сменить тариф.');

        const passwordResult = await this.savePasswordCardChanges({ silent: true });
        if (passwordResult.status === 'success') successfulOps.push('пароль');
        if (passwordResult.status === 'failed') failedOps.push(passwordResult.message || 'Не удалось обновить пароль.');

        if (failedOps.length === 0) {
            return;
        }

        const formattedFailedOps = failedOps.map((message) => this.formatSaveFailureMessage(message));

        this.showAlert('tmpl-error-alert', {
            title: successfulOps.length ? 'Не всё сохранилось' : 'Ошибка сохранения',
            report: { success: [], failed: formattedFailedOps }
        });
    },

    clearProfileValidationErrors() {
        document.querySelectorAll('.input-error').forEach((el) => el.classList.remove('input-error'));
    },

    markFieldsError(fields = []) {
        fields.forEach((field) => {
            if (field && field.classList) {
                field.classList.add('input-error');
            }
        });
    },

    clearTariffError() {
        document.querySelectorAll('#tariff-inline-grid .profile-tariff-option.input-error').forEach((el) => {
            el.classList.remove('input-error');
        });
    },

    setTariffError(tariffId = null) {
        this.clearTariffError();
        if (!tariffId) return;
        const card = document.querySelector(`#tariff-inline-grid .profile-tariff-option[data-tariff="${tariffId}"]`);
        if (card) card.classList.add('input-error');
    },

    formatSaveFailureMessage(message) {
        const text = String(message || '').trim();
        if (!text) return 'Не удалось сохранить изменения.';

        const insufficientFundsMatch = text.match(/^Недостаточно средств\.?\s*(.*)$/u);
        if (insufficientFundsMatch) {
            const firstLine = 'Недостаточно средств.';
            const remainder = (insufficientFundsMatch[1] || '').trim();
            if (!remainder) return firstLine;
            const secondLine = /[.!?]$/.test(remainder) ? remainder : `${remainder}.`;
            return `${firstLine}\n${secondLine}`;
        }

        return text.endsWith('.') ? text : `${text}.`;
    },

    async handlePasswordUpdate() {
        const result = await this.savePasswordCardChanges({ silent: false });
        return result.status === 'success';
    },

    async savePasswordCardChanges(options = {}) {
        const silent = Boolean(options.silent);

        const oldPasswordInput = document.getElementById('current-password');
        const newPasswordInput = document.getElementById('new-password');
        const confirmPasswordInput = document.getElementById('confirm-password');

        const oldPassword = oldPasswordInput?.value || '';
        const newPassword = newPasswordInput?.value || '';
        const confirmPassword = confirmPasswordInput?.value || '';

        if (!oldPassword && !newPassword && !confirmPassword) {
            return { status: 'skipped' };
        }

        if (!oldPassword || !newPassword || !confirmPassword) {
            const message = 'Заполните все поля паролей.';
            const missing = [];
            if (!oldPassword) missing.push(oldPasswordInput);
            if (!newPassword) missing.push(newPasswordInput);
            if (!confirmPassword) missing.push(confirmPasswordInput);
            this.markFieldsError(missing);
            if (!silent) this.showAlert('tmpl-error-alert', { title: 'Ошибка', text: message });
            return { status: 'failed', message };
        }

        if (newPassword !== confirmPassword) {
            const message = 'Пароли не совпадают.';
            this.markFieldsError([newPasswordInput, confirmPasswordInput]);
            if (!silent) this.showAlert('tmpl-error-alert', { title: 'Ошибка', text: message });
            return { status: 'failed', message };
        }

        if (newPassword.length < 6) {
            const message = 'Новый пароль должен быть не менее 6 символов.';
            this.markFieldsError([newPasswordInput]);
            if (!silent) this.showAlert('tmpl-error-alert', { title: 'Ошибка', text: message });
            return { status: 'failed', message };
        }

        try {
            const token = localStorage.getItem('chatadmin_auth_token');
            const response = await fetch('/api/chat/update-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ old_password: oldPassword, password: newPassword })
            });
            const data = await response.json();

            if (data.status === 'success') {
                ['current-password', 'new-password', 'confirm-password'].forEach((id) => {
                    const input = document.getElementById(id);
                    if (input) input.value = '';
                });
                if (!silent) {
                    this.showAlert('tmpl-success-alert', { title: 'Пароль изменён', text: 'Теперь используйте новый пароль при входе.' });
                }
                return { status: 'success' };
            }

            const message = data.message || 'Не удалось сменить пароль.';
            this.markFieldsError([oldPasswordInput, newPasswordInput, confirmPasswordInput]);
            if (!silent) this.showAlert('tmpl-error-alert', { title: 'Ошибка', text: message });
            return { status: 'failed', message };
        } catch (error) {
            const message = 'Не удалось связаться с сервером.';
            this.markFieldsError([oldPasswordInput, newPasswordInput, confirmPasswordInput]);
            if (!silent) this.showAlert('tmpl-error-alert', { title: 'Ошибка сети', text: message });
            return { status: 'failed', message };
        }
    },

    bindSecurityControls() {
        const lockBtn = document.getElementById('security-lock-btn');
        if (lockBtn) {
            lockBtn.addEventListener('click', () => this.toggleSecurityLock());
        }
        this.toggleSecurityLock(false);
    },

    toggleSecurityLock(forceUnlocked = null) {
        const card = document.getElementById('card-security');
        const lockBtn = document.getElementById('security-lock-btn');
        if (!card || !lockBtn) return;

        const unlocked = forceUnlocked === null
            ? card.classList.contains('security-locked')
            : Boolean(forceUnlocked);

        card.classList.toggle('security-locked', !unlocked);

        const lockIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>';
        const unlockIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 7.5-2"></path></svg>';

        lockBtn.innerHTML = unlocked ? unlockIcon : lockIcon;
        lockBtn.classList.toggle('menu-open', unlocked);
        lockBtn.setAttribute('aria-label', unlocked ? 'Заблокировать поля безопасности' : 'Редактировать безопасность');

        const controls = card.querySelectorAll('input, textarea, select, button.toggle-password-btn, button.link-muted-btn');
        controls.forEach((el) => {
            if (el === lockBtn) return;
            el.disabled = !unlocked;
        });

        if (!unlocked) {
            ['current-password', 'new-password', 'confirm-password'].forEach((id) => {
                const input = document.getElementById(id);
                if (input) {
                    input.value = '';
                    input.classList.remove('input-error');
                }
            });
        }
    },

    async saveLockState(isLocked) {
        try {
            const clientId = new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id');
            const token = localStorage.getItem('chatadmin_auth_token');
            await fetch(`/api/chat/admin/config?client_id=${clientId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ ui_settings: { profile_locked: isLocked } })
            });
        } catch (error) { console.error('Error saving lock state:', error); }
    },

    showAlert(templateId, data = {}) {
        const template = document.getElementById(templateId);
        if (!template) return;
        const clone = document.importNode(template.content, true);
        const overlay = clone.querySelector('.custom-alert-overlay');
        const titleEl = overlay.querySelector('.alert-title');
        const textEl = overlay.querySelector('.alert-text');

        if (data.title && titleEl) titleEl.textContent = data.title;

        if (data.report && textEl) {
            const successItems = Array.isArray(data.report.success) ? data.report.success : [];
            const failedItems = Array.isArray(data.report.failed) ? data.report.failed : [];

            overlay.classList.add('alert-report-overlay');
            textEl.textContent = '';

            const createSection = (heading, items, sectionClass) => {
                const section = document.createElement('div');
                section.className = `alert-report-section ${sectionClass}`;

                const headingEl = document.createElement('div');
                headingEl.className = 'alert-report-heading';
                headingEl.textContent = heading;
                section.appendChild(headingEl);

                const list = document.createElement('ul');
                list.className = 'alert-report-list';
                items.forEach((item) => {
                    const li = document.createElement('li');
                    li.textContent = item;
                    list.appendChild(li);
                });
                section.appendChild(list);
                return section;
            };

            if (successItems.length) {
                textEl.appendChild(createSection('Успешно:', successItems, 'is-success'));
            }
            if (failedItems.length) {
                textEl.appendChild(createSection('Ошибки', failedItems, 'is-error'));
            }
        } else if (data.text && textEl) {
            textEl.textContent = data.text;
        }

        document.body.appendChild(overlay);
        
        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
        });

        document.body.style.overflow = 'hidden';
        const close = () => { overlay.style.opacity = '0'; document.body.style.overflow = ''; setTimeout(() => overlay.remove(), 300); };
        const closeBtn = overlay.querySelector('.alert-btn-primary') || overlay.querySelector('.alert-btn-secondary');
        if (closeBtn) closeBtn.onclick = close;
        overlay.onclick = (e) => { if(e.target === overlay) close(); };
        return overlay;
    },

    async loadBalanceHistory() {
        const panel = document.getElementById('balance-history-panel');
        const list = document.getElementById('balance-history-list');
        if (!panel || !list) return;

        list.innerHTML = '<div class="value-small">Загрузка...</div>';

        try {
            const token = localStorage.getItem('chatadmin_auth_token');
            const res = await fetch('/api/payments/history', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();

            if (data.status !== 'success' || !Array.isArray(data.history) || !data.history.length) {
                list.innerHTML = '<div class="balance-history-empty">Пополнений пока нет</div>';
                return;
            }

            list.innerHTML = data.history.map((item) => {
                const date = item.date || '-';
                const amount = item.amount || 0;
                return `\n                    <div class="balance-history-item">\n                        <span class="balance-history-date">${date}</span>\n                        <span class="balance-history-amount">+${amount} ₽</span>\n                    </div>\n                `;
            }).join('');
        } catch (e) {
            list.innerHTML = '<div class="balance-history-empty">Не удалось загрузить историю</div>';
        }
    },

    async toggleBalanceHistory() {
        const panel = document.getElementById('balance-history-panel');
        const toggleBtn = document.getElementById('balance-history-toggle');
        if (!panel || !toggleBtn) return;

        const isOpen = panel.classList.contains('is-open');
        if (isOpen) {
            panel.classList.remove('is-open');
            toggleBtn.classList.remove('is-open');
            return;
        }

        panel.classList.add('is-open');
        toggleBtn.classList.add('is-open');
        await this.loadBalanceHistory();
    },

    async handleTopUp() {
        const amountInput = document.getElementById('topup-amount-inline');
        if (!amountInput) return;

        const rawAmount = parseInt(amountInput.value || amountInput.placeholder || '1000', 10);
        if (!rawAmount || isNaN(rawAmount) || rawAmount <= 0) {
            amountInput.classList.add('input-error');
            amountInput.focus();
            return;
        }

        amountInput.classList.remove('input-error');
        const clientId = new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id') || 'mitia_assistant';
        const token = localStorage.getItem('chatadmin_auth_token');

        try {
            const response = await fetch('/api/payments/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ amount: rawAmount, client_id: clientId })
            });
            const data = await response.json();
            if (data.confirmation_url) {
                window.location.href = data.confirmation_url;
                return;
            }
            this.showAlert('tmpl-error-alert', { title: 'Ошибка оплаты', text: data.error || 'Не удалось создать платёж.' });
        } catch (error) {
            this.showAlert('tmpl-error-alert', { title: 'Ошибка сети', text: 'Не удалось связаться с сервером оплаты.' });
        }
    },

    async performTariffChange(tariffId, options = {}) {
        const silent = Boolean(options.silent);
        const clientId = new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id');
        const token = localStorage.getItem('chatadmin_auth_token');

        this.state.lastTariffError = null;

        try {
            const response = await fetch(`/api/chat/admin/change-tariff?client_id=${clientId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ tariff: tariffId })
            });
            const data = await response.json();
            if (data.status === 'success') {
                this.clearTariffError();
                this.state.selected_tariff = null;
                this.loadData();
                return true;
            }

            const message = data.message || 'Не удалось сменить тариф';
            this.state.lastTariffError = message;
            this.setTariffError(tariffId);
            if (!silent) {
                this.showAlert('tmpl-error-alert', { title: 'Ошибка', text: message });
            }
            return false;
        } catch (error) {
            const message = 'Не удалось связаться с сервером';
            this.state.lastTariffError = message;
            this.setTariffError(tariffId);
            if (!silent) {
                this.showAlert('tmpl-error-alert', { title: 'Ошибка сети', text: message });
            }
            return false;
        }
    },

    getCurrentTariffId() {
        const tariffMap = {
            'старт': 'start',
            'бизнес': 'business',
            'нейро': 'neuro'
        };
        return tariffMap[(this.state.tariff_name || 'Старт').toLowerCase()] || 'start';
    },

    updateTariffInlineUI() {
        const cards = document.querySelectorAll('#tariff-inline-grid .profile-tariff-option');
        if (!cards.length) return;

        const currentTariff = this.getCurrentTariffId();
        const selectedTariff = this.state.selected_tariff || currentTariff;

        cards.forEach((card) => {
            const tariffId = card.dataset.tariff;
            card.classList.remove('current-tariff', 'pending-change');

            if (tariffId === currentTariff && tariffId === selectedTariff) {
                card.classList.add('current-tariff');
            } else if (tariffId === selectedTariff) {
                card.classList.add('pending-change');
            }
        });

    },

    bindTariffInlineControls() {
        const grid = document.getElementById('tariff-inline-grid');
        if (!grid) return;

        grid.querySelectorAll('.profile-tariff-option').forEach((card) => {
            card.addEventListener('click', () => {
                this.clearTariffError();
                this.state.selected_tariff = card.dataset.tariff;
                this.updateTariffInlineUI();
            });
        });

        this.updateTariffInlineUI();
    },

    async saveTariffCardChanges(options = {}) {
        const currentTariff = this.getCurrentTariffId();
        const selectedTariff = this.state.selected_tariff;
        if (!selectedTariff || selectedTariff === currentTariff) {
            this.clearTariffError();
            return { status: 'skipped' };
        }

        const changed = await this.performTariffChange(selectedTariff, options);
        return changed ? { status: 'success' } : { status: 'failed', message: this.state.lastTariffError || 'Не удалось сменить тариф.' };
    },

    // ---- Управление аккаунтом (карточка) ----

    bindAccountControls() {
        const lockBtn = document.getElementById('account-lock-btn');
        const deleteBtn = document.getElementById('account-delete-btn');

        if (lockBtn) {
            lockBtn.addEventListener('click', () => this.toggleAccountEditMode());
        }

        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => this.handleInlineAccountDelete());
        }

        this.toggleAccountEditMode(false);
    },

    toggleAccountEditMode(forceMode = null) {
        const card = document.getElementById('card-settings');
        const lockBtn = document.getElementById('account-lock-btn');
        if (!card || !lockBtn) return;

        const isOpen = forceMode === null
            ? !card.classList.contains('account-edit-mode')
            : Boolean(forceMode);

        card.classList.toggle('account-edit-mode', isOpen);

        const lockIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>';
        const unlockIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 7.5-2"></path></svg>';

        lockBtn.innerHTML = isOpen ? unlockIcon : lockIcon;
        lockBtn.classList.toggle('menu-open', isOpen);
        lockBtn.setAttribute('aria-label', isOpen ? 'Закрыть редактирование аккаунта' : 'Редактировать аккаунт');

        if (!isOpen) {
            const passwordInput = document.getElementById('account-delete-password');
            if (passwordInput) {
                passwordInput.value = '';
                passwordInput.classList.remove('input-error');
            }
        }
    },

    async saveAccountCardChanges(options = {}) {
        const silent = Boolean(options.silent);

        const emailInput = document.getElementById('account-email-new');
        const passwordInput = document.getElementById('account-email-password');
        if (!emailInput || !passwordInput) return { status: 'skipped' };

        const newEmail = (emailInput.value || '').trim().toLowerCase();
        const password = passwordInput.value || '';

        emailInput.classList.remove('input-error');
        passwordInput.classList.remove('input-error');

        if (!newEmail && !password) return { status: 'skipped' };

        if (!newEmail || !password) {
            if (!newEmail) emailInput.classList.add('input-error');
            if (!password) passwordInput.classList.add('input-error');
            const message = 'Введите новый email и текущий пароль.';
            if (!silent) this.showAlert('tmpl-error-alert', { title: 'Ошибка', text: message });
            return { status: 'failed', message };
        }

        const currentEmail = (document.getElementById('display-user-email')?.textContent || '').trim().toLowerCase();
        if (currentEmail && newEmail === currentEmail) {
            emailInput.classList.add('input-error');
            const message = 'Новый email совпадает с текущим.';
            if (!silent) this.showAlert('tmpl-error-alert', { title: 'Ошибка', text: message });
            return { status: 'failed', message };
        }

        try {
            const token = localStorage.getItem('chatadmin_auth_token');
            const res = await fetch('/api/chat/profile/change-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ new_email: newEmail, password })
            });
            const data = await res.json();

            if (data.status !== 'success') {
                const message = data.message || 'Не удалось сменить email';
                if (!silent) this.showAlert('tmpl-error-alert', { title: 'Ошибка', text: message });
                return { status: 'failed', message };
            }

            const emailEl = document.getElementById('display-user-email');
            if (emailEl) emailEl.textContent = newEmail;
            this.state.email = newEmail;

            emailInput.value = '';
            passwordInput.value = '';

            if (!silent) {
                this.showAlert('tmpl-success-alert', { title: 'Email изменён', text: 'Мы отправили уведомления на старый и новый адреса.' });
            }

            return { status: 'success' };
        } catch (e) {
            const message = 'Не удалось связаться с сервером';
            if (!silent) this.showAlert('tmpl-error-alert', { title: 'Ошибка сети', text: message });
            return { status: 'failed', message };
        }
    },

    async handleInlineAccountDelete() {
        const card = document.getElementById('card-settings');
        const passwordInput = document.getElementById('account-delete-password');

        if (!card || !passwordInput || !card.classList.contains('account-edit-mode')) {
            return;
        }

        const password = (passwordInput.value || '').trim();
        passwordInput.classList.remove('input-error');

        if (!password) {
            passwordInput.classList.add('input-error');
            this.showAlert('tmpl-error-alert', { title: 'Ошибка', text: 'Введите пароль для подтверждения удаления' });
            return;
        }

        try {
            const token = localStorage.getItem('chatadmin_auth_token');
            const res = await fetch('/api/chat/profile/delete-account', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ password })
            });
            const data = await res.json();

            if (data.status === 'success') {
                const successOverlay = this.showAlert('tmpl-success-alert', {
                    title: 'Аккаунт удалён',
                    text: 'Нажмите кнопку ниже или кликните по пустой области, чтобы перейти на страницу входа.'
                });
                const redirectToLogin = () => {
                    window.logout();
                    window.location.href = '/login';
                };
                if (successOverlay) {
                    const successBtn = successOverlay.querySelector('.alert-btn-primary');
                    if (successBtn) {
                        successBtn.textContent = 'Перейти ко входу';
                        successBtn.onclick = redirectToLogin;
                    }
                    successOverlay.onclick = (e) => {
                        if (e.target === successOverlay) redirectToLogin();
                    };
                }
                return;
            }

            passwordInput.classList.add('input-error');
            this.showAlert('tmpl-error-alert', { title: 'Ошибка', text: data.message || 'Не удалось удалить аккаунт' });
        } catch (e) {
            passwordInput.classList.add('input-error');
            this.showAlert('tmpl-error-alert', { title: 'Ошибка сети', text: 'Не удалось связаться с сервером' });
        }
    }
};
