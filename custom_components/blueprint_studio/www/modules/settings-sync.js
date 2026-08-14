/** SETTINGS-SYNC.JS | Purpose: * Handles real-time synchronization of settings between the PWA and the */

import { loadSettings, saveSettings } from './settings.js';
import { state } from './state.js';
import { fetchWithAuth } from './api.js';
import { API_BASE } from './constants.js';

let settingsSyncCallbacks = {};
let settingsSyncListener = null;
let pollingInterval = null;
let lastSyncTimestamp = 0;
const SYNC_DEBOUNCE_MS = 500; // Prevent rapid repeated syncs
let isSyncInProgress = false;

/**
 * Initialize settings synchronization
 * @param {Object} callbacks - Callbacks for when settings change
 *   - onSettingsChanged: Called after settings are reloaded
 */
export function initializeSettingsSync(callbacks = {}) {
  settingsSyncCallbacks = callbacks;

  // Try WebSocket first
  subscribeToSettingsChanges();
}

/**
 * Stop settings synchronization
 */
export function stopSettingsSync() {
  if (settingsSyncListener) {
    settingsSyncListener();
    settingsSyncListener = null;
  }

  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

/**
 * Subscribe to settings changes via WebSocket
 */
function subscribeToSettingsChanges() {
  // Check if in iframe (Home Assistant context)
  if (!window.parent || window.parent === window) {
    // Standalone mode or browser - WebSocket not available
    return;
  }

  try {
    // Use Home Assistant websocket API
    if (window.hassConnection) {
      window.hassConnection.subscribeEvents((event) => {
        if (event.data?.type === 'blueprint_studio/settings') {
          handleSettingsUpdate(event.data.data);
        }
      }, 'blueprint_studio_settings_changed');

      // Alternative: use blueprint_studio websocket subscription
      window.hassConnection.subscribeEvents((event) => {
        if (event.data?.type === 'settings_changed') {
          handleSettingsUpdate(event.data.data);
        }
      }, 'blueprint_studio_update');
    }
  } catch (err) {
    console.warn('[Settings Sync] WebSocket subscription failed:', err);
  }
}

/**
 * Handle settings update from external source
 * @param {Object} newSettings - New settings from server
 */
async function handleSettingsUpdate(newSettings) {
  const now = Date.now();

  // Debounce: prevent rapid updates
  if (now - lastSyncTimestamp < SYNC_DEBOUNCE_MS) {
    return;
  }

  // Prevent infinite sync loops
  if (isSyncInProgress) {
    return;
  }

  isSyncInProgress = true;
  lastSyncTimestamp = now;

  try {
    // Don't reload if we just saved (check within 1 second)
    const lastSaveTime = state._lastSettingsSaveTime || 0;
    if (now - lastSaveTime < 1000) {
      return;
    }

    // Apply the new settings directly if provided (may be omitted to save bandwidth)
    if (newSettings && typeof newSettings === 'object') {
        applyExternalSettings(newSettings);
    }

    // Reload via the normal mechanism (this fetches full settings from API)
    await loadSettings();

    // Call callback if provided
    if (settingsSyncCallbacks.onSettingsChanged) {
      await settingsSyncCallbacks.onSettingsChanged();
    }

    // Show notification (optional)
    if (state.showToasts) {
      showSettingsSyncNotification('Settings updated from Home Assistant');
    }
  } catch (err) {
    console.error('[Settings Sync] Failed to sync settings:', err);
  } finally {
    isSyncInProgress = false;
  }
}

/**
 * Apply external settings changes to state
 * @param {Object} settings - Settings from server
 */
function applyExternalSettings(settings) {
  // Update critical settings that affect UI
  if (settings.theme) state.theme = settings.theme;
  if (settings.language) state.language = settings.language;
  if (settings.themePreset) state.themePreset = settings.themePreset;
  if (settings.accentColor) state.accentColor = settings.accentColor;
  if (settings.fontSize) state.fontSize = parseInt(settings.fontSize);
  if (settings.fontFamily) state.fontFamily = settings.fontFamily;

  // AI settings
  if (settings.aiIntegrationEnabled !== undefined) {
    state.aiIntegrationEnabled = settings.aiIntegrationEnabled;
  }
  if (settings.aiType) state.aiType = settings.aiType;
  if (settings.cloudProvider) state.cloudProvider = settings.cloudProvider;

  // Integration toggles
  if (settings.gitIntegrationEnabled !== undefined) {
    state.gitIntegrationEnabled = settings.gitIntegrationEnabled;
  }
  if (settings.giteaIntegrationEnabled !== undefined) {
    state.giteaIntegrationEnabled = settings.giteaIntegrationEnabled;
  }
  if (settings.sftpIntegrationEnabled !== undefined) {
    state.sftpIntegrationEnabled = settings.sftpIntegrationEnabled;
  }
  if (settings.terminalIntegrationEnabled !== undefined) {
    state.terminalIntegrationEnabled = settings.terminalIntegrationEnabled;
  }
}

/**
 * Track when settings are saved locally (to prevent ping-pong sync)
 */
export function trackSettingsSave() {
  state._lastSettingsSaveTime = Date.now();
}

/**
 * Show notification about settings sync
 */
function showSettingsSyncNotification(message) {
  try {
    // Show toast if available
    const event = new CustomEvent('showToast', {
      detail: {
        message: message,
        type: 'info',
        duration: 3000
      }
    });
    window.dispatchEvent(event);
  } catch (err) {
    console.debug('[Settings Sync] Could not show notification:', err);
  }
}
