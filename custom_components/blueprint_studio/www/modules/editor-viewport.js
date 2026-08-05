import { state } from './state.js';

const CURSOR_MARGIN = 24;

function editorInstances() {
  return [...new Set([state.primaryEditor, state.secondaryEditor].filter(Boolean))];
}

function cursorOffset(editor, cursor, wrapper) {
  try {
    return editor.cursorCoords(cursor, 'page').top - wrapper.getBoundingClientRect().top;
  } catch {
    return 0;
  }
}

export function captureEditorViewports(editors = editorInstances()) {
  return editors.map((editor) => {
    const wrapper = editor.getWrapperElement();
    const cursor = editor.getCursor();
    const scroll = editor.getScrollInfo();
    return {
      cursor,
      cursorOffset: cursorOffset(editor, cursor, wrapper),
      editor,
      focused: Boolean(editor.hasFocus?.() || wrapper.contains(document.activeElement)),
      scrollLeft: scroll.left,
      scrollTop: scroll.top,
    };
  });
}

export function restoreEditorViewports(snapshots = []) {
  for (const snapshot of snapshots) {
    const { editor } = snapshot;
    const wrapper = editor?.getWrapperElement?.();
    if (!editor || !wrapper?.isConnected) continue;

    editor.refresh();
    editor.scrollTo(snapshot.scrollLeft, snapshot.scrollTop);
    if (!snapshot.focused || wrapper.getBoundingClientRect().height <= 0) continue;

    const cursor = editor.getCursor();
    const wrapperHeight = wrapper.getBoundingClientRect().height;
    const lineHeight = editor.defaultTextHeight?.() || 20;
    const maximumOffset = Math.max(CURSOR_MARGIN, wrapperHeight - lineHeight - CURSOR_MARGIN);
    const desiredOffset = Math.min(maximumOffset, Math.max(CURSOR_MARGIN, snapshot.cursorOffset));
    const currentOffset = cursorOffset(editor, cursor, wrapper);
    const currentScroll = editor.getScrollInfo();
    editor.scrollTo(snapshot.scrollLeft, Math.max(0, currentScroll.top + currentOffset - desiredOffset));
    editor.scrollIntoView(cursor, CURSOR_MARGIN);
  }
}

export function scheduleEditorViewportRestore(snapshots = captureEditorViewports()) {
  requestAnimationFrame(() => restoreEditorViewports(snapshots));
  return snapshots;
}

export function preserveEditorViewports(change) {
  const snapshots = captureEditorViewports();
  const result = change?.();
  scheduleEditorViewportRestore(snapshots);
  return result;
}
