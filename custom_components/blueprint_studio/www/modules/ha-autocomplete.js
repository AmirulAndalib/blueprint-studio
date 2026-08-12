/** HA-AUTOCOMPLETE.JS | Purpose: Home Assistant entity autocomplete and YAML schema hints. */
import { API_BASE, HA_SCHEMA } from './constants.js?v=2.5.270';
import { fetchWithAuth } from './api.js';
import { BLUEPRINT_DOMAINS, getEditorYamlContext } from './yaml-context.js?v=2.5.270';

export let HA_ENTITIES = [];
export let HA_SERVICES = [];
export let HA_DEVICES = [];
export let HA_AREAS = [];
export let HA_LABELS = [];
export let HA_FLOORS = [];
export let HA_ADDONS = [];
export let HA_METADATA = null;
export let HA_AUTOCOMPLETE_ERROR = null;
let metadataRequest = null;
const DEVICE_AUTOMATIONS = new Map();
const DEVICE_AUTOMATION_REQUESTS = new Map();
const RECENT_ACTIONS = [];
const MAX_RECENT_ACTIONS = 12;

export async function loadMetadata({ force = false } = {}) {
  if (metadataRequest && !force) return metadataRequest;
  metadataRequest = Promise.all([
    fetchWithAuth(`${API_BASE}?action=get_metadata`, { method: "GET" }),
    fetchWithAuth(`${API_BASE}?action=get_addons`, { method: "GET" }).catch(() => ({ addons: [] })),
  ]).then(([data, addonData]) => {
      HA_METADATA = data;
      HA_ENTITIES = Array.isArray(data.entities) ? data.entities : [];
      HA_SERVICES = Array.isArray(data.actions) ? data.actions : [];
      HA_DEVICES = Array.isArray(data.devices) ? data.devices : [];
      HA_AREAS = Array.isArray(data.areas) ? data.areas : [];
      HA_LABELS = Array.isArray(data.labels) ? data.labels : [];
      HA_FLOORS = Array.isArray(data.floors) ? data.floors : [];
      HA_ADDONS = Array.isArray(addonData.addons) ? addonData.addons : [];
      const failed = Object.keys(data.failures || {});
      HA_AUTOCOMPLETE_ERROR = failed.length ? `Some Home Assistant metadata is unavailable: ${failed.join(", ")}` : null;
      if (HA_AUTOCOMPLETE_ERROR) console.warn(HA_AUTOCOMPLETE_ERROR);
      return data;
    })
    .catch(error => {
      HA_AUTOCOMPLETE_ERROR = "Home Assistant metadata is unavailable; static YAML suggestions remain available";
      console.warn("Failed to load Home Assistant metadata", error);
      throw error;
    })
    .finally(() => { metadataRequest = null; });
  return metadataRequest;
}

export async function loadEntities() {
  try {
    await loadMetadata();
  } catch (e) {
    HA_AUTOCOMPLETE_ERROR = "Entity autocomplete is unavailable";
    console.warn("Failed to load entities for autocomplete", e);
  }
}

export async function loadServices() {
  try {
    await loadMetadata();
  } catch (e) {
    HA_AUTOCOMPLETE_ERROR = "Action autocomplete is unavailable";
    console.warn("Failed to load actions for autocomplete", e);
  }
}

export async function loadRegistries() {
  try {
    await loadMetadata();
  } catch (_error) {
    // loadMetadata records a visible degraded state while static hints remain usable.
  }
}

async function loadDeviceAutomations(deviceId) {
  if (!deviceId || DEVICE_AUTOMATIONS.has(deviceId)) return DEVICE_AUTOMATIONS.get(deviceId);
  if (DEVICE_AUTOMATION_REQUESTS.has(deviceId)) return DEVICE_AUTOMATION_REQUESTS.get(deviceId);
  const request = fetchWithAuth(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "get_device_automations", device_id: deviceId }),
  }).then(data => {
    const automations = data.automations || { trigger: [], condition: [], action: [] };
    DEVICE_AUTOMATIONS.set(deviceId, automations);
    return automations;
  }).catch(error => {
    console.warn(`Failed to load device automations for ${deviceId}`, error);
    return null;
  }).finally(() => DEVICE_AUTOMATION_REQUESTS.delete(deviceId));
  DEVICE_AUTOMATION_REQUESTS.set(deviceId, request);
  return request;
}

function appendHintContent(elem, { iconClass, iconText, text, type, description }) {
  const row = document.createElement("div");
  row.className = "ha-hint-row";
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.width = "100%";

  if (iconClass || iconText) {
    const icon = document.createElement("span");
    icon.className = iconClass || "ui-icon material-icons";
    icon.textContent = iconText || "";
    icon.style.marginRight = "6px";
    row.appendChild(icon);
  }

  const value = document.createElement("span");
  value.textContent = text;
  row.appendChild(value);

  if (type) {
    const kind = document.createElement("span");
    kind.className = "ha-hint-type";
    kind.textContent = type;
    row.appendChild(kind);
  }
  if (description) {
    const detail = document.createElement("span");
    detail.className = "ha-hint-description";
    detail.textContent = description;
    row.appendChild(detail);
  }
  elem.replaceChildren(row);
}

function decorateCompletionMenu() {
  if (typeof document === 'undefined') return;
  const menu = document.querySelector('.CodeMirror-hints:not([data-ha-accessible])');
  if (!menu) return;
  menu.dataset.haAccessible = 'true';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'YAML completions');
  const update = () => {
    let activeOption = null;
    menu.querySelectorAll('li').forEach((item, index) => {
      const selected = item.classList.contains('CodeMirror-hint-active');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(selected));
      if (!item.id) item.id = `ha-completion-${index}`;
      if (selected) activeOption = item;
    });
    if (activeOption) menu.setAttribute('aria-activedescendant', activeOption.id);
    else menu.removeAttribute('aria-activedescendant');
  };
  update();
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(update).observe(menu, { attributes: true, attributeFilter: ['class'], subtree: true, childList: true });
  }
}

export function metadataCompletionState(now = Date.now()) {
  if (metadataRequest) return { type: 'loading', label: 'Loading installed Home Assistant metadata' };
  if (HA_AUTOCOMPLETE_ERROR) return { type: 'unavailable', label: HA_AUTOCOMPLETE_ERROR };
  if (!HA_METADATA) return { type: 'loading', label: 'Loading installed Home Assistant metadata' };
  const generatedAt = Number(HA_METADATA.generated_at || 0) * 1000;
  if (generatedAt && now - generatedAt > 120_000) return { type: 'stale', label: 'Using cached Home Assistant metadata while it refreshes' };
  if (!HA_SERVICES.length) return { type: 'empty', label: 'No installed actions were reported by Home Assistant' };
  return { type: 'ready', label: '' };
}

function statusCompletion(state, cursor) {
  return {
    list: [{
      text: '', displayText: state.label, className: `ha-hint-${state.type}`,
      render: elem => appendHintContent(elem, { text: state.label, type: state.type }),
      hint: () => {},
    }],
    from: CodeMirror.Pos(cursor.line, cursor.ch),
    to: CodeMirror.Pos(cursor.line, cursor.ch),
  };
}

export function getCompletionPrefix(line, cursorCh) {
  const beforeCursor = line.slice(0, cursorCh);
  const match = beforeCursor.match(/[!a-zA-Z0-9_-]+$/);
  const text = match ? match[0] : "";
  return { text, start: cursorCh - text.length };
}

export function filterSchemaSuggestions(suggestions, query) {
  const normalizedQuery = query.trim().toLowerCase();
  const seen = new Set();
  return suggestions.filter(item => {
    const normalizedText = item.text.toLowerCase();
    if (normalizedQuery && !normalizedText.startsWith(normalizedQuery)) return false;
    if (seen.has(normalizedText)) return false;
    seen.add(normalizedText);
    return true;
  });
}

function fuzzyScore(value, query) {
  if (!query) return 1;
  let queryIndex = 0;
  let gap = 0;
  for (let valueIndex = 0; valueIndex < value.length && queryIndex < query.length; valueIndex += 1) {
    if (value[valueIndex] === query[queryIndex]) queryIndex += 1;
    else if (queryIndex > 0) gap += 1;
  }
  return queryIndex === query.length ? Math.max(1, 40 - gap) : 0;
}

export function rankActionSuggestions(actions, query, { recent = [], preferredDomain = '' } = {}) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const recentRanks = new Map(recent.map((action, index) => [action, recent.length - index]));
  return actions.map(action => {
    const id = String(action.service || action.id || '').toLowerCase();
    const domain = String(action.domain || id.split('.')[0]);
    const name = String(action.name || '').toLowerCase();
    let score = fuzzyScore(id, normalizedQuery) || fuzzyScore(name, normalizedQuery);
    if (normalizedQuery && id === normalizedQuery) score += 1000;
    else if (normalizedQuery && id.startsWith(normalizedQuery)) score += 500;
    else if (normalizedQuery && id.split('.')[1]?.startsWith(normalizedQuery)) score += 260;
    if (preferredDomain && domain === preferredDomain) score += 90;
    score += (recentRanks.get(action.service || action.id) || 0) * 8;
    return { action, score };
  }).filter(item => !normalizedQuery || item.score > 0)
    .sort((left, right) => right.score - left.score || String(left.action.service).localeCompare(String(right.action.service)))
    .map(item => item.action);
}

function rememberAction(action) {
  const index = RECENT_ACTIONS.indexOf(action);
  if (index >= 0) RECENT_ACTIONS.splice(index, 1);
  RECENT_ACTIONS.unshift(action);
  RECENT_ACTIONS.splice(MAX_RECENT_ACTIONS);
}

function selectorType(selector) {
  if (!selector || typeof selector !== "object") return null;
  return Object.keys(selector)[0] || null;
}

function selectorDomains(config, action) {
  const domains = [];
  const add = value => {
    if (Array.isArray(value)) value.forEach(add);
    else if (typeof value === 'string') domains.push(value);
    else if (value && typeof value === 'object') add(value.domain);
  };
  add(config?.domain);
  add(config?.filter);
  add(action?.target?.entity);
  return new Set(domains);
}

function scalarCandidate(value, description, type) {
  if (value === undefined || value === null || typeof value === 'object') return null;
  return { value: String(value), description, type };
}

export function selectorValueCandidates(type, config = {}, field = {}, registries = {}, action = null) {
  const entities = registries.entities || [];
  const domains = selectorDomains(config, action);
  if (type === 'entity') return entities
    .filter(entity => !domains.size || domains.has(entity.domain || String(entity.entity_id).split('.')[0]))
    .map(entity => ({ value: entity.entity_id, description: entity.friendly_name || entity.name, type }));
  if (type === 'device') return (registries.devices || []).map(device => ({ value: device.id, description: device.name, type }));
  if (type === 'area') return (registries.areas || []).map(area => ({ value: area.id, description: area.name, type }));
  if (type === 'label') return (registries.labels || []).map(label => ({ value: label.id, description: label.name, type }));
  if (type === 'floor') return (registries.floors || []).map(floor => ({ value: floor.id, description: floor.name, type }));
  if (type === 'app' || type === 'addon') return (registries.addons || []).map(addon => ({ value: addon.slug, description: addon.name, type: 'app' }));
  if (type === 'target') return entities
    .filter(entity => !domains.size || domains.has(entity.domain || String(entity.entity_id).split('.')[0]))
    .map(entity => ({ value: entity.entity_id, description: entity.friendly_name || entity.name, type: 'entity' }));
  if (type === 'select' && Array.isArray(config?.options)) return config.options.map(option => ({
    value: typeof option === 'object' ? option.value : option,
    description: typeof option === 'object' ? option.label : field.description,
    type: 'option',
  }));
  if (type === 'boolean') return [true, false].map(value => ({ value: String(value), description: field.description, type }));

  const candidates = [field.example, field.default, config.example, config.default];
  if (type === 'number' || type === 'color_temp') candidates.push(config.min, config.max, config.step);
  if (type === 'date') candidates.push('2026-01-01');
  if (type === 'time') candidates.push('08:00:00');
  if (type === 'datetime') candidates.push('2026-01-01 08:00:00');
  if (type === 'duration') candidates.push('00:05:00');
  if (type === 'color_rgb') candidates.push('[255, 255, 255]');
  return candidates.map(value => scalarCandidate(value, field.description, type)).filter(Boolean);
}

export function liveValueItems(key, query, context) {
  let items = [];
  if (key === 'domain' && context.inBlueprint && context.blueprintSection === 'metadata') {
    items = BLUEPRINT_DOMAINS.map(value => ({ value, description: 'Supported Blueprint domain', type: 'domain' }));
  } else if (key === "entity_id") {
    items = HA_ENTITIES.map(entity => ({ value: entity.entity_id, description: entity.friendly_name, type: "entity" }));
  } else if (key === "device_id") {
    items = HA_DEVICES.map(device => ({ value: device.id, description: device.name, type: "device" }));
  } else if (key === "area_id") {
    items = HA_AREAS.map(area => ({ value: area.id, description: area.name, type: "area" }));
  } else if (key === "label_id") {
    items = HA_LABELS.map(label => ({ value: label.id, description: label.name, type: "label" }));
  } else if (key === "floor_id") {
    items = HA_FLOORS.map(floor => ({ value: floor.id, description: floor.name, type: "floor" }));
  } else if (key === "state") {
    const states = new Set(HA_ENTITIES.map(entity => entity.state).filter(Boolean));
    items = [...states].map(state => ({ value: state, description: "Live entity state", type: "state" }));
  }

  const action = HA_SERVICES.find(service => service.service === context.actionService);
  const field = action?.fields?.[key];
  if (field) {
    const type = selectorType(field.selector);
    const config = type ? field.selector[type] : null;
    items = selectorValueCandidates(type, config, field, {
      entities: HA_ENTITIES, devices: HA_DEVICES, areas: HA_AREAS,
      labels: HA_LABELS, floors: HA_FLOORS, addons: HA_ADDONS,
    }, action);
  } else if (action && key === 'entity_id') {
    items = selectorValueCandidates('entity', {}, {}, { entities: HA_ENTITIES }, action);
  }

  if (context.deviceId) {
    const kind = context.inTrigger ? "trigger" : context.inCondition ? "condition" : "action";
    const automations = DEVICE_AUTOMATIONS.get(context.deviceId)?.[kind] || [];
    const deviceValues = automations
      .map(automation => automation[key])
      .filter(value => ["string", "number", "boolean"].includes(typeof value))
      .map(value => ({ value: String(value), description: "Provided by device integration", type: `device ${kind}` }));
    if (deviceValues.length) items = [...items, ...deviceValues];
  }

  const normalized = query.toLowerCase();
  return items
    .filter(item => String(item.value).toLowerCase().includes(normalized) || String(item.description || "").toLowerCase().includes(normalized))
    .sort((a, b) => {
      const aStarts = String(a.value).toLowerCase().startsWith(normalized);
      const bStarts = String(b.value).toLowerCase().startsWith(normalized);
      return aStarts === bStarts ? String(a.value).localeCompare(String(b.value)) : (aStarts ? -1 : 1);
    })
    .slice(0, 50);
}

/**
 * Home Assistant Autocomplete Function for CodeMirror
 */
export function homeAssistantHint(editor, options) {
  const cursor = editor.getCursor();
  const currentLine = editor.getLine(cursor.line);
  const prefix = getCompletionPrefix(currentLine, cursor.ch);
  const start = prefix.start;
  const end = cursor.ch;
  const currentWord = prefix.text;
  if (typeof setTimeout === 'function') setTimeout(decorateCompletionMenu, 0);

  // Determine context from previous lines and indentation
  const context = getYamlContext(editor, cursor.line);
  if (context.deviceId && !DEVICE_AUTOMATIONS.has(context.deviceId)) {
    void loadDeviceAutomations(context.deviceId);
  }

  let suggestions = [];
  const lineText = currentLine.slice(0, cursor.ch);

  const directValueMatch = lineText.match(/^\s*(?:-\s*)?([a-zA-Z_][\w-]*):\s*([^#]*)$/);
  const listValueMatch = !directValueMatch && context.path.length
    ? lineText.match(/^\s*-\s*([^#]*)$/)
    : null;
  const valueMatch = directValueMatch || (listValueMatch ? [listValueMatch[0], context.path.at(-1), listValueMatch[1]] : null);
  if (valueMatch && !["action", "service"].includes(valueMatch[1])) {
    const key = valueMatch[1];
    const rawQuery = valueMatch[2];
    const query = rawQuery.trimStart().replace(/^['"]/, "");
    const valueStart = cursor.ch - rawQuery.length + (rawQuery.length - rawQuery.trimStart().length) + (rawQuery.trimStart().startsWith("\"") || rawQuery.trimStart().startsWith("'") ? 1 : 0);
    const values = liveValueItems(key, query, context);
    if (values.length) {
      return {
        list: values.map(item => ({
          text: String(item.value),
          displayText: String(item.value),
          className: `ha-hint-${item.type}`,
          render: elem => appendHintContent(elem, { text: String(item.value), type: item.type, description: item.description }),
          hint: cm => cm.replaceRange(String(item.value), { line: cursor.line, ch: valueStart }, { line: cursor.line, ch: end }),
        })),
        from: CodeMirror.Pos(cursor.line, valueStart),
        to: CodeMirror.Pos(cursor.line, end),
      };
    }
  }

  // Entity autocompletion (e.g. light.kitchen) — skip on action:/service: lines
  const isServiceLine = /^\s*(action|service)\s*:\s*/.test(currentLine);
  const entityMatch = !isServiceLine && lineText.match(/([a-z0-9_]+)\.([a-z0-9_]*)$/);

  if (entityMatch) {
    const fullMatch = entityMatch[0];
    const matchStart = cursor.ch - fullMatch.length;
    const matchedEntities = HA_ENTITIES.filter(e => e.entity_id.startsWith(fullMatch));

    if (matchedEntities.length > 0) {
        suggestions = matchedEntities.map(e => ({
            text: e.entity_id,
            displayText: e.entity_id,
            className: 'ha-hint-entity',
            render: (elem, self, data) => {
                const iconName = e.icon && /^mdi:[a-z0-9-]+$/.test(e.icon) ? e.icon.slice(4) : 'help-circle';
                appendHintContent(elem, {
                  iconClass: `mdi mdi-${iconName}`,
                  text: data.text,
                  description: e.friendly_name || "",
                });
            },
            hint: (cm, self, data) => {
                cm.replaceRange(data.text, { line: cursor.line, ch: matchStart }, { line: cursor.line, ch: end });
            }
        }));

        return {
            list: suggestions,
            from: CodeMirror.Pos(cursor.line, matchStart),
            to: CodeMirror.Pos(cursor.line, end)
        };
    }
  }

  if (isServiceLine && HA_SERVICES.length === 0) {
    return statusCompletion(metadataCompletionState(), cursor);
  }

  // Service autocompletion — triggered when the line is an action:/service: key
  if (isServiceLine && HA_SERVICES.length > 0) {
    // The typed word starts after the colon
    const afterColon = lineText.replace(/^\s*(action|service)\s*:\s*/, '');
    const serviceQuery = afterColon.trimStart();
    const serviceStart = cursor.ch - afterColon.length;
    const preferredDomain = serviceQuery.includes('.') ? serviceQuery.split('.')[0] : '';
    const matchedServices = rankActionSuggestions(HA_SERVICES, serviceQuery, {
      recent: RECENT_ACTIONS,
      preferredDomain,
    }).slice(0, 30);
    if (matchedServices.length > 0) {
      const actionHints = matchedServices.map(s => ({
        text: s.service,
        displayText: s.service,
        className: 'ha-hint-service',
        render: elem => appendHintContent(elem, { iconText: "play_circle", text: s.service, description: s.description }),
        hint: cm => {
          rememberAction(s.service);
          cm.replaceRange(s.service, { line: cursor.line, ch: serviceStart }, { line: cursor.line, ch: end });
        },
      }));
      const metadataState = metadataCompletionState();
      if (metadataState.type !== 'ready') actionHints.push({
        text: '', displayText: metadataState.label, className: `ha-hint-${metadataState.type}`,
        render: elem => appendHintContent(elem, { text: metadataState.label, type: metadataState.type }),
        hint: () => {},
      });
      return {
        list: actionHints,
        from: CodeMirror.Pos(cursor.line, serviceStart),
        to: CodeMirror.Pos(cursor.line, end)
      };
    }
  }

  const trimmedLine = currentLine.trimStart();
  const isLineStart = currentLine.substring(0, cursor.ch).trim() === currentWord.trim();

  const cursorIndex = typeof editor.indexFromPos === 'function' ? editor.indexFromPos(cursor) : null;
  const beforeCursor = cursorIndex === null ? lineText : editor.getValue().slice(0, cursorIndex);
  const openExpression = beforeCursor.lastIndexOf('{{') > beforeCursor.lastIndexOf('}}');
  const openStatement = beforeCursor.lastIndexOf('{%') > beforeCursor.lastIndexOf('%}');
  if ((openExpression || openStatement) && currentWord && !currentWord.includes('!')) {
    const jinjaSuggestions = HA_SCHEMA.jinjaNames.filter(item => item.text.startsWith(currentWord.toLowerCase()));
    if (jinjaSuggestions.length) {
      return {
        list: jinjaSuggestions.map(item => ({
          ...item,
          displayText: item.text,
          className: 'ha-hint-template',
          render: (elem, self, data) => appendHintContent(elem, data),
          hint: cm => cm.replaceRange(item.text, { line: cursor.line, ch: start }, { line: cursor.line, ch: end }),
        })),
        from: CodeMirror.Pos(cursor.line, start),
        to: CodeMirror.Pos(cursor.line, end),
      };
    }
  }

  if (context.inBlueprint && lineText.match(/!input\s+[\w-]*$/)) {
      const inputMatch = lineText.match(/!input\s+([\w-]*)$/);
      const inputPrefix = inputMatch ? inputMatch[1] : '';
      const inputMatchStart = cursor.ch - inputPrefix.length;
      if (context.blueprintInputNames.length > 0) {
        const filtered = context.blueprintInputNames.filter(name => name.startsWith(inputPrefix));
        if (filtered.length > 0) {
          return {
            list: filtered.map(name => ({
              text: name,
              displayText: name,
              className: 'ha-hint-tag',
              render: elem => appendHintContent(elem, { text: name, type: '!input', description: 'Blueprint input' }),
              hint: (cm) => { cm.replaceRange(name, { line: cursor.line, ch: inputMatchStart }, { line: cursor.line, ch: end }); }
            })),
            from: CodeMirror.Pos(cursor.line, inputMatchStart),
            to: CodeMirror.Pos(cursor.line, end)
          };
        }
      }
  }

  if (currentWord.startsWith('!') || (isLineStart && currentWord === '!')) {
    suggestions = HA_SCHEMA.yamlTags.map(item => ({
      text: item.text,
      displayText: item.text,
      className: 'ha-hint-tag',
      render: (elem, self, data) => appendHintContent(elem, data),
      hint: (cm, self, data) => {
        cm.replaceRange(data.text, { line: cursor.line, ch: start }, { line: cursor.line, ch: end });
      },
      ...item
    }));
  }

  const snipMatch = lineText.match(/(snip:[a-z0-9_]*|sni?p?:?)$/i);
  if (snipMatch) {
    const snipQuery = snipMatch[0].toLowerCase();
    const snipStart = cursor.ch - snipQuery.length;
    const snipMatches = HA_SCHEMA.snippets.filter(s => s.text.startsWith(snipQuery) || snipQuery.startsWith(s.text.split(':')[0]));
    
    if (snipMatches.length > 0) {
        suggestions = snipMatches.map(item => ({
          text: item.text,
          displayText: item.label,
          className: 'ha-hint-snippet',
          render: (elem, self, data) => {
            elem.innerHTML = `
              <div style="display: flex; align-items: center; width: 100%;">
                  <span class="ui-icon material-icons ha-hint-snippet-icon">auto_fix_high</span>
                  <span>${data.displayText}</span>
                  <span class="ha-hint-type" style="margin-left: auto;">${item.type}</span>
              </div>
            `;
          },
          hint: (cm, self, data) => {
            const indent = currentLine.match(/^\s*/)[0];
            const indentedContent = item.content.split('\n').map((line, i) => i === 0 ? line : indent + line).join('\n');
            cm.replaceRange(indentedContent, { line: cursor.line, ch: snipStart }, { line: cursor.line, ch: end });
          }
        }));
        
        return {
            list: suggestions,
            from: CodeMirror.Pos(cursor.line, snipStart),
            to: CodeMirror.Pos(cursor.line, end)
        };
    }
  }

  const automationDocument = context.section === 'automation' || (
    context.inBlueprint && context.blueprintDomain === 'automation' && context.blueprintSection === 'body'
  );

  if (suggestions.length === 0 && context.indent === 0 && isLineStart && !['automation-list', 'script-map', 'blueprint'].includes(context.fileRole)) {
    suggestions = HA_SCHEMA.configuration.map(item => ({
      text: item.text,
      displayText: item.text,
      className: 'ha-hint-domain',
      render: (elem, self, data) => appendHintContent(elem, data),
      hint: (cm, self, data) => {
        cm.replaceRange(data.text, { line: cursor.line, ch: start }, { line: cursor.line, ch: end });
      },
      ...item
    }));
  }
  else if (context.inBlueprint && context.inSelector) {
    const selectorIndex = context.path.lastIndexOf('selector');
    const hasSelectorType = context.path.length > selectorIndex + 1;
    suggestions = (hasSelectorType ? HA_SCHEMA.blueprintSelectorKeys : HA_SCHEMA.blueprintSelectors).map(item => ({
      text: item.text,
      displayText: item.text,
      className: 'ha-hint-key',
      render: (elem, self, data) => appendHintContent(elem, data),
      hint: (cm, self, data) => {
        cm.replaceRange(data.text, { line: cursor.line, ch: start }, { line: cursor.line, ch: end });
      },
      ...item
    }));
  }
  else if (context.inBlueprint && context.blueprintSection === 'input-section') {
    suggestions = HA_SCHEMA.blueprintInputSectionKeys.map(item => ({
      ...item,
      displayText: item.text,
      className: 'ha-hint-key',
      render: (elem, self, data) => appendHintContent(elem, data),
      hint: cm => cm.replaceRange(item.text, { line: cursor.line, ch: start }, { line: cursor.line, ch: end }),
    }));
  }
  else if (context.inBlueprint && context.blueprintSection === 'input') {
    suggestions = HA_SCHEMA.blueprintInputKeys.map(item => ({
      ...item,
      displayText: item.text,
      className: 'ha-hint-key',
      render: (elem, self, data) => appendHintContent(elem, data),
      hint: cm => cm.replaceRange(item.text, { line: cursor.line, ch: start }, { line: cursor.line, ch: end }),
    }));
  }
  else if (context.inBlueprint && !context.inTrigger && !context.inCondition && !context.inAction) {
    // Inside a blueprint file — suggest blueprint keys + automation keys
    suggestions = [
      ...HA_SCHEMA.blueprintKeys,
      ...(context.blueprintSection === 'body' && context.blueprintDomain === 'script' ? HA_SCHEMA.script : []),
      ...(context.blueprintSection === 'body' && context.blueprintDomain === 'automation'
        ? [...HA_SCHEMA.automation, ...(context.legacySyntax ? HA_SCHEMA.automationLegacy : [])]
        : []),
    ].map(item => ({
      text: item.text,
      displayText: item.text,
      className: `ha-hint-${item.type}`,
      render: (elem, self, data) => appendHintContent(elem, data),
      hint: (cm, self, data) => {
        cm.replaceRange(data.text, { line: cursor.line, ch: start }, { line: cursor.line, ch: end });
      },
      ...item
    }));
  }
  else if (
    automationDocument ||
    context.section === 'script' ||
    context.inTrigger ||
    context.inCondition ||
    context.inAction
  ) {
    if (context.inTrigger) {
      suggestions = context.atSequenceItem
        ? HA_SCHEMA.triggers.filter(item => context.legacySyntax || !item.text.startsWith('platform:'))
        : HA_SCHEMA.triggerKeys;
    } else if (context.inCondition) {
      suggestions = context.atSequenceItem ? HA_SCHEMA.conditions : HA_SCHEMA.conditionKeys;
    } else if (context.inAction) {
      const selectedAction = HA_SERVICES.find(service => service.service === context.actionService);
      const liveFields = selectedAction
        ? Object.entries(selectedAction.fields || {}).map(([name, field]) => ({
            text: `${name}:`,
            type: field.required ? "required field" : "field",
            description: field.description || selectedAction.name || "Action field",
          }))
        : [];
      const underActionData = ['data', 'data_template'].includes(context.path.at(-1));
      const underTarget = context.path.at(-1) === 'target';
      const supportedTargetKeys = selectedAction?.supports_target
        ? HA_SCHEMA.actionKeys.filter(item => ['entity_id:', 'device_id:', 'area_id:', 'floor_id:', 'label_id:'].includes(item.text))
        : [];
      const actionKeys = HA_SCHEMA.actionKeys.filter(item => (
        context.legacySyntax || !['service:', 'data_template:', 'event_data_template:'].includes(item.text)
      ));
      suggestions = underActionData
        ? liveFields
        : underTarget
          ? supportedTargetKeys
          : context.atSequenceItem
            ? actionKeys.filter(item => ['action:', 'delay:', 'wait_template:', 'wait_for_trigger:', 'choose:', 'repeat:', 'if:', 'parallel:', 'variables:', 'event:', 'scene:', 'stop:'].includes(item.text))
            : actionKeys;
    } else {
      suggestions = context.section === 'script'
        ? HA_SCHEMA.script
        : [...HA_SCHEMA.automation, ...(context.legacySyntax ? HA_SCHEMA.automationLegacy : [])];
    }

    suggestions = suggestions.map(item => ({
      text: item.text,
      displayText: item.text,
      className: `ha-hint-${item.type}`,
      render: (elem, self, data) => appendHintContent(elem, data),
      hint: (cm, self, data) => {
        cm.replaceRange(data.text, { line: cursor.line, ch: start }, { line: cursor.line, ch: end });
      },
      ...item
    }));
  }
  else if (context.section === 'sensor' || context.section === 'binary_sensor') {
    if (context.inPlatform) {
      suggestions = HA_SCHEMA.sensorPlatforms;
    } else {
      suggestions = HA_SCHEMA.commonKeys;
    }

    suggestions = suggestions.map(item => ({
      text: item.text,
      displayText: item.text,
      className: `ha-hint-${item.type}`,
      render: (elem, self, data) => appendHintContent(elem, data),
      hint: (cm, self, data) => {
        cm.replaceRange(data.text, { line: cursor.line, ch: start }, { line: cursor.line, ch: end });
      },
      ...item
    }));
  }
  else {
    suggestions = [
      ...HA_SCHEMA.commonKeys,
      ...HA_SCHEMA.configuration,
    ].map(item => ({
      text: item.text,
      displayText: item.text,
      className: `ha-hint-${item.type}`,
      render: (elem, self, data) => appendHintContent(elem, data),
      hint: (cm, self, data) => {
        cm.replaceRange(data.text, { line: cursor.line, ch: start }, { line: cursor.line, ch: end });
      },
      ...item
    }));
  }

  suggestions = filterSchemaSuggestions(suggestions, currentWord);

  suggestions.sort((a, b) => {
    const aStarts = a.text.toLowerCase().startsWith(currentWord.toLowerCase());
    const bStarts = b.text.toLowerCase().startsWith(currentWord.toLowerCase());
    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;
    return a.text.localeCompare(b.text);
  });

  return {
    list: suggestions.slice(0, 20),
    from: { line: cursor.line, ch: start },
    to: { line: cursor.line, ch: end }
  };
}

export function getYamlContext(editor, lineNumber) {
  return getEditorYamlContext(editor, lineNumber);
}

export function defineHAYamlMode() {
  try {
    if (typeof CodeMirror === 'undefined') return;

    CodeMirror.defineMode("ha-yaml", function(config) {
      const yamlMode = CodeMirror.getMode(config, "yaml");

      return {
        startState: function() {
          return {
            yamlState: CodeMirror.startState(yamlMode),
            inJinja: false,
            jinjaType: null
          };
        },
        copyState: function(state) {
          return {
            yamlState: CodeMirror.copyState(yamlMode, state.yamlState),
            inJinja: state.inJinja,
            jinjaType: state.jinjaType
          };
        },
        token: function(stream, state) {
          if (!state.inJinja) {
            if (stream.match(/^\s+(?=(\{\{|\{%|\{#))/, false)) {
              stream.match(/^\s+/);
              return null;
            }

            if (stream.match("{{")) {
              state.inJinja = true;
              state.jinjaType = "{{";
              return "jinja-bracket"; 
            }
            if (stream.match("{%")) {
              state.inJinja = true;
              state.jinjaType = "{%";
              return "jinja-bracket";
            }
            if (stream.match("{#")) {
              state.inJinja = true;
              state.jinjaType = "{#";
              return "comment";
            }

            const style = yamlMode.token(stream, state.yamlState);
            const current = stream.current();
            if (current.match(/^!(include(_dir_(list|named|merge_list|merge_named))?|secret|env_var|input)/)) {
              return "ha-include-tag";
            }

            if (style === "atom" || style === "tag" || !style) {
                if (current.match(/^[\s-]*(automation|script|sensor|binary_sensor|template|input_boolean|input_number|input_select|input_text|input_datetime|light|switch|climate|cover|scene|group|zone|person):/)) {
                  return style ? style + " ha-domain" : "ha-domain";
                }
                if (current.match(/^[\s-]*(id|alias|trigger|triggers|condition|conditions|action|actions|service|entity_id|platform|device_id|area_id):/)) {
                  return style ? style + " ha-key" : "ha-key";
                }
            }
            return style;
          }

          if (state.inJinja) {
            if ((state.jinjaType === "{{" && stream.match("}}")) ||
                (state.jinjaType === "{%" && stream.match("%}")) ||
                (state.jinjaType === "{#" && stream.match("#}"))) {
              state.inJinja = false;
              state.jinjaType = null;
              return "jinja-bracket";
            }
            
            if (state.jinjaType === "{#") {
              stream.next();
              return "comment";
            }
            
            if (stream.match(/^(if|else|elif|endif|for|endfor|in|is|and|or|not|true|false|none|null|block|endblock|extends|include|import|macro|endmacro|call|endcall|filter|endfilter|set|ns|namespace)\b/)) {
              return "jinja-keyword";
            }
            
            if (stream.match(/^(true|false|none|null)\b/)) {
              return "jinja-atom";
            }
            
            if (stream.match(/^'([^']|\\')*'/)) return "string";
            if (stream.match(/^"([^\"]|\\\")*"/)) return "string";
            if (stream.match(/^\d+(\.\d+)?/)) return "number";
            if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
               return "variable"; 
            }
            if (stream.match(/^(\+|\-|\*|\/|%|==|!=|<=|>=|<|>|=|\||\(|\)|\[|\]|\.|,)/)) {
              return "jinja-operator";
            }
            
            stream.next();
            return null;
          }
        },
        indent: function(state, textAfter) {
          return yamlMode.indent ? yamlMode.indent(state.yamlState, textAfter) : CodeMirror.Pass;
        },
        innerMode: function(state) {
          return {state: state.yamlState, mode: yamlMode};
        }
      };
    });
  } catch (error) {
    console.error("Error defining HA YAML mode:", error);
  }
}

export function defineCSVMode() {
  try {
    if (typeof CodeMirror === 'undefined') return;

    CodeMirror.defineMode("csv", function() {
      return {
        token: function(stream) {
          // Handle quoted strings
          if (stream.peek() === '"') {
            stream.next();
            let escaped = false;
            while (!stream.eol()) {
              const ch = stream.next();
              if (ch === '"' && !escaped) break;
              escaped = !escaped && ch === '\\';
            }
            return "string";
          }
          
          // Handle numbers
          if (stream.match(/^-?\d+(\.\d+)?/)) return "number";
          
          // Handle operators (commas)
          if (stream.match(/^[ \t]*,[ \t]*/)) return "operator";
          
          // Handle regular text/variables
          if (stream.match(/^[^,]+/)) return "variable";
          
          stream.next();
          return null;
        }
      };
    });
  } catch (error) {
    console.error("Error defining CSV mode:", error);
  }
}

export function defineShowWhitespaceMode() {
  try {
    CodeMirror.defineMode("show-whitespace", function(config, parserConfig) {
      return {
        token: function(stream, state) {
          const isIndentZone = !stream.string.slice(0, stream.start).trim();
          
          if (stream.eat("\t")) return "whitespace-tab";
          
          if (stream.eat(" ")) {
            if (isIndentZone) {
              // Toggle between start and end for every space in the indent zone
              // This prevents merging into a single span
              const isEven = Math.floor(stream.start / 1) % 2 === 0;
              return isEven ? "whitespace-indent-start" : "whitespace-indent-end";
            }
            return "whitespace-space";
          }
          
          stream.next();
          return null;
        }
      };
    });
  } catch (error) {
      console.error("Error defining whitespace mode:", error);
  }
}
