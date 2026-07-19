import { NewsModule } from './modules/news.js?v=103';

const CHECK_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
const SPINNER_SVG = `<span class="save-spinner" aria-hidden="true"></span>`;
const READ_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path><path d="m22 10-7 7-1.5-1.5"></path></svg>`;

export const NewsPageModule = {
    async init() {
        const list = document.getElementById('news-page-list');
        const items = await NewsModule.load(50);
        NewsModule.renderList(list, items, { mode: 'full' });
        NewsModule.bindListActions(document);
        NewsModule.updateBadge(document);
    },
    async markAllAsRead() {
        const list = document.getElementById('news-page-list');
        const button = document.getElementById('news-sidebar-read-btn');
        if (button) {
            button.disabled = true;
            button.classList.remove('save-success');
            button.classList.add('save-loading');
            button.innerHTML = SPINNER_SVG;
        }
        await NewsModule.markAllRead();
        NewsModule.renderList(list, NewsModule.state.items, { mode: 'full' });
        NewsModule.bindListActions(document);
        NewsModule.updateBadge(document);
        if (button) {
            button.classList.remove('save-loading');
            button.classList.add('save-success');
            button.innerHTML = CHECK_SVG;
            setTimeout(() => {
                button.disabled = false;
                button.classList.remove('save-success');
                button.innerHTML = READ_SVG;
            }, 1500);
        }
    },
    async saveData() {},
    destroy() {},
};
