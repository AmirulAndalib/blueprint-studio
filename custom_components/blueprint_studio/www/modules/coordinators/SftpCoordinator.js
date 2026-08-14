/**
 * SFTP-COORDINATOR.JS | Purpose:
 * Coordinates all SFTP-related operations, including connections, navigation, and remote file actions.
 * This is a "piece" of the decomposed app.js.
 */

import { state } from '../state.js';
import { eventBus } from '../event-bus.js';

import { initSftpPanelButtons, renderSftpPanel } from '../sftp.js';

// Functions provided via callbacks during initialization
let functions = {
    connectToServer: null,
    navigateSftp: null,
    openSftpFile: null,
    showAddConnectionDialog: null,
    showEditConnectionDialog: null,
    deleteConnection: null,
    refreshSftp: null,
    saveSftpFile: null,
    applySftpVisibility: null,
    refreshSftpStrings: null
};

/**
 * Initializes the SFTP Coordinator by registering event listeners
 * @param {Object} callbacks - Implementation functions from app.js
 */
export function initSftpCoordinator(callbacks) {
    functions = { ...functions, ...callbacks };

    // Initialize SFTP UI
    initSftpPanelButtons();
    renderSftpPanel();

    // Connection Restoration
    eventBus.on('app:restore-sftp', async () => {
        const savedConnId = localStorage.getItem('blueprint_studio_active_sftp_conn');
        const savedPath = localStorage.getItem('blueprint_studio_active_sftp_path');

        if (savedConnId && state.sftpConnections) {
            const connExists = state.sftpConnections.some(c => c.id === savedConnId);
            if (connExists && functions.connectToServer) {
                await functions.connectToServer(savedConnId, savedPath || "/");
            }
        }
    });

    // Connection Actions
    eventBus.on('sftp:connect', async (data) => {
        if (functions.connectToServer) {
            await functions.connectToServer(data.connectionId, data.path);
        }
    });

    eventBus.on('sftp:add-connection', () => {
        if (functions.showAddConnectionDialog) functions.showAddConnectionDialog();
    });

    eventBus.on('sftp:edit-connection', (data) => {
        if (functions.showEditConnectionDialog) functions.showEditConnectionDialog(data.connection);
    });

    eventBus.on('sftp:delete-connection', (data) => {
        if (functions.deleteConnection) functions.deleteConnection(data.connectionId);
    });

    // Navigation & File Actions
    eventBus.on('sftp:navigate', async (data) => {
        if (functions.navigateSftp) {
            await functions.navigateSftp(data.path);
        }
    });

    eventBus.on('sftp:open-file', async (data) => {
        if (functions.openSftpFile) {
            await functions.openSftpFile(data.connectionId, data.path, data.noActivate);
        }
    });

    eventBus.on('sftp:save-file', async (data) => {
        if (functions.saveSftpFile) {
            await functions.saveSftpFile(data.connectionId, data.path, data.content);
        }
    });

    // UI Refresh
    eventBus.on('sftp:refresh', () => {
        if (functions.refreshSftp) functions.refreshSftp();
    });

    eventBus.on('sftp:refresh-strings', () => {
        if (functions.refreshSftpStrings) functions.refreshSftpStrings();
    });

    eventBus.on('sftp:apply-visibility', () => {
        if (functions.applySftpVisibility) functions.applySftpVisibility();
    });
}
