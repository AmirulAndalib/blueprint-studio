/** Active-document commands, inline operation feedback, and welcome recovery. */
import { state } from './state.js';
import { eventBus } from './event-bus.js';
import { getFileIcon } from './utils.js';
import { isWorkspaceDrawerMode } from './workspace-layout.js?v=2.5.270';

const COMMAND_IDS = [
  'btn-save', 'btn-save-all', 'btn-format', 'btn-validate',
  'btn-search', 'btn-download', 'btn-markdown-preview', 'btn-use-blueprint',
];

let initialized = false;
let resultTimer = null;

function commandLabel(control) {
  const label = control.dataset.toolbarLabel || control.getAttribute('aria-label') || control.title || control.id;
  return label.replace(/\s*\([^()]*(?:Ctrl|Cmd|Alt|Shift|Meta|F\d)[^()]*\)\s*$/i, '');
}

function visibleCommand(control) {
  return control
    && control.getClientRects().length > 0
    && getComputedStyle(control).display !== 'none'
    && !control.classList.contains('hidden');
}

function closeActionsMenu(restoreFocus = false) {
  const trigger = document.getElementById('editor-actions-trigger');
  const menu = document.getElementById('editor-actions-menu');
  if (!trigger || !menu) return;
  menu.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
  if (restoreFocus) trigger.focus();
}

function positionActionsMenu() {
  const trigger = document.getElementById('editor-actions-trigger');
  const menu = document.getElementById('editor-actions-menu');
  if (!trigger || !menu || menu.hidden) return;
  const triggerRect = trigger.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(innerWidth - menuRect.width - margin, Math.max(margin, triggerRect.right - menuRect.width));
  const below = triggerRect.bottom + margin;
  const top = below + menuRect.height <= innerHeight - margin
    ? below
    : Math.max(margin, triggerRect.top - menuRect.height - margin);
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

function rebuildActionsMenu() {
  const menu = document.getElementById('editor-actions-menu');
  if (!menu) return;
  menu.replaceChildren();
  COMMAND_IDS.map((id) => document.getElementById(id)).filter(visibleCommand).forEach((control) => {
    const item = document.createElement('button');
    const sourceIcon = control.querySelector('.material-icons');
    item.type = 'button';
    item.className = 'ui-menu__item editor-actions-menu-item';
    item.setAttribute('role', 'menuitem');
    item.disabled = control.disabled;
    item.setAttribute('aria-disabled', String(control.disabled));
    const icon = document.createElement('span');
    icon.className = 'ui-icon material-icons';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = sourceIcon?.textContent || 'play_arrow';
    const label = document.createElement('span');
    label.textContent = commandLabel(control);
    item.append(icon, label);
    item.addEventListener('click', () => {
      closeActionsMenu();
      control.click();
    });
    menu.appendChild(item);
  });
}

function activeResultElement() {
  return document.getElementById(state.splitView?.activePane === 'secondary'
    ? 'secondary-editor-operation-result'
    : 'editor-operation-result');
}

function showOperationResult(result = {}) {
  const container = activeResultElement();
  if (!container) return;
  if (resultTimer) clearTimeout(resultTimer);
  container.dataset.status = result.status || 'info';
  container.replaceChildren();
  const icon = document.createElement('span');
  icon.className = 'ui-icon material-icons';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = result.status === 'success' ? 'check_circle' : result.status === 'error' ? 'error' : result.status === 'warning' ? 'warning' : 'info';
  const copy = document.createElement('span');
  copy.className = 'editor-operation-result-copy';
  const title = document.createElement('strong');
  title.textContent = result.title || 'Document result';
  const message = document.createElement('small');
  message.textContent = result.message || '';
  copy.append(title, message);
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'editor-operation-result-dismiss';
  dismiss.setAttribute('aria-label', 'Dismiss result');
  dismiss.innerHTML = '<span class="ui-icon material-icons" aria-hidden="true">close</span>';
  dismiss.addEventListener('click', () => { container.hidden = true; });
  container.append(icon, copy, dismiss);
  container.hidden = false;
  resultTimer = setTimeout(() => { container.hidden = true; }, result.status === 'error' ? 12000 : 6000);
}

export function renderWelcomeWorkspace() {
  const list = document.getElementById('welcome-recent-list');
  const recovery = document.getElementById('btn-welcome-recover-connection');
  if (list) {
    list.replaceChildren();
    const recent = (state.recentFiles || [])
      .filter((path) => path.startsWith('sftp://') || state.files.some((file) => file.path === path))
      .slice(0, 5);
    if (!recent.length) {
      const empty = document.createElement('span');
      empty.className = 'welcome-recent-empty';
      empty.textContent = 'No recent files';
      list.appendChild(empty);
    } else {
      recent.forEach((path) => {
        const iconData = getFileIcon(path);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'welcome-recent-item';
        const icon = document.createElement('span');
        icon.className = `ui-icon material-icons ${iconData.class}`;
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = iconData.icon;
        const copy = document.createElement('span');
        copy.className = 'welcome-recent-copy';
        const name = document.createElement('strong');
        name.textContent = path.split('/').pop();
        const location = document.createElement('small');
        location.textContent = `${path.startsWith('sftp://') ? 'SFTP' : 'Local'} · ${path}`;
        copy.append(name, location);
        button.append(icon, copy);
        button.setAttribute('aria-label', `Open recent file ${path}`);
        button.addEventListener('click', () => {
          eventBus.emit('file:open', { path });
          if (isWorkspaceDrawerMode()) eventBus.emit('ui:hide-sidebar');
        });
        list.appendChild(button);
      });
    }
  }
  if (recovery) {
    const unavailable = ['permission', 'unavailable', 'error'].includes(state.activeSftp?.viewStatus);
    const title = recovery.querySelector('strong');
    const detail = recovery.querySelector('small');
    const icon = recovery.querySelector('.material-icons');
    if (title) title.textContent = unavailable ? 'Retry SFTP connection' : 'Browse SFTP';
    if (detail) detail.textContent = unavailable ? (state.activeSftp.error || 'Remote connection unavailable') : 'Open remote connections';
    if (icon) icon.textContent = unavailable ? 'sync_problem' : 'cloud_sync';
    recovery.dataset.recovery = String(unavailable);
  }
}

/** Restore the task-oriented empty editor without leaving editor overlays above it. */
export function restoreWelcomeWorkspace() {
  closeActionsMenu();
  if (isWorkspaceDrawerMode()) {
    eventBus.emit('ui:hide-sidebar');
    eventBus.emit('ui:toggle-ai-sidebar', false);
    // Release hit-testing synchronously even if a visibility coordinator is
    // still restoring editor geometry on the next animation frame.
    document.getElementById('sidebar-overlay')?.classList.remove('visible');
  }
  for (const id of ['codemirror-wrapper', 'codemirror-wrapper-secondary']) {
    const wrapper = document.getElementById(id);
    if (wrapper) wrapper.style.display = 'none';
  }
  for (const id of ['asset-preview', 'secondary-asset-preview', 'search-widget', 'secondary-search-widget']) {
    document.getElementById(id)?.classList.remove('visible');
  }
  for (const id of ['minimap', 'secondary-minimap']) {
    const minimap = document.getElementById(id);
    if (minimap) {
      minimap.style.display = 'none';
      minimap.parentElement?.classList.remove('minimap-visible');
    }
  }
  for (const id of [
    'completion-details',
    'problems-panel',
    'editor-operation-result',
    'secondary-editor-operation-result',
  ]) {
    const surface = document.getElementById(id);
    if (surface) surface.hidden = true;
  }
  document.getElementById('btn-problems')?.setAttribute('aria-expanded', 'false');
  const welcome = document.getElementById('welcome-screen');
  if (welcome) {
    welcome.style.display = 'flex';
    welcome.style.pointerEvents = 'auto';
  }
  renderWelcomeWorkspace();
}

export function updateEditorActions() {
  const trigger = document.getElementById('editor-actions-trigger');
  if (trigger) trigger.disabled = !state.activeTab;
  if (!document.getElementById('editor-actions-menu')?.hidden) {
    rebuildActionsMenu();
    positionActionsMenu();
  }
}

export function initEditorWorkflow() {
  if (initialized) return;
  const trigger = document.getElementById('editor-actions-trigger');
  const menu = document.getElementById('editor-actions-menu');
  if (!trigger || !menu) return;
  initialized = true;
  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!menu.hidden) return closeActionsMenu();
    rebuildActionsMenu();
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    positionActionsMenu();
  });
  trigger.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    if (menu.hidden) trigger.click();
    menu.querySelector('.editor-actions-menu-item:not(:disabled)')?.focus();
  });
  menu.addEventListener('keydown', (event) => {
    const items = [...menu.querySelectorAll('.editor-actions-menu-item:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    let target = null;
    if (event.key === 'ArrowDown') target = items[(index + 1) % items.length];
    if (event.key === 'ArrowUp') target = items[(index - 1 + items.length) % items.length];
    if (event.key === 'Home') target = items[0];
    if (event.key === 'End') target = items[items.length - 1];
    if (target) { event.preventDefault(); target.focus(); }
    if (event.key === 'Escape') { event.preventDefault(); closeActionsMenu(true); }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menu.hidden && !menu.contains(event.target) && !trigger.contains(event.target)) closeActionsMenu();
  });
  addEventListener('resize', closeActionsMenu);
  document.getElementById('btn-welcome-open-files')?.addEventListener('click', () => eventBus.emit('ui:switch-sidebar-view', { view: 'explorer' }));
  document.getElementById('btn-welcome-recover-connection')?.addEventListener('click', () => {
    eventBus.emit('ui:switch-sidebar-view', { view: 'sftp' });
    if (state.activeSftp?.connectionId) eventBus.emit('sftp:refresh');
  });
  eventBus.on('editor:operation-result', showOperationResult);
  eventBus.on('ui:refresh-tabs', () => {
    updateEditorActions();
    renderWelcomeWorkspace();
  });
  eventBus.on('tab:activated', updateEditorActions);
  eventBus.on('ui:refresh-recent-files', renderWelcomeWorkspace);
  eventBus.on('settings:loaded', renderWelcomeWorkspace);
  eventBus.on('ui:refresh-sftp', renderWelcomeWorkspace);
  renderWelcomeWorkspace();
  updateEditorActions();
}
