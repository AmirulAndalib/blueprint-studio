/** CONTEXT-MENU.JS | Purpose: Right-click context menus for files, folders, and tabs. */
import { state, elements } from './state.js';

/**
 * Shows context menu for files/folders at specified position
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {Object} target - Target file/folder object
 */
export function showContextMenu(x, y, target) {
  state.contextMenuTarget = target;

  const menu = elements.contextMenu;
  
  // Show/hide based on folder status
  const isFolder = target.isFolder;
  const isRoot = target.isRoot;
  
  const folderOnlyActions = menu.querySelectorAll('[data-action="upload"], [data-action="upload_folder"]');
  folderOnlyActions.forEach(el => {
    el.style.display = isFolder ? 'flex' : 'none';
  });

  // Hide specific actions if it's the root directory (empty space)
  const itemActions = menu.querySelectorAll('[data-action="rename"], [data-action="move"], [data-action="copy"], [data-action="duplicate"], [data-action="download"], [data-action="delete"]');
  itemActions.forEach(el => {
    el.style.display = isRoot ? 'none' : 'flex';
  });
  
  // Update dividers
  const uploadDivider = menu.querySelector('[data-action="upload"]').previousElementSibling;
  if (uploadDivider && uploadDivider.classList.contains('context-menu-divider')) {
    uploadDivider.style.display = isFolder ? 'block' : 'none';
  }
  
  const itemDivider = menu.querySelector('[data-action="rename"]').previousElementSibling;
  if (itemDivider && itemDivider.classList.contains('context-menu-divider')) {
    itemDivider.style.display = isRoot ? 'none' : 'block';
  }

  // Show/hide terminal option
  const terminalItem = menu.querySelector('[data-action="run_in_terminal"]');
  if (terminalItem) {
    terminalItem.style.display = (state.terminalIntegrationEnabled && !isRoot) ? 'flex' : 'none';
    // Also hide the divider above it if needed, but let's just hide the item for now.
    // Looking at HTML, there's a divider above run_in_terminal.
    const divider = terminalItem.previousElementSibling;
    if (divider && divider.classList.contains('context-menu-divider')) {
        divider.style.display = state.terminalIntegrationEnabled ? 'block' : 'none';
    }
  }

  menu.classList.add("visible");

  // Position menu
  const menuRect = menu.getBoundingClientRect();
  const viewWidth = window.innerWidth;
  const viewHeight = window.innerHeight;

  let posX = x;
  let posY = y;

  if (x + menuRect.width > viewWidth) {
    posX = viewWidth - menuRect.width - 10;
  }
  if (y + menuRect.height > viewHeight) {
    posY = viewHeight - menuRect.height - 10;
  }

  menu.style.left = `${posX}px`;
  menu.style.top = `${posY}px`;
}

/**
 * Shows context menu for tabs at specified position
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {Object} tab - Target tab object
 * @param {number} tabIndex - Index of the tab in openTabs array
 */
export function showTabContextMenu(x, y, tab, tabIndex) {
  state.tabContextMenuTarget = tab;
  state.tabContextMenuTargetIndex = tabIndex;
  const menu = elements.tabContextMenu;
  if (!menu) return;

  // Update menu items visibility based on split view state
  const moveToLeft = document.getElementById('tab-menu-move-to-left');
  const moveToRight = document.getElementById('tab-menu-move-to-right');
  const openRight = document.getElementById('tab-menu-open-right');
  const openBelow = document.getElementById('tab-menu-open-below');
  const splitDivider = document.getElementById('tab-menu-split-divider');

  // Check if split view feature is enabled in settings
  if (!state.enableSplitView) {
    // Feature is disabled - hide all split view options
    if (moveToLeft) moveToLeft.style.display = 'none';
    if (moveToRight) moveToRight.style.display = 'none';
    if (openRight) openRight.style.display = 'none';
    if (openBelow) openBelow.style.display = 'none';
    if (splitDivider) splitDivider.style.display = 'none';
  } else if (state.splitView && state.splitView.enabled) {
    // Split view is enabled - show move options based on current pane
    const pane = state.splitView.primaryTabs.includes(tabIndex) ? 'primary' :
                 state.splitView.secondaryTabs.includes(tabIndex) ? 'secondary' : null;

    if (pane === 'primary') {
      // In left/top pane - show "Move to Right/Bottom"
      if (moveToLeft) moveToLeft.style.display = 'none';
      if (moveToRight) {
        moveToRight.style.display = 'flex';
        moveToRight.querySelector('.material-icons').textContent =
          state.splitView.orientation === 'vertical' ? 'arrow_forward' : 'arrow_downward';
        moveToRight.innerHTML = `
          <span class="ui-icon material-icons context-menu-icon">${state.splitView.orientation === 'vertical' ? 'arrow_forward' : 'arrow_downward'}</span>
          Move to ${state.splitView.orientation === 'vertical' ? 'Right' : 'Bottom'} Pane
        `;
      }
      if (splitDivider) splitDivider.style.display = 'block';
    } else if (pane === 'secondary') {
      // In right/bottom pane - show "Move to Left/Top"
      if (moveToRight) moveToRight.style.display = 'none';
      if (moveToLeft) {
        moveToLeft.style.display = 'flex';
        moveToLeft.querySelector('.material-icons').textContent =
          state.splitView.orientation === 'vertical' ? 'arrow_back' : 'arrow_upward';
        moveToLeft.innerHTML = `
          <span class="ui-icon material-icons context-menu-icon">${state.splitView.orientation === 'vertical' ? 'arrow_back' : 'arrow_upward'}</span>
          Move to ${state.splitView.orientation === 'vertical' ? 'Left' : 'Top'} Pane
        `;
      }
      if (splitDivider) splitDivider.style.display = 'block';
    }
    // Hide "open" options when split is already enabled
    if (openRight) openRight.style.display = 'none';
    if (openBelow) openBelow.style.display = 'none';
  } else {
    // Split view is disabled - show "Open to Right/Below" options
    if (moveToLeft) moveToLeft.style.display = 'none';
    if (moveToRight) moveToRight.style.display = 'none';
    if (openRight) openRight.style.display = 'flex';
    if (openBelow) openBelow.style.display = 'flex';
    if (splitDivider) splitDivider.style.display = 'block';
  }

  menu.classList.add("visible");

  // Position menu
  const menuRect = menu.getBoundingClientRect();
  const viewWidth = window.innerWidth;
  const viewHeight = window.innerHeight;

  let posX = x;
  let posY = y;

  if (x + menuRect.width > viewWidth) {
    posX = viewWidth - menuRect.width - 10;
  }
  if (y + menuRect.height > viewHeight) {
    posY = viewHeight - menuRect.height - 10;
  }

  menu.style.left = `${posX}px`;
  menu.style.top = `${posY}px`;
}

/**
 * Hides all context menus
 */
export function hideContextMenu() {
  elements.contextMenu.classList.remove("visible");
  if (elements.tabContextMenu) elements.tabContextMenu.classList.remove("visible");
  state.contextMenuTarget = null;
  state.tabContextMenuTarget = null;
}
