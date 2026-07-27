/** FILE-OPERATIONS.JS | Purpose: * Handles all file system operations including creating, deleting, copying, */
import { state, elements } from './state.js';
import { fetchWithAuth } from './api.js';
import { API_BASE } from './constants.js';
import { showToast } from './ui.js';
import { loadScript, formatBytes } from './utils.js';
import { t } from './translations.js';
import { eventBus } from './event-bus.js';
import { isSftpPath, saveSftpFile } from './sftp.js?v=2.5.75';

/**
 * Save a file
 */
export async function saveFile(path, content) {
  // SFTP files are saved via the SFTP module
  if (isSftpPath(path)) {
    const tab = state.openTabs.find(t => t.path === path);
    if (tab) return await saveSftpFile(tab, content);
    return false;
  }

  try {
    const response = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "write_file", path, content }),
    });
    
    // Update tab mtime if successful
    if (response.success && response.mtime) {
        const tab = state.openTabs.find(t => t.path === path);
        if (tab) tab.mtime = response.mtime;
    }

    // Refresh files to get updated size (including current file's new size)
    eventBus.emit('ui:reload-files', { force: true });
    
    // Find the file to get its size
    const fileEntry = state.files.find(f => f.path === path);
    const fileSize = fileEntry && typeof fileEntry.size === 'number' ? ` (${formatBytes(fileEntry.size)})` : '';
    showToast(t("toast.saved", { file: path.split("/").pop() }), "success");

    // Auto-refresh git status after saving to show changes immediately
    eventBus.emit('git:refresh');

    return true;
  } catch (error) {
    showToast(t("toast.save_failed", { error: error.message }), "error");
    return false;
  }
}

/**
 * Create a new file
 */
export async function createFile(path, content = "", is_base64 = false, overwrite = false) {
  try {
    await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create_file", path, content, is_base64, overwrite }),
    });
    showToast(t("toast.upload_success"), "success");
    eventBus.emit('ui:reload-files', { force: true });
    eventBus.emit('file:open', { path });

    // Auto-refresh git status after creating file
    eventBus.emit('git:refresh');

    return true;
  } catch (error) {
    showToast(t("toast.file_create_fail", { error: error.message }), "error");
    return false;
  }
}

/**
 * Create a new folder
 */
export async function createFolder(path) {
  try {
    await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create_folder", path }),
    });
    showToast(t("toast.upload_success"), "success");
    eventBus.emit('ui:reload-files', { force: true });
    state.expandedFolders.add(path);
    eventBus.emit('ui:refresh-tree');

    // Auto-refresh git status after creating folder
    eventBus.emit('git:refresh');

    return true;
  } catch (error) {
    showToast(t("toast.folder_create_fail", { error: error.message }), "error");
    return false;
  }
}

/**
 * Delete a file or folder
 */
export async function deleteItem(path) {
  try {
    await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", path }),
    });
    showToast(t("toast.deleted"), "success");

    // Close open tabs: exact match for the item, plus all children if it's a folder
    const folderPrefix = path.endsWith('/') ? path : path + '/';
    const tabsToClose = state.openTabs.filter(t => t.path === path || t.path.startsWith(folderPrefix));
    tabsToClose.forEach(tab => eventBus.emit('tab:close', { tab, force: true }));

    eventBus.emit('ui:reload-files', { force: true });

    // Auto-refresh git status after deleting file
    eventBus.emit('git:refresh');

    return true;
  } catch (error) {
    showToast(t("toast.delete_fail", { error: error.message }), "error");
    return false;
  }
}

/**
 * Copy a file or folder
 */
export async function copyItem(source, destination, overwrite = false) {
  try {
    await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "copy", source, destination, overwrite }),
    });
    showToast(t("toast.moved"), "success");
    eventBus.emit('ui:reload-files', { force: true });

    // Auto-refresh git status after copying file
    eventBus.emit('git:refresh');

    return true;
  } catch (error) {
    showToast(t("toast.copy_fail", { error: error.message }), "error");
    return false;
  }
}

/**
 * Rename a file or folder
 */
export async function renameItem(source, destination, overwrite = false) {
  try {
    await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rename", source, destination, overwrite }),
    });
    showToast(t("toast.renamed"), "success");

    // Update tab path if open
    const tab = state.openTabs.find(t => t.path === source);
    if (tab) {
      tab.path = destination;
      eventBus.emit('ui:refresh-tabs');
    }

    eventBus.emit('ui:reload-files', { force: true });

    // Auto-refresh git status after renaming file
    eventBus.emit('git:refresh');

    return true;
  } catch (error) {
    showToast(t("toast.rename_fail", { error: error.message }), "error");
    return false;
  }
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
  if (!state.editor) return;

  const activeTab = state.activeTab;
  if (!activeTab) return;

  const content = state.editor.getValue();
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
    return;
  }

  try {
    // Load Prettier if not already loaded
    if (!window.prettier) {
      showToast(t("toast.format_loading"), "info");
      await loadPrettier();
    }

    // Pre-process YAML to fix common indentation issues
    let contentToFormat = content;
    if (parser === 'yaml') {
      contentToFormat = fixYamlIndentation(content);
    }

    // Format the code
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

    // Only update if content changed
    if (formatted !== content) {
      const cursor = state.editor.getCursor();
      const scroll = state.editor.getScrollInfo();

      state.editor.setValue(formatted);

      // Restore cursor position (approximate)
      state.editor.setCursor(cursor);
      state.editor.scrollTo(scroll.left, scroll.top);

      // Mark as modified
      activeTab.modified = true;
      activeTab.content = formatted;

      eventBus.emit('ui:refresh-tabs');
      eventBus.emit('ui:update-toolbar-state');

      showToast(t("toast.format_success"), "success");
    } else {
      showToast(t("toast.format_already"), "info");
    }
  } catch (error) {
    console.error("Formatting error:", error);

    // Check if it's a syntax error
    if (error.message && (error.message.includes('SyntaxError') || error.message.includes('YAMLSyntaxError'))) {
      showToast(t("toast.format_syntax_error"), "error");

      // Extract line number if available
      const lineMatch = error.message.match(/\((\d+):/);
      if (lineMatch && state.editor) {
        const lineNum = parseInt(lineMatch[1]) - 1;
        state.editor.setCursor(lineNum, 0);
        state.editor.focus();
        showToast(t("toast.validation_error") + ` at line ${lineNum + 1}`, "warning");
      }
    } else {
      showToast(`Formatting failed: ${error.message}`, "error");
    }
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
