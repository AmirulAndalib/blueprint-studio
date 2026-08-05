/** SIDEBAR.JS | Purpose: * Manages sidebar visibility, view switching (files/git/gitea/search/settings), */
import { state, elements } from './state.js';
import { eventBus } from './event-bus.js';
import { refreshActivityRail } from './activity-rail.js';
import { isWorkspaceDrawerMode } from './workspace-layout.js?v=2.5.188';
import { preserveEditorViewports } from './editor-viewport.js?v=2.5.188';

/**
 * Shows the sidebar
 */
export function showSidebar() {
  const applyVisibility = () => {
    if (isWorkspaceDrawerMode() && state.aiSidebarVisible) {
      eventBus.emit('ui:toggle-ai-sidebar', false);
    }
    state.sidebarVisible = true;
    // Always apply both class sets so rotating between portrait/landscape
    // never leaves the sidebar in a mixed state.
    elements.sidebar.classList.remove("hidden");
    elements.sidebar.classList.add("visible");
    if (isWorkspaceDrawerMode()) {
      elements.sidebarOverlay.classList.add("visible");
    } else {
      elements.sidebarOverlay.classList.remove("visible");
    }
  };
  preserveEditorViewports(applyVisibility);
}

/**
 * Hides the sidebar
 */
export function hideSidebar() {
  preserveEditorViewports(() => {
    state.sidebarVisible = false;
    elements.sidebar.classList.remove("visible");
    elements.sidebar.classList.add("hidden");
    elements.sidebarOverlay.classList.remove("visible");
  });
}

export function syncActivityState(viewName) {
  const activities = [
    [elements.activityExplorer, "explorer"],
    [elements.activitySearch, "search"],
    [elements.activitySourceControl, "source-control"],
    [elements.activitySftp, "sftp"],
  ];
  for (const [activity, name] of activities) {
    if (!activity) continue;
    const selected = viewName === name;
    activity.classList.toggle("active", selected);
    activity.setAttribute("aria-pressed", String(selected));
  }
}

/**
 * Switches sidebar view (explorer, search, etc.)
 * @param {string} viewName - Name of the view to switch to
 */
export function switchSidebarView(viewName) {
  state.activeSidebarView = viewName;
  eventBus.emit('ui:sidebar-view-changed', viewName);
  eventBus.emit('settings:save');

  if (!state.sidebarVisible) {
    showSidebar();
  }

  syncActivityState(viewName);

  if (elements.viewExplorer) {
    elements.viewExplorer.style.display = viewName === "explorer" ? "flex" : "none";
    elements.viewExplorer.classList.toggle("hidden", viewName !== "explorer");
  }
  if (elements.viewSearch) {
    elements.viewSearch.style.display = viewName === "search" ? "flex" : "none";
    elements.viewSearch.classList.toggle("hidden", viewName !== "search");

    if (viewName === "search" && elements.globalSearchInput) {
      setTimeout(() => elements.globalSearchInput.focus(), 100);
    }
  }
  if (elements.viewSourceControl) {
    elements.viewSourceControl.style.display = viewName === "source-control" ? "flex" : "none";
    elements.viewSourceControl.classList.toggle("hidden", viewName !== "source-control");
  }
  if (elements.viewSftp) {
    elements.viewSftp.style.display = viewName === "sftp" ? "flex" : "none";
    elements.viewSftp.classList.toggle("hidden", viewName !== "sftp");
  }
  refreshActivityRail();
}

/**
 * Toggles sidebar visibility
 */
export function toggleSidebar() {
  if (state.sidebarVisible) {
    hideSidebar();
  } else {
    showSidebar();
  }
}
