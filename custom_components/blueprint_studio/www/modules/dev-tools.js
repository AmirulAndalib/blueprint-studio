/** DEV-TOOLS.JS | Purpose: HA Developer Tools floating panel — Actions / Template / States / Config */
import { API_BASE } from './constants.js';
import { fetchWithAuth } from './api.js';
import { HA_ENTITIES, HA_SERVICES } from './ha-autocomplete.js';
import { startOperationFeedback } from './feedback-service.js';
import { t, tp } from './translations.js';

const PANEL_ID = 'bps-dev-tools-panel';

// ── Public entry point ────────────────────────────────────────────────────────

export function openDevTools(initialTab = 'actions') {
  const existing = document.getElementById(PANEL_ID);
  if (existing) {
    const active = existing.querySelector('.bdt-tab-btn.active');
    if (active && active.dataset.tab === initialTab) {
      _destroyPanel(existing);
      return; // toggle off
    }
    _destroyPanel(existing);
  }
  _buildPanel(initialTab);
}

// ── Panel builder ─────────────────────────────────────────────────────────────

function _buildPanel(activeTab) {
  const panel = document.createElement('div');
  const cleanupFns = [];
  panel.id = PANEL_ID;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-labelledby', 'bps-dev-tools-title');
  panel._bdtCleanup = () => {
    while (cleanupFns.length) cleanupFns.pop()();
  };
  panel.innerHTML = `
    <div class="bdt-header">
      <span class="ui-icon material-icons bdt-header-icon">construction</span>
      <span class="bdt-title" id="bps-dev-tools-title">${t('dev_tools.title')}</span>
      <div class="bdt-tabs" role="tablist" aria-label="${t('dev_tools.views_label')}">
        <button class="bdt-tab-btn" id="bdt-tab-states" data-tab="states" type="button" role="tab" aria-controls="bdt-pane-states" aria-selected="false" tabindex="-1">${t('dev_tools.states_tab')}</button>
        <button class="bdt-tab-btn" id="bdt-tab-actions" data-tab="actions" type="button" role="tab" aria-controls="bdt-pane-actions" aria-selected="false" tabindex="-1">${t('dev_tools.actions_tab')}</button>
        <button class="bdt-tab-btn" id="bdt-tab-template" data-tab="template" type="button" role="tab" aria-controls="bdt-pane-template" aria-selected="false" tabindex="-1">${t('dev_tools.templates_tab')}</button>
        <button class="bdt-tab-btn" id="bdt-tab-config" data-tab="config" type="button" role="tab" aria-controls="bdt-pane-config" aria-selected="false" tabindex="-1">${t('dev_tools.configuration_tab')}</button>
        <button class="bdt-tab-btn" id="bdt-tab-reload" data-tab="reload" type="button" role="tab" aria-controls="bdt-pane-reload" aria-selected="false" tabindex="-1">${t('dev_tools.reload_tab')}</button>
      </div>
      <button class="bdt-close" type="button" title="${t('dev_tools.close')}" aria-label="${t('dev_tools.close')}"><span class="ui-icon material-icons">close</span></button>
    </div>
    <div class="bdt-body">
      <div class="bdt-pane" id="bdt-pane-actions" data-pane="actions" role="tabpanel" aria-labelledby="bdt-tab-actions">${_actionsPane()}</div>
      <div class="bdt-pane" id="bdt-pane-template" data-pane="template" role="tabpanel" aria-labelledby="bdt-tab-template">${_templatePane()}</div>
      <div class="bdt-pane" id="bdt-pane-states" data-pane="states" role="tabpanel" aria-labelledby="bdt-tab-states">${_statesPane()}</div>
      <div class="bdt-pane" id="bdt-pane-config" data-pane="config" role="tabpanel" aria-labelledby="bdt-tab-config">${_configPane()}</div>
      <div class="bdt-pane" id="bdt-pane-reload" data-pane="reload" role="tabpanel" aria-labelledby="bdt-tab-reload">${_reloadPane()}</div>
      ${_resultInspector()}
    </div>
  `;

  document.body.appendChild(panel);
  _makeDraggable(panel);

  panel.querySelectorAll('.bdt-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => _switchTab(panel, btn.dataset.tab));
    btn.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = Array.from(panel.querySelectorAll('.bdt-tab-btn'));
      const current = tabs.indexOf(btn);
      const next = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      _switchTab(panel, tabs[next].dataset.tab);
      tabs[next].focus();
    });
  });
  panel.querySelector('.bdt-close').addEventListener('click', () => _destroyPanel(panel));

  const onKey = e => { if (e.key === 'Escape') _destroyPanel(panel); };
  document.addEventListener('keydown', onKey);
  cleanupFns.push(() => document.removeEventListener('keydown', onKey));

  _switchTab(panel, activeTab);
  _initResultInspector(panel);
  _initActions(panel);
  _initTemplate(panel);
  const cleanupStates = _initStates(panel);
  if (cleanupStates) cleanupFns.push(cleanupStates);
  _initConfig(panel);
  _initReload(panel);
}

function _switchTab(panel, tab) {
  panel.querySelectorAll('.bdt-tab-btn').forEach(button => {
    const selected = button.dataset.tab === tab;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  panel.querySelectorAll('.bdt-pane').forEach(pane => {
    const selected = pane.dataset.pane === tab;
    pane.classList.toggle('active', selected);
    pane.hidden = !selected;
  });
}

function _revealDevTools(tab) {
  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    _switchTab(panel, tab);
    panel.querySelector(`.bdt-tab-btn[data-tab="${tab}"]`)?.focus();
    return;
  }
  openDevTools(tab);
}

function cloneOperationInput(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function actionTargetLabel(target) {
  const values = Object.values(target || {})
    .flatMap(value => Array.isArray(value) ? value : [value])
    .filter(value => typeof value === 'string' || typeof value === 'number')
    .map(String);
  if (!values.length) return t('dev_tools.no_explicit_target');
  if (values.length === 1) return values[0];
  return `${values.length} targets -> ${values[0]}`;
}

function responseFailure(response, fallback) {
  return response?.message || response?.error || fallback;
}

export async function runDeveloperAction(request, context = {}) {
  const immutableRequest = {
    domain: String(request.domain || ''),
    service: String(request.service || ''),
    serviceData: cloneOperationInput(request.serviceData || {}),
    target: cloneOperationInput(request.target || {}),
  };
  const serviceName = `${immutableRequest.domain}.${immutableRequest.service}`;
  const { button = null, resultElement = null, panel = null, buttonLabel = t('dev_tools.perform_action') } = context;
  const operation = startOperationFeedback({
    label: t('dev_tools.perform_label', { service: serviceName }),
    icon: 'play_arrow',
    message: t('dev_tools.action_loading'),
    scope: t('dev_tools.action_scope'),
    target: `${serviceName} -> ${actionTargetLabel(immutableRequest.target)}`,
    retry: () => runDeveloperAction(immutableRequest),
    open: () => _revealDevTools('actions'),
    openLabel: t('dev_tools.title'),
    openIcon: 'construction',
  });
  if (button) {
    button.disabled = true;
      button.innerHTML = `<span class="ui-icon material-icons bdt-button-icon">hourglass_empty</span> ${t('dev_tools.calling')}`;
  }
  if (resultElement) resultElement.style.display = 'none';
  try {
    const response = await fetchWithAuth(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'call_service',
        domain: immutableRequest.domain,
        service: immutableRequest.service,
        service_data: immutableRequest.serviceData,
        target: immutableRequest.target,
      }),
    });
    if (!response?.success) {
      const message = responseFailure(response, t('dev_tools.action_rejected'));
      operation.fail(t('dev_tools.action_failed', { service: serviceName }), message);
      if (resultElement?.isConnected) _showActionResult(resultElement, false, message);
      if (panel?.isConnected) _recordRawResult(panel, 'Actions', t('dev_tools.raw_action_failed', { service: serviceName }), response);
      return false;
    }
    operation.finish(t('dev_tools.action_completed', { service: serviceName }), { detail: actionTargetLabel(immutableRequest.target) });
    if (resultElement?.isConnected) _showActionResult(resultElement, true, t('dev_tools.action_success'));
    if (panel?.isConnected) _recordRawResult(panel, 'Actions', serviceName, response);
    return true;
  } catch (error) {
    operation.fail(t('dev_tools.action_failed', { service: serviceName }), error.message);
    if (resultElement?.isConnected) _showActionResult(resultElement, false, error.message);
    if (panel?.isConnected) _recordRawResult(panel, 'Actions', t('dev_tools.raw_action_failed', { service: serviceName }), { error: error.message });
    return false;
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.innerHTML = `<span class="ui-icon material-icons bdt-button-icon">play_arrow</span> ${buttonLabel}`;
    }
  }
}

function _showActionResult(element, ok, message) {
  element.textContent = ok ? `✓ ${message}` : `✗ ${message}`;
  element.className = `bdt-action-result ${ok ? 'bdt-ok' : 'bdt-err'}`;
  element.style.display = 'block';
}

export async function renderDeveloperTemplate(template, context = {}) {
  const immutableTemplate = String(template || '');
  const { resultElement = null, panel = null, observable = true } = context;
  const operation = observable ? startOperationFeedback({
    label: t('dev_tools.template_label'),
    icon: 'data_object',
    message: t('dev_tools.template_loading'),
    scope: t('dev_tools.template_scope'),
    target: `${immutableTemplate.length} character template`,
    retry: () => renderDeveloperTemplate(immutableTemplate),
    open: () => _revealDevTools('template'),
    openLabel: t('dev_tools.title'),
    openIcon: 'construction',
  }) : null;
  if (resultElement?.isConnected) {
    resultElement.className = 'bdt-template-result bdt-loading';
    resultElement.textContent = t('dev_tools.template_rendering');
  }
  try {
    const response = await fetchWithAuth(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'render_template', template: immutableTemplate }),
    });
    if (!response?.success) {
      const message = responseFailure(response, 'Home Assistant rejected the template');
      operation?.fail(t('dev_tools.template_failed'), message);
      if (resultElement?.isConnected) {
        resultElement.textContent = message;
        resultElement.className = 'bdt-template-result bdt-err';
      }
      if (panel?.isConnected) _recordRawResult(panel, 'Templates', 'Render failed', response);
      return false;
    }
    operation?.finish(t('dev_tools.template_rendered'), { detail: t('dev_tools.output_characters', { count: String(response.result ?? '').length }) });
    if (resultElement?.isConnected) {
      resultElement.textContent = response.result;
      resultElement.className = 'bdt-template-result bdt-ok';
    }
    if (panel?.isConnected) _recordRawResult(panel, 'Templates', 'Rendered', response);
    return true;
  } catch (error) {
    operation?.fail(t('dev_tools.template_failed'), error.message);
    if (resultElement?.isConnected) {
      resultElement.textContent = error.message;
      resultElement.className = 'bdt-template-result bdt-err';
    }
    if (panel?.isConnected) _recordRawResult(panel, 'Templates', 'Render failed', { error: error.message });
    return false;
  }
}

function _destroyPanel(panel) {
  if (!panel) return;
  if (typeof panel._bdtCleanup === 'function') panel._bdtCleanup();
  panel.remove();
}

const MAX_RAW_RESULT_LENGTH = 200000;

function _resultInspector() {
  return `
    <details class="bdt-result-inspector">
      <summary class="bdt-result-summary">
        <span>${t('dev_tools.result_inspector')}</span>
        <span class="bdt-result-context">${t('dev_tools.no_results_yet')}</span>
      </summary>
      <div class="bdt-result-tools">
        <input class="bdt-result-search" type="search" aria-label="${t('dev_tools.search_raw_result')}" placeholder="${t('dev_tools.search_this_result')}" autocomplete="off" spellcheck="false">
        <button class="bdt-btn-ghost bdt-result-copy" type="button" title="${t('dev_tools.copy_raw_result')}" aria-label="${t('dev_tools.copy_raw_result')}" disabled>
          <span class="ui-icon material-icons bdt-toolbar-icon" aria-hidden="true">content_copy</span>
        </button>
      </div>
      <pre class="bdt-result-raw" tabindex="0">${t('dev_tools.run_tool_to_inspect')}</pre>
      <div class="bdt-result-empty" hidden>${t('dev_tools.no_matching_lines')}</div>
    </details>
  `;
}

function _initResultInspector(panel) {
  const inspector = panel.querySelector('.bdt-result-inspector');
  const search = inspector.querySelector('.bdt-result-search');
  const copy = inspector.querySelector('.bdt-result-copy');
  const raw = inspector.querySelector('.bdt-result-raw');
  const empty = inspector.querySelector('.bdt-result-empty');
  panel._bdtResultState = { text: '', source: '', summary: '' };

  const render = () => {
    const fullText = panel._bdtResultState.text;
    const query = search.value.trim().toLowerCase();
    const visibleText = query
    ? fullText.split('\n').filter(line => line.toLowerCase().includes(query)).join('\n')
      : fullText;
    raw.textContent = visibleText || (fullText ? '' : t('dev_tools.run_tool_to_inspect'));
    empty.hidden = !fullText || Boolean(visibleText);
  };

  search.addEventListener('input', render);
  copy.addEventListener('click', async () => {
    if (!panel._bdtResultState.text) return;
    await navigator.clipboard.writeText(panel._bdtResultState.text);
    copy.title = t('dev_tools.copied');
    setTimeout(() => { copy.title = t('dev_tools.copy_raw_result'); }, 1200);
  });
  panel._bdtRenderResult = render;
}

function _recordRawResult(panel, source, summary, value, { open = true } = {}) {
  const inspector = panel.querySelector('.bdt-result-inspector');
  if (!inspector) return;
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  text = text || t('dev_tools.empty_response');
  if (text.length > MAX_RAW_RESULT_LENGTH) {
      text = `${text.slice(0, MAX_RAW_RESULT_LENGTH)}\n\n[${t('dev_tools.raw_result_truncated', { count: MAX_RAW_RESULT_LENGTH.toLocaleString() })}]`;
  }
  panel._bdtResultState = { text, source, summary };
  panel.querySelector('.bdt-result-context').textContent = `${source}: ${summary}`;
  panel.querySelector('.bdt-result-copy').disabled = false;
  panel.querySelector('.bdt-result-search').value = '';
  panel._bdtRenderResult?.();
  if (open) inspector.open = true;
}

// ── Actions pane ──────────────────────────────────────────────────────────────

function _actionsPane() {
  return `
    <div class="bdt-actions-wrap">

      <!-- Top bar: action search + YAML mode toggle -->
      <div class="bdt-actions-topbar">
        <div class="bdt-action-search-wrap">
          <span class="ui-icon material-icons bdt-search-icon">search</span>
          <input class="bdt-action-search" aria-label="${t('dev_tools.search_actions')}" placeholder="${t('dev_tools.search_actions_placeholder')}" autocomplete="off" spellcheck="false">
          <button class="bdt-action-clear-search" style="display:none;" title="${t('common.clear')}">✕</button>
          <!-- Search dropdown is inside the search-wrap so position:absolute works correctly -->
          <div class="bdt-action-dropdown" style="display:none;"></div>
        </div>
        <label class="bdt-mode-toggle" title="${t('dev_tools.switch_yaml_mode')}">
          <input type="checkbox" class="bdt-yaml-toggle">
          <span class="bdt-toggle-track"><span class="bdt-toggle-knob"></span></span>
          <span class="bdt-toggle-label">${t('dev_tools.yaml_mode')}</span>
        </label>
      </div>

      <!-- Form view (default) -->
      <div class="bdt-action-form-view">
        <div class="bdt-action-none-selected">
          <span class="ui-icon material-icons bdt-action-empty-icon">play_circle</span>
          ${t('dev_tools.select_action')}
        </div>
        <div class="bdt-action-selected-view" style="display:none;">
          <div class="bdt-action-header-row">
            <div>
              <div class="bdt-action-name"></div>
              <div class="bdt-action-desc"></div>
            </div>
          </div>
          <div class="bdt-action-fields"></div>
          <div class="bdt-action-footer">
            <button class="bdt-btn-primary bdt-perform-btn">
              <span class="ui-icon material-icons bdt-button-icon">play_arrow</span> ${t('dev_tools.perform_action')}
            </button>
            <div class="bdt-action-result" style="display:none;"></div>
          </div>
        </div>
      </div>

      <!-- YAML view -->
      <div class="bdt-action-yaml-view" style="display:none;">
        <div class="bdt-pane-label" style="margin-bottom:6px;">
          ${t('dev_tools.action')} <span class="bdt-hint">${t('dev_tools.action_yaml_hint')}</span>
        </div>
        <textarea class="bdt-yaml-input" aria-label="${t('dev_tools.action_yaml')}" spellcheck="false" placeholder="action: light.turn_on
target:
  entity_id: light.living_room
data:
  brightness: 128
# 'service:' is also accepted for backward compatibility"></textarea>
        <div class="bdt-action-footer" style="margin-top:8px;">
          <button class="bdt-btn-primary bdt-yaml-perform-btn">
              <span class="ui-icon material-icons bdt-button-icon">play_arrow</span> ${t('dev_tools.perform_action')}
          </button>
          <div class="bdt-yaml-result" style="display:none;"></div>
        </div>
      </div>

    </div>
  `;
}

function _initActions(panel) {
  const pane = panel.querySelector('[data-pane="actions"]');
  const searchInput = pane.querySelector('.bdt-action-search');
  const clearSearchBtn = pane.querySelector('.bdt-action-clear-search');
  const dropdown = pane.querySelector('.bdt-action-dropdown');
  const formView = pane.querySelector('.bdt-action-form-view');
  const yamlView = pane.querySelector('.bdt-action-yaml-view');
  const yamlToggle = pane.querySelector('.bdt-yaml-toggle');
  const noneSelected = pane.querySelector('.bdt-action-none-selected');
  const selectedView = pane.querySelector('.bdt-action-selected-view');
  const actionName = pane.querySelector('.bdt-action-name');
  const actionDesc = pane.querySelector('.bdt-action-desc');
  const fieldsContainer = pane.querySelector('.bdt-action-fields');
  const performBtn = pane.querySelector('.bdt-perform-btn');
  const actionResult = pane.querySelector('.bdt-action-result');
  const yamlInput = pane.querySelector('.bdt-yaml-input');
  const yamlPerformBtn = pane.querySelector('.bdt-yaml-perform-btn');
  const yamlResult = pane.querySelector('.bdt-yaml-result');

  let currentAction = null;
  let allServices = [];
  let isYamlMode = false;

  // ── Load services ──
  async function ensureServices() {
    if (allServices.length) return allServices;
    if (HA_SERVICES.length) { allServices = HA_SERVICES; return allServices; }
    try {
      const d = await fetchWithAuth(`${API_BASE}?action=get_metadata`);
      allServices = d.actions || [];
    } catch { allServices = []; }
    return allServices;
  }

  // ── Search ──
  searchInput.addEventListener('focus', async () => {
    await ensureServices();
    _showDropdown(searchInput.value.trim().toLowerCase());
  });
  searchInput.addEventListener('input', async () => {
    clearSearchBtn.style.display = searchInput.value ? '' : 'none';
    await ensureServices();
    _showDropdown(searchInput.value.trim().toLowerCase());
  });
  searchInput.addEventListener('blur', () => {
    setTimeout(() => { dropdown.style.display = 'none'; }, 160);
  });
  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearSearchBtn.style.display = 'none';
    searchInput.focus();
    _showDropdown('');
  });

  function _showDropdown(q) {
    const filtered = q
      ? allServices.filter(s =>
          s.service.toLowerCase().includes(q) ||
          s.domain.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          (s.description || '').toLowerCase().includes(q))
      : allServices;
    if (!filtered.length) { dropdown.style.display = 'none'; return; }

    // Group by domain
    const byDomain = {};
    filtered.forEach(s => {
      (byDomain[s.domain] = byDomain[s.domain] || []).push(s);
    });

    // Without a query limit to 8 domains to keep the list manageable; with a query show all matches
    const domainEntries = Object.entries(byDomain);
    const visibleEntries = q ? domainEntries : domainEntries.slice(0, 8);

    dropdown.innerHTML = visibleEntries.map(([domain, svcs]) => `
      <div class="bdt-drop-domain">${_esc(domain)}</div>
      ${svcs.map(s => `
        <div class="bdt-drop-item" data-service="${_esc(s.service)}">
          <span class="bdt-drop-name">${_esc(s.name)}</span>
          ${s.description ? `<span class="bdt-drop-desc">${_esc(s.description)}</span>` : ''}
        </div>
      `).join('')}
    `).join('');
    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.bdt-drop-item').forEach(item => {
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        const svc = allServices.find(s => s.service === item.dataset.service);
        if (svc) _selectAction(svc);
      });
    });
  }

  // ── Select action ──
  function _selectAction(svc) {
    currentAction = svc;
    dropdown.style.display = 'none';
    searchInput.value = svc.service;
    clearSearchBtn.style.display = '';

    actionName.textContent = svc.service;
    actionDesc.textContent = svc.description || '';
    actionResult.style.display = 'none';

    _buildFields(svc);
    noneSelected.style.display = 'none';
    selectedView.style.display = 'block';

    // Also pre-fill YAML view
    yamlInput.value = `action: ${svc.service}\ntarget:\n  entity_id:\ndata:\n`;
  }

  // ── Build form fields ──
  function _buildFields(svc) {
    const fields = svc.fields || {};
    const keys = Object.keys(fields);

    // Always show a Targets row (entity_id)
    let html = `
      <div class="bdt-field-row bdt-field-target" data-field="entity_id">
        <label class="bdt-field-label">Targets <span class="bdt-field-hint">— entity_id, area_id, device_id</span></label>
        <input class="bdt-field-input bdt-target-input" type="text" aria-label="${t('dev_tools.action_targets')}" placeholder="e.g. light.living_room" data-field="entity_id"
               list="bdt-entity-list">
      </div>
    `;

    if (!keys.length) {
      html += `<p class="bdt-no-fields">${t('dev_tools.no_configurable_fields')}</p>`;
    } else {
      html += keys.map(key => {
        const f = fields[key];
        const req = f.required ? '<span class="bdt-required">*</span>' : '';
        const desc = f.description ? `<div class="bdt-field-desc">${_esc(f.description)}</div>` : '';
        const sel = f.selector || {};
        const selType = Object.keys(sel)[0] || null;

        let input;
        if (selType === 'select' && sel.select?.options) {
          const opts = sel.select.options.map(o => {
            const val = typeof o === 'object' ? o.value : o;
            const label = typeof o === 'object' ? (o.label || o.value) : o;
            return `<option value="${_esc(val)}">${_esc(label)}</option>`;
          }).join('');
          input = `<select class="bdt-field-input bdt-field-select" aria-label="${_esc(key)}" data-field="${_esc(key)}"><option value="">${t('dev_tools.select_option')}</option>${opts}</select>`;
        } else if (selType === 'boolean') {
          input = `<select class="bdt-field-input bdt-field-select" aria-label="${_esc(key)}" data-field="${_esc(key)}">
            <option value="">— select —</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>`;
        } else if (selType === 'number') {
          const unit = sel.number?.unit_of_measurement || '';
          const hasRange = sel.number?.min != null && sel.number?.max != null;
          const min = sel.number?.min ?? 0;
          const max = sel.number?.max ?? 100;
          const step = sel.number?.step ?? (Number.isInteger(min) && Number.isInteger(max) ? 1 : 0.1);
          const example = f.example != null ? String(f.example) : '';
          const unitSpan = unit ? `<span class="bdt-field-unit">${_esc(unit)}</span>` : '';
          if (hasRange) {
            input = `<div class="bdt-field-slider-wrap">
              <input class="bdt-field-slider" type="range" aria-label="${_esc(key)} slider" min="${min}" max="${max}" step="${step}"
                     value="${example || min}" data-field="${_esc(key)}" data-sync="bdt-num-${_esc(key)}">
              <input class="bdt-field-input bdt-field-num" type="number" aria-label="${_esc(key)} value" min="${min}" max="${max}" step="${step}"
                     value="${example || ''}" placeholder="${example}" data-field="${_esc(key)}" id="bdt-num-${_esc(key)}">
              ${unitSpan}
            </div>`;
          } else {
            input = `<div class="bdt-field-number-wrap">
              <input class="bdt-field-input" type="number" aria-label="${_esc(key)}" min="${min}" max="${max}" step="${step}"
                     placeholder="${example}" data-field="${_esc(key)}">
              ${unitSpan}
            </div>`;
          }
        } else if (selType === 'entity') {
          input = `<input class="bdt-field-input" type="text" aria-label="${_esc(key)}" placeholder="${f.example != null ? _esc(String(f.example)) : t('dev_tools.entity_id')}" data-field="${_esc(key)}" list="bdt-entity-list">`;
        } else {
          const example = f.example != null ? String(f.example) : '';
          input = `<input class="bdt-field-input" type="text" aria-label="${_esc(key)}" placeholder="${_esc(example)}" data-field="${_esc(key)}">`;
        }

        return `
          <div class="bdt-field-row" data-field="${_esc(key)}">
            <label class="bdt-field-label">${_esc(key)}${req}</label>
            ${desc}
            ${input}
          </div>
        `;
      }).join('');
    }

    // Entity datalist — filtered to the action's domain
    const domain = svc.domain || svc.service.split('.')[0];
    const entityIds = (typeof HA_ENTITIES !== 'undefined' ? HA_ENTITIES : [])
      .filter(e => e.entity_id.startsWith(domain + '.'))
      .map(e => `<option value="${_esc(e.entity_id)}">${e.friendly_name ? _esc(e.friendly_name) : ''}</option>`).join('');
    html += `<datalist id="bdt-entity-list">${entityIds}</datalist>`;

    fieldsContainer.innerHTML = html;

    // Sync sliders ↔ number inputs
    fieldsContainer.querySelectorAll('.bdt-field-slider').forEach(slider => {
      const numInput = document.getElementById(slider.dataset.sync);
      if (!numInput) return;
      slider.addEventListener('input', () => { numInput.value = slider.value; });
      numInput.addEventListener('input', () => {
        const v = parseFloat(numInput.value);
        if (!isNaN(v)) slider.value = v;
      });
    });
  }

  // ── YAML mode toggle ──
  yamlToggle.addEventListener('change', () => {
    isYamlMode = yamlToggle.checked;
    formView.style.display = isYamlMode ? 'none' : 'block';
    yamlView.style.display = isYamlMode ? 'flex' : 'none';
    // Sync current action into yaml if switching to yaml
    if (isYamlMode && currentAction) {
      const formData = _collectFormData();
      let yaml = `action: ${currentAction.service}\n`;
      const entityId = formData.entity_id;
      if (entityId) yaml += `target:\n  entity_id: ${entityId}\n`;
      const dataFields = Object.entries(formData).filter(([k]) => k !== 'entity_id');
      if (dataFields.length) {
        yaml += `data:\n` + dataFields.map(([k, v]) => `  ${k}: ${_formatYamlScalar(v)}`).join('\n') + '\n';
      }
      yamlInput.value = yaml;
    }
  });

  function _collectFormData() {
    const result = {};
    fieldsContainer.querySelectorAll('.bdt-field-input, .bdt-field-select').forEach(inp => {
      const v = inp.value.trim();
      if (v) result[inp.dataset.field] = _coerce(v);
    });
    return result;
  }

  // ── Perform (form mode) ──
  performBtn.addEventListener('click', async () => {
    if (!currentAction) return;
    const [domain, service] = currentAction.service.split('.');
    const formData = _collectFormData();
    const target = {};
    if (formData.entity_id) { target.entity_id = formData.entity_id; delete formData.entity_id; }
    await runDeveloperAction(
      { domain, service, serviceData: formData, target },
      { button: performBtn, resultElement: actionResult, panel, buttonLabel: 'Perform action' },
    );
  });

  // ── Perform (YAML mode) ──
  yamlPerformBtn.addEventListener('click', async () => {
    const raw = yamlInput.value.trim();
    if (!raw) return;
    // Parse a simple YAML action block
    let parsed;
    try { parsed = _parseActionYaml(raw); }
    catch (e) {
      _showResult(yamlResult, false, t('dev_tools.yaml_parse_error', { error: e.message }));
      return;
    }
    const { action, data = {}, target = {} } = parsed;
    if (!action) { _showResult(yamlResult, false, 'Missing "action:" field'); return; }
    const [domain, service] = action.split('.');
    if (!domain || !service) { _showResult(yamlResult, false, 'Action must be in domain.service format'); return; }
    await runDeveloperAction(
      { domain, service, serviceData: data, target },
      { button: yamlPerformBtn, resultElement: yamlResult, panel, buttonLabel: 'Perform action' },
    );
  });
}

// ── Template pane ─────────────────────────────────────────────────────────────

function _templatePane() {
  return `
    <div class="bdt-template-wrap">
      <div class="bdt-split-left">
        <div class="bdt-pane-label">${t('dev_tools.template')} <span class="bdt-hint">${t('dev_tools.template_hint')}</span></div>
        <textarea class="bdt-template-input" aria-label="${t('dev_tools.template_input')}" placeholder="{{ states('sensor.temperature') }}&#10;{% if is_state('light.living_room', 'on') %}on{% endif %}"></textarea>
        <div class="bdt-template-actions">
          <button class="bdt-btn-primary bdt-render-btn">
            <span class="ui-icon material-icons bdt-button-icon">play_arrow</span> ${t('dev_tools.render')}
          </button>
          <button class="bdt-btn-ghost bdt-clear-btn">${t('dev_tools.clear')}</button>
        </div>
      </div>
      <div class="bdt-split-right">
        <div class="bdt-pane-label">${t('dev_tools.result')}</div>
        <pre class="bdt-template-result bdt-placeholder">${t('dev_tools.template_output_placeholder')}</pre>
      </div>
    </div>
  `;
}

function _initTemplate(panel) {
  const pane = panel.querySelector('[data-pane="template"]');
  const input = pane.querySelector('.bdt-template-input');
  const result = pane.querySelector('.bdt-template-result');
  const renderBtn = pane.querySelector('.bdt-render-btn');
  const clearBtn = pane.querySelector('.bdt-clear-btn');
  let timer = null;

  async function render(observable = false) {
    const tmpl = input.value.trim();
    if (!tmpl) { result.textContent = t('dev_tools.template_output_placeholder'); result.className = 'bdt-template-result bdt-placeholder'; return; }
    await renderDeveloperTemplate(tmpl, { resultElement: result, panel, observable });
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => render(false), 600); });
  renderBtn.addEventListener('click', () => render(true));
  clearBtn.addEventListener('click', () => {
    input.value = '';
    result.textContent = t('dev_tools.template_output_placeholder');
    result.className = 'bdt-template-result bdt-placeholder';
  });
  input.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); render(true); } });
}

// ── States pane ───────────────────────────────────────────────────────────────

function _statesPane() {
  return `
    <div class="bdt-states-wrap">
      <div class="bdt-states-toolbar">
        <input class="bdt-states-search" aria-label="${t('dev_tools.filter_states')}" placeholder="${t('dev_tools.filter_states_placeholder')}" autocomplete="off" spellcheck="false">
        <select class="bdt-domain-filter" aria-label="${t('dev_tools.filter_states_domain')}"><option value="">${t('dev_tools.all_domains')}</option></select>
        <button class="bdt-btn-ghost bdt-states-refresh" title="${t('dev_tools.refresh')}" aria-label="${t('dev_tools.refresh_states')}">
          <span class="ui-icon material-icons bdt-toolbar-icon">refresh</span>
        </button>
      </div>
      <div class="bdt-states-table-wrap">
        <table class="bdt-states-table">
          <thead><tr><th>${t('dev_tools.entity')}</th><th>${t('dev_tools.state')}</th><th>${t('dev_tools.attributes')}</th></tr></thead>
          <tbody class="bdt-states-body"><tr><td colspan="3" class="bdt-states-loading">${t('common.loading')}</td></tr></tbody>
        </table>
      </div>
    </div>
  `;
}

function _initStates(panel) {
  const pane = panel.querySelector('[data-pane="states"]');
  const searchInput = pane.querySelector('.bdt-states-search');
  const domainFilter = pane.querySelector('.bdt-domain-filter');
  const tbody = pane.querySelector('.bdt-states-body');
  const refreshBtn = pane.querySelector('.bdt-states-refresh');
  let allEntities = [];

  async function load(observable = false) {
    const operation = observable ? startOperationFeedback({
      label: t('dev_tools.states_refresh'),
      icon: 'refresh',
      message: t('dev_tools.states_loading'),
      scope: t('dev_tools.ha_instance'),
      target: t('dev_tools.state_registry'),
      retry: () => {
        _revealDevTools('states');
        queueMicrotask(() => document.querySelector(`#${PANEL_ID} .bdt-states-refresh`)?.click());
      },
      open: () => _revealDevTools('states'),
      openLabel: t('dev_tools.title'),
      openIcon: 'construction',
    }) : null;
    tbody.innerHTML = `<tr><td colspan="3" class="bdt-states-loading">${t('common.loading')}</td></tr>`;
    try {
      const data = await fetchWithAuth(API_BASE, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_entities', with_attributes: true }),
      });
      if (data?.success === false) throw new Error(responseFailure(data, 'State loading was rejected'));
      allEntities = data.entities || [];
      operation?.finish(tp('dev_tools.states_loaded', allEntities.length));
      _recordRawResult(panel, 'States', `${allEntities.length} entities loaded`, data, { open: false });
      const domains = [...new Set(allEntities.map(e => e.entity_id.split('.')[0]))].sort();
      domainFilter.innerHTML = `<option value="">${t('dev_tools.all_domains')}</option>` +
        domains.map(d => `<option value="${_esc(d)}">${_esc(d)}</option>`).join('');
      render();
    } catch (e) {
      operation?.fail(t('dev_tools.states_failed'), e.message);
      tbody.innerHTML = `<tr><td colspan="3" class="bdt-states-loading">${_esc(t('dev_tools.error_detail', { error: e.message }))}</td></tr>`;
      _recordRawResult(panel, 'States', 'Load failed', { error: e.message });
    }
  }

  function render() {
    const q = searchInput.value.trim().toLowerCase();
    const domain = domainFilter.value;
    let filtered = allEntities;
    if (domain) filtered = filtered.filter(e => e.entity_id.startsWith(domain + '.'));
    if (q) filtered = filtered.filter(e =>
      e.entity_id.toLowerCase().includes(q) || (e.friendly_name || '').toLowerCase().includes(q));
    if (!filtered.length) { tbody.innerHTML = `<tr><td colspan="3" class="bdt-states-loading">${t('dev_tools.no_entities_match')}</td></tr>`; return; }

    const visible = filtered.slice(0, 200);
    tbody.innerHTML = visible.map(e => {
      const cls = e.state === 'on' ? 'bdt-state-on' : e.state === 'off' ? 'bdt-state-off' : 'bdt-state-other';
      const attrs = e.attributes || {};
      // Show a short summary: up to 2 key attributes excluding friendly_name/icon
      const skipSummary = new Set(['friendly_name', 'icon', 'entity_picture', 'supported_features', 'supported_color_modes']);
      const summary = Object.entries(attrs)
        .filter(([k]) => !skipSummary.has(k))
        .slice(0, 2)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
        .join(' · ');
      return `<tr class="bdt-state-row" title="${_esc(e.entity_id)}">
        <td class="bdt-entity-cell">
          <span class="bdt-entity-id" title="${t('dev_tools.copy_entity_id')}">${_esc(e.entity_id)}</span>
          ${e.friendly_name ? `<span class="bdt-friendly-name">${_esc(e.friendly_name)}</span>` : ''}
        </td>
        <td><span class="bdt-state-badge ${cls}">${_esc(e.state)}</span></td>
        <td class="bdt-attrs-cell">${_esc(summary)}</td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.bdt-entity-id').forEach(span => {
      span.addEventListener('click', e => {
        e.stopPropagation();
        navigator.clipboard.writeText(span.textContent).then(() => {
          const orig = span.textContent;
          span.textContent = t('dev_tools.copied');
          setTimeout(() => { span.textContent = orig; }, 1200);
        });
      });
    });

    tbody.querySelectorAll('.bdt-state-row').forEach((row, i) => {
      row.addEventListener('click', () => {
        const next = row.nextElementSibling;
        if (next && next.classList.contains('bdt-attr-detail-row')) { next.remove(); return; }
        const entity = visible[i];
        const attrs = entity.attributes || {};
        const skip = new Set(['entity_picture']);
        const rows = Object.entries(attrs)
          .filter(([k]) => !skip.has(k))
          .map(([k, v]) => {
            const display = Array.isArray(v) ? v.join(', ') : (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
            return `<tr><td class="bdt-attr-key">${_esc(k)}</td><td class="bdt-attr-val">${_esc(display)}</td></tr>`;
          }).join('');
        const detail = document.createElement('tr');
        detail.className = 'bdt-attr-detail-row';
        detail.innerHTML = `<td colspan="3" class="bdt-attr-detail-cell"><table class="bdt-attr-table">${rows || `<tr><td colspan="2" style="opacity:.6">${t('dev_tools.no_attributes')}</td></tr>`}</table></td>`;
        row.after(detail);
      });
    });
  }

  searchInput.addEventListener('input', render);
  domainFilter.addEventListener('change', render);
  refreshBtn.addEventListener('click', () => { allEntities = []; load(true); });

  const observer = new MutationObserver(() => {
    if (pane.classList.contains('active') && allEntities.length === 0) load(false);
  });
  observer.observe(pane, { attributes: true, attributeFilter: ['class'] });
  if (pane.classList.contains('active') && allEntities.length === 0) load(false);
  return () => observer.disconnect();
}

// ── Configuration and reload panes ───────────────────────────────────────────

const RELOAD_ITEMS = [
  { domain: 'core',           labelKey: 'reload_core', icon: 'refresh' },
  { domain: 'automation',     labelKey: 'reload_automation', icon: 'smart_toy' },
  { domain: 'script',         labelKey: 'reload_script', icon: 'code' },
  { domain: 'scene',          labelKey: 'reload_scene', icon: 'photo_camera' },
  { domain: 'group',          labelKey: 'reload_group', icon: 'group' },
  { domain: 'template',       labelKey: 'reload_template', icon: 'integration_instructions' },
  { domain: 'input_boolean',  labelKey: 'reload_input_boolean', icon: 'toggle_on' },
  { domain: 'input_number',   labelKey: 'reload_input_number', icon: 'pin' },
  { domain: 'input_select',   labelKey: 'reload_input_select', icon: 'list' },
  { domain: 'input_text',     labelKey: 'reload_input_text', icon: 'text_fields' },
  { domain: 'input_datetime', labelKey: 'reload_input_datetime', icon: 'event' },
  { domain: 'input_button',   labelKey: 'reload_input_button', icon: 'smart_button' },
  { domain: 'timer',          labelKey: 'reload_timer', icon: 'timer' },
  { domain: 'counter',        labelKey: 'reload_counter', icon: 'tag' },
  { domain: 'schedule',       labelKey: 'reload_schedule', icon: 'schedule' },
];

function reloadLabel(item) {
  return t(`dev_tools.${item?.labelKey || 'reload_unknown'}`);
}

function _configPane() {
  return `
    <div class="bdt-config-wrap">

      <!-- Config check -->
      <div class="bdt-config-section">
        <div class="bdt-config-section-title">
          <span class="ui-icon material-icons bdt-section-icon">fact_check</span>
          ${t('dev_tools.configuration_check_heading')}
        </div>
        <button class="bdt-btn-primary bdt-run-check-btn" style="width:100%;">
          <span class="ui-icon material-icons bdt-button-icon">play_arrow</span> ${t('dev_tools.config_check')}
        </button>
        <div class="bdt-check-result" style="display:none;"></div>
        <div class="bdt-check-errors" style="display:none;"></div>
      </div>

    </div>
  `;
}

function _reloadPane() {
  return `
    <div class="bdt-config-wrap">
      <div class="bdt-config-section">
        <div class="bdt-config-section-title">
          <span class="ui-icon material-icons bdt-section-icon">cached</span>
          ${t('dev_tools.reload_heading')}
        </div>
        <p class="bdt-section-description">${t('dev_tools.reload_description')}</p>
        <div class="bdt-reload-grid">
          ${RELOAD_ITEMS.map(item => `
            <button class="bdt-reload-btn" type="button" data-domain="${_esc(item.domain)}" title="${_esc(t('dev_tools.reload_label', { target: reloadLabel(item) }))}">
              <span class="ui-icon material-icons bdt-reload-icon" aria-hidden="true">${_esc(item.icon)}</span>
              <span class="bdt-reload-label">${_esc(reloadLabel(item))}</span>
              <span class="bdt-reload-status" aria-live="polite"></span>
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function _initConfig(panel) {
  const pane = panel.querySelector('[data-pane="config"]');

  // ── Config check ──
  const checkBtn = pane.querySelector('.bdt-run-check-btn');

  checkBtn.addEventListener('click', () => _runConfigurationCheck(panel));
}

async function _runConfigurationCheck(panel = null) {
  const pane = panel?.isConnected ? panel.querySelector('[data-pane="config"]') : null;
  const checkBtn = pane?.querySelector('.bdt-run-check-btn');
  const checkResult = pane?.querySelector('.bdt-check-result');
  const checkErrors = pane?.querySelector('.bdt-check-errors');
  const operation = startOperationFeedback({
    label: t('dev_tools.config_check'),
    icon: 'fact_check',
    scope: t('dev_tools.ha_instance'),
    target: t('dev_tools.yaml_configuration'),
    message: t('dev_tools.config_checking'),
    retry: () => _runConfigurationCheck(),
    open: () => _revealDevTools('config'),
    openLabel: t('operations.open'),
    openIcon: 'construction',
  });

  if (checkBtn && checkResult && checkErrors) {
    checkBtn.disabled = true;
    checkBtn.innerHTML = `<span class="ui-icon material-icons bdt-button-icon">hourglass_empty</span> ${t('dev_tools.config_checking_short')}`;
    checkResult.style.display = 'none';
    checkErrors.style.display = 'none';
  }

  try {
    const data = await fetchWithAuth(`${API_BASE}?action=run_config_check`);
    const result = data.result || {};
    const ok = result.success;
    const errors = result.errors || [];
    const errorDetail = errors.map(error => {
      const location = error.file ? `${error.file}${error.line ? `:${error.line}` : ''}: ` : '';
      return `${location}${error.message || 'Unknown configuration error'}`;
    }).join('\n');

    if (checkResult && checkErrors) {
      checkResult.textContent = ok
        ? `✓ ${t('dev_tools.config_valid')}`
        : `✗ ${tp('dev_tools.config_errors', errors.length)}`;
      checkResult.className = `bdt-check-result ${ok ? 'bdt-ok' : 'bdt-err'}`;
      checkResult.style.display = 'block';

      if (errors.length) {
        checkErrors.innerHTML = errors.map(err => {
          const loc = err.file ? `<span class="bdt-err-loc">${_esc(err.file)}${err.line ? ':' + err.line : ''}</span>` : '';
          return `<div class="bdt-check-error-row">${loc}<span class="bdt-err-msg">${_esc(err.message)}</span></div>`;
        }).join('');
        checkErrors.style.display = 'block';
      }
    }

    if (panel?.isConnected) {
      _recordRawResult(panel, 'Configuration', ok ? 'Configuration valid' : 'Configuration invalid', data);
    }
    if (ok) {
      operation.finish(t('dev_tools.config_valid'));
    } else {
      operation.fail(
        errors.length
          ? tp('dev_tools.config_errors', errors.length)
          : t('dev_tools.config_not_valid'),
        errorDetail || result.output || data.message || t('dev_tools.config_rejected'),
      );
    }
  } catch (e) {
    if (checkResult) {
      checkResult.textContent = `✗ ${t('dev_tools.error_detail', { error: e.message })}`;
      checkResult.className = 'bdt-check-result bdt-err';
      checkResult.style.display = 'block';
    }
    if (panel?.isConnected) {
      _recordRawResult(panel, 'Configuration', 'Check failed', { error: e.message });
    }
    operation.fail(t('dev_tools.config_failed'), e.message);
  } finally {
    if (checkBtn) {
      checkBtn.disabled = false;
      checkBtn.innerHTML = `<span class="ui-icon material-icons bdt-button-icon">play_arrow</span> ${t('dev_tools.config_check')}`;
    }
  }
}

function _initReload(panel) {
  const pane = panel.querySelector('[data-pane="reload"]');
  pane.querySelectorAll('.bdt-reload-btn').forEach(btn => {
    btn.addEventListener('click', () => _runYamlReload(btn.dataset.domain, panel));
  });
}

async function _runYamlReload(domain, panel = null) {
  const item = RELOAD_ITEMS.find(candidate => candidate.domain === domain);
  const label = reloadLabel(item) || domain;
  const pane = panel?.isConnected ? panel.querySelector('[data-pane="reload"]') : null;
  const btn = pane?.querySelector(`.bdt-reload-btn[data-domain="${domain}"]`);
  const status = btn?.querySelector('.bdt-reload-status');
  const operation = startOperationFeedback({
    label: t('dev_tools.reload_label', { target: label }),
    icon: item?.icon || 'cached',
    scope: t('dev_tools.ha_instance'),
    target: label,
    message: t('dev_tools.reload_applying'),
    retry: () => _runYamlReload(domain),
    open: () => _revealDevTools('reload'),
    openLabel: t('operations.open'),
    openIcon: 'construction',
  });

  if (btn && status) {
    btn.disabled = true;
    status.textContent = '…';
    status.className = 'bdt-reload-status bdt-loading';
  }
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reload_yaml', domain }),
    });
    if (status) {
      status.textContent = data.success ? '✓' : '✗';
      status.className = `bdt-reload-status ${data.success ? 'bdt-ok' : 'bdt-err'}`;
      status.title = data.message || '';
    }
    if (panel?.isConnected) {
      _recordRawResult(panel, 'Reload', `${domain} ${data.success ? 'reloaded' : 'failed'}`, data);
    }
    if (data.success) operation.finish(t('dev_tools.reload_complete', { target: label }));
    else operation.fail(t('dev_tools.reload_failed', { target: label }), data.message || t('dev_tools.reload_rejected'));
  } catch (e) {
    if (status) {
      status.textContent = '✗';
      status.className = 'bdt-reload-status bdt-err';
      status.title = e.message;
    }
    if (panel?.isConnected) {
      _recordRawResult(panel, 'Reload', `${domain} failed`, { error: e.message });
    }
    operation.fail(t('dev_tools.reload_failed', { target: label }), e.message);
  } finally {
    if (btn) btn.disabled = false;
    setTimeout(() => {
      if (!status?.isConnected) return;
      status.textContent = '';
      status.className = 'bdt-reload-status';
      status.title = '';
    }, 4000);
  }
}

// ── Draggable ─────────────────────────────────────────────────────────────────

function _makeDraggable(panel) {
  const header = panel.querySelector('.bdt-header');
  let startX, startY, origX, origY;
  header.addEventListener('mousedown', e => {
    if (document.body.dataset.workspaceMode === 'phone') return;
    if (e.target.closest('.bdt-close, .bdt-tab-btn, .bdt-mode-toggle')) return;
    const rect = panel.getBoundingClientRect();
    panel.style.bottom = 'auto'; panel.style.right = 'auto';
    panel.style.top = rect.top + 'px'; panel.style.left = rect.left + 'px';
    startX = e.clientX; startY = e.clientY; origX = rect.left; origY = rect.top;
    const onMove = ev => {
      panel.style.left = Math.max(0, origX + ev.clientX - startX) + 'px';
      panel.style.top = Math.max(0, origY + ev.clientY - startY) + 'px';
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (!isNaN(v) && v !== '') return Number(v);
  return v.replace(/^['"]|['"]$/g, '');
}

/**
 * Parse the HA action YAML shape accepted by this panel into
 * { action, data, target }. It supports nested maps and simple lists under
 * data:/target: without trying to become a full YAML parser.
 */
function _parseActionYaml(text) {
  const result = { action: null, data: {}, target: {} };
  const stack = [{ indent: -1, value: result }];

  const lines = text.split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const raw = lines[lineIndex];
    const withoutComment = _stripYamlComment(raw);
    const line = withoutComment.trimEnd();
    if (!line.trim()) continue;

    const indent = line.match(/^(\s*)/)[1].length;
    const trimmed = line.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;

    if (trimmed.startsWith('- ')) {
      if (!Array.isArray(parent)) {
        throw new Error('List items must belong to a key such as entity_id:');
      }
      parent.push(_parseYamlValue(trimmed.slice(2).trim()));
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) throw new Error(`Invalid line: ${trimmed}`);

    const key = trimmed.slice(0, colonIdx).trim();
    const val = trimmed.slice(colonIdx + 1).trim();
    if (!key) throw new Error(`Invalid line: ${trimmed}`);

    if (indent === 0 && (key === 'action' || key === 'service')) {
      result.action = String(_parseYamlValue(val));
      continue;
    }
    if (indent === 0 && (key === 'data' || key === 'target')) {
      stack.push({ indent, value: result[key] });
      continue;
    }
    if (indent === 0) continue;

    if (!parent || typeof parent !== 'object' || Array.isArray(parent)) {
      throw new Error(`Cannot assign "${key}" here`);
    }

    if (val) {
      parent[key] = _parseYamlValue(val);
    } else {
      const nextLine = _nextContentLine(lines, lineIndex);
      parent[key] = nextLine && nextLine.trim().startsWith('- ') ? [] : {};
      stack.push({ indent, value: parent[key] });
    }
  }
  return result;
}

function _nextContentLine(lines, currentIndex) {
  for (let i = currentIndex + 1; i < lines.length; i += 1) {
    const line = _stripYamlComment(lines[i]).trim();
    if (line) return line;
  }
  return '';
}

function _stripYamlComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const prev = line[i - 1];
    if (char === "'" && !inDouble) inSingle = !inSingle;
    else if (char === '"' && !inSingle && prev !== '\\') inDouble = !inDouble;
    else if (char === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(prev))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function _parseYamlValue(value) {
  if (value === '') return '';
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(item => _parseYamlValue(item.trim()));
  }
  if (value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return {};
    return inner.split(',').reduce((obj, pair) => {
      const colonIdx = pair.indexOf(':');
      if (colonIdx === -1) throw new Error(`Invalid inline map item: ${pair.trim()}`);
      const key = pair.slice(0, colonIdx).trim();
      obj[key] = _parseYamlValue(pair.slice(colonIdx + 1).trim());
      return obj;
    }, {});
  }
  return _coerce(value);
}

function _formatYamlScalar(value) {
  if (Array.isArray(value)) return `[${value.map(_formatYamlScalar).join(', ')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).map(([k, v]) => `${k}: ${_formatYamlScalar(v)}`).join(', ')}}`;
  }
  return String(value);
}
