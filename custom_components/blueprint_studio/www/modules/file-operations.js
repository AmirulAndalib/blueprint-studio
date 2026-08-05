/** FILE-OPERATIONS.JS | Purpose: * Handles all file system operations including creating, deleting, copying, */
import { state, elements } from './state.js';
import { fetchWithAuth } from './api.js';
import { API_BASE } from './constants.js';
import { showToast, showConfirmDialog } from './ui.js';
import { loadScript } from './utils.js';
import { t } from './translations.js';
import { eventBus } from './event-bus.js';
import { isSftpPath, saveSftpFile } from './sftp.js?v=2.5.188';
import { startOperationFeedback } from './feedback-service.js?v=2.5.188';
import { invalidateEditorConfigCache } from './editorconfig.js';

function revealSavedFile(path) {
  eventBus.emit('ui:switch-sidebar-view', isSftpPath(path) ? 'sftp' : 'explorer');
  eventBus.emit('file:open', { path });
}

function saveFailure(result, fallback) {
  return result?.message || result?.error || fallback;
}

function localParentPath(path) {
  const normalized = String(path || '').replace(/\/+$/g, '');
  const separator = normalized.lastIndexOf('/');
  return separator > 0 ? normalized.slice(0, separator) : '';
}

async function browseLocalPath(path, openFile = false) {
  eventBus.emit('ui:switch-sidebar-view', 'explorer');
  if (openFile) {
    eventBus.emit('file:open', { path });
    return;
  }
  const { navigateToFolder } = await import('./file-tree.js?v=2.5.188');
  await navigateToFolder(path);
}

/**
 * Save a file
 */
export async function saveFile(path, content, options = {}) {
  const request = { path: String(path || ''), content: String(content ?? '') };
  // SFTP files are saved via the SFTP module
  if (isSftpPath(request.path)) {
    const tab = state.openTabs.find(t => t.path === request.path) || {
      path: request.path,
      name: request.path.split('/').pop() || 'file',
    };
    return await saveSftpFile(tab, request.content, options);
  }

  const operation = options.silentOperation ? null : startOperationFeedback({
    label: `Save ${request.path.split('/').pop() || 'file'}`,
    icon: 'save',
    message: 'Writing file to Local Home Assistant...',
    scope: 'Local Home Assistant',
    target: request.path,
    retry: () => saveFile(request.path, request.content),
    open: () => revealSavedFile(request.path),
    openLabel: 'Open file',
    openIcon: 'description',
  });
  try {
    const response = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "write_file", path: request.path, content: request.content }),
    });
    if (!response?.success) throw new Error(saveFailure(response, 'Home Assistant rejected the file write'));
    
    // Update tab mtime if successful
    if (response.mtime) {
        const tab = state.openTabs.find(t => t.path === request.path);
        if (tab) tab.mtime = response.mtime;
    }

    if (request.path.endsWith('.editorconfig')) {
      const directory = request.path.includes('/') ? request.path.slice(0, request.path.lastIndexOf('/')) : '';
      invalidateEditorConfigCache(directory);
    }

    // Refresh files to get updated size (including current file's new size)
    eventBus.emit('ui:reload-files', { force: true });
    if (!options.silentToast) showToast(t("toast.saved", { file: request.path.split("/").pop() }), "success");

    // Auto-refresh git status after saving to show changes immediately
    eventBus.emit('git:status-check', { fetch: false, silent: true });

    operation?.finish(`${request.path.split('/').pop() || 'File'} saved`);
    options.onResult?.({ success: true, response });
    return true;
  } catch (error) {
    operation?.fail(`Could not save ${request.path.split('/').pop() || 'file'}`, error.message);
    options.onResult?.({ success: false, message: error.message });
    if (!options.silentErrorToast) showToast(t("toast.save_failed", { error: error.message }), "error");
    return false;
  }
}

/**
 * Create a new file
 */
async function confirmCreateFileRetry(request, options = {}) {
  if (!request.overwrite) return runCreateFile(request, options);
  const confirmed = await showConfirmDialog({
    title: 'Retry creating file?',
    message: `Create ${request.path} in Local Home Assistant again? The destination will be replaced with the original requested content if it now exists.`,
    confirmText: 'Retry Create',
    cancelText: t('modal.cancel_button'),
    isDanger: true,
  });
  if (confirmed) return runCreateFile(request, options);
  return false;
}

async function runCreateFile(request, options = {}) {
  const operation = options.silentOperation ? null : startOperationFeedback({
    label: `Create local file`,
    icon: 'note_add',
    scope: 'Local Home Assistant workspace',
    target: request.path,
    message: `Creating ${request.path}...`,
    retry: () => confirmCreateFileRetry(request),
    open: () => browseLocalPath(request.path, true),
    openLabel: 'Open file',
    openIcon: 'description',
  });
  try {
    const response = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_file",
        path: request.path,
        content: request.content,
        is_base64: request.isBase64,
        overwrite: request.overwrite,
      }),
    });
    if (!response?.success) throw new Error(saveFailure(response, 'File creation request failed'));
    if (!options.silentToast) showToast(t("toast.upload_success"), "success");
    eventBus.emit('ui:reload-files', { force: true });
    if (!request.noOpen) eventBus.emit('file:open', { path: request.path });

    // Auto-refresh git status after creating file
    eventBus.emit('git:refresh');

    operation?.finish(`Created ${request.path}`);
    options.onResult?.({ success: true, response });
    return true;
  } catch (error) {
    operation?.fail(`Could not create ${request.path}`, error.message);
    options.onResult?.({ success: false, message: error.message });
    if (!options.silentErrorToast) showToast(t("toast.file_create_fail", { error: error.message }), "error");
    return false;
  }
}

export async function createFile(path, content = "", noOpen = false, overwrite = false, is_base64 = false, options = {}) {
  return runCreateFile(Object.freeze({
    path: String(path || ''),
    content: String(content ?? ''),
    noOpen: Boolean(noOpen),
    overwrite: Boolean(overwrite),
    isBase64: Boolean(is_base64),
  }), options);
}

/**
 * Create a new folder
 */
async function runCreateFolder(request) {
  const operation = startOperationFeedback({
    label: 'Create local folder',
    icon: 'create_new_folder',
    scope: 'Local Home Assistant workspace',
    target: request.path,
    message: `Creating ${request.path}...`,
    retry: () => runCreateFolder(request),
    open: () => browseLocalPath(request.path),
    openLabel: 'Open folder',
    openIcon: 'folder_open',
  });
  try {
    const response = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create_folder", path: request.path }),
    });
    if (!response?.success) throw new Error(saveFailure(response, 'Folder creation request failed'));
    showToast(t("toast.upload_success"), "success");
    eventBus.emit('ui:reload-files', { force: true });
    state.expandedFolders.add(request.path);
    eventBus.emit('ui:refresh-tree');

    // Auto-refresh git status after creating folder
    eventBus.emit('git:refresh');

    operation.finish(`Created ${request.path}`);
    return true;
  } catch (error) {
    operation.fail(`Could not create ${request.path}`, error.message);
    showToast(t("toast.folder_create_fail", { error: error.message }), "error");
    return false;
  }
}

export async function createFolder(path) {
  return runCreateFolder(Object.freeze({ path: String(path || '') }));
}

/**
 * Delete a file or folder
 */
async function browseLocalDelete(path) {
  eventBus.emit('ui:switch-sidebar-view', 'explorer');
  const parentPath = path.includes('/') ? path.split('/').slice(0, -1).join('/') : '';
  const { navigateToFolder } = await import('./file-tree.js?v=2.5.188');
  await navigateToFolder(parentPath);
}

async function confirmDeleteItem(request) {
  const item = request.isFolder ? 'folder' : 'file';
  const confirmed = await showConfirmDialog({
    title: `Retry deleting ${item}?`,
    message: `Permanently delete ${request.path} from Local Home Assistant? A previous recursive attempt may already have removed some contents. This cannot be undone.`,
    confirmText: 'Retry Delete',
    cancelText: t('modal.cancel_button'),
    isDanger: true,
  });
  if (confirmed) return runDeleteItem(request);
  return false;
}

async function runDeleteItem(request) {
  const item = request.isFolder ? 'folder' : 'file';
  const operation = startOperationFeedback({
    label: `Delete local ${item}`,
    icon: 'delete',
    scope: 'Local Home Assistant workspace',
    target: request.path,
    message: `Deleting ${request.path}...`,
    retry: () => confirmDeleteItem(request),
    open: () => browseLocalDelete(request.path),
    openLabel: 'Browse',
    openIcon: 'folder_open',
  });
  try {
    const response = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", path: request.path }),
    });
    if (!response?.success) throw new Error(response?.message || response?.error || 'Deletion request failed');
    showToast(t("toast.deleted"), "success");

    // Close open tabs: exact match for the item, plus all children if it's a folder
    const folderPrefix = request.path.endsWith('/') ? request.path : request.path + '/';
    const tabsToClose = state.openTabs.filter(tab => tab.path === request.path || tab.path.startsWith(folderPrefix));
    tabsToClose.forEach(tab => eventBus.emit('tab:close', { tab, force: true }));

    eventBus.emit('ui:reload-files', { force: true });

    // Auto-refresh git status after deleting file
    eventBus.emit('git:refresh');

    operation.finish(`Deleted ${request.path}`, { detail: 'Deletion is permanent and was not moved to a recovery location.' });
    return true;
  } catch (error) {
    const message = error?.message || String(error);
    eventBus.emit('ui:reload-files', { force: true });
    operation.fail(`Could not delete ${request.path}`, `${message}\n\nSome contents may already be deleted. No changes were rolled back.`);
    showToast(t("toast.delete_fail", { error: message }), "error");
    return false;
  }
}

export async function deleteItem(path, isFolder = false) {
  return runDeleteItem(Object.freeze({ path, isFolder: Boolean(isFolder) }));
}

/**
 * Copy a file or folder
 */
async function browseLocalCopy(destination) {
  eventBus.emit('ui:switch-sidebar-view', 'explorer');
  const parentPath = destination.includes('/') ? destination.split('/').slice(0, -1).join('/') : '';
  const { navigateToFolder } = await import('./file-tree.js?v=2.5.188');
  await navigateToFolder(parentPath);
}

async function confirmCopyItem(request) {
  const item = request.isFolder ? 'folder' : 'file';
  const confirmed = await showConfirmDialog({
    title: `Retry copying ${item}?`,
    message: `Copy ${request.source} to ${request.destination} in Local Home Assistant? If the destination now exists, it will be replaced after the new copy is fully staged.`,
    confirmText: 'Retry Copy',
    cancelText: t('modal.cancel_button'),
    isDanger: true,
  });
  if (confirmed) return runCopyItem(Object.freeze({ ...request, overwrite: true }));
  return false;
}

async function runCopyItem(request) {
  const item = request.isFolder ? 'folder' : 'file';
  const operation = startOperationFeedback({
    label: `Copy local ${item}`,
    icon: 'content_copy',
    scope: 'Local Home Assistant workspace',
    target: `${request.source} -> ${request.destination}`,
    message: `Copying ${request.source}...`,
    retry: () => confirmCopyItem(request),
    open: () => browseLocalCopy(request.destination),
    openLabel: 'Browse Destination',
    openIcon: 'folder_open',
  });
  try {
    const response = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "copy",
        source: request.source,
        destination: request.destination,
        overwrite: request.overwrite,
      }),
    });
    if (!response?.success) throw new Error(response?.message || response?.error || 'Copy request failed');
    showToast(t("toast.copied"), "success");
    eventBus.emit('ui:reload-files', { force: true });

    // Auto-refresh git status after copying file
    eventBus.emit('git:refresh');

    operation.finish(`Copied ${request.source}`, { detail: `${request.source} -> ${request.destination}` });
    return true;
  } catch (error) {
    const message = error?.message || String(error);
    eventBus.emit('ui:reload-files', { force: true });
    operation.fail(`Could not copy ${request.source}`, message);
    showToast(t("toast.copy_fail", { error: message }), "error");
    return false;
  }
}

export async function copyItem(source, destination, overwrite = false, isFolder = false) {
  return runCopyItem(Object.freeze({ source, destination, overwrite: Boolean(overwrite), isFolder: Boolean(isFolder) }));
}

/**
 * Rename a file or folder
 */
async function confirmRenameItemRetry(request) {
  const confirmed = await showConfirmDialog({
    title: 'Retry renaming item?',
    message: `Rename ${request.source} to ${request.destination} in Local Home Assistant? If the destination now exists, it will be replaced.`,
    confirmText: 'Retry Rename',
    cancelText: t('modal.cancel_button'),
    isDanger: true,
  });
  if (confirmed) return runRenameItem(Object.freeze({ ...request, overwrite: true }));
  return false;
}

async function runRenameItem(request) {
  const operation = startOperationFeedback({
    label: 'Rename local item',
    icon: 'drive_file_rename_outline',
    scope: 'Local Home Assistant workspace',
    target: `${request.source} -> ${request.destination}`,
    message: `Renaming ${request.source}...`,
    retry: () => confirmRenameItemRetry(request),
    open: () => browseLocalPath(localParentPath(request.destination)),
    openLabel: 'Browse Destination',
    openIcon: 'folder_open',
  });
  try {
    const response = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "rename",
        source: request.source,
        destination: request.destination,
        overwrite: request.overwrite,
      }),
    });
    if (!response?.success) throw new Error(saveFailure(response, 'Rename request failed'));
    showToast(t("toast.renamed"), "success");

    // Keep exact and descendant tabs attached when a folder is renamed.
    const sourcePrefix = `${request.source.replace(/\/+$/g, '')}/`;
    let tabsChanged = false;
    for (const tab of state.openTabs) {
      if (tab.path === request.source) {
        tab.path = request.destination;
        tab.name = request.destination.split('/').pop();
        tabsChanged = true;
      } else if (tab.path.startsWith(sourcePrefix)) {
        tab.path = `${request.destination}/${tab.path.slice(sourcePrefix.length)}`;
        tabsChanged = true;
      }
    }
    if (tabsChanged) eventBus.emit('ui:refresh-tabs');

    eventBus.emit('ui:reload-files', { force: true });

    // Auto-refresh git status after renaming file
    eventBus.emit('git:refresh');

    operation.finish(`Renamed to ${request.destination}`, {
      detail: `${request.source} -> ${request.destination}`,
    });
    return true;
  } catch (error) {
    operation.fail(`Could not rename ${request.source}`, error.message);
    showToast(t("toast.rename_fail", { error: error.message }), "error");
    return false;
  }
}

export async function renameItem(source, destination, overwrite = false) {
  return runRenameItem(Object.freeze({
    source: String(source || ''),
    destination: String(destination || ''),
    overwrite: Boolean(overwrite),
  }));
}

/**
 * Pre-process YAML to fix common indentation issues
 * Helps avoid syntax errors when formatting
 */
function fixYamlIndentation(content) {
  const lines = content.split('\n');
  const fixed = [];
  let currentIndent = 0;
  let inListContext = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      fixed.push(line);
      continue;
    }

    // Detect list items
    if (trimmed.startsWith('- ')) {
      // Get the indentation of previous list item (if any)
      if (inListContext && i > 0) {
        // Find the last list item to match its indentation
        for (let j = i - 1; j >= 0; j--) {
          const prevLine = lines[j];
          const prevTrimmed = prevLine.trim();
          if (prevTrimmed.startsWith('- ')) {
            const prevIndent = prevLine.match(/^(\s*)/)[1].length;
            const content = trimmed.substring(2); // Remove '- '
            fixed.push(' '.repeat(prevIndent) + '- ' + content);
            inListContext = true;
            break;
          }
          // If we hit a non-list line, use current indentation
          if (prevTrimmed && !prevTrimmed.startsWith('- ')) {
            fixed.push(line);
            inListContext = true;
            break;
          }
        }
      } else {
        // First list item - keep as is
        fixed.push(line);
        inListContext = true;
      }
    } else if (trimmed.includes(':') && !trimmed.startsWith('- ')) {
      // Key-value pair - reset list context
      inListContext = false;
      fixed.push(line);
    } else {
      // Other content
      fixed.push(line);
    }
  }

  return fixed.join('\n');
}

/**
 * Format code using Prettier
 */
export async function formatCode() {
  if (!state.editor) {
    eventBus.emit('editor:operation-result', { status: 'warning', title: 'Format unavailable', message: 'Open an editable file first.' });
    return { success: false, reason: 'no-editor' };
  }

  const activeTab = state.activeTab;
  const editor = state.editor;
  if (!activeTab) return { success: false, reason: 'no-file' };

  const content = editor.getValue();
  const filePath = activeTab.path;
  const fileName = filePath.split('/').pop();

  // Determine file type
  let parser = null;
  if (fileName.match(/\.ya?ml$/i)) {
    parser = 'yaml';
  } else if (fileName.match(/\.json$/i)) {
    parser = 'json';
  } else if (fileName.match(/\.jsx?$/i)) {
    parser = 'babel';
  } else if (fileName.match(/\.tsx?$/i)) {
    parser = 'typescript';
  } else if (fileName.match(/\.css$/i)) {
    parser = 'css';
  } else if (fileName.match(/\.s[ca]ss$/i)) {
    parser = 'scss';
  } else if (fileName.match(/\.html?$/i)) {
    parser = 'html';
  } else if (fileName.match(/\.md$/i)) {
    parser = 'markdown';
  } else {
    showToast(t("toast.format_not_supported"), "warning");
    eventBus.emit('editor:operation-result', { status: 'warning', title: 'Format unavailable', message: `${fileName} is not a supported format.` });
    return { success: false, reason: 'unsupported' };
  }

  const openFormattedFile = async () => {
    await Promise.all(eventBus.emit('file:open', { path: filePath }).filter(Boolean));
  };
  const retryFormatting = async () => {
    await openFormattedFile();
    return formatCode();
  };
  const operation = startOperationFeedback({
    label: `Format ${fileName}`,
    icon: 'format_align_left',
    scope: 'Document',
    target: filePath,
    message: `Preparing ${parser} formatter...`,
    retry: retryFormatting,
    open: openFormattedFile,
    openLabel: 'Open file',
    openIcon: 'description',
  });

  try {
    // Load Prettier if not already loaded
    if (!window.prettier) {
      showToast(t("toast.format_loading"), "info");
      operation.update({ message: 'Loading formatting libraries...', percent: 20 });
      await loadPrettier();
    }

    // Pre-process YAML to fix common indentation issues
    let contentToFormat = content;
    if (parser === 'yaml') {
      contentToFormat = fixYamlIndentation(content);
    }

    // Format the code
    operation.update({ message: `Formatting ${fileName}...`, percent: 60 });
    const formatted = await window.prettier.format(contentToFormat, {
      parser: parser,
      plugins: window.prettierPlugins,
      tabWidth: state.tabSize || 2,
      useTabs: state.indentWithTabs || false,
      semi: true,
      singleQuote: false,
      trailingComma: 'none',
      bracketSpacing: true,
      arrowParens: 'avoid',
      printWidth: 80,
      endOfLine: 'lf'
    });

    const documentChanged = state.activeTab !== activeTab
      || state.editor !== editor
      || editor.getValue() !== content;
    if (documentChanged) {
      const message = 'The document changed while formatting. No formatted text was applied; Retry uses the current document content.';
      operation.fail('Formatting was not applied', message);
      showToast(message, 'warning');
      eventBus.emit('editor:operation-result', { status: 'warning', title: 'Formatting not applied', message });
      return { success: false, reason: 'document-changed' };
    }

    // Only update if content changed
    if (formatted !== content) {
      const cursor = editor.getCursor();
      const selections = editor.listSelections?.();
      const scroll = editor.getScrollInfo();

      editor.setValue(formatted);

      // Restore cursor position (approximate)
      if (selections?.length) editor.setSelections(selections);
      else editor.setCursor(cursor);
      editor.scrollTo(scroll.left, scroll.top);

      // Mark as modified
      activeTab.modified = true;
      activeTab.content = formatted;

      eventBus.emit('ui:refresh-tabs');
      eventBus.emit('ui:update-toolbar-state');

      operation.finish(`Formatted ${fileName}`, { detail: `Parser: ${parser}`, percent: 100 });
      showToast(t("toast.format_success"), "success");
      eventBus.emit('editor:operation-result', { status: 'success', title: 'Formatting complete', message: `${fileName} was formatted without moving the editor view.` });
      return { success: true, changed: true };
    } else {
      operation.finish(`${fileName} is already formatted`, { detail: `Parser: ${parser}`, percent: 100 });
      showToast(t("toast.format_already"), "info");
      eventBus.emit('editor:operation-result', { status: 'info', title: 'Already formatted', message: `${fileName} did not need changes.` });
      return { success: true, changed: false };
    }
  } catch (error) {
    console.error("Formatting error:", error);
    operation.fail(`Could not format ${fileName}`, error.message || String(error));

    // Check if it's a syntax error
    if (error.message && (error.message.includes('SyntaxError') || error.message.includes('YAMLSyntaxError'))) {
      showToast(t("toast.format_syntax_error"), "error");

      // Extract line number if available
      const lineMatch = error.message.match(/\((\d+):/);
      const lineMessage = lineMatch ? ` near line ${parseInt(lineMatch[1], 10)}` : '';
      eventBus.emit('editor:operation-result', { status: 'error', title: 'Formatting failed', message: `${fileName} has a syntax error${lineMessage}.` });
    } else {
      showToast(`Formatting failed: ${error.message}`, "error");
      eventBus.emit('editor:operation-result', { status: 'error', title: 'Formatting failed', message: `${fileName}: ${error.message}` });
    }
    return { success: false, error: error.message };
  }
}



/**
 * Validate Python using Pyodide (Python in WASM)
 * Uses Python's ast module for accurate syntax checking
 */
/**
 * Validate Python using server-side ast.parse()
 * Server-side validation is simple and reliable
 */
export async function validatePython(content) {
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "check_python", content }),
    });
    return data;
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Load Acorn JavaScript parser for syntax validation
 */
async function loadAcorn() {
  if (window.acorn) return; // Already loaded

  try {
    await loadScript("/local/blueprint_studio/vendor/acorn/acorn.js");
    /*console.log*/ void("✅ Acorn parser loaded successfully");
  } catch (error) {
    console.error("Failed to load Acorn:", error);
    throw new Error("Failed to load JavaScript parser");
  }
}

/**
 * Validate JavaScript using Acorn parser (industry-standard)
 * This is much more reliable than regex-based validation
 */
export async function validateJavaScript(content) {
  try {
    // Load acorn if not already loaded
    if (!window.acorn) {
      await loadAcorn();
    }

    const errors = [];
    const warnings = [];

    // Try to parse with acorn
    try {
      window.acorn.parse(content, {
        ecmaVersion: 2022,
        sourceType: 'module',
        allowAwaitOutsideFunction: true,
        allowImportExportEverywhere: true,
        allowSuperOutsideMethod: true
      });

      // If parsing succeeds, check for common issues
      const lines = content.split('\n');

      // Check for debug code (console.log, debugger)
      lines.forEach((line, idx) => {
        const lineNum = idx + 1;
        const stripped = line.trim();

        if (stripped.startsWith('//') || stripped.startsWith('/*')) {
          return; // Skip comments
        }

        if (/\bconsole\.(log|error|warn|info|debug)\s*\(/.test(line)) {
          warnings.push({
            line: lineNum,
            type: "debug_code",
            message: "Debug code found in file",
            solution: "Remove console.log, console.error, or debugger before deploying",
            example: "Remove or comment out: console.log(...)",
            original: stripped
          });
        }

        if (/\bdebugger\b/.test(line)) {
          warnings.push({
            line: lineNum,
            type: "debug_code",
            message: "Debugger statement found",
            solution: "Remove debugger statement before deploying",
            example: "Remove: debugger;",
            original: stripped
          });
        }
      });

      if (warnings.length > 0) {
        return {
          valid: true,
          warnings: warnings,
          warning_count: warnings.length,
          message: "JavaScript is valid but has issues"
        };
      }

      return {
        valid: true,
        message: "JavaScript syntax is valid!"
      };
    } catch (parseError) {
      // Parse error - provide detailed error info
      const match = parseError.message.match(/\((\d+):(\d+)\)/);
      const line = match ? parseInt(match[1]) : 1;
      const column = match ? parseInt(match[2]) : 0;

      errors.push({
        line: line,
        column: column,
        type: "syntax_error",
        message: parseError.message.replace(/\s*\(\d+:\d+\)/, ''),
        solution: "Check JavaScript syntax at the indicated line",
        example: "Make sure all brackets, braces, and parentheses are matched",
        original: content.split('\n')[line - 1]?.trim() || ""
      });

      return {
        valid: false,
        errors: errors,
        error_count: 1,
        message: "JavaScript syntax error"
      };
    }
  } catch (error) {
    console.error("JavaScript validation error:", error);
    return {
      valid: false,
      error: error.message,
      message: "Failed to validate JavaScript"
    };
  }
}

/**
 * Load Prettier library and plugins
 */
async function loadPrettier() {
  if (window.prettier) return; // Already loaded

  try {
    // Load Prettier standalone
    await loadScript("/local/blueprint_studio/vendor/prettier/standalone.js");

    // Load plugins
    await loadScript("/local/blueprint_studio/vendor/prettier/babel.js");
    await loadScript("/local/blueprint_studio/vendor/prettier/estree.js");
    await loadScript("/local/blueprint_studio/vendor/prettier/yaml.js");
    await loadScript("/local/blueprint_studio/vendor/prettier/html.js");
    await loadScript("/local/blueprint_studio/vendor/prettier/markdown.js");
    await loadScript("/local/blueprint_studio/vendor/prettier/postcss.js");
    await loadScript("/local/blueprint_studio/vendor/prettier/typescript.js");

    // Store plugins for Prettier to use
    window.prettierPlugins = {
      babel: window.prettierPlugins.babel,
      estree: window.prettierPlugins.estree,
      yaml: window.prettierPlugins.yaml,
      html: window.prettierPlugins.html,
      markdown: window.prettierPlugins.markdown,
      postcss: window.prettierPlugins.postcss,
      typescript: window.prettierPlugins.typescript
    };

    /*console.log*/ void("✅ Prettier loaded successfully");
  } catch (error) {
    console.error("Failed to load Prettier:", error);
    throw new Error("Failed to load formatting library");
  }
}

/**
 * Validate YAML syntax
 */
/**
 * Unified syntax validator - detects file type and applies correct validation
 * Works like VS Code (automatic language detection)
 */
export async function validateSyntax(fileName, content) {
  try {
    // Ensure fileName is a string
    const fileNameStr = fileName || "file.yaml";

    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "check_syntax",
        content: content || "",
        file_path: fileNameStr
      }),
    });
    return data;
  } catch (error) {
    console.error("Validation error:", error);
    return { valid: false, error: error.message };
  }
}

export async function validateYaml(content) {
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "check_yaml", content }),
    });
    return data;
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Validate JSON content
 */
export async function validateJson(content) {
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "check_json", content }),
    });
    return data;
  } catch (error) {
    return { valid: false, error: error.message };
  }
}


/**
 * Unified validation dispatcher by file type
 * Uses browser-side validation for JavaScript (instant, no network)
 * Uses server-side validation for Python, YAML, JSON (reliable parsing)
 */
export async function validateByFileType(fileName, content) {
  // Get file extension
  const ext = fileName?.match(/\.(\w+)$/i)?.[1]?.toLowerCase();

  // Use browser-based validation for JavaScript (instant, no network round-trip)
  if (ext === 'js') {
    return validateJavaScript(content);
  }

  // Use server-side validation for Python (ast.parse is authoritative)
  if (ext === 'py') {
    return validatePython(content);
  }

  // Use server-side validation for other formats
  // (YAML, JSON require more complex parsing)
  return validateSyntax(fileName, content);
}
