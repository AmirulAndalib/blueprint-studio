/** AUTOSAVE.JS | Purpose: Automatic saving of modified files after configurable delay. */
import { state, elements } from './state.js';
import { showToast, setButtonLoading } from './ui.js';
import { eventBus } from './event-bus.js';
import { saveFile } from './file-operations.js';
import { t } from './translations.js';
import { startOperationFeedback } from './feedback-service.js?v=2.5.188';

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
    label: `Save ${requests.length} modified file${requests.length === 1 ? '' : 's'}`,
    icon: 'save_as',
    message: 'Preparing files for save...',
    scope: 'Workspace documents',
    target: [localCount ? `${localCount} local` : '', remoteCount ? `${remoteCount} SFTP` : ''].filter(Boolean).join(' + '),
    retry: () => saveAllFiles(retryRequests),
    open: () => retryRequests[0] && revealSavedPath(retryRequests[0].path),
    openLabel: 'Open file',
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
      message: `Saving file ${index + 1} of ${requests.length}...`,
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
    const details = results.map((result) => `${result.success ? 'Saved' : 'Failed'}: ${result.path}${result.message ? ` - ${result.message}` : ''}`).join('\n');
    operation.fail(`${succeeded} saved, ${failed.length} failed`, details, {
      detail: 'Retry saves only the files that failed in this attempt.',
    });
    showToast(`${succeeded} saved, ${failed.length} failed\n${details}`, "error", 10000);
  } else {
    operation.finish(`${succeeded} file${succeeded === 1 ? '' : 's'} saved`);
    showToast(t("toast.saved_files", { count: succeeded }), "success");
  }
  eventBus.emit('file:save-all-complete', { results });
  return results;
}
