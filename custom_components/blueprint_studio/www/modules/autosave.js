/** AUTOSAVE.JS | Purpose: Automatic saving of modified files after configurable delay. */
import { state, elements } from './state.js';
import { showToast, setButtonLoading } from './ui.js';
import { eventBus } from './event-bus.js';
import { saveFile } from './file-operations.js';
import { t, tp } from './translations.js?v=2.5.270';
import { startOperationFeedback } from './feedback-service.js?v=2.5.270';

// Auto-save timer reference
export let autoSaveTimer = null;

/**
 * Triggers auto-save for the current file
 * Called from handleEditorChange when content changes
 */
export function triggerAutoSave() {
  if (state.autoSave && state.activeTab && state.activeTab.modified) {
    // Clear existing timer
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }

    // Set new timer
    autoSaveTimer = setTimeout(() => {
      // Double-check state before saving
      if (state.autoSave && state.activeTab && state.activeTab.modified) {
        eventBus.emit('file:save-current', { isAutoSave: true });
      }
    }, state.autoSaveDelay);
  } else if (autoSaveTimer) {
    // If auto-save disabled OR not modified, clear any pending timer
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
}

/**
 * Clears the auto-save timer
 */
export function clearAutoSaveTimer() {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
}

/**
 * Saves all modified files
 */
function revealSavedPath(path) {
  eventBus.emit('ui:switch-sidebar-view', String(path).startsWith('sftp://') ? 'sftp' : 'explorer');
  eventBus.emit('file:open', { path });
}

export async function saveAllFiles(requestOverride = null) {
  const requests = Array.isArray(requestOverride)
    ? requestOverride.map(request => ({ path: String(request.path), content: String(request.content ?? '') }))
    : state.openTabs.filter(tab => tab.modified).map(tab => ({ path: tab.path, content: String(tab.content ?? '') }));
  const results = [];
  if (!requests.length) return results;
  let retryRequests = requests;
  const localCount = requests.filter(request => !request.path.startsWith('sftp://')).length;
  const remoteCount = requests.length - localCount;
  const operation = startOperationFeedback({
    label: tp('workspace_ops.save_modified_files', requests.length),
    icon: 'save_as',
    message: t('workspace_ops.save_preparing'),
    scope: t('workspace_ops.documents'),
    target: [localCount ? tp('workspace_ops.local_files', localCount) : '', remoteCount ? tp('workspace_ops.sftp_files', remoteCount) : ''].filter(Boolean).join(' + '),
    retry: () => saveAllFiles(retryRequests),
    open: () => retryRequests[0] && revealSavedPath(retryRequests[0].path),
    openLabel: t('workspace_ops.open_file'),
    openIcon: 'description',
  });

  if (elements.btnSaveAll) {
    setButtonLoading(elements.btnSaveAll, true);
  }

  for (const [index, request] of requests.entries()) {
    const tab = state.openTabs.find(candidate => candidate.path === request.path);
    if (tab) {
      tab.saveState = 'saving';
      tab.saveError = '';
    }
    eventBus.emit('ui:refresh-tabs');
    operation.update({
      message: t('workspace_ops.saving_progress', { current: index + 1, count: requests.length }),
      detail: request.path,
      percent: Math.round(index / requests.length * 100),
    });
    let outcome = null;
    const success = await saveFile(request.path, request.content, {
      silentToast: true,
      silentErrorToast: true,
      silentOperation: true,
      onResult: result => { outcome = result; },
    });
    if (success) {
      if (tab) {
        tab.originalContent = request.content;
        const unchangedSinceRequest = tab.content === request.content;
        tab.modified = !unchangedSinceRequest;
        tab.saveState = unchangedSinceRequest ? 'saved' : '';
        if (unchangedSinceRequest) tab.externalConflict = false;
      }
      results.push({ path: request.path, content: request.content, success: true });
    } else {
      if (tab) {
        tab.saveState = 'failed';
        tab.saveError = outcome?.message || 'Save failed';
      }
      results.push({ path: request.path, content: request.content, success: false, message: outcome?.message || 'Save failed' });
    }
    eventBus.emit('ui:refresh-tabs');
  }

  if (elements.btnSaveAll) {
    setButtonLoading(elements.btnSaveAll, false);
  }

  eventBus.emit('ui:refresh-tabs');
  eventBus.emit('ui:refresh-tree');
  eventBus.emit('ui:update-toolbar-state');

  const failed = results.filter((result) => !result.success);
  const succeeded = results.length - failed.length;
  if (failed.length) {
    retryRequests = failed.map(result => ({ path: result.path, content: result.content }));
    const details = results.map((result) => `${result.success ? t('workspace_ops.saved') : t('workspace_ops.failed')}: ${result.path}${result.message ? ` - ${result.message}` : ''}`).join('\n');
    operation.fail(t('workspace_ops.save_partial', { saved: succeeded, failed: failed.length }), details, {
      detail: t('workspace_ops.save_retry_detail'),
    });
    showToast(t('toast.save_batch_failed', { saved: succeeded, failed: failed.length, details }), "error", 10000);
  } else {
    operation.finish(tp('workspace_ops.files_saved', succeeded));
    showToast(t("toast.saved_files", { count: succeeded }), "success");
  }
  eventBus.emit('file:save-all-complete', { results });
  return results;
}
