/** FILE-OPERATIONS-UI.JS | Purpose: * Handles all dialog prompts for file and folder operations (create, rename, */
import { state, elements } from './state.js';
import { t } from './translations.js';
import { eventBus } from './event-bus.js';
import { 
  resetModalToDefault, 
  showToast, 
  showModal, 
  showConfirmDialog,
  confirmModal,
  hideModal,
  activateSharedModal,
  deactivateSharedModal
} from './ui.js';

/**
 * Shows a generic input modal and returns the user's input
 * @param {Object} options - Modal configuration
 * @returns {Promise<string|null>} User input or null if cancelled
 */
export function showInputModal({ title, placeholder, value, hint, confirmText }) {
  return new Promise((resolve) => {
      resetModalToDefault(); // Ensure DOM structure is correct

      elements.modalTitle.textContent = title;
      if (elements.modalHint) elements.modalHint.textContent = hint || "";

      // Setup Input
      if (elements.modalInput) {
          elements.modalInput.value = value || "";
          elements.modalInput.placeholder = placeholder || "";
          elements.modalInput.style.display = "block";
      }

      // Setup Buttons
      elements.modalConfirm.textContent = confirmText || t("modal.confirm_button");
      elements.modalConfirm.className = "modal-btn primary";
      elements.modalCancel.textContent = t("modal.cancel_button");

      // Show Modal
      activateSharedModal({ initialFocus: elements.modalInput });

      // Focus Input
      setTimeout(() => {
          if (elements.modalInput) {
              elements.modalInput.focus();
              if (elements.modalInput.value) {
                  const len = elements.modalInput.value.length;
                  elements.modalInput.setSelectionRange(len, len);
              }
          }
      }, 100);

      // Handlers
      const cleanup = () => {
          deactivateSharedModal();
          elements.modalConfirm.removeEventListener("click", handleConfirm);
          elements.modalCancel.removeEventListener("click", handleCancel);
          elements.modalClose.removeEventListener("click", handleCancel);
      };

      const handleConfirm = () => {
          const result = elements.modalInput ? elements.modalInput.value : "";
          cleanup();
          resolve(result);
      };

      const handleCancel = () => {
          cleanup();
          resolve(null);
      };

      elements.modalConfirm.addEventListener("click", handleConfirm);
      elements.modalCancel.addEventListener("click", handleCancel);
      elements.modalClose.addEventListener("click", handleCancel);

      // Override the global Enter key behavior for this specific modal instance
      if (elements.modalInput) {
           elements.modalInput.onkeydown = (e) => {
              if (e.key === "Enter") {
                  e.stopPropagation(); // Prevent global handler
                  handleConfirm();
              } else if (e.key === "Escape") {
                  e.stopPropagation();
                  handleCancel();
              }
           };
      }
  });
}

/**
 * Prompts user to create a new file
 * @param {string|null} initialPath - Initial folder path to use
 */
export async function promptNewFile(initialPath = null) {
  // Use provided path or fall back to state.
  // In lazy loading mode (navigation), use currentNavigationPath.
  // In tree mode, use currentFolderPath.
  let basePath = initialPath;
  if (basePath === null) {
    basePath = state.lazyLoadingEnabled ? (state.currentNavigationPath || "") : (state.currentFolderPath || "");
  }
  
  const visualPrefix = "/config/";
  // Construct display value: /config/ + relative_path + /
  const defaultValue = basePath ? `${visualPrefix}${basePath}/` : visualPrefix;

  const result = await showInputModal({
    title: t("modal.new_file_title"),
    placeholder: "filename.yaml",
    value: defaultValue,
    hint: t("modal.new_file_hint"),
  });

  if (result) {
    if (result === defaultValue || result.endsWith("/")) {
        showToast(t("toast.please_enter_a_file_name"), "warning");
        return;
    }

    let fullPath = result;
    
    // Strip the visual /config/ prefix for the backend
    if (fullPath.startsWith(visualPrefix)) {
      fullPath = fullPath.substring(visualPrefix.length);
    } else if (fullPath.startsWith("/")) {
      // Handle case where user deleted 'config' but kept leading slash
      fullPath = fullPath.substring(1);
    }

    // Auto-append .yaml if no extension is present
    const parts = fullPath.split('/');
    const fileName = parts[parts.length - 1];
    if (fileName && fileName.indexOf('.') === -1) {
      fullPath += ".yaml";
    }

    // Check if file already exists
    const exists = state.files.some(f => f.path === fullPath);
    if (exists) {
      const confirm = await showConfirmDialog({
        title: t("modal.file_exists_title"),
        message: t("modal.file_exists_message", { name: fileName }),
        confirmText: t("modal.overwrite"),
        cancelText: t("modal.cancel_button"),
        isDanger: true
      });
      if (!confirm) return;
    }

    eventBus.emit('file:create', { path: fullPath, content: "", noOpen: false, overwrite: true });
  }
}

/**
 * Prompts user to create a new folder
 * @param {string|null} initialPath - Initial folder path to use
 */
export async function promptNewFolder(initialPath = null) {
  // Use provided path or fall back to state
  let basePath = initialPath;
  if (basePath === null) {
    basePath = state.lazyLoadingEnabled ? (state.currentNavigationPath || "") : (state.currentFolderPath || "");
  }
  
  const visualPrefix = "/config/";
  const defaultValue = basePath ? `${visualPrefix}${basePath}/` : visualPrefix;

  const result = await showInputModal({
    title: t("modal.new_folder_title"),
    placeholder: "folder_name",
    value: defaultValue,
    hint: t("modal.new_folder_hint"),
  });

  if (result) {
    if (result === defaultValue || result.endsWith("/")) {
        showToast(t("toast.please_enter_a_folder_name"), "warning");
        return;
    }
    
    let fullPath = result;
    
    // Strip the visual /config/ prefix for the backend
    if (fullPath.startsWith(visualPrefix)) {
      fullPath = fullPath.substring(visualPrefix.length);
    } else if (fullPath.startsWith("/")) {
      fullPath = fullPath.substring(1);
    }
    
    eventBus.emit('folder:create', { path: fullPath });
  }
}

/**
 * Prompts user to rename a file or folder
 * @param {string} path - Current path
 * @param {boolean} isFolder - Whether it's a folder
 */
export async function promptRename(path, isFolder) {
  const currentName = path.split("/").pop();
  const parentPath = path.split("/").slice(0, -1).join("/");

  const result = await showModal({
    title: isFolder ? t("modal.rename_folder_title") : t("modal.rename_file_title"),
    placeholder: "New name",
    value: currentName,
    hint: t("modal.rename_hint"),
  });

  if (result && result !== currentName) {
    const newPath = parentPath ? `${parentPath}/${result}` : result;
    
    // Check if target already exists
    const exists = isFolder
      ? state.folders.some(f => f.path === newPath)
      : state.files.some(f => f.path === newPath);
      
    if (exists) {
      const confirm = await showConfirmDialog({
        title: isFolder ? t("modal.rename_folder_title") : t("modal.rename_file_title"),
        message: t("modal.file_exists_message", { name: result }),
        confirmText: t("modal.overwrite"),
        cancelText: t("modal.cancel_button"),
        isDanger: true
      });
      if (!confirm) return;
    }
    
    eventBus.emit('file:rename', { oldPath: path, newPath, overwrite: true });
  }
}

/**
 * Prompts user to copy a file or folder
 * @param {string} path - Current path
 * @param {boolean} isFolder - Whether it's a folder
 */
export async function promptCopy(path, isFolder) {
  const currentName = path.split("/").pop();
  const parentPath = path.split("/").slice(0, -1).join("/");

  let defaultName = `${currentName}_copy`;

  // If it's a file with an extension, insert _copy before the extension
  if (!isFolder && currentName.includes(".")) {
      const parts = currentName.split(".");
      const ext = parts.pop();
      const name = parts.join(".");
      if (name) { // Ensure it's not just ".gitignore" (empty name)
          defaultName = `${name}_copy.${ext}`;
      }
  }

  const result = await showModal({
    title: isFolder ? t("modal.copy_folder_title") : t("modal.copy_file_title"),
    placeholder: "New name",
    value: defaultName,
    hint: t("modal.copy_hint"),
  });

  if (result) {
    const newPath = parentPath ? `${parentPath}/${result}` : result;
    
    // Check if target already exists
    const exists = isFolder
      ? state.folders.some(f => f.path === newPath)
      : state.files.some(f => f.path === newPath);
      
    if (exists) {
      const confirm = await showConfirmDialog({
        title: isFolder ? t("modal.copy_folder_title") : t("modal.copy_file_title"),
        message: t("modal.file_exists_message", { name: result }),
        confirmText: t("modal.overwrite"),
        cancelText: t("modal.cancel_button"),
        isDanger: true
      });
      if (!confirm) return;
    }
    
    eventBus.emit('file:copy', { oldPath: path, newPath, overwrite: true });
  }
}

/**
 * Prompts user to move a file or folder
 * @param {string} path - Current path
 * @param {boolean} isFolder - Whether it's a folder
 */
export async function promptMove(path, isFolder) {
  const currentName = path.split("/").pop();
  const currentFullPath = path;

  const result = await showModal({
    title: isFolder ? t("modal.move_folder_title") : t("modal.move_file_title"),
    placeholder: "New path",
    value: currentFullPath,
    hint: t("modal.move_hint"),
  });

  if (result && result !== currentFullPath) {
    const resultName = result.split("/").pop();
    // Check if target already exists
    const exists = isFolder
      ? state.folders.some(f => f.path === result)
      : state.files.some(f => f.path === result);
      
    if (exists) {
      const confirm = await showConfirmDialog({
        title: t("modal.move_title"),
        message: t("modal.file_exists_message", { name: resultName }),
        confirmText: t("modal.overwrite"),
        cancelText: t("modal.cancel_button"),
        isDanger: true
      });
      if (!confirm) return;
    }
    
    eventBus.emit('file:rename', { oldPath: path, newPath: result, overwrite: true });
  }
}

/**
 * Duplicates a file or folder with an auto-generated name
 * @param {string} path - Current path
 * @param {boolean} isFolder - Whether it's a folder
 */
export async function duplicateItem(path, isFolder) {
  const currentName = path.split("/").pop();
  const parentPath = path.split("/").slice(0, -1).join("/");

  let newName = "";
  let counter = 1;
  let baseName = currentName;
  let ext = "";

  if (!isFolder && currentName.includes(".")) {
      const parts = currentName.split(".");
      ext = "." + parts.pop();
      baseName = parts.join(".");
  }

  // Find a unique name
  while (true) {
      const suffix = counter === 1 ? "_copy" : `_copy_${counter}`;
      newName = `${baseName}${suffix}${ext}`;
      const newPath = parentPath ? `${parentPath}/${newName}` : newName;

      let exists = false;
      if (state.lazyLoadingEnabled) {
        // In navigation mode, check the currently loaded directory contents
        const dirData = state.loadedDirectories.get(parentPath || "");
        if (dirData) {
          exists = isFolder 
            ? dirData.folders.some(f => f.path === newPath)
            : dirData.files.some(f => f.path === newPath);
        } else {
          // Fallback if directory not loaded (unlikely for current folder)
          exists = isFolder
            ? state.folders.some(f => f.path === newPath)
            : state.files.some(f => f.path === newPath);
        }
      } else {
        // Standard tree mode
        exists = isFolder
            ? state.folders.some(f => f.path === newPath)
            : state.files.some(f => f.path === newPath);
      }

      if (!exists) break;
      counter++;
      if (counter > 100) {
          showToast(t("toast.unique_name_error"), "error");
          return;
      }
  }

  const newPath = parentPath ? `${parentPath}/${newName}` : newName;
  eventBus.emit('file:copy', { oldPath: path, newPath });
}

/**
 * Prompts user to confirm deletion of a file or folder
 * @param {string} path - Path to delete
 * @param {boolean} isFolder - Whether it's a folder
 */
export async function promptDelete(path, isFolder) {
  const name = path.split("/").pop();
  const result = await showConfirmDialog({
    title: isFolder ? t("modal.delete_folder_title") : t("modal.delete_file_title"),
    message: isFolder ? t("modal.delete_folder_message", { name }) : t("modal.delete_message", { name }),
    confirmText: t("modal.delete_button"),
    cancelText: t("modal.cancel_button"),
    isDanger: true,
  });

  if (result) {
    eventBus.emit('file:delete', { path });
  }
}

/**
 * Generates a blueprint YAML template
 * @param {string} name - Blueprint name
 * @param {string} domain - 'automation' or 'script'
 * @returns {string} Blueprint YAML content
 */
export function generateBlueprintTemplate(name, domain = 'automation') {
  const safeName = name || 'My Blueprint';
  if (domain === 'script') {
    return `blueprint:
  name: "${safeName}"
  description: ""
  domain: script
  author: ""
  input:
    target_entity:
      name: Target Entity
      description: The entity to control
      selector:
        entity: {}

sequence:
  - action: homeassistant.turn_on
    target:
      entity_id: !input target_entity

mode: single
`;
  }
  return `blueprint:
  name: "${safeName}"
  description: ""
  domain: automation
  author: ""
  input:
    trigger_entity:
      name: Trigger Entity
      description: The entity that triggers this automation
      selector:
        entity: {}
    target_entity:
      name: Target Entity
      description: The entity to control
      selector:
        entity: {}

triggers:
  - trigger: state
    entity_id: !input trigger_entity
    to: "on"

conditions: []

actions:
  - action: homeassistant.turn_on
    target:
      entity_id: !input target_entity

mode: single
`;
}

/**
 * Prompts user to create a new blueprint file
 * @param {string|null} initialPath - Initial folder path to use
 */
export async function promptNewBlueprint(initialPath = null) {
  let basePath = initialPath;
  if (basePath === null) {
    basePath = state.lazyLoadingEnabled ? (state.currentNavigationPath || "") : (state.currentFolderPath || "");
  }

  // Infer domain from path
  const domain = (basePath || '').includes('script') ? 'script' : 'automation';
  const defaultFolder = `blueprints/${domain}/`;
  const visualPrefix = "/config/";
  const defaultValue = basePath ? `${visualPrefix}${basePath}/` : `${visualPrefix}${defaultFolder}`;

  const result = await showInputModal({
    title: "New Blueprint",
    placeholder: "my_blueprint.yaml",
    value: defaultValue,
    hint: `Creates a blueprint template in the blueprints/${domain}/ folder`,
  });

  if (!result) return;
  if (result === defaultValue || result.endsWith("/")) {
    showToast("Please enter a file name", "warning");
    return;
  }

  let fullPath = result;
  if (fullPath.startsWith(visualPrefix)) {
    fullPath = fullPath.substring(visualPrefix.length);
  } else if (fullPath.startsWith("/")) {
    fullPath = fullPath.substring(1);
  }

  // Auto-append .yaml
  const parts = fullPath.split('/');
  const fileName = parts[parts.length - 1];
  if (fileName && fileName.indexOf('.') === -1) {
    fullPath += ".yaml";
  }

  // Extract a friendly name from the file name
  const bpName = fileName.replace(/\.ya?ml$/i, '').replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const content = generateBlueprintTemplate(bpName, domain);

  const exists = state.files.some(f => f.path === fullPath);
  if (exists) {
    const confirm = await showConfirmDialog({
      title: "File Already Exists",
      message: `${fileName} already exists. Overwrite?`,
      confirmText: "Overwrite",
      isDanger: true
    });
    if (!confirm) return;
  }

  eventBus.emit('file:create', { path: fullPath, content, noOpen: false, overwrite: true });
}
