/** RECENT-FILES.JS | Purpose: Tracks and displays recently opened files for quick access. */
import { state } from './state.js';
import { MAX_RECENT_FILES } from './constants.js';
import { getFileIcon, isMobile } from './utils.js';
import { enableLongPressContextMenu } from './utils.js';
import { eventBus } from './event-bus.js';

/**
 * Render the recent files panel in the sidebar
 */
export function renderRecentFilesPanel() {
  const recentFilesContainer = document.getElementById("recent-files-panel");
  if (!recentFilesContainer) return;

  if (!state.showRecentFiles) {
    recentFilesContainer.style.display = "none";
    return;
  }

  // Filter existing files and apply limit
  const limit = state.recentFilesLimit || MAX_RECENT_FILES;
  const existingRecentFiles = state.recentFiles
    .filter(filePath => state.files.some(f => f.path === filePath))
    .slice(0, limit);

  if (existingRecentFiles.length === 0) {
    recentFilesContainer.style.display = "none";
    return;
  }

  recentFilesContainer.style.display = "block";
  recentFilesContainer.innerHTML = '<div class="recent-files-header">Recent Files</div><div class="recent-files-list" id="recent-files-list"></div>';
  const listContainer = document.getElementById("recent-files-list");

  existingRecentFiles.forEach((filePath) => {
    const fileName = filePath.split("/").pop();
    const item = document.createElement("div");
    item.className = "tree-item recent-item";
    item.style.setProperty("--depth", 0);

    const fileIcon = getFileIcon(filePath);
    const isActive = state.activeTab && state.activeTab.path === filePath;

    item.innerHTML = `
      <div class="tree-chevron hidden"></div>
      <div class="tree-icon ${fileIcon.class}">
        <span class="ui-icon material-icons recent-file-icon">${fileIcon.icon}</span>
      </div>
      <span class="tree-name">${fileName}</span>
    `;

    if (isActive) {
      item.classList.add("active");
    }

    const tab = state.openTabs.find((t) => t.path === filePath);
    if (tab && tab.modified) {
      item.classList.add("modified");
    }

    item.addEventListener("click", (e) => {
      eventBus.emit('file:open', { path: filePath });
      if (isMobile()) eventBus.emit('ui:hide-sidebar');
    });

    // Context menu
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      eventBus.emit('file:context-menu', { x: e.clientX, y: e.clientY, path: filePath, isFolder: false });
    });
    enableLongPressContextMenu(item);

    listContainer.appendChild(item);
  });
}

/**
 * Add a file to the recent files list
 * @param {string} path - The file path to add
 */
export function addToRecentFiles(path) {
  if (!state.recentFiles) {
    state.recentFiles = [];
  }

  // Remove if already exists (to avoid duplicates)
  state.recentFiles = state.recentFiles.filter(p => p !== path);

  // Add to beginning of list
  state.recentFiles.unshift(path);

  // Limit to max size
  const limit = state.recentFilesLimit || MAX_RECENT_FILES;
  state.recentFiles = state.recentFiles.slice(0, limit);
}
