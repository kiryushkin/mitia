const STATE_KEY = "_profileStorageModuleState";
const STORAGE_UI_STATE_KEY = "profile_storage_ui_state_v1";

function getElements() {
    const card = document.getElementById("card-storage");

    return {
        card,
        editBtn: document.getElementById("storage-edit-btn"),
        mainView: document.getElementById("storage-main-view"),
        filesView: document.getElementById("storage-files-view"),
    };
}

function refreshGridView(state) {
    const profileModule = state?.profileModule;
    if (!profileModule || typeof profileModule._refreshStorageGrid !== "function") return;
    profileModule._refreshStorageGrid();
}

function hasStorageItems(state) {
    const items = state?.profileModule?.state?.storage_items;
    return Array.isArray(items) && items.length > 0;
}

function isStorageLoaded(state) {
    return Boolean(state?.profileModule?.state?.storage_loaded);
}

function canResetSelectionMode(state) {
    return isStorageLoaded(state) && !hasStorageItems(state);
}

function applyView(state, options = {}) {
    const elements = getElements();
    const { card, editBtn, mainView, filesView } = elements;
    const skipRefresh = Boolean(options?.skipRefresh);

    if (card) card.classList.toggle("storage-files-mode", state.filesMode);

    if (mainView) mainView.style.display = state.filesMode ? "none" : "";
    if (filesView) filesView.style.display = state.filesMode ? "block" : "none";

    const hasSelection = Boolean(state?.selectedItemKeys?.size);
    const canSelect = hasStorageItems(state);

    if (canResetSelectionMode(state) && state.selectionMode) {
        state.selectionMode = false;
        clearSelection(state);
    }

    if (editBtn) {
        editBtn.style.display = state.filesMode ? "inline-flex" : "none";
        editBtn.disabled = !canSelect;
        editBtn.classList.toggle("is-active", state.selectionMode);
    }

    if (!skipRefresh) {
        refreshGridView(state);
    }
}

function resetLayoutState() {
    const { card } = getElements();
    if (card) card.classList.remove("storage-files-mode");
}

function clearSelection(state) {
    if (state?.selectedItemKeys) state.selectedItemKeys.clear();
}

function setFilesMode(state, nextFilesMode) {
    state.filesMode = Boolean(nextFilesMode);
    if (!state.filesMode) {
        state.selectionMode = false;
        clearSelection(state);
    }
}

function handleStorageEventClose(state) {
    const profileModule = state?.profileModule;
    if (profileModule && typeof profileModule.renderStorageDonut === "function") {
        profileModule.renderStorageDonut();
    }
}

function bindStorageCloseEvents(state) {
    state.handlers.onStorageDeletedClose = () => handleStorageEventClose(state);
    state.handlers.onBeforeUnload = () => persistUiState(state);

    window.addEventListener("storage:file-deleted", state.handlers.onStorageDeletedClose);
    window.addEventListener("beforeunload", state.handlers.onBeforeUnload);
}

function unbindStorageCloseEvents(state) {
    if (state.handlers.onStorageDeletedClose) {
        window.removeEventListener("storage:file-deleted", state.handlers.onStorageDeletedClose);
    }

    if (state.handlers.onBeforeUnload) {
        window.removeEventListener("beforeunload", state.handlers.onBeforeUnload);
    }
}

function getUiStorageKey(state) {
    const profileModule = state?.profileModule;
    const clientId = profileModule?.state?.client_id || localStorage.getItem("chat_client_id") || "mitia_assistant";
    return `${STORAGE_UI_STATE_KEY}:${clientId}`;
}

function persistUiState(state) {
    try {
        const key = getUiStorageKey(state);
        localStorage.setItem(key, JSON.stringify({
            filesMode: Boolean(state?.filesMode),
            selectionMode: Boolean(state?.selectionMode)
        }));
    } catch (_) {
        // ignore persistence errors
    }
}

function restoreUiState(state) {
    try {
        const key = getUiStorageKey(state);
        const raw = localStorage.getItem(key);
        if (!raw) return;

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return;

        state.filesMode = Boolean(parsed.filesMode);
        state.selectionMode = state.filesMode ? Boolean(parsed.selectionMode) : false;
    } catch (_) {
        // ignore restore errors
    }
}

function ensureFilesMode(state) {
    setFilesMode(state, true);
    applyView(state);
}

function toggleSelectionMode(state) {
    if (!hasStorageItems(state)) {
        state.selectionMode = false;
        clearSelection(state);
        applyView(state);
        persistUiState(state);
        return;
    }

    if (!state.filesMode) {
        ensureFilesMode(state);
    }

    state.selectionMode = !state.selectionMode;
    if (!state.selectionMode) {
        clearSelection(state);
    }
    applyView(state);
    persistUiState(state);
}

async function confirmDeleteSelectedItems(count) {
    const suffix = count > 1 ? "файлов" : "файл";
    const title = "Подтвердите удаление";
    const text = `Удалить ${count} ${suffix}?`;

    if (typeof window.showAlert === "function") {
        const overlay = window.showAlert("tmpl-confirm-alert", { title, text });
        if (overlay) {
            const confirmBtn = overlay.querySelector("#confirm-yes");
            const cancelBtn = overlay.querySelector("#confirm-cancel");

            return await new Promise((resolve) => {
                const close = (result) => {
                    overlay.style.opacity = "0";
                    document.body.style.overflow = "";
                    setTimeout(() => overlay.remove(), 300);
                    resolve(result);
                };

                if (confirmBtn) {
                    confirmBtn.textContent = "Удалить";
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

async function deleteSelectedItems(profileModule, state) {
    const allItems = Array.isArray(profileModule?.state?.storage_items)
        ? profileModule.state.storage_items
        : [];

    if (!allItems.length || !state.selectedItemKeys.size) return;

    const itemsToDelete = allItems.filter((item, index) => {
        const key = String(item?.id ?? `idx:${index}`);
        return state.selectedItemKeys.has(key);
    });

    if (!itemsToDelete.length) return;

    const isConfirmed = await confirmDeleteSelectedItems(itemsToDelete.length);
    if (!isConfirmed) return;

    const token = localStorage.getItem("chatadmin_auth_token");
    const deletedPaths = [];

    await Promise.all(itemsToDelete.map(async (item) => {
        if (!item?.file_path) return;

        try {
            const response = await fetch("/api/chat/admin/delete-file", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ file_url: item.file_path })
            });

            if (response.ok) {
                deletedPaths.push(item.file_path);
            }
        } catch (_) {
            // ignore per-file delete errors
        }
    }));

    if (!deletedPaths.length) return;

    const deletedSet = new Set(deletedPaths);
    profileModule.state.storage_items = allItems.filter((item) => !deletedSet.has(item.file_path));

    clearSelection(state);
    applyView(state);
    persistUiState(state);

    window.dispatchEvent(new CustomEvent("storage:file-deleted", {
        detail: {
            filePaths: deletedPaths,
            fileNames: itemsToDelete
                .map((item) => item?.file_name || item?.file_path || "")
                .filter(Boolean)
        }
    }));

    if (typeof profileModule.renderStorageDonut === "function") {
        await profileModule.renderStorageDonut();
    }
}

function attachMainHandlers(profileModule, state) {
    const { editBtn } = getElements();

    state.handlers.onEditClick = () => toggleSelectionMode(state);

    if (editBtn) editBtn.addEventListener("click", state.handlers.onEditClick);
}

function detachMainHandlers(state) {
    const { editBtn } = getElements();

    if (editBtn && state.handlers.onEditClick) {
        editBtn.removeEventListener("click", state.handlers.onEditClick);
    }

}

function destroyState(state) {
    unbindStorageCloseEvents(state);
    detachMainHandlers(state);
    resetLayoutState();
}

function initStateObject() {
    return {
        initialized: true,
        filesMode: false,
        selectionMode: false,
        selectedItemKeys: new Set(),
        handlers: {},
    };
}

function reapplyStateIfInitialized(profileModule) {
    if (!profileModule || typeof profileModule !== "object") return false;

    const existingState = profileModule[STATE_KEY];
    if (!existingState?.initialized) return false;

    applyView(existingState);
    return true;
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function getSelectionToggleMarkup(isSelected) {
    return `
        <span class="storage-file-toggle${isSelected ? ' is-selected' : ''}" aria-hidden="true">
            <span class="storage-file-toggle-dot"></span>
        </span>
    `;
}

function formatSize(bytes) {
    const size = Number(bytes || 0);
    if (!size) return "0 Б";

    const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
    let value = size;
    let index = 0;

    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
    }

    const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
    return `${rounded} ${units[index]}`;
}

function getGridElement() {
    return document.getElementById("storage-files-grid");
}

function getDisplayFileName(item) {
    const raw = String(item?.file_name || item?.file_path || "").trim();
    if (!raw) return "Без названия";

    let normalized = raw;
    try {
        normalized = decodeURIComponent(normalized);
    } catch (_) {
        // keep raw value
    }

    normalized = normalized
        .replace(/%2F/gi, "/")
        .replace(/%5C/gi, "/")
        .replace(/\\/g, "/")
        .split("?")[0]
        .split("#")[0];

    const parts = normalized.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : normalized;
}

function getFileExtension(fileName) {
    const name = String(fileName || "").trim();
    const dotIndex = name.lastIndexOf(".");
    if (dotIndex < 0 || dotIndex === name.length - 1) return "FILE";
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

function getPreviewMarkup(item, fileType, fileName) {
    const extension = getFileExtension(getDisplayFileName(item));
    const downloadUrl = escapeHtml(item.download_url || "");
    const isPdf = extension === "PDF";

    if (fileType === "image" && downloadUrl) {
        return `
            <span class="storage-file-icon storage-file-icon-preview" aria-hidden="true">
                <img class="storage-file-preview-img" src="" data-preview-url="${downloadUrl}" alt="${fileName}" loading="lazy">
            </span>
        `;
    }

    const iconClass = isPdf ? "storage-file-icon-pdf" : "storage-file-icon-doc";
    return `
        <span class="storage-file-icon ${iconClass}" aria-hidden="true">
            ${getDocumentIconMarkup()}
            <span class="storage-file-ext">${extension}</span>
        </span>
    `;
}

async function hydrateFilePreviews(grid) {
    if (!grid) return;

    const token = localStorage.getItem("chatadmin_auth_token");
    if (!token) return;

    const previewNodes = Array.from(grid.querySelectorAll(".storage-file-preview-img[data-preview-url]"));
    await Promise.all(previewNodes.map(async (node) => {
        const url = node.getAttribute("data-preview-url");
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
            node.removeAttribute("data-preview-url");
        } catch (_) {
            // ignore preview loading errors
        }
    }));
}

async function confirmDownloadItem(fileName) {
    const title = "Подтвердите скачивание";
    const text = `Скачать файл «${fileName}»?`;

    if (typeof window.showAlert === "function") {
        const overlay = window.showAlert("tmpl-confirm-alert", { title, text });
        if (overlay) {
            const confirmBtn = overlay.querySelector("#confirm-yes");
            const cancelBtn = overlay.querySelector("#confirm-cancel");

            return await new Promise((resolve) => {
                const close = (result) => {
                    overlay.style.opacity = "0";
                    document.body.style.overflow = "";
                    setTimeout(() => overlay.remove(), 300);
                    resolve(result);
                };

                if (confirmBtn) {
                    confirmBtn.textContent = "Скачать";
                    confirmBtn.classList.remove("warning-bg");
                    confirmBtn.style.background = "#22c55e";
                    confirmBtn.style.borderColor = "#22c55e";
                    confirmBtn.style.color = "#0b1115";
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

async function openStorageItem(item) {
    if (!item || !item.download_url) return;

    const fileName = getDisplayFileName(item) || "file";
    const isConfirmed = await confirmDownloadItem(fileName);
    if (!isConfirmed) return;

    const anchor = document.createElement("a");
    anchor.href = item.download_url;
    anchor.download = fileName;
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
}

function renderStorageGrid(profileModule) {
    const grid = getGridElement();
    if (!grid) return;

    const moduleState = profileModule?.[STATE_KEY] || null;
    const isSelectionMode = Boolean(moduleState?.selectionMode);
    const selectedItemKeys = moduleState?.selectedItemKeys || new Set();

    const items = Array.isArray(profileModule?.state?.storage_items)
        ? profileModule.state.storage_items
        : [];

    if (!items.length) {
        grid.classList.add("is-empty");
        grid.innerHTML = '<div class="storage-files-empty">В хранилище пока нет файлов.<br>Здесь будут отображаться файлы, загруженные через панель управления, а также отправленные и полученные в чатах.</div>';
        return;
    }

    grid.classList.remove("is-empty");
    grid.innerHTML = items
        .map((item, index) => {
            const fileName = escapeHtml(getDisplayFileName(item));
            const fileSize = formatSize(item.file_size || 0);
            const fileType = String(item.file_type || "other").toLowerCase();
            const canOpen = Boolean(item.download_url || item.file_path || item.can_open);
            const previewMarkup = getPreviewMarkup(item, fileType, fileName);
            const itemKey = String(item?.id ?? `idx:${index}`);
            const isSelected = selectedItemKeys.has(itemKey);
            const selectableClass = isSelectionMode ? " storage-file-tile-selectable" : "";
            const selectedClass = isSelected ? " is-selected" : "";

            return `
                <button
                    class="storage-file-tile${selectableClass}${selectedClass}"
                    type="button"
                    data-storage-index="${index}"
                    data-storage-key="${itemKey}"
                    ${canOpen ? "" : "disabled"}
                    title="${fileName}"
                >
                    ${isSelectionMode ? getSelectionToggleMarkup(isSelected) : ''}
                    ${previewMarkup}
                    <span class="storage-file-name">${fileName}</span>
                    <span class="storage-file-size">${fileSize}</span>
                </button>
            `;
        })
        .join("");

    const tiles = grid.querySelectorAll(".storage-file-tile");
    tiles.forEach((tile) => {
        tile.addEventListener("click", () => {
            const index = Number(tile.getAttribute("data-storage-index"));
            if (Number.isNaN(index)) return;

            const item = items[index];
            if (!item) return;

            if (isSelectionMode && moduleState) {
                const itemKey = String(item?.id ?? `idx:${index}`);
                if (moduleState.selectedItemKeys.has(itemKey)) {
                    moduleState.selectedItemKeys.delete(itemKey);
                } else {
                    moduleState.selectedItemKeys.add(itemKey);
                }
                applyView(moduleState);
                persistUiState(moduleState);
                return;
            }

            void openStorageItem(item);
        });
    });

    hydrateFilePreviews(grid);

    if (moduleState) {
        applyView(moduleState, { skipRefresh: true });
    }
}

function setProfileHelpers(profileModule) {
    profileModule._refreshStorageGrid = () => renderStorageGrid(profileModule);
}

function finalizeInit(profileModule, state) {
    setProfileHelpers(profileModule);
    state.profileModule = profileModule;
    restoreUiState(state);
    profileModule[STATE_KEY] = state;

    attachMainHandlers(profileModule, state);
    bindStorageCloseEvents(state);
    applyView(state);
}

function clearProfileState(profileModule) {
    if (!profileModule || typeof profileModule !== "object") return;
    delete profileModule[STATE_KEY];
}

function getStoredState(profileModule) {
    if (!profileModule || typeof profileModule !== "object") return null;
    return profileModule[STATE_KEY] || null;
}

function hasInitializedState(profileModule) {
    const state = getStoredState(profileModule);
    return Boolean(state?.initialized);
}

function disposeState(profileModule) {
    const state = getStoredState(profileModule);
    if (!state?.initialized) return;

    destroyState(state);
    clearProfileState(profileModule);
}

function initializeState(profileModule) {
    if (reapplyStateIfInitialized(profileModule)) return;

    const state = initStateObject();
    finalizeInit(profileModule, state);
}

function validateProfileModule(profileModule) {
    return Boolean(profileModule && typeof profileModule === "object");
}

function shouldSkipInit(profileModule) {
    return !validateProfileModule(profileModule);
}

function shouldSkipTeardown(profileModule) {
    return !validateProfileModule(profileModule) || !hasInitializedState(profileModule);
}

function runInit(profileModule) {
    if (shouldSkipInit(profileModule)) return;
    initializeState(profileModule);
}

function runTeardown(profileModule) {
    if (shouldSkipTeardown(profileModule)) return;
    disposeState(profileModule);
}

export function initProfileStorageModule(profileModule) {
    runInit(profileModule);
}

export function teardownProfileStorageModule(profileModule) {
    runTeardown(profileModule);
}
