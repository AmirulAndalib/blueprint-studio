/** ACTIVITY-RAIL.JS | Purpose: Keeps primary workspace navigation states consistent. */
import { state, elements, gitState, giteaState } from './state.js';

const VALID_STATES = new Set(['loading', 'empty', 'ready', 'unavailable']);
let observer = null;

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
    const sftpReady = Boolean(state.activeSftp.connectionId)
      && (state.activeSftp.files.length > 0 || state.activeSftp.folders.length > 0);
    const sftpStatus = sftpLoading ? 'loading' : (sftpReady ? 'ready' : 'empty');
    setActivityState(elements.activitySftp, sftpStatus);
  } else {
    setActivityState(elements.activitySftp, 'unavailable');
  }
}

export function initActivityRail() {
  if (observer) observer.disconnect();

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
