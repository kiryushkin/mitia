import { countries } from './countries.js';
import { MessengersSettings } from './modules/messengers-settings.js';

let INTELLIGENCE_STANDARD = {};

async function loadIntelligenceStandard() {
    try {
        const res = await fetch('/api/chat/intelligence-defaults');
        const data = await res.json();
        INTELLIGENCE_STANDARD = data;
        return data;
    } catch (e) {
        console.warn('Failed to load intelligence defaults:', e);
        return null;
    }
}

export const PromptsModule = {
    state: {
        site_url: '',
        welcome_msg: '',
        currentCountry: countries.find(c => c.code === 'ru') || countries[0], // По умолчанию Россия
        bot_settings: {
            personality_prompt: '',
            negative_prompt: '',
            knowledge_file_url: '',
            knowledge_file_name: '',
            bot_name: '',
            bot_role: '',
            dna_addressing: 'formal',
            dna_tone: 'strict',
            dna_language: 'simple',
            dna_length: 'short',
            dna_proactive: 'reactive',
            dna_focus: 'facts',
            ai_model: 'gigachat',
            temperature: 0.3,
            dna_emojis: false,
            enable_tts: false,
            tts_voice: 'Nec_24000'
        },
        contacts: {
            extra_phones: [],
            extra_emails: [],
            extra_tg: [],
            extra_links: [],
            extra_addresses: []
        }
    },

    async init() {
        console.log('Prompts module V2 initialized');
        window.PromptsModule = this;

        if (this._intelligenceOrbRafId) {
            cancelAnimationFrame(this._intelligenceOrbRafId);
            this._intelligenceOrbRafId = null;
        }

        // Загружаем золотой стандарт интеллекта
        await loadIntelligenceStandard();
        if (INTELLIGENCE_STANDARD.bot_settings) {
            this.state.bot_settings = { ...this.state.bot_settings, ...INTELLIGENCE_STANDARD.bot_settings };
        }
        if (INTELLIGENCE_STANDARD.contacts) {
            this.state.contacts = { ...this.state.contacts, ...INTELLIGENCE_STANDARD.contacts };
        }
        if (INTELLIGENCE_STANDARD.site_url) {
            this.state.site_url = INTELLIGENCE_STANDARD.site_url;
        }

        if (typeof this.clearAllMyTempFiles === 'function') {
            this.clearAllMyTempFiles();
        }

        this.bindEvents();

        // Инициализация мессенджеров
        MessengersSettings.init(this);

        // Сначала инициализируем инпут телефона, чтобы DOM был готов
        this.initTelInput();

        // Затем загружаем данные и заполняем форму
        await this.loadData();

        this.initIntelligenceOrb();
        this.loadIndexedPages();

        if (this.cacheStatsInterval) clearInterval(this.cacheStatsInterval);
        this.cacheStatsInterval = setInterval(() => {
            const cacheGroup = document.getElementById('ai-cache-action-group');
            if (cacheGroup && !cacheGroup.classList.contains('hidden')) {
                this.loadCacheStats();
            }
        }, 5000);
    },

    initIntelligenceOrb() {
        const canvas = document.getElementById('intelligence-orb-canvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;
        const centerX = width / 2;
        const centerY = height / 2;

        let particles = [];
        const sphereRadius = 90;
        const numToAddEachFrame = 8;

        const r = 112;
        const g = 255;
        const b = 140;
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
                this.age += 1;

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
            for (let i = 0; i < numToAddEachFrame; i += 1) {
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(Math.random() * 2 - 1);
                const x = sphereRadius * Math.sin(phi) * Math.cos(theta);
                const y = sphereRadius * Math.sin(phi) * Math.sin(theta);
                const z = sphereRadius * Math.cos(phi);
                const vMult = 0.002;
                particles.push(new Particle(x, y, z, vMult * x, vMult * y, vMult * z));
            }
        }

        for (let i = 0; i < 150; i += 1) {
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
            const cosY = Math.cos(angY);
            const sinY = Math.sin(angY);
            const x1 = cosY * px + sinY * pz;
            const z1 = -sinY * px + cosY * pz;
            const y1 = py;

            const cosX = Math.cos(angX);
            const sinX = Math.sin(angX);
            const y2 = cosX * y1 - sinX * z1;
            const z2 = sinX * y1 + cosX * z1;

            return { x: x1, y: y2, z: z2 };
        }

        const animate = () => {
            ctx.clearRect(0, 0, width, height);

            angleY += 0.005;
            angleX = Math.sin(frameCount * 0.01) * 0.25;
            frameCount += 1;

            if (frameCount % 2 === 0) {
                generateParticles();
            }

            const fLen = 320;

            for (let i = particles.length - 1; i >= 0; i -= 1) {
                const p = particles[i];
                p.update();

                if (p.isDead()) {
                    particles.splice(i, 1);
                    continue;
                }

                const rotated = rotatePoint(p.x, p.y, p.z, angleY, angleX);
                const projScale = fLen / (fLen - rotated.z);
                const projX = rotated.x * projScale + centerX;
                const projY = rotated.y * projScale + centerY;

                const depthAlpha = Math.max(0, Math.min(1, 1 - rotated.z / -750));
                const finalAlpha = depthAlpha * p.alpha;

                const size = 1.0 * projScale;
                ctx.fillStyle = rgbString + (finalAlpha * 0.8) + ')';
                ctx.beginPath();
                ctx.arc(projX, projY, size, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.fillStyle = rgbString + '0.85)';
            ctx.beginPath();
            ctx.arc(centerX, centerY, 2.6, 0, Math.PI * 2);
            ctx.fill();

            this._intelligenceOrbRafId = requestAnimationFrame(animate);
        };

        animate();
    },

    bindEvents() {
        const getEl = (id) => document.getElementById(id);

        // Скрытые инпуты для файлов (используются в нескольких местах)
        const urlHidden = getEl('knowledge-file-url-hidden');
        const nameHidden = getEl('knowledge-file-name-hidden');

        const startIndexBtn = getEl('start-index-btn');
        if (startIndexBtn) {
            startIndexBtn.addEventListener('click', () => this.startIndexing());
        }

        const clearIndexBtn = getEl('clear-index-btn');
        if (clearIndexBtn) {
            clearIndexBtn.addEventListener('click', () => this.clearIndex());
        }

        const siteUrlInput = getEl('index-site-url');
        if (siteUrlInput) {
            siteUrlInput.addEventListener('input', (e) => {
                this.state.site_url = e.target.value.trim();
                this.updateIndexButtonsState();
            });
        }

        const textareas = document.querySelectorAll('.prompts-view textarea, .prompts-view input[type="text"], .prompts-view input[type="email"], .prompts-view input[type="tel"]');
        textareas.forEach(el => {
            const handler = (e) => {
                const setting = e.target.dataset.setting;
                if (!setting) return; 
                this.updateState(setting, e.target.value);
                this.syncWithWidget();
                this.updateCharCounter(el);
            };
            el.addEventListener('input', handler);
            el.addEventListener('change', handler);
            el.addEventListener('paste', () => setTimeout(() => handler({target: el}), 0));
            el.addEventListener('cut', () => setTimeout(() => handler({target: el}), 0));
        });

        const checkboxes = document.querySelectorAll('.prompts-view input[type="checkbox"]');
        checkboxes.forEach(el => {
            el.addEventListener('change', (e) => {
                const setting = e.target.dataset.setting;
                if (!setting) return; 
                this.updateState(setting, e.target.checked);

                if (setting === 'bot_settings.enable_knowledge_file') {
                    this.updateKnowledgeFileVisibility(e.target.checked);
                }

                if (setting === 'bot_settings.enable_cache') {
                    this.updateCacheButtonVisibility(e.target.checked);
                    if (e.target.checked) this.loadCacheStats();
                }

                if (setting === 'bot_settings.enable_tts') {
                    this.updateVoiceGroupVisibility(e.target.checked);
                }

                this.syncWithWidget();
            });
        });

        const clearCacheBtn = getEl('btn-clear-ai-cache');
        if (clearCacheBtn) {
            clearCacheBtn.addEventListener('click', () => this.clearAiCache());
        }

        const selects = document.querySelectorAll('.prompts-view select');
        selects.forEach(el => {
            el.addEventListener('change', (e) => {
                const setting = e.target.dataset.setting;
                this.updateState(setting, e.target.value);
                this.syncWithWidget();
            });
        });

        const reindexBtn = document.getElementById('reindex-btn');
        if (reindexBtn) {
            reindexBtn.addEventListener('click', () => this.handleReindex());
        }

        const addPhoneBtn = document.getElementById('add-extra-phone-btn');
        if (addPhoneBtn) {
            addPhoneBtn.addEventListener('click', () => this.showAddPhonePrompt());
        }

        const addEmailBtn = document.getElementById('add-extra-email-btn');
        if (addEmailBtn) {
            addEmailBtn.addEventListener('click', () => this.showAddEmailPrompt());
        }

        const addAddressBtn = document.getElementById('add-extra-address-btn');
        if (addAddressBtn) {
            addAddressBtn.addEventListener('click', () => this.showAddAddressPrompt());
        }

        const addLinkBtn = document.getElementById('add-extra-link-btn');
        if (addLinkBtn) {
            addLinkBtn.addEventListener('click', () => this.showAddLinkPrompt());
        }

        const knowledgeInput = document.getElementById('knowledge-file-upload');
        const knowledgePreview = document.getElementById('knowledge-file-preview');
        const knowledgeName = document.getElementById('knowledge-file-name');

        if (knowledgeInput && knowledgePreview) {
            knowledgeInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                if (file.size > 5 * 1024 * 1024) {
                    knowledgeName.textContent = 'Файл слишком большой (макс 5МБ)';
                    knowledgeInput.value = '';
                    return;
                }

                knowledgeName.textContent = 'Загрузка...';
                const formData = new FormData();
                formData.append('file', file);

                try {
                    const clientId = localStorage.getItem('chat_client_id');
                    const token = localStorage.getItem('chatadmin_auth_token');
                    const res = await fetch(`/api/chat/admin/upload-file?client_id=${clientId}&field_id=knowledge_file`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}` },
                        body: formData
                    });
                    const data = await res.json();
                    if (data.status === 'success') {
                        knowledgeName.textContent = `Файл: ${file.name}`;
                        knowledgePreview.classList.add('file-uploaded');
                        document.getElementById('knowledge-file-remove-btn').classList.remove('hidden');

                        this.state.bot_settings.knowledge_file_url = data.file_url;
                        this.state.bot_settings.knowledge_file_name = file.name;

                        if (urlHidden) urlHidden.value = data.file_url;
                        if (nameHidden) nameHidden.value = file.name;

                        await this.persistKnowledgeFileConfig();

                        this.renderKnowledgeFilePreview();
                        this.syncWithWidget();
                        knowledgeInput.value = ''; 
                    } else {
                        knowledgeName.textContent = data.message || 'Ошибка загрузки';
                        knowledgeInput.value = '';
                    }
                } catch (err) {
                    knowledgeName.textContent = 'Ошибка загрузки';
                    knowledgeInput.value = '';
                    console.error(err);
                }
            });
        }

        window.removeKnowledgeFile = async () => {
            const fileUrl = this.state.bot_settings.knowledge_file_url;

            this.state.bot_settings.knowledge_file_url = '';
            this.state.bot_settings.knowledge_file_name = '';
            if (urlHidden) urlHidden.value = '';
            if (nameHidden) nameHidden.value = '';

            const knowledgeInput = document.getElementById('knowledge-file-upload');
            if (knowledgeInput) knowledgeInput.value = '';

            const knowledgePreviewEl = document.getElementById('knowledge-file-preview');
            const knowledgeNameEl = document.getElementById('knowledge-file-name');
            const removeBtnEl = document.getElementById('knowledge-file-remove-btn');
            if (knowledgePreviewEl) knowledgePreviewEl.classList.remove('file-uploaded');
            if (knowledgeNameEl) knowledgeNameEl.textContent = 'PDF, DOCX, XLSX, TXT. Макс. вес: 5МБ';
            if (removeBtnEl) removeBtnEl.classList.add('hidden');

            this.syncWithWidget();

            try {
                const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
                const token = localStorage.getItem('chatadmin_auth_token');

                if (fileUrl && fileUrl.includes('/uploads/temp/')) {
                    await this.deleteTempFile('knowledge_file');
                } else if (fileUrl && token) {
                    await fetch('/api/chat/admin/delete-file', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({ file_url: fileUrl, client_id: clientId })
                    });
                }
            } catch (e) {
                console.error('Failed to remove knowledge file from server:', e);
            }

            await this.persistKnowledgeFileConfig();
            this.renderKnowledgeFilePreview();
        };

        if (!this._storageDeleteListenerBound) {
            this._onStorageFileDeleted = async (event) => {
                const filePaths = (event && event.detail && Array.isArray(event.detail.filePaths)) ? event.detail.filePaths : [];
                if (!filePaths.length) return;
                const currentUrl = this.state?.bot_settings?.knowledge_file_url || '';
                if (!currentUrl) return;
                if (!filePaths.includes(currentUrl)) return;

                this.state.bot_settings.knowledge_file_url = '';
                this.state.bot_settings.knowledge_file_name = '';

                const urlHiddenEl = document.getElementById('knowledge-file-url-hidden');
                const nameHiddenEl = document.getElementById('knowledge-file-name-hidden');
                if (urlHiddenEl) urlHiddenEl.value = '';
                if (nameHiddenEl) nameHiddenEl.value = '';

                const knowledgeInputEl = document.getElementById('knowledge-file-upload');
                if (knowledgeInputEl) knowledgeInputEl.value = '';

                this.renderKnowledgeFilePreview();
                this.syncWithWidget();
                await this.persistKnowledgeFileConfig();
            };
            window.addEventListener('storage:file-deleted', this._onStorageFileDeleted);
            this._storageDeleteListenerBound = true;
        }

        this.initIntelligencePersonalityControls();
        this.bindWorkingHoursEvents();
        this.bindLegalEvents();
    },

    async deleteTempFile(fieldId) {
        try {
            if (!fieldId) return;
            const clientId = localStorage.getItem('chat_client_id');
            const token = localStorage.getItem('chatadmin_auth_token');
            if (!clientId || !token) return;

            await fetch(`/api/chat/admin/delete-temp-file?client_id=${encodeURIComponent(clientId)}&field_id=${encodeURIComponent(fieldId)}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        } catch (e) { console.error('Failed to delete temp file:', e); }
    },

    async persistKnowledgeFileConfig() {
        try {
            const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
            const token = localStorage.getItem('chatadmin_auth_token');
            if (!clientId || !token) return;

            const payload = {
                bot_settings: {
                    knowledge_file_url: this.state.bot_settings.knowledge_file_url || '',
                    knowledge_file_name: this.state.bot_settings.knowledge_file_name || ''
                }
            };

            const res = await fetch(`/api/chat/admin/config?client_id=${clientId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            const result = await res.json();
            if (result.status === 'success' && result.config && result.config.bot_settings) {
                this.state.bot_settings.knowledge_file_url = result.config.bot_settings.knowledge_file_url || '';
                this.state.bot_settings.knowledge_file_name = result.config.bot_settings.knowledge_file_name || '';

                const urlHidden = document.getElementById('knowledge-file-url-hidden');
                const nameHidden = document.getElementById('knowledge-file-name-hidden');
                if (urlHidden) urlHidden.value = this.state.bot_settings.knowledge_file_url;
                if (nameHidden) nameHidden.value = this.state.bot_settings.knowledge_file_name;
            }
        } catch (e) {
            console.error('Failed to persist knowledge file config:', e);
        }
    },

    async clearAllMyTempFiles() {
        const allFields = ['knowledge_file', 'widget_img', 'msg_bot_avatar', 'msg_user_avatar', 'msg_operator_avatar', 'profile_avatar', 'window_bg_img', 'header_logo', 'welcome_img', 'inline_btn_accent_img', 'inline_btn_neutral_img', 'inline_btn_info_img'];
        await Promise.all(allFields.map((field) => this.deleteTempFile(field)));
    },

    syncWithWidget() {
        if (window.MityaWidget && window.MityaWidget.applyTheme) {
            window.MityaWidget.applyTheme({}, {
                bot_settings: this.state.bot_settings || {},
                welcome_msg: this.state.welcome_msg || ''
            });
        }
    },

    updateState(path, value) {
        const parts = path.split('.');
        let current = this.state;
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!(part in current) || typeof current[part] !== 'object') current[part] = {};
            current = current[part];
        }
        current[parts[parts.length - 1]] = value;
    },

    updateIndexButtonsState() {
        const urlInput = document.getElementById('index-site-url');
        const startIndexBtn = document.getElementById('start-index-btn');
        const clearIndexBtn = document.getElementById('clear-index-btn');
        const statPages = document.getElementById('stat-pages');
        const rawUrl = urlInput ? urlInput.value.trim() : '';
        const urlPattern = /[a-zA-Z0-9а-яёА-ЯЁ-]+\.[a-zA-Zа-яёА-ЯЁ]{2,}/;
        const hasValidUrl = rawUrl.length > 3 && (rawUrl.includes('://') || urlPattern.test(rawUrl));
        if (startIndexBtn) {
            startIndexBtn.disabled = !hasValidUrl;
            startIndexBtn.style.opacity = hasValidUrl ? '1' : '0.5';
            startIndexBtn.style.cursor = hasValidUrl ? 'pointer' : 'not-allowed';
        }
        const hasPages = statPages && parseInt(statPages.textContent) > 0;
        if (clearIndexBtn) {
            clearIndexBtn.disabled = !hasPages;
            clearIndexBtn.style.opacity = hasPages ? '1' : '0.5';
            clearIndexBtn.style.cursor = hasPages ? 'pointer' : 'not-allowed';
        }
    },

    bindWorkingHoursEvents() {
        document.querySelectorAll('.day-config-item').forEach(item => {
            const inputs = item.querySelectorAll('input');
            const toggle24h = item.querySelector('.toggle-24h');
            const fromInput = item.querySelector('.work-from');
            const toInput = item.querySelector('.work-to');
            
            if (toggle24h) {
                toggle24h.addEventListener('change', () => {
                    if (toggle24h.checked) {
                        if (fromInput) fromInput.value = "00:00";
                        if (toInput) toInput.value = "23:59";
                    }
                    this.syncWorkingHoursToState();
                });
            }

            inputs.forEach(input => {
                input.addEventListener('change', (e) => {
                    // Если изменили время вручную и оно не 00:00-23:59, выключаем тумблер 24ч
                    if (e.target.classList.contains('work-from') || e.target.classList.contains('work-to')) {
                        if (toggle24h && toggle24h.checked) {
                            const isStill24h = (fromInput.value === "00:00" && (toInput.value === "23:59" || toInput.value === "00:00"));
                            if (!isStill24h) {
                                toggle24h.checked = false;
                            }
                        }
                    }
                    this.syncWorkingHoursToState();
                });
                input.addEventListener('input', () => this.syncWorkingHoursToState());
            });
        });
    },

    bindLegalEvents() {
        const getEl = (id) => document.getElementById(id);
        window.updateLegalType = (type, btn, skipSave = false) => {
            // 1. Сохраняем данные текущего типа перед переключением (если не просили пропустить)
            if (!skipSave) {
                this.saveCurrentTypeData();
            }
            
            // 2. Визуальное переключение кнопок только в блоке реквизитов
            const legalTypeBtns = document.querySelectorAll('#card-legal .type-switcher .type-btn');
            legalTypeBtns.forEach((b) => b.classList.remove('active'));
            const targetBtn = btn || document.querySelector(`#card-legal .type-switcher .type-btn[data-type="${type}"]`);
            if (targetBtn) targetBtn.classList.add('active');
            
            // 3. Устанавливаем новый тип
            this.currentLegalType = type;
            
            const standardFields = getEl('legal-fields-standard');
            const selfFields = getEl('legal-fields-self');
            
            // 4. Переключаем видимость контейнеров
            if (type === 'self') {
                if (standardFields) standardFields.style.display = 'none';
                if (selfFields) selfFields.style.display = 'flex';
            } else {
                if (standardFields) standardFields.style.display = 'flex';
                if (selfFields) selfFields.style.display = 'none';
                
                const nameLabel = getEl('label-legal-fio');
                const ogrnLabel = getEl('label-legal-ogrn');
                const nameInput = document.querySelector('#legal-fields-standard input[data-legal="name"]');
                const ogrnInput = document.querySelector('#legal-fields-standard input[data-legal="ogrn"]');

                if (nameLabel) nameLabel.textContent = type === 'ip' ? 'ФИО предпринимателя' : 'Юридическое название';
                if (ogrnLabel) ogrnLabel.textContent = type === 'ip' ? 'ОГРНИП' : 'ОГРН';
                
                if (nameInput) nameInput.placeholder = type === 'ip' ? 'Иванов Иван Иванович' : 'ООО «Рога и Копыта»';
                if (ogrnInput) ogrnInput.placeholder = type === 'ip' ? '321774600709955' : '1127746007099';
            }
            
            // 5. Восстанавливаем данные для нового выбранного типа
            this.restoreTypeData(type);
        };
        const legalCard = getEl('card-legal');
        if (legalCard) {
            legalCard.addEventListener('input', (e) => {
                const field = e.target.closest('input[data-legal]');
                if (field) {
                    const key = field.dataset.legal;
                    if (!this.legalDataStore) this.legalDataStore = { ip: {}, ooo: {}, self: {} };
                    if (!this.currentLegalType) this.currentLegalType = 'ip';
                    if (!this.legalDataStore[this.currentLegalType]) this.legalDataStore[this.currentLegalType] = {};
                    
                    // Сначала форматируем (это может изменить field.value)
                    this.formatLegalNumbers(field, key);
                    
                    // Затем сохраняем актуальное значение
                    this.legalDataStore[this.currentLegalType][key] = field.value;
                }
            });
        }
    },

    saveCurrentTypeData() {
        if (!this.currentLegalType) return;
        if (!this.legalDataStore) this.legalDataStore = { ip: {}, ooo: {}, self: {} };
        
        const containerId = this.currentLegalType === 'self' ? 'legal-fields-self' : 'legal-fields-standard';
        const container = document.getElementById(containerId);
        if (container) {
            const data = this.legalDataStore[this.currentLegalType] || {};
            container.querySelectorAll('input[data-legal]').forEach(input => {
                data[input.dataset.legal] = input.value;
            });
            this.legalDataStore[this.currentLegalType] = data;
        }
    },

    restoreTypeData(type) {
        if (!this.legalDataStore) this.legalDataStore = { ip: {}, ooo: {}, self: {} };
        if (!this.legalDataStore[type]) this.legalDataStore[type] = {};
        
        const data = this.legalDataStore[type];
        const containerId = type === 'self' ? 'legal-fields-self' : 'legal-fields-standard';
        const container = document.getElementById(containerId);
        if (container) {
            container.querySelectorAll('input[data-legal]').forEach(input => {
                input.value = data[input.dataset.legal] || '';
            });
        }
    },

    formatLegalNumbers(input, key) {
        if (['name', 'address', 'bank_name', 'pass_issuer', 'birth_place', 'reg_address'].includes(key)) return;
        
        let val = input.value.replace(/\D/g, "");
        
        if (key === 'birth_date' || key === 'pass_date') {
            if (val.length > 8) val = val.substring(0, 8);
            let formatted = "";
            if (val.length > 0) {
                formatted = val.substring(0, 2);
                if (val.length > 2) {
                    formatted += "." + val.substring(2, 4);
                    if (val.length > 4) formatted += "." + val.substring(4, 8);
                }
            }
            input.value = formatted;
        } else if (key === 'pass_code') {
            // Маска для кода подразделения XXX-XXX
            if (val.length > 6) val = val.substring(0, 6);
            let formatted = "";
            if (val.length > 0) {
                formatted = val.substring(0, 3);
                if (val.length > 3) {
                    formatted += "-" + val.substring(3, 6);
                }
            }
            input.value = formatted;
        } else if (key === 'inn') {
            // ИНН 10 или 12 цифр
            if (val.length > 12) val = val.substring(0, 12);
            input.value = val;
        } else if (key === 'ogrn') {
            // ОГРН 13 или 15 цифр
            if (val.length > 15) val = val.substring(0, 15);
            input.value = val;
        } else if (key === 'bank_bik') {
            // БИК 9 цифр
            if (val.length > 9) val = val.substring(0, 9);
            input.value = val;
        } else if (key === 'bank_account' || key === 'bank_corr') {
            // Счета 20 цифр
            if (val.length > 20) val = val.substring(0, 20);
            input.value = val;
        } else if (key === 'pass_seria') {
            if (val.length > 4) val = val.substring(0, 4);
            input.value = val;
        } else if (key === 'pass_number') {
            if (val.length > 6) val = val.substring(0, 6);
            input.value = val;
        } else {
            input.value = val;
        }
    },

    syncWorkingHoursToState() {
        const workingHours = {};
        document.querySelectorAll('.day-config-item').forEach(row => {
            const day = row.dataset.day;
            const enabled = row.querySelector('.day-enable-toggle').checked;
            const is24h = row.querySelector('.toggle-24h').checked;
            const from = row.querySelector('.work-from').value;
            const to = row.querySelector('.work-to').value;
            
            const lunchEnabled = row.querySelector('.toggle-lunch').checked;
            const lunchFrom = row.querySelector('.lunch-from').value;
            const lunchTo = row.querySelector('.lunch-to').value;
            
            workingHours[day] = { 
                enabled, 
                is_24h: is24h,
                from: is24h ? "00:00" : from, 
                to: is24h ? "23:59" : to,
                lunch_enabled: lunchEnabled,
                lunch_from: lunchFrom,
                lunch_to: lunchTo
            };
        });
        this.state.working_hours = workingHours;
    },

    async loadData() {
        try {
            const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
            const token = localStorage.getItem('chatadmin_auth_token');
            const res = await fetch(`/api/chat/admin/config?client_id=${clientId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await res.json();
            if (result.status === 'success' && result.config) {
                const data = result.config;
                if (data.site_url !== undefined) this.state.site_url = data.site_url;
                if (data.working_hours_holidays !== undefined) this.state.working_hours_holidays = data.working_hours_holidays;
                if (data.working_hours_holidays_enabled !== undefined) this.state.working_hours_holidays_enabled = data.working_hours_holidays_enabled;
                
                if (data.contacts) {
                    this.state.contacts = data.contacts;
                    if (!this.state.contacts.extra_phones) this.state.contacts.extra_phones = [];
                    if (!this.state.contacts.extra_emails) this.state.contacts.extra_emails = [];
                    if (!this.state.contacts.extra_tg) this.state.contacts.extra_tg = [];
                    if (!this.state.contacts.extra_links) this.state.contacts.extra_links = [];
                    if (!this.state.contacts.extra_addresses) this.state.contacts.extra_addresses = [];
                    
                    // Форматируем загруженные доп. телефоны
                    this.state.contacts.extra_phones.forEach(p => {
                        if (p.phone) {
                            const country = countries.find(c => c.code === (p.country_code || 'ru').toLowerCase()) || countries[0];
                            p.dial_code = country.dialCode;
                            p.mask = country.mask;
                            
                            let cleanDial = country.dialCode.replace(/\D/g, "");
                            let digitsOnly = p.phone.replace(/\D/g, "");
                            if (digitsOnly.startsWith(cleanDial)) {
                                digitsOnly = digitsOnly.substring(cleanDial.length);
                            }
                            p.tempPhoneDigits = digitsOnly;
                            
                            let maskTemplate = country.mask.replace(country.dialCode, "").trim();
                            let result = "";
                            let i = 0;
                            for (let char of maskTemplate) {
                                if (i >= digitsOnly.length) break;
                                if (char === "_") result += digitsOnly[i++];
                                else result += char;
                            }
                            p.formatted_value = result;
                        }
                    });

                    if (data.contacts.phone) {
                        const fullPhone = data.contacts.phone;
                        const countryCode = data.contacts.country_code; // Пробуем взять код страны
                        const sortedCountries = [...countries].sort((a, b) => b.dialCode.length - a.dialCode.length);
                        
                        let foundCountry;
                        
                        // Если в базе есть код страны, используем его (самый надежный способ)
                        if (countryCode) {
                            foundCountry = countries.find(c => c.code === countryCode.toLowerCase());
                        }
                        
                        // Если кода нет или не нашли, используем старую логику с цифрами
                        if (!foundCountry) {
                            if (fullPhone.startsWith('+7')) {
                                if (fullPhone.startsWith('+77')) {
                                    foundCountry = countries.find(c => c.code === 'kz');
                                } else {
                                    foundCountry = countries.find(c => c.code === 'ru');
                                }
                            } else {
                                foundCountry = sortedCountries.find(c => fullPhone.startsWith(c.dialCode));
                            }
                        }
                        
                        if (foundCountry) {
                            this.state.currentCountry = foundCountry;
                            let cleanDial = foundCountry.dialCode.replace(/\D/g, "");
                            let digitsOnly = fullPhone.replace(/\D/g, "");
                            if (digitsOnly.startsWith(cleanDial)) {
                                digitsOnly = digitsOnly.substring(cleanDial.length);
                            }
                            this.state.tempPhoneDigits = digitsOnly;
                        }
                    }
                }

                this.state.profile_website = data.contacts ? data.contacts.website : '';
                if (data.welcome_msg !== undefined) this.state.welcome_msg = data.welcome_msg;
                if (data.bot_settings) {
                    Object.keys(data.bot_settings).forEach(key => {
                        this.state.bot_settings[key] = data.bot_settings[key];
                    });
                }
                if (data.working_hours) this.state.working_hours = data.working_hours;
                if (data.legal_data) this.legalDataStore = data.legal_data;
                if (data.legal) this.currentLegalType = data.legal.type || 'ip';
                this.fillForm();
                this.loadCacheStats();
                this.updateIndexButtonsState();
            }
        } catch (err) { console.error('Load prompts error:', err); }
    },

    fillForm() {
        const data = this.state;
        const inputs = document.querySelectorAll('.prompts-view [data-setting]');
        inputs.forEach(el => {
            const setting = el.dataset.setting;
            if (!setting) return;
            let val = setting.split('.').reduce((o, i) => (o ? o[i] : ''), data);
            if (el.type === 'checkbox') {
                el.checked = !!val;
                if (setting === 'bot_settings.enable_knowledge_file') this.updateKnowledgeFileVisibility(el.checked);
                if (setting === 'bot_settings.enable_cache') {
                    this.updateCacheButtonVisibility(el.checked);
                    if (el.checked) this.loadCacheStats();
                }
            } else el.value = val || '';
            // Убрал автоматический плейсхолдер из профиля, чтобы не путать пользователя
            // if (setting === 'site_url' && !el.value && this.state.profile_website) el.placeholder = this.state.profile_website;
            this.updateCharCounter(el);
        });

        const phoneInput = document.querySelector('#contact-phone');
        if (phoneInput) {
            const fullPhone = (this.state.contacts && this.state.contacts.phone) ? this.state.contacts.phone : "";
            const countryCode = (this.state.contacts && this.state.contacts.country_code) ? this.state.contacts.country_code : "";
            
            if (fullPhone) {
                const sortedCountries = [...countries].sort((a, b) => b.dialCode.length - a.dialCode.length);
                
                let foundCountry;
                
                // Приоритет коду страны из базы
                if (countryCode) {
                    foundCountry = countries.find(c => c.code === countryCode.toLowerCase());
                }
                
                if (!foundCountry) {
                    const cleanPhone = fullPhone.replace(/\D/g, "");
                    if (fullPhone.startsWith('+7') || (cleanPhone.startsWith('7') && cleanPhone.length === 11)) {
                        if (fullPhone.startsWith('+77') || (cleanPhone.startsWith('77') && cleanPhone.length === 11)) {
                            foundCountry = countries.find(c => c.code === 'kz');
                        } else {
                            foundCountry = countries.find(c => c.code === 'ru');
                        }
                    } else {
                        foundCountry = sortedCountries.find(c => fullPhone.startsWith(c.dialCode));
                    }
                }

                if (foundCountry) {
                    this.state.currentCountry = foundCountry;
                    let cleanDial = foundCountry.dialCode.replace(/\D/g, "");
                    let digitsOnly = fullPhone.replace(/\D/g, "");
                    if (digitsOnly.startsWith(cleanDial)) {
                        digitsOnly = digitsOnly.substring(cleanDial.length);
                    }
                    this.state.tempPhoneDigits = digitsOnly;
                    
                    // Форматируем значение для инпута
                    let maskTemplate = foundCountry.mask.replace(foundCountry.dialCode, "").trim();
                    let result = "";
                    let i = 0;
                    for (let char of maskTemplate) {
                        if (i >= digitsOnly.length) break;
                        if (char === "_") {
                            result += digitsOnly[i++];
                        } else {
                            result += char;
                        }
                    }
                    phoneInput.value = result;
                } else {
                    phoneInput.value = fullPhone;
                }
            } else {
                this.state.tempPhoneDigits = "";
                phoneInput.value = "";
            }
            this.updateSelectedCountryUI();
        }

        this.syncPersonalityControlsUI();

        const urlHiddenEl = document.getElementById('knowledge-file-url-hidden');
        const nameHiddenEl = document.getElementById('knowledge-file-name-hidden');
        if (urlHiddenEl) urlHiddenEl.value = this.state.bot_settings.knowledge_file_url || "";
        if (nameHiddenEl) nameHiddenEl.value = this.state.bot_settings.knowledge_file_name || "";

        if (this.currentLegalType) {
            window.updateLegalType(this.currentLegalType, null, true);
        }
        
        this.renderExtraPhones();
        this.renderExtraEmails();
        this.renderExtraAddresses();
        this.renderExtraLinks();
        if (window.MessengersModule) {
            if (typeof window.MessengersModule.renderExtraTg === 'function') window.MessengersModule.renderExtraTg();
            if (typeof window.MessengersModule.renderExtraWa === 'function') window.MessengersModule.renderExtraWa();
            if (typeof window.MessengersModule.renderExtraMax === 'function') window.MessengersModule.renderExtraMax();
            if (typeof window.MessengersModule.renderExtraVk === 'function') window.MessengersModule.renderExtraVk();
        }
        this.renderKnowledgeFilePreview();

        // Заполняем режим работы
        if (this.state.working_hours) {
            Object.keys(this.state.working_hours).forEach(day => {
                const config = this.state.working_hours[day];
                const row = document.querySelector(`.day-config-item[data-day="${day}"]`);
                if (row) {
                    const enableToggle = row.querySelector('.day-enable-toggle');
                    const toggle24h = row.querySelector('.toggle-24h');
                    const fromInput = row.querySelector('.work-from');
                    const toInput = row.querySelector('.work-to');
                    
                    const lunchToggle = row.querySelector('.toggle-lunch');
                    const lunchFromInput = row.querySelector('.lunch-from');
                    const lunchToInput = row.querySelector('.lunch-to');
                    
                    if (enableToggle) enableToggle.checked = !!config.enabled;
                    if (toggle24h) toggle24h.checked = !!config.is_24h;
                    if (fromInput) fromInput.value = config.from || '09:00';
                    if (toInput) toInput.value = config.to || '18:00';
                    
                    if (lunchToggle) lunchToggle.checked = !!config.lunch_enabled;
                    if (lunchFromInput) lunchFromInput.value = config.lunch_from || '13:00';
                    if (lunchToInput) lunchToInput.value = config.lunch_to || '14:00';
                }
            });
        }
    },

    renderKnowledgeFilePreview() {
        const url = this.state.bot_settings.knowledge_file_url;
        const name = this.state.bot_settings.knowledge_file_name;
        const preview = document.getElementById('knowledge-file-preview');
        const nameEl = document.getElementById('knowledge-file-name');
        const removeBtn = document.getElementById('knowledge-file-remove-btn');
        if (!preview || !nameEl || !removeBtn) return;
        if (url) {
            preview.classList.add('file-uploaded');
            nameEl.textContent = `Файл: ${name || url.split('/').pop()}`;
            removeBtn.classList.remove('hidden');
        } else {
            preview.classList.remove('file-uploaded');
            nameEl.textContent = 'PDF, DOCX, XLSX, TXT. Макс. вес: 5МБ';
            removeBtn.classList.add('hidden');
        }
    },

    updateCharCounter(el) {
        const counterContainer = el.parentElement.querySelector('.char-counter');
        if (!counterContainer) return;
        const counterSpan = counterContainer.querySelector('span');
        if (counterSpan) counterSpan.textContent = el.value.length;
    },

    updateKnowledgeFileVisibility(enabled) {
        const group = document.getElementById('prompt-knowledge-file-group');
        if (group) {
            group.style.display = enabled ? 'block' : 'none';
            group.classList.toggle('hidden', !enabled);
        }
    },

    updateCacheButtonVisibility(enabled) {
        const group = document.getElementById('ai-cache-action-group');
        if (group) {
            group.style.display = enabled ? 'block' : 'none';
            group.classList.toggle('hidden', !enabled);
        }
    },

    updateVoiceGroupVisibility(enabled) {
        const group = document.getElementById('prompt-voice-group');
        if (!group) return;
        group.style.display = enabled ? 'block' : 'none';
        group.classList.toggle('hidden', !enabled);
    },

    initIntelligencePersonalityControls() {
        const setupDnaSwitcher = (switcherId, inputId, stateKey) => {
            const switcher = document.getElementById(switcherId);
            const input = document.getElementById(inputId);
            if (!switcher || !input) return;

            switcher.querySelectorAll('.type-btn').forEach((btn) => {
                btn.addEventListener('click', () => {
                    switcher.querySelectorAll('.type-btn').forEach((b) => b.classList.remove('active'));
                    btn.classList.add('active');
                    const val = btn.dataset.dnaVal;
                    input.value = val;
                    this.state.bot_settings[stateKey] = val;
                    this.syncWithWidget();
                });
            });
        };

        setupDnaSwitcher('dna-addressing-switcher', 'dna-addressing', 'dna_addressing');
        setupDnaSwitcher('dna-tone-switcher', 'dna-tone', 'dna_tone');
        setupDnaSwitcher('dna-language-switcher', 'dna-language', 'dna_language');
        setupDnaSwitcher('dna-length-switcher', 'dna-length', 'dna_length');
        setupDnaSwitcher('dna-proactive-switcher', 'dna-proactive', 'dna_proactive');
        setupDnaSwitcher('dna-focus-switcher', 'dna-focus', 'dna_focus');

        const modelSwitcher = document.getElementById('ai-model-switcher');
        const modelInput = document.getElementById('prompt-ai-model');
        if (modelSwitcher && modelInput) {
            modelSwitcher.querySelectorAll('.type-btn').forEach((btn) => {
                btn.addEventListener('click', () => {
                    modelSwitcher.querySelectorAll('.type-btn').forEach((b) => b.classList.remove('active'));
                    btn.classList.add('active');
                    const val = btn.dataset.dnaVal;
                    modelInput.value = val;
                    this.state.bot_settings.ai_model = val;
                    this.syncWithWidget();
                });
            });
        }

        const tempInput = document.getElementById('dna-temp-input');
        const tempVal = document.getElementById('dna-temp-val');
        if (tempInput && tempVal) {
            const updateTemp = (percentRaw) => {
                const percent = Number.parseInt(percentRaw, 10) || 30;
                tempVal.textContent = `${percent}%`;
                this.state.bot_settings.temperature = percent / 100;
            };
            tempInput.addEventListener('input', (e) => {
                updateTemp(e.target.value);
                this.syncWithWidget();
            });
        }

        const voiceInput = document.getElementById('prompt-voice-input');
        document.querySelectorAll('#prompt-voice-group .voice-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#prompt-voice-group .voice-btn').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                const val = btn.dataset.voiceVal;
                if (voiceInput) voiceInput.value = val;
                this.state.bot_settings.tts_voice = val;
                this.syncWithWidget();
            });
        });

        window.playVoiceSample = async (voice) => {
            try {
                const response = await fetch('/api/chat/tts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: 'Здравствуйте! Я ваш голосовой помощник. Как я могу вам помочь?',
                        voice
                    })
                });
                const data = await response.json();
                if (data.url) {
                    const audio = new Audio(data.url);
                    audio.play().catch(() => {});
                }
            } catch (e) {}
        };

        this.syncPersonalityControlsUI();
    },

    syncPersonalityControlsUI() {
        const botSettings = this.state.bot_settings || {};

        const switchers = [
            { id: 'dna-addressing-switcher', key: 'dna_addressing', fallback: 'formal' },
            { id: 'dna-tone-switcher', key: 'dna_tone', fallback: 'strict' },
            { id: 'dna-language-switcher', key: 'dna_language', fallback: 'simple' },
            { id: 'dna-length-switcher', key: 'dna_length', fallback: 'short' },
            { id: 'dna-proactive-switcher', key: 'dna_proactive', fallback: 'reactive' },
            { id: 'dna-focus-switcher', key: 'dna_focus', fallback: 'facts' },
            { id: 'ai-model-switcher', key: 'ai_model', fallback: 'gigachat' }
        ];

        switchers.forEach(({ id, key, fallback }) => {
            const switcher = document.getElementById(id);
            if (!switcher) return;
            const val = botSettings[key] || fallback;
            switcher.querySelectorAll('.type-btn').forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.dnaVal === val);
            });
        });

        const hiddenMap = [
            { id: 'dna-addressing', key: 'dna_addressing', fallback: 'formal' },
            { id: 'dna-tone', key: 'dna_tone', fallback: 'strict' },
            { id: 'dna-language', key: 'dna_language', fallback: 'simple' },
            { id: 'dna-length', key: 'dna_length', fallback: 'short' },
            { id: 'dna-proactive', key: 'dna_proactive', fallback: 'reactive' },
            { id: 'dna-focus', key: 'dna_focus', fallback: 'facts' },
            { id: 'prompt-ai-model', key: 'ai_model', fallback: 'gigachat' },
            { id: 'prompt-voice-input', key: 'tts_voice', fallback: 'Nec_24000' }
        ];

        hiddenMap.forEach(({ id, key, fallback }) => {
            const el = document.getElementById(id);
            if (el) el.value = botSettings[key] || fallback;
        });

        const tempInput = document.getElementById('dna-temp-input');
        const tempVal = document.getElementById('dna-temp-val');
        const temp = Number(botSettings.temperature);
        const percent = Number.isFinite(temp) ? Math.round(temp * 100) : 30;
        if (tempInput) tempInput.value = String(percent);
        if (tempVal) tempVal.textContent = `${percent}%`;

        const emojiToggle = document.getElementById('dna-emojis');
        if (emojiToggle) {
            const emojiValue = botSettings.dna_emojis;
            emojiToggle.checked = emojiValue === true || emojiValue === 'none' || emojiValue === 'yes';
        }

        document.querySelectorAll('#prompt-voice-group .voice-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.voiceVal === (botSettings.tts_voice || 'Nec_24000'));
        });

        this.updateVoiceGroupVisibility(!!botSettings.enable_tts);
    },

    async loadCacheStats() {
        try {
            const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
            const token = localStorage.getItem('chatadmin_auth_token');
            const res = await fetch(`/api/chat/admin/cache/stats?client_id=${clientId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.status === 'success') {
                const count = data.count || 0;
                const countEl = document.getElementById('ai-cache-count');
                const btn = document.getElementById('btn-clear-ai-cache');
                if (countEl) countEl.textContent = count;
                if (btn) {
                    btn.disabled = count === 0;
                    btn.style.opacity = count === 0 ? '0.5' : '1';
                    btn.style.pointerEvents = count === 0 ? 'none' : 'auto';
                }
            }
        } catch (e) {}
    },

    async clearAiCache() {
        const performClear = async () => {
            try {
                const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
                const token = localStorage.getItem('chatadmin_auth_token');
                const res = await fetch(`/api/chat/admin/cache/clear?client_id=${clientId}`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) this.loadCacheStats();
            } catch (e) {}
        };

        if (typeof window.showAlert === 'function') {
            const overlay = window.showAlert('tmpl-confirm-alert', {
                title: 'Очистить кэш?',
                text: 'Все сохраненные ответы ИИ будут удалены. Это может временно замедлить ответы ассистента.'
            });
            if (overlay) {
                const confirmBtn = overlay.querySelector('#confirm-yes');
                const cancelBtn = overlay.querySelector('#confirm-cancel');
                const close = () => { 
                    overlay.style.opacity = '0'; 
                    document.body.style.overflow = ''; 
                    setTimeout(() => overlay.remove(), 300); 
                };
                
                if (confirmBtn) {
                    confirmBtn.textContent = 'Очистить';
                    confirmBtn.onclick = () => { performClear(); close(); };
                }
                if (cancelBtn) cancelBtn.onclick = close;
            }
        } else {
            if (confirm('Очистить кэш ответов ИИ?')) performClear();
        }
    },

    showAddPhonePrompt() {
        if (typeof window.showAlert !== 'function') {
            const label = prompt('Введите название для нового телефона:');
            if (label) this.addExtraPhone(label);
            return;
        }

        const overlay = window.showAlert('tmpl-prompt-alert', {});
        if (overlay) {
            const titleEl = overlay.querySelector('.alert-title');
            const textEl = overlay.querySelector('.alert-text');
            if (titleEl) titleEl.textContent = 'Добавить телефон';
            if (textEl) textEl.textContent = 'Введите название';

            const input = overlay.querySelector('#prompt-input');
            const confirmBtn = overlay.querySelector('#prompt-confirm');
            const cancelBtn = overlay.querySelector('#prompt-cancel');
            const close = () => { 
                overlay.style.opacity = '0'; 
                document.body.style.overflow = ''; 
                setTimeout(() => overlay.remove(), 300); 
            };

            if (input) {
                input.placeholder = "Например: Техподдержка";
                setTimeout(() => input.focus(), 100);
            }

            if (confirmBtn) {
                confirmBtn.onclick = () => {
                    const val = input.value.trim();
                    if (val) {
                        this.addExtraPhone(val);
                        close();
                    }
                };
            }            if (cancelBtn) cancelBtn.onclick = close;
            
            input.onkeydown = (e) => {
                if (e.key === 'Enter') confirmBtn.click();
                if (e.key === 'Escape') close();
            };
        }
    },

    addExtraPhone(label) {
        if (!this.state.contacts.extra_phones) this.state.contacts.extra_phones = [];
        const newPhone = {
            id: Date.now(),
            label: label,
            phone: '',
            country_code: 'ru',
            dial_code: '+7',
            mask: '+7 (___) ___-__-__',
            tempPhoneDigits: ''
        };
        this.state.contacts.extra_phones.push(newPhone);
        this.renderExtraPhones();
    },

    renderExtraPhones() {
        const container = document.getElementById('extra-phones-container');
        const wrapper = document.getElementById('extra-phones-wrapper');
        if (!container) return;

        const phones = this.state.contacts.extra_phones || [];
        
        if (wrapper) {
            wrapper.style.display = phones.length > 0 ? 'block' : 'none';
        }

        container.innerHTML = phones.map((p, index) => `
            <div class="setting-item ${index === 0 ? '' : 'mt-10'}" data-id="${p.id}">
                <label class="subtitle-card">${p.label}</label>
                <div class="flex-row-gap-10">
                    <div class="phone-input-container flex-1" id="phone-container-${p.id}">
                        <div class="country-select" id="country-trigger-${p.id}">
                            <span class="selected-flag">${this.getFlagEmoji(p.country_code || 'ru')}</span>
                            <span class="selected-dial-code">${p.dial_code || '+7'}</span>
                            <div class="country-dropdown" id="country-dropdown-${p.id}">
                                <div class="country-search-container">
                                    <input type="text" class="country-search" placeholder="Поиск страны..." onclick="event.stopPropagation()">
                                </div>
                                <div class="country-list-items"></div>
                            </div>
                        </div>
                        <input type="tel" class="hex-input-full extra-phone-input" 
                               placeholder="${(p.mask || '+7 (___) ___-__-__').replace(p.dial_code || '+7', '').trim()}" 
                               value="${p.formatted_value || ''}" 
                               data-id="${p.id}">
                    </div>
                    <button type="button" class="action-btn-circle sm btn-danger" onclick="window.PromptsModule.removeExtraPhone(${p.id})" title="Удалить телефон">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                </div>
            </div>
        `).join('');

        phones.forEach(p => this.initExtraTelInput(p));
    },

    initExtraTelInput(phoneData) {
        const id = phoneData.id;
        const container = document.getElementById(`phone-container-${id}`);
        if (!container) return;

        const input = container.querySelector('input[type="tel"]');
        const trigger = document.getElementById(`country-trigger-${id}`);
        const dropdown = document.getElementById(`country-dropdown-${id}`);
        const searchInput = container.querySelector('.country-search');
        const listContainer = container.querySelector('.country-list-items');

        const renderList = (filter = "") => {
            const filtered = countries.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()) || c.dialCode.includes(filter));
            listContainer.innerHTML = filtered.map(c => {
                const isSelected = phoneData.country_code === c.code;
                return `
                    <div class="country-item ${isSelected ? 'active' : ''}" data-code="${c.code}">
                        <span class="flag">${this.getFlagEmoji(c.code)}</span>
                        <span class="name">${c.name}</span>
                        <span class="code">${c.dialCode}</span>
                    </div>
                `;
            }).join('');

            listContainer.querySelectorAll('.country-item').forEach(item => {
                item.addEventListener('click', () => {
                    const country = countries.find(c => c.code === item.dataset.code);
                    if (country) {
                        phoneData.country_code = country.code;
                        phoneData.dial_code = country.dialCode;
                        phoneData.mask = country.mask;
                        phoneData.tempPhoneDigits = "";
                        phoneData.formatted_value = "";
                        
                        container.querySelector('.selected-flag').textContent = this.getFlagEmoji(country.code);
                        container.querySelector('.selected-dial-code').textContent = country.dialCode;
                        input.placeholder = country.mask.replace(country.dialCode, "").trim();
                        input.value = "";
                        
                        dropdown.classList.remove('show');
                        input.focus();
                    }
                });
            });
        };

        renderList();
        if (searchInput) searchInput.addEventListener('input', (e) => renderList(e.target.value));
        
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // ЗАКРЫВАЕМ ВСЕ: и другие страны, и мессенджеры
            const isShowing = dropdown.classList.contains('show');
            document.querySelectorAll('.country-dropdown.show, .custom-select.open').forEach(d => {
                d.classList.remove('show', 'open');
            });

            if (!isShowing) {
                dropdown.classList.add('show');
                if (searchInput) {
                    searchInput.value = "";
                    renderList();
                    setTimeout(() => searchInput.focus(), 100);
                }
            }
        });

        input.addEventListener('input', (e) => {
            let val = e.target.value.replace(/\D/g, "");
            const country = countries.find(c => c.code === phoneData.country_code) || countries.find(c => c.code === 'ru');
            
            let cleanDial = country.dialCode.replace(/\D/g, "");
            if (val.startsWith(cleanDial) && val.length > cleanDial.length) {
                val = val.substring(cleanDial.length);
            } else if (country.code === 'ru' && val.startsWith('8') && val.length > 1) {
                val = val.substring(1);
            }

            phoneData.tempPhoneDigits = val;
            let maskTemplate = country.mask.replace(country.dialCode, "").trim();
            let result = "";
            let i = 0;
            for (let char of maskTemplate) {
                if (i >= val.length) break;
                if (char === "_") {
                    result += val[i++];
                } else {
                    result += char;
                }
            }
            e.target.value = result;
            phoneData.formatted_value = result;
            phoneData.phone = val ? (country.dialCode + val) : "";
        });
    },

    removeExtraPhone(id) {
        this.state.contacts.extra_phones = this.state.contacts.extra_phones.filter(p => p.id !== id);
        this.renderExtraPhones();
    },

    showAddEmailPrompt() {
        if (typeof window.showAlert !== 'function') {
            const label = prompt('Введите название для новой почты:');
            if (label) this.addExtraEmail(label);
            return;
        }

        const overlay = window.showAlert('tmpl-prompt-alert', {});
        if (overlay) {
            const titleEl = overlay.querySelector('.alert-title');
            const textEl = overlay.querySelector('.alert-text');
            if (titleEl) titleEl.textContent = 'Добавить почту';
            if (textEl) textEl.textContent = 'Введите название';

            const input = overlay.querySelector('#prompt-input');
            const confirmBtn = overlay.querySelector('#prompt-confirm');
            const cancelBtn = overlay.querySelector('#prompt-cancel');
            const close = () => { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 300); };

            if (input) {
                input.placeholder = "Например: Отдел продаж";
                setTimeout(() => input.focus(), 100);
            }
            
            if (confirmBtn) {
                confirmBtn.onclick = () => {
                    const val = input.value.trim();
                    if (val) {
                        this.addExtraEmail(val);
                        close();
                    }
                };
            }
            if (cancelBtn) cancelBtn.onclick = close;
        }
    },

    addExtraEmail(label) {
        if (!this.state.contacts.extra_emails) this.state.contacts.extra_emails = [];
        this.state.contacts.extra_emails.push({
            id: Date.now(),
            label: label,
            email: ''
        });
        this.renderExtraEmails();
    },

    renderExtraEmails() {
        const container = document.getElementById('extra-emails-container');
        const wrapper = document.getElementById('extra-emails-wrapper');
        if (!container) return;

        const emails = this.state.contacts.extra_emails || [];
        
        // Скрываем обертку, если почт нет, чтобы убрать лишние отступы
        if (wrapper) {
            wrapper.style.display = emails.length > 0 ? 'block' : 'none';
        }

        container.innerHTML = emails.map((e, index) => `
            <div class="setting-item ${index === 0 ? '' : 'mt-10'}" data-id="${e.id}">
                <label class="subtitle-card">${e.label}</label>
                <div class="flex-row-gap-10">
                    <input type="email" class="hex-input-full extra-email-input" 
                           placeholder="assistant@mitia.pro" 
                           value="${e.email || ''}" 
                           oninput="window.PromptsModule.updateExtraEmail(${e.id}, this.value)">
                    <button type="button" class="action-btn-circle sm btn-danger" onclick="window.PromptsModule.removeExtraEmail(${e.id})" title="Удалить почту">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                </div>
            </div>
        `).join('');
    },

    updateExtraEmail(id, value) {
        const email = this.state.contacts.extra_emails.find(e => e.id === id);
        if (email) email.email = value.trim();
    },

    removeExtraEmail(id) {
        this.state.contacts.extra_emails = this.state.contacts.extra_emails.filter(e => e.id !== id);
        this.renderExtraEmails();
    },

    showAddAddressPrompt() {
        if (typeof window.showAlert !== 'function') {
            const label = prompt('Введите название для нового адреса:');
            if (label) this.addExtraAddress(label);
            return;
        }

        const overlay = window.showAlert('tmpl-prompt-alert', {});
        if (overlay) {
            const titleEl = overlay.querySelector('.alert-title');
            const textEl = overlay.querySelector('.alert-text');
            if (titleEl) titleEl.textContent = 'Добавить адрес';
            if (textEl) textEl.textContent = 'Введите название';

            const input = overlay.querySelector('#prompt-input');
            const confirmBtn = overlay.querySelector('#prompt-confirm');
            const cancelBtn = overlay.querySelector('#prompt-cancel');
            const close = () => { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 300); };

            if (input) {
                input.placeholder = "Например: Главный офис";
                setTimeout(() => input.focus(), 100);
            }
            
            if (confirmBtn) {
                confirmBtn.onclick = () => {
                    const val = input.value.trim();
                    if (val) {
                        this.addExtraAddress(val);
                        close();
                    }
                };
            }
            if (cancelBtn) cancelBtn.onclick = close;
        }
    },

    addExtraAddress(label) {
        if (!this.state.contacts.extra_addresses) this.state.contacts.extra_addresses = [];
        this.state.contacts.extra_addresses.push({
            id: Date.now(),
            label: label,
            address: ''
        });
        this.renderExtraAddresses();
    },

    renderExtraAddresses() {
        const container = document.getElementById('extra-addresses-container');
        const wrapper = document.getElementById('extra-addresses-wrapper');
        if (!container) return;

        const addresses = this.state.contacts.extra_addresses || [];
        
        if (wrapper) {
            wrapper.style.display = addresses.length > 0 ? 'block' : 'none';
        }

        container.innerHTML = addresses.map((a, index) => `
            <div class="setting-item ${index === 0 ? '' : 'mt-10'}" data-id="${a.id}">
                <label class="subtitle-card">${a.label}</label>
                <div class="flex-row-gap-10">
                    <input type="text" class="hex-input-full extra-address-input" 
                           placeholder="Россия, 105545, г. Москва, ул. Примерная, д. 1" 
                           value="${a.address || ''}" 
                           oninput="window.PromptsModule.updateExtraAddress(${a.id}, this.value)">
                    <button type="button" class="action-btn-circle sm btn-danger" onclick="window.PromptsModule.removeExtraAddress(${a.id})" title="Удалить адрес">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                </div>
            </div>
        `).join('');
    },

    updateExtraAddress(id, value) {
        const addr = this.state.contacts.extra_addresses.find(a => a.id === id);
        if (addr) addr.address = value.trim();
    },

    removeExtraAddress(id) {
        this.state.contacts.extra_addresses = this.state.contacts.extra_addresses.filter(a => a.id !== id);
        this.renderExtraAddresses();
    },

    showAddLinkPrompt() {
        if (typeof window.showAlert !== 'function') {
            const label = prompt('Введите название соцсети:');
            if (label) this.addExtraLink(label);
            return;
        }

        const overlay = window.showAlert('tmpl-prompt-alert', {});
        if (overlay) {
            const titleEl = overlay.querySelector('.alert-title');
            const textEl = overlay.querySelector('.alert-text');
            if (titleEl) titleEl.textContent = 'Добавить соцсеть';
            if (textEl) textEl.textContent = 'Введите название';

            const input = overlay.querySelector('#prompt-input');
            const confirmBtn = overlay.querySelector('#prompt-confirm');
            const cancelBtn = overlay.querySelector('#prompt-cancel');
            const close = () => { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 300); };

            if (input) {
                input.placeholder = "Например: Группа Вконтакте";
                setTimeout(() => input.focus(), 100);
            }
            
            if (confirmBtn) {
                confirmBtn.onclick = () => {
                    const val = input.value.trim();
                    if (val) {
                        this.addExtraLink(val);
                        close();
                    }
                };
            }
            if (cancelBtn) cancelBtn.onclick = close;
        }
    },

    addExtraLink(label) {
        if (!this.state.contacts.extra_links) this.state.contacts.extra_links = [];
        this.state.contacts.extra_links.push({
            id: Date.now(),
            label: label,
            url: ''
        });
        this.renderExtraLinks();
    },

    renderExtraLinks() {
        const container = document.getElementById('extra-links-container');
        const wrapper = document.getElementById('extra-links-wrapper');
        if (!container) return;

        const links = this.state.contacts.extra_links || [];
        
        if (wrapper) {
            wrapper.style.display = links.length > 0 ? 'block' : 'none';
        }

        container.innerHTML = links.map((l, index) => `
            <div class="setting-item ${index === 0 ? '' : 'mt-10'}" data-id="${l.id}">
                <label class="subtitle-card">${l.label}</label>
                <div class="flex-row-gap-10">
                    <input type="url" class="hex-input-full extra-link-input" 
                           placeholder="https://..." 
                           value="${l.url || ''}" 
                           oninput="window.PromptsModule.updateExtraLink(${l.id}, this.value)">
                    <button type="button" class="action-btn-circle sm btn-danger" onclick="window.PromptsModule.removeExtraLink(${l.id})" title="Удалить соцсеть">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                </div>
            </div>
        `).join('');
    },

    updateExtraLink(id, value) {
        const link = this.state.contacts.extra_links.find(l => l.id === id);
        if (link) link.url = value.trim();
    },

    removeExtraLink(id) {
        this.state.contacts.extra_links = this.state.contacts.extra_links.filter(l => l.id !== id);
        this.renderExtraLinks();
    },

    initTelInput() {
        const input = document.querySelector("#contact-phone");
        const trigger = document.querySelector("#country-select-trigger");
        const dropdown = document.querySelector("#country-dropdown");
        const searchInput = document.querySelector("#country-search");
        const listContainer = document.querySelector("#country-list-items");
        if (!input || !trigger || !dropdown || !listContainer) return;
        const renderList = (filter = "") => {
            const filtered = countries.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()) || c.dialCode.includes(filter));
            listContainer.innerHTML = filtered.map(c => {
                const isSelected = this.state.currentCountry && this.state.currentCountry.code === c.code;
                return `
                    <div class="country-item ${isSelected ? 'active' : ''}" data-code="${c.code}">
                        <span class="flag">${this.getFlagEmoji(c.code)}</span>
                        <span class="name">${c.name}</span>
                        <span class="code">${c.dialCode}</span>
                    </div>
                `;
            }).join('');
            listContainer.querySelectorAll('.country-item').forEach(item => {
                item.addEventListener('click', () => {
                    const country = countries.find(c => c.code === item.dataset.code);
                    if (country) {
                        this.state.currentCountry = country;
                        this.state.tempPhoneDigits = "";
                        this.updateSelectedCountryUI();
                        input.value = "";
                        dropdown.classList.remove('show');
                        input.focus();
                    }
                });
            });
        };
        renderList();
        if (searchInput) searchInput.addEventListener('input', (e) => renderList(e.target.value));
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            // Закрываем все остальные дропдауны
            document.querySelectorAll('.country-dropdown.show').forEach(d => {
                if (d !== dropdown) d.classList.remove('show');
            });
            const isShowing = dropdown.classList.toggle('show');
            if (isShowing && searchInput) {
                searchInput.value = "";
                renderList();
                setTimeout(() => searchInput.focus(), 100);
            }
        });
        document.addEventListener('click', () => dropdown.classList.remove('show'));
        input.addEventListener('input', (e) => this.formatPhoneNumber(input, e));
    },

    getFlagEmoji(countryCode) {
        const codePoints = countryCode.toUpperCase().split('').map(char => 127397 + char.charCodeAt());
        return String.fromCodePoint(...codePoints);
    },

    updateSelectedCountryUI() {
        const flagEl = document.querySelector(".selected-flag");
        const codeEl = document.querySelector(".selected-dial-code");
        const input = document.querySelector("#contact-phone");
        if (this.state.currentCountry) {
            if (flagEl) flagEl.textContent = this.getFlagEmoji(this.state.currentCountry.code);
            if (codeEl) codeEl.textContent = this.state.currentCountry.dialCode;
            if (input) input.placeholder = this.state.currentCountry.mask.replace(this.state.currentCountry.dialCode, "").trim();
        }
    },

    updateCountryDropdown() {
        this.updateSelectedCountryUI();
    },

    formatPhoneNumber(input) {
        let val = input.value.replace(/\D/g, "");
        const country = this.state.currentCountry || countries.find(c => c.code === 'ru');
        
        // Если пользователь вставил полный номер с кодом страны, отрезаем его
        let cleanDial = country.dialCode.replace(/\D/g, "");
        if (val.startsWith(cleanDial) && val.length > cleanDial.length) {
            val = val.substring(cleanDial.length);
        } else if (country.code === 'ru' && val.startsWith('8') && val.length > 1) {
            val = val.substring(1);
        }

        this.state.tempPhoneDigits = val;

        // Берем часть маски БЕЗ кода страны
        let maskTemplate = country.mask.replace(country.dialCode, "").trim();
        
        let result = "";
        let i = 0;
        for (let char of maskTemplate) {
            if (i >= val.length) break;
            if (char === "_") {
                result += val[i++];
            } else {
                result += char;
            }
        }
        
        input.value = result;
    },

    async saveData() {
        try {
            this.saveCurrentTypeData();
            this.syncWorkingHoursToState();
            const clientId = localStorage.getItem('chat_client_id') || 'mitia_assistant';
            const token = localStorage.getItem('chatadmin_auth_token');
            
            if (!this.state.contacts) this.state.contacts = {};

            // ОЧИСТКА: Переходим на динамические списки, зануляем старые поля
            this.state.contacts.phone = '';
            this.state.contacts.email = '';
            this.state.contacts.telegram = '';

            const payload = {
                site_url: this.state.site_url,
                welcome_msg: this.state.welcome_msg,
                bot_settings: { ...(this.state.bot_settings || {}) },
                working_hours: this.state.working_hours,
                working_hours_holidays: this.state.working_hours_holidays,
                working_hours_holidays_enabled: this.state.working_hours_holidays_enabled,
                legal: { type: this.currentLegalType || 'ip' },
                legal_data: this.legalDataStore,
                contacts: this.state.contacts
            };

            const res = await fetch(`/api/chat/admin/config?client_id=${clientId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.status === 'success' && data.config) {
                // Обновляем стейт из ответа сервера
                if (data.config.bot_settings) {
                    Object.keys(data.config.bot_settings).forEach(key => {
                        const val = data.config.bot_settings[key];
                        if ((key === 'knowledge_file_url' || key === 'knowledge_file_name') && !val) return;
                        this.state.bot_settings[key] = val;
                    });
                }
                if (data.config.contacts) {
                    this.state.contacts = data.config.contacts;
                }
                if (data.config.legal_data) this.legalDataStore = data.config.legal_data;
                if (data.config.legal) this.currentLegalType = data.config.legal.type || 'ip';
                
                // Перерисовываем форму, чтобы подхватить новые данные
                this.fillForm();
            }
        } catch (err) { console.error('Save prompts error:', err); }
    },

    async startIndexing() {
        const urlInput = document.getElementById('index-site-url');
        const btn = document.getElementById('start-index-btn');
        let siteUrl = urlInput ? urlInput.value.trim() : '';
        if (!siteUrl) return;
        if (!siteUrl.includes('://')) siteUrl = 'https://' + siteUrl;
        
        btn.disabled = true;
        btn.classList.add('loading');
        btn.textContent = 'Индексация...';
        
        try {
            const clientId = localStorage.getItem('chat_client_id');
            const token = localStorage.getItem('chatadmin_auth_token');
            
            await fetch(`/api/chat/admin/config?client_id=${clientId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ site_url: siteUrl, bot_settings: this.state.bot_settings })
            });

            const res = await fetch(`/api/chat/admin/index/start?client_id=${clientId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ site_url: siteUrl })
            });
            
            const data = await res.json();
            if (data.status === 'success') {
                this.pollIndexingStatus();
            } else {
                btn.disabled = false;
                btn.classList.remove('loading');
                btn.textContent = 'Индексировать';
                if (typeof window.showAlert === 'function') {
                    window.showAlert('tmpl-error-alert', { title: 'Ошибка', text: data.message || 'Не удалось запустить индексацию' });
                }
            }
        } catch (err) {
            btn.disabled = false;
            btn.classList.remove('loading');
            btn.textContent = 'Индексировать';
            if (typeof window.showAlert === 'function') {
                window.showAlert('tmpl-error-alert', { title: 'Ошибка сети', text: 'Сайт недоступен или указан неверно' });
            }
        }
    },

    async pollIndexingStatus() {
        const btn = document.getElementById('start-index-btn');
        const clientId = localStorage.getItem('chat_client_id');
        const token = localStorage.getItem('chatadmin_auth_token');
        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/api/chat/admin/index/status?client_id=${clientId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json();
                if (data.status === 'completed') {
                    clearInterval(interval);
                    btn.disabled = false;
                    btn.classList.remove('loading');
                    btn.textContent = 'Индексировать';
                    
                    // Загружаем страницы и проверяем их количество для уведомления
                    const pagesRes = await fetch(`/api/chat/admin/index/list?client_id=${clientId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const pagesData = await pagesRes.json();
                    const pagesCount = (pagesData.status === 'success' && pagesData.pages) ? pagesData.pages.length : 0;

                    this.loadIndexedPages();

                    if (typeof window.showAlert === 'function') {
                        if (pagesCount > 0) {
                            window.showAlert('tmpl-success-alert', { title: 'Готово', text: `Индексация завершена. Найдено страниц: ${pagesCount}` });
                        } else {
                            window.showAlert('tmpl-error-alert', { title: 'Внимание', text: 'Индексация завершена, но не удалось найти ни одной страницы. Проверьте доступность сайта.' });
                        }
                    }
                } else if (data.status === 'error') {
                    clearInterval(interval);
                    btn.disabled = false;
                    btn.classList.remove('loading');
                    btn.textContent = 'Индексировать';
                    if (typeof window.showAlert === 'function') {
                        window.showAlert('tmpl-error-alert', { title: 'Ошибка индексации', text: data.message || 'Не удалось проиндексировать сайт' });
                    }
                }
            } catch (e) {
                clearInterval(interval);
                btn.disabled = false;
                btn.classList.remove('loading');
                btn.textContent = 'Индексировать';
            }
        }, 3000);
    },

    async loadIndexedPages() {
        const clientId = localStorage.getItem('chat_client_id');
        const token = localStorage.getItem('chatadmin_auth_token');
        const listContainer = document.getElementById('indexed-pages-list');
        const statPages = document.getElementById('stat-pages');
        const statUpdated = document.getElementById('stat-updated');
        if (!listContainer) return;
        try {
            const res = await fetch(`/api/chat/admin/index/list?client_id=${clientId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.status === 'success') {
                const pages = data.pages || [];
                if (statPages) statPages.textContent = pages.length;
                
                // Обновляем дату последнего индексирования
                if (statUpdated && pages.length > 0) {
                    // Берем самую свежую дату из страниц
                    const lastDate = pages.reduce((max, p) => {
                        const d = new Date(p.created_at || p.updated_at);
                        return d > max ? d : max;
                    }, new Date(0));
                    
                    if (lastDate.getTime() > 0) {
                        const formattedDate = lastDate.toLocaleString('ru-RU', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                        statUpdated.textContent = `Обновлено: ${formattedDate}`;
                    } else {
                        statUpdated.textContent = 'Обновлено: -';
                    }
                } else if (statUpdated) {
                    statUpdated.textContent = 'Обновлено: -';
                }

                this.updateIndexButtonsState();
                if (pages.length > 0) {
                    listContainer.innerHTML = pages.map(p => `
                        <div class="page-item" data-page-id="${p.id}">
                            <button class="btn-remove-phone" onclick="window.PromptsModule.deletePage(${p.id}, event)" title="Удалить страницу">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                            </button>
                            <div class="page-info">
                                <a href="${p.url}" target="_blank" class="page-link">${p.title || p.url}</a>
                                <span class="page-url-sub">${p.url}</span>
                            </div>
                        </div>
                    `).join('');
                } else listContainer.innerHTML = '<div class="empty-list-hint">Страницы еще не проиндексированы</div>';
            }
        } catch (err) {}
    },

    async deletePage(pageId, event) {
        if (event) event.stopPropagation();
        
        const performDelete = async () => {
            const clientId = localStorage.getItem('chat_client_id');
            const token = localStorage.getItem('chatadmin_auth_token');
            try {
                const res = await fetch(`/api/chat/admin/index/page/${pageId}?client_id=${clientId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if ((await res.json()).status === 'success') this.loadIndexedPages();
            } catch (err) {}
        };

        if (typeof window.showAlert === 'function') {
            const overlay = window.showAlert('tmpl-confirm-alert', {
                title: 'Удалить страницу?',
                text: 'Эта страница будет удалена из базы знаний ассистента.'
            });
            if (overlay) {
                const confirmBtn = overlay.querySelector('#confirm-yes');
                const cancelBtn = overlay.querySelector('#confirm-cancel');
                const close = () => { 
                    overlay.style.opacity = '0'; 
                    document.body.style.overflow = ''; 
                    setTimeout(() => overlay.remove(), 300); 
                };
                
                if (confirmBtn) confirmBtn.onclick = () => { performDelete(); close(); };
                if (cancelBtn) cancelBtn.onclick = close;
            }
        } else {
            if (confirm('Удалить страницу?')) performDelete();
        }
    },

    async clearIndex() {
        const performClear = async () => {
            const clientId = localStorage.getItem('chat_client_id');
            const token = localStorage.getItem('chatadmin_auth_token');
            try {
                const res = await fetch(`/api/chat/admin/index/clear?client_id=${clientId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if ((await res.json()).status === 'success') this.loadIndexedPages();
            } catch (err) {}
        };

        if (typeof window.showAlert === 'function') {
            const overlay = window.showAlert('tmpl-confirm-alert', {
                title: 'Очистить базу знаний?',
                text: 'Все проиндексированные страницы будут удалены. Это действие нельзя отменить.'
            });
            if (overlay) {
                const confirmBtn = overlay.querySelector('#confirm-yes');
                const cancelBtn = overlay.querySelector('#confirm-cancel');
                const close = () => { 
                    overlay.style.opacity = '0'; 
                    document.body.style.overflow = ''; 
                    setTimeout(() => overlay.remove(), 300); 
                };
                
                if (confirmBtn) {
                    confirmBtn.textContent = 'Очистить';
                    confirmBtn.onclick = () => { performClear(); close(); };
                }
                if (cancelBtn) cancelBtn.onclick = close;
            }
        } else {
            if (confirm('Очистить базу знаний?')) performClear();
        }
    },

    async handleReindex() {
        const btn = document.getElementById('reindex-btn');
        if (!btn) return;
        
        btn.disabled = true;
        btn.classList.add('loading');
        const originalText = btn.textContent;
        btn.textContent = 'Переиндексация...';
        
        try {
            const clientId = localStorage.getItem('chat_client_id');
            const token = localStorage.getItem('chatadmin_auth_token');
            
            const res = await fetch(`/api/chat/admin/index/start?client_id=${clientId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ site_url: this.state.site_url })
            });
            
            const data = await res.json();
            if (data.status === 'success') {
                this.pollIndexingStatus();
            } else {
                btn.disabled = false;
                btn.classList.remove('loading');
                btn.textContent = originalText;
                if (typeof window.showAlert === 'function') {
                    window.showAlert('tmpl-error-alert', { title: 'Ошибка', text: data.message || 'Не удалось запустить переиндексацию' });
                }
            }
        } catch (err) {
            btn.disabled = false;
            btn.classList.remove('loading');
            btn.textContent = originalText;
            if (typeof window.showAlert === 'function') {
                window.showAlert('tmpl-error-alert', { title: 'Ошибка сети', text: 'Не удалось запустить переиндексацию' });
            }
        }
    }
};
