/** HA-AUTOCOMPLETE.JS | Purpose: Home Assistant entity autocomplete and YAML schema hints. */
import { API_BASE, HA_SCHEMA } from './constants.js';
import { fetchWithAuth } from './api.js';

export let HA_ENTITIES = [];
export let HA_SERVICES = [];
export let HA_DEVICES = [];
export let HA_AREAS = [];
export let HA_LABELS = [];
export let HA_FLOORS = [];
export let HA_AUTOCOMPLETE_ERROR = null;
const DEVICE_AUTOMATIONS = new Map();
const DEVICE_AUTOMATION_REQUESTS = new Map();

export async function loadEntities() {
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_entities" }),
    });
    if (data.entities) {
      HA_ENTITIES = data.entities;
      HA_AUTOCOMPLETE_ERROR = null;
    }
  } catch (e) {
    HA_AUTOCOMPLETE_ERROR = "Entity autocomplete is unavailable";
    console.warn("Failed to load entities for autocomplete", e);
  }
}

export async function loadServices() {
  try {
    const data = await fetchWithAuth(`${API_BASE}?action=get_services`, { method: "GET" });
    if (data.services) {
      HA_SERVICES = data.services;
      HA_AUTOCOMPLETE_ERROR = null;
    }
  } catch (e) {
    HA_AUTOCOMPLETE_ERROR = "Action autocomplete is unavailable";
    console.warn("Failed to load actions for autocomplete", e);
  }
}

export async function loadRegistries() {
  const registries = [
    ["get_devices", "devices", value => { HA_DEVICES = value; }],
    ["get_areas", "areas", value => { HA_AREAS = value; }],
    ["get_labels", "labels", value => { HA_LABELS = value; }],
    ["get_floors", "floors", value => { HA_FLOORS = value; }],
  ];
  const results = await Promise.allSettled(registries.map(([action]) =>
    fetchWithAuth(`${API_BASE}?action=${action}`, { method: "GET" })
  ));
  results.forEach((result, index) => {
    const [, field, assign] = registries[index];
    if (result.status === "fulfilled" && Array.isArray(result.value[field])) {
      assign(result.value[field]);
    } else if (result.status === "rejected") {
      console.warn(`Failed to load ${field} for autocomplete`, result.reason);
    }
  });
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

function selectorType(selector) {
  if (!selector || typeof selector !== "object") return null;
  return Object.keys(selector)[0] || null;
}

function liveValueItems(key, query, context) {
  let items = [];
  if (key === "entity_id") {
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
    if (type === "entity") items = HA_ENTITIES.map(entity => ({ value: entity.entity_id, description: entity.friendly_name, type }));
    else if (type === "device") items = HA_DEVICES.map(device => ({ value: device.id, description: device.name, type }));
    else if (type === "area") items = HA_AREAS.map(area => ({ value: area.id, description: area.name, type }));
    else if (type === "select" && Array.isArray(config?.options)) {
      items = config.options.map(option => ({
        value: typeof option === "object" ? option.value : option,
        description: typeof option === "object" ? option.label : field.description,
        type: "option",
      }));
    } else if (type === "boolean") {
      items = [true, false].map(value => ({ value: String(value), description: field.description, type }));
    }
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

  // Determine context from previous lines and indentation
  const context = getYamlContext(editor, cursor.line);
  if (context.deviceId && !DEVICE_AUTOMATIONS.has(context.deviceId)) {
    void loadDeviceAutomations(context.deviceId);
  }

  let suggestions = [];
  const lineText = currentLine.slice(0, cursor.ch);

  const valueMatch = lineText.match(/^\s*(?:-\s*)?([a-zA-Z_][\w-]*):\s*([^#]*)$/);
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

  // Service autocompletion — triggered when the line is an action:/service: key
  if (isServiceLine && HA_SERVICES.length > 0) {
    // The typed word starts after the colon
    const afterColon = lineText.replace(/^\s*(action|service)\s*:\s*/, '');
    const serviceQuery = afterColon.trimStart();
    const serviceStart = cursor.ch - afterColon.length;
    const matchedServices = HA_SERVICES.filter(s =>
      s.service.startsWith(serviceQuery) || (serviceQuery.length === 0)
    ).slice(0, 30);
    if (matchedServices.length > 0) {
      return {
        list: matchedServices.map(s => ({
          text: s.service,
          displayText: s.service,
          className: 'ha-hint-service',
          render: (elem) => {
            appendHintContent(elem, { iconText: "play_circle", text: s.service, description: s.description });
          },
          hint: (cm) => {
            cm.replaceRange(s.service, { line: cursor.line, ch: serviceStart }, { line: cursor.line, ch: end });
          }
        })),
        from: CodeMirror.Pos(cursor.line, serviceStart),
        to: CodeMirror.Pos(cursor.line, end)
      };
    }
  }

  const trimmedLine = currentLine.trimStart();
  const isLineStart = currentLine.substring(0, cursor.ch).trim() === currentWord.trim();

  if (currentWord.startsWith('!') || (isLineStart && currentWord === '!')) {
    // Dynamic !input completion for blueprint files
    const fullContent = editor.getValue();
    if (fullContent.includes('blueprint:') && lineText.match(/!input\s+\w*$/)) {
      const inputMatch = lineText.match(/!input\s+(\w*)$/);
      const inputPrefix = inputMatch ? inputMatch[1] : '';
      const inputMatchStart = cursor.ch - inputPrefix.length;
      // Extract defined input names from blueprint.input block
      const inputNames = [];
      const lines = fullContent.split(/\r?\n/);
      const inputLine = lines.findIndex(line => /^\s+input:\s*(?:#.*)?$/.test(line));
      if (inputLine >= 0) {
        const inputIndent = lines[inputLine].match(/^\s*/)[0].length;
        let inputNameIndent = null;
        for (let i = inputLine + 1; i < lines.length; i++) {
          if (!lines[i].trim() || lines[i].trimStart().startsWith("#")) continue;
          const indent = lines[i].match(/^\s*/)[0].length;
          if (indent <= inputIndent) break;
          if (inputNameIndent === null) inputNameIndent = indent;
          if (indent === inputNameIndent) {
            const name = lines[i].trim().match(/^([a-zA-Z0-9_]+):/);
            if (name && !inputNames.includes(name[1])) inputNames.push(name[1]);
          }
        }
      }
      if (inputNames.length > 0) {
        const filtered = inputNames.filter(n => n.startsWith(inputPrefix));
        if (filtered.length > 0) {
          return {
            list: filtered.map(name => ({
              text: name,
              displayText: name,
              className: 'ha-hint-tag',
              render: (elem) => { elem.innerHTML = `<span>${name}</span><span class="ha-hint-type">!input</span>`; },
              hint: (cm) => { cm.replaceRange(name, { line: cursor.line, ch: inputMatchStart }, { line: cursor.line, ch: end }); }
            })),
            from: CodeMirror.Pos(cursor.line, inputMatchStart),
            to: CodeMirror.Pos(cursor.line, end)
          };
        }
      }
    }

    suggestions = HA_SCHEMA.yamlTags.map(item => ({
      text: item.text,
      displayText: item.text,
      className: 'ha-hint-tag',
      render: (elem, self, data) => {
        elem.innerHTML = `
          <span>${data.text}</span>
          <span class="ha-hint-type">${data.type}</span>
        `;
      },
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

  if (suggestions.length === 0 && context.indent === 0 && isLineStart) {
    suggestions = HA_SCHEMA.configuration.map(item => ({
      text: item.text,
      displayText: item.text,
      className: 'ha-hint-domain',
      render: (elem, self, data) => {
        elem.innerHTML = `
          <span>${data.text}</span>
          <span class="ha-hint-description">${data.description}</span>
        `;
      },
      hint: (cm, self, data) => {
        cm.replaceRange(data.text, { line: cursor.line, ch: start }, { line: cursor.line, ch: end });
      },
      ...item
    }));
  }
  else if (context.inBlueprint && context.inSelector) {
    // Inside a selector: block in a blueprint — suggest selector types
    suggestions = HA_SCHEMA.blueprintSelectors.map(item => ({
      text: item.text,
      displayText: item.text,
      className: 'ha-hint-key',
      render: (elem, self, data) => {
        elem.innerHTML = `<span>${data.text}</span><span class="ha-hint-type">${data.type}</span>${data.description ? `<span class="ha-hint-description">${data.description}</span>` : ''}`;
      },
      hint: (cm, self, data) => {
        cm.replaceRange(data.text, { line: cursor.line, ch: start }, { line: cursor.line, ch: end });
      },
      ...item
    }));
  }
  else if (context.inBlueprint && !context.inTrigger && !context.inCondition && !context.inAction) {
    // Inside a blueprint file — suggest blueprint keys + automation keys
    suggestions = [
      ...HA_SCHEMA.blueprintKeys,
      ...HA_SCHEMA.automation,
    ].map(item => ({
      text: item.text,
      displayText: item.text,
      className: `ha-hint-${item.type}`,
      render: (elem, self, data) => {
        elem.innerHTML = `<span>${data.text}</span><span class="ha-hint-type">${data.type}</span>${data.description ? `<span class="ha-hint-description">${data.description}</span>` : ''}`;
      },
      hint: (cm, self, data) => {
        cm.replaceRange(data.text, { line: cursor.line, ch: start }, { line: cursor.line, ch: end });
      },
      ...item
    }));
  }
  else if (
    context.section === 'automation' ||
    context.section === 'script' ||
    context.inTrigger ||
    context.inCondition ||
    context.inAction
  ) {
    if (context.inTrigger) {
      suggestions = context.atSequenceItem ? HA_SCHEMA.triggers : HA_SCHEMA.triggerKeys;
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
      suggestions = context.atSequenceItem
        ? [...HA_SCHEMA.services, ...HA_SCHEMA.actionKeys]
        : [...HA_SCHEMA.actionKeys, ...liveFields];
    } else {
      suggestions = HA_SCHEMA.automation;
    }

    suggestions = suggestions.map(item => ({
      text: item.text,
      displayText: item.text,
      className: `ha-hint-${item.type}`,
      render: (elem, self, data) => {
        elem.innerHTML = `
          <span>${data.text}</span>
          <span class="ha-hint-type">${data.type}</span>
          ${data.description ? `<span class="ha-hint-description">${data.description}</span>` : ''}
        `;
      },
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
      render: (elem, self, data) => {
        elem.innerHTML = `
          <span>${data.text}</span>
          ${data.description ? `<span class="ha-hint-description">${data.description}</span>` : ''}
        `;
      },
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
      render: (elem, self, data) => {
        elem.innerHTML = `
          <span>${data.text}</span>
          ${data.description ? `<span class="ha-hint-description">${data.description}</span>` : ''}
        `;
      },
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
  let context = {
    indent: 0,
    section: null,
    inTrigger: false,
    inCondition: false,
    inAction: false,
    inPlatform: false,
    inBlueprint: false,
    inSelector: false,
    atSequenceItem: false,
    path: [],
    actionService: null,
    deviceId: null,
  };

  const currentLine = editor.getLine(lineNumber);
  const match = currentLine.match(/^(\s*)/);
  context.indent = match ? match[1].length : 0;

  const allLines = [];
  for (let i = 0; i < editor.lineCount(); i++) allLines.push(editor.getLine(i));
  context.inBlueprint = allLines.some(line => /^blueprint:\s*(?:#.*)?$/.test(line));

  const stack = [];
  let hasAutomationShape = false;
  for (let i = 0; i < lineNumber; i++) {
    const line = allLines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indent = line.match(/^\s*/)[0].length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const match = line.trim().match(/^(?:-\s*)?([a-zA-Z_][\w-]*):(?:\s*([^#\s][^#]*?))?\s*(?:#.*)?$/);
    if (!match) continue;
    const key = match[1];
    const value = (match[2] || "").trim().replace(/^['"]|['"]$/g, "");
    stack.push({ indent, key, value, sequenceItem: /^\s*-/.test(line) });
    if (["alias", "triggers", "trigger", "conditions", "condition", "actions", "action", "mode"].includes(key)) {
      hasAutomationShape = true;
    }
  }

  context.path = stack.map(entry => entry.key);
  for (let i = stack.length - 1; i >= 0; i--) {
    if ((stack[i].key === "action" || stack[i].key === "service") && stack[i].value.includes(".")) {
      context.actionService = stack[i].value;
      break;
    }
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].key === "device_id" && stack[i].value) {
      context.deviceId = stack[i].value;
      break;
    }
  }
  if (!context.deviceId) {
    for (let i = lineNumber - 1; i >= 0; i--) {
      const line = allLines[i];
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const indent = line.match(/^\s*/)[0].length;
      if (indent < Math.max(0, context.indent - 2)) break;
      if (/^\s*-/.test(line) && indent < context.indent) break;
      const device = line.trim().match(/^device_id:\s*['"]?([^'"#\s]+)['"]?/);
      if (device) {
        context.deviceId = device[1];
        break;
      }
    }
  }
  const currentTrimmed = currentLine.trimStart();
  const currentIsItem = currentTrimmed.startsWith("-");
  const pluralOrSingular = (plural, singular) => {
    for (let i = context.path.length - 1; i >= 0; i--) {
      if (context.path[i] === plural || context.path[i] === singular) return i;
    }
    return -1;
  };
  const triggerIndex = pluralOrSingular("triggers", "trigger");
  const conditionIndex = pluralOrSingular("conditions", "condition");
  const actionIndex = Math.max(
    pluralOrSingular("actions", "action"),
    ...["sequence", "then", "else", "parallel"].map(key => context.path.lastIndexOf(key))
  );
  const deepest = Math.max(triggerIndex, conditionIndex, actionIndex);
  context.inTrigger = triggerIndex >= 0 && triggerIndex === deepest;
  context.inCondition = conditionIndex >= 0 && conditionIndex === deepest;
  context.inAction = actionIndex >= 0 && actionIndex === deepest;
  context.inSelector = context.path.includes("selector");
  context.inPlatform = context.path.includes("platform");
  context.atSequenceItem = currentIsItem || (
    (context.inTrigger && context.path[triggerIndex] === "triggers") ||
    (context.inCondition && context.path[conditionIndex] === "conditions") ||
    (context.inAction && ["actions", "sequence", "then", "else", "parallel"].includes(context.path[actionIndex]))
  );

  if (context.path.includes("binary_sensor")) context.section = "binary_sensor";
  else if (context.path.includes("sensor")) context.section = "sensor";
  else if (context.path.includes("script")) context.section = "script";
  else if (context.path.includes("automation") || context.inBlueprint || hasAutomationShape || allLines[0]?.trimStart().startsWith("-")) {
    context.section = "automation";
  }

  return context;
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
