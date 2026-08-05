/** Preserve a tree's visible working position across DOM-only refreshes. */

const pendingRestores = new WeakMap();

export function captureTreeViewContext(tree) {
  if (!tree) return null;

  const activeElement = document.activeElement;
  const focusedItem = activeElement instanceof Element
    ? activeElement.closest('.tree-item[data-path]')
    : null;

  if (!focusedItem || !tree.contains(focusedItem)) {
    return { scrollTop: tree.scrollTop, focusedPath: null, focusedControl: null };
  }

  const focusedControl = activeElement.matches('.tree-item-checkbox')
    ? '.tree-item-checkbox'
    : null;

  return {
    scrollTop: tree.scrollTop,
    focusedPath: focusedItem.dataset.path || null,
    focusedControl,
  };
}

export function scheduleTreeViewContextRestore(tree, context) {
  if (!tree || !context) return;

  const pending = pendingRestores.get(tree);
  if (pending) cancelAnimationFrame(pending);

  const frame = requestAnimationFrame(() => {
    pendingRestores.delete(tree);
    tree.scrollTop = context.scrollTop;

    if (!context.focusedPath) return;
    const focusedItem = Array.from(tree.querySelectorAll('.tree-item[data-path]'))
      .find((item) => item.dataset.path === context.focusedPath);
    if (!focusedItem) return;

    const target = context.focusedControl
      ? focusedItem.querySelector(context.focusedControl)
      : focusedItem;
    target?.focus({ preventScroll: true });
  });

  pendingRestores.set(tree, frame);
}
