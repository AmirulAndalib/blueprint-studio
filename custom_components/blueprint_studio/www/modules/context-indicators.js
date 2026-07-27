/** CONTEXT-INDICATORS.JS | Compact workspace connection and repository context. */
import { setOverflowTooltip } from './tooltip.js?v=2.5.75';

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

  const initialized = Boolean(repositoryState.isInitialized);
  const branch = repositoryState.currentBranch && repositoryState.currentBranch !== 'unknown'
    ? repositoryState.currentBranch
    : '';
  const connected = initialized && Boolean(repositoryState.hasRemote);
  const context = document.createElement(branch ? 'button' : 'div');
  const state = connected ? 'connected' : initialized ? 'local' : 'inactive';
  const label = !initialized
    ? 'Not initialized'
    : `${connected ? provider : 'Local'}${branch ? ` · ${branch}` : ''}`;
  const description = !initialized
    ? `${provider} repository is not initialized`
    : `${connected ? `${provider} remote connected` : 'Local repository without a remote'}${branch ? `, branch ${branch}` : ''}`;

  context.className = 'workspace-context repository-context';
  context.dataset.state = state;
  context.setAttribute('aria-label', description);
  const contextLabel = createContextLabel(label);
  context.append(createStatusDot(state), contextLabel);
  setOverflowTooltip(context, description, contextLabel);

  if (branch) {
    context.type = 'button';
    context.addEventListener('click', onActivate);
  }

  header.appendChild(context);
}

export function renderSftpConnectionContext(container, connection, status) {
  container?.querySelector('.sftp-connection-context')?.remove();
  if (!container || !connection) return;

  const state = status === 'connecting' ? 'connecting' : 'connected';
  const port = connection.port || 22;
  const endpoint = `${connection.username ? `${connection.username}@` : ''}${connection.host}:${port}`;
  const description = `${status === 'connecting' ? 'Connecting to' : 'Connected to'} ${endpoint}`;
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
