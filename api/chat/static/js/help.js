document.addEventListener('DOMContentLoaded', () => {
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('docs-sidebar');
    const searchInputs = Array.from(document.querySelectorAll('.search-input'));

    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('active');
        });
        document.querySelectorAll('.docs-nav a').forEach((link) => {
            link.addEventListener('click', () => sidebar.classList.remove('active'));
        });
    }

    const searchToggle = document.getElementById('search-toggle');
    if (searchToggle && sidebar) {
        searchToggle.addEventListener('click', () => {
            sidebar.classList.add('active');
            const input = sidebar.querySelector('.search-input');
            if (input) {
                input.focus();
                input.select();
            }
        });
    }

    const normalize = (text) => String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();

    function applySearch(query) {
        const q = normalize(query);
        document.querySelectorAll('main.docs-content .docs-section').forEach((section) => {
            if (!q) {
                section.classList.remove('is-search-hidden');
                return;
            }
            section.classList.toggle('is-search-hidden', !normalize(section.textContent).includes(q));
        });

        document.querySelectorAll('.docs-nav-item').forEach((item) => {
            if (!q) {
                item.classList.remove('is-hidden');
                return;
            }
            const visible = Array.from(item.querySelectorAll('a')).some((link) => {
                const href = link.getAttribute('href') || '';
                if (!href.startsWith('#')) return false;
                const target = document.querySelector(href);
                if (!target) return normalize(link.textContent).includes(q);
                return !target.classList.contains('is-search-hidden') || normalize(link.textContent).includes(q);
            });
            item.classList.toggle('is-hidden', !visible);
        });

        document.querySelectorAll('.docs-nav-section').forEach((sectionTitle) => {
            if (!q) {
                sectionTitle.classList.remove('is-hidden');
                return;
            }
            let next = sectionTitle.nextElementSibling;
            let hasVisible = false;
            while (next && !next.classList.contains('docs-nav-section')) {
                if (next.classList.contains('docs-nav')) {
                    hasVisible = Array.from(next.querySelectorAll('.docs-nav-item')).some((item) => !item.classList.contains('is-hidden'));
                }
                next = next.nextElementSibling;
            }
            sectionTitle.classList.toggle('is-hidden', !hasVisible);
        });
    }

    searchInputs.forEach((input) => {
        input.addEventListener('input', () => {
            const value = input.value;
            searchInputs.forEach((other) => {
                if (other !== input) other.value = value;
            });
            applySearch(value);
        });
    });

    function setActiveNav() {
        const links = Array.from(document.querySelectorAll('.docs-nav a[href^="#"]'));
        if (!links.length) return;
        const fromTop = window.scrollY + 120;
        let currentId = null;
        links.forEach((link) => {
            const id = link.getAttribute('href');
            const target = id ? document.querySelector(id) : null;
            if (target && target.offsetTop <= fromTop) currentId = id;
        });
        links.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === currentId));
    }

    window.addEventListener('scroll', setActiveNav, { passive: true });
    setActiveNav();

    function openSupportChat() {
        const widget = window.Mitya || window.MityaWidget || window.ChatWidget;
        if (!widget) {
            alert('Чат поддержки загружается, попробуйте через секунду.');
            return;
        }
        if (typeof widget.open === 'function') widget.open();
        else if (typeof widget.openChat === 'function') widget.openChat();
        else if (typeof widget.toggle === 'function') widget.toggle();
    }

    document.querySelectorAll('[data-open-support-chat]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            openSupportChat();
        });
    });

    function initChatAnimation(elementId) {
        const container = document.getElementById(elementId);
        if (!container) return;
        const msgs = [
            { role: 'user', text: 'С чего начать после регистрации?' },
            { role: 'bot', text: 'Откройте «Интеллект», заполните личность ассистента и загрузите базу знаний.' },
            { role: 'user', text: 'Как поставить виджет на сайт?' },
            { role: 'bot', text: 'В «Интеграциях» укажите домен, скопируйте script и вставьте перед </body>.' },
            { role: 'user', text: 'Можно подключить Telegram и Авито?' },
            { role: 'bot', text: 'Да. Есть Telegram, Max, VK, Email, Авито, HeadHunter и уведомления операторам.' },
            { role: 'user', text: 'Где смотреть переписки и лиды?' },
            { role: 'bot', text: 'В разделе «Диалоги»: фильтры по каналам, статусам и ответы оператора в одном окне.' },
            { role: 'user', text: 'Как оплатить тариф?' },
            { role: 'bot', text: 'Пополните баланс в «Профиле» через ЮKassa, затем подключите тариф или пакеты.' }
        ];
        let i = 0;
        function step() {
            if (i >= msgs.length) {
                setTimeout(() => {
                    container.innerHTML = '';
                    i = 0;
                    step();
                }, 3000);
                return;
            }
            const m = msgs[i];
            const wrap = document.createElement('div');
            wrap.className = `chat-msg-wrapper ${m.role}`;
            const avatar = document.createElement('img');
            avatar.className = 'chat-avatar';
            avatar.src = m.role === 'bot' ? '/api/chat/img/favicon.svg' : '/api/chat/img/avatar-operator.webp';
            avatar.alt = m.role === 'bot' ? 'MITIA' : 'Пользователь';
            const msg = document.createElement('div');
            msg.className = `chat-msg ${m.role}`;
            msg.textContent = m.text;
            wrap.appendChild(avatar);
            wrap.appendChild(msg);
            container.appendChild(wrap);
            container.scrollTop = container.scrollHeight;
            i += 1;
            setTimeout(step, 2500);
        }
        step();
    }

    initChatAnimation('promo-chat-list');
});
