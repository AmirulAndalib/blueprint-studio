/** DIALOG-MANAGER.JS | Owns modal focus, dismissal, stacking, and scroll containment. */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const dialogStack = [];

function visibleFocusables(overlay) {
  return Array.from(overlay.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => {
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  });
}

function resolveFocusTarget(entry) {
  const requested = typeof entry.initialFocus === 'function' ? entry.initialFocus() : entry.initialFocus;
  if (requested instanceof HTMLElement) return requested;
  if (typeof requested === 'string') return entry.overlay.querySelector(requested);
  return visibleFocusables(entry.overlay)[0]
    || entry.overlay.querySelector('[role="dialog"]')
    || entry.overlay;
}

function syncScrollContainment() {
  document.body.classList.toggle('dialog-open', dialogStack.length > 0);
}

function topDialog() {
  while (dialogStack.length && !dialogStack.at(-1).overlay.isConnected) dialogStack.pop();
  return dialogStack.at(-1) || null;
}

function requestClose(entry, reason) {
  if (typeof entry.onRequestClose === 'function') {
    entry.onRequestClose(reason);
    return;
  }

  const closeControl = entry.overlay.querySelector('[data-dialog-close], .modal-close');
  closeControl?.click();
  if (entry.overlay.dataset.dialogManaged === 'true') {
    closeDialog(entry.overlay, { remove: entry.removeOnClose });
  }
}

export function openDialog(overlay, options = {}) {
  if (!overlay) return null;
  const existingIndex = dialogStack.findIndex((entry) => entry.overlay === overlay);
  if (existingIndex >= 0) dialogStack.splice(existingIndex, 1);

  const activeElement = document.activeElement;
  const entry = {
    overlay,
    initialFocus: options.initialFocus || null,
    returnFocus: options.returnFocus || (activeElement instanceof HTMLElement ? activeElement : null),
    closeOnEscape: options.closeOnEscape !== false,
    closeOnBackdrop: options.closeOnBackdrop !== false,
    removeOnClose: options.removeOnClose === true,
    onRequestClose: options.onRequestClose || null,
  };
  dialogStack.push(entry);
  overlay.dataset.dialogManaged = 'true';
  overlay.classList.add('visible');
  syncScrollContainment();

  queueMicrotask(() => {
    if (topDialog() !== entry) return;
    const target = resolveFocusTarget(entry);
    if (target && !target.hasAttribute('tabindex') && target.matches('[role="dialog"]')) {
      target.setAttribute('tabindex', '-1');
    }
    target?.focus();
  });
  return entry;
}

export function closeDialog(overlay, options = {}) {
  if (!overlay) return null;
  const index = dialogStack.findIndex((entry) => entry.overlay === overlay);
  const entry = index >= 0 ? dialogStack.splice(index, 1)[0] : null;
  overlay.classList.remove('visible');
  delete overlay.dataset.dialogManaged;
  if (options.remove === true || entry?.removeOnClose) overlay.remove();
  syncScrollContainment();

  if (options.restoreFocus !== false && entry?.returnFocus?.isConnected) {
    entry.returnFocus.focus();
  } else if (topDialog()) {
    resolveFocusTarget(topDialog())?.focus();
  }
  return entry?.returnFocus || null;
}

export function closeTopDialog(reason = 'programmatic') {
  const entry = topDialog();
  if (!entry) return false;
  requestClose(entry, reason);
  return true;
}

export function hasOpenDialog() {
  return Boolean(topDialog());
}

document.addEventListener('keydown', (event) => {
  const entry = topDialog();
  if (!entry) return;

  if (event.key === 'Escape' && entry.closeOnEscape) {
    event.preventDefault();
    event.stopImmediatePropagation();
    requestClose(entry, 'escape');
    return;
  }

  if (event.key !== 'Tab') return;
  const focusables = visibleFocusables(entry.overlay);
  if (!focusables.length) {
    event.preventDefault();
    resolveFocusTarget(entry)?.focus();
    return;
  }

  const first = focusables[0];
  const last = focusables.at(-1);
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !entry.overlay.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !entry.overlay.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}, true);

document.addEventListener('click', (event) => {
  const entry = topDialog();
  if (!entry?.closeOnBackdrop || event.target !== entry.overlay) return;
  event.preventDefault();
  requestClose(entry, 'backdrop');
});
