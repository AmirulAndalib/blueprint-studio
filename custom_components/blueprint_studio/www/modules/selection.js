import { t } from './translations.js?v=2.5.270';
/** SELECTION.JS | Purpose: Multi-file/folder selection mode for bulk operations. */
import { state, elements } from './state.js';
import { fetchWithAuth } from './api.js';
import { eventBus } from './event-bus.js';
import { API_BASE } from './constants.js?v=2.5.270';
import { showToast, showConfirmDialog } from './ui.js';
import { parseSftpPath } from './sftp.js?v=2.5.270';
import { startOperationFeedback } from './feedback-service.js?v=2.5.270';

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
  const locationSummary = `<div class="operation-location ${localCount && remoteCount ? 'is-mixed' : remoteCount ? 'is-remote' : 'is-local'}"><span class="ui-icon material-icons" aria-hidden="true">${localCount && remoteCount ? 'compare_arrows' : remoteCount ? 'cloud' : 'home'}</span><span><strong>${localCount && remoteCount ? t('selection.mixed_locations') : remoteCount ? t('selection.remote_sftp') : t('selection.local_home_assistant')}</strong><small>${t('selection.location_counts', { local: localCount, remote: remoteCount })}</small></span></div>`;

  const confirmed = await showConfirmDialog({
    title: t('selection.delete_title'),
    message: `${locationSummary}${t('selection.delete_message', { count: paths.length })}`,
    confirmText: t('selection.delete_all'),
    cancelText: t('modal.cancel_button'),
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
  const itemCountLabel = count => t(count === 1 ? 'selection.item_count.one' : 'selection.item_count.other', { count });
  const localPaths = paths.filter(path => !path.startsWith('sftp://'));
  const sftpGroups = new Map();
  for (const virtualPath of paths.filter(path => path.startsWith('sftp://'))) {
    const { connId, remotePath } = parseSftpPath(virtualPath);
    if (!sftpGroups.has(connId)) sftpGroups.set(connId, []);
    sftpGroups.get(connId).push({ virtualPath, remotePath });
  }
  const locationCount = (localPaths.length ? 1 : 0) + sftpGroups.size;
  const scope = localPaths.length && sftpGroups.size
    ? t('selection.local_and_sftp')
    : sftpGroups.size
      ? t('selection.sftp_workspaces')
      : t('selection.local_home_assistant');
  const targetPreview = paths.slice(0, 3).join(', ');
  const target = t('selection.target', { count: paths.length, preview: targetPreview, suffix: paths.length > 3 ? t('selection.more', { count: paths.length - 3 }) : '' });
  const operation = startOperationFeedback({
    label: t('selection.delete_label', { count: paths.length }),
    icon: 'delete',
    scope,
    target,
    message: t(locationCount === 1 ? 'selection.deleting_one_location' : 'selection.deleting_many_locations', { count: locationCount }),
    retry: () => confirmDeleteSelectedItems(paths),
    open: () => eventBus.emit('ui:switch-sidebar-view', localPaths.length ? 'explorer' : 'sftp'),
    openLabel: t('selection.browse'),
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
      if (!response.success) throw new Error(response.message || response.error || t('selection.local_delete_request_failed'));
      completedPaths.push(...localPaths);
      completedGroups.push(`${t('selection.local_home_assistant')} (${itemCountLabel(localPaths.length)})`);
      updateProgress(t('selection.local_delete_request_completed'));
    } catch (error) {
      failures.push(`${t('selection.local_home_assistant')} (${itemCountLabel(localPaths.length)}): ${error.message}`);
      updateProgress(t('selection.local_delete_request_failed'));
    }
  }

  for (const [connId, items] of sftpGroups) {
    const conn = state.sftpConnections.find(candidate => candidate.id === connId);
    const connectionLabel = conn?.name || connId;
    if (!conn) {
      failures.push(`${t('selection.sftp_connection', { name: connectionLabel })} (${itemCountLabel(items.length)}): ${t('selection.connection_not_found')}`);
      updateProgress(t('selection.sftp_unavailable', { name: connectionLabel }));
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
      if (!response.success) throw new Error(response.message || response.error || t('selection.remote_delete_request_failed'));
      completedPaths.push(...items.map(item => item.virtualPath));
      completedGroups.push(`${t('selection.sftp_connection', { name: connectionLabel })} (${itemCountLabel(items.length)})`);
      updateProgress(t('selection.remote_delete_request_completed', { name: connectionLabel }));
    } catch (error) {
      failures.push(`${t('selection.sftp_connection', { name: connectionLabel })} (${itemCountLabel(items.length)}): ${error.message}`);
      updateProgress(t('selection.remote_delete_request_failed', { name: connectionLabel }));
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
      completedGroups.length ? t('selection.accepted_groups', { groups: completedGroups.join('\n- ') }) : t('selection.no_groups_completed'),
      t('selection.failed_groups', { groups: failures.join('\n- ') }),
      completedGroups.length ? t('selection.partial_detail') : '',
    ].filter(Boolean).join('\n\n');
    operation.fail(t('selection.deletion_incomplete'), detail);
    showToast(t("toast.delete_items_failed", { error: failures[0] }), "error");
    return false;
  }

  operation.finish(t('selection.deletion_complete', { count: paths.length }), {
    detail: completedGroups.join(' · '),
  });
  showToast(t("toast.deleted_items", { count: paths.length }), "success");
  return true;
}
