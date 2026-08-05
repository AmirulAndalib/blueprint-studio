/** Phone workspace navigation backed by the existing application workflows. */

import { eventBus } from './event-bus.js';
import { state } from './state.js';
import { t } from './translations.js';
import { WORKSPACE_MODE_PHONE } from './workspace-layout.js?v=2.5.188';

const SURFACES = [
  ['files', 'folder_open', 'phone_nav.files', 'Files'],
  ['editor', 'code', 'phone_nav.editor', 'Editor'],
  ['source', 'source', 'phone_nav.source', 'Source'],
  ['terminal', 'terminal', 'phone_nav.terminal', 'Terminal'],
  ['tools', 'construction', 'phone_nav.tools', 'Tools'],
  ['ai', 'psychology', 'phone_nav.ai', 'AI'],
];

let navigatorElement = null;
let currentSurface = 'editor';
let syncQueued = false;

function setCurrentSurface(surface) {
  currentSurface = surface;
  document.body.dataset.phoneSurface = surface;
  for (const button of navigatorElement?.querySelectorAll('[data-phone-surface]') || []) {
    const selected = button.dataset.phoneSurface === surface;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

function refreshLabels() {
  for (const [surface, , key, fallback] of SURFACES) {
    const button = navigatorElement?.querySelector(`[data-phone-surface="${surface}"]`);
    if (!button) continue;
    const translated = t(key);
    const label = translated === key ? fallback : translated;
    button.setAttribute('aria-label', label);
    button.querySelector('.phone-workspace-nav__label').textContent = label;
  }
}

function refreshAvailability() {
  const terminalButton = navigatorElement?.querySelector('[data-phone-surface="terminal"]');
  const aiButton = navigatorElement?.querySelector('[data-phone-surface="ai"]');
  if (terminalButton) {
    terminalButton.disabled = !state.terminalIntegrationEnabled;
    terminalButton.setAttribute('aria-disabled', String(terminalButton.disabled));
  }
  if (aiButton) {
    aiButton.disabled = !state.aiIntegrationEnabled;
    aiButton.setAttribute('aria-disabled', String(aiButton.disabled));
  }
}

function getRenderedSurface() {
  if (state.aiSidebarVisible) return 'ai';
  if (state.sidebarVisible) {
    return state.activeSidebarView === 'source-control' ? 'source' : 'files';
  }
  if (state.terminalVisible) return 'terminal';
  if (document.getElementById('bps-dev-tools-panel')) return 'tools';
  const modalOpen = document.getElementById('modal-overlay')?.classList.contains('visible');
  if (currentSurface === 'tools' && modalOpen) return 'tools';
  return 'editor';
}

function syncNavigation() {
  syncQueued = false;
  const isPhone = document.body.dataset.workspaceMode === WORKSPACE_MODE_PHONE;
  navigatorElement?.setAttribute('aria-hidden', String(!isPhone));
  refreshAvailability();
  setCurrentSurface(isPhone ? getRenderedSurface() : 'editor');
}

function scheduleSync() {
  if (syncQueued) return;
  syncQueued = true;
  requestAnimationFrame(syncNavigation);
}

async function closeTransientSurfaces({ terminal = true } = {}) {
  eventBus.emit('ui:hide-sidebar');
  eventBus.emit('ui:toggle-ai-sidebar', false);
  document.querySelector('#bps-dev-tools-panel .bdt-close')?.click();
  if (terminal && state.terminalVisible) {
    await Promise.all(eventBus.emit('terminal:toggle', false));
  }
}

async function activateSurface(surface) {
  if (document.body.dataset.workspaceMode !== WORKSPACE_MODE_PHONE) return;

  if (surface === 'files' || surface === 'source') {
    await closeTransientSurfaces();
    eventBus.emit('ui:switch-sidebar-view', surface === 'source' ? 'source-control' : 'explorer');
  } else if (surface === 'editor') {
    await closeTransientSurfaces();
    requestAnimationFrame(() => state.editor?.focus());
  } else if (surface === 'terminal') {
    if (!state.terminalIntegrationEnabled) return;
    await closeTransientSurfaces({ terminal: false });
    await Promise.all(eventBus.emit('terminal:toggle', true));
  } else if (surface === 'tools') {
    await closeTransientSurfaces();
    eventBus.emit('ha:dev-tools');
  } else if (surface === 'ai') {
    if (!state.aiIntegrationEnabled) return;
    await closeTransientSurfaces();
    eventBus.emit('ui:toggle-ai-sidebar', true);
  }

  setCurrentSurface(surface);
  scheduleSync();
}

export function initPhoneNavigation() {
  if (navigatorElement) return;

  navigatorElement = document.createElement('nav');
  navigatorElement.id = 'phone-workspace-nav';
  navigatorElement.className = 'phone-workspace-nav';
  navigatorElement.setAttribute('aria-label', 'Workspace');
  navigatorElement.setAttribute('aria-hidden', 'true');
  navigatorElement.innerHTML = SURFACES.map(([surface, icon]) => `
    <button type="button" class="phone-workspace-nav__item" data-phone-surface="${surface}">
      <span class="ui-icon material-icons" aria-hidden="true">${icon}</span>
      <span class="phone-workspace-nav__label"></span>
    </button>
  `).join('');

  const statusBar = document.querySelector('.status-bar');
  document.body.insertBefore(navigatorElement, statusBar || null);
  navigatorElement.addEventListener('click', (event) => {
    const button = event.target.closest('[data-phone-surface]');
    if (button && !button.disabled) activateSurface(button.dataset.phoneSurface);
  });

  const observedSurfaces = new WeakSet();
  const observeSurfaces = (observer) => {
    for (const surface of document.querySelectorAll('.sidebar, .ai-sidebar, #terminal-panel, #modal-overlay, #bps-dev-tools-panel')) {
      if (observedSurfaces.has(surface)) continue;
      observedSurfaces.add(surface);
      observer.observe(surface, { attributes: true, attributeFilter: ['class'] });
    }
  };
  const observer = new MutationObserver(() => {
    observeSurfaces(observer);
    scheduleSync();
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['data-workspace-mode'],
    childList: true,
  });
  observeSurfaces(observer);
  eventBus.on('ui:refresh-strings', refreshLabels);
  eventBus.on('ui:refresh-visibility', scheduleSync);
  eventBus.on('ui:sidebar-view-changed', scheduleSync);
  refreshLabels();
  syncNavigation();
}
