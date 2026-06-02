/** SPLIT-VIEW.JS | Purpose: * Manages VS Code-style split view functionality for Blueprint Studio. */
import { state, elements } from './state.js';
import { rafThrottle, getEditorMode } from './utils.js';
import { eventBus } from './event-bus.js';

// Drag-and-drop state
let draggedTabIndex = null;
let draggedTabPane = null;

/**
 * Updates split view button visibility based on split view state
 */
export function updateSplitViewButtons() {
    const btnSplitVertical = document.getElementById("btn-split-vertical");
    const btnSplitClose = document.getElementById("btn-split-close");

    // Check if split view feature is enabled in settings
    if (!state.enableSplitView) {
        // Hide all split view buttons if feature is disabled
        if (btnSplitVertical) btnSplitVertical.style.display = "none";
        if (btnSplitClose) btnSplitClose.style.display = "none";
        return;
    }

    // Need at least 2 tabs to enable split view
    if (state.openTabs.length < 2) {
        if (btnSplitVertical) btnSplitVertical.style.display = "none";
        if (btnSplitClose) btnSplitClose.style.display = "none";
        return;
    }

    if (state.splitView && state.splitView.enabled) {
        // Split is active - hide enable button, show close button
        if (btnSplitVertical) btnSplitVertical.style.display = "none";
        if (btnSplitClose) btnSplitClose.style.display = "inline-flex";
    } else {
        // Split is not active - show enable button, hide close button
        if (btnSplitVertical) btnSplitVertical.style.display = "inline-flex";
        if (btnSplitClose) btnSplitClose.style.display = "none";
    }
}

/**
 * Enables split view (vertical layout only)
 * @param {string} orientation - Always 'vertical' (kept for backwards compatibility)
 * @param {boolean} skipInitialization - If true, don't initialize tab distribution (for restoring from saved state)
 */
export function enableSplitView(orientation = 'vertical', skipInitialization = false) {
  if (state.splitView.enabled) {
    return; // Already enabled
  }

  state.splitView.enabled = true;
  state.splitView.orientation = 'vertical'; // Always vertical
  state.splitView.activePane = 'primary';

  // Update DOM
  const splitContainer = document.getElementById('split-container');
  const secondaryPane = document.getElementById('secondary-pane');
  const resizeHandle = document.getElementById('split-resize-handle');

  if (splitContainer) {
    splitContainer.className = 'split-container'; // No orientation class needed
  }

  if (secondaryPane) {
    secondaryPane.style.display = 'flex';
  }

  if (resizeHandle) {
    resizeHandle.style.display = 'block';
  }

  // Create secondary editor if it doesn't exist
  if (!state.secondaryEditor) {
    eventBus.emit('editor:create-secondary');
  }

  // Initialize tab distribution only if not restoring from saved state
  if (!skipInitialization && state.openTabs.length > 0) {
    state.splitView.primaryTabs = [0]; // First tab in primary
    if (state.activeTab) {
      const activeIndex = state.openTabs.indexOf(state.activeTab);
      state.splitView.primaryTabs = [activeIndex];
    }

    // Put same file in secondary pane or next file if available
    const secondaryIndex = state.openTabs.length > 1 ?
      (state.splitView.primaryTabs[0] + 1) % state.openTabs.length :
      state.splitView.primaryTabs[0];
    state.splitView.secondaryTabs = [secondaryIndex];

    state.splitView.primaryActiveTab = state.openTabs[state.splitView.primaryTabs[0]];
    state.splitView.secondaryActiveTab = state.openTabs[state.splitView.secondaryTabs[0]];
  }

  // Update pane sizes
  updatePaneSizes(state.splitView.primaryPaneSize);

  // Initialize resize handle
  initSplitResize();

  // Update UI
  updatePaneActiveState();
  
  // Give a tiny moment for DOM to catch up before refreshing
  setTimeout(() => {
    eventBus.emit('ui:refresh-tabs');

    // Initialize both panes with their active tabs
    // Note: We initialize secondary first, then primary, so primary ends up globally active
    if (state.secondaryEditor && state.splitView.secondaryActiveTab) {
      eventBus.emit('tab:activate', { 
        tab: state.splitView.secondaryActiveTab, 
        skipSave: true 
      });
    }

    if (state.primaryEditor && state.splitView.primaryActiveTab) {
      eventBus.emit('tab:activate', { 
        tab: state.splitView.primaryActiveTab, 
        skipSave: true 
      });
    }
  }, 10);

  // Save state
  eventBus.emit('settings:save');
}

/**
 * Disables split view and returns to single pane
 */
export function disableSplitView() {
  if (!state.splitView.enabled) return;

  // Save secondary editor state before destroying
  // CRITICAL: Skip saving if markdown preview or blueprint form is active, as the editor may be empty/hidden
  if (state.splitView.secondaryActiveTab && state.secondaryEditor && !state.markdownPreviewActive && !state.blueprintFormActive) {
    const tab = state.splitView.secondaryActiveTab;
    if (!tab.isTerminal) {
      tab.cursor = state.secondaryEditor.getCursor();
      tab.scroll = state.secondaryEditor.getScrollInfo();
      const content = state.secondaryEditor.getValue();
      if (content !== tab.originalContent) {
        tab.content = content;
        tab.modified = true;
      }
    }
  }

  // Clear split view state only AFTER disabling flag so UI renders correctly
  state.splitView.enabled = false;
  state.splitView.activePane = 'primary';
  
  // Update DOM
  const primaryPane = document.getElementById('primary-pane');
  const secondaryPane = document.getElementById('secondary-pane');
  const resizeHandle = document.getElementById('split-resize-handle');

  // Reset primary pane to take full width
  if (primaryPane) {
    primaryPane.style.flex = '1';
  }

  if (secondaryPane) {
    secondaryPane.style.display = 'none';
  }

  if (resizeHandle) {
    resizeHandle.style.display = 'none';
  }

  // Destroy secondary editor
  eventBus.emit('editor:destroy-secondary');

  // Reset markdown preview state if it was active
  if (state.markdownPreviewActive) {
    state.markdownPreviewActive = false;
    if (elements.btnMarkdownPreview) {
        elements.btnMarkdownPreview.classList.remove("active");
    }
  }

  // Clear tab pane assignments
  state.splitView.primaryTabs = [];
  state.splitView.secondaryTabs = [];
  state.splitView.primaryActiveTab = null;
  state.splitView.secondaryActiveTab = null;

  // Ensure state.editor points to primary editor
  if (state.primaryEditor) {
    state.editor = state.primaryEditor;
    
    // Ensure the primary editor wrapper is visible
    const wrapper = state.primaryEditor.getWrapperElement();
    if (wrapper) wrapper.style.display = "block";
    
    // Explicitly show the codemirror-wrapper div
    const wrapperDiv = document.getElementById('codemirror-wrapper');
    if (wrapperDiv) wrapperDiv.style.display = "block";

    // Refresh primary editor to ensure it renders properly at full width
    state.primaryEditor.refresh();
  }

  // Update UI
  updatePaneActiveState();
  
  // Re-activate the tab to ensure all UI elements (breadcrumb, toolbar) are correct for single-pane
  if (state.activeTab) {
      eventBus.emit('tab:activate', { tab: state.activeTab, skipSave: true });
  }

  eventBus.emit('ui:refresh-tabs');
  eventBus.emit('ui:refresh-tree');
  eventBus.emit('ui:update-split-buttons');

  // Save state
  eventBus.emit('settings:save');
}


/**
 * Sets the active pane
 */
export function setActivePaneFromPosition(pane) {
  if (!state.splitView.enabled) return;
  if (pane !== 'primary' && pane !== 'secondary') return;

  state.splitView.activePane = pane;

  // Update state.editor to point to active pane's editor
  if (pane === 'primary' && state.primaryEditor) {
    state.editor = state.primaryEditor;
  } else if (pane === 'secondary' && state.secondaryEditor) {
    state.editor = state.secondaryEditor;
  }

  updatePaneActiveState();
}

/**
 * Saves a tab's current editor state before it is moved or closed
 */
function saveTabStateFromEditor(tabIndex) {
  const tab = state.openTabs[tabIndex];
  if (!tab || tab.isBinary || tab.isTerminal) return;

  const pane = getPaneForTab(tabIndex);
  const editor = (pane === 'primary') ? state.primaryEditor :
    (pane === 'secondary') ? state.secondaryEditor : null;

  if (editor) {
    tab.content = editor.getValue();
    tab.cursor = editor.getCursor();
    tab.scroll = editor.getScrollInfo();
    tab.history = editor.getHistory();
  }
}

/**
 * Moves a tab to the primary pane
 */
export function moveToPrimaryPane(tabIndex) {
  if (!state.splitView.enabled) return;
  if (tabIndex < 0 || tabIndex >= state.openTabs.length) return;

  // Save state from current editor before moving
  saveTabStateFromEditor(tabIndex);

  // Remove from secondary if it's there
  const secondaryIdx = state.splitView.secondaryTabs.indexOf(tabIndex);
  if (secondaryIdx !== -1) {
    state.splitView.secondaryTabs.splice(secondaryIdx, 1);
  }

  // Add to primary if not already there
  if (!state.splitView.primaryTabs.includes(tabIndex)) {
    state.splitView.primaryTabs.push(tabIndex);
  }

  // Auto-balance: If secondary pane is empty, move one tab back from primary
  if (state.splitView.secondaryTabs.length === 0 && state.splitView.primaryTabs.length > 1) {
    // Find a tab in primary pane that's not the one we just moved
    const tabToMoveBack = state.splitView.primaryTabs.find(idx => idx !== tabIndex);

    if (tabToMoveBack !== undefined) {
      // Save state of the tab we're auto-moving
      saveTabStateFromEditor(tabToMoveBack);

      const backIdx = state.splitView.primaryTabs.indexOf(tabToMoveBack);
      state.splitView.primaryTabs.splice(backIdx, 1);
      state.splitView.secondaryTabs.push(tabToMoveBack);
      state.splitView.secondaryActiveTab = state.openTabs[tabToMoveBack];

      // Load the auto-moved tab's content into secondary editor
      if (state.secondaryEditor) {
        const movedTab = state.openTabs[tabToMoveBack];
        eventBus.emit('tab:activate', { tab: movedTab, skipSave: true });
      }
    }
  }

  // Make it the active tab in primary pane
  state.splitView.primaryActiveTab = state.openTabs[tabIndex];
  state.splitView.activePane = 'primary';
  state.editor = state.primaryEditor;

  const movedTab = state.openTabs[tabIndex];
  eventBus.emit('tab:activate', { tab: movedTab, skipSave: true });

  // Update UI
  updatePaneActiveState();
  eventBus.emit('ui:refresh-tabs');
  eventBus.emit('ui:refresh-tree');

  // Save state
  eventBus.emit('settings:save');
}

/**
 * Moves a tab to the secondary pane
 */
export function moveToSecondaryPane(tabIndex) {
  if (!state.splitView.enabled) {
    // Enable split view first
    enableSplitView('vertical');
  }

  if (tabIndex < 0 || tabIndex >= state.openTabs.length) return;

  // Save state from current editor before moving
  saveTabStateFromEditor(tabIndex);

  // Remove from primary if it's there
  const primaryIdx = state.splitView.primaryTabs.indexOf(tabIndex);
  if (primaryIdx !== -1) {
    state.splitView.primaryTabs.splice(primaryIdx, 1);
  }

  // Add to secondary if not already there
  if (!state.splitView.secondaryTabs.includes(tabIndex)) {
    state.splitView.secondaryTabs.push(tabIndex);
  }

  // Auto-balance: If primary pane is empty, move one tab back from secondary
  if (state.splitView.primaryTabs.length === 0 && state.splitView.secondaryTabs.length > 1) {
    // Find a tab in secondary pane that's not the one we just moved
    const tabToMoveBack = state.splitView.secondaryTabs.find(idx => idx !== tabIndex);
    if (tabToMoveBack !== undefined) {
      // Save state of the tab we're auto-moving
      saveTabStateFromEditor(tabToMoveBack);

      const backIdx = state.splitView.secondaryTabs.indexOf(tabToMoveBack);
      state.splitView.secondaryTabs.splice(backIdx, 1);
      state.splitView.primaryTabs.push(tabToMoveBack);
      state.splitView.primaryActiveTab = state.openTabs[tabToMoveBack];

      // Load the auto-moved tab's content into primary editor
      if (state.primaryEditor) {
        const movedTab = state.openTabs[tabToMoveBack];
        eventBus.emit('tab:activate', { tab: movedTab, skipSave: true });
      }
    }
  }

  // Make it the active tab in secondary pane
  state.splitView.secondaryActiveTab = state.openTabs[tabIndex];
  state.splitView.activePane = 'secondary';
  state.editor = state.secondaryEditor;

  const movedTab = state.openTabs[tabIndex];
  eventBus.emit('tab:activate', { tab: movedTab, skipSave: true });

  // Update UI
  updatePaneActiveState();
  eventBus.emit('ui:refresh-tabs');
  eventBus.emit('ui:refresh-tree');

  // Save state
  eventBus.emit('settings:save');
}

/**
 * Gets which pane a tab is in
 */
export function getPaneForTab(tabIndex) {
  if (!state.splitView.enabled) return null;

  if (state.splitView.primaryTabs.includes(tabIndex)) {
    return 'primary';
  } else if (state.splitView.secondaryTabs.includes(tabIndex)) {
    return 'secondary';
  }

  return null;
}

/**
 * Gets the active pane's editor instance
 */
export function getActivePaneEditor() {
  if (!state.splitView.enabled) {
    return state.editor || state.primaryEditor;
  }

  return state.splitView.activePane === 'primary' ?
    state.primaryEditor :
    state.secondaryEditor;
}

/**
 * Updates pane sizes
 */
export function updatePaneSizes(primaryPercent) {
  state.splitView.primaryPaneSize = primaryPercent;
  const secondaryPercent = 100 - primaryPercent;

  const primaryPane = document.getElementById('primary-pane');
  const secondaryPane = document.getElementById('secondary-pane');

  if (primaryPane) {
    primaryPane.style.flex = `0 0 ${primaryPercent}%`;
  }
  if (secondaryPane) {
    secondaryPane.style.flex = `0 0 ${secondaryPercent}%`;
  }

  // Refit terminal if it's open
  eventBus.emit('terminal:fit');
}

/**
 * Initializes the split resize functionality
 * Optimized with RAF throttling for smooth 60fps performance
 */
export function initSplitResize() {
  const handle = document.getElementById('split-resize-handle');
  if (!handle) return;

  let isResizing = false;
  let startPos = 0;
  let startPrimarySize = 0;

  const handleMouseDown = (e) => {
    isResizing = true;
    startPos = e.clientX;
    startPrimarySize = state.splitView.primaryPaneSize;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  };

  // Throttle mouse move with requestAnimationFrame for smooth 60fps updates
  const throttledUpdatePaneSizes = rafThrottle((newSize) => {
    updatePaneSizes(newSize);
  });

  const handleMouseMove = (e) => {
    if (!isResizing) return;

    const container = document.getElementById('split-container');
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const delta = e.clientX - startPos;
    const deltaPercent = (delta / containerRect.width) * 100;
    const newSize = Math.max(20, Math.min(80, startPrimarySize + deltaPercent));

    // Use throttled update for smooth performance
    throttledUpdatePaneSizes(newSize);
  };

  const handleMouseUp = () => {
    if (!isResizing) return;

    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    // Save split state
    eventBus.emit('settings:save');

    // Refresh both editors
    if (state.primaryEditor) state.primaryEditor.refresh();
    if (state.secondaryEditor) state.secondaryEditor.refresh();
  };

  // Remove existing listeners
  handle.removeEventListener('mousedown', handleMouseDown);
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mouseup', handleMouseUp);

  // Add new listeners
  handle.addEventListener('mousedown', handleMouseDown);
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
}

/**
 * Updates visual active state of panes
 */
export function updatePaneActiveState() {
  const primaryPane = document.getElementById('primary-pane');
  const secondaryPane = document.getElementById('secondary-pane');

  if (!state.splitView.enabled) {
    if (primaryPane) primaryPane.classList.remove('active');
    if (secondaryPane) secondaryPane.classList.remove('active');
    return;
  }

  if (primaryPane) {
    if (state.splitView.activePane === 'primary') {
      primaryPane.classList.add('active');
    } else {
      primaryPane.classList.remove('active');
    }
  }

  if (secondaryPane) {
    if (state.splitView.activePane === 'secondary') {
      secondaryPane.classList.add('active');
    } else {
      secondaryPane.classList.remove('active');
    }
  }
}

// ============================================================================
// Drag and Drop Handlers
// ============================================================================

/**
 * Handles tab drag start
 */
export function handleTabDragStart(e) {
  draggedTabIndex = parseInt(e.currentTarget.getAttribute('data-tab-index'));
  draggedTabPane = e.currentTarget.getAttribute('data-pane');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(draggedTabIndex));
  e.currentTarget.classList.add('dragging');
}

/**
 * Handles tab drag over
 */
export function handleTabDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const dropTarget = e.currentTarget;
  if (!dropTarget) return;

  const dropTabIndex = parseInt(dropTarget.getAttribute('data-tab-index'));

  if (dropTabIndex !== draggedTabIndex) {
    document.querySelectorAll('.tab.drop-target, .tab.drop-before, .tab.drop-after').forEach(el => {
      el.classList.remove('drop-target', 'drop-before', 'drop-after');
    });

    const insertAfter = getTabDropPlacement(e, dropTarget) === 'after';
    dropTarget.classList.add('drop-target');
    dropTarget.classList.add(insertAfter ? 'drop-after' : 'drop-before');
  }
}

/**
 * Handles tab drop
 */
export function handleTabDrop(e) {
  e.preventDefault();

  const dropTarget = e.currentTarget;
  if (!dropTarget) return;

  const dropTabIndex = parseInt(dropTarget.getAttribute('data-tab-index'));
  const dropPane = dropTarget.getAttribute('data-pane');
  const draggedTab = draggedTabIndex !== null ? state.openTabs[draggedTabIndex] : null;

  if (draggedTabIndex !== null && dropTabIndex !== draggedTabIndex) {
    if (!state.splitView.enabled) {
      const insertAfter = getTabDropPlacement(e, dropTarget) === 'after';
      reorderOpenTab(draggedTabIndex, dropTabIndex, insertAfter);
    } else if (dropPane === draggedTabPane && dropPane) {
      const insertAfter = getTabDropPlacement(e, dropTarget) === 'after';
      reorderOpenTab(draggedTabIndex, dropTabIndex, insertAfter);
    } else if (dropPane === 'primary') {
      moveToPrimaryPane(draggedTabIndex);
    } else if (dropPane === 'secondary') {
      moveToSecondaryPane(draggedTabIndex);
    }

    if (draggedTab) {
      if (state.splitView.enabled && dropPane) {
        eventBus.emit('ui:set-active-pane', { pane: dropPane });
      }
      eventBus.emit('tab:activate', { tab: draggedTab, skipSave: true });
    }
  }

  cleanupDragState();
}

/**
 * Handles tab drag end
 */
export function handleTabDragEnd(e) {
  cleanupDragState();
}

/**
 * Cleans up drag state
 */
function cleanupDragState() {
  document.querySelectorAll('.tab.dragging, .tab.drop-target, .tab.drop-before, .tab.drop-after').forEach(el => {
    el.classList.remove('dragging', 'drop-target', 'drop-before', 'drop-after');
  });
  draggedTabIndex = null;
  draggedTabPane = null;
}

function getTabDropPlacement(e, tabEl) {
  const rect = tabEl.getBoundingClientRect();
  const isLeftTabRail = document.body.dataset.tabPosition === 'left';
  if (isLeftTabRail) {
    return e.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
  }
  return e.clientX > rect.left + rect.width / 2 ? 'after' : 'before';
}

function remapSplitTabIndices(previousTabs) {
  if (!state.splitView) return;

  const toNewIndex = (oldIndex) => {
    const tab = previousTabs[oldIndex];
    return tab ? state.openTabs.indexOf(tab) : -1;
  };

  state.splitView.primaryTabs = (state.splitView.primaryTabs || [])
    .map(toNewIndex)
    .filter(index => index !== -1)
    .sort((a, b) => a - b);
  state.splitView.secondaryTabs = (state.splitView.secondaryTabs || [])
    .map(toNewIndex)
    .filter(index => index !== -1)
    .sort((a, b) => a - b);
}

function reorderOpenTab(fromIndex, targetIndex, insertAfter) {
  if (
    fromIndex < 0 ||
    targetIndex < 0 ||
    fromIndex >= state.openTabs.length ||
    targetIndex >= state.openTabs.length ||
    fromIndex === targetIndex
  ) {
    return;
  }

  const previousTabs = state.openTabs.slice();
  const [movedTab] = state.openTabs.splice(fromIndex, 1);
  let insertIndex = targetIndex;

  if (fromIndex < targetIndex) {
    insertIndex -= 1;
  }
  if (insertAfter) {
    insertIndex += 1;
  }

  insertIndex = Math.max(0, Math.min(insertIndex, state.openTabs.length));
  state.openTabs.splice(insertIndex, 0, movedTab);
  remapSplitTabIndices(previousTabs);

  eventBus.emit('ui:refresh-tabs');
  eventBus.emit('ui:refresh-tree');
  eventBus.emit('settings:save');
}

// Event Listeners
eventBus.on("ui:toggle-split-view", () => {
    if (state.splitView.enabled) {
        disableSplitView();
    } else {
        enableSplitView('vertical');
    }
});
