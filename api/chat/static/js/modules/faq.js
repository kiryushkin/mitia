/**
 * Модуль частых вопросов (FAQ)
 */
export const FAQModule = {
    state: {},

    init() {
        console.log('FAQ module initialized');
        this.renderPlaceholder();
    },

    update(data) {
        if (data && data.frequent_requests && data.frequent_requests.length > 0) {
            this.renderRealFAQ(data.frequent_requests);
        } else {
            this.renderPlaceholder();
        }
    },

    renderPlaceholder() {
        this.renderFAQList();
    },

    renderFAQList() {
        const container = document.getElementById('faq-container');
        if (!container) return;

        // Показываем сообщение об отсутствии данных вместо placeholder
        container.innerHTML = `
            <div style="padding: 20px; text-align: left; color: #999; font-size: 16px; line-height: 1.5;">
                Когда клиенты начнут писать вам, здесь появится статистика по самым частым вопросам и повторяющимся обращениям.<br>
                Это поможет быстрее понять, что интересует аудиторию чаще всего.
            </div>
        `;
    },

    renderRealFAQ(questions) {
        const container = document.getElementById('faq-container');
        if (!container) return;
        this.renderBars(container, questions.slice(0, 10));
    },

    renderBars(container, items) {
        const max = Math.max(...items.map(d => d.count));

        container.innerHTML = items.map((item, i) => {
            const pct = Math.round((item.count / max) * 100);
            const colors = ['#7000FF', '#FF007A', '#00E5FF', '#CCFF00', '#FF5C00'];
            return `
            <div class="setting-item">
                <label class="subtitle-card">${item.q || item.question}</label>
                <div class="faq-bar-row">
                    <div class="faq-bar-track">
                        <div class="faq-bar-fill" style="width:${pct}%;background:${colors[i % colors.length]}"></div>
                    </div>
                    <span class="faq-bar-count">${item.count}</span>
                </div>
            </div>`;
        }).join('');
    }
};
