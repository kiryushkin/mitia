function getDisplayFileName(item) {
    const raw = String(item?.file_name || item?.file_path || '').trim();
    if (!raw) return 'Без названия';

    let normalized = raw;
    try {
        normalized = decodeURIComponent(normalized);
    } catch (_) {}

    normalized = normalized
        .replace(/%2F/gi, '/')
        .replace(/%5C/gi, '/')
        .replace(/\\/g, '/')
        .split('?')[0]
        .split('#')[0];

    const parts = normalized.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : normalized;
}

function getFileExtension(fileName) {
    const name = String(fileName || '').trim();
    const dotIndex = name.lastIndexOf('.');
    if (dotIndex < 0 || dotIndex === name.length - 1) return 'FILE';
    return name.slice(dotIndex + 1).toUpperCase().slice(0, 6);
}

function getDocumentIconMarkup() {
    return `
        <svg class="storage-doc-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="M14 2v5h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="M9 13h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>
            <path d="M9 17h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>
        </svg>
    `;
}

function formatFileSize(value) {
    const size = Number(value);
    if (!Number.isFinite(size) || size <= 0) return '';

    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    let current = size;
    let unitIndex = 0;

    while (current >= 1024 && unitIndex < units.length - 1) {
        current /= 1024;
        unitIndex += 1;
    }

    const precision = current >= 100 || unitIndex === 0 ? 0 : current >= 10 ? 1 : 2;
    return `${current.toFixed(precision)} ${units[unitIndex]}`;
}

function getItemFileSize(item) {
    return formatFileSize(
        item?.file_size_bytes ?? item?.file_size ?? item?.size_bytes ?? item?.size ?? 0
    );
}

function getSelectionToggleMarkup(isSelected) {
    return `
        <span class="storage-file-toggle${isSelected ? ' is-selected' : ''}" aria-hidden="true">
            <span class="storage-file-toggle-dot"></span>
        </span>
    `;
}

function getPreviewMarkup(item, fileType, fileName) {
    const extension = getFileExtension(getDisplayFileName(item));
    const downloadUrl = escapeHtml(item.download_url || '');
    const isPdf = extension === 'PDF';

    if (fileType === 'image' && downloadUrl) {
        return `
            <span class="storage-file-icon storage-file-icon-preview" aria-hidden="true">
                <img class="storage-file-preview-img" src="" data-preview-url="${downloadUrl}" alt="${fileName}" loading="lazy">
            </span>
        `;
    }

    const iconClass = isPdf ? 'storage-file-icon-pdf' : 'storage-file-icon-doc';
    return `
        <span class="storage-file-icon ${iconClass}" aria-hidden="true">
            ${getDocumentIconMarkup()}
            <span class="storage-file-ext">${extension}</span>
        </span>
    `;
}

async function hydrateFilePreviews(grid) {
    if (!grid) return;

    const token = getToken();
    if (!token) return;

    const previewNodes = Array.from(grid.querySelectorAll('.storage-file-preview-img[data-preview-url]'));
    await Promise.all(previewNodes.map(async (node) => {
        const url = node.getAttribute('data-preview-url');
        if (!url) return;

        try {
            const response = await fetch(url, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) return;
            const blob = await response.blob();

            const previousBlobUrl = node.dataset.blobUrl;
            if (previousBlobUrl) URL.revokeObjectURL(previousBlobUrl);

            const blobUrl = URL.createObjectURL(blob);
            node.src = blobUrl;
            node.dataset.blobUrl = blobUrl;
            node.removeAttribute('data-preview-url');
        } catch (_) {}
    }));
}

function getClientId() {
    return new URLSearchParams(window.location.search).get('client_id') || localStorage.getItem('chat_client_id') || 'mitia_assistant';
}

function getToken() {
    return localStorage.getItem('chatadmin_auth_token');
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/'/g, '&#39;');
}

async function confirmDownloadItem(fileName) {
    const title = 'Подтвердите скачивание';
    const text = `Скачать файл «${fileName}»?`;

    if (typeof window.showAlert === 'function') {
        const overlay = window.showAlert('tmpl-confirm-alert', { title, text });
        if (overlay) {
            const confirmBtn = overlay.querySelector('#confirm-yes');
            const cancelBtn = overlay.querySelector('#confirm-cancel');
            return await new Promise((resolve) => {
                const close = (result) => {
                    overlay.style.opacity = '0';
                    document.body.style.overflow = '';
                    setTimeout(() => overlay.remove(), 300);
                    resolve(result);
                };
                if (confirmBtn) {
                    confirmBtn.textContent = 'Скачать';
                    confirmBtn.onclick = () => close(true);
                }
                if (cancelBtn) {
                    cancelBtn.onclick = () => close(false);
                }
                overlay.onclick = (event) => {
                    if (event.target === overlay) close(false);
                };
            });
        }
    }

    return window.confirm(text);
}

export const StorageModule = {
    state: {
        items: [],
        selectionMode: false,
        selectedKeys: new Set(),
    },

    getState() {
        return this.state || { items: [], selectionMode: false, selectedKeys: new Set() };
    },

    init() {
        this.bindSidebarActions();
        this.loadData();
        this._pollTimer = setInterval(() => this.loadData(), 30000);
    },

    destroy() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    },

    resetSelectionState() {
        const state = this.getState();
        state.selectionMode = false;
        state.selectedKeys = new Set();
        this.syncSidebarState();
        this.renderItems();
    },

    bindSidebarActions() {
        const backBtn = document.getElementById('storage-sidebar-back-btn');
        const editBtn = document.getElementById('storage-sidebar-edit-btn');
        const deleteBtn = document.getElementById('storage-sidebar-delete-btn');

        if (backBtn) {
            backBtn.onclick = async () => {
                this.resetSelectionState();
                if (window.AdminApp?.navigateToTab) {
                    await window.AdminApp.navigateToTab('profile');
                }
            };
        }

        if (editBtn) {
            editBtn.onclick = () => {
                const state = this.getState();
                if (!state.items.length) return;
                state.selectionMode = !state.selectionMode;
                if (!state.selectionMode) {
                    state.selectedKeys = new Set();
                }
                this.syncSidebarState();
                this.renderItems();
            };
        }

        if (deleteBtn) {
            deleteBtn.onclick = async () => {
                await this.deleteSelectedItems();
            };
        }
    },

    syncSidebarState() {
        const state = this.getState();
        const editBtn = document.getElementById('storage-sidebar-edit-btn');
        const deleteBtn = document.getElementById('storage-sidebar-delete-btn');
        const hasItems = Array.isArray(state.items) ? state.items.length > 0 : false;
        const hasSelection = state.selectedKeys && state.selectedKeys.size > 0;
        const shouldShowDelete = state.selectionMode && hasSelection;

        if (editBtn) {
            editBtn.disabled = !hasItems;
            editBtn.classList.toggle('is-active', !!state.selectionMode);
        }

        if (deleteBtn) {
            deleteBtn.hidden = !shouldShowDelete;
            deleteBtn.style.display = shouldShowDelete ? 'inline-flex' : 'none';
            deleteBtn.disabled = !shouldShowDelete;
            deleteBtn.classList.toggle('is-active', shouldShowDelete);
            deleteBtn.title = 'Удалить выбранные файлы';
        }
    },

    async deleteSelectedItems() {
        const state = this.getState();
        if (!state.selectionMode || !state.selectedKeys.size) return;

        const count = state.selectedKeys.size;
        const suffix = count > 1 ? 'файлов' : 'файл';
        const title = 'Подтвердите удаление';
        const text = `Удалить ${count} ${suffix}?`;

        let confirmed = false;
        if (typeof window.showAlert === 'function') {
            const overlay = window.showAlert('tmpl-confirm-alert', { title, text });
            if (overlay) {
                confirmed = await new Promise((resolve) => {
                    const close = (result) => {
                        overlay.style.opacity = '0';
                        document.body.style.overflow = '';
                        setTimeout(() => overlay.remove(), 300);
                        resolve(result);
                    };
                    const confirmBtn = overlay.querySelector('#confirm-yes');
                    const cancelBtn = overlay.querySelector('#confirm-cancel');
                    if (confirmBtn) {
                        confirmBtn.textContent = 'Удалить';
                        confirmBtn.onclick = () => close(true);
                    }
                    if (cancelBtn) {
                        cancelBtn.onclick = () => close(false);
                    }
                    overlay.onclick = (event) => {
                        if (event.target === overlay) close(false);
                    };
                });
            }
        } else {
            confirmed = window.confirm(text);
        }

        if (!confirmed) return;

        const token = getToken();
        const itemsToDelete = state.items.filter((item, index) => state.selectedKeys.has(String(item?.id ?? `idx:${index}`)));
        const deletedPaths = [];

        await Promise.all(itemsToDelete.map(async (item) => {
            if (!item?.file_path) return;
            try {
                const response = await fetch('/api/chat/admin/delete-file', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ file_url: item.file_path }),
                });
                if (response.ok) {
                    deletedPaths.push(item.file_path);
                }
            } catch (_) {}
        }));

        if (!deletedPaths.length) return;

        const deletedSet = new Set(deletedPaths);
        state.items = state.items.filter((item) => !deletedSet.has(item.file_path));
        state.selectedKeys = new Set();
        state.selectionMode = false;
        this.syncSidebarState();
        this.renderItems();

        window.dispatchEvent(new CustomEvent('storage:file-deleted', {
            detail: {
                filePaths: deletedPaths,
                fileNames: itemsToDelete
                    .map((item) => item?.file_name || item?.file_path || '')
                    .filter(Boolean)
            }
        }));
    },

    renderItems() {
        const gridEl = document.getElementById('storage-page-files-grid');
        if (!gridEl) return;

        const state = this.getState();
        const items = Array.isArray(state.items) ? state.items : [];
        if (!items.length) {
            gridEl.classList.add('is-empty');
            gridEl.innerHTML = '<div class="storage-files-empty">В хранилище пока нет файлов.<br>Здесь будут отображаться файлы, загруженные через панель управления, а также отправленные и полученные в чатах.</div>';
            this.syncSidebarState();
            return;
        }

        gridEl.classList.remove('is-empty');
        gridEl.innerHTML = items.map((item, index) => {
            const fileName = escapeHtml(getDisplayFileName(item));
            const fileSize = escapeHtml(getItemFileSize(item));
            const fileType = String(item?.file_type || 'other').toLowerCase();
            const canOpen = Boolean(item.download_url || item.file_path || item.can_open);
            const previewMarkup = getPreviewMarkup(item, fileType, fileName);
            const itemKey = String(item?.id ?? `idx:${index}`);
            const isSelected = state.selectedKeys.has(itemKey);
            const selectableClass = state.selectionMode ? ' storage-file-tile-selectable' : '';
            const selectedClass = isSelected ? ' is-selected' : '';
            const toggleMarkup = state.selectionMode ? getSelectionToggleMarkup(isSelected) : '';
            const metaMarkup = fileSize ? `<span class="storage-file-size-inline">${fileSize}</span>` : '';

            return `
                <button
                    class="storage-file-tile storage-page-file-tile${selectableClass}${selectedClass}"
                    type="button"
                    data-storage-index="${index}"
                    data-storage-key="${itemKey}"
                    ${canOpen ? '' : 'disabled'}
                    title="${fileName}"
                >
                    ${toggleMarkup}
                    ${previewMarkup}
                    <span class="storage-file-meta">
                        <span class="storage-file-name">${fileName}</span>
                        ${metaMarkup}
                    </span>
                </button>
            `;
        }).join('');

        gridEl.querySelectorAll('.storage-page-file-tile').forEach((tile) => {
            tile.addEventListener('click', async () => {
                const index = Number(tile.getAttribute('data-storage-index'));
                if (Number.isNaN(index)) return;
                const item = items[index];
                if (!item) return;

                if (state.selectionMode) {
                    const itemKey = String(item?.id ?? `idx:${index}`);
                    if (state.selectedKeys.has(itemKey)) state.selectedKeys.delete(itemKey);
                    else state.selectedKeys.add(itemKey);
                    this.syncSidebarState();
                    this.renderItems();
                    return;
                }

                if (!item.download_url) return;
                const isConfirmed = await confirmDownloadItem(getDisplayFileName(item) || 'file');
                if (!isConfirmed) return;

                const anchor = document.createElement('a');
                anchor.href = item.download_url;
                anchor.download = getDisplayFileName(item) || 'file';
                anchor.rel = 'noopener noreferrer';
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
            });
        });

        hydrateFilePreviews(gridEl);
        this.syncSidebarState();
    },

    async loadData() {
        const clientId = getClientId();
        const token = getToken();
        if (!token) return;

        try {
            const storageRes = await fetch(`/api/chat/admin/storage-usage?client_id=${clientId}&limit=200`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const storageData = await storageRes.json();
            if (storageData.status !== 'success') return;
            const state = this.getState();
            state.items = Array.isArray(storageData.items) ? storageData.items : [];
            if (!state.selectionMode) {
                state.selectedKeys = new Set();
            } else {
                const availableKeys = new Set(state.items.map((item, index) => String(item?.id ?? `idx:${index}`)));
                state.selectedKeys = new Set(Array.from(state.selectedKeys).filter((key) => availableKeys.has(key)));
            }
            this.renderItems();
        } catch (e) {
            console.error('Storage load error:', e);
        }
    },
};
