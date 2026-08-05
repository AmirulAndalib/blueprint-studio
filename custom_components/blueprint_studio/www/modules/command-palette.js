import { t } from './translations.js';
/** COMMAND-PALETTE.JS | Purpose: * Provides a unified quick-access command and file switcher (VS Code style) */
import { state, elements, gitState, giteaState } from './state.js';
import { getTruePath, getFileIcon, copyToClipboard } from './utils.js';
import { eventBus } from './event-bus.js';
import { API_BASE } from './constants.js';
import { fetchWithAuth } from './api.js';
import { showToast, showConfirmDialog } from './ui.js';
import { closeDialog, openDialog } from './dialog-manager.js';
import { startOperationFeedback } from './feedback-service.js?v=2.5.188';
import { getGitActionConfirmation } from './git-action-confirmation.js?v=2.5.188';

const TOOLBAR_REQUIREMENTS = {
  'btn-format': () => state.activeTab ? null : 'Open a file to format it',
  'btn-search': () => state.activeTab ? null : 'Open a file to search it',
  'btn-validate': () => state.activeTab ? null : 'Open a YAML file to validate it',
  'btn-use-blueprint': () => state.activeTab?.content?.includes('blueprint:') ? null : 'Open a Blueprint file to use it',
  'btn-markdown-preview': () => state.activeTab?.path?.toLowerCase().endsWith('.md') ? null : 'Open a Markdown file to preview it',
  'btn-split-close': () => state.splitView?.enabled ? null : 'Open Split Editor first',
  'btn-terminal': () => state.terminalIntegrationEnabled ? null : 'Enable Terminal in Settings',
  'btn-ai-studio': () => state.aiIntegrationEnabled ? null : 'Enable AI Studio in Settings',
  'btn-git-pull': () => state.gitIntegrationEnabled ? null : 'Enable GitHub source control in Settings',
  'btn-git-push': () => state.gitIntegrationEnabled ? null : 'Enable GitHub source control in Settings',
  'btn-git-status': () => state.gitIntegrationEnabled ? null : 'Enable GitHub source control in Settings',
  'btn-git-settings': () => state.gitIntegrationEnabled ? null : 'Enable GitHub source control in Settings',
  'btn-gitea-pull': () => state.giteaIntegrationEnabled ? null : 'Enable Gitea source control in Settings',
  'btn-gitea-push': () => state.giteaIntegrationEnabled ? null : 'Enable Gitea source control in Settings',
  'btn-gitea-status': () => state.giteaIntegrationEnabled ? null : 'Enable Gitea source control in Settings',
  'btn-gitea-settings': () => state.giteaIntegrationEnabled ? null : 'Enable Gitea source control in Settings',
};

const TOOLBAR_ICON_FALLBACKS = {
  'btn-git-pull': 'cloud_download',
  'btn-git-push': 'cloud_upload',
  'btn-git-status': 'sync',
  'btn-git-settings': 'settings',
  'btn-gitea-pull': 'cloud_download',
  'btn-gitea-push': 'cloud_upload',
  'btn-gitea-status': 'sync',
};

function commandLabelParts(label = '') {
  const suffix = label.match(/\s*\(([^()]*)\)\s*$/);
  const shortcut = suffix && /(?:Ctrl|Cmd|Alt|Option|Shift|Meta|F\d)/i.test(suffix[1]) ? suffix[1] : '';
  return {
    label: shortcut ? label.slice(0, suffix.index).trim() : label.trim(),
    shortcut,
  };
}

function toolbarCommands() {
  const toolbar = document.querySelector('.toolbar');
  if (!toolbar) return [];
  return [...toolbar.querySelectorAll(':scope > .toolbar-group[data-toolbar-priority] > button')]
    .filter((control) => control.id !== 'btn-toolbar-overflow')
    .map((control) => {
      const fullLabel = control.dataset.toolbarLabel
        || control.getAttribute('aria-label')
        || control.dataset.tooltip
        || control.title
        || control.id;
      const { label, shortcut } = commandLabelParts(fullLabel);
      const icon = control.querySelector('.material-icons')?.textContent?.trim()
        || TOOLBAR_ICON_FALLBACKS[control.id]
        || 'bolt';
      const scope = control.closest('[role="group"]')?.getAttribute('aria-label') || 'Workspace';
      return {
        id: control.id,
        label,
        icon,
        scope,
        shortcut,
        keywords: `${fullLabel} ${control.id}`,
        availability: () => {
          const requirement = TOOLBAR_REQUIREMENTS[control.id]?.();
          const reason = control.dataset.disabledReason || requirement || '';
          return { enabled: !control.disabled && !reason, reason };
        },
        action: () => control.click(),
      };
    });
}

export async function cleanGitLocks() {
  const branch = gitState.currentBranch || 'Current branch';
  return confirmCleanGitLocks(branch);
}

async function confirmCleanGitLocks(branch) {
  const confirmed = await showConfirmDialog(getGitActionConfirmation('clean-locks', {
    currentBranch: branch,
  }));
  if (!confirmed) return false;

  const operation = startOperationFeedback({
    label: 'Clean Git recovery state',
    icon: 'delete_sweep',
    scope: 'Local Git repository',
    target: `${branch} -> .git locks and operation state`,
    message: 'Removing stale Git recovery state...',
    retry: () => confirmCleanGitLocks(branch),
    open: () => eventBus.emit('ui:switch-sidebar-view', 'source-control'),
    openLabel: 'Source Control',
    openIcon: 'account_tree',
  });
  try {
    const response = await fetchWithAuth(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'git_clean_locks' }),
    });
    if (!response.success) {
      const message = response.message || response.error || 'Unknown Git cleanup error';
      operation.fail('Could not clean Git recovery state', message);
      showToast(t('toast.clean_locks_failed', { error: message }), 'error');
      return false;
    }

    const removed = Array.isArray(response.removed) ? response.removed : [];
    operation.finish(response.message || `Removed ${removed.length} Git state entries`, {
      detail: removed.length ? `Removed: ${removed.join(', ')}` : 'No stale Git recovery state was found.',
    });
    showToast(response.message || 'Git recovery state cleaned', 'success');
    eventBus.emit('git:refresh');
    return true;
  } catch (error) {
    operation.fail('Could not clean Git recovery state', error.message);
    showToast(t('toast.generic_error', { error: error.message }), 'error');
    return false;
  }
}

function paletteOnlyCommands() {
  const activeFile = (reason) => () => ({ enabled: !!state.activeTab, reason: state.activeTab ? '' : reason });
  const editor = (reason) => () => ({ enabled: !!state.editor && !!state.activeTab, reason: state.editor && state.activeTab ? '' : reason });
  const git = () => ({ enabled: !!state.gitIntegrationEnabled, reason: state.gitIntegrationEnabled ? '' : 'Enable GitHub source control in Settings' });
  const sourceProvider = () => state.gitIntegrationEnabled ? 'git' : 'gitea';
  const sourceState = () => sourceProvider() === 'git' ? gitState : giteaState;
  const sourceEnabled = () => state.gitIntegrationEnabled || state.giteaIntegrationEnabled;
  const changeStage = (action, files) => eventBus.emit('source-control:change-stage', {
    provider: sourceProvider(), action, files,
  });
  const label = (key, fallback) => t(key) === key ? fallback : t(key);
  return [
    { id: 'new_blueprint', label: 'New Blueprint', icon: 'architecture', scope: 'Blueprint', action: () => eventBus.emit('blueprint:new') },
    { id: 'convert_to_blueprint', label: 'Convert to Blueprint (or Selection)', icon: 'architecture', scope: 'Blueprint', availability: activeFile('Open a file to convert it'), action: () => eventBus.emit('blueprint:convert') },
    { id: 'generate_uuid', label: t('palette.cmd_generate_uuid'), icon: 'fingerprint', scope: 'Editor', shortcut: 'Ctrl+Shift+U', availability: editor('Open a file to insert a UUID'), action: () => eventBus.emit('editor:insert-uuid') },
    { id: 'git_history', label: t('palette.cmd_git_history'), icon: 'history', scope: 'GitHub source control', availability: git, action: () => eventBus.emit('git:show-history') },
    { id: 'source_stage_file', label: label('palette.cmd_stage_file', 'Stage Active File'), icon: 'add', scope: 'Source control', availability: () => {
      const path = state.activeTab?.path;
      const enabled = sourceEnabled() && Boolean(path) && !sourceState().files.staged.includes(path);
      return { enabled, reason: !sourceEnabled() ? 'Enable source control in Settings' : !path ? 'Open a file to stage it' : 'The active file is already staged' };
    }, action: () => changeStage('stage', [state.activeTab.path]) },
    { id: 'source_unstage_file', label: label('palette.cmd_unstage_file', 'Unstage Active File'), icon: 'remove', scope: 'Source control', availability: () => {
      const path = state.activeTab?.path;
      const enabled = sourceEnabled() && Boolean(path) && sourceState().files.staged.includes(path);
      return { enabled, reason: !sourceEnabled() ? 'Enable source control in Settings' : !path ? 'Open a staged file first' : 'The active file is not staged' };
    }, action: () => changeStage('unstage', [state.activeTab.path]) },
    { id: 'source_stage_selected', label: label('palette.cmd_stage_selected', 'Stage Selected Files'), icon: 'playlist_add', scope: 'Source control', availability: () => ({
      enabled: sourceEnabled() && sourceState().selectedFiles.size > 0,
      reason: sourceEnabled() ? 'Select changed files in Source Control first' : 'Enable source control in Settings',
    }), action: () => changeStage('stage', [...sourceState().selectedFiles]) },
    { id: 'dev_tools_actions', label: 'Developer Tools: Actions', icon: 'construction', scope: 'Home Assistant', action: () => eventBus.emit('ha:dev-tools', { tab: 'actions' }) },
    { id: 'dev_tools_template', label: 'Developer Tools: Template', icon: 'construction', scope: 'Home Assistant', action: () => eventBus.emit('ha:dev-tools', { tab: 'template' }) },
    { id: 'dev_tools_states', label: 'Developer Tools: States', icon: 'construction', scope: 'Home Assistant', action: () => eventBus.emit('ha:dev-tools', { tab: 'states' }) },
    { id: 'dev_tools_config', label: 'Developer Tools: Config', icon: 'construction', scope: 'Home Assistant', action: () => eventBus.emit('ha:dev-tools', { tab: 'config' }) },
    { id: 'shortcuts', label: t('palette.cmd_shortcuts'), icon: 'keyboard', scope: 'Help', action: () => eventBus.emit('ui:show-shortcuts') },
    { id: 'report_issue', label: t('palette.cmd_report_issue'), icon: 'bug_report', scope: 'Help', action: () => eventBus.emit('ui:report-issue') },
    { id: 'request_feature', label: t('palette.cmd_request_feature'), icon: 'lightbulb', scope: 'Help', action: () => eventBus.emit('ui:request-feature') },
    { id: 'clean_git_locks', label: t('palette.cmd_clean_git_locks'), icon: 'delete_sweep', scope: 'GitHub source control', availability: git, action: cleanGitLocks },
    { id: 'copy_path', label: t('palette.cmd_copy_path'), icon: 'content_copy', scope: 'File', availability: activeFile('Open a file to copy its path'), action: () => copyToClipboard(getTruePath(state.activeTab.path)) },
    { id: 'toggle_word_wrap', label: t('palette.cmd_toggle_word_wrap'), icon: 'wrap_text', scope: 'Editor', availability: editor('Open a file to change word wrapping'), action: () => {
      state.wordWrap = !state.wordWrap;
      state.editor.setOption('lineWrapping', state.wordWrap);
      eventBus.emit('settings:save');
      showToast(`Word wrap ${state.wordWrap ? 'enabled' : 'disabled'}`, 'info');
    }},
    { id: 'fold_all', label: t('palette.cmd_fold_all'), icon: 'unfold_less', scope: 'Editor', shortcut: 'Ctrl+Alt+[', availability: editor('Open a file to fold it'), action: () => state.editor.execCommand('foldAll') },
    { id: 'unfold_all', label: t('palette.cmd_unfold_all'), icon: 'unfold_more', scope: 'Editor', shortcut: 'Ctrl+Alt+]', availability: editor('Open a file to unfold it'), action: () => state.editor.execCommand('unfoldAll') },
    { id: 'close_others', label: t('palette.cmd_close_others'), icon: 'close_fullscreen', scope: 'Tabs', availability: () => ({ enabled: !!state.activeTab && state.openTabs.length > 1, reason: !state.activeTab ? 'Open a file first' : state.openTabs.length > 1 ? '' : 'There are no other open tabs' }), action: () => state.openTabs.filter((tab) => tab !== state.activeTab).forEach((tab) => eventBus.emit('tab:close', { tab })) },
    { id: 'close_saved', label: t('palette.cmd_close_saved'), icon: 'save', scope: 'Tabs', availability: () => ({ enabled: state.openTabs.some((tab) => !tab.modified && tab !== state.activeTab), reason: state.openTabs.some((tab) => !tab.modified && tab !== state.activeTab) ? '' : 'There are no other saved tabs' }), action: () => state.openTabs.filter((tab) => !tab.modified && tab !== state.activeTab).forEach((tab) => eventBus.emit('tab:close', { tab })) },
    { id: 'theme_light', label: t('palette.cmd_theme_light'), icon: 'light_mode', scope: 'Appearance', action: () => eventBus.emit('ui:set-theme-preset', { preset: 'light' }) },
    { id: 'theme_dark', label: t('palette.cmd_theme_dark'), icon: 'dark_mode', scope: 'Appearance', action: () => eventBus.emit('ui:set-theme-preset', { preset: 'dark' }) },
    { id: 'theme_auto', label: t('palette.cmd_theme_auto'), icon: 'brightness_auto', scope: 'Appearance', action: () => eventBus.emit('ui:set-theme-preset', { preset: 'auto' }) },
  ].map((command) => ({ availability: () => ({ enabled: true, reason: '' }), shortcut: '', keywords: '', ...command }));
}

export function getCommandPaletteCommands() {
  return [...toolbarCommands(), ...paletteOnlyCommands()];
}

/**
 * Shows the unified command palette
 * @param {string} initialMode - optional initial character (e.g. '>')
 */
export function showCommandPalette(initialMode = "") {
  if (!elements.commandPaletteOverlay) elements.commandPaletteOverlay = document.getElementById("command-palette-overlay");
  if (!elements.commandPaletteInput) elements.commandPaletteInput = document.getElementById("command-palette-input");
  if (!elements.commandPaletteResults) elements.commandPaletteResults = document.getElementById("command-palette-results");

  if (!elements.commandPaletteOverlay) return;
  if (elements.commandPaletteOverlay.classList.contains("visible")) return;

  const commands = getCommandPaletteCommands();

  let selectedIndex = 0;
  let filteredItems = [];
  let currentMode = "file"; // "file", "command", "goto"

  const renderResults = () => {
      const query = elements.commandPaletteInput.value;
      
      if (query.startsWith(">")) {
          currentMode = "command";
          const filter = query.slice(1).toLowerCase().trim();
          filteredItems = commands.filter((command) =>
              `${command.label} ${command.scope} ${command.shortcut} ${command.keywords}`.toLowerCase().includes(filter)
          );
          elements.commandPaletteInput.placeholder = t("palette.type_command");
      } else if (query.startsWith(":")) {
          currentMode = "goto";
          const lineNum = query.slice(1).trim();
          filteredItems = []; // No list for goto mode
          elements.commandPaletteInput.placeholder = t("palette.goto_line");
      } else {
          currentMode = "file";
          const filter = query.toLowerCase().trim();
          
          if (!filter) {
              // Show recent files
              filteredItems = (state.recentFiles || []).map(path => {
                  return state.files.find(f => f.path === path);
              }).filter(f => f).slice(0, 20);
              
              if (filteredItems.length < 5) {
                  const others = state.files.filter(f => !state.recentFiles?.includes(f.path));
                  filteredItems = filteredItems.concat(others.slice(0, 20 - filteredItems.length));
              }
          } else {
              filteredItems = state.files.filter(f => 
                  f.name.toLowerCase().includes(filter) || 
                  f.path.toLowerCase().includes(filter)
              ).slice(0, 50);
          }
          elements.commandPaletteInput.placeholder = t("palette.search_files");
      }

      elements.commandPaletteResults.innerHTML = "";
      
      if (currentMode === "goto") {
          elements.commandPaletteResults.innerHTML = `<div style="padding: 12px; font-size: 13px; color: var(--text-secondary);">${t("palette.goto_line_instruction")}</div>`;
          return;
      }

      if (filteredItems.length === 0) {
          elements.commandPaletteResults.innerHTML = `<div class="command-palette-no-results">${t("palette.no_results")}</div>`;
          return;
      }

      if (selectedIndex >= filteredItems.length) selectedIndex = 0;

      filteredItems.forEach((item, i) => {
          const div = document.createElement("div");
          div.className = `command-item ${i === selectedIndex ? "selected" : ""}`;
          div.setAttribute("role", "option");
          div.setAttribute("aria-selected", i === selectedIndex ? "true" : "false");
          
          if (currentMode === "command") {
              const availability = item.availability();
              div.classList.toggle('is-disabled', !availability.enabled);
              div.setAttribute('aria-disabled', String(!availability.enabled));
              div.setAttribute('aria-label', `${item.label}, ${item.scope}${item.shortcut ? `, ${item.shortcut}` : ''}${availability.reason ? `, unavailable: ${availability.reason}` : ''}`);

              const label = document.createElement('div');
              label.className = 'command-item-label';
              const icon = document.createElement('span');
              icon.className = 'ui-icon material-icons command-item-icon';
              icon.textContent = item.icon;
              const text = document.createElement('span');
              text.className = 'command-item-text';
              const name = document.createElement('span');
              name.className = 'command-item-name';
              name.textContent = item.label;
              const metadata = document.createElement('span');
              metadata.className = 'command-item-metadata';
              const scope = document.createElement('span');
              scope.className = 'command-item-scope';
              scope.textContent = item.scope;
              metadata.appendChild(scope);
              const status = document.createElement('span');
              status.className = availability.enabled ? 'command-item-status' : 'command-item-disabled-reason';
              status.textContent = availability.enabled ? 'Available' : `Unavailable: ${availability.reason}`;
              metadata.appendChild(status);
              text.append(name, metadata);
              label.append(icon, text);
              div.appendChild(label);
              if (item.shortcut) {
                  const shortcut = document.createElement('span');
                  shortcut.className = 'command-item-shortcut';
                  shortcut.textContent = item.shortcut;
                  div.appendChild(shortcut);
              }
              div.onclick = () => {
                  if (!availability.enabled) return;
                  hide();
                  item.action();
              };
          } else {
              const fileIcon = getFileIcon(item.path);
              div.innerHTML = `
                  <div class="command-item-label">
                      <span class="ui-icon material-icons command-item-icon ${fileIcon.class}">${fileIcon.icon}</span>
                      <div style="display: flex; flex-direction: column;">
                          <span class="quick-switcher-name">${item.name}</span>
                          <span style="font-size: 10px; opacity: 0.6;">${item.path}</span>
                      </div>
                  </div>
              `;
              div.onclick = () => {
                  hide();
                  eventBus.emit('file:open', { path: item.path });
              };
          }
          elements.commandPaletteResults.appendChild(div);
      });

      const selected = elements.commandPaletteResults.querySelector(".command-item.selected");
      if (selected) selected.scrollIntoView({ block: "nearest" });
  };

  const handleKeydown = (e) => {
      if (e.key === "ArrowDown") {
          e.preventDefault();
          if (filteredItems.length > 0) {
              selectedIndex = (selectedIndex + 1) % filteredItems.length;
              renderResults();
          }
      } else if (e.key === "ArrowUp") {
          e.preventDefault();
          if (filteredItems.length > 0) {
              selectedIndex = (selectedIndex - 1 + filteredItems.length) % filteredItems.length;
              renderResults();
          }
      } else if (e.key === "Enter") {
          e.preventDefault();
          
          if (currentMode === "goto") {
              const line = parseInt(elements.commandPaletteInput.value.slice(1));
              if (!isNaN(line) && state.editor) {
                  state.editor.setCursor({line: line - 1, ch: 0});
                  state.editor.scrollIntoView({line: line - 1, ch: 0}, 200);
                  state.editor.focus();
              }
              hide();
              return;
          }

          const item = filteredItems[selectedIndex];
          if (item) {
              if (currentMode === "command") {
                  if (!item.availability().enabled) return;
                  hide();
                  item.action();
              } else {
                  hide();
                  eventBus.emit('file:open', { path: item.path });
              }
          }
      }
  };

  const handleInput = () => {
      selectedIndex = 0;
      renderResults();
  };

  const hide = () => {
      closeDialog(elements.commandPaletteOverlay);
      cleanup();
  };

  const cleanup = () => {
      elements.commandPaletteInput.removeEventListener("input", handleInput);
      elements.commandPaletteInput.removeEventListener("keydown", handleKeydown);
  };

  elements.commandPaletteInput.addEventListener("input", handleInput);
  elements.commandPaletteInput.addEventListener("keydown", handleKeydown);

  openDialog(elements.commandPaletteOverlay, {
      initialFocus: elements.commandPaletteInput,
      onRequestClose: hide,
  });
  elements.commandPaletteInput.value = initialMode;
  selectedIndex = 0;
  renderResults();
  
  setTimeout(() => {
      elements.commandPaletteInput.focus();
      // If we have an initial mode, move cursor to end
      if (initialMode) {
          elements.commandPaletteInput.setSelectionRange(initialMode.length, initialMode.length);
      }
  }, 10);
}
