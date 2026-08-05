/** Shared constraints for remembered workspace panel proportions. */

export const SIDEBAR_MIN_WIDTH = 248;
export const SIDEBAR_MAX_WIDTH = 500;
export const AI_SIDEBAR_MIN_WIDTH = 280;
export const AI_SIDEBAR_MAX_WIDTH = 600;
export const TERMINAL_MIN_HEIGHT = 140;
export const TERMINAL_DEFAULT_HEIGHT = 300;
export const SPLIT_MIN_PERCENT = 25;
export const SPLIT_MAX_PERCENT = 75;
export const WORKSPACE_MODE_DESKTOP = 'desktop';
export const WORKSPACE_MODE_COMPACT = 'compact';
export const WORKSPACE_MODE_PHONE = 'phone';
export const WORKSPACE_COMPACT_MAX_WIDTH = 1100;
export const WORKSPACE_PHONE_MAX_WIDTH = 600;

let workspaceResizeObserver = null;
let applyViewportEnvironment = null;

export function clamp(value, minimum, maximum, fallback) {
  const numericValue = Number(value);
  const normalized = Number.isFinite(numericValue) ? numericValue : fallback;
  return Math.min(maximum, Math.max(minimum, normalized));
}

export function getSidebarMaxWidth() {
  const workspaceWidth = document.querySelector('.main-container')?.getBoundingClientRect().width || window.innerWidth;
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, workspaceWidth - 320));
}

export function constrainSidebarWidth(width) {
  return clamp(width, SIDEBAR_MIN_WIDTH, getSidebarMaxWidth(), 320);
}

export function getAiSidebarMaxWidth() {
  const workspaceWidth = document.querySelector('.main-content')?.getBoundingClientRect().width || window.innerWidth;
  return Math.max(AI_SIDEBAR_MIN_WIDTH, Math.min(AI_SIDEBAR_MAX_WIDTH, Math.floor(workspaceWidth * 0.55)));
}

export function constrainAiSidebarWidth(width) {
  return clamp(width, AI_SIDEBAR_MIN_WIDTH, getAiSidebarMaxWidth(), 350);
}

export function getTerminalMaxHeight() {
  return Math.max(TERMINAL_MIN_HEIGHT, Math.floor(window.innerHeight * 0.65));
}

export function constrainTerminalHeight(height) {
  return clamp(height, TERMINAL_MIN_HEIGHT, getTerminalMaxHeight(), TERMINAL_DEFAULT_HEIGHT);
}

export function constrainSplitPercent(percent) {
  return clamp(percent, SPLIT_MIN_PERCENT, SPLIT_MAX_PERCENT, 50);
}

export function getWorkspaceMode(width) {
  const usableWidth = Number(width);
  if (!Number.isFinite(usableWidth)) return WORKSPACE_MODE_DESKTOP;
  if (usableWidth <= WORKSPACE_PHONE_MAX_WIDTH) return WORKSPACE_MODE_PHONE;
  if (usableWidth <= WORKSPACE_COMPACT_MAX_WIDTH) return WORKSPACE_MODE_COMPACT;
  return WORKSPACE_MODE_DESKTOP;
}

export function isWorkspaceDrawerMode(mode = document.body?.dataset.workspaceMode) {
  return mode === WORKSPACE_MODE_COMPACT || mode === WORKSPACE_MODE_PHONE;
}

function getAppShellMode() {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  if (standalone) return 'standalone';
  try {
    if (window.parent && window.parent !== window) return 'embedded';
  } catch {
    return 'embedded';
  }
  return 'browser';
}

export function refreshViewportEnvironment() {
  applyViewportEnvironment?.();
}

export function initViewportEnvironment(callbacks) {
  const onBeforeChange = typeof callbacks === 'object' ? callbacks?.onBeforeChange : null;
  const onChange = typeof callbacks === 'function' ? callbacks : callbacks?.onChange;
  const root = document.documentElement;
  const visualViewport = window.visualViewport;
  const standaloneQuery = window.matchMedia?.('(display-mode: standalone)');
  let stableViewportHeight = 0;
  let stableViewportWidth = 0;
  let scheduledFrame = 0;
  let previousSignature = '';

  const apply = () => {
    scheduledFrame = 0;
    const layoutHeight = Math.round(root.clientHeight || window.innerHeight || 0);
    const layoutWidth = Math.round(root.clientWidth || window.innerWidth || 0);
    const visualHeight = Math.round(visualViewport?.height || layoutHeight);
    const visualOffsetTop = Math.max(0, Math.round(visualViewport?.offsetTop || 0));
    const viewportScale = Number(visualViewport?.scale || 1);
    const zoomed = Math.abs(viewportScale - 1) > 0.05;
    const phone = document.body.dataset.workspaceMode === WORKSPACE_MODE_PHONE;

    if (!stableViewportWidth || Math.abs(layoutWidth - stableViewportWidth) > 2) {
      stableViewportWidth = layoutWidth;
      stableViewportHeight = Math.max(layoutHeight, visualHeight);
    }
    if (!stableViewportHeight) stableViewportHeight = Math.max(layoutHeight, visualHeight);
    const keyboardInset = Math.max(0, stableViewportHeight - visualHeight);
    const keyboardVisible = phone && !zoomed && keyboardInset >= 120;
    if (!keyboardVisible && layoutHeight > stableViewportHeight) stableViewportHeight = layoutHeight;

    const appHeight = keyboardVisible ? visualHeight : layoutHeight;
    const shellMode = getAppShellMode();
    const metrics = {
      appHeight,
      keyboardInset: keyboardVisible ? keyboardInset : 0,
      keyboardVisible,
      layoutHeight,
      layoutWidth,
      shellMode,
      visualHeight,
      visualOffsetTop,
      viewportScale,
      zoomed,
    };
    const signature = JSON.stringify(metrics);
    const changed = signature !== previousSignature;
    if (changed) {
      previousSignature = signature;
      onBeforeChange?.(metrics);
    }

    root.style.setProperty('--app-viewport-height', `${appHeight}px`);
    root.style.setProperty('--visual-viewport-height', `${visualHeight}px`);
    root.style.setProperty('--visual-viewport-offset-top', `${keyboardVisible ? visualOffsetTop : 0}px`);
    root.style.setProperty('--keyboard-inset', `${keyboardVisible ? keyboardInset : 0}px`);
    document.body.dataset.appShell = shellMode;
    document.body.dataset.keyboardVisible = String(keyboardVisible);
    document.body.dataset.viewportZoomed = String(zoomed);

    if (changed) {
      onChange?.(metrics);
    }
  };

  const schedule = () => {
    if (scheduledFrame) return;
    scheduledFrame = requestAnimationFrame(apply);
  };
  const resetStableHeight = () => {
    stableViewportHeight = 0;
    stableViewportWidth = 0;
    schedule();
    setTimeout(schedule, 250);
  };

  applyViewportEnvironment = schedule;
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', resetStableHeight, { passive: true });
  visualViewport?.addEventListener('resize', schedule, { passive: true });
  visualViewport?.addEventListener('scroll', schedule, { passive: true });
  standaloneQuery?.addEventListener?.('change', schedule);
  apply();

  return () => {
    if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', resetStableHeight);
    visualViewport?.removeEventListener('resize', schedule);
    visualViewport?.removeEventListener('scroll', schedule);
    standaloneQuery?.removeEventListener?.('change', schedule);
    if (applyViewportEnvironment === schedule) applyViewportEnvironment = null;
  };
}

export function initWorkspaceMode(callbacks) {
  const onBeforeChange = typeof callbacks === 'object' ? callbacks?.onBeforeChange : null;
  const onChange = typeof callbacks === 'function' ? callbacks : callbacks?.onChange;
  const workspace = document.querySelector('.main-container');
  if (!workspace) return () => {};

  const applyMode = (width = workspace.getBoundingClientRect().width) => {
    const mode = getWorkspaceMode(width || window.innerWidth);
    const previousMode = document.body.dataset.workspaceMode;
    if (mode !== previousMode) onBeforeChange?.(mode, previousMode);
    document.body.dataset.workspaceMode = mode;
    workspace.dataset.workspaceMode = mode;
    if (mode !== previousMode) onChange?.(mode, previousMode);
  };

  workspaceResizeObserver?.disconnect();
  if (typeof ResizeObserver === 'function') {
    workspaceResizeObserver = new ResizeObserver((entries) => {
      applyMode(entries[0]?.contentRect.width);
    });
    workspaceResizeObserver.observe(workspace);
  } else {
    window.addEventListener('resize', applyMode);
  }
  applyMode();

  return () => {
    workspaceResizeObserver?.disconnect();
    workspaceResizeObserver = null;
    window.removeEventListener('resize', applyMode);
  };
}
