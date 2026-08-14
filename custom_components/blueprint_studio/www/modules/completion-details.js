/** COMPLETION-DETAILS.JS | Stable documentation and target selection for active YAML context. */

import { HA_AREAS, HA_DEVICES, HA_ENTITIES, HA_FLOORS, HA_LABELS, HA_SERVICES, getYamlContext } from './ha-autocomplete.js';
import { t, tp } from './translations.js';

const TARGETS = {
  entity_id: { labelKey: 'entity', sourceKey: 'entity_registry', values: () => HA_ENTITIES.map(item => ({ id: item.entity_id, name: item.friendly_name })) },
  device_id: { labelKey: 'device', sourceKey: 'device_registry', values: () => HA_DEVICES.map(item => ({ id: item.id, name: item.name || item.name_by_user })) },
  area_id: { labelKey: 'area', sourceKey: 'area_registry', values: () => HA_AREAS.map(item => ({ id: item.id, name: item.name })) },
  label_id: { labelKey: 'label', sourceKey: 'label_registry', values: () => HA_LABELS.map(item => ({ id: item.id, name: item.name })) },
  floor_id: { labelKey: 'floor', sourceKey: 'floor_registry', values: () => HA_FLOORS.map(item => ({ id: item.id, name: item.name })) },
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

function targetLabel(target) { return t(`completion.${target.labelKey}`); }
function targetSource(target) { return t(`completion.${target.sourceKey}`); }

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
  const labelText = targetLabel(target);
  label.textContent = t('completion.search_targets', { target: labelText.toLowerCase() });
  const search = document.createElement('input');
  search.className = 'ui-input completion-target-search';
  search.type = 'search';
  search.placeholder = t('completion.search_placeholder', { target: labelText.toLowerCase() });
  search.setAttribute('aria-labelledby', labelId);
  search.setAttribute('aria-controls', 'completion-target-results');
  search.setAttribute('role', 'combobox');
  search.setAttribute('aria-autocomplete', 'list');
  search.setAttribute('aria-expanded', 'true');
  const status = document.createElement('span');
  status.id = statusId;
  status.className = 'completion-target-status';
  status.setAttribute('aria-live', 'polite');
  const results = document.createElement('div');
  results.id = 'completion-target-results';
  results.className = 'completion-target-results';
  results.setAttribute('role', 'listbox');
  results.setAttribute('aria-orientation', 'vertical');
  results.setAttribute('aria-labelledby', labelId);
  let activeIndex = -1;

  const options = () => [...results.querySelectorAll('.completion-target-option')];
  const setActiveOption = (index, { scroll = true } = {}) => {
    const available = options();
    if (!available.length) {
      activeIndex = -1;
      search.removeAttribute('aria-activedescendant');
      return;
    }
    activeIndex = Math.max(0, Math.min(index, available.length - 1));
    available.forEach((option, optionIndex) => {
      const selected = optionIndex === activeIndex;
      option.setAttribute('aria-selected', String(selected));
      option.classList.toggle('completion-target-option--active', selected);
    });
    search.setAttribute('aria-activedescendant', available[activeIndex].id);
    if (scroll) available[activeIndex].scrollIntoView({ block: 'nearest' });
  };

  const render = () => {
    const query = search.value.trim().toLowerCase();
    const matches = values.filter(item => !query || `${item.id} ${item.name || ''}`.toLowerCase().includes(query));
    const visible = matches.slice(0, RESULT_LIMIT);
    status.textContent = tp('search.matches_found', matches.length) + (matches.length > RESULT_LIMIT ? `; ${t('completion.showing_first', { count: RESULT_LIMIT })}` : '');
    results.replaceChildren();
    visible.forEach((item, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'completion-target-option';
      option.id = `completion-target-option-${index}`;
      option.tabIndex = -1;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      const id = document.createElement('code');
      id.textContent = item.id;
      const name = document.createElement('span');
      name.textContent = item.name || t('completion.unnamed_target', { target: labelText.toLowerCase() });
      option.append(id, name);
      option.addEventListener('click', () => replaceTargetValue(editor, lineNumber, key, item.id));
      results.append(option);
    });
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'completion-target-empty';
      empty.textContent = values.length ? t('completion.no_matches') : t('completion.no_targets', { target: labelText.toLowerCase() });
      results.append(empty);
    }
    activeIndex = -1;
    search.removeAttribute('aria-activedescendant');
  };

  search.addEventListener('input', render);
  search.addEventListener('keydown', (event) => {
    const available = options();
    if (!available.length) return;
    if (event.key === 'ArrowDown') setActiveOption(activeIndex < 0 ? 0 : (activeIndex + 1) % available.length);
    else if (event.key === 'ArrowUp') setActiveOption(activeIndex < 0 ? available.length - 1 : (activeIndex - 1 + available.length) % available.length);
    else if (event.key === 'Home') setActiveOption(0);
    else if (event.key === 'End') setActiveOption(available.length - 1);
    else if (event.key === 'Enter' && activeIndex >= 0) available[activeIndex].click();
    else if (event.key === 'Escape' && activeIndex >= 0) {
      activeIndex = -1;
      available.forEach(option => {
        option.setAttribute('aria-selected', 'false');
        option.classList.remove('completion-target-option--active');
      });
      search.removeAttribute('aria-activedescendant');
    } else return;
    event.preventDefault();
  });
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
    metadata.textContent = `${required ? t('completion.required') : t('completion.optional')}${selector ? ` | ${t('completion.selector', { selector })}` : ''}`;
    body.append(metadata);
  }
  if (example) {
    const exampleNode = document.createElement('p');
    exampleNode.className = 'completion-details-example';
    const label = document.createElement('strong');
    label.textContent = `${t('completion.example')}: `;
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
      title: t('completion.target_title', { target: targetLabel(target) }),
      source: field ? `${t('completion.installed_action')}: ${action.service} | ${targetSource(target)}` : targetSource(target),
      detail: field?.description || t('completion.available_targets', { count: target.values().length, target: targetLabel(target).toLowerCase() }),
      required: Boolean(field?.required),
      selector: selector || targetLabel(target).toLowerCase(),
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
      source: `${t('completion.installed_action')}: ${action.service}`,
      detail: field.description || action.description || t('completion.action_field_detail'),
      required: Boolean(field.required),
      selector,
      example: displayExample(field, selector),
    });
    return;
  }
  if (key === 'selector') showDetails({ title: t('completion.blueprint_selector'), source: t('completion.blueprint_schema'), detail: t('completion.selector_detail') });
}

export function initCompletionDetails() {
  const { panel } = elements();
  if (!panel || panel.dataset.initialized) return;
  panel.dataset.initialized = 'true';
  document.getElementById('btn-close-completion-details')?.addEventListener('click', () => { panel.hidden = true; });
}
