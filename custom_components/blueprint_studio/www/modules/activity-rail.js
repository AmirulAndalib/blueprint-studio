/** ACTIVITY-RAIL.JS | Purpose: Keeps primary workspace navigation states consistent. */
import { state, elements, gitState, giteaState } from './state.js';

const VALID_STATES = new Set(['loading', 'empty', 'ready', 'unavailable']);
let observer = null;
let keyboardRail = null;

function activityControls(rail) {
  return Array.from(rail?.querySelectorAll('.activity-item:not([disabled])') || []);
}

function setRovingControl(rail, control) {
  for (const item of activityControls(rail)) item.tabIndex = item === control ? 0 : -1;
}

function handleRailKeydown(event) {
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  const controls = activityControls(event.currentTarget);
  const current = controls.indexOf(document.activeElement);
  if (!controls.length || current < 0) return;
  event.preventDefault();
  const targetIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? controls.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length;
  setRovingControl(event.currentTarget, controls[targetIndex]);
  controls[targetIndex].focus();
}

function bindActivityKeyboard() {
  const rail = document.querySelector('.activity-bar');
  if (!rail || rail === keyboardRail) return;
  keyboardRail?.removeEventListener('keydown', handleRailKeydown);
  keyboardRail = rail;
  rail.addEventListener('keydown', handleRailKeydown);
  rail.addEventListener('focusin', (event) => {
    if (event.target.matches('.activity-item')) setRovingControl(rail, event.target);
  });
  setRovingControl(rail, rail.querySelector('.activity-item.active') || activityControls(rail)[0]);
}

function setActivityState(control, status, count = 0) {
  if (!control || !VALID_STATES.has(status)) return;

  control.dataset.state = status;
  control.classList.toggle('is-loading', status === 'loading');
  control.classList.toggle('is-unavailable', status === 'unavailable');
  control.setAttribute('aria-busy', String(status === 'loading'));

  const baseLabel = control.dataset.baseLabel || control.getAttribute('aria-label') || '';
  control.dataset.baseLabel = baseLabel;

  const badge = control.querySelector('.activity-badge');
  if (!badge) return;

  const normalizedCount = Math.max(0, Number(count) || 0);
  badge.textContent = normalizedCount > 99 ? '99+' : String(normalizedCount);
  badge.classList.toggle('hidden', normalizedCount === 0);
  badge.setAttribute('aria-hidden', String(normalizedCount === 0));
  control.setAttribute(
    'aria-label',
    normalizedCount > 0 ? `${baseLabel}, ${normalizedCount} changes` : baseLabel,
  );
}

function sourceControlState() {
  const available = state.gitIntegrationEnabled || state.giteaIntegrationEnabled;
  const count = (state.gitIntegrationEnabled ? gitState.totalChanges : 0)
    + (state.giteaIntegrationEnabled ? giteaState.totalChanges : 0);
  return { available, count };
}

export function refreshActivityRail() {
  const explorerLoading = state.explorerSearchLoading || state.loadingDirectories.size > 0;
  const explorerEmpty = !state.allItems.length && !state.files.length && !state.folders.length;
  setActivityState(
    elements.activityExplorer,
    explorerLoading ? 'loading' : (explorerEmpty ? 'empty' : 'ready'),
  );

  const searchLoading = elements.globalSearchLoading?.classList.contains('active');
  const searchHasResults = Boolean(elements.globalSearchResults?.querySelector('.global-search-result-file, .global-search-entity-result'));
  setActivityState(elements.activitySearch, searchLoading ? 'loading' : (searchHasResults ? 'ready' : 'empty'));

  const source = sourceControlState();
  setActivityState(
    elements.activitySourceControl,
    source.available ? (source.count > 0 ? 'ready' : 'empty') : 'unavailable',
    source.count,
  );
  if (elements.sourceControlUnavailable) {
    elements.sourceControlUnavailable.classList.toggle('hidden', source.available);
  }
  if (elements.sourceControlPanels) {
    elements.sourceControlPanels.classList.toggle('hidden', !source.available);
  }

  if (elements.activitySftp && state.sftpIntegrationEnabled) {
    const sftpLoading = state.activeSftp.loading;
    const sftpUnavailable = ["permission", "unavailable", "error"].includes(state.activeSftp.viewStatus);
    const sftpReady = Boolean(state.activeSftp.connectionId)
      && (state.activeSftp.files.length > 0 || state.activeSftp.folders.length > 0);
    const sftpStatus = sftpLoading ? 'loading' : (sftpUnavailable ? 'unavailable' : (sftpReady ? 'ready' : 'empty'));
    setActivityState(elements.activitySftp, sftpStatus);
  } else {
    setActivityState(elements.activitySftp, 'unavailable');
  }
}

export function initActivityRail() {
  if (observer) observer.disconnect();

  bindActivityKeyboard();

  observer = new MutationObserver(() => refreshActivityRail());
  for (const target of [
    elements.fileTree,
    elements.globalSearchLoading,
    elements.globalSearchResults,
    elements.sourceControlPanels,
    elements.viewSftp,
  ]) {
    if (target) {
      observer.observe(target, {
        attributes: true,
        attributeFilter: ['class', 'style'],
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
  }

  refreshActivityRail();
}
