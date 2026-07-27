/**
 * DIALOG-COORDINATOR.JS | Purpose:
 * Coordinates all modal dialogs, shortcuts, and external support links.
 * This is a "piece" of the decomposed app.js.
 */

import { state, elements } from '../state.js';
import { eventBus } from '../event-bus.js';

// Functions provided via callbacks during initialization
let functions = {
    showShortcuts: null,
    hideShortcuts: null,
    reportIssue: null,
    requestFeature: null,
    restartHomeAssistant: null,
    openDevTools: null,
    showCommandPalette: null,
    hideModal: null,
    confirmModal: null
};

/**
 * Initializes the Dialog Coordinator by registering event listeners
 * @param {Object} callbacks - Implementation functions from app.js
 */
export function initDialogCoordinator(callbacks) {
    functions = { ...functions, ...callbacks };

    // Modal events
    if (elements.modalClose) {
        elements.modalClose.addEventListener("click", () => {
            if (functions.hideModal) functions.hideModal();
        });
    }
    if (elements.modalCancel) {
        elements.modalCancel.addEventListener("click", () => {
            if (functions.hideModal) functions.hideModal();
        });
    }
    if (elements.modalConfirm) {
        elements.modalConfirm.addEventListener("click", () => {
            if (functions.confirmModal) functions.confirmModal();
        });
    }
    if (elements.modalInput) {
        elements.modalInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                if (functions.confirmModal) functions.confirmModal();
            }
        });
    }

    // Help & Support
    eventBus.on("ui:show-shortcuts", (data) => {
        if (functions.showShortcuts) functions.showShortcuts(data || {});
    });

    eventBus.on("ui:hide-shortcuts", () => {
        if (functions.hideShortcuts) functions.hideShortcuts();
    });

    eventBus.on("ui:report-issue", () => {
        if (functions.reportIssue) functions.reportIssue();
    });

    eventBus.on("ui:request-feature", () => {
        if (functions.requestFeature) functions.requestFeature();
    });

    // System Actions
    eventBus.on("ha:restart", () => {
        if (functions.restartHomeAssistant) functions.restartHomeAssistant();
    });

    eventBus.on("ha:dev-tools", (data) => {
        if (functions.openDevTools) functions.openDevTools(data && data.tab ? data.tab : 'template');
    });

    // Palette
    eventBus.on("ui:show-command-palette", (data) => {
        if (functions.showCommandPalette) functions.showCommandPalette(data ? data.initialMode : "");
    });

    eventBus.on("ui:show-quick-switcher", () => {
        if (functions.showCommandPalette) functions.showCommandPalette("");
    });

    eventBus.on("ui:hide-modal", () => {
        if (functions.hideModal) functions.hideModal();
    });
}
