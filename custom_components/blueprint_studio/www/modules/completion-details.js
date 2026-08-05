/** COMPLETION-DETAILS.JS | Stable documentation and target selection for active YAML context. */

import { HA_AREAS, HA_DEVICES, HA_ENTITIES, HA_FLOORS, HA_LABELS, HA_SERVICES, getYamlContext } from './ha-autocomplete.js?v=2.5.188';

const TARGETS = {
  entity_id: { label: 'Entity', source: 'Live Home Assistant entity registry', values: () => HA_ENTITIES.map(item => ({ id: item.entity_id, name: item.friendly_name })) },
  device_id: { label: 'Device', source: 'Live Home Assistant device registry', values: () => HA_DEVICES.map(item => ({ id: item.id, name: item.name || item.name_by_user })) },
  area_id: { label: 'Area', source: 'Live Home Assistant area registry', values: () => HA_AREAS.map(item => ({ id: item.id, name: item.name })) },
  label_id: { label: 'Label', source: 'Live Home Assistant label registry', values: () => HA_LABELS.map(item => ({ id: item.id, name: item.name })) },
  floor_id: { label: 'Floor', source: 'Live Home Assistant floor registry', values: () => HA_FLOORS.map(item => ({ id: item.id, name: item.name })) },
};

const SELECTOR_TARGETS = { entity: 'entity_id', device: 'device_id', area: 'area_id', label: 'label_id', floor: 'floor_id' };
const RESULT_LIMIT = 50;

function elements() {
  return {
    panel: document.getElementById('completion-details'),
    title: document.getElementById('completion-details-title'),
    source: document.getElementById('completion-details-source'),
    body: document.getElementById('completion-details-body'),
  };
}

function displayExample(field, selectorType) {
  const selectorConfig = selectorType && field.selector?.[selectorType];
  const candidate = field.example ?? field.default ?? selectorConfig?.example ?? selectorConfig?.default;
  if (candidate === undefined) {
    if (selectorType === 'boolean') return 'false';
    if (selectorType === 'number') return '0';
    if (selectorType === 'text') return 'example';
    if (selectorType === 'select') {
      const first = selectorConfig?.options?.[0];
      if (first !== undefined) return String(typeof first === 'object' ? first.value : first);
    }
    return '';
  }
  if (typeof candidate === 'string') return candidate;
  try { return JSON.stringify(candidate); } catch { return String(candidate); }
}

function replaceTargetValue(editor, lineNumber, key, value) {
  const line = editor.getLine(lineNumber) || '';
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = line.match(new RegExp(`^(\\s*(?:-\\s*)?${escapedKey}:\\s*)([^#]*?)(\\s*(?:#.*)?)$`));
  if (!match) return false;
  const start = match[1].length;
  const end = start + match[2].length;
  editor.replaceRange(value, { line: lineNumber, ch: start }, { line: lineNumber, ch: end }, 'target-picker');
  editor.setCursor({ line: lineNumber, ch: start + value.length });
  editor.focus();
  return true;
}

function appendTargetPicker(body, editor, lineNumber, key, target) {
  const values = target.values();
  const labelId = 'completion-target-search-label';
  const statusId = 'completion-target-status';
  const label = document.createElement('label');
  label.id = labelId;
  label.className = 'completion-target-label';
  label.textContent = `Search ${target.label.toLowerCase()} targets`;
  const search = document.createElement('input');
  search.className = 'ui-input completion-target-search';
  search.type = 'search';
  search.placeholder = `Name or ${target.label.toLowerCase()} ID`;
  search.setAttribute('aria-labelledby', labelId);
  search.setAttribute('aria-controls', 'completion-target-results');
  const status = document.createElement('span');
  status.id = statusId;
  status.className = 'completion-target-status';
  status.setAttribute('aria-live', 'polite');
  const results = document.createElement('div');
  results.id = 'completion-target-results';
  results.className = 'completion-target-results';
  results.setAttribute('role', 'group');
  results.setAttribute('aria-labelledby', labelId);

  const render = () => {
    const query = search.value.trim().toLowerCase();
    const matches = values.filter(item => !query || `${item.id} ${item.name || ''}`.toLowerCase().includes(query));
    const visible = matches.slice(0, RESULT_LIMIT);
    status.textContent = `${matches.length} match${matches.length === 1 ? '' : 'es'}${matches.length > RESULT_LIMIT ? `; showing first ${RESULT_LIMIT}` : ''}`;
    results.replaceChildren();
    visible.forEach(item => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'completion-target-option';
      const id = document.createElement('code');
      id.textContent = item.id;
      const name = document.createElement('span');
      name.textContent = item.name || `Unnamed ${target.label.toLowerCase()}`;
      option.append(id, name);
      option.addEventListener('click', () => replaceTargetValue(editor, lineNumber, key, item.id));
      results.append(option);
    });
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'completion-target-empty';
      empty.textContent = values.length ? 'No targets match this search.' : `No ${target.label.toLowerCase()} targets are available from this instance.`;
      results.append(empty);
    }
  };

  search.addEventListener('input', render);
  body.append(label, search, status, results);
  render();
}

function showDetails({ title, source, detail, required = false, selector = '', example = '', target = null, editor = null, lineNumber = 0, key = '' }) {
  const { panel, title: titleNode, source: sourceNode, body } = elements();
  if (!panel || !titleNode || !sourceNode || !body) return;
  titleNode.textContent = title;
  sourceNode.textContent = source;
  body.replaceChildren();
  const copy = document.createElement('p');
  copy.textContent = detail;
  body.append(copy);
  if (required || selector) {
    const metadata = document.createElement('p');
    metadata.className = 'completion-details-meta';
    metadata.textContent = `${required ? 'Required field' : 'Optional field'}${selector ? ` | ${selector} selector` : ''}`;
    body.append(metadata);
  }
  if (example) {
    const exampleNode = document.createElement('p');
    exampleNode.className = 'completion-details-example';
    const label = document.createElement('strong');
    label.textContent = 'Example: ';
    const value = document.createElement('code');
    value.textContent = example;
    exampleNode.append(label, value);
    body.append(exampleNode);
  }
  if (target && editor) appendTargetPicker(body, editor, lineNumber, key, target);
  panel.hidden = false;
}

export function updateCompletionDetails(editor) {
  if (!editor) return;
  const cursor = editor.getCursor();
  const line = editor.getLine(cursor.line) || '';
  const key = line.match(/^\s*(?:-\s*)?([a-zA-Z_][\w-]*):/)?.[1];
  if (!key) return;
  const context = getYamlContext(editor, cursor.line);
  const action = HA_SERVICES.find(service => service.service === context.actionService);
  const field = action?.fields?.[key];
  const selector = field?.selector && typeof field.selector === 'object' ? Object.keys(field.selector)[0] : '';
  const targetKey = TARGETS[key] ? key : SELECTOR_TARGETS[selector];
  const target = TARGETS[targetKey];
  if (target) {
    showDetails({
      title: `${target.label} target`,
      source: field ? `Installed action: ${action.service} | ${target.source}` : target.source,
      detail: field?.description || `${target.values().length} ${target.label.toLowerCase()} targets are available from the connected instance.`,
      required: Boolean(field?.required),
      selector: selector || target.label.toLowerCase(),
      example: displayExample(field || {}, selector) || target.values()[0]?.id || '',
      target,
      editor,
      lineNumber: cursor.line,
      key,
    });
    return;
  }
  if (field) {
    showDetails({
      title: key,
      source: `Installed action: ${action.service}`,
      detail: field.description || action.description || 'Action field provided by the connected Home Assistant instance.',
      required: Boolean(field.required),
      selector,
      example: displayExample(field, selector),
    });
    return;
  }
  if (key === 'selector') showDetails({ title: 'Blueprint selector', source: 'Blueprint schema', detail: 'Choose a selector type to control how Blueprint users supply this input.' });
}

export function initCompletionDetails() {
  const { panel } = elements();
  if (!panel || panel.dataset.initialized) return;
  panel.dataset.initialized = 'true';
  document.getElementById('btn-close-completion-details')?.addEventListener('click', () => { panel.hidden = true; });
}
