/** Shared loading, empty, and failure states for local and remote file trees. */

const STATE_ICONS = {
  loading: 'sync',
  empty: 'folder_open',
  permission: 'lock',
  unavailable: 'cloud_off',
  error: 'error_outline',
};

export function classifyTreeError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  if (/permission|denied|forbidden|not authorized|\b401\b|\b403\b/.test(message)) {
    return 'permission';
  }
  return 'unavailable';
}

export function renderTreeViewState(container, {
  status,
  title,
  copy = '',
  retryLabel = '',
  onRetry = null,
  append = false,
  compact = false,
} = {}) {
  if (!container) return null;
  if (!append) container.innerHTML = '';

  const stateElement = document.createElement('div');
  stateElement.className = `ui-empty-state tree-view-state tree-view-state--${status || 'empty'}`;
  stateElement.dataset.treeStatus = status || 'empty';
  if (compact) stateElement.classList.add('tree-view-state--compact');
  stateElement.setAttribute('role', status === 'permission' || status === 'unavailable' || status === 'error' ? 'alert' : 'status');
  stateElement.setAttribute('aria-live', 'polite');

  const icon = document.createElement('span');
  icon.className = 'ui-icon material-icons tree-view-state__icon';
  if (status === 'loading') icon.classList.add('loading-spinner');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = STATE_ICONS[status] || STATE_ICONS.error;
  stateElement.appendChild(icon);

  const heading = document.createElement('p');
  heading.className = 'tree-view-state__title';
  heading.textContent = title || '';
  stateElement.appendChild(heading);

  if (copy) {
    const description = document.createElement('span');
    description.className = 'tree-view-state__copy';
    description.textContent = copy;
    stateElement.appendChild(description);
  }

  if (onRetry && retryLabel) {
    const retry = document.createElement('button');
    retry.className = 'ui-button tree-view-state__retry';
    retry.type = 'button';
    retry.innerHTML = '<span class="ui-icon material-icons" aria-hidden="true">refresh</span><span></span>';
    retry.querySelector('span:last-child').textContent = retryLabel;
    retry.addEventListener('click', onRetry);
    stateElement.appendChild(retry);
  }

  container.appendChild(stateElement);
  return stateElement;
}
