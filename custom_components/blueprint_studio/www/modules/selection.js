import { t } from './translations.js';
/** SELECTION.JS | Purpose: Multi-file/folder selection mode for bulk operations. */
import { state, elements } from './state.js';
import { fetchWithAuth } from './api.js';
import { eventBus } from './event-bus.js';
import { API_BASE } from './constants.js';
import { showToast, showConfirmDialog } from './ui.js';
import { parseSftpPath } from './sftp.js?v=2.5.188';
import { startOperationFeedback } from './feedback-service.js?v=2.5.188';

/**
 * Toggle selection mode on/off
 */
export function toggleSelectionMode() {
  state.selectionMode = !state.selectionMode;
  if (!state.selectionMode) {
    state.selectedItems.clear();
  }

  if (elements.selectionToolbar) {
    elements.selectionToolbar.hidden = !state.selectionMode;
    elements.selectionToolbar.classList.toggle("hidden", !state.selectionMode);
  }

  if (elements.btnToggleSelect) {
    elements.btnToggleSelect.classList.toggle("active", state.selectionMode);
    elements.btnToggleSelect.setAttribute("aria-pressed", String(state.selectionMode));
    const toggleLabel = state.selectionMode ? t("selection.exit") : t("toolbar.select_files");
    elements.btnToggleSelect.title = toggleLabel;
    elements.btnToggleSelect.setAttribute("aria-label", toggleLabel);
  }

  updateSelectionCount();
  
  // Broadcast that selection mode changed so trees can refresh
  eventBus.emit('ui:refresh-tree');
  eventBus.emit('ui:refresh-sftp');
}

/**
 * Handle selection change for a file/folder
 */
export function handleSelectionChange(path, isSelected) {
  const prefix = `${path.replace(/\/+$/, "")}/`;
  if (isSelected) {
    for (const selectedPath of Array.from(state.selectedItems)) {
      if (selectedPath.startsWith(prefix)) {
        state.selectedItems.delete(selectedPath);
      }
    }
    state.selectedItems.add(path);
  } else {
    state.selectedItems.delete(path);
    for (const selectedPath of Array.from(state.selectedItems)) {
      if (selectedPath.startsWith(prefix)) {
        state.selectedItems.delete(selectedPath);
      }
    }
  }
  updateSelectionCount();
}

export function isItemSelected(path) {
  if (!path) return false;
  if (state.selectedItems.has(path)) return true;

  const isSftp = path.startsWith("sftp://");
  for (const selectedPath of state.selectedItems) {
    if (isSftp !== selectedPath.startsWith("sftp://")) continue;
    const prefix = `${selectedPath.replace(/\/+$/, "")}/`;
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Update the selection count display and button states
 */
export function updateSelectionCount() {
  const count = state.selectedItems.size;
  const selectedPaths = Array.from(state.selectedItems);
  const remotePaths = selectedPaths.filter((path) => path.startsWith("sftp://"));
  const includesRemoteItems = remotePaths.length > 0;
  const includesLocalItems = remotePaths.length !== selectedPaths.length;
  const remoteConnectionIds = new Set(remotePaths.map((path) => parseSftpPath(path).connId));
  const incompatibleDownloadSelection =
    (includesRemoteItems && includesLocalItems) || remoteConnectionIds.size > 1;
  if (elements.selectionModeLabel) {
    elements.selectionModeLabel.textContent = t("selection.mode");
  }
  if (elements.selectionCount) {
    elements.selectionCount.textContent = t(
      count === 1 ? "selection.count_one" : "selection.count_many",
      { count },
    );
  }
  if (elements.btnDownloadSelected) {
    const downloadLabel = incompatibleDownloadSelection
      ? t("selection.download_one_location")
      : t("selection.download");
    elements.btnDownloadSelected.disabled = count === 0 || incompatibleDownloadSelection;
    elements.btnDownloadSelected.title = downloadLabel;
    elements.btnDownloadSelected.setAttribute("aria-label", downloadLabel);
  }
  if (elements.btnDeleteSelected) {
    elements.btnDeleteSelected.disabled = count === 0;
    elements.btnDeleteSelected.title = t("selection.delete");
    elements.btnDeleteSelected.setAttribute("aria-label", t("selection.delete"));
  }
  if (elements.btnCancelSelection) {
    elements.btnCancelSelection.title = t("selection.exit");
    elements.btnCancelSelection.setAttribute("aria-label", t("selection.exit"));
  }
}

/**
 * Delete all selected items
 */
export async function deleteSelectedItems() {
  if (state.selectedItems.size === 0) return;
  return confirmDeleteSelectedItems(Object.freeze(Array.from(state.selectedItems)));
}

async function confirmDeleteSelectedItems(paths) {
  const localCount = paths.filter((path) => !path.startsWith('sftp://')).length;
  const remoteCount = paths.length - localCount;
  const locationSummary = `<div class="operation-location ${localCount && remoteCount ? 'is-mixed' : remoteCount ? 'is-remote' : 'is-local'}"><span class="ui-icon material-icons" aria-hidden="true">${localCount && remoteCount ? 'compare_arrows' : remoteCount ? 'cloud' : 'home'}</span><span><strong>${localCount && remoteCount ? 'Mixed locations' : remoteCount ? 'Remote SFTP' : 'Local Home Assistant'}</strong><small>${localCount} local · ${remoteCount} remote</small></span></div>`;

  const confirmed = await showConfirmDialog({
    title: "Delete Selected Items?",
    message: `${locationSummary}Are you sure you want to permanently delete <b>${paths.length} items</b>? This action cannot be undone.`,
    confirmText: "Delete All",
    cancelText: "Cancel",
    isDanger: true
  });

  if (!confirmed) return false;
  return runDeleteSelectedItems(paths);
}

function closeDeletedTabs(paths) {
  paths.forEach(path => {
    const folderPrefix = path.endsWith('/') ? path : path + '/';
    const tabsToClose = state.openTabs.filter(tab => tab.path === path || tab.path.startsWith(folderPrefix));
    tabsToClose.forEach(tab => eventBus.emit('tab:close', { tab, force: true }));
  });
}

async function runDeleteSelectedItems(paths) {
  const itemCountLabel = count => `${count} ${count === 1 ? 'item' : 'items'}`;
  const localPaths = paths.filter(path => !path.startsWith('sftp://'));
  const sftpGroups = new Map();
  for (const virtualPath of paths.filter(path => path.startsWith('sftp://'))) {
    const { connId, remotePath } = parseSftpPath(virtualPath);
    if (!sftpGroups.has(connId)) sftpGroups.set(connId, []);
    sftpGroups.get(connId).push({ virtualPath, remotePath });
  }
  const locationCount = (localPaths.length ? 1 : 0) + sftpGroups.size;
  const scope = localPaths.length && sftpGroups.size
    ? 'Local Home Assistant and SFTP'
    : sftpGroups.size
      ? 'SFTP workspaces'
      : 'Local Home Assistant';
  const targetPreview = paths.slice(0, 3).join(', ');
  const target = `${paths.length} items${targetPreview ? `: ${targetPreview}${paths.length > 3 ? ` and ${paths.length - 3} more` : ''}` : ''}`;
  const operation = startOperationFeedback({
    label: `Delete ${paths.length} selected ${paths.length === 1 ? 'item' : 'items'}`,
    icon: 'delete',
    scope,
    target,
    message: `Deleting from ${locationCount} ${locationCount === 1 ? 'location' : 'locations'}...`,
    retry: () => confirmDeleteSelectedItems(paths),
    open: () => eventBus.emit('ui:switch-sidebar-view', localPaths.length ? 'explorer' : 'sftp'),
    openLabel: 'Browse',
    openIcon: 'folder_open',
  });
  const completedPaths = [];
  const completedGroups = [];
  const failures = [];
  let processedGroups = 0;

  const updateProgress = message => {
    processedGroups += 1;
    operation.update({
      message,
      percent: locationCount ? (processedGroups / locationCount) * 100 : 100,
    });
  };

  if (localPaths.length) {
    try {
      const response = await fetchWithAuth(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_multi", paths: localPaths }),
      });
      if (!response.success) throw new Error(response.message || response.error || 'Local deletion request failed');
      completedPaths.push(...localPaths);
      completedGroups.push(`Local Home Assistant (${itemCountLabel(localPaths.length)})`);
      updateProgress('Local deletion request completed');
    } catch (error) {
      failures.push(`Local Home Assistant (${itemCountLabel(localPaths.length)}): ${error.message}`);
      updateProgress('Local deletion request failed');
    }
  }

  for (const [connId, items] of sftpGroups) {
    const conn = state.sftpConnections.find(candidate => candidate.id === connId);
    const connectionLabel = conn?.name || connId;
    if (!conn) {
      failures.push(`SFTP ${connectionLabel} (${itemCountLabel(items.length)}): connection not found`);
      updateProgress(`SFTP ${connectionLabel} is unavailable`);
      continue;
    }
    try {
      const response = await fetchWithAuth(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sftp_delete_multi",
          connection: {
            host: conn.host,
            port: conn.port || 22,
            username: conn.username,
            auth: state.activeSftp.connectionId === connId
              ? (state.activeSftp.auth || { type: 'password', password: conn.password || '' })
              : { type: 'password', password: conn.password || '' }
          },
          paths: items.map(item => item.remotePath)
        }),
      });
      if (!response.success) throw new Error(response.message || response.error || 'Remote deletion request failed');
      completedPaths.push(...items.map(item => item.virtualPath));
      completedGroups.push(`SFTP ${connectionLabel} (${itemCountLabel(items.length)})`);
      updateProgress(`SFTP ${connectionLabel} deletion request completed`);
    } catch (error) {
      failures.push(`SFTP ${connectionLabel} (${itemCountLabel(items.length)}): ${error.message}`);
      updateProgress(`SFTP ${connectionLabel} deletion request failed`);
    }
  }

  closeDeletedTabs(completedPaths);
  completedPaths.forEach(path => state.selectedItems.delete(path));
  if (state.selectionMode && state.selectedItems.size === 0) toggleSelectionMode();
  else updateSelectionCount();
  eventBus.emit('ui:reload-files', { force: true });
  eventBus.emit('ui:refresh-sftp');
  eventBus.emit('git:refresh');

  if (failures.length) {
    const detail = [
      completedGroups.length ? `Accepted request groups:\n- ${completedGroups.join('\n- ')}` : 'No deletion request groups completed.',
      `Failed request groups:\n- ${failures.join('\n- ')}`,
      completedGroups.length ? 'Items in accepted groups may already be deleted. No changes were rolled back.' : '',
    ].filter(Boolean).join('\n\n');
    operation.fail('Deletion incomplete', detail);
    showToast(t("toast.delete_items_failed", { error: failures[0] }), "error");
    return false;
  }

  operation.finish(`Deletion requests completed for ${paths.length} items`, {
    detail: completedGroups.join(' · '),
  });
  showToast(t("toast.deleted_items", { count: paths.length }), "success");
  return true;
}
