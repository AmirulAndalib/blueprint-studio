/** FAVORITES.JS | Purpose: Manages favorite files - add, remove, persist, render panel. */
import { state, elements } from './state.js';
import { showToast } from './ui.js';
import { getFileIcon, isMobile } from './utils.js';
import { eventBus } from './event-bus.js';
import { t } from './translations.js';

/**
 * Check if a file path is favorited
 * @param {string} path - File path
 * @returns {boolean}
 */
export function isFavorite(path) {
  return state.favoriteFiles.includes(path);
}

/**
 * Toggle favorite status of a file
 * @param {string} path - File path
 */
export function toggleFavorite(path) {
  if (isFavorite(path)) {
    state.favoriteFiles = state.favoriteFiles.filter(p => p !== path);
    showToast(t('toast.favorite_removed', { file: path.split("/").pop() }), "success");
  } else {
    state.favoriteFiles.push(path);
    showToast(t('toast.favorite_added', { file: path.split("/").pop() }), "success");
  }

  eventBus.emit('settings:save');
  eventBus.emit('ui:refresh-tree');
  renderFavoritesPanel();
}

/**
 * Render the favorites panel in the sidebar
 */
export function renderFavoritesPanel() {
  const favoritesPanel = document.getElementById("favorites-panel");
  if (!favoritesPanel) return;

  // Use the inner favorites-tree container if it exists, otherwise fall back to the panel itself
  const favoritesTree = document.getElementById("favorites-tree") || favoritesPanel;

  // Show all favorites — don't filter against loaded items since in navigation
  // mode (lazy loading) only the current directory's files are in state.files.
  // If a favorited file was deleted, clicking it will simply fail to open.
  const validFavorites = state.favoriteFiles;

  if (validFavorites.length === 0) {
    favoritesPanel.style.display = "none";
    return;
  }

  favoritesPanel.style.display = "block";

  // Only clear the tree container, not the whole panel (preserves the header element)
  favoritesTree.innerHTML = "";

  validFavorites.forEach((filePath) => {
    const fileName = filePath.split("/").pop();
    const item = document.createElement("div");
    item.className = "tree-item favorite-item";
    item.style.setProperty("--depth", 0);

    const fileIcon = getFileIcon(filePath);
    const isActive = state.activeTab && state.activeTab.path === filePath;

    item.innerHTML = `
      <div class="tree-chevron hidden"></div>
      <div class="tree-icon ${fileIcon.class}">
        <span class="ui-icon material-icons favorite-file-icon">${fileIcon.icon}</span>
      </div>
      <span class="tree-name">${fileName}</span>
      <div class="tree-item-actions">
        <button class="tree-action-btn" title="${t('favorites.unpin')}" aria-label="${t('favorites.unpin')}">
          <span class="ui-icon material-icons favorite-unpin-icon">push_pin</span>
        </button>
      </div>
    `;

    if (isActive) {
      item.classList.add("active");
    }

    const tab = state.openTabs.find((t) => t.path === filePath);
    if (tab && tab.modified) {
      item.classList.add("modified");
      item.setAttribute("aria-label", `${filePath}, ${t('sidebar.unsaved')}`);
    } else {
      item.setAttribute("aria-label", filePath);
    }

    item.addEventListener("click", (e) => {
      if (e.target.closest(".tree-action-btn")) {
        toggleFavorite(filePath);
      } else {
        eventBus.emit('file:open', { path: filePath });
        if (isMobile()) eventBus.emit('ui:hide-sidebar');
      }
    });

    favoritesTree.appendChild(item);
  });
}
