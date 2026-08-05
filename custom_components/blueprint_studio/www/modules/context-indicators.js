/** CONTEXT-INDICATORS.JS | Compact workspace connection and repository context. */
import { setOverflowTooltip } from './tooltip.js?v=2.5.188';

function createStatusDot(state) {
  const dot = document.createElement('span');
  dot.className = 'workspace-context-dot';
  dot.dataset.state = state;
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

function createContextLabel(text) {
  const label = document.createElement('span');
  label.className = 'workspace-context-label';
  label.textContent = text;
  return label;
}

export function renderRepositoryContext(panel, provider, repositoryState, onActivate) {
  const title = panel?.querySelector('.git-panel-title');
  const header = panel?.querySelector('.git-panel-header');
  if (!title || !header) return;

  header.querySelector('.repository-context')?.remove();

  const status = getRepositoryStatus(repositoryState);
  const context = document.createElement(status.branch ? 'button' : 'div');
  const label = !status.initialized
    ? 'Not initialized'
    : `${status.hasRemote ? provider : 'Local'}${status.branch ? ` · ${status.branch}` : ''}`;

  context.className = 'workspace-context repository-context';
  context.dataset.state = status.tone;
  context.setAttribute('aria-label', `${provider}: ${status.description}`);
  const contextLabel = createContextLabel(label);
  context.append(createStatusDot(status.tone), contextLabel);

  const states = document.createElement('span');
  states.className = 'repository-state-list';
  states.setAttribute('aria-hidden', 'true');
  for (const item of status.labels) {
    const badge = document.createElement('span');
    badge.className = 'repository-state-badge';
    badge.dataset.state = item.state;
    badge.textContent = item.label;
    states.appendChild(badge);
  }
  context.appendChild(states);
  setOverflowTooltip(context, `${provider}: ${status.description}`, contextLabel);

  if (status.branch) {
    context.type = 'button';
    context.addEventListener('click', onActivate);
  }

  header.appendChild(context);
}

export function getRepositoryStatus(repositoryState, online = typeof navigator === 'undefined' || navigator.onLine !== false) {
  const initialized = Boolean(repositoryState?.isInitialized);
  const hasRemote = initialized && Boolean(repositoryState?.hasRemote);
  const rawBranch = repositoryState?.currentBranch || '';
  const statusText = typeof repositoryState?.status === 'string' ? repositoryState.status.toLowerCase() : '';
  const detached = initialized && (rawBranch === 'HEAD' || statusText.includes('detached'));
  const branch = rawBranch && rawBranch !== 'unknown' && rawBranch !== 'HEAD' ? rawBranch : detached ? 'Detached HEAD' : '';
  const ahead = Math.max(0, Number(repositoryState?.ahead) || 0);
  const behind = Math.max(0, Number(repositoryState?.behind) || 0);
  const stagedCount = repositoryState?.files?.staged?.length || 0;
  const dirty = initialized && Boolean(repositoryState?.totalChanges || stagedCount || repositoryState?.conflictFiles?.length);
  const offline = hasRemote && !online;
  const labels = [];

  if (!initialized) labels.push({ state: 'inactive', label: 'Inactive' });
  else if (offline) labels.push({ state: 'offline', label: 'Offline' });
  else if (!hasRemote) labels.push({ state: 'local', label: 'Local only' });
  else if (ahead) labels.push({ state: 'ahead', label: `Push ${ahead}` });
  if (initialized && !offline && hasRemote && behind) labels.push({ state: 'behind', label: `Pull ${behind}` });
  if (detached) labels.push({ state: 'detached', label: 'Detached' });
  if (dirty) labels.push({ state: 'dirty', label: 'Dirty' });
  if (initialized && hasRemote && !offline && !ahead && !behind) labels.push({ state: 'clean', label: 'Synced' });

  const parts = [branch || (initialized ? 'No branch' : 'Not initialized')];
  if (offline) parts.push('offline; remote operations unavailable');
  else if (!initialized) parts.push('repository is not initialized');
  else if (!hasRemote) parts.push('local repository without a remote');
  else if (ahead && behind) parts.push(`diverged, push ${ahead} and pull ${behind}`);
  else if (ahead) parts.push(`${ahead} ${ahead === 1 ? 'commit' : 'commits'} to push`);
  else if (behind) parts.push(`${behind} ${behind === 1 ? 'commit' : 'commits'} to pull`);
  else parts.push('up to date');
  if (detached) parts.push('detached HEAD');
  parts.push(dirty ? 'working tree has changes' : 'working tree clean');

  return {
    initialized,
    hasRemote,
    branch,
    detached,
    dirty,
    offline,
    ahead,
    behind,
    labels,
    tone: offline ? 'error' : initialized ? hasRemote ? 'connected' : 'local' : 'inactive',
    description: parts.join(', '),
  };
}

export function renderRepositoryStatusBar(container, repositories) {
  if (!container) return;
  const enabled = repositories.filter(repository => repository.enabled);
  container.replaceChildren();
  container.classList.toggle('hidden', enabled.length === 0);
  if (!enabled.length) return;

  const icon = document.createElement('span');
  icon.className = 'ui-icon material-icons status-repository-icon';
  icon.setAttribute('aria-hidden', 'true');
  const summaries = enabled.map(repository => {
    const status = getRepositoryStatus(repository.state);
    const stateLabels = status.labels.map(item => item.label).join(', ');
    return `${repository.provider}: ${status.branch || 'Repository'}${stateLabels ? `, ${stateLabels}` : ''}`;
  });
  const offline = enabled.some(repository => getRepositoryStatus(repository.state).offline);
  icon.textContent = offline ? 'cloud_off' : 'account_tree';
  const label = document.createElement('span');
  label.className = 'status-repository-label';
  label.textContent = summaries.join(' | ');
  container.append(icon, label);
  container.dataset.state = offline ? 'offline' : 'available';
  container.setAttribute('role', 'status');
  container.setAttribute('aria-live', 'polite');
  container.setAttribute('aria-label', summaries.join('. '));
  container.title = summaries.join('\n');
}

export function renderSftpConnectionContext(container, connection, status) {
  container?.querySelector('.sftp-connection-context')?.remove();
  if (!container || !connection) return;

  const state = status === 'connecting' ? 'connecting' : status === 'error' ? 'error' : 'connected';
  const port = connection.port || 22;
  const endpoint = `${connection.username ? `${connection.username}@` : ''}${connection.host}:${port}`;
  const description = `${status === 'connecting' ? 'Connecting to' : status === 'error' ? 'Connection unavailable for' : 'Connected to'} ${endpoint}`;
  const context = document.createElement('div');
  context.className = 'workspace-context sftp-connection-context';
  context.dataset.state = state;
  context.setAttribute('role', 'status');
  context.setAttribute('aria-label', description);
  const contextLabel = createContextLabel(endpoint);
  context.append(createStatusDot(state), contextLabel);
  setOverflowTooltip(context, description, contextLabel);
  container.appendChild(context);
}
