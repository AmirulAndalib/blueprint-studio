import { isTextFile } from './utils.js';

const GROUPS = [
  { key: 'conflicted', label: 'Conflicted', icon: 'warning', tone: 'conflicted' },
  { key: 'staged', label: 'Staged', icon: 'inventory_2', tone: 'staged' },
  { key: 'unstaged', label: 'Unstaged', icon: 'edit', tone: 'modified' },
  { key: 'untracked', label: 'Untracked', icon: 'note_add', tone: 'untracked' },
  { key: 'ignored', label: 'Ignored', icon: 'visibility_off', tone: 'ignored' },
];

const pendingViewRestores = new WeakMap();

function unique(values) {
  return [...new Set((values || []).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function findFileRow(container, path) {
  if (!path) return null;
  return Array.from(container.querySelectorAll('.git-file-item[data-file]'))
    .find(row => row.dataset.file === path) || null;
}

/** Preserve the visible file anchor and keyboard position across status rerenders. */
export function captureSourceControlView(container) {
  if (!container) return null;

  const bounds = container.getBoundingClientRect();
  const rows = Array.from(container.querySelectorAll('.git-file-item[data-file]'));
  const anchor = rows.find(row => row.getBoundingClientRect().bottom > bounds.top) || null;
  const activeElement = document.activeElement;
  const focusedRow = activeElement instanceof Element
    ? activeElement.closest('.git-file-item[data-file]')
    : null;

  return {
    scrollTop: container.scrollTop,
    anchorPath: anchor?.dataset.file || null,
    anchorOffset: anchor ? anchor.getBoundingClientRect().top - bounds.top : 0,
    focusedPath: focusedRow && container.contains(focusedRow) ? focusedRow.dataset.file : null,
    focusedControl: activeElement?.matches?.('input[type="checkbox"]')
      ? 'input[type="checkbox"]'
      : activeElement?.matches?.('button') ? 'button' : null,
  };
}

export function scheduleSourceControlViewRestore(container, context) {
  if (!container || !context) return;
  const pending = pendingViewRestores.get(container);
  if (pending) cancelAnimationFrame(pending);

  const frame = requestAnimationFrame(() => {
    pendingViewRestores.delete(container);
    container.scrollTop = context.scrollTop;

    const anchor = findFileRow(container, context.anchorPath);
    if (anchor) {
      const currentOffset = anchor.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTop += currentOffset - context.anchorOffset;
    }

    const focusedRow = findFileRow(container, context.focusedPath);
    if (!focusedRow) return;
    const target = context.focusedControl
      ? focusedRow.querySelector(context.focusedControl)
      : focusedRow;
    target?.focus({ preventScroll: true });
  });

  pendingViewRestores.set(container, frame);
}

export function getSourceControlGroups(repositoryState) {
  const files = repositoryState.files || {};
  const conflicted = new Set(repositoryState.conflictFiles || []);
  const staged = new Set(files.staged || []);
  const explicitlyUnstaged = new Set(files.unstaged || []);
  const untracked = unique(files.untracked).filter(path => !conflicted.has(path));
  const unstaged = unique([
    ...explicitlyUnstaged,
    ...(files.modified || []).filter(path => !staged.has(path)),
    ...(files.added || []).filter(path => !staged.has(path)),
    ...(files.deleted || []).filter(path => !staged.has(path)),
  ]).filter(path => !conflicted.has(path) && !untracked.includes(path));
  const byKey = {
    conflicted: unique([...conflicted]),
    staged: unique([...staged]).filter(path => !conflicted.has(path)),
    unstaged,
    untracked,
    ignored: unique(files.ignored),
  };
  return GROUPS.map(group => ({ ...group, files: byKey[group.key] }));
}

export function getUnstagedPaths(repositoryState) {
  return getSourceControlGroups(repositoryState)
    .filter(group => group.key === 'unstaged' || group.key === 'untracked')
    .flatMap(group => group.files);
}

function reconcileSelection(repositoryState) {
  const availablePaths = new Set(
    getSourceControlGroups(repositoryState).flatMap(group => group.files),
  );
  for (const path of repositoryState.selectedFiles) {
    if (!availablePaths.has(path)) repositoryState.selectedFiles.delete(path);
  }
}

function iconButton(icon, label, className, path, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `ui-icon-button ${className}`;
  button.dataset.path = path;
  if (action) button.dataset.action = action;
  button.title = label;
  button.setAttribute('aria-label', `${label} ${path}`);
  const glyph = document.createElement('span');
  glyph.className = 'ui-icon material-icons';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.textContent = icon;
  button.appendChild(glyph);
  return button;
}

function renderFileRow(group, path, repositoryState, provider) {
  const row = document.createElement('div');
  row.className = 'git-file-item';
  row.dataset.file = path;
  row.dataset.group = group.key;

  const selectable = !['ignored', 'conflicted'].includes(group.key);
  let selection;
  if (selectable) {
    selection = document.createElement('input');
    selection.type = 'checkbox';
    selection.className = provider === 'gitea' ? 'gitea-file-checkbox' : 'git-file-checkbox';
    selection.dataset.filePath = path;
    selection.checked = repositoryState.selectedFiles.has(path);
    selection.setAttribute('aria-label', `Select ${path}`);
  } else {
    selection = document.createElement('span');
    selection.className = 'source-control-row-spacer';
    selection.setAttribute('aria-hidden', 'true');
  }

  const icon = document.createElement('span');
  icon.className = `ui-icon material-icons git-file-icon ${group.tone}`;
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = group.icon;

  const name = document.createElement('span');
  name.className = 'git-file-name';
  name.textContent = path;
  name.title = path;
  row.append(selection, icon, name);

  const actions = document.createElement('div');
  actions.className = 'git-file-actions';
  actions.setAttribute('aria-label', `Actions for ${path}`);
  if (isTextFile(path) && group.key !== 'ignored') {
    const label = group.key === 'conflicted' ? 'Review conflict in' : 'View diff for';
    actions.appendChild(iconButton('difference', label, 'btn-git-diff', path));
  }
  if (group.key === 'staged') {
    actions.appendChild(iconButton('remove', 'Unstage', 'btn-source-control-stage', path, 'unstage'));
  } else if (group.key === 'unstaged' || group.key === 'untracked') {
    actions.appendChild(iconButton('add', 'Stage', 'btn-source-control-stage', path, 'stage'));
  } else if (group.key === 'ignored') {
    actions.appendChild(iconButton('settings', 'Manage exclusion for', 'btn-source-control-exclusions', path));
  }
  if (actions.childElementCount) row.appendChild(actions);
  return row;
}

export function renderSourceControlFiles(container, repositoryState, provider) {
  reconcileSelection(repositoryState);
  const fragment = document.createDocumentFragment();
  for (const group of getSourceControlGroups(repositoryState)) {
    const section = document.createElement('section');
    section.className = `git-file-group${repositoryState.collapsedGroups.has(group.key) ? ' collapsed' : ''}`;
    section.dataset.group = group.key;

    const header = document.createElement('div');
    header.className = 'git-file-group-header';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'git-file-group-toggle';
    toggle.setAttribute('aria-expanded', String(!repositoryState.collapsedGroups.has(group.key)));
    const icon = document.createElement('span');
    icon.className = `ui-icon material-icons git-file-group-icon ${group.tone}`;
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = group.icon;
    const label = document.createElement('span');
    label.textContent = group.label;
    const count = document.createElement('span');
    count.className = 'git-file-group-count';
    count.textContent = String(group.files.length);
    const chevron = document.createElement('span');
    chevron.className = 'ui-icon material-icons git-file-group-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = 'expand_more';
    toggle.append(icon, label, count, chevron);
    header.appendChild(toggle);
    section.appendChild(header);

    const list = document.createElement('div');
    list.className = 'git-file-list';
    if (!group.files.length) {
      const empty = document.createElement('p');
      empty.className = 'source-control-group-empty';
      empty.textContent = 'No files';
      list.appendChild(empty);
    } else {
      group.files.forEach(path => list.appendChild(renderFileRow(group, path, repositoryState, provider)));
    }
    section.appendChild(list);
    fragment.appendChild(section);
  }
  container.appendChild(fragment);
}

export function updateCommitComposer(provider, repositoryState) {
  const prefix = provider === 'gitea' ? 'gitea-' : '';
  const input = document.getElementById(`${prefix}commit-message`);
  const summary = document.getElementById(`${prefix}commit-summary`);
  const validation = document.getElementById(`${prefix}commit-validation`);
  const button = document.getElementById(provider === 'gitea' ? 'btn-gitea-commit-staged' : 'btn-commit-staged');
  if (!input || !summary || !validation || !button) return;
  const count = repositoryState.files.staged.length;
  const hasMessage = Boolean(input.value.trim());
  summary.textContent = `${count} staged ${count === 1 ? 'file' : 'files'}`;
  validation.textContent = count === 0
    ? 'Stage at least one file to commit.'
    : hasMessage ? '' : 'Enter a commit message.';
  button.disabled = count === 0 || !hasMessage;
}

export function getCommitMessage(provider) {
  const prefix = provider === 'gitea' ? 'gitea-' : '';
  return document.getElementById(`${prefix}commit-message`)?.value.trim() || '';
}

export function clearCommitMessage(provider) {
  const prefix = provider === 'gitea' ? 'gitea-' : '';
  const input = document.getElementById(`${prefix}commit-message`);
  if (input) input.value = '';
}
