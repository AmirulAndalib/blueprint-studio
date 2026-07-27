/** Shared constraints for remembered workspace panel proportions. */

export const SIDEBAR_MIN_WIDTH = 248;
export const SIDEBAR_MAX_WIDTH = 500;
export const AI_SIDEBAR_MIN_WIDTH = 280;
export const AI_SIDEBAR_MAX_WIDTH = 600;
export const TERMINAL_MIN_HEIGHT = 140;
export const TERMINAL_DEFAULT_HEIGHT = 300;
export const SPLIT_MIN_PERCENT = 25;
export const SPLIT_MAX_PERCENT = 75;

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
