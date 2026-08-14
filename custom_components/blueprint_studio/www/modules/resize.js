/** RESIZE.JS | Purpose: Sidebar drag-to-resize functionality. Allows user to adjust */
import { state, elements } from './state.js';
import { eventBus } from './event-bus.js';
import {
  constrainSidebarWidth,
  getSidebarMaxWidth,
  isWorkspaceDrawerMode,
  SIDEBAR_MIN_WIDTH,
} from './workspace-layout.js';
import { captureEditorViewports, scheduleEditorViewportRestore } from './editor-viewport.js';

/**
 * Initialize the sidebar resize handle
 * Sets up drag handlers for resizing the sidebar
 */
export function initResizeHandle() {
  if (!elements.resizeHandle) return;

  let isResizing = false;
  let editorSnapshots = [];

  const applyWidth = (width) => {
    if (isWorkspaceDrawerMode()) {
      elements.sidebar.style.removeProperty('width');
      return constrainSidebarWidth(width);
    }
    const nextWidth = constrainSidebarWidth(width);
    elements.sidebar.style.width = `${nextWidth}px`;
    elements.resizeHandle.setAttribute('aria-valuemin', String(SIDEBAR_MIN_WIDTH));
    elements.resizeHandle.setAttribute('aria-valuemax', String(getSidebarMaxWidth()));
    elements.resizeHandle.setAttribute('aria-valuenow', String(Math.round(nextWidth)));
    return nextWidth;
  };

  const saveWidth = () => {
    state.sidebarWidth = Math.round(elements.sidebar.getBoundingClientRect().width);
    eventBus.emit('settings:save');
    state.editor?.refresh();
  };

  elements.resizeHandle.addEventListener("pointerdown", (e) => {
    if (isWorkspaceDrawerMode()) return;
    isResizing = true;
    editorSnapshots = captureEditorViewports();
    elements.resizeHandle.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    elements.resizeHandle.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });

  elements.resizeHandle.addEventListener("pointermove", (e) => {
    if (!isResizing) return;
    applyWidth(e.clientX);
  });

  const finishResize = () => {
    if (isResizing) {
      isResizing = false;
      elements.resizeHandle.classList.remove("active");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      saveWidth();
      scheduleEditorViewportRestore(editorSnapshots);
    }
  };

  elements.resizeHandle.addEventListener("pointerup", finishResize);
  elements.resizeHandle.addEventListener("pointercancel", finishResize);
  elements.resizeHandle.addEventListener('keydown', (event) => {
    const currentWidth = elements.sidebar.getBoundingClientRect().width;
    const step = event.shiftKey ? 40 : 10;
    let nextWidth = currentWidth;
    if (event.key === 'ArrowLeft') nextWidth -= step;
    else if (event.key === 'ArrowRight') nextWidth += step;
    else if (event.key === 'Home') nextWidth = SIDEBAR_MIN_WIDTH;
    else if (event.key === 'End') nextWidth = getSidebarMaxWidth();
    else return;
    event.preventDefault();
    const snapshots = captureEditorViewports();
    applyWidth(nextWidth);
    saveWidth();
    scheduleEditorViewportRestore(snapshots);
  });

  window.addEventListener('resize', () => applyWidth(state.sidebarWidth));
  applyWidth(state.sidebarWidth);
}
