/** Shared, actionable recovery states for source-control providers. */

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function classifyError(message = '') {
  const text = String(message).toLowerCase();
  if (/auth|credential|token|401|403|permission denied/.test(text)) return 'authentication';
  if (/remote|repository not found|no such repository|could not read from/.test(text)) return 'remote';
  return 'network';
}

export function getSourceControlRecovery(repositoryState, online = typeof navigator === 'undefined' || navigator.onLine !== false) {
  if (!repositoryState?.isInitialized) return null;
  const status = String(repositoryState.status || '').toLowerCase();
  const conflicted = repositoryState.conflictFiles?.length || /rebas|merg|unmerged|conflict/.test(status);
  if (conflicted) return { kind: 'conflict', tone: 'error', icon: 'warning', title: 'Resolve repository conflicts' };
  if (repositoryState.hasRemote && !online) return { kind: 'network', tone: 'error', icon: 'cloud_off', title: 'Remote unavailable while offline' };
  if (repositoryState.lastError) {
    const kind = classifyError(repositoryState.lastError);
    return { kind, tone: 'error', icon: kind === 'authentication' ? 'key_off' : kind === 'remote' ? 'link_off' : 'cloud_off', title: kind === 'authentication' ? 'Authentication needs attention' : kind === 'remote' ? 'Remote repository unavailable' : 'Could not reach the remote' };
  }
  if (!repositoryState.hasRemote) return { kind: 'remote-missing', tone: 'warning', icon: 'link_off', title: 'No remote configured' };
  if (repositoryState.ahead > 0 && repositoryState.behind > 0) return { kind: 'diverged', tone: 'warning', icon: 'sync_problem', title: 'Local and remote histories diverged' };
  return null;
}

function action(action, label, icon, style = 'secondary') {
  return `<button type="button" class="source-control-recovery-action ${style}" data-recovery-action="${action}"><span class="ui-icon material-icons" aria-hidden="true">${icon}</span><span>${label}</span></button>`;
}

export function renderSourceControlRecovery(repositoryState, provider) {
  const recovery = getSourceControlRecovery(repositoryState);
  if (!recovery) return '';
  const providerName = escapeHtml(provider);
  let description = '';
  let details = '';
  let actions = '';

  if (recovery.kind === 'conflict') {
    const files = repositoryState.conflictFiles || [];
    description = 'Choose a version for every conflicted file, then commit the resolved result. Abort only to return to the pre-sync state.';
    details = files.map(path => `<div class="source-control-conflict-row"><span title="${escapeHtml(path)}">${escapeHtml(path.split('/').pop())}</span><span class="source-control-conflict-actions"><button type="button" class="btn-conflict-ours" data-path="${escapeHtml(path)}">Use ours</button><button type="button" class="btn-conflict-theirs" data-path="${escapeHtml(path)}">Use theirs</button></span></div>`).join('');
    actions = action('abort', 'Abort sync', 'undo', 'danger');
  } else if (recovery.kind === 'authentication') {
    description = `${providerName} rejected the saved credentials. Reconnect the account, then retry the status check.`;
    actions = action('configure', 'Reconnect', 'settings', 'primary') + action('retry', 'Retry', 'refresh');
  } else if (recovery.kind === 'remote-missing') {
    description = `Local commits still work. Configure a ${providerName} remote before pulling or pushing.`;
    actions = action('configure', 'Configure remote', 'settings', 'primary');
  } else if (recovery.kind === 'remote') {
    description = `Check the ${providerName} remote URL and repository access, then retry.`;
    actions = action('configure', 'Check remote', 'settings', 'primary') + action('retry', 'Retry', 'refresh');
  } else if (recovery.kind === 'diverged') {
    description = `The local branch is ${repositoryState.ahead} ahead and ${repositoryState.behind} behind. Pull with rebase first; force push or reset only when replacing history is intentional.`;
    actions = action('pull', 'Pull with rebase', 'download', 'primary') + action('force-push', 'Force push', 'upload') + action('hard-reset', 'Reset local', 'restore');
  } else {
    description = typeof navigator !== 'undefined' && navigator.onLine === false
      ? 'Local staging and commits remain available. Reconnect to the network, then retry remote status.'
      : `The ${providerName} request failed. Check connectivity and retry without losing local work.`;
    actions = action('retry', 'Retry', 'refresh', 'primary');
  }

  const error = repositoryState.lastError && !['conflict', 'diverged', 'remote-missing'].includes(recovery.kind)
    ? `<div class="source-control-recovery-detail" title="${escapeHtml(repositoryState.lastError)}">${escapeHtml(repositoryState.lastError)}</div>`
    : '';
  return `<section class="source-control-recovery" data-recovery-kind="${recovery.kind}" data-tone="${recovery.tone}" aria-label="${escapeHtml(recovery.title)}"><span class="ui-icon material-icons source-control-recovery-icon" aria-hidden="true">${recovery.icon}</span><div class="source-control-recovery-content"><strong>${escapeHtml(recovery.title)}</strong><p>${description}</p>${error}${details ? `<div class="source-control-conflict-list">${details}</div>` : ''}<div class="source-control-recovery-actions">${actions}</div></div></section>`;
}

export function bindSourceControlRecovery(container, handlers) {
  container?.querySelectorAll('[data-recovery-action]').forEach(button => {
    button.addEventListener('click', () => handlers[button.dataset.recoveryAction]?.());
  });
}
