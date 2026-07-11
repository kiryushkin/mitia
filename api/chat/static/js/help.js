document.addEventListener('DOMContentLoaded', () => {
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('docs-sidebar');

    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('active');
        });

        document.querySelectorAll('.docs-nav-link').forEach(link => {
            link.addEventListener('click', () => {
                sidebar.classList.remove('active');
            });
        });
    }

    // Анимация чата
    function initChatAnimation(elementId) {
        const container = document.getElementById(elementId);
        if (!container) return;

        const msgs = [
            { role: 'user', text: 'Привет! Как мне создать своего ИИ-ассистента?' },
            { role: 'bot', text: 'Привет! Это просто. Сначала выберите канал связи в разделе «Интеграции».' },
            { role: 'user', text: 'А какие мессенджеры поддерживаются?' },
            { role: 'bot', text: 'Вы можете подключить Telegram, ВКонтакте, Авито и даже электронную почту.' },
            { role: 'user', text: 'Как обучить ассистента отвечать по моим данным?' },
            { role: 'bot', text: 'Загрузите документы или ссылки на сайт в раздел «Интеллект». ИИ изучит их за пару секунд.' },
            { role: 'user', text: 'Он сможет сам отвечать клиентам?' },
            { role: 'bot', text: 'Да, он будет консультировать 24/7, а если вопрос будет слишком сложным — позовет оператора.' },
            { role: 'user', text: 'А как я узнаю, что ИИ ответил клиенту?' },
            { role: 'bot', text: 'Вам придет уведомление в Telegram, и вы сможете увидеть весь диалог в панели управления.' },
            { role: 'user', text: 'Звучит круто! Пойду настраивать.' },
            { role: 'bot', text: 'Отлично! Если возникнут вопросы — я всегда здесь, чтобы помочь.' }
        ];

        let i = 0;
        function step() {
            if (i >= msgs.length) {
                setTimeout(() => { container.innerHTML = ''; i = 0; step(); }, 3000);
                return;
            }
            const m = msgs[i];
            const d = document.createElement('div');
            d.className = `chat-msg-wrapper ${m.role}`;
            
            const avatar = document.createElement('img');
            avatar.className = 'chat-avatar';
            avatar.src = m.role === 'bot' ? '/api/chat/img/favicon.svg' : '/api/chat/img/avatar-operator.webp';
            
            const msgDiv = document.createElement('div');
            msgDiv.className = `chat-msg ${m.role}`;
            msgDiv.textContent = m.text;
            
            d.appendChild(avatar);
            d.appendChild(msgDiv);
            container.appendChild(d);
            container.scrollTop = container.scrollHeight;
            i++;
            setTimeout(step, 2500);
        }
        step();
    }

    initChatAnimation('promo-chat-list');
});
