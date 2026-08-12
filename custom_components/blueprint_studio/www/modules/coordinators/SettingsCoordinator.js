/**
 * SETTINGS-COORDINATOR.JS | Purpose:
 * Coordinates all settings-related operations, theme applications, and UI state refreshes.
 * This is a "piece" of the decomposed app.js.
 */

import { state, elements } from '../state.js';
import { eventBus } from '../event-bus.js';

// Functions provided via callbacks during initialization
let functions = {
    applyTheme: null,
    applyEditorSettings: null,
    applyLayoutSettings: null,
    updateAIVisibility: null,
    saveSettings: null,
    refreshAllUIStrings: null,
    showAppSettings: null,
    setThemePreset: null,
    applyCustomSyntaxColors: null
};

let workspaceSaveTimer = null;

/**
 * Initializes the Settings Coordinator by registering event listeners
 * @param {Object} callbacks - Implementation functions from app.js
 */
export function initSettingsCoordinator(callbacks) {
    functions = { ...functions, ...callbacks };

    // Settings Lifecycle
    eventBus.on("settings:loaded", () => {
        if (functions.applyTheme) functions.applyTheme();
        if (functions.applyEditorSettings) functions.applyEditorSettings();
        if (functions.applyCustomSyntaxColors) functions.applyCustomSyntaxColors();
        if (functions.updateAIVisibility) functions.updateAIVisibility();

        // Visibility events
        eventBus.emit('sftp:apply-visibility');
        eventBus.emit('git:apply-visibility');
        eventBus.emit('terminal:apply-visibility');

        // Re-render pinned (favorites) panel so pinned files appear after page refresh
        eventBus.emit('ui:refresh-favorites');
    });

    eventBus.on("settings:save", () => {
        if (functions.saveSettings) functions.saveSettings();
    });

    eventBus.on("settings:save-workspace-state", () => {
        if (!state.rememberWorkspace) return;
        if (workspaceSaveTimer) clearTimeout(workspaceSaveTimer);
        workspaceSaveTimer = setTimeout(() => {
            if (functions.saveSettings) functions.saveSettings();
        }, 1000);
    });

    // Theme & UI Presets
    eventBus.on('ui:set-theme-preset', (data) => {
        if (functions.setThemePreset) functions.setThemePreset(data.preset);
    });

    // UI Refresh Events
    eventBus.on('ui:refresh-strings', () => {
        if (functions.refreshAllUIStrings) functions.refreshAllUIStrings();
    });

    eventBus.on("ui:refresh-theme", () => {
        if (functions.applyTheme) functions.applyTheme();
    });

    eventBus.on("ui:refresh-editor", () => {
        if (functions.applyEditorSettings) functions.applyEditorSettings();
        if (functions.applyCustomSyntaxColors) functions.applyCustomSyntaxColors();
    });

    eventBus.on("ui:refresh-layout", () => {
        if (functions.applyLayoutSettings) functions.applyLayoutSettings();
    });

    eventBus.on("ui:refresh-visibility", () => {
        if (functions.updateAIVisibility) functions.updateAIVisibility();
        eventBus.emit('sftp:apply-visibility');
        eventBus.emit('git:apply-visibility');
        eventBus.emit('terminal:apply-visibility');
    });

    // Modals
    eventBus.on("ui:show-settings", ({ tab } = {}) => {
        if (functions.showAppSettings) {
            functions.showAppSettings({ section: tab });
        } else {
            console.warn("[SettingsCoordinator] showAppSettings implementation not registered");
        }
    });

    if (elements.btnAppSettings) {
        elements.btnAppSettings.addEventListener("click", () => {
            if (functions.showAppSettings) functions.showAppSettings();
        });
    }
}
