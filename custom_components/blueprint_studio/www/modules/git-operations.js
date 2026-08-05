import { state, elements, gitState, giteaState } from './state.js';
import { fetchWithAuth } from './api.js';
import { eventBus } from './event-bus.js';
import { API_BASE } from './constants.js';
import {
  showToast,
  showConfirmDialog,
  showModal,
  setButtonLoading
} from './ui.js';
import { getGitActionConfirmation } from './git-action-confirmation.js?v=2.5.188';
import { t } from './translations.js';
import { startOperationFeedback } from './feedback-service.js?v=2.5.188';

function startGitOperation(label, icon, message, retry, target = gitState.currentBranch || 'Current branch') {
  return startOperationFeedback({
    label,
    icon,
    message,
    scope: 'GitHub repository',
    target,
    retry,
    openLabel: 'Source Control',
    openIcon: 'account_tree',
    open: () => eventBus.emit('ui:switch-sidebar-view', 'source-control'),
  });
}

function startBranchOperation(label, icon, message, target, retry) {
  return startOperationFeedback({
    label,
    icon,
    message,
    scope: 'Local Git repository',
    target,
    retry,
    openLabel: 'Source Control',
    openIcon: 'account_tree',
    open: () => eventBus.emit('ui:switch-sidebar-view', 'source-control'),
  });
}

function gitFileTarget(files) {
  const paths = Array.from(new Set((files || []).filter(Boolean)));
  if (paths.length === 0) return 'No files';
  if (paths.length === 1) return paths[0];
  return `${paths.length} files, including ${paths[0]}`;
}

/**
 * Check if Git integration is enabled
 */
export function isGitEnabled() {
  return localStorage.getItem("gitIntegrationEnabled") !== "false";
}

/**
 * Check git status if enabled (wrapper for both Git and Gitea)
 */
export async function checkGitStatusIfEnabled(shouldFetch = false, silent = false) {
  if (isGitEnabled()) {
    await gitStatus(shouldFetch, silent);
  }
  if (state.giteaIntegrationEnabled) {
    eventBus.emit('gitea:status-check', { fetch: shouldFetch, silent: silent });
  }
}

/**
 * Get git status from server
 */
export async function gitStatus(shouldFetch = false, silent = false) {
  if (!isGitEnabled()) return false;

  const operation = silent ? null : startGitOperation(
    shouldFetch ? 'Fetch GitHub status' : 'Refresh GitHub status',
    'sync',
    shouldFetch ? 'Fetching remote references and workspace status...' : 'Reading workspace status...',
    () => gitStatus(shouldFetch),
    gitState.currentBranch || 'Workspace',
  );

  try {
    if (!silent) {
      if (elements.btnGitStatus) elements.btnGitStatus.classList.add("pulsing");
    }

    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "git_status",
        fetch: shouldFetch
      }),
    });

    if (!silent) {
      if (elements.btnGitStatus) elements.btnGitStatus.classList.remove("pulsing");
    }

    if (data.success) {
      gitState.lastError = "";
      const currentChangesList = JSON.stringify(data.files);
      const hasMeaningfulChange = state._lastGitChanges && state._lastGitChanges !== currentChangesList;
      state._lastGitChanges = currentChangesList;

      gitState.isInitialized = data.is_initialized;
      gitState.hasRemote = data.has_remote;
      gitState.currentBranch = data.current_branch || "unknown";
      gitState.localBranches = data.local_branches || [];
      gitState.remoteBranches = data.remote_branches || [];
      gitState.ahead = data.ahead || 0;
      gitState.behind = data.behind || 0;
      gitState.status = data.status || "";

      gitState.files = data.files || {
        modified: [], added: [], deleted: [], untracked: [], staged: [], unstaged: [], ignored: []
      };

      gitState.totalChanges = [
        ...gitState.files.modified,
        ...gitState.files.added,
        ...gitState.files.deleted,
        ...gitState.files.untracked
      ].length;

      // If git is in a conflict state, fetch the actual unmerged file list
      const statusLower = typeof gitState.status === "string" ? gitState.status.toLowerCase() : "";
      const isConflicted = statusLower.includes("rebasing") || statusLower.includes("merging") ||
        statusLower.includes("unmerged") || statusLower.includes("conflict");
      if (isConflicted) {
        gitState.conflictFiles = await gitGetConflictFiles();
      } else {
        gitState.conflictFiles = [];
      }

      eventBus.emit('git:refresh');

      if (!silent) {
        if (data.has_changes) {
          showToast(t("toast.git_changes_detected", {count: gitState.totalChanges}), "success");
        } else {
          showToast(t("toast.git_tree_clean"), "success");
        }
      }
      operation?.finish(data.has_changes
        ? `${gitState.totalChanges} workspace ${gitState.totalChanges === 1 ? 'change' : 'changes'}`
        : 'Workspace is clean', {
        detail: `Branch: ${gitState.currentBranch}${shouldFetch ? '\nRemote references fetched.' : ''}`,
      });
      return true;
    } else {
      gitState.lastError = data.message || data.error || "Git status failed";
      eventBus.emit('git:refresh');
      operation?.fail('Could not refresh GitHub status', gitState.lastError);
      if (!silent) showToast(t("toast.git_error", { error: gitState.lastError }), "error");
      return false;
    }
  } catch (error) {
    gitState.lastError = error.message || "Git status failed";
    eventBus.emit('git:refresh');
    operation?.fail('Could not refresh GitHub status', gitState.lastError);
    if (!silent) {
      showToast(t("toast.git_error", { error: error.message }), "error");
    }
    return false;
  } finally {
    if (!silent && elements.btnGitStatus) elements.btnGitStatus.classList.remove("pulsing");
  }
}

/**
 * Initialize a new Git repository
 */
export async function gitInit(skipConfirm = false) {
  if (skipConfirm !== true) {
    const confirmed = await showConfirmDialog({
      title: "Initialize Git Repository?",
      message: "<p><strong>Scope:</strong> Local configuration workspace</p><p>This creates Git metadata for the workspace and sets the initial branch to <strong>main</strong>. Existing files are not changed.</p>",
      confirmText: "Initialize Repository",
      cancelText: t("modal.cancel_button")
    });
    if (!confirmed) return false;
  }

  const operation = startBranchOperation(
    'Initialize Git repository',
    'source',
    'Creating local repository...',
    'Configuration workspace -> main',
    () => gitInit(),
  );
  try {
    showToast(t("toast.git_init_started"), "info");
    operation.update({
      message: 'Creating Git metadata and initial main branch...',
      detail: 'Initializing repository',
      percent: 20,
    });
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_init" }),
    });

    if (data.success) {
      gitState.isInitialized = true;
      operation.finish('Local repository initialized', {
        detail: 'Initial branch: main',
        percent: 100,
      });
      showToast(t("toast.git_init_success"), "success");
      await gitStatus(false, true);
      return true;
    } else {
      const message = data.message || data.error || "Unknown initialization error";
      operation.fail('Could not initialize repository', message);
      showToast(t("toast.git_init_failed") + ": " + message, "error");
    }
  } catch (error) {
    operation.fail('Could not initialize repository', error.message);
    showToast(t("toast.git_init_failed") + ": " + error.message, "error");
  }
  return false;
}

/**
 * Abort current rebase or merge operation
 */
export async function abortGitOperation() {
  const branch = gitState.currentBranch || 'Current branch';
  return confirmAbortGitOperation(branch);
}

async function confirmAbortGitOperation(branch) {
  const confirmed = await showConfirmDialog({
    title: t("gitea.abort_title"),
    message: t("gitea.abort_message"),
    confirmText: t("gitea.abort_confirm"),
    cancelText: t("modal.cancel_button")
  });

  if (!confirmed) return;

  const operation = startBranchOperation(
    'Abort Git operation',
    'cancel',
    'Aborting merge or rebase...',
    branch,
    () => confirmAbortGitOperation(branch),
  );
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_abort" }),
    });
    if (data.success) {
      operation.finish('Merge or rebase aborted');
      showToast(t("toast.git_abort_success"), "success");
      eventBus.emit('ui:reload-files');
      await gitStatus(false, true);
      return true;
    } else {
      const message = data.message || data.error || 'Unknown abort error';
      operation.fail('Could not abort Git operation', message);
      showToast(t("toast.git_abort_fail", { error: message }), "error");
    }
  } catch (e) {
    operation.fail('Could not abort Git operation', e.message);
    showToast(t("toast.git_error", { error: e.message }), "error");
  }
  return false;
}

/**
 * Force push to remote
 */
export async function forcePush() {
  const branch = gitState.currentBranch || 'Current branch';
  return confirmForcePush(branch);
}

async function confirmForcePush(branch) {
  const confirmed = await showConfirmDialog(getGitActionConfirmation('force-push', {
    provider: 'GitHub',
    currentBranch: branch,
  }));

  if (!confirmed) return;

  const operation = startGitOperation(
    'Force push to GitHub',
    'cloud_upload',
    'Replacing the remote branch...',
    () => confirmForcePush(branch),
    `${branch} -> origin/${branch}`,
  );
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_force_push" }),
    });
    if (data.success) {
      operation.finish('Remote branch replaced');
      showToast(t("toast.git_push_success"), "success");
      await gitStatus(true, true);
      return true;
    } else {
      const message = data.message || data.error || 'Unknown force-push error';
      operation.fail('Force push failed', message);
      showToast(t("toast.git_force_push_fail", { error: message }), "error");
    }
  } catch (e) {
    operation.fail('Force push failed', e.message);
    showToast(t("toast.git_error", { error: e.message }), "error");
  }
  return false;
}

/**
 * Hard reset to remote
 */
export async function hardReset() {
  const branch = gitState.currentBranch || 'Current branch';
  return confirmHardReset(branch);
}

async function confirmHardReset(branch) {
  const confirmed = await showConfirmDialog(getGitActionConfirmation('hard-reset', {
    provider: 'GitHub',
    currentBranch: branch,
  }));

  if (!confirmed) return;

  const operation = startGitOperation(
    'Reset from GitHub',
    'restore',
    'Replacing local files from the remote branch...',
    () => confirmHardReset(branch),
    `origin/${branch} -> ${branch}`,
  );
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_hard_reset", branch }),
    });
    if (data.success) {
      operation.finish('Local branch reset from GitHub');
      showToast(t("toast.git_reset_success"), "success");
      eventBus.emit('ui:reload-files');
      await gitStatus(true, true);
      return true;
    } else {
      const message = data.message || data.error || 'Unknown reset error';
      operation.fail('Hard reset failed', message);
      showToast(t("toast.git_reset_fail", { error: message }), "error");
    }
  } catch (e) {
    operation.fail('Hard reset failed', e.message);
    showToast(t("toast.git_error", { error: e.message }), "error");
  }
  return false;
}

/**
 * Delete a remote branch
 */
export async function deleteRemoteBranch(branchName) {
  return confirmDeleteRemoteBranch(branchName);
}

async function confirmDeleteRemoteBranch(branchName) {
  const confirmed = await showConfirmDialog(getGitActionConfirmation('delete-remote-branch', {
    provider: 'GitHub',
    branch: branchName,
  }));

  if (!confirmed) return;

  const operation = startGitOperation(
    'Delete GitHub branch',
    'delete',
    `Deleting origin/${branchName}...`,
    () => confirmDeleteRemoteBranch(branchName),
    `origin/${branchName}`,
  );
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_delete_remote_branch", branch: branchName }),
    });

    if (data.success) {
      operation.finish('Remote branch deleted');
      showToast(data.message || `Branch '${branchName}' deleted from GitHub`, "success");
      await gitStatus(true, true);
      return true;
    }
    const message = data.message || data.error || 'Unknown remote branch deletion error';
    operation.fail('Could not delete remote branch', message);
    await offerDefaultBranchRepair(branchName, message);
  } catch (e) {
    const message = e.message || "Unknown error";
    operation.fail('Could not delete remote branch', message);
    await offerDefaultBranchRepair(branchName, message);
  }
  return false;
}

async function offerDefaultBranchRepair(branchName, message) {
  if (!message.toLowerCase().includes("refusing to delete the current branch")) {
    showToast(t("toast.delete_failed_msg", { error: message }), "error");
    return false;
  }

  const confirmed = await showConfirmDialog(getGitActionConfirmation('change-default-and-delete', {
    provider: 'GitHub',
    branch: branchName,
    defaultBranch: 'main',
  }));
  if (!confirmed) return false;

  const operation = startGitOperation(
    'Change default branch and delete',
    'swap_horiz',
    `Setting main as default before deleting origin/${branchName}...`,
    () => offerDefaultBranchRepair(branchName, "refusing to delete the current branch"),
    `default: ${branchName} -> main; delete origin/${branchName}`,
  );
  let defaultBranchChanged = false;
  try {
    const patchData = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "github_set_default_branch", branch: "main" }),
    });
    if (!patchData.success) {
      const patchMessage = patchData.message || patchData.error || 'Unknown default branch update error';
      operation.fail('Could not change GitHub default branch', patchMessage);
      showToast(t("toast.autofix_failed", { error: patchMessage }), "error");
      return false;
    }

    defaultBranchChanged = true;
    operation.update({ message: `Default branch changed; deleting origin/${branchName}...` });
    const deleteData = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_delete_remote_branch", branch: branchName }),
    });
    if (!deleteData.success) {
      const deleteMessage = deleteData.message || deleteData.error || 'Unknown remote branch deletion error';
      operation.fail('Default changed, but branch deletion failed', deleteMessage);
      showToast(t("toast.autofix_failed", { error: deleteMessage }), "error");
      return false;
    }

    operation.finish('Default branch changed and remote branch deleted');
    showToast(deleteData.message || t("toast.success"), "success");
    await gitStatus(true, true);
    return true;
  } catch (error) {
    operation.fail(
      defaultBranchChanged
        ? 'Default changed, but branch deletion failed'
        : 'Could not change GitHub default branch',
      error.message,
    );
    showToast(t("toast.autofix_failed", { error: error.message }), "error");
    return false;
  }
}

/**
 * Get list of git remotes
 */
export async function gitGetRemotes() {
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_get_remotes" }),
    });
    if (data.success) return data.remotes || {};
  } catch (error) {
    return {};
  }
}

/**
 * Set git credentials
 */
export async function gitSetCredentials(username, token, rememberMe = true) {
  const account = String(username || '').trim() || 'GitHub account';
  const operation = startOperationFeedback({
    label: 'Save GitHub credentials',
    icon: 'key',
    message: 'Saving GitHub credentials...',
    scope: 'GitHub authentication',
    target: account,
    openLabel: 'GitHub Settings',
    openIcon: 'settings',
    open: () => eventBus.emit('git:show-settings'),
  });
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_set_credentials", username, token, remember_me: rememberMe }),
    });
    if (data.success) {
      operation.finish('GitHub credentials saved', {
        detail: rememberMe ? 'Credentials saved for future sessions' : 'Credentials available for this session',
      });
      showToast(t("toast.git_creds_saved"), "success");
      return true;
    }
    const message = data.message || data.error || 'Credential save was rejected';
    operation.fail('Could not save GitHub credentials', message, {
      detail: 'The token was not retained for Retry. Reopen GitHub Settings to try again.',
    });
    showToast("Failed to save GitHub credentials: " + message, "error");
    return false;
  } catch (error) {
    operation.fail('Could not save GitHub credentials', error.message, {
      detail: 'The token was not retained for Retry. Reopen GitHub Settings to try again.',
    });
    showToast("Failed to save GitHub credentials: " + error.message, "error");
    return false;
  }
}

/**
 * Stage files
 */
export async function gitStage(files) {
  if (!files || files.length === 0) return;
  const request = Object.freeze(Array.from(new Set(files)));
  let retry = () => gitStage(request);
  const operation = startBranchOperation(
    `Stage ${request.length} ${request.length === 1 ? 'file' : 'files'}`,
    'add',
    'Updating the Git index...',
    gitFileTarget(request),
    () => retry(),
  );
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_stage", files: request }),
    });

    if (data.success) {
      operation.finish(`${request.length} ${request.length === 1 ? 'file' : 'files'} staged`);
      showToast(data.message, "success");
      await gitStatus(false, true);
      return true;
    } else {
      const errorMsg = data.message || data.error || "Staging failed";
      if (errorMsg.includes("index.lock") || errorMsg.includes("File exists")) {
        retry = () => handleGitLockAndRetry(request);
        operation.fail('Git index is locked', errorMsg, {
          detail: 'Retry can clean stale recovery state and stage the same files.',
        });
        showToast(t("toast.git_lock_fail"), "error", 0, {
          text: t("gitea.clean_locks"),
          callback: retry
        });
      } else {
        operation.fail('Could not stage files', errorMsg);
        showToast(t("toast.git_stage_fail", { error: errorMsg }), "error");
      }
      return false;
    }
  } catch (error) {
    operation.fail('Could not stage files', error.message);
    showToast(t("toast.git_stage_fail", { error: error.message }), "error");
    return false;
  }
}

/**
 * Clean locks and retry staging
 */
export async function handleGitLockAndRetry(files) {
  const request = Object.freeze(Array.from(new Set((files || []).filter(Boolean))));
  if (request.length === 0) return false;
  const branch = gitState.currentBranch || 'Current branch';
  const confirmed = await showConfirmDialog(getGitActionConfirmation('clean-locks', { currentBranch: branch }));
  if (!confirmed) return false;

  let cleanupComplete = false;
  const operation = startBranchOperation(
    'Clean Git state and retry staging',
    'cleaning_services',
    'Cleaning stale Git recovery state...',
    `${branch}; ${gitFileTarget(request)}`,
    () => handleGitLockAndRetry(request),
  );
  try {
    operation.update({ message: 'Cleaning stale Git recovery state...', detail: 'Step 1 of 2', percent: 15 });
    const cleanData = await fetchWithAuth(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'git_clean_locks' }),
    });
    if (!cleanData.success) throw new Error(cleanData.message || cleanData.error || 'Git recovery cleanup failed');
    cleanupComplete = true;

    operation.update({ message: 'Retrying staging...', detail: 'Step 2 of 2', percent: 60 });
    const retryData = await fetchWithAuth(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'git_stage', files: request }),
    });
    if (!retryData.success) throw new Error(retryData.message || retryData.error || 'Staging retry failed');

    operation.finish(`${request.length} ${request.length === 1 ? 'file' : 'files'} staged after cleanup`, {
      detail: cleanData.message || 'Git recovery state cleaned',
      percent: 100,
    });
    showToast(retryData.message, 'success');
    await gitStatus(false, true);
    return true;
  } catch (error) {
    operation.fail(cleanupComplete ? 'Staging still failed after cleanup' : 'Could not clean Git recovery state', error.message, {
      detail: cleanupComplete
        ? 'Git recovery state was removed. The selected files were not staged.'
        : 'No staging retry was attempted.',
    });
    showToast(t("toast.git_lock_fail") + ': ' + error.message, 'error');
    return false;
  }
}

/**
 * Clean Git lock files
 */
export async function gitCleanLocks() {
  const branch = gitState.currentBranch || 'Current branch';
  const confirmed = await showConfirmDialog(getGitActionConfirmation('clean-locks', { currentBranch: branch }));
  if (!confirmed) return false;
  const operation = startBranchOperation(
    'Clean Git recovery state',
    'cleaning_services',
    'Removing stale locks and operation state...',
    `${branch} -> .git recovery metadata`,
    gitCleanLocks,
  );
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_clean_locks" }),
    });
    if (data.success) {
      const removed = Array.isArray(data.removed) ? data.removed : [];
      operation.finish('Git recovery state cleaned', {
        detail: removed.length ? removed.join('\n') : (data.message || 'No stale recovery entries found'),
      });
      showToast(data.message, "success");
      await gitStatus(false, true);
      return true;
    } else {
      const message = data.message || data.error || 'Git recovery cleanup was rejected';
      operation.fail('Could not clean Git recovery state', message);
      showToast(t("toast.github_clean_locks_fail") + ': ' + message, "error");
      return false;
    }
  } catch (error) {
    operation.fail('Could not clean Git recovery state', error.message);
    showToast(t("toast.github_clean_locks_fail") + ": " + error.message, "error");
    return false;
  }
}

/**
 * Repair Git Index
 */
export async function gitRepairIndex() {
  const branch = gitState.currentBranch || 'Current branch';
  const confirmed = await showConfirmDialog(getGitActionConfirmation('repair-index', { currentBranch: branch }));
  if (!confirmed) return false;
  const operation = startBranchOperation(
    'Repair Git index',
    'build',
    'Rebuilding the Git index...',
    `${branch} -> .git/index`,
    gitRepairIndex,
  );
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_repair_index" }),
    });
    if (data.success) {
      operation.finish('Git index repaired');
      showToast(data.message, "success");
      await gitStatus(false, true);
      return true;
    } else {
      const message = data.message || data.error || "Unknown index repair error";
      operation.fail('Could not repair Git index', message);
      showToast(t("toast.github_repair_failed", { error: message }), "error");
      return false;
    }
  } catch (error) {
    operation.fail('Could not repair Git index', error.message);
    showToast(t("toast.github_repair_failed", { error: error.message }), "error");
    return false;
  }
}

/**
 * Unstage files
 */
export async function gitUnstage(files) {
  if (!files || files.length === 0) return;
  const request = Object.freeze(Array.from(new Set(files)));
  const operation = startBranchOperation(
    `Unstage ${request.length} ${request.length === 1 ? 'file' : 'files'}`,
    'remove',
    'Updating the Git index...',
    gitFileTarget(request),
    () => gitUnstage(request),
  );
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_unstage", files: request }),
    });
    if (data.success) {
      operation.finish(`${request.length} ${request.length === 1 ? 'file' : 'files'} unstaged`);
      showToast(data.message, "success");
      await gitStatus(false, true);
      return true;
    }
    const message = data.message || data.error || 'Unstage failed';
    operation.fail('Could not unstage files', message);
    showToast(t("toast.git_unstage_fail", { error: message }), "error");
    return false;
  } catch (error) {
    operation.fail('Could not unstage files', error.message);
    showToast(t("toast.git_unstage_fail", { error: error.message }), "error");
    return false;
  }
}

/**
 * Reset changes to files
 */
export async function gitReset(files) {
  if (!files || files.length === 0) return;
  const request = Object.freeze(Array.from(new Set(files)));
  const confirmed = await showConfirmDialog(getGitActionConfirmation('discard', { files: request }));
  if (!confirmed) return;
  const operation = startBranchOperation(
    `Discard changes in ${request.length} ${request.length === 1 ? 'file' : 'files'}`,
    'undo',
    'Restoring committed content...',
    gitFileTarget(request),
    () => gitReset(request),
  );
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_reset", files: request }),
    });
    if (data.success) {
      operation.finish('Working changes discarded');
      showToast(data.message, "success");
      await gitStatus(false, true);
      return true;
    }
    const message = data.message || data.error || 'Discard failed';
    operation.fail('Could not discard working changes', message);
    showToast(t("toast.git_reset_fail", { error: message }), "error");
    return false;
  } catch (error) {
    operation.fail('Could not discard working changes', error.message);
    showToast(t("toast.git_reset_fail", { error: error.message }), "error");
    return false;
  }
}

/**
 * Commit staged changes
 */
export async function gitCommit(commitMessage) {
  const operation = startGitOperation('Commit staged changes', 'commit', 'Creating local commit...', () => gitCommit(commitMessage));
  try {
    showToast(t("toast.git_commit_started"), "success");
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_commit", commit_message: commitMessage }),
    });
    if (data.success) {
      operation.finish('Commit created');
      showToast(t("toast.git_commit_success"), "success");
      await gitStatus(false, true);
      return true;
    }
    const message = data.message || data.error || 'Commit failed';
    operation.fail('Commit failed', message);
    return false;
  } catch (error) {
    const errorMsg = error.message || "";
    if (errorMsg.includes("lock")) {
      showToast(t("toast.git_lock_fail"), "error", 0, {
        text: t("gitea.clean_locks"),
        callback: async () => { await gitCleanLocks(); }
      });
    } else {
      showToast(t("toast.git_commit_fail", { error: error.message }), "error");
    }
    operation.fail('Commit failed', error.message);
    return false;
  }
}

/**
 * Pull changes from remote
 */
export async function gitPull() {
  const confirmed = await showConfirmDialog({
    title: t("sidebar.git_changes"),
    message: t("gitea.pull_confirm"),
    confirmText: t("toolbar.upload"),
    cancelText: t("modal.cancel_button")
  });
  if (!confirmed) return;
  const operation = startGitOperation('Pull from GitHub', 'cloud_download', 'Downloading remote changes...', gitPull);
  try {
    setButtonLoading(elements.btnGitPull, true);
    showToast(t("toast.git_pull_started"), "success");
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_pull" }),
    });
    setButtonLoading(elements.btnGitPull, false);
    if (data.success) {
      operation.finish('Pull complete');
      showToast(t("toast.git_pull_success"), "success");
      await new Promise(resolve => setTimeout(resolve, 500));
      eventBus.emit('ui:reload-files');
      eventBus.emit('git:status-check');
      if (state.activeTab) eventBus.emit('file:open', { path: state.activeTab.path, forceReload: true });
      return true;
    }
    const message = data.message || data.error || 'Pull failed';
    operation.fail('Pull failed', message);
    showToast(t("toast.gitea_pull_failed", { error: message }), "error");
    return false;
  } catch (error) {
    setButtonLoading(elements.btnGitPull, false);
    showToast(t("toast.gitea_pull_failed", { error: error.message }), "error");
    operation.fail('Pull failed', error.message);
    return false;
  }
}

/**
 * Checkout (switch to) a local branch
 */
export async function gitCheckoutBranch(branch) {
  const sourceBranch = gitState.currentBranch || 'Current branch';
  const operation = startBranchOperation(
    `Switch to ${branch}`,
    'swap_horiz',
    'Checking out branch...',
    `${sourceBranch} -> ${branch}`,
    () => gitCheckoutBranch(branch),
  );
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_checkout_branch", branch }),
    });
    if (data.success) {
      operation.finish(`Switched to ${branch}`);
      eventBus.emit('ui:reload-files');
      await gitStatus(false, true);
      return true;
    } else {
      operation.fail(`Could not switch to ${branch}`, data.message || "Unknown checkout error");
      return false;
    }
  } catch (e) {
    operation.fail(`Could not switch to ${branch}`, e.message);
    return false;
  }
}

/**
 * Create a new branch from current HEAD
 */
export async function gitCreateBranch() {
  const name = await showModal({
    title: "Create New Branch",
    placeholder: "branch-name",
    value: "",
    hint: "Branch will be created from current HEAD and checked out",
  });
  if (!name || !name.trim()) return;
  return runGitCreateBranch(name.trim());
}

async function runGitCreateBranch(name) {
  const sourceBranch = gitState.currentBranch || 'Current HEAD';
  const operation = startBranchOperation(
    `Create ${name}`,
    'add_circle_outline',
    'Creating and checking out branch...',
    `${sourceBranch} -> ${name}`,
    () => runGitCreateBranch(name),
  );
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_create_branch", name, checkout: true }),
    });
    if (data.success) {
      operation.finish(`${name} created and checked out`);
      eventBus.emit('ui:reload-files');
      await gitStatus(false, true);
      return true;
    } else {
      operation.fail(`Could not create ${name}`, data.message || "Unknown branch creation error");
      return false;
    }
  } catch (e) {
    operation.fail(`Could not create ${name}`, e.message);
    return false;
  }
}

/**
 * Delete a local branch
 */
export async function gitDeleteLocalBranch(branch, force = false) {
  const confirmationKind = force ? 'force-delete-local-branch' : 'delete-local-branch';
  const confirmed = await showConfirmDialog(getGitActionConfirmation(confirmationKind, { branch }));
  if (!confirmed) return;
  return runGitDeleteLocalBranch(branch, force);
}

async function runGitDeleteLocalBranch(branch, force = false) {
  const operation = startBranchOperation(
    `${force ? 'Force delete' : 'Delete'} ${branch}`,
    'delete_outline',
    `${force ? 'Force deleting' : 'Deleting'} local branch...`,
    branch,
    () => gitDeleteLocalBranch(branch, force),
  );
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_delete_local_branch", branch, force }),
    });
    if (!force && !data.success && data.message?.includes("not fully merged")) {
      operation.fail(`${branch} is not fully merged`, data.message);
      const forceConfirmed = await showConfirmDialog(getGitActionConfirmation('force-delete-local-branch', { branch }));
      if (forceConfirmed) return runGitDeleteLocalBranch(branch, true);
      return false;
    }
    if (data.success) {
      operation.finish(`${branch} deleted`);
      await gitStatus(false, true);
      return true;
    } else {
      operation.fail(`Could not delete ${branch}`, data.message || "Unknown branch deletion error");
      return false;
    }
  } catch (e) {
    operation.fail(`Could not delete ${branch}`, e.message);
    return false;
  }
}

/**
 * Merge a branch into current branch
 */
export async function gitMergeBranch(branch) {
  const destinationBranch = gitState.currentBranch || 'Current branch';
  const confirmed = await showConfirmDialog(getGitActionConfirmation('merge', {
    branch,
    currentBranch: destinationBranch,
  }));
  if (!confirmed) return;

  const operation = startBranchOperation(
    `Merge ${branch}`,
    'merge',
    `Merging into ${destinationBranch}...`,
    `${branch} -> ${destinationBranch}`,
    () => gitMergeBranch(branch),
  );
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_merge_branch", branch }),
    });
    if (data.success) {
      operation.finish(`${branch} merged into ${destinationBranch}`);
      eventBus.emit('ui:reload-files');
      await gitStatus(false, true);
      return true;
    } else {
      operation.fail(`Could not merge ${branch}`, data.message || "Unknown merge error");
      await gitStatus(false, true);
      return false;
    }
  } catch (e) {
    operation.fail(`Could not merge ${branch}`, e.message);
    return false;
  }
}

/**
 * Resolve a merge conflict (accept ours or theirs)
 */
export async function gitResolveConflict(path, resolution) {
  const targetPath = String(path || 'Unknown file');
  const resolutionLabel = resolution === 'ours' ? 'local version' : resolution === 'theirs' ? 'incoming version' : String(resolution || 'selected version');
  const operation = startBranchOperation(
    `Resolve conflict in ${targetPath.split('/').pop()}`,
    'rule',
    `Accepting ${resolutionLabel}...`,
    `${targetPath} -> ${resolutionLabel}`,
    () => gitResolveConflict(targetPath, resolution),
  );
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_resolve_conflict", path: targetPath, resolution }),
    });
    if (data.success) {
      operation.finish(`Conflict resolved with ${resolutionLabel}`);
      showToast(data.message, "success");
      await gitStatus(false, true);
      return true;
    } else {
      const message = data.message || data.error || "Unknown conflict resolution error";
      operation.fail('Could not resolve conflict', message);
      showToast("Resolve failed: " + message, "error");
      return false;
    }
  } catch (e) {
    operation.fail('Could not resolve conflict', e.message);
    showToast("Resolve failed: " + e.message, "error");
    return false;
  }
}

/**
 * Get conflict files
 */
export async function gitGetConflictFiles() {
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_get_conflict_files" }),
    });
    if (data.success) return data.conflict_files || [];
    return [];
  } catch (e) {
    return [];
  }
}

/**
 * Open the branch manager modal
 */
export async function showBranchManager() {
  if (!gitState.isInitialized) {
    showToast("Git repository not initialized", "warning");
    return;
  }

  // Refresh status silently to get latest branches
  await gitStatus(false, true);

  const allBranches = gitState.localBranches;
  const current = gitState.currentBranch;
  const remote = gitState.remoteBranches;

  const branchRows = allBranches.map(b => {
    const isCurrent = b === current;
    const hasRemote = remote.includes(b);
    return `
      <tr data-branch="${b}" style="border-bottom: 1px solid var(--border-color);">
        <td style="padding: 8px 12px; display: flex; align-items: center; gap: 8px;">
          <span class="git-branch-state-icon ui-icon ui-icon--size-sm ${isCurrent ? 'is-current' : ''} material-icons">
            ${isCurrent ? 'radio_button_checked' : 'radio_button_unchecked'}
          </span>
          <span style="font-weight: ${isCurrent ? '600' : '400'};">${b}</span>
          ${isCurrent ? '<span style="font-size: 10px; padding: 2px 6px; background: var(--success-color); color: white; border-radius: 10px;">current</span>' : ''}
        </td>
        <td style="padding: 8px 12px; color: var(--text-secondary); font-size: 12px;">
          ${hasRemote ? '<span class="ui-icon ui-icon--size-xs ui-icon--align-middle material-icons">cloud</span> remote' : 'local only'}
        </td>
        <td style="padding: 8px 12px; text-align: right;">
          ${!isCurrent ? `
            <button class="btn-branch-checkout" data-branch="${b}" style="padding: 4px 10px; font-size: 12px; background: var(--accent-color); color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 4px;">Switch</button>
            <button class="btn-branch-merge" data-branch="${b}" style="padding: 4px 10px; font-size: 12px; background: transparent; border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer; margin-right: 4px; color: var(--text-primary);">Merge</button>
            <button class="btn-branch-delete" data-branch="${b}" style="padding: 4px 10px; font-size: 12px; background: transparent; border: 1px solid var(--error-color); border-radius: 4px; cursor: pointer; color: var(--error-color);">Delete</button>
          ` : ''}
        </td>
      </tr>
    `;
  }).join('');

  const modalHtml = `
    <div id="branch-manager-modal" style="
      position: fixed; inset: 0; z-index: 10000;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.5);
    ">
      <div style="
        background: var(--bg-primary); border: 1px solid var(--border-color);
        border-radius: 8px; padding: 0; min-width: 520px; max-width: 90vw;
        max-height: 80vh; display: flex; flex-direction: column; overflow: hidden;
      ">
        <div style="
          padding: 16px 20px; border-bottom: 1px solid var(--border-color);
          display: flex; align-items: center; justify-content: space-between;
        ">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="ui-icon ui-icon--tone-accent material-icons">account_tree</span>
            <span style="font-weight: 600; font-size: 15px;">Branch Manager</span>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button id="btn-new-branch" style="
              padding: 6px 14px; background: var(--accent-color); color: white;
              border: none; border-radius: 4px; cursor: pointer; font-size: 13px;
              display: flex; align-items: center; gap: 6px;
            ">
              <span class="ui-icon ui-icon--size-sm material-icons">add</span> New Branch
            </button>
            <button id="btn-branch-manager-close" style="
              background: transparent; border: none; cursor: pointer; padding: 4px;
              color: var(--text-secondary);
            ">
              <span class="ui-icon material-icons">close</span>
            </button>
          </div>
        </div>
        <div style="overflow-y: auto; flex: 1;">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: var(--bg-secondary); font-size: 12px; color: var(--text-secondary);">
                <th style="padding: 8px 12px; text-align: left; font-weight: 600;">Branch</th>
                <th style="padding: 8px 12px; text-align: left; font-weight: 600;">Remote</th>
                <th style="padding: 8px 12px; text-align: right; font-weight: 600;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${branchRows || '<tr><td colspan="3" style="padding: 20px; text-align: center; color: var(--text-secondary);">No branches found</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const modal = document.getElementById('branch-manager-modal');

  const closeModal = () => modal.remove();

  document.getElementById('btn-branch-manager-close').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  document.getElementById('btn-new-branch').addEventListener('click', async () => {
    closeModal();
    await gitCreateBranch();
    await showBranchManager();
  });

  modal.querySelectorAll('.btn-branch-checkout').forEach(btn => {
    btn.addEventListener('click', async () => {
      const branch = btn.dataset.branch;
      closeModal();
      const ok = await gitCheckoutBranch(branch);
      if (ok) await showBranchManager();
    });
  });

  modal.querySelectorAll('.btn-branch-merge').forEach(btn => {
    btn.addEventListener('click', async () => {
      const branch = btn.dataset.branch;
      closeModal();
      await gitMergeBranch(branch);
      await showBranchManager();
    });
  });

  modal.querySelectorAll('.btn-branch-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const branch = btn.dataset.branch;
      closeModal();
      await gitDeleteLocalBranch(branch);
      await showBranchManager();
    });
  });
}

/**
 * Push changes to remote
 */
export async function gitPush() {
  let operation;
  try {
    if (gitState.files.staged.length > 0) {
      const shouldCommit = await showConfirmDialog({
        title: t("sidebar.git_changes"),
        message: t("gitea.pull_confirm"),
        confirmText: t("sidebar.commit"),
        cancelText: t("modal.cancel_button")
      });
      if (shouldCommit) {
        const commitResults = await Promise.all(eventBus.emit('git:commit-staged').filter(Boolean));
        if (commitResults.includes(false)) return false;
      }
    }

    operation = startGitOperation('Push to GitHub', 'cloud_upload', 'Uploading local commits...', gitPush);
    setButtonLoading(elements.btnGitPush, true);
    showToast(t("toast.git_push_started"), "info");

    const pushData = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_push_only" }),
    });

    if (pushData.success) {
      setButtonLoading(elements.btnGitPush, false);
      showToast(t("toast.git_push_success"), "success");
      operation.finish('Push complete');
      await gitStatus(false, true);
      return true;
    }

    const errorMessage = pushData.message || pushData.error || "Unknown error";
    if (errorMessage.includes("uncommitted changes")) {
      setButtonLoading(elements.btnGitPush, false);
      const commitMessage = await showModal({
        title: t("sidebar.commit"),
        placeholder: "Commit message",
        value: "Update configuration via Blueprint Studio",
        hint: errorMessage,
      });
      if (!commitMessage) {
        operation.cancel('Push cancelled before commit');
        return false;
      }
      setButtonLoading(elements.btnGitPush, true);
      showToast(t("toast.git_commit_started"), "info");
      const data = await fetchWithAuth(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "git_push", commit_message: commitMessage }),
      });
      setButtonLoading(elements.btnGitPush, false);
      if (data.success) {
        operation.finish('Commit and push complete');
        showToast(t("toast.git_push_success"), "success");
        await gitStatus(false, true);
        return true;
      } else {
        const message = data.message || data.error || 'Push failed';
        operation.fail('Push failed', message);
        showToast(t("toast.gitea_push_failed", { error: message }), "error");
      }
    } else {
      setButtonLoading(elements.btnGitPush, false);
      operation.fail('Push failed', errorMessage);
      showToast(t("toast.gitea_push_failed", { error: errorMessage }), "error");
    }
    return false;
  } catch (error) {
    setButtonLoading(elements.btnGitPush, false);
    showToast(t("toast.gitea_push_failed", { error: error.message }), "error");
    operation?.fail('Push failed', error.message);
    return false;
  }
}
