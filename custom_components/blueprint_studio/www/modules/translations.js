/** TRANSLATIONS.JS | Purpose: No purpose defined. */

import { state, elements } from './state.js';
import { setToolbarControlLabel } from './toolbar.js';

// Cache the loaded languages to avoid re-fetching
const loadedLanguages = {};
let currentBundle = {};
let currentLang = 'en';

function localeUrl(lang) {
  const url = new URL(`../locales/${lang}.json`, import.meta.url);
  url.searchParams.set('v', window.__BS_VERSION__ || '0');
  return url.href;
}

/**
 * Gets a translated string for the given key and current language.
 * @param {string} key - The translation key (e.g., 'toolbar.save')
 * @param {Object} params - Optional parameters for interpolation (e.g., {line: 10})
 * @returns {string} - The translated string
 */
export function t(key, params = {}) {
  // Fallback to key if string is missing
  let str = currentBundle[key] || (loadedLanguages['en'] && loadedLanguages['en'][key]) || key;

  // Simple interpolation: replaces {key} with params.key
  for (const [k, v] of Object.entries(params)) {
    str = str.replace(`{${k}}`, v);
  }

  return str;
}

/**
 * Initializes and loads the required language dynamically.
 * @param {string} lang - The language code to load
 * @returns {Promise<void>}
 */
export async function initTranslations(lang) {
  // Try to use the passed lang, or state language, or default to en
  currentLang = lang || (window.state && window.state.language) || "en";
  
  // Make sure English is always loaded as a fallback
  if (!loadedLanguages['en']) {
    try {
      const response = await fetch(localeUrl('en'));
      if (response.ok) {
        loadedLanguages['en'] = await response.json();
      } else {
        console.error("Failed to load fallback language 'en' (response not ok)");
        loadedLanguages['en'] = {};
      }
    } catch (e) {
      console.error("Failed to load fallback language 'en'", e);
      loadedLanguages['en'] = {};
    }
  }

  // Load the target language
  if (currentLang !== 'en' && !loadedLanguages[currentLang]) {
    try {
      const response = await fetch(localeUrl(currentLang));
      if (response.ok) {
        loadedLanguages[currentLang] = await response.json();
      } else {
        console.warn(`Translation file for '${currentLang}' not found. Falling back to English.`);
        loadedLanguages[currentLang] = loadedLanguages['en'];
      }
    } catch (e) {
      console.error(`Failed to load translation for '${currentLang}'`, e);
      loadedLanguages[currentLang] = loadedLanguages['en'];
    }
  }

  currentBundle = loadedLanguages[currentLang] || loadedLanguages['en'];
  
  // Inform the UI to refresh
  if (window.app && typeof window.app.onLanguageLoaded === 'function') {
    window.app.onLanguageLoaded();
  }
}

/**
 * Refresh all UI strings based on current language
 */
export function refreshAllUIStrings() {
  // Toolbar
  setToolbarControlLabel(elements.btnMenu, t("toolbar.toggle_files"));
  setToolbarControlLabel(elements.btnSave, t("toolbar.save"));
  setToolbarControlLabel(elements.btnSaveAll, t("toolbar.save_all"));
  setToolbarControlLabel(elements.btnUndo, t("toolbar.undo"));
  setToolbarControlLabel(elements.btnRedo, t("toolbar.redo"));
  setToolbarControlLabel(elements.btnFormat, t("toolbar.format"));
  setToolbarControlLabel(elements.btnSearch, t("toolbar.search"));
  
  const btnSplitVertical = document.getElementById("btn-split-vertical");
  setToolbarControlLabel(btnSplitVertical, t("toolbar.split_vertical"));
  
  const btnSplitClose = document.getElementById("btn-split-close");
  setToolbarControlLabel(btnSplitClose, t("toolbar.split_close"));

  setToolbarControlLabel(elements.btnNewFile, t("toolbar.new_file"));
  setToolbarControlLabel(elements.btnNewFolder, t("toolbar.new_folder"));
  
  if (elements.btnShowHidden) {
    setToolbarControlLabel(elements.btnShowHidden, state.showHidden ? t("toolbar.hide_hidden") : t("toolbar.show_hidden"));
  }

  if (elements.fileFilter) {
    elements.fileFilter.title = t("sidebar.filter_files");
    const fileFilterControl = elements.fileFilter.closest(".file-filter-control");
    if (fileFilterControl) fileFilterControl.title = t("sidebar.filter_files");
    elements.fileFilter.value = state.fileTreeFilter || "all";
    const labels = {
      all: t("filter.all_files"),
      yaml: t("filter.yaml"),
      python: t("filter.python"),
      images: t("filter.images"),
      modified: t("filter.modified"),
    };
    Array.from(elements.fileFilter.options).forEach((option) => {
      if (labels[option.value]) option.textContent = labels[option.value];
    });
  }
  
  setToolbarControlLabel(elements.btnToggleSelect, t("toolbar.select_files"));
  setToolbarControlLabel(elements.btnCollapseAllFolders, t("toolbar.collapse_all"));
  setToolbarControlLabel(elements.btnOneTabMode, t("toolbar.one_tab_mode"));
  
  setToolbarControlLabel(elements.btnUpload, t("toolbar.upload"));
  setToolbarControlLabel(elements.btnDownload, t("toolbar.download"));
  setToolbarControlLabel(elements.btnUploadFolder, t("toolbar.upload_folder"));
  setToolbarControlLabel(elements.btnDownloadFolder, t("toolbar.download_folder"));
  
  setToolbarControlLabel(elements.btnValidate, t("toolbar.validate"));
  setToolbarControlLabel(elements.btnGitPull, t("toolbar.git_pull"));
  setToolbarControlLabel(elements.btnGitPush, t("toolbar.git_push"));
  setToolbarControlLabel(elements.btnGitStatus, t("toolbar.git_status"));
  setToolbarControlLabel(elements.btnGitSettings, t("toolbar.git_settings"));
  
  if (elements.btnDonate) {
    const donateTitle = t("toolbar.donate");
    setToolbarControlLabel(elements.btnDonate, donateTitle);
  }
  setToolbarControlLabel(elements.btnSupport, t("toolbar.help"));
  setToolbarControlLabel(elements.btnTerminal, t("toolbar.terminal"));
  setToolbarControlLabel(elements.btnAiStudio, t("toolbar.ai_studio"));
  setToolbarControlLabel(elements.btnRestartHa, t("toolbar.restart_ha"));
  setToolbarControlLabel(elements.btnAppSettings, t("toolbar.settings"));
  setToolbarControlLabel(elements.btnRefresh, t("toolbar.refresh"));

  // Support Modal
  const supportTitle = document.querySelector("#modal-support-overlay .modal-title");
  if (supportTitle) supportTitle.textContent = t("support.title");

  if (elements.btnSupportGuide) {
      const title = elements.btnSupportGuide.querySelector(".support-text div:first-child");
      const desc = elements.btnSupportGuide.querySelector(".support-text div:last-child");
      if (title) title.textContent = t("support.guide_title");
      if (desc) desc.textContent = t("support.guide_desc");
  }

  if (elements.btnSupportShortcuts) {
      const title = elements.btnSupportShortcuts.querySelector(".support-text div:first-child");
      const desc = elements.btnSupportShortcuts.querySelector(".support-text div:last-child");
      if (title) title.textContent = t("support.shortcuts_title");
      if (desc) desc.textContent = t("support.shortcuts_desc");
  }

  if (elements.btnSupportFeature) {
      const title = elements.btnSupportFeature.querySelector(".support-text div:first-child");
      const desc = elements.btnSupportFeature.querySelector(".support-text div:last-child");
      if (title) title.textContent = t("support.feature_title");
      if (desc) desc.textContent = t("support.feature_desc");
  }

  if (elements.btnSupportIssue) {
      const title = elements.btnSupportIssue.querySelector(".support-text div:first-child");
      const desc = elements.btnSupportIssue.querySelector(".support-text div:last-child");
      if (title) title.textContent = t("support.issue_title");
      if (desc) desc.textContent = t("support.issue_desc");
  }

  if (elements.btnGithubStar) {
      const starText = elements.btnGithubStar.querySelector("span:last-child");
      if (starText) starText.textContent = t("support.github_star");
  }

  if (elements.btnGithubFollow) {
      const followText = elements.btnGithubFollow.querySelector("span:last-child");
      if (followText) followText.textContent = t("support.github_follow");
  }

  // Sidebar
  for (const [activity, key, fallback] of [
    [elements.activityExplorer, "sidebar.explorer", "Explorer"],
    [elements.activitySearch, "sidebar.search", "Search"],
    [elements.activitySourceControl, "sidebar.source_control", "Source Control"],
    [elements.activitySftp, "sidebar.sftp", "SFTP"],
  ]) {
    if (!activity) continue;
    const translatedLabel = t(key);
    const label = translatedLabel === key ? fallback : translatedLabel;
    activity.title = label;
    activity.dataset.baseLabel = label;
    activity.setAttribute("aria-label", label);
  }

  const sourceControlHeader = document.querySelector("#view-source-control .sidebar-header span:first-child");
  if (sourceControlHeader) sourceControlHeader.textContent = t("sidebar.source_control");

  const sftpHeader = document.querySelector(
    "#sftp-connection-selector-container > span, #sftp-connection-selector-container option[value='']",
  );
  if (sftpHeader) sftpHeader.textContent = t("sidebar.sftp");
  
  const btnCloseSidebar = document.getElementById("btn-close-sidebar");
  if (btnCloseSidebar) {
    btnCloseSidebar.title = t("sidebar.close");
    btnCloseSidebar.setAttribute("aria-label", t("sidebar.close"));
  }
  
  if (elements.fileSearch) {
    const searchLabel = state.contentSearchEnabled
      ? t("sidebar.search_content_placeholder")
      : t("sidebar.search_names_placeholder");
    elements.fileSearch.placeholder = searchLabel;
    elements.fileSearch.setAttribute("aria-label", searchLabel);
  }
  if (elements.fileSearchClear) elements.fileSearchClear.title = t("sidebar.clear_search");
  if (elements.btnFilenameSearch) {
    elements.btnFilenameSearch.title = t("sidebar.filename_search");
    elements.btnFilenameSearch.setAttribute("aria-label", t("sidebar.filename_search"));
  }
  if (elements.btnContentSearch) {
    elements.btnContentSearch.title = t("sidebar.content_search");
    elements.btnContentSearch.setAttribute("aria-label", t("sidebar.content_search"));
  }
  const explorerSearchModes = document.querySelector(".explorer-search-modes");
  if (explorerSearchModes) explorerSearchModes.setAttribute("aria-label", t("sidebar.search_scope"));
  const filenameSearchLabel = elements.btnFilenameSearch?.querySelector(".explorer-search-mode-label");
  if (filenameSearchLabel) filenameSearchLabel.textContent = t("sidebar.filename_scope");
  const contentSearchLabel = elements.btnContentSearch?.querySelector(".explorer-search-mode-label");
  if (contentSearchLabel) contentSearchLabel.textContent = t("sidebar.content_scope");
  const fileFilterLabel = document.getElementById("file-filter-label");
  if (fileFilterLabel && elements.fileFilter) {
    const selectedOption = elements.fileFilter.options[elements.fileFilter.selectedIndex];
    fileFilterLabel.textContent = selectedOption?.textContent || t("filter.all_files");
  }
  
  const favHeader = document.querySelector("#favorites-panel .favorites-header");
  if (favHeader) favHeader.textContent = t("sidebar.favorites");
  
  const recentHeader = document.querySelector("#recent-files-panel .recent-files-header");
  if (recentHeader) recentHeader.textContent = t("sidebar.recent");
  
  const breadcrumbHome = document.querySelector(".breadcrumb-home .breadcrumb-text");
  if (breadcrumbHome) breadcrumbHome.textContent = t("sidebar.home");
  
  if (elements.btnFileTreeCollapse) {
    elements.btnFileTreeCollapse.title = t("sidebar.collapse_tree");
    elements.btnFileTreeCollapse.setAttribute("aria-label", t("sidebar.collapse_tree"));
  }

  // Search View
  const viewSearchHeader = document.querySelector("#view-search .sidebar-header span:first-child");
  if (viewSearchHeader) viewSearchHeader.textContent = t("search.workspace_search");

  const globalScopeLabels = {
    all: t("search.scope_workspace"),
    files: t("search.scope_file_content"),
    entities: t("search.scope_entities"),
  };
  document.querySelectorAll(".search-mode-tab").forEach((tab) => {
    tab.textContent = globalScopeLabels[tab.dataset.mode] || tab.textContent;
  });
  
  const btnRefreshSearch = document.getElementById("btn-refresh-search");
  if (btnRefreshSearch) btnRefreshSearch.title = t("search.refresh");
  
  const btnCollapseSearch = document.getElementById("btn-collapse-search");
  if (btnCollapseSearch) btnCollapseSearch.title = t("search.collapse_all");
  
  const globalSearchInput = document.getElementById("global-search-input");
  if (globalSearchInput) {
    const activeScope = document.querySelector(".search-mode-tab.active")?.dataset.mode || "all";
    const placeholderKey = `search.placeholder_${activeScope}`;
    const labelKey = `search.label_${activeScope}`;
    globalSearchInput.placeholder = t(placeholderKey);
    globalSearchInput.setAttribute("aria-label", t(labelKey));
  }
  
  const btnMatchCase = document.getElementById("btn-match-case");
  if (btnMatchCase) btnMatchCase.title = t("search.match_case");
  
  const btnMatchWord = document.getElementById("btn-match-word");
  if (btnMatchWord) btnMatchWord.title = t("search.match_word");
  
  const btnUseRegex = document.getElementById("btn-use-regex");
  if (btnUseRegex) btnUseRegex.title = t("search.use_regex");
  
  const globalReplaceInput = document.getElementById("global-replace-input");
  if (globalReplaceInput) globalReplaceInput.placeholder = t("search.replace_placeholder");
  
  const btnGlobalReplaceAll = document.getElementById("btn-global-replace-all");
  if (btnGlobalReplaceAll) btnGlobalReplaceAll.title = t("search.replace_all");
  
  const btnTogglePatterns = document.getElementById("btn-toggle-patterns");
  if (btnTogglePatterns) btnTogglePatterns.textContent = t("search.files_to_include_exclude");
  
  const globalSearchInclude = document.getElementById("global-search-include");
  if (globalSearchInclude) globalSearchInclude.placeholder = t("search.include_placeholder");
  
  const globalSearchExclude = document.getElementById("global-search-exclude");
  if (globalSearchExclude) globalSearchExclude.placeholder = t("search.exclude_placeholder");

  // Welcome Screen
  if (elements.welcomeScreen) {
    const title = elements.welcomeScreen.querySelector("h2");
    if (title) title.textContent = t("welcome.title");
    
    const subtitle = elements.welcomeScreen.querySelector("p");
    if (subtitle) subtitle.textContent = t("welcome.subtitle");
    
    if (elements.btnWelcomeNewFile) {
      const textNode = Array.from(elements.btnWelcomeNewFile.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0);
      if (textNode) textNode.textContent = t("welcome.create_file");
    }
    if (elements.btnWelcomeUploadFile) {
      const textNode = Array.from(elements.btnWelcomeUploadFile.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0);
      if (textNode) textNode.textContent = t("welcome.upload_file");
    }
    
    const shortcutsHeader = elements.welcomeScreen.querySelector(".welcome-shortcuts h3");
    if (shortcutsHeader) shortcutsHeader.textContent = t("welcome.shortcuts");
  }

  // Settings Modal (if open)
  if (document.getElementById("settings-tab-general")) {
      const modalTitle = document.getElementById("modal-title");
      if (modalTitle) modalTitle.textContent = t("settings.title");
      
      const terminalConfigTitle = document.querySelector("#terminal-config-section div:first-child");
      if (terminalConfigTitle) terminalConfigTitle.textContent = t("settings.integrations.terminal_config");
      
      const defaultSshLabel = document.querySelector("#terminal-config-section .git-settings-input").previousElementSibling.querySelector("div:first-child");
      if (defaultSshLabel) defaultSshLabel.textContent = t("settings.integrations.default_ssh");
      
      const defaultSshHint = document.querySelector("#terminal-config-section .git-settings-input").previousElementSibling.querySelector("div:last-child");
      if (defaultSshHint) defaultSshHint.textContent = t("settings.integrations.default_ssh_hint");
      
      const localSshOpt = document.querySelector("#default-ssh-host-select option[value='local']");
      if (localSshOpt) localSshOpt.textContent = t("settings.integrations.ssh_local");
  }

  // Update status bar via window.app to avoid direct circular dependency
  if (window.app) {
    if (typeof window.app.updateStatusBar === 'function') window.app.updateStatusBar();
    if (typeof window.app.refreshGitPanelStrings === 'function') window.app.refreshGitPanelStrings();
    if (typeof window.app.refreshGiteaPanelStrings === 'function') window.app.refreshGiteaPanelStrings();
    if (typeof window.app.refreshSftpStrings === 'function') window.app.refreshSftpStrings();
  }

  // Refresh context menus
  renderAllContextMenus();
}

/**
 * Re-renders context menu items with translated labels
 */
export function renderAllContextMenus() {
  // 1. General Context Menu (File/Folder)
  if (elements.contextMenu) {
    const items = elements.contextMenu.querySelectorAll(".context-menu-item");
    items.forEach(item => {
      const action = item.dataset.action;
      const icon = item.querySelector(".material-icons")?.outerHTML || "";
      
      switch(action) {
        case "new_file": item.innerHTML = `${icon} ${t("menu.new_file")}`; break;
        case "new_folder": item.innerHTML = `${icon} ${t("menu.new_folder")}`; break;
        case "upload": item.innerHTML = `${icon} ${t("menu.upload")}`; break;
        case "upload_folder": item.innerHTML = `${icon} ${t("menu.upload_folder")}`; break;
        case "run_in_terminal": item.innerHTML = `${icon} ${t("menu.run_terminal")}`; break;
        case "rename": item.innerHTML = `${icon} ${t("menu.rename")}`; break;
        case "move": item.innerHTML = `${icon} ${t("menu.move")}`; break;
        case "copy": item.innerHTML = `${icon} ${t("menu.copy")}`; break;
        case "duplicate": item.innerHTML = `${icon} ${t("menu.duplicate")}`; break;
        case "download": item.innerHTML = `${icon} ${t("menu.download")}`; break;
        case "delete": item.innerHTML = `${icon} ${t("menu.delete")}`; break;
      }
    });
  }

  // 2. Tab Context Menu
  if (elements.tabContextMenu) {
    const items = elements.tabContextMenu.querySelectorAll(".context-menu-item");
    items.forEach(item => {
      const action = item.dataset.action;
      const icon = item.querySelector(".material-icons")?.outerHTML || "";
      
      switch(action) {
        case "move_to_left": 
          const isVert = (state.splitView?.orientation === 'vertical');
          item.innerHTML = `${icon} ${t(isVert ? "menu.move_pane_left" : "menu.move_pane_top")}`; 
          break;
        case "move_to_right": 
          const isVert2 = (state.splitView?.orientation === 'vertical');
          item.innerHTML = `${icon} ${t(isVert2 ? "menu.move_pane_right" : "menu.move_pane_bottom")}`; 
          break;
        case "open_to_right": item.innerHTML = `${icon} ${t("menu.open_right")}`; break;
        case "close_others": item.innerHTML = `${icon} ${t("menu.close_others")}`; break;
        case "close_saved": item.innerHTML = `${icon} ${t("menu.close_saved")}`; break;
        case "copy_path": item.innerHTML = `${icon} ${t("menu.copy_path")}`; break;
      }
    });
  }
}
