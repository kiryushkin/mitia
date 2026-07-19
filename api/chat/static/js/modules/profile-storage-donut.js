import { initProfileStorageModule } from './profile-storage.js?v=105';

export async function renderStorageDonut() {
    const canvas = document.getElementById('storage-donut-chart');
    const cardEl = document.getElementById('card-storage');
    if (!canvas || !cardEl) return;

    if (!canvas.height) canvas.height = 240;
    if (!canvas.width) canvas.width = 240;

    const ensureChartReady = async () => {
        if (typeof window.Chart === 'function') return true;
        for (let i = 0; i < 20; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            if (typeof window.Chart === 'function') return true;
        }
        return false;
    };

    const chartReady = await ensureChartReady();
    if (!chartReady) {
        console.warn('Storage donut skipped: Chart.js is not ready');
        return;
    }

    const clientId = new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id') || 'mitia_assistant';
    const token = localStorage.getItem('chatadmin_auth_token');

    initProfileStorageModule(this);

    const formatSize = (bytes) => {
        if (!bytes || bytes === 0) return '0 Б';
        const k = 1024;
        const sizes = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
        const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

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
        this.state.storage_loaded = true;
        this.state.storage_loading = false;

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
        const statsByType = {
            image: 0,
            video: 0,
            audio: 0,
            document: 0,
            other: 0,
            text: 0
        };
        let totalUsed = 0;

        typeOrder.forEach((typeKey) => {
            const label = typeNames[typeKey] || typeKey;
            const value = Number(totalsByType[typeKey] || 0);
            labels.push(label);
            counts.push(value);
            colors.push(colorMap[typeKey] || '#808080');
            totalUsed += value;
        });

        items.forEach((item) => {
            const ft = String(item?.file_type || 'other').toLowerCase();
            if (Object.prototype.hasOwnProperty.call(statsByType, ft)) {
                statsByType[ft] += 1;
            } else {
                statsByType.other += 1;
            }
        });

        totalUsed = filesTotal + textTotal;

        const hasAnyFiles = counts.some((value) => value > 0);
        const chartLabels = [...labels];
        const chartCounts = [...counts];
        const chartColors = [...colors];

        if (!hasAnyFiles) {
            chartLabels.push('Пусто');
            chartCounts.push(1);
            chartColors.push('rgba(255,255,255,0.08)');
        }

        const fallbackLimit = 1 * 1024 * 1024 * 1024;
        const limit = Number(data.storage_limit || this.state.storage_limit || fallbackLimit);
        const free = Math.max(0, limit - totalUsed);

        if (free > 0) {
            chartLabels.push('Свободно');
            chartCounts.push(free);
            chartColors.push('rgba(255,255,255,0.05)');
        }

        const valEl = document.getElementById('storage-donut-value');
        const totalLimitEl = document.getElementById('storage-total-limit');
        const freeSpaceEl = document.getElementById('storage-free-space');

        if (valEl) {
            valEl.textContent = formatSize(totalUsed);
        }
        if (totalLimitEl) totalLimitEl.textContent = `Общая: ${formatSize(limit)}`;
        if (freeSpaceEl) freeSpaceEl.textContent = `Свободно: ${formatSize(free)}`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        if (this.state.charts.storage) this.state.charts.storage.destroy();

        this.state.charts.storage = new window.Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: chartLabels,
                datasets: [{
                    data: chartCounts,
                    backgroundColor: chartColors,
                    borderWidth: 0,
                    hoverOffset: 4,
                    spacing: 2
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
                const typeClassMap = {
                    'Фото': 'storage-type-image',
                    'Видео': 'storage-type-video',
                    'Аудио': 'storage-type-audio',
                    'Документы': 'storage-type-document',
                    'Прочее': 'storage-type-other',
                    'Текст': 'storage-type-text'
                };
                const typeKeyMap = {
                    'Фото': 'image',
                    'Видео': 'video',
                    'Аудио': 'audio',
                    'Документы': 'document',
                    'Прочее': 'other',
                    'Текст': 'text'
                };
                const typeClass = typeClassMap[label] || '';
                const statKey = typeKeyMap[label] || 'other';
                const itemCount = Number(statsByType[statKey] || 0);
                legendHtml += `<div class="storage-type-chip ${typeClass}">
                    <span class="storage-type-dot" style="background:${colors[i]};"></span>
                    <span class="storage-type-name">${label}</span>
                    <span class="storage-type-meta">${itemCount} шт</span>
                    <span class="storage-type-size">${formatSize(counts[i])}</span>
                </div>`;
            });
            legendHtml += `<div class="storage-type-chip storage-type-total-row">
                <span class="storage-type-name">Всего файлов / Текстовые данные</span>
                <span class="storage-type-meta">${items.length} шт</span>
                <span class="storage-type-size">${formatSize(filesTotal)} / ${formatSize(textTotal)}</span>
            </div>`;
            legendEl.innerHTML = legendHtml;
        }

        if (typeof this._refreshStorageGrid === 'function') {
            this._refreshStorageGrid();
        }

    } catch (e) {
        this.state.storage_loading = false;
        if (this.state.charts?.storage) {
            try { this.state.charts.storage.destroy(); } catch (_) {}
            this.state.charts.storage = null;
        }
        console.warn('Storage donut error:', e);
    }
}
