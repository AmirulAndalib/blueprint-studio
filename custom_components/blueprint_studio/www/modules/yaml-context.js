/** YAML-CONTEXT.JS | Structural Home Assistant YAML context for editor features. */
import { isMap, isScalar, isSeq, parseDocument } from '../vendor/yaml/yaml.js?v=2.5.270';

export const YAML_CONTEXT_PARSER = Object.freeze({ name: 'yaml', version: '2.9.0' });
export const YAML_CONTEXT_LATENCY_BUDGET_MS = 75;
export const YAML_CONTEXT_MAX_PARSE_CHARS = 750_000;
export const BLUEPRINT_DOMAINS = Object.freeze(['automation', 'script', 'template']);

const AUTOMATION_KEYS = new Set([
  'alias', 'triggers', 'trigger', 'conditions', 'condition', 'actions', 'action',
  'initial_state', 'mode', 'max', 'max_exceeded', 'trace', 'variables', 'trigger_variables',
]);
const ACTION_CONTAINERS = new Set([
  'actions', 'action', 'sequence', 'then', 'else', 'parallel', 'default',
]);
const TRIGGER_CONTAINERS = new Set(['triggers', 'trigger', 'wait_for_trigger']);
const CONDITION_CONTAINERS = new Set(['conditions', 'condition', 'if']);
const parserCache = new Map();
const CACHE_LIMIT = 4;

function scalarValue(node) {
  return isScalar(node) && ['string', 'number', 'boolean'].includes(typeof node.value)
    ? String(node.value)
    : '';
}

function lineStarts(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function lineAtOffset(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (starts[middle] <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high);
}

function lineIndent(source, starts, line) {
  const start = starts[line] || 0;
  let end = start;
  while (source[end] === ' ' || source[end] === '\t') end += 1;
  return end - start;
}

function collectEntries(node, source, starts, path = [], entries = []) {
  if (isMap(node)) {
    for (const pair of node.items) {
      const key = scalarValue(pair.key);
      if (!key || !pair.key?.range) continue;
      const line = lineAtOffset(starts, pair.key.range[0]);
      const entry = {
        key,
        value: scalarValue(pair.value),
        line,
        indent: lineIndent(source, starts, line),
        offset: pair.key.range[0],
        path: [...path, key],
      };
      entries.push(entry);
      collectEntries(pair.value, source, starts, entry.path, entries);
    }
  } else if (isSeq(node)) {
    node.items.forEach((item, index) => collectEntries(item, source, starts, [...path, index], entries));
  }
  return entries;
}

function rootMapValue(document, key) {
  if (!isMap(document?.contents)) return null;
  const pair = document.contents.items.find(item => scalarValue(item.key) === key);
  return pair?.value || null;
}

function rootKeys(document) {
  if (!isMap(document?.contents)) return [];
  return document.contents.items.map(item => scalarValue(item.key)).filter(Boolean);
}

export function detectYamlFileRole(document, filePath = '') {
  const normalizedPath = String(filePath || '').replace(/\\/g, '/').toLowerCase();
  const fileName = normalizedPath.split('/').pop() || '';
  const keys = new Set(rootKeys(document));
  const root = document?.contents;

  if (keys.has('blueprint')) return 'blueprint';
  if (/(^|\/)packages\//.test(normalizedPath)) return 'package';
  if (/^(automations?|automation)\.ya?ml$/.test(fileName)) return 'automation-list';
  if (/^(scripts?|script)\.ya?ml$/.test(fileName)) return 'script-map';
  if (/^(scenes?|scene)\.ya?ml$/.test(fileName)) return 'scene-list';
  if (/^(templates?|template)\.ya?ml$/.test(fileName)) return 'template';
  if (/^configuration\.ya?ml$/.test(fileName)) return 'configuration';

  if (isSeq(root)) {
    const first = root.items.find(Boolean);
    if (isMap(first)) {
      const itemKeys = new Set(first.items.map(item => scalarValue(item.key)));
      if (itemKeys.has('entities') && (itemKeys.has('name') || itemKeys.has('id'))) return 'scene-list';
      if ([...AUTOMATION_KEYS].some(key => itemKeys.has(key))) return 'automation-list';
      if (itemKeys.has('sensor') || itemKeys.has('binary_sensor') || itemKeys.has('trigger')) return 'template';
    }
  }

  if (isMap(root)) {
    const values = root.items.map(item => item.value).filter(isMap);
    const looksLikeScriptMap = values.some(value => {
      const valueKeys = new Set(value.items.map(item => scalarValue(item.key)));
      return valueKeys.has('sequence') && (valueKeys.has('alias') || valueKeys.has('mode'));
    });
    if (looksLikeScriptMap) return 'script-map';
    if (keys.has('automation') && rootMapValue(document, 'automation')) return 'package';
    if (keys.has('template')) return 'template';
    if (keys.size) return 'configuration';
  }
  return 'unknown';
}

function safeFallbackEntries(source, starts, throughLine) {
  const entries = [];
  const lines = source.split(/\r?\n/);
  let offset = 0;
  for (let line = 0; line < Math.min(lines.length, throughLine); line += 1) {
    const text = lines[line];
    const trimmed = text.trimStart();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('{{') || trimmed.startsWith('{%') || trimmed.startsWith('"') || trimmed.startsWith("'")) {
      offset += text.length + 1;
      continue;
    }
    const match = trimmed.match(/^(?:-\s*)?([A-Za-z_][\w-]*):(?:\s*([^#]*))?$/);
    if (match && !/[{}]/.test(trimmed.slice(0, trimmed.indexOf(':')))) {
      entries.push({
        key: match[1],
        value: (match[2] || '').trim().replace(/^(['"])(.*)\1$/, '$2'),
        line,
        indent: text.length - trimmed.length,
        offset,
        path: [],
      });
    }
    offset += text.length + 1;
  }
  return entries;
}

function parseStructure(source) {
  const cached = parserCache.get(source);
  if (cached) return cached;
  const starts = lineStarts(source);
  const startedAt = performance.now();
  let document = null;
  let entries = [];
  let failure = null;
  try {
    document = parseDocument(source, {
      keepSourceTokens: true,
      logLevel: 'silent',
      prettyErrors: false,
      strict: false,
      uniqueKeys: false,
    });
    entries = collectEntries(document.contents, source, starts);
  } catch (error) {
    failure = error;
  }
  const parsed = {
    document,
    entries,
    starts,
    errors: document?.errors || (failure ? [failure] : []),
    parseTimeMs: performance.now() - startedAt,
  };
  parserCache.set(source, parsed);
  while (parserCache.size > CACHE_LIMIT) parserCache.delete(parserCache.keys().next().value);
  return parsed;
}

function stackAtLine(entries, lineNumber, currentIndent) {
  const stack = [];
  for (const entry of entries) {
    if (entry.line >= lineNumber) continue;
    while (stack.length && stack[stack.length - 1].indent >= entry.indent) stack.pop();
    stack.push(entry);
  }
  while (stack.length && stack[stack.length - 1].indent >= currentIndent) stack.pop();
  return stack;
}

function lastContainerIndex(path, containers) {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (containers.has(path[index])) return index;
  }
  return -1;
}

function samePath(left, right) {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function scopedSiblingValue(entries, stack, lineNumber, keys, predicate = () => true) {
  const parentPath = stack[stack.length - 1]?.path.slice(0, -1);
  if (!parentPath) return null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.line >= lineNumber || !keys.includes(entry.key) || !predicate(entry.value)) continue;
    if (samePath(entry.path.slice(0, -1), parentPath)) return entry.value;
  }
  return null;
}

function blueprintInputStructure(entries) {
  const directInputs = new Map();
  const sectionInputs = new Set();
  for (const entry of entries) {
    const blueprintIndex = entry.path.indexOf('blueprint');
    const inputIndex = entry.path.indexOf('input', blueprintIndex + 1);
    if (blueprintIndex < 0 || inputIndex < 0) continue;
    const tail = entry.path.slice(inputIndex + 1).filter(part => typeof part === 'string');
    if (tail.length === 1) directInputs.set(tail[0], true);
    if (tail.length >= 2 && tail[1] === 'input') directInputs.set(tail[0], false);
    if (tail.length === 3 && tail[1] === 'input') sectionInputs.add(tail[2]);
  }
  const names = [...directInputs.entries()]
    .filter(([, isInput]) => isInput)
    .map(([name]) => name)
    .concat([...sectionInputs])
    .filter((name, index, names) => names.indexOf(name) === index)
    .sort();
  const sections = [...directInputs.entries()].filter(([, isInput]) => !isInput).map(([name]) => name).sort();
  return { names, sections };
}

export function getStructuralYamlContext(source, lineNumber, { filePath = '' } = {}) {
  const lines = String(source || '').split(/\r?\n/);
  const safeLine = Math.max(0, Math.min(Number(lineNumber) || 0, lines.length - 1));
  const currentLine = lines[safeLine] || '';
  const indent = currentLine.match(/^\s*/)?.[0].length || 0;
  const tooLarge = source.length > YAML_CONTEXT_MAX_PARSE_CHARS;
  const parsed = tooLarge ? { document: null, entries: [], errors: [], parseTimeMs: 0, starts: lineStarts(source) } : parseStructure(source);
  const fallback = tooLarge || !parsed.document;
  const entries = fallback ? safeFallbackEntries(source, parsed.starts, safeLine) : parsed.entries;
  const stack = stackAtLine(entries, safeLine, indent);
  const path = fallback
    ? stack.map(entry => entry.key)
    : (stack[stack.length - 1]?.path || []).filter(part => typeof part === 'string');
  const role = detectYamlFileRole(parsed.document, filePath);
  const blueprintNode = rootMapValue(parsed.document, 'blueprint');
  const blueprintDomain = scalarValue(isMap(blueprintNode)
    ? blueprintNode.items.find(item => scalarValue(item.key) === 'domain')?.value
    : null);
  const triggerIndex = lastContainerIndex(path, TRIGGER_CONTAINERS);
  const conditionIndex = lastContainerIndex(path, CONDITION_CONTAINERS);
  const actionIndex = lastContainerIndex(path, ACTION_CONTAINERS);
  const deepest = Math.max(triggerIndex, conditionIndex, actionIndex);
  const inTrigger = triggerIndex >= 0 && triggerIndex === deepest;
  const inCondition = conditionIndex >= 0 && conditionIndex === deepest;
  const inAction = actionIndex >= 0 && actionIndex === deepest;
  const currentIsItem = currentLine.trimStart().startsWith('-');
  const itemContainer = path[deepest];
  let hasSameIndentSibling = false;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.line >= safeLine) continue;
    if (entry.indent < indent) break;
    if (entry.indent === indent) {
      hasSameIndentSibling = true;
      break;
    }
  }
  const inBlueprint = role === 'blueprint' || rootKeys(parsed.document).includes('blueprint');
  const inputStructure = inBlueprint ? blueprintInputStructure(entries) : { names: [], sections: [] };
  const inputIndex = path.indexOf('input', path.indexOf('blueprint') + 1);
  const selectorIndex = path.lastIndexOf('selector');
  let blueprintSection = null;
  if (inBlueprint) {
    if (selectorIndex >= 0) blueprintSection = 'selector';
    else if (inputIndex >= 0 && inputStructure.sections.includes(path[inputIndex + 1]) && !path.slice(inputIndex + 2).includes('input')) blueprintSection = 'input-section';
    else if (inputIndex >= 0 && path.length > inputIndex + 1) blueprintSection = 'input';
    else if (inputIndex >= 0) blueprintSection = 'inputs';
    else if (path.includes('blueprint')) blueprintSection = 'metadata';
    else blueprintSection = blueprintDomain || 'body';
  }

  let actionService = null;
  let deviceId = null;
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (!actionService && ['action', 'service'].includes(stack[index].key) && stack[index].value.includes('.')) actionService = stack[index].value;
    if (!deviceId && stack[index].key === 'device_id' && stack[index].value) deviceId = stack[index].value;
  }
  actionService ||= scopedSiblingValue(entries, stack, safeLine, ['action', 'service'], value => value.includes('.'));
  deviceId ||= scopedSiblingValue(entries, stack, safeLine, ['device_id'], Boolean);

  const legacySyntax = entries.some(entry => (
    ['service', 'data_template', 'event_data_template', 'platform'].includes(entry.key)
    || (
      ['trigger', 'condition', 'action'].includes(entry.key)
      && entry.path.length <= (role === 'blueprint' ? 1 : 2)
    )
  ));

  let section = null;
  if (path.includes('binary_sensor')) section = 'binary_sensor';
  else if (path.includes('sensor')) section = 'sensor';
  else if (role === 'script-map' || blueprintDomain === 'script') section = 'script';
  else if (role === 'automation-list' || role === 'package' || inTrigger || inCondition || inAction || blueprintDomain === 'automation') section = 'automation';
  else if (role === 'scene-list') section = 'scene';
  else if (role === 'template' || blueprintDomain === 'template') section = 'template';

  return {
    indent,
    section,
    fileRole: role,
    inTrigger,
    inCondition,
    inAction,
    inPlatform: path.includes('platform'),
    inBlueprint,
    blueprintDomain: BLUEPRINT_DOMAINS.includes(blueprintDomain) ? blueprintDomain : null,
    blueprintSection,
    inSelector: selectorIndex >= 0,
    atSequenceItem: currentIsItem || (
      ['triggers', 'conditions', 'actions', 'sequence', 'then', 'else', 'parallel', 'default', 'wait_for_trigger'].includes(itemContainer)
      && path[path.length - 1] === itemContainer
      && !hasSameIndentSibling
    ),
    path,
    actionService,
    deviceId,
    legacySyntax,
    blueprintInputNames: inputStructure.names,
    blueprintInputSections: inputStructure.sections,
    parser: fallback ? 'fallback' : YAML_CONTEXT_PARSER.name,
    incomplete: parsed.errors.length > 0,
    parseTimeMs: parsed.parseTimeMs,
  };
}

export function getEditorYamlContext(editor, lineNumber, options = {}) {
  const source = typeof editor?.getValue === 'function'
    ? editor.getValue()
    : Array.from({ length: editor?.lineCount?.() || 0 }, (_, index) => editor.getLine(index)).join('\n');
  return getStructuralYamlContext(source, lineNumber, {
    filePath: options.filePath || editor?.blueprintStudioFilePath || '',
  });
}
