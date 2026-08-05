/** GITEA-INTEGRATION.JS | Purpose: * Handles Gitea self-hosted Git service operations: repository creation, */

import { state, elements, giteaState } from './state.js';
import { fetchWithAuth } from './api.js';
import { eventBus } from './event-bus.js';
import { API_BASE } from './constants.js';
import {
  activateSharedModal,
  deactivateSharedModal,
  showToast,
  resetModalToDefault,
  showConfirmDialog,
  showModal
} from './ui.js';
import { formatBytes } from './utils.js';
import { t } from './translations.js';
import {
  gitStatus,
  gitInit,
  gitStage,
  gitUnstage,
  gitGetRemotes,
  gitCleanLocks,
  gitGetConflictFiles
} from './git-operations.js';
import {
  updateGiteaPanel as updateGiteaPanelUI,
  renderGiteaFiles as renderGiteaFilesImpl,
  toggleGiteaFileSelection as toggleGiteaFileSelectionImpl,
  stageSelectedGiteaFiles as stageSelectedGiteaFilesImpl,
  stageAllGiteaFiles as stageAllGiteaFilesImpl,
  unstageAllGiteaFiles as unstageAllGiteaFilesImpl
} from './gitea-ui.js?v=2.5.188';
import {
  clearCommitMessage,
  getCommitMessage,
  updateCommitComposer,
} from './source-control-view.js?v=2.5.188';
import { setButtonLoading } from './ui.js';
import { getGitActionConfirmation } from './git-action-confirmation.js?v=2.5.188';
import { startOperationFeedback } from './feedback-service.js?v=2.5.188';

function startGiteaOperation(label, icon, message, retry, target = giteaState.currentBranch || 'Current branch') {
  return startOperationFeedback({
    label,
    icon,
    message,
    scope: 'Gitea repository',
    target,
    retry,
    openLabel: 'Source Control',
    openIcon: 'account_tree',
    open: () => eventBus.emit('ui:switch-sidebar-view', 'source-control'),
  });
}

function giteaEndpointLabel(url) {
  try {
    const parsed = new URL(String(url));
    return `${parsed.host}${parsed.pathname}`.replace(/\/$/, '') || 'Gitea endpoint';
  } catch (_error) {
    return 'Gitea endpoint';
  }
}

// ============================================
// Gitea Repository Initialization
// ============================================

export async function giteaInit(skipConfirm = false) {
  const initialized = await gitInit(skipConfirm);
  if (!initialized) return false;

  giteaState.isInitialized = true;
  await giteaStatus(false, true);
  return true;
}

// ============================================
// Gitea Push Operation
// ============================================

export async function giteaPush() {
  let operation;
  try {
    operation = startGiteaOperation('Push to Gitea', 'cloud_upload', 'Uploading local commits...', giteaPush);
    setButtonLoading(elements.btnGiteaPush, true);
    showToast(t("toast.git_push_started"), "info");

    const pushData = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "gitea_push_only" }),
    });

    if (pushData.success) {
      setButtonLoading(elements.btnGiteaPush, false);
      showToast(t("toast.git_push_success"), "success");
      operation.finish('Push complete');
      await giteaStatus(false, true);
      return true;
    }

    const errorMessage = pushData.message || pushData.error || "Unknown error";

    if (errorMessage.includes("uncommitted changes")) {
      setButtonLoading(elements.btnGiteaPush, false);
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

      setButtonLoading(elements.btnGiteaPush, true);
      showToast(t("toast.git_commit_started"), "info");

      const data = await fetchWithAuth(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "gitea_push",
          commit_message: commitMessage,
        }),
      });

      setButtonLoading(elements.btnGiteaPush, false);

      if (data.success) {
        operation.finish('Commit and push complete');
        showToast(t("toast.git_push_success"), "success");
        await giteaStatus(false, true);
        return true;
      } else {
        const message = data.message || data.error || 'Push failed';
        operation.fail('Push failed', message);
        showToast(t("toast.gitea_push_failed", { error: message }), "error");
      }
    } else if (errorMessage.includes("No commits to push")) {
      setButtonLoading(elements.btnGiteaPush, false);
      showToast(t("toast.gitea_no_commits"), "warning");
      operation.finish('No commits to push', { icon: 'info' });
      return true;
    } else {
      setButtonLoading(elements.btnGiteaPush, false);
      showToast(t("toast.gitea_push_failed", { error: errorMessage }), "error");
      operation.fail('Push failed', errorMessage);
    }
    return false;
  } catch (error) {
    setButtonLoading(elements.btnGiteaPush, false);
    showToast(t("toast.gitea_push_failed", { error: error.message }), "error");
    operation?.fail('Push failed', error.message);
    return false;
  }
}

// ============================================
// Gitea Pull Operation
// ============================================

export async function giteaPull() {
  const confirmed = await showConfirmDialog({
    title: t("sidebar.gitea_changes"),
    message: t("gitea.pull_confirm"),
    confirmText: t("toolbar.upload"),
    cancelText: t("modal.cancel_button")
  });

  if (!confirmed) return;

  const operation = startGiteaOperation('Pull from Gitea', 'cloud_download', 'Downloading remote changes...', giteaPull);

  try {
    setButtonLoading(elements.btnGiteaPull, true);
    showToast(t("toast.git_pull_started"), "info");

    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "gitea_pull" }),
    });

    setButtonLoading(elements.btnGiteaPull, false);

    if (data.success) {
      operation.finish('Pull complete');
      showToast(t("toast.git_pull_success"), "success");
      eventBus.emit('ui:reload-files');
      await giteaStatus(false, true);
      if (state.activeTab) {
        eventBus.emit('file:open', { path: state.activeTab.path, forceReload: true });
      }
      return true;
    }
    const message = data.message || data.error || 'Pull failed';
    operation.fail('Pull failed', message);
    showToast(t("toast.gitea_pull_failed", { error: message }), "error");
    return false;
  } catch (error) {
    setButtonLoading(elements.btnGiteaPull, false);
    showToast(t("toast.gitea_pull_failed", { error: error.message }), "error");
    operation.fail('Pull failed', error.message);
    return false;
  }
}

// ============================================
// Gitea Commit Operation
// ============================================

export async function giteaCommit() {
  const stagedCount = giteaState.files.staged.length;
  if (stagedCount === 0) return;

  const commitMessage = getCommitMessage('gitea');
  if (!commitMessage) return;

  const operation = startGiteaOperation('Commit staged changes', 'commit', 'Creating local commit...', giteaCommit);

  try {
    showToast(t("toast.git_commit_started"), "info");
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_commit", commit_message: commitMessage }),
    });

    if (data.success) {
      operation.finish('Commit created');
      showToast(t("toast.git_commit_success"), "success");
      clearCommitMessage('gitea');
      await giteaStatus(false, true);
      updateCommitComposer('gitea', giteaState);
      return true;
    }
    const message = data.message || data.error || 'Commit failed';
    operation.fail('Commit failed', message);
    return false;
  } catch (error) {
    showToast(t("toast.gitea_commit_failed", { error: error.message }), "error");
    operation.fail('Commit failed', error.message);
    return false;
  }
}

// ============================================
// Gitea Stage/Unstage Operations
// ============================================

export async function giteaStage(files) {
  // Reuse gitStage but refresh gitea status
  await gitStage(files);
  await giteaStatus(false, true);
}

export async function giteaUnstage(files) {
  await gitUnstage(files);
  await giteaStatus(false, true);
}

// ============================================
// Gitea File Selection
// ============================================

export function toggleGiteaFileSelection(file) {
  return toggleGiteaFileSelectionImpl(file);
}

export async function stageSelectedGiteaFiles() {
  return await stageSelectedGiteaFilesImpl();
}

export async function stageAllGiteaFiles() {
  return await stageAllGiteaFilesImpl();
}

export async function unstageAllGiteaFiles() {
  return await unstageAllGiteaFilesImpl();
}

// ============================================
// Gitea Abort Operation
// ============================================

export async function giteaAbort() {
  const branch = giteaState.currentBranch || 'Current branch';
  const confirmed = await showConfirmDialog({
    title: t("gitea.abort_title"),
    message: t("gitea.abort_message"),
    confirmText: t("gitea.abort_confirm"),
    cancelText: t("modal.cancel_button"),
    isDanger: true
  });

  if (!confirmed) return false;

  const operation = startGiteaOperation(
    'Abort Gitea Git operation',
    'cancel',
    'Aborting merge or rebase...',
    giteaAbort,
    branch,
  );
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_abort" }),
    });
    if (!data.success) {
      const message = data.message || data.error || 'Unknown abort error';
      operation.fail('Could not abort Gitea Git operation', message);
      showToast(t("toast.gitea_abort_failed", { error: message }), "error");
      return false;
    }
    operation.finish('Merge or rebase aborted');
    showToast(t("toast.gitea_abort_success"), "success");
    await giteaStatus(false, true);
    return true;
  } catch (error) {
    operation.fail('Could not abort Gitea Git operation', error.message);
    showToast(t("toast.gitea_abort_failed", { error: error.message }), "error");
    return false;
  }
}

// ============================================
// Gitea Force Push Operation
// ============================================

export async function giteaForcePush() {
  const branch = giteaState.currentBranch || 'Current branch';
  const confirmed = await showConfirmDialog(getGitActionConfirmation('force-push', {
    provider: 'Gitea',
    currentBranch: branch,
  }));

  if (!confirmed) return false;

  const operation = startGiteaOperation(
    'Force push to Gitea',
    'cloud_upload',
    'Replacing the remote branch...',
    giteaForcePush,
    `${branch} -> gitea/${branch}`,
  );
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_force_push", remote: "gitea" }),
    });
    if (!data.success) {
      const message = data.message || data.error || 'Unknown force-push error';
      operation.fail('Force push to Gitea failed', message);
      showToast(t("toast.gitea_push_failed", { error: message }), "error");
      return false;
    }
    operation.finish('Gitea branch replaced');
    showToast(t("toast.git_push_success"), "success");
    await giteaStatus(false, true);
    return true;
  } catch (error) {
    operation.fail('Force push to Gitea failed', error.message);
    showToast(t("toast.gitea_push_failed", { error: error.message }), "error");
    return false;
  }
}

// ============================================
// Gitea Hard Reset Operation
// ============================================

export async function giteaHardReset() {
  const branch = giteaState.currentBranch || 'Current branch';
  const confirmed = await showConfirmDialog(getGitActionConfirmation('hard-reset', {
    provider: 'Gitea',
    currentBranch: branch,
  }));

  if (!confirmed) return false;

  const operation = startGiteaOperation(
    'Reset from Gitea',
    'restore',
    'Replacing local files from the remote branch...',
    giteaHardReset,
    `gitea/${branch} -> ${branch}`,
  );
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_hard_reset", remote: "gitea", branch }),
    });
    if (!data.success) {
      const message = data.message || data.error || 'Unknown hard-reset error';
      operation.fail('Reset from Gitea failed', message);
      showToast(t("toast.gitea_error", { error: message }), "error");
      return false;
    }
    operation.finish('Local branch reset from Gitea');
    showToast(t("toast.git_reset_success"), "success");
    eventBus.emit('ui:reload-files');
    await giteaStatus(false, true);
    return true;
  } catch (error) {
    operation.fail('Reset from Gitea failed', error.message);
    showToast(t("toast.gitea_error", { error: error.message }), "error");
    return false;
  }
}

// ============================================
// Gitea Settings Modal
// ============================================

export async function giteaAddRemote(url) {
  const remoteUrl = String(url || '');
  const operation = startOperationFeedback({
    label: 'Configure Gitea remote',
    icon: 'cloud_sync',
    message: 'Saving Gitea remote...',
    scope: 'Local Git repository',
    target: `gitea -> ${giteaEndpointLabel(remoteUrl)}`,
    retry: () => giteaAddRemote(remoteUrl),
    openLabel: 'Source Control',
    openIcon: 'account_tree',
    open: () => eventBus.emit('ui:switch-sidebar-view', 'source-control'),
  });
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'gitea_add_remote', url: remoteUrl }),
    });
    if (!data.success) throw new Error(data.message || data.error || 'Gitea remote configuration failed');
    operation.finish('Gitea remote configured');
    try {
      const parsed = new URL(remoteUrl);
      localStorage.setItem('giteaServerUrl', `${parsed.protocol}//${parsed.host}`);
    } catch (_error) {}
    showToast(t("toast.git_remote_saved"), 'success');
    await giteaStatus(false, true);
    return true;
  } catch (error) {
    operation.fail('Could not configure Gitea remote', error.message);
    showToast(t("toast.gitea_error", { error: error.message }), 'error');
    return false;
  }
}

export async function giteaRemoveRemote(name) {
  const remoteName = String(name || 'gitea');
  const confirmed = await showConfirmDialog({
    title: t("gitea.remove_remote_title"),
    message: t("gitea.remove_remote_message", { name: remoteName }),
    confirmText: t("modal.delete_button"),
    cancelText: t("modal.cancel_button"),
    isDanger: true,
  });
  if (!confirmed) return false;
  const operation = startOperationFeedback({
    label: `Remove ${remoteName} remote`,
    icon: 'link_off',
    message: 'Removing local remote...',
    scope: 'Local Git repository',
    target: remoteName,
    retry: () => giteaRemoveRemote(remoteName),
    openLabel: 'Source Control',
    openIcon: 'account_tree',
    open: () => eventBus.emit('ui:switch-sidebar-view', 'source-control'),
  });
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'git_remove_remote', name: remoteName }),
    });
    if (!data.success) throw new Error(data.message || data.error || 'Remote removal failed');
    operation.finish(`${remoteName} remote removed`);
    showToast(data.message, 'success');
    await giteaStatus(false, true);
    return true;
  } catch (error) {
    operation.fail(`Could not remove ${remoteName} remote`, error.message);
    showToast(t("gitea.remove_remote_error", { error: error.message }), 'error');
    return false;
  }
}

export async function giteaSaveCredentials(username, token, rememberMe = true) {
  const account = String(username || '').trim() || 'Gitea account';
  const server = giteaEndpointLabel(localStorage.getItem('giteaServerUrl') || '');
  const operation = startOperationFeedback({
    label: 'Save Gitea credentials',
    icon: 'key',
    message: 'Saving Gitea credentials...',
    scope: 'Gitea authentication',
    target: `${account} -> ${server}`,
    openLabel: 'Gitea Settings',
    openIcon: 'settings',
    open: () => eventBus.emit('git:show-gitea-settings'),
  });
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'gitea_set_credentials', username: account, token, remember_me: rememberMe }),
    });
    if (!data.success) throw new Error(data.message || data.error || 'Credential save was rejected');
    operation.finish('Gitea credentials saved', {
      detail: rememberMe ? 'Credentials saved for future sessions' : 'Credentials available for this session',
    });
    showToast(t("toast.git_creds_saved"), 'success');
    return true;
  } catch (error) {
    operation.fail('Could not save Gitea credentials', error.message, {
      detail: 'The token was not retained for Retry. Reopen Gitea Settings to try again.',
    });
    showToast(t("toast.gitea_error", { error: error.message }), 'error');
    return false;
  }
}

export async function giteaClearCredentials() {
  const confirmed = await showConfirmDialog({
    title: 'Sign Out from Gitea?',
    message: 'Saved Gitea credentials will be removed. Repository files, commits, and remotes are unchanged.',
    confirmText: 'Sign Out',
    cancelText: t("modal.cancel_button"),
    isDanger: true,
  });
  if (!confirmed) return false;
  const operation = startOperationFeedback({
    label: 'Sign out from Gitea',
    icon: 'logout',
    message: 'Removing saved Gitea credentials...',
    scope: 'Gitea authentication',
    target: giteaEndpointLabel(localStorage.getItem('giteaServerUrl') || ''),
    retry: giteaClearCredentials,
    openLabel: 'Gitea Settings',
    openIcon: 'settings',
    open: () => eventBus.emit('git:show-gitea-settings'),
  });
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'gitea_clear_credentials' }),
    });
    if (!data.success) throw new Error(data.message || data.error || 'Credential removal was rejected');
    operation.finish('Signed out from Gitea');
    showToast(t("toast.git_signout"), 'success');
    return true;
  } catch (error) {
    operation.fail('Could not sign out from Gitea', error.message);
    showToast(t("toast.gitea_error", { error: error.message }), 'error');
    return false;
  }
}

export async function giteaTestConnection() {
  const operation = startOperationFeedback({
    label: 'Test Gitea connection',
    icon: 'network_check',
    message: 'Contacting Gitea remote...',
    scope: 'Gitea remote',
    target: `gitea -> ${giteaEndpointLabel(localStorage.getItem('giteaServerUrl') || '')}`,
    retry: giteaTestConnection,
    openLabel: 'Gitea Settings',
    openIcon: 'settings',
    open: () => eventBus.emit('git:show-gitea-settings'),
  });
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'gitea_test_connection' }),
    });
    if (!data.success) throw new Error(data.message || data.error || 'Connection test was rejected');
    operation.finish('Gitea connection verified');
    showToast(t("toast.git_conn_success"), 'success');
    return true;
  } catch (error) {
    operation.fail('Gitea connection failed', error.message);
    showToast(t("toast.git_conn_failed") + ': ' + error.message, 'error');
    return false;
  }
}

export async function showGiteaSettings() {
  // Get current remotes
  const remotes = await gitGetRemotes();
  const giteaRemote = remotes["gitea"] || "";

  // Get saved credentials
  const credentialsData = await fetchWithAuth(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "gitea_get_credentials" }),
  });

  const savedUsername = credentialsData.has_credentials ? credentialsData.username : "";
  const hasCredentials = credentialsData.has_credentials;

  // Get saved Gitea server URL from localStorage
  const savedGiteaUrl = localStorage.getItem("giteaServerUrl") || "";

  const modalOverlay = document.getElementById("modal-overlay");
  const modal = document.getElementById("modal");
  const modalTitle = document.getElementById("modal-title");
  const modalBody = document.getElementById("modal-body");
  const modalFooter = document.querySelector(".modal-footer");

  modalTitle.textContent = "Gitea " + t("toolbar.settings");

  let remotesHtml = "";
  if (Object.keys(remotes).length > 0) {
    remotesHtml = `<div class="git-settings-section"><div class="git-settings-label">${t("gitea.remotes_title")}</div>`;
    for (const [name, url] of Object.entries(remotes)) {
      remotesHtml += `
        <div class="git-remote-item">
          <div style="flex: 1; min-width: 0;">
              <span class="git-remote-name">${name}</span>
              <span class="git-remote-url">${url}</span>
          </div>
          <button class="btn-icon-only remove-remote-btn" data-remote-name="${name}" title="${t("gitea.remove_remote_title")}" style="background: transparent; border: none; cursor: pointer; color: var(--text-secondary); padding: 4px;">
              <span class="ui-icon ui-icon--size-action material-icons">delete</span>
          </button>
        </div>
      `;
    }
    remotesHtml += '</div>';
  }

  let credentialsStatusHtml = "";
  if (hasCredentials) {
    credentialsStatusHtml = `
      <div class="git-settings-info" style="color: #4caf50; margin-bottom: 12px;">
        <span class="ui-icon material-icons">check_circle</span>
        <span>${t("gitea.logged_in_as", { username: savedUsername })}</span>
      </div>
      <button id="btn-gitea-signout" style="width: 100%; padding: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; background: #f44336; color: white; border: none; border-radius: 4px; font-size: 14px; cursor: pointer; transition: background 0.15s;">
        <span class="ui-icon material-icons">logout</span>
        <span>${t("toast.git_signout")}</span>
      </button>
    `;
  }

  modalBody.innerHTML = `
    <div class="git-settings-content">
      ${remotesHtml}

      <div class="git-settings-section">
        <div class="git-settings-label">${t("gitea.repo_url")}</div>
        <input type="text" class="git-settings-input" id="gitea-repo-url"
               placeholder="https://gitea.example.com/user/repo.git"
               value="${giteaRemote}"
               autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
        <div class="git-settings-buttons">
          <button class="btn-primary" id="btn-save-gitea-remote" style="width: 100%;">${t("modal.confirm_button")}</button>
        </div>
      </div>

      <div class="git-settings-section">
        <div class="git-settings-label">
          <span class="ui-icon ui-icon--tone-gitea ui-icon--align-middle ui-icon--space-after-8 material-icons">emoji_food_beverage</span>
          ${t("gitea.auth_title")}
        </div>

        ${credentialsStatusHtml}

        <input type="text" class="git-settings-input" id="gitea-username"
               placeholder="${t("gitea.username")}"
               value="${savedUsername}"
               autocomplete="username" autocorrect="off" autocapitalize="off" spellcheck="false"
               style="margin-bottom: 8px;" />
        <input type="password" class="git-settings-input" id="gitea-token"
               placeholder="${hasCredentials ? t("gitea.token_update") : t("gitea.token_placeholder")}"
               autocomplete="off"
               style="margin-bottom: 12px;" />

        <div class="git-settings-buttons">
          <button class="btn-secondary" id="btn-test-gitea-connection">${t("modal.confirm")}</button>
          <button class="btn-primary" id="btn-save-gitea-credentials">${t("modal.confirm_button")}</button>
        </div>
      </div>

      <div class="git-settings-section">
        <div class="git-settings-label">
          <span class="ui-icon ui-icon--tone-gitea ui-icon--align-middle ui-icon--space-after-8 material-icons">add_box</span>
          ${t("modal.new_folder_title")}
        </div>
        <input type="text" class="git-settings-input" id="gitea-new-repo-name"
               placeholder="${t("sidebar.explorer")}"
               autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
               style="margin-bottom: 8px;" />
        <input type="text" class="git-settings-input" id="gitea-new-repo-description"
               placeholder="${t("sidebar.search")}"
               autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
               style="margin-bottom: 8px;" />
        <input type="text" class="git-settings-input" id="gitea-server-url"
               placeholder="${t("gitea.server_url")}"
               value="${savedGiteaUrl}"
               autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
               style="margin-bottom: 8px;" />
        <div class="git-settings-checkbox" style="margin-bottom: 12px;">
          <input type="checkbox" id="gitea-repo-private" checked>
          <label for="gitea-repo-private">${t("gitea.private_repo")}</label>
        </div>
        <button class="btn-primary" id="btn-create-gitea-repo" style="width: 100%;">
          <span class="ui-icon ui-icon--align-middle ui-icon--space-after-8 material-icons">add</span>
          ${t("modal.confirm_button")}
        </button>
      </div>

      <div class="git-settings-section">
        <div class="git-settings-label">${t("settings.advanced.experimental")}</div>
        <button class="btn-secondary" id="btn-clean-git-locks" style="width: 100%;">
          <span class="ui-icon ui-icon--align-middle ui-icon--space-after-8 material-icons">delete_sweep</span>
          ${t("gitea.clean_locks")}
        </button>
      </div>
    </div>
  `;

  activateSharedModal({ initialFocus: () => modalBody.querySelector('input, select, button') });

  // Set wider modal for Gitea Settings (responsive on mobile via CSS)
  modal.style.maxWidth = "650px";

  // Hide default modal buttons
  if (modalFooter) {
    modalFooter.style.display = "none";
  }

  // Function to clean up and close the Gitea Settings modal
  const closeGiteaSettings = () => {
    deactivateSharedModal();
    resetModalToDefault();
    modalOverlay.removeEventListener("click", overlayClickHandler);
  };

  // Overlay click handler (defined separately so we can remove it)
  const overlayClickHandler = (e) => {
    if (e.target === modalOverlay) {
      closeGiteaSettings();
    }
  };
  modalOverlay.addEventListener("click", overlayClickHandler);
  document.getElementById("modal-close").onclick = closeGiteaSettings;

  // Add event listeners for delete remote buttons
  const removeRemoteBtns = modalBody.querySelectorAll('.remove-remote-btn');
  removeRemoteBtns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const remoteName = e.currentTarget.dataset.remoteName;
      const removed = await giteaRemoveRemote(remoteName);
      if (removed) setTimeout(() => showGiteaSettings(), 300);
    });
  });

  document.getElementById("btn-save-gitea-remote")?.addEventListener("click", async () => {
    const url = document.getElementById("gitea-repo-url").value;
    if (!url) return showToast(t("toast.gitea_url_required"), "error");

    await giteaAddRemote(url);
  });

  document.getElementById("btn-save-gitea-credentials")?.addEventListener("click", async () => {
    const username = document.getElementById("gitea-username").value;
    const token = document.getElementById("gitea-token").value;
    if (!username) return showToast(t("gitea.username") + " " + t("toast.validation_error"), "error");
    if (!token && !hasCredentials) return showToast(t("gitea.token_placeholder") + " " + t("toast.validation_error"), "error");

    const saved = await giteaSaveCredentials(username, token);
    if (saved) closeGiteaSettings();
  });

  document.getElementById("btn-gitea-signout")?.addEventListener("click", async () => {
    const signedOut = await giteaClearCredentials();
    if (signedOut) closeGiteaSettings();
  });

  document.getElementById("btn-test-gitea-connection")?.addEventListener("click", async () => {
    await giteaTestConnection();
  });

  document.getElementById("btn-create-gitea-repo")?.addEventListener("click", async () => {
    const repoName = document.getElementById("gitea-new-repo-name")?.value.trim();
    const description = document.getElementById("gitea-new-repo-description")?.value.trim();
    const giteaUrl = document.getElementById("gitea-server-url")?.value.trim();
    const isPrivate = document.getElementById("gitea-repo-private")?.checked;

    if (!repoName) {
      showToast(t("toast.file_name_required"), "error");
      return;
    }

    if (!giteaUrl) {
      showToast(t("toast.gitea_url_required"), "error");
      return;
    }

    const result = await giteaCreateRepo(repoName, description, isPrivate, giteaUrl);

    if (result && result.success) {
      // Save the Gitea server URL for future use
      localStorage.setItem("giteaServerUrl", giteaUrl);

      // Clear the form
      document.getElementById("gitea-new-repo-name").value = "";
      document.getElementById("gitea-new-repo-description").value = "";

      // Refresh the modal to show the new remote
      setTimeout(() => {
        closeGiteaSettings();
        showGiteaSettings();
      }, 2000);
    }
  });

  document.getElementById("btn-clean-git-locks")?.addEventListener("click", async () => {
    await gitCleanLocks();
  });
}

// ============================================
// Gitea Repository Creation
// ============================================

export async function giteaCreateRepo(repoName, description, isPrivate, giteaUrl) {
  const request = Object.freeze({
    repoName: String(repoName || '').trim(),
    description: String(description || ''),
    isPrivate: Boolean(isPrivate),
    giteaUrl: String(giteaUrl || '').trim(),
  });
  let serverLabel = 'Gitea server';
  try {
    serverLabel = `Gitea ${new URL(request.giteaUrl).host}`;
  } catch (_error) {
    // The backend owns URL validation; keep invalid input out of the visible scope.
  }
  const visibility = request.isPrivate ? 'Private' : 'Public';
  const operation = startOperationFeedback({
    label: 'Create Gitea repository',
    icon: 'add_circle',
    message: 'Creating remote repository...',
    scope: serverLabel,
    target: `${request.repoName} (${visibility})`,
    retry: () => giteaCreateRepo(
      request.repoName,
      request.description,
      request.isPrivate,
      request.giteaUrl,
    ),
    openLabel: 'Source Control',
    openIcon: 'account_tree',
    open: () => eventBus.emit('ui:switch-sidebar-view', 'source-control'),
  });

  try {
    if (!request.giteaUrl) {
      operation.fail('Repository creation failed', 'A Gitea server URL is required.');
      showToast(t("toast.gitea_url_required"), "error");
      return null;
    }

    showToast(t("toast.gitea_creating_repo"), "info");
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "gitea_create_repo",
        repo_name: request.repoName,
        description: request.description,
        is_private: request.isPrivate,
        gitea_url: request.giteaUrl
      }),
    });

    if (data.success) {
      operation.finish('Repository created');
      showToast(data.message, "success");

      // Show link to new repo
      if (data.html_url) {
        setTimeout(() => {
          showToast(
            t("gitea.view_repo", { url: data.html_url }),
            "success",
            10000  // Show for 10 seconds
          );
        }, 2000);
      }

      return data;
    } else {
      const message = data.message || data.error || "Unknown error";
      operation.fail('Repository creation failed', message);
      showToast(t("toast.gitea_create_repo_failed", { error: message }), "error");
      return null;
    }
  } catch (error) {
    operation.fail('Repository creation failed', error.message);
    showToast(t("toast.gitea_create_repo_failed", { error: error.message }), "error");
    return null;
  }
}

// ============================================
// Gitea Status Check
// ============================================

export async function giteaStatus(shouldFetch = false, silent = false) {
  if (!state.giteaIntegrationEnabled) return false;

  const operation = silent ? null : startOperationFeedback({
    label: shouldFetch ? 'Fetch Gitea status' : 'Refresh Gitea status',
    icon: 'sync',
    scope: 'Gitea repository',
    target: giteaState.currentBranch || 'Workspace',
    message: shouldFetch ? 'Fetching remote references and workspace status...' : 'Reading workspace status...',
    retry: () => giteaStatus(shouldFetch),
    openLabel: 'Source Control',
    openIcon: 'account_tree',
    open: () => eventBus.emit('ui:switch-sidebar-view', 'source-control'),
  });

  try {
    if (!silent) {
      if (elements.btnGiteaStatus) elements.btnGiteaStatus.classList.add("pulsing");
    }

    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "gitea_status",
        fetch: shouldFetch
      }),
    });

    if (!silent) {
      if (elements.btnGiteaStatus) elements.btnGiteaStatus.classList.remove("pulsing");
    }

    if (data.success) {
      giteaState.lastError = "";
      // Store previous change list string to check for meaningful changes
      const currentChangesList = JSON.stringify(data.files);
      const hasMeaningfulChange = state._lastGiteaChanges && state._lastGiteaChanges !== currentChangesList;
      state._lastGiteaChanges = currentChangesList;

      giteaState.isInitialized = data.is_initialized;
      giteaState.hasRemote = data.has_remote;
      giteaState.currentBranch = data.current_branch || "unknown";
      giteaState.localBranches = data.local_branches || [];
      giteaState.remoteBranches = data.remote_branches || [];
      giteaState.ahead = data.ahead || 0;
      giteaState.behind = data.behind || 0;
      giteaState.status = data.status || "";

      giteaState.files = data.files || {
        modified: [],
        added: [],
        deleted: [],
        untracked: [],
        staged: [],
        unstaged: [],
        ignored: []
      };

      giteaState.totalChanges = [
        ...giteaState.files.modified,
        ...giteaState.files.added,
        ...giteaState.files.deleted,
        ...giteaState.files.untracked
      ].length;

      // If git is in a conflict state, fetch the actual unmerged file list
      const statusLower = typeof giteaState.status === "string" ? giteaState.status.toLowerCase() : "";
      const isConflicted = statusLower.includes("rebasing") || statusLower.includes("merging") ||
        statusLower.includes("unmerged") || statusLower.includes("conflict");
      if (isConflicted) {
        giteaState.conflictFiles = await gitGetConflictFiles();
      } else {
        giteaState.conflictFiles = [];
      }

      eventBus.emit('git:refresh');

      if (!silent) {
        if (data.has_changes) {
          showToast(t("toast.gitea_changes_detected", { count: giteaState.totalChanges }), "success");
        } else {
          showToast(t("toast.gitea_tree_clean"), "success");
        }
      }
      operation?.finish(data.has_changes
        ? `${giteaState.totalChanges} workspace ${giteaState.totalChanges === 1 ? 'change' : 'changes'}`
        : 'Workspace is clean', {
        detail: `Branch: ${giteaState.currentBranch}${shouldFetch ? '\nRemote references fetched.' : ''}`,
      });
      return true;
    } else {
      giteaState.lastError = data.message || data.error || "Gitea status failed";
      eventBus.emit('git:refresh');
      operation?.fail('Could not refresh Gitea status', giteaState.lastError);
      if (!silent) showToast(t("toast.gitea_error", { error: giteaState.lastError }), "error");
      return false;
    }
  } catch (error) {
    giteaState.lastError = error.message || "Gitea status failed";
    eventBus.emit('git:refresh');
    operation?.fail('Could not refresh Gitea status', giteaState.lastError);
    if (!silent) {
      showToast(t("toast.gitea_error", { error: error.message }), "error");
    }
    return false;
  } finally {
    if (!silent && elements.btnGiteaStatus) elements.btnGiteaStatus.classList.remove("pulsing");
  }
}

// ============================================
// Gitea Panel UI Update
// ============================================

export function updateGiteaPanel() {
  return updateGiteaPanelUI();
}

// ============================================
// Gitea Files Rendering
// ============================================

export function renderGiteaFiles(container) {
  return renderGiteaFilesImpl(container);
}

/**
 * Refresh Gitea panel labels with translated strings
 */
export function refreshGiteaPanelStrings() {
  const panel = document.getElementById("gitea-panel");
  if (!panel) return;

  const title = panel.querySelector(".panel-title-text");
  if (title) title.textContent = t("sidebar.gitea_changes");

  const emptyState = panel.querySelector(".git-empty-state p");
  if (emptyState) emptyState.textContent = t("sidebar.no_changes");

  const btnStageSelected = document.getElementById("btn-gitea-stage-selected");
  if (btnStageSelected) btnStageSelected.textContent = t("sidebar.stage");

  const btnStageAll = document.getElementById("btn-gitea-stage-all");
  if (btnStageAll) btnStageAll.textContent = t("sidebar.stage_all");

  const btnUnstageAll = document.getElementById("btn-gitea-unstage-all");
  if (btnUnstageAll) btnUnstageAll.textContent = t("sidebar.unstage");

  const btnCommit = document.getElementById("btn-gitea-commit-staged");
  if (btnCommit) btnCommit.textContent = t("sidebar.commit");
}
