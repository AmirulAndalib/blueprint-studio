/** BREADCRUMB.JS | Purpose: Displays breadcrumb path navigation showing current file location. */
import { state, elements } from './state.js';
import { navigateToFolder } from './file-tree.js';
import { 
  navigateSftp, 
  parseSftpPath,
  isSftpPath
} from './sftp.js?v=2.5.75';
import { setOverflowTooltip } from './tooltip.js?v=2.5.75';

function bindBreadcrumbLink(element, label, action) {
  element.setAttribute("role", "button");
  element.setAttribute("tabindex", "0");
  element.setAttribute("aria-label", label);
  element.style.cursor = "pointer";
  element.addEventListener("click", action);
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      action();
    }
  });
}

/**
 * Updates the breadcrumb navigation with the current file path
 * @param {string} path - File path to display
 */
export function updateBreadcrumb(path) {
  if (!elements.breadcrumb) return;

  elements.breadcrumb.innerHTML = "";

  if (!path) return;

  const isSftp = isSftpPath(path);
  const isTerminal = path.startsWith('terminal://');

  // Handle local files: add /config/ prefix visually
  if (!isSftp && !isTerminal) {
    const configItem = document.createElement("span");
    configItem.className = "breadcrumb-item";
    
    const configLink = document.createElement("span");
    configLink.className = "breadcrumb-link";
    configLink.textContent = "config";
    bindBreadcrumbLink(configLink, "config", () => {
      navigateToFolder("");
    });
    
    configItem.appendChild(configLink);
    
    const separator = document.createElement("span");
    separator.className = "breadcrumb-separator";
    separator.textContent = "›";
    configItem.appendChild(separator);
    
    elements.breadcrumb.appendChild(configItem);
  }

  let connId = null;
  let remotePath = "";
  let parts = [];

  if (isSftp) {
    const parsed = parseSftpPath(path);
    connId = parsed.connId;
    remotePath = parsed.remotePath;
    
    // Add Connection ID as the first breadcrumb segment
    const connItem = document.createElement("span");
    connItem.className = "breadcrumb-item";
    
    const connLink = document.createElement("span");
    connLink.className = "breadcrumb-link";
    connLink.textContent = connId;
    bindBreadcrumbLink(connLink, connId, () => {
      navigateSftp(connId, "/");
    });
    
    connItem.appendChild(connLink);
    
    const separator = document.createElement("span");
    separator.className = "breadcrumb-separator";
    separator.textContent = "›";
    connItem.appendChild(separator);
    
    elements.breadcrumb.appendChild(connItem);

    // Filter out the file/folder parts from remotePath
    parts = remotePath.split("/").filter(p => p !== "");
  } else {
    const displayPath = isTerminal ? path.replace('terminal://', '') : path;
    parts = displayPath.split("/").filter(p => p !== "");
  }

  let currentPath = "";

  parts.forEach((part, index) => {
    if (index > 0 || !isSftp) {
      currentPath += "/";
    }
    currentPath += part;

    // Create breadcrumb item
    const item = document.createElement("span");
    item.className = "breadcrumb-item";

    const link = document.createElement("span");
    link.className = "breadcrumb-link";
    link.textContent = part;
    const fullPath = isSftp
      ? `sftp://${connId}/${currentPath}`
      : isTerminal
        ? `terminal://${currentPath.replace(/^\/+/, '')}`
        : `/config${currentPath}`;
    setOverflowTooltip(link, fullPath);

    // Make all parts except the last one clickable to open folder
    if (index < parts.length - 1) {
      const folderPath = currentPath;
      bindBreadcrumbLink(link, part, () => {
        if (isSftp) {
          // SFTP navigation
          navigateSftp(connId, folderPath.startsWith('/') ? folderPath : '/' + folderPath);
        } else {
          // Local folder expansion/navigation
          if (state.lazyLoadingEnabled) {
            navigateToFolder(folderPath);
          } else {
            expandFolderInTree(folderPath);
          }
        }
      });
    } else {
      link.setAttribute("tabindex", "0");
      link.setAttribute("aria-label", fullPath);
      link.setAttribute("aria-current", "location");
    }

    item.appendChild(link);

    // Add separator except for last item
    if (index < parts.length - 1) {
      const separator = document.createElement("span");
      separator.className = "breadcrumb-separator";
      separator.textContent = "›";
      item.appendChild(separator);
    }

    elements.breadcrumb.appendChild(item);
  });
}

/**
 * Expands a folder in the file tree by triggering a click
 * @param {string} folderPath - Path to the folder to expand
 */
export function expandFolderInTree(folderPath) {
  // This will expand the folder in the file tree
  // The folder is already rendered, we just need to expand it
  const folderElement = document.querySelector(`[data-path="${folderPath}"]`);
  if (folderElement && folderElement.classList.contains("tree-item")) {
    // Trigger click on the folder to expand it
    folderElement.click();
  }
}
