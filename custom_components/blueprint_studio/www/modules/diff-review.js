import { t, tp } from './translations.js?v=2.5.270';
/** DIFF-REVIEW.JS | Shared presentation primitives for read-only change review. */

export const DEFAULT_DIFF_RENDER_LIMIT = 1500;

function createIconButton(icon, label, className = 'ui-icon-button') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<span class="ui-icon material-icons" aria-hidden="true">${icon}</span>`;
  return button;
}

export function createDiffToggle(icon, label, pressed = false) {
  const button = createIconButton(icon, label);
  button.setAttribute('aria-pressed', String(pressed));
  return button;
}

function syncToolbarTabStop(actions, preferred = null) {
  const enabled = [...actions.querySelectorAll('button')].filter(control => !control.disabled && !control.hidden);
  const target = enabled.includes(preferred)
    ? preferred
    : enabled.find(control => control.tabIndex === 0) || enabled[0];
  [...actions.querySelectorAll('button')].forEach(control => {
    control.tabIndex = control === target ? 0 : -1;
  });
}

export function createDiffReviewToolbar({ summary, controls = [], label = t('diff_review.controls'), className = '' }) {
  const toolbar = document.createElement('div');
  toolbar.className = `diff-viewer-toolbar ${className}`.trim();
  const summaryElement = document.createElement('div');
  summaryElement.className = 'diff-viewer-summary';
  const icon = document.createElement('span');
  icon.className = 'ui-icon material-icons';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = 'difference';
  const text = document.createElement('span');
  text.textContent = summary;
  summaryElement.append(icon, text);

  const actions = document.createElement('div');
  actions.className = 'diff-viewer-actions';
  actions.setAttribute('role', 'toolbar');
  actions.setAttribute('aria-orientation', 'horizontal');
  actions.setAttribute('aria-label', label);
  controls.forEach((control, index) => {
    control.tabIndex = index === 0 ? 0 : -1;
    actions.appendChild(control);
  });
  actions.addEventListener('focusin', (event) => {
    if (!controls.includes(event.target)) return;
    syncToolbarTabStop(actions, event.target);
  });
  actions.addEventListener('keydown', (event) => {
    if (!controls.includes(event.target)) return;
    const enabled = controls.filter(control => !control.disabled && !control.hidden);
    const current = enabled.indexOf(event.target);
    if (current < 0) return;
    let targetIndex;
    if (event.key === 'ArrowRight') targetIndex = (current + 1) % enabled.length;
    else if (event.key === 'ArrowLeft') targetIndex = (current - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') targetIndex = 0;
    else if (event.key === 'End') targetIndex = enabled.length - 1;
    else return;
    event.preventDefault();
    enabled[targetIndex].focus();
  });
  toolbar.append(summaryElement, actions);
  return toolbar;
}

export function getRawDiffRows(diff) {
  let file = '';
  let change = -1;
  const rows = String(diff || '').split('\n').map((text) => {
    let type = 'context';
    const fileMatch = text.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (fileMatch) file = fileMatch[2];
    if (text.startsWith('@@')) {
      type = 'hunk';
      change += 1;
    }
    else if (text.startsWith('+') && !text.startsWith('+++')) type = 'added';
    else if (text.startsWith('-') && !text.startsWith('---')) type = 'removed';
    else if (text.startsWith('diff ') || text.startsWith('index ') || text.startsWith('---') || text.startsWith('+++')) type = 'meta';
    return { text, type, file, change: change >= 0 ? change : undefined };
  });
  return markWhitespaceOnlyChanges(rows);
}

export function markWhitespaceOnlyChanges(rows) {
  const result = (rows || []).map(row => ({ ...row, whitespaceOnly: false }));
  const groups = new Map();
  result.forEach((row, index) => {
    if (row.type !== 'added' && row.type !== 'removed') return;
    const key = `${row.file || ''}:${row.change ?? 'change'}`;
    if (!groups.has(key)) groups.set(key, { added: new Map(), removed: new Map() });
    const rawText = String(row.text || '');
    const hasMarker = (row.type === 'added' && rawText.startsWith('+')) || (row.type === 'removed' && rawText.startsWith('-'));
    const normalized = (hasMarker ? rawText.slice(1) : rawText).replace(/\s/g, '');
    const side = groups.get(key)[row.type];
    if (!side.has(normalized)) side.set(normalized, []);
    side.get(normalized).push(index);
  });
  groups.forEach(({ added, removed }) => {
    added.forEach((addedIndexes, normalized) => {
      const removedIndexes = removed.get(normalized) || [];
      const matches = Math.min(addedIndexes.length, removedIndexes.length);
      for (let index = 0; index < matches; index += 1) {
        result[addedIndexes[index]].whitespaceOnly = true;
        result[removedIndexes[index]].whitespaceOnly = true;
      }
    });
  });
  result.forEach((row) => {
    if (row.type !== 'hunk') return;
    const changedRows = result.filter(candidate => (
      candidate.file === row.file &&
      candidate.change === row.change &&
      (candidate.type === 'added' || candidate.type === 'removed')
    ));
    row.whitespaceOnly = changedRows.length > 0 && changedRows.every(candidate => candidate.whitespaceOnly);
  });
  return result;
}

export function renderTextDiff(target, rows, {
  emptyMessage = t('diff_review.no_content_changes'),
  extraLineClass = '',
  maxRows = DEFAULT_DIFF_RENDER_LIMIT,
} = {}) {
  target.replaceChildren();
  if (!rows?.length || rows.every(row => !row.text)) {
    target.classList.add('diff-text-viewer', 'diff-text-viewer--empty');
    target.textContent = emptyMessage;
    return { rendered: 0, total: 0, truncated: false };
  }

  target.classList.add('diff-text-viewer');
  target.classList.remove('diff-text-viewer--empty');
  const visibleRows = rows.slice(0, maxRows);
  visibleRows.forEach((row) => {
    const line = document.createElement('div');
    line.className = `diff-text-line diff-text-line--${row.type || 'context'} ${extraLineClass} ${row.type || ''}`.trim();
    if (row.change !== undefined) line.dataset.changeIndex = String(row.change);
    const marker = document.createElement('span');
    marker.className = 'diff-text-line-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.textContent = row.type === 'added' ? '+' : row.type === 'removed' ? '-' : row.type === 'hunk' ? '@' : '';
    const code = document.createElement('code');
    code.textContent = row.text;
    line.append(marker, code);
    target.appendChild(line);
  });
  if (visibleRows.length < rows.length) {
    const fallback = document.createElement('div');
    fallback.className = 'diff-large-fallback';
    fallback.setAttribute('role', 'status');
    const message = document.createElement('span');
    message.textContent = t('diff_review.showing_lines', { visible: visibleRows.length.toLocaleString(), total: rows.length.toLocaleString() });
    const showMore = document.createElement('button');
    showMore.type = 'button';
    showMore.className = 'ui-button';
    showMore.textContent = t('diff_review.show_more');
    showMore.addEventListener('click', () => renderTextDiff(target, rows, {
      emptyMessage,
      extraLineClass,
      maxRows: Math.min(rows.length, maxRows + DEFAULT_DIFF_RENDER_LIMIT),
    }));
    fallback.append(message, showMore);
    target.appendChild(fallback);
  }
  return {
    rendered: visibleRows.length,
    total: rows.length,
    truncated: visibleRows.length < rows.length,
  };
}

export function createTextDiffReview(target, sourceRows, {
  emptyMessage = t('diff_review.no_changes'),
  label = t('diff_review.review_controls'),
} = {}) {
  const rows = markWhitespaceOnlyChanges(sourceRows);
  const files = [...new Set(rows.map(row => row.file).filter(Boolean))];
  let selectedFile = files[0] || '';
  let hideWhitespace = false;
  let wrapLines = true;
  let activeChange = 0;
  let renderLimit = DEFAULT_DIFF_RENDER_LIMIT;

  const previous = createIconButton('keyboard_arrow_up', t('diff_review.previous_change'));
  const next = createIconButton('keyboard_arrow_down', t('diff_review.next_change'));
  const whitespace = createDiffToggle('space_bar', t('diff_review.hide_whitespace'));
  const wrap = createDiffToggle('wrap_text', t('diff_review.wrap_lines'), true);
  const toolbar = createDiffReviewToolbar({ summary: t('diff_review.calculating'), controls: [previous, next, whitespace, wrap], label });
  const summary = toolbar.querySelector('.diff-viewer-summary span:last-child');
  const layout = document.createElement('div');
  layout.className = 'diff-review-layout';
  const fileList = document.createElement('div');
  fileList.className = 'diff-file-list';
  fileList.setAttribute('role', 'listbox');
  fileList.setAttribute('aria-orientation', 'vertical');
  fileList.setAttribute('aria-label', t('diff_review.changed_files'));
  const viewer = document.createElement('div');
  viewer.className = 'diff-text-viewer diff-text-viewer--commit diff-text-viewer--wrap';
  layout.append(fileList, viewer);
  target.replaceChildren(toolbar, layout);

  const fileRows = () => selectedFile ? rows.filter(row => row.file === selectedFile) : rows;
  const visibleRows = () => fileRows().filter(row => !hideWhitespace || !row.whitespaceOnly);
  const changeIds = () => [...new Set(visibleRows()
    .filter(row => row.change !== undefined && (row.type === 'hunk' || row.type === 'added' || row.type === 'removed'))
    .map(row => row.change))];

  function updateFileList() {
    fileList.replaceChildren();
    if (!files.length) {
      fileList.hidden = true;
      layout.classList.add('diff-review-layout--single');
      return;
    }
    files.forEach((file) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'diff-file-list-item';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(file === selectedFile));
      button.tabIndex = file === selectedFile ? 0 : -1;
      button.title = file;
      const count = new Set(rows.filter(row => row.file === file && row.change !== undefined).map(row => row.change)).size;
      button.innerHTML = '<span class="ui-icon material-icons" aria-hidden="true">description</span>';
      const name = document.createElement('span');
      name.textContent = file;
      const badge = document.createElement('span');
      badge.className = 'diff-file-list-count';
      badge.textContent = String(count);
      button.append(name, badge);
      button.addEventListener('click', () => {
        selectedFile = file;
        activeChange = 0;
        renderLimit = DEFAULT_DIFF_RENDER_LIMIT;
        updateFileList();
        render();
      });
      fileList.appendChild(button);
    });
  }

  fileList.addEventListener('keydown', (event) => {
    const items = [...fileList.querySelectorAll('.diff-file-list-item')];
    const current = items.indexOf(event.target.closest?.('.diff-file-list-item'));
    if (current < 0 || !items.length) return;
    let targetIndex;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') targetIndex = (current + 1) % items.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') targetIndex = (current - 1 + items.length) % items.length;
    else if (event.key === 'Home') targetIndex = 0;
    else if (event.key === 'End') targetIndex = items.length - 1;
    else return;
    event.preventDefault();
    const file = files[targetIndex];
    items[targetIndex].click();
    requestAnimationFrame(() => {
      [...fileList.querySelectorAll('.diff-file-list-item')]
        .find(item => item.title === file)?.focus();
    });
  });

  function highlightActiveChange() {
    viewer.querySelectorAll('.diff-text-line--active').forEach(line => line.classList.remove('diff-text-line--active'));
    const ids = changeIds();
    const change = ids[activeChange];
    if (change === undefined) return;
    const lines = viewer.querySelectorAll(`[data-change-index="${change}"]`);
    lines.forEach(line => line.classList.add('diff-text-line--active'));
    lines[0]?.scrollIntoView({ block: 'nearest' });
  }

  function render() {
    const filtered = visibleRows();
    const ids = changeIds();
    activeChange = ids.length ? Math.min(activeChange, ids.length - 1) : 0;
    renderTextDiff(viewer, filtered, { emptyMessage, maxRows: renderLimit });
    viewer.classList.toggle('diff-text-viewer--wrap', wrapLines);
    const position = ids.length ? `${activeChange + 1} / ${ids.length}` : '0';
    const changeText = ids.length ? tp('diff_review.change_count', ids.length) : t('diff_review.no_change_count');
    summary.textContent = `${position} ${changeText}${selectedFile ? ` ${t('diff_review.in_file', { file: selectedFile })}` : ''}`;
    previous.disabled = next.disabled = ids.length === 0;
    syncToolbarTabStop(toolbar.querySelector('.diff-viewer-actions'));
    highlightActiveChange();
  }

  function jump(direction) {
    const ids = changeIds();
    if (!ids.length) return;
    activeChange = (activeChange + direction + ids.length) % ids.length;
    const targetIndex = visibleRows().findIndex(row => row.change === ids[activeChange]);
    if (targetIndex >= renderLimit) {
      renderLimit = Math.ceil((targetIndex + 1) / DEFAULT_DIFF_RENDER_LIMIT) * DEFAULT_DIFF_RENDER_LIMIT;
      render();
      return;
    }
    summary.textContent = `${activeChange + 1} / ${ids.length} ${tp('diff_review.change_count', ids.length)}${selectedFile ? ` ${t('diff_review.in_file', { file: selectedFile })}` : ''}`;
    highlightActiveChange();
  }

  previous.addEventListener('click', () => jump(-1));
  next.addEventListener('click', () => jump(1));
  whitespace.addEventListener('click', () => {
    hideWhitespace = !hideWhitespace;
    whitespace.setAttribute('aria-pressed', String(hideWhitespace));
    whitespace.title = hideWhitespace ? t('diff_review.show_whitespace') : t('diff_review.hide_whitespace');
    whitespace.setAttribute('aria-label', whitespace.title);
    activeChange = 0;
    renderLimit = DEFAULT_DIFF_RENDER_LIMIT;
    render();
  });
  wrap.addEventListener('click', () => {
    wrapLines = !wrapLines;
    wrap.setAttribute('aria-pressed', String(wrapLines));
    viewer.classList.toggle('diff-text-viewer--wrap', wrapLines);
  });

  updateFileList();
  render();
  return { render, viewer };
}
