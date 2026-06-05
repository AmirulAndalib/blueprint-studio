/** DEV-TOOLS.JS | Purpose: HA Developer Tools floating panel — Actions / Template / States / Config */
import { API_BASE } from './constants.js';
import { fetchWithAuth } from './api.js';
import { HA_ENTITIES, HA_SERVICES } from './ha-autocomplete.js';

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
  panel._bdtCleanup = () => {
    while (cleanupFns.length) cleanupFns.pop()();
  };
  panel.innerHTML = `
    <div class="bdt-header">
      <span class="material-icons bdt-header-icon">construction</span>
      <span class="bdt-title">Developer Tools</span>
      <div class="bdt-tabs">
        <button class="bdt-tab-btn" data-tab="actions">Actions</button>
        <button class="bdt-tab-btn" data-tab="template">Template</button>
        <button class="bdt-tab-btn" data-tab="states">States</button>
        <button class="bdt-tab-btn" data-tab="config">Config</button>
      </div>
      <button class="bdt-close" title="Close">✕</button>
    </div>
    <div class="bdt-body">
      <div class="bdt-pane" data-pane="actions">${_actionsPane()}</div>
      <div class="bdt-pane" data-pane="template">${_templatePane()}</div>
      <div class="bdt-pane" data-pane="states">${_statesPane()}</div>
      <div class="bdt-pane" data-pane="config">${_configPane()}</div>
    </div>
  `;

  document.body.appendChild(panel);
  _makeDraggable(panel);

  panel.querySelectorAll('.bdt-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => _switchTab(panel, btn.dataset.tab));
  });
  panel.querySelector('.bdt-close').addEventListener('click', () => _destroyPanel(panel));

  const onKey = e => { if (e.key === 'Escape') _destroyPanel(panel); };
  document.addEventListener('keydown', onKey);
  cleanupFns.push(() => document.removeEventListener('keydown', onKey));

  _switchTab(panel, activeTab);
  _initActions(panel);
  _initTemplate(panel);
  const cleanupStates = _initStates(panel);
  if (cleanupStates) cleanupFns.push(cleanupStates);
  _initConfig(panel);
}

function _switchTab(panel, tab) {
  panel.querySelectorAll('.bdt-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  panel.querySelectorAll('.bdt-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === tab));
}

function _destroyPanel(panel) {
  if (!panel) return;
  if (typeof panel._bdtCleanup === 'function') panel._bdtCleanup();
  panel.remove();
}

// ── Actions pane ──────────────────────────────────────────────────────────────

function _actionsPane() {
  return `
    <div class="bdt-actions-wrap">

      <!-- Top bar: action search + YAML mode toggle -->
      <div class="bdt-actions-topbar">
        <div class="bdt-action-search-wrap">
          <span class="material-icons bdt-search-icon">search</span>
          <input class="bdt-action-search" placeholder="Search for an action… (e.g. light.turn_on)" autocomplete="off" spellcheck="false">
          <button class="bdt-action-clear-search" style="display:none;" title="Clear">✕</button>
          <!-- Search dropdown is inside the search-wrap so position:absolute works correctly -->
          <div class="bdt-action-dropdown" style="display:none;"></div>
        </div>
        <label class="bdt-mode-toggle" title="Switch to YAML mode">
          <input type="checkbox" class="bdt-yaml-toggle">
          <span class="bdt-toggle-track"><span class="bdt-toggle-knob"></span></span>
          <span class="bdt-toggle-label">YAML mode</span>
        </label>
      </div>

      <!-- Form view (default) -->
      <div class="bdt-action-form-view">
        <div class="bdt-action-none-selected">
          <span class="material-icons" style="font-size:36px;color:var(--text-muted,#6c7086);display:block;margin-bottom:8px;">play_circle</span>
          Select an action above to get started
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
              <span class="material-icons" style="font-size:15px;vertical-align:middle;">play_arrow</span> Perform action
            </button>
            <div class="bdt-action-result" style="display:none;"></div>
          </div>
        </div>
      </div>

      <!-- YAML view -->
      <div class="bdt-action-yaml-view" style="display:none;">
        <div class="bdt-pane-label" style="margin-bottom:6px;">
          Action <span class="bdt-hint">— enter the full action call as YAML</span>
        </div>
        <textarea class="bdt-yaml-input" spellcheck="false" placeholder="action: light.turn_on
target:
  entity_id: light.living_room
data:
  brightness: 128
# 'service:' is also accepted for backward compatibility"></textarea>
        <div class="bdt-action-footer" style="margin-top:8px;">
          <button class="bdt-btn-primary bdt-yaml-perform-btn">
            <span class="material-icons" style="font-size:15px;vertical-align:middle;">play_arrow</span> Perform action
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
      const d = await fetchWithAuth(`${API_BASE}?action=get_services`);
      allServices = d.services || [];
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
        <input class="bdt-field-input bdt-target-input" type="text" placeholder="e.g. light.living_room" data-field="entity_id"
               list="bdt-entity-list">
      </div>
    `;

    if (!keys.length) {
      html += `<p class="bdt-no-fields">This action has no configurable fields.</p>`;
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
          input = `<select class="bdt-field-input bdt-field-select" data-field="${_esc(key)}"><option value="">— select —</option>${opts}</select>`;
        } else if (selType === 'boolean') {
          input = `<select class="bdt-field-input bdt-field-select" data-field="${_esc(key)}">
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
              <input class="bdt-field-slider" type="range" min="${min}" max="${max}" step="${step}"
                     value="${example || min}" data-field="${_esc(key)}" data-sync="bdt-num-${_esc(key)}">
              <input class="bdt-field-input bdt-field-num" type="number" min="${min}" max="${max}" step="${step}"
                     value="${example || ''}" placeholder="${example}" data-field="${_esc(key)}" id="bdt-num-${_esc(key)}">
              ${unitSpan}
            </div>`;
          } else {
            input = `<div class="bdt-field-number-wrap">
              <input class="bdt-field-input" type="number" min="${min}" max="${max}" step="${step}"
                     placeholder="${example}" data-field="${_esc(key)}">
              ${unitSpan}
            </div>`;
          }
        } else if (selType === 'entity') {
          input = `<input class="bdt-field-input" type="text" placeholder="${f.example != null ? _esc(String(f.example)) : 'entity_id'}" data-field="${_esc(key)}" list="bdt-entity-list">`;
        } else {
          const example = f.example != null ? String(f.example) : '';
          input = `<input class="bdt-field-input" type="text" placeholder="${_esc(example)}" data-field="${_esc(key)}">`;
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
    await _callAction(domain, service, formData, target, performBtn, actionResult, 'Perform action');
  });

  // ── Perform (YAML mode) ──
  yamlPerformBtn.addEventListener('click', async () => {
    const raw = yamlInput.value.trim();
    if (!raw) return;
    // Parse a simple YAML action block
    let parsed;
    try { parsed = _parseActionYaml(raw); }
    catch (e) {
      _showResult(yamlResult, false, `YAML parse error: ${e.message}`);
      return;
    }
    const { action, data = {}, target = {} } = parsed;
    if (!action) { _showResult(yamlResult, false, 'Missing "action:" field'); return; }
    const [domain, service] = action.split('.');
    if (!domain || !service) { _showResult(yamlResult, false, 'Action must be in domain.service format'); return; }
    await _callAction(domain, service, data, target, yamlPerformBtn, yamlResult, 'Perform action');
  });

  async function _callAction(domain, service, serviceData, target, btn, resultEl, label) {
    btn.disabled = true;
    btn.innerHTML = `<span class="material-icons" style="font-size:15px;vertical-align:middle;">hourglass_empty</span> Calling…`;
    resultEl.style.display = 'none';
    try {
      const d = await fetchWithAuth(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'call_service', domain, service, service_data: serviceData, target }),
      });
      _showResult(resultEl, d.success, d.success ? 'Action performed successfully' : (d.error || 'Unknown error'));
    } catch (e) {
      _showResult(resultEl, false, e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<span class="material-icons" style="font-size:15px;vertical-align:middle;">play_arrow</span> ${label}`;
    }
  }

  function _showResult(el, ok, msg) {
    el.textContent = ok ? `✓ ${msg}` : `✗ ${msg}`;
    el.className = `bdt-action-result ${ok ? 'bdt-ok' : 'bdt-err'}`;
    el.style.display = 'block';
  }
}

// ── Template pane ─────────────────────────────────────────────────────────────

function _templatePane() {
  return `
    <div class="bdt-template-wrap">
      <div class="bdt-split-left">
        <div class="bdt-pane-label">Template <span class="bdt-hint">(Jinja2 — renders live)</span></div>
        <textarea class="bdt-template-input" placeholder="{{ states('sensor.temperature') }}&#10;{% if is_state('light.living_room', 'on') %}on{% endif %}"></textarea>
        <div class="bdt-template-actions">
          <button class="bdt-btn-primary bdt-render-btn">
            <span class="material-icons" style="font-size:15px;vertical-align:middle;">play_arrow</span> Render
          </button>
          <button class="bdt-btn-ghost bdt-clear-btn">Clear</button>
        </div>
      </div>
      <div class="bdt-split-right">
        <div class="bdt-pane-label">Result</div>
        <pre class="bdt-template-result bdt-placeholder">— output appears here —</pre>
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

  async function render() {
    const tmpl = input.value.trim();
    if (!tmpl) { result.textContent = '— output appears here —'; result.className = 'bdt-template-result bdt-placeholder'; return; }
    result.className = 'bdt-template-result bdt-loading';
    result.textContent = 'Rendering…';
    try {
      const data = await fetchWithAuth(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'render_template', template: tmpl }),
      });
      result.textContent = data.success ? data.result : (data.error || 'Unknown error');
      result.className = `bdt-template-result ${data.success ? 'bdt-ok' : 'bdt-err'}`;
    } catch (e) {
      result.textContent = e.message;
      result.className = 'bdt-template-result bdt-err';
    }
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 600); });
  renderBtn.addEventListener('click', render);
  clearBtn.addEventListener('click', () => {
    input.value = '';
    result.textContent = '— output appears here —';
    result.className = 'bdt-template-result bdt-placeholder';
  });
  input.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); render(); } });
}

// ── States pane ───────────────────────────────────────────────────────────────

function _statesPane() {
  return `
    <div class="bdt-states-wrap">
      <div class="bdt-states-toolbar">
        <input class="bdt-states-search" placeholder="Filter by entity_id or friendly name…" autocomplete="off" spellcheck="false">
        <select class="bdt-domain-filter"><option value="">All domains</option></select>
        <button class="bdt-btn-ghost bdt-states-refresh" title="Refresh">
          <span class="material-icons" style="font-size:16px;vertical-align:middle;">refresh</span>
        </button>
      </div>
      <div class="bdt-states-table-wrap">
        <table class="bdt-states-table">
          <thead><tr><th>Entity</th><th>State</th><th>Attributes</th></tr></thead>
          <tbody class="bdt-states-body"><tr><td colspan="3" class="bdt-states-loading">Loading…</td></tr></tbody>
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

  async function load() {
    tbody.innerHTML = '<tr><td colspan="3" class="bdt-states-loading">Loading…</td></tr>';
    try {
      const data = await fetchWithAuth(API_BASE, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_entities', with_attributes: true }),
      });
      allEntities = data.entities || [];
      const domains = [...new Set(allEntities.map(e => e.entity_id.split('.')[0]))].sort();
      domainFilter.innerHTML = '<option value="">All domains</option>' +
        domains.map(d => `<option value="${_esc(d)}">${_esc(d)}</option>`).join('');
      render();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="3" class="bdt-states-loading">Error: ${_esc(e.message)}</td></tr>`;
    }
  }

  function render() {
    const q = searchInput.value.trim().toLowerCase();
    const domain = domainFilter.value;
    let filtered = allEntities;
    if (domain) filtered = filtered.filter(e => e.entity_id.startsWith(domain + '.'));
    if (q) filtered = filtered.filter(e =>
      e.entity_id.toLowerCase().includes(q) || (e.friendly_name || '').toLowerCase().includes(q));
    if (!filtered.length) { tbody.innerHTML = '<tr><td colspan="3" class="bdt-states-loading">No entities match.</td></tr>'; return; }

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
          <span class="bdt-entity-id" title="Click to copy entity ID">${_esc(e.entity_id)}</span>
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
          span.textContent = 'Copied!';
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
        detail.innerHTML = `<td colspan="3" class="bdt-attr-detail-cell"><table class="bdt-attr-table">${rows || '<tr><td colspan="2" style="opacity:.6">No attributes</td></tr>'}</table></td>`;
        row.after(detail);
      });
    });
  }

  searchInput.addEventListener('input', render);
  domainFilter.addEventListener('change', render);
  refreshBtn.addEventListener('click', () => { allEntities = []; load(); });

  const observer = new MutationObserver(() => {
    if (pane.classList.contains('active') && allEntities.length === 0) load();
  });
  observer.observe(pane, { attributes: true, attributeFilter: ['class'] });
  if (pane.classList.contains('active') && allEntities.length === 0) load();
  return () => observer.disconnect();
}

// ── Config pane ───────────────────────────────────────────────────────────────

const RELOAD_ITEMS = [
  { domain: 'core',           label: 'All YAML configuration',     icon: 'refresh' },
  { domain: 'automation',     label: 'Automations',                 icon: 'smart_toy' },
  { domain: 'script',         label: 'Scripts',                     icon: 'code' },
  { domain: 'scene',          label: 'Scenes',                      icon: 'photo_camera' },
  { domain: 'group',          label: 'Groups',                      icon: 'group' },
  { domain: 'template',       label: 'Template entities',           icon: 'integration_instructions' },
  { domain: 'input_boolean',  label: 'Input booleans',              icon: 'toggle_on' },
  { domain: 'input_number',   label: 'Input numbers',               icon: 'pin' },
  { domain: 'input_select',   label: 'Input selects',               icon: 'list' },
  { domain: 'input_text',     label: 'Input texts',                 icon: 'text_fields' },
  { domain: 'input_datetime', label: 'Input datetimes',             icon: 'event' },
  { domain: 'input_button',   label: 'Input buttons',               icon: 'smart_button' },
  { domain: 'timer',          label: 'Timers',                      icon: 'timer' },
  { domain: 'counter',        label: 'Counters',                    icon: 'tag' },
  { domain: 'schedule',       label: 'Schedules',                   icon: 'schedule' },
];

function _configPane() {
  return `
    <div class="bdt-config-wrap">

      <!-- Config check -->
      <div class="bdt-config-section">
        <div class="bdt-config-section-title">
          <span class="material-icons" style="font-size:16px;vertical-align:middle;margin-right:6px;">fact_check</span>
          Configuration check
        </div>
        <button class="bdt-btn-primary bdt-run-check-btn" style="width:100%;">
          <span class="material-icons" style="font-size:15px;vertical-align:middle;">play_arrow</span> Check configuration
        </button>
        <div class="bdt-check-result" style="display:none;"></div>
        <div class="bdt-check-errors" style="display:none;"></div>
        <details class="bdt-check-raw-wrap" style="display:none;">
          <summary class="bdt-check-raw-toggle">Raw output</summary>
          <pre class="bdt-check-raw"></pre>
        </details>
      </div>

      <!-- YAML reloads -->
      <div class="bdt-config-section">
        <div class="bdt-config-section-title">
          <span class="material-icons" style="font-size:16px;vertical-align:middle;margin-right:6px;">cached</span>
          Reload YAML configuration
        </div>
        <div class="bdt-reload-grid">
          ${RELOAD_ITEMS.map(item => `
            <button class="bdt-reload-btn" data-domain="${_esc(item.domain)}" title="Reload ${_esc(item.label)}">
              <span class="material-icons bdt-reload-icon">${_esc(item.icon)}</span>
              <span class="bdt-reload-label">${_esc(item.label)}</span>
              <span class="bdt-reload-status"></span>
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
  const checkResult = pane.querySelector('.bdt-check-result');
  const checkErrors = pane.querySelector('.bdt-check-errors');
  const checkRawWrap = pane.querySelector('.bdt-check-raw-wrap');
  const checkRaw = pane.querySelector('.bdt-check-raw');

  checkBtn.addEventListener('click', async () => {
    checkBtn.disabled = true;
    checkBtn.innerHTML = `<span class="material-icons" style="font-size:15px;vertical-align:middle;">hourglass_empty</span> Checking…`;
    checkResult.style.display = 'none';
    checkErrors.style.display = 'none';
    checkRawWrap.style.display = 'none';

    try {
      const data = await fetchWithAuth(`${API_BASE}?action=run_config_check`);
      const result = data.result || {};
      const ok = result.success;
      const errors = result.errors || [];

      checkResult.textContent = ok
        ? '✓ Configuration is valid'
        : `✗ ${errors.length} error${errors.length !== 1 ? 's' : ''} found`;
      checkResult.className = `bdt-check-result ${ok ? 'bdt-ok' : 'bdt-err'}`;
      checkResult.style.display = 'block';

      if (errors.length) {
        checkErrors.innerHTML = errors.map(err => {
          const loc = err.file ? `<span class="bdt-err-loc">${_esc(err.file)}${err.line ? ':' + err.line : ''}</span>` : '';
          return `<div class="bdt-check-error-row">${loc}<span class="bdt-err-msg">${_esc(err.message)}</span></div>`;
        }).join('');
        checkErrors.style.display = 'block';
      }

      if (result.output) {
        checkRaw.textContent = result.output;
        checkRawWrap.style.display = 'block';
      }
    } catch (e) {
      checkResult.textContent = `✗ Error: ${e.message}`;
      checkResult.className = 'bdt-check-result bdt-err';
      checkResult.style.display = 'block';
    } finally {
      checkBtn.disabled = false;
      checkBtn.innerHTML = `<span class="material-icons" style="font-size:15px;vertical-align:middle;">play_arrow</span> Check configuration`;
    }
  });

  // ── Reload buttons ──
  pane.querySelectorAll('.bdt-reload-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const domain = btn.dataset.domain;
      const status = btn.querySelector('.bdt-reload-status');
      btn.disabled = true;
      status.textContent = '…';
      status.className = 'bdt-reload-status bdt-loading';
      try {
        const data = await fetchWithAuth(API_BASE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reload_yaml', domain }),
        });
        status.textContent = data.success ? '✓' : '✗';
        status.className = `bdt-reload-status ${data.success ? 'bdt-ok' : 'bdt-err'}`;
        status.title = data.message || '';
      } catch (e) {
        status.textContent = '✗';
        status.className = 'bdt-reload-status bdt-err';
        status.title = e.message;
      } finally {
        btn.disabled = false;
        setTimeout(() => { status.textContent = ''; status.className = 'bdt-reload-status'; status.title = ''; }, 4000);
      }
    });
  });
}

// ── Draggable ─────────────────────────────────────────────────────────────────

function _makeDraggable(panel) {
  const header = panel.querySelector('.bdt-header');
  let startX, startY, origX, origY;
  header.addEventListener('mousedown', e => {
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
