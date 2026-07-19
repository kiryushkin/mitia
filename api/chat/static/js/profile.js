import { teardownProfileStorageModule } from './modules/profile-storage.js?v=105';
import {
    getClientId,
    getToken,
    clearProfileValidationErrors,
    markFieldsError,
    clearTariffError,
    setTariffError,
    formatSaveFailureMessage
} from './modules/profile-helpers.js?v=1';
import {
    bindAccountControls,
    toggleAccountEditMode,
    saveAccountCardChanges,
    handleInlineAccountDelete
} from './modules/profile-account.js?v=1';
import {
    handlePasswordUpdate,
    savePasswordCardChanges,
    bindSecurityControls,
    toggleSecurityLock,
    saveLockState
} from './modules/profile-security.js?v=1';
import {
    performTariffChange,
    getCurrentTariffId,
    updateTariffInlineUI,
    bindTariffInlineControls,
    saveTariffCardChanges
} from './modules/profile-tariff.js?v=1';
import {
    loadBalanceHistory,
    toggleBalanceHistory,
    handleTopUp,
    confirmPendingYookassaPayment
} from './modules/profile-billing.js?v=1';
import {
    normalizeAssistantItem,
    getAssistantsData,
    updateAssistantCard,
    getAssistantsUiStorageKey,
    persistAssistantsUiState,
    restoreAssistantsUiState,
    initAssistantsMode,
    teardownAssistantsMode,
    openAssistantsPanel,
    closeAssistantsPanel,
    toggleAssistantsSelectionMode,
    syncAssistantsSidebarState,
    renderAssistantsPanel,
    saveActiveAssistantSelection,
    deleteSelectedAssistants,
    createAssistantFlow,
    confirmAssistantsDeletion
} from './modules/profile-assistants.js?v=1';
import {
    getWidgetPreviewStyle,
    renderAssistantAvatar,
    withOpacity,
    applyAssistantPreview
} from './modules/profile-preview.js?v=1';
import {
    renderStorageDonut
} from './modules/profile-storage-donut.js?v=1';
import {
    loadData,
    fillForm,
    updateUI
} from './modules/profile-data-ui.js?v=2';
import {
    initOrb
} from './modules/profile-orb.js?v=1';
import {
    bindEvents
} from './modules/profile-events.js?v=1';
import {
    loadNewsPreview,
    pollBalance
} from './modules/profile-runtime.js?v=2';
import {
    saveData,
    showAlert
} from './modules/profile-save.js?v=1';

const boundModuleMethods = {
    getClientId,
    getToken,
    clearProfileValidationErrors,
    markFieldsError,
    clearTariffError,
    setTariffError,
    formatSaveFailureMessage,
    bindAccountControls,
    toggleAccountEditMode,
    saveAccountCardChanges,
    handleInlineAccountDelete,
    handlePasswordUpdate,
    savePasswordCardChanges,
    bindSecurityControls,
    toggleSecurityLock,
    saveLockState,
    performTariffChange,
    getCurrentTariffId,
    updateTariffInlineUI,
    bindTariffInlineControls,
    saveTariffCardChanges,
    loadBalanceHistory,
    toggleBalanceHistory,
    handleTopUp,
    confirmPendingYookassaPayment,
    normalizeAssistantItem,
    getAssistantsData,
    updateAssistantCard,
    getAssistantsUiStorageKey,
    persistAssistantsUiState,
    restoreAssistantsUiState,
    initAssistantsMode,
    teardownAssistantsMode,
    openAssistantsPanel,
    closeAssistantsPanel,
    toggleAssistantsSelectionMode,
    syncAssistantsSidebarState,
    renderAssistantsPanel,
    saveActiveAssistantSelection,
    deleteSelectedAssistants,
    createAssistantFlow,
    confirmAssistantsDeletion,
    getWidgetPreviewStyle,
    renderAssistantAvatar,
    withOpacity,
    applyAssistantPreview,
    renderStorageDonut,
    loadData,
    fillForm,
    updateUI,
    initOrb,
    bindEvents,
    loadNewsPreview,
    pollBalance,
    saveData,
    showAlert
};

function attachBoundMethods(target) {
    Object.entries(boundModuleMethods).forEach(([name, fn]) => {
        target[name] = fn;
    });
}

export const ProfileModule = {
    state: {
        charts: {}
    },
    init() {
        console.log('Profile module V2 initialized');
        this.state.selected_tariff = null;
        
        this.bindEvents();
        this.loadData();
        this.startPolling();
        this.confirmPendingYookassaPayment();
        this.renderStorageDonut();
        this.initOrb();
        this.bindAccountControls();
        this.bindSecurityControls();
        this.bindTariffInlineControls();
        this.initAssistantsMode();
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
        teardownProfileStorageModule(this);
        this.teardownAssistantsMode();
        if (this._onProfileInput) document.removeEventListener('input', this._onProfileInput);
        if (this._onProfileChange) document.removeEventListener('change', this._onProfileChange);
        if (this._onProfileClickCapture) document.removeEventListener('click', this._onProfileClickCapture, true);
    },

};

attachBoundMethods(ProfileModule);
