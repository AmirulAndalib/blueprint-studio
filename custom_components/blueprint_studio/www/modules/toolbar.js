/** TOOLBAR.JS | Purpose: Manages toolbar button states (enabled/disabled) based on context. */
import { state, elements } from './state.js';

function refreshToolbarControlText(control) {
  const label = control?.dataset.toolbarLabel?.trim();
  if (!label) return;
  const reason = control.dataset.disabledReason?.trim();
  control.dataset.tooltip = reason ? `${label} - ${reason}` : label;
  control.setAttribute('aria-label', reason ? `${label}. Unavailable: ${reason}` : label);
}

export function setToolbarControlLabel(control, label) {
  if (!control || !label?.trim()) return;
  control.dataset.toolbarLabel = label.trim();
  control.classList.add('ui-tooltip');
  control.removeAttribute('title');
  refreshToolbarControlText(control);
}

export function setToolbarControlAvailability(control, enabled, disabledReason = '') {
  if (!control) return;
  control.disabled = !enabled;
  if (!enabled && disabledReason) control.dataset.disabledReason = disabledReason;
  else delete control.dataset.disabledReason;
  refreshToolbarControlText(control);
}

export function initializeToolbarControls(toolbar = document.querySelector('.toolbar')) {
  if (!toolbar) return;
  toolbar.querySelectorAll(':scope > .toolbar-group > button').forEach((control) => {
    const label = control.dataset.tooltip || control.getAttribute('aria-label') || control.title;
    setToolbarControlLabel(control, label);
  });
}

/**
 * Updates toolbar button states based on current editor state
 * Enables/disables save, undo, redo, and download buttons
 */
export function updateToolbarState() {
  const tab = state.activeTab;
  const hasEditor = !!state.editor && !!tab;
  const hasModified = state.openTabs.some((t) => t.modified);

  /*console.log*/ void("[Toolbar] updateToolbarState", { 
    activeTab: tab?.path, 
    isModified: tab?.modified, 
    hasModified,
    hasEditor 
  });

  // Save current file
  if (elements.btnSave) {
    const disabled = !tab || !tab.modified;
    const reason = !tab ? 'Open a file to save it' : 'The active file has no unsaved changes';
    setToolbarControlAvailability(elements.btnSave, !disabled, reason);
  }

  // Save all modified files
  if (elements.btnSaveAll) {
    const disabled = !hasModified;
    setToolbarControlAvailability(elements.btnSaveAll, !disabled, 'No open files have unsaved changes');
  }

  // Undo/Redo
  if (elements.btnUndo) {
    const canUndo = hasEditor && !!state.editor?.historySize().undo;
    setToolbarControlAvailability(elements.btnUndo, canUndo, hasEditor ? 'There is nothing to undo' : 'Open a file to edit it');
  }
  if (elements.btnRedo) {
    const canRedo = hasEditor && !!state.editor?.historySize().redo;
    setToolbarControlAvailability(elements.btnRedo, canRedo, hasEditor ? 'There is nothing to redo' : 'Open a file to edit it');
  }

  // Download file - should be enabled when any file is open
  if (elements.btnDownload) {
    setToolbarControlAvailability(elements.btnDownload, hasEditor, 'Open a file to download it');
  }

  // "Use Blueprint" button — visible only when the active file is a blueprint
  const btnUseBlueprint = document.getElementById('btn-use-blueprint');
  if (btnUseBlueprint) {
    const isBlueprint = tab && tab.content && tab.content.includes('blueprint:');
    btnUseBlueprint.classList.toggle('hidden', !isBlueprint);
  }
}
