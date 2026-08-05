/** Shared keyboard and accessibility behavior for local and SFTP file trees. */

const controllers = new WeakMap();
const TYPEAHEAD_RESET_MS = 700;

function treeItems(container) {
  return Array.from(container.querySelectorAll(':scope > .tree-item'))
    .filter((item) => !item.classList.contains('loading-item') && !item.classList.contains('inline-edit-item'));
}

function itemLevel(item) {
  const depth = Number.parseInt(item.style.getPropertyValue('--depth'), 10);
  return (Number.isFinite(depth) ? depth : 0) + 1;
}

function itemLabel(item) {
  return (item.querySelector('.tree-name')?.textContent || item.getAttribute('aria-label') || '').trim();
}

function setFocusedItem(container, item, { focus = true } = {}) {
  const items = treeItems(container);
  if (!items.includes(item)) return;
  items.forEach((candidate) => { candidate.tabIndex = candidate === item ? 0 : -1; });
  if (focus) {
    item.focus({ preventScroll: true });
    item.scrollIntoView({ block: 'nearest' });
  }
}

function syncTree(container) {
  container.setAttribute('role', 'tree');
  const items = treeItems(container);
  const focused = items.find((item) => item === document.activeElement);
  const tabbable = focused || items.find((item) => item.tabIndex === 0)
    || items.find((item) => item.classList.contains('active')) || items[0];

  items.forEach((item) => {
    const checkbox = item.querySelector(':scope > .tree-item-checkbox');
    const folder = item.dataset.isFolder === 'true';
    item.setAttribute('role', 'treeitem');
    item.setAttribute('aria-level', String(itemLevel(item)));
    item.setAttribute('aria-selected', String(Boolean(checkbox?.checked)));
    if (item.classList.contains('active')) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');

    if (folder && item.dataset.treeExpandable === 'true') {
      item.setAttribute('aria-expanded', String(item.dataset.treeExpanded === 'true'));
    } else {
      item.removeAttribute('aria-expanded');
    }
    item.tabIndex = item === tabbable ? 0 : -1;
  });
}

function activate(item) {
  const eventName = item.dataset.treeActivateEvent === 'dblclick' ? 'dblclick' : 'click';
  item.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
}

function openContextMenu(item) {
  const rect = item.getBoundingClientRect();
  item.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: Math.round(rect.left + Math.min(rect.width / 2, 48)),
    clientY: Math.round(rect.top + rect.height / 2),
    view: window,
  }));
}

function findParent(items, index) {
  const level = itemLevel(items[index]);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (itemLevel(items[cursor]) < level) return items[cursor];
  }
  return null;
}

function handleKeydown(event, container, controller) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target.closest('input, textarea, select, button, [contenteditable="true"]')) return;

  const item = event.target.closest('.tree-item');
  const items = treeItems(container);
  const index = items.indexOf(item);
  if (index < 0) return;

  let next = null;
  switch (event.key) {
    case 'ArrowDown': next = items[Math.min(index + 1, items.length - 1)]; break;
    case 'ArrowUp': next = items[Math.max(index - 1, 0)]; break;
    case 'Home': next = items[0]; break;
    case 'End': next = items[items.length - 1]; break;
    case 'ArrowRight': {
      if (item.dataset.isFolder !== 'true') return;
      if (item.getAttribute('aria-expanded') === 'false') activate(item);
      else if (item.getAttribute('aria-expanded') === 'true'
        && items[index + 1] && itemLevel(items[index + 1]) > itemLevel(item)) next = items[index + 1];
      else if (!item.hasAttribute('aria-expanded')) activate(item);
      break;
    }
    case 'ArrowLeft': {
      if (item.getAttribute('aria-expanded') === 'true') activate(item);
      else next = findParent(items, index);
      break;
    }
    case 'Enter': activate(item); break;
    case ' ': {
      const checkbox = item.querySelector(':scope > .tree-item-checkbox.visible');
      if (checkbox) checkbox.click();
      else activate(item);
      break;
    }
    case 'F2':
      if (item.dataset.path && !item.classList.contains('back-item')) controller.onRename?.(item);
      break;
    case 'ContextMenu': openContextMenu(item); break;
    case 'F10':
      if (!event.shiftKey) return;
      openContextMenu(item);
      break;
    default: {
      if (event.key.length !== 1 || !/[\p{L}\p{N}_ .-]/u.test(event.key)) return;
      const now = Date.now();
      const key = event.key.toLocaleLowerCase();
      const expired = now - controller.typeaheadAt > TYPEAHEAD_RESET_MS;
      const repeated = !expired && controller.typeahead && [...controller.typeahead].every((character) => character === key);
      controller.typeahead = expired || repeated ? key : controller.typeahead + key;
      controller.typeaheadAt = now;
      const ordered = [...items.slice(index + 1), ...items.slice(0, index + 1)];
      next = ordered.find((candidate) => itemLabel(candidate).toLocaleLowerCase().startsWith(controller.typeahead));
      break;
    }
  }

  event.preventDefault();
  event.stopPropagation();
  if (next) setFocusedItem(container, next);
  requestAnimationFrame(() => syncTree(container));
}

export function configureTreeKeyboard(container, { label = '', onRename = null } = {}) {
  if (!container) return;
  let controller = controllers.get(container);
  if (!controller) {
    controller = { onRename, typeahead: '', typeaheadAt: 0 };
    controller.observer = new MutationObserver(() => syncTree(container));
    controller.observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'checked', 'data-tree-expanded'] });
    container.addEventListener('keydown', (event) => handleKeydown(event, container, controller));
    container.addEventListener('focusin', (event) => {
      const item = event.target.closest('.tree-item');
      if (item) setFocusedItem(container, item, { focus: false });
    });
    controllers.set(container, controller);
  }
  controller.onRename = onRename;
  if (label) container.setAttribute('aria-label', label);
  syncTree(container);
}

export function markTreeItem(item, { folder = false, expanded = null, activateEvent = 'click' } = {}) {
  item.dataset.isFolder = folder ? 'true' : 'false';
  item.dataset.treeActivateEvent = activateEvent;
  if (folder && expanded !== null) {
    item.dataset.treeExpandable = 'true';
    item.dataset.treeExpanded = expanded ? 'true' : 'false';
  } else {
    delete item.dataset.treeExpandable;
    delete item.dataset.treeExpanded;
  }
  return item;
}
