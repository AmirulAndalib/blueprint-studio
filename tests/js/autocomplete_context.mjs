import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  BLUEPRINT_DOMAINS,
  YAML_CONTEXT_LATENCY_BUDGET_MS,
  YAML_CONTEXT_MAX_PARSE_CHARS,
  YAML_CONTEXT_PARSER,
  getStructuralYamlContext,
} from "../../custom_components/blueprint_studio/www/modules/yaml-context.js";

const source = fs.readFileSync(
  new URL("../../custom_components/blueprint_studio/www/modules/ha-autocomplete.js", import.meta.url),
  "utf8",
);
const prefixStart = source.indexOf("export function getCompletionPrefix");
const prefixEnd = source.indexOf("\n\n/**", prefixStart);
const prefixSource = source.slice(prefixStart, prefixEnd).replace(/export function/g, "function");
const sandbox = {};
vm.runInNewContext(
  `${prefixSource}\nthis.getCompletionPrefix = getCompletionPrefix; this.filterSchemaSuggestions = filterSchemaSuggestions;`,
  sandbox,
);
const { getCompletionPrefix, filterSchemaSuggestions } = sandbox;

const renderStart = source.indexOf("function appendHintContent");
const renderEnd = source.indexOf("function decorateCompletionMenu", renderStart);
const renderSandbox = {
  document: {
    createElement: () => ({
      children: [], style: {}, className: '', textContent: '',
      appendChild(child) { this.children.push(child); },
    }),
  },
};
vm.runInNewContext(`${source.slice(renderStart, renderEnd)}\nthis.appendHintContent = appendHintContent;`, renderSandbox);
const renderedRoot = { replaceChildren(child) { this.child = child; } };
renderSandbox.appendHintContent(renderedRoot, {
  text: '<img src=x onerror=alert(1)>',
  type: 'action',
  description: '<script>alert(1)</script>',
});
assert.equal(renderedRoot.child.children[0].textContent, '<img src=x onerror=alert(1)>');
assert.equal(renderedRoot.child.children[2].textContent, '<script>alert(1)</script>');
for (const malicious of [
  '<svg onload=alert(1)>',
  '\" autofocus onfocus=alert(1) x=\"',
  'javascript:alert(1)',
  '${globalThis.process?.exit?.()}',
]) {
  const root = { replaceChildren(child) { this.child = child; } };
  renderSandbox.appendHintContent(root, {
    text: malicious,
    type: malicious,
    description: malicious,
  });
  assert.equal(root.child.children[0].textContent, malicious);
  assert.equal(root.child.children[1].textContent, malicious);
  assert.equal(root.child.children[2].textContent, malicious);
}

const rankingStart = source.indexOf("function fuzzyScore");
const rankingEnd = source.indexOf("function rememberAction", rankingStart);
const selectorStart = source.indexOf("function selectorType", rankingEnd);
const selectorEnd = source.indexOf("export function liveValueItems", selectorStart);
const modelSandbox = {};
vm.runInNewContext(
  `${source.slice(rankingStart, rankingEnd).replace(/export function/g, "function")}\n${source.slice(selectorStart, selectorEnd).replace(/export function/g, "function")}\nthis.rankActionSuggestions = rankActionSuggestions; this.selectorValueCandidates = selectorValueCandidates;`,
  modelSandbox,
);
const { rankActionSuggestions, selectorValueCandidates } = modelSandbox;

const hintStart = source.indexOf("export function homeAssistantHint");
const hintEnd = source.indexOf("\n\nexport function getYamlContext", hintStart);
const hintSandbox = {
  setTimeout: () => {},
  decorateCompletionMenu: () => {},
  CodeMirror: { Pos: (line, ch) => ({ line, ch }) },
  getCompletionPrefix,
  getYamlContext: () => ({
    path: ["actions", 0, "action"],
    deviceId: "",
    inBlueprint: false,
    blueprintInputNames: [],
    inSelector: false,
    indent: 4,
    section: "automation",
    fileRole: "automation-list",
  }),
  DEVICE_AUTOMATIONS: new Map(),
  HA_ENTITIES: [],
  HA_SERVICES: [{ service: "light.turn_on", domain: "light", description: "Turn on" }],
  HA_SCHEMA: { jinjaNames: [], yamlTags: [], snippets: [], configuration: [], commonKeys: [] },
  RECENT_ACTIONS: [],
  rankActionSuggestions,
  liveValueItems: () => [],
  metadataCompletionState: () => ({ type: "ready", label: "Ready" }),
  appendHintContent: () => {},
  rememberAction: () => {},
  filterSchemaSuggestions,
  loadDeviceAutomations: () => {},
};
vm.runInNewContext(
  `${source.slice(hintStart, hintEnd).replace("export function", "function")}\nthis.homeAssistantHint = homeAssistantHint;`,
  hintSandbox,
);

const actionLine = "    action: light.tur";
const actionEditor = {
  getCursor: () => ({ line: 3, ch: actionLine.length }),
  getLine: () => actionLine,
  indexFromPos: () => actionLine.length,
  getValue: () => actionLine,
};
const actionHints = hintSandbox.homeAssistantHint(actionEditor, {});
assert.deepEqual({ ...actionHints.from }, { line: 3, ch: 12 });
assert.deepEqual({ ...actionHints.to }, { line: 3, ch: actionLine.length });
const replacements = [];
actionHints.list[0].hint({ replaceRange: (...args) => replacements.push(args) });
assert.deepEqual(
  JSON.parse(JSON.stringify(replacements[0])),
  ["light.turn_on", { line: 3, ch: 12 }, { line: 3, ch: actionLine.length }],
  "action completion replaces only the typed value",
);

hintSandbox.HA_SERVICES = [];
hintSandbox.HA_ENTITIES = [{ entity_id: "light.kitchen", friendly_name: "Kitchen" }];
const entityLine = "      entity_id: light.kit";
const entityEditor = {
  getCursor: () => ({ line: 5, ch: entityLine.length }),
  getLine: () => entityLine,
  indexFromPos: () => entityLine.length,
  getValue: () => entityLine,
};
const entityHints = hintSandbox.homeAssistantHint(entityEditor, {});
assert.deepEqual({ ...entityHints.from }, { line: 5, ch: 17 });
assert.deepEqual({ ...entityHints.to }, { line: 5, ch: entityLine.length });
const entityReplacements = [];
entityHints.list[0].hint(
  { replaceRange: (...args) => entityReplacements.push(args) },
  null,
  entityHints.list[0],
);
assert.deepEqual(
  JSON.parse(JSON.stringify(entityReplacements[0])),
  ["light.kitchen", { line: 5, ch: 17 }, { line: 5, ch: entityLine.length }],
  "entity completion replaces only the matching entity token",
);

const metadataStateStart = source.indexOf("export function metadataCompletionState");
const metadataStateEnd = source.indexOf("function statusCompletion", metadataStateStart);
const metadataSandbox = { Date };
vm.runInNewContext(
  `let metadataRequest = null; let HA_AUTOCOMPLETE_ERROR = null; let HA_METADATA = null; let HA_SERVICES = [];\n${source.slice(metadataStateStart, metadataStateEnd).replace("export function", "function")}\nthis.metadataCompletionState = metadataCompletionState; this.setMetadataState = values => { metadataRequest = values.request; HA_AUTOCOMPLETE_ERROR = values.error; HA_METADATA = values.metadata; HA_SERVICES = values.services; };`,
  metadataSandbox,
);

assert.deepEqual(
  { ...getCompletionPrefix("  con", 5) },
  { text: "con", start: 2 },
);

const rankedActions = rankActionSuggestions([
  { service: "switch.turn_on", domain: "switch", name: "Turn on" },
  { service: "light.toggle", domain: "light", name: "Toggle" },
  { service: "light.turn_on", domain: "light", name: "Turn on" },
], "turnon", { recent: ["switch.turn_on"], preferredDomain: "light" });
assert.equal(rankedActions[0].service, "light.turn_on", "domain and fuzzy ranking are deterministic");
assert.equal(
  rankActionSuggestions(rankedActions, "light.t", { recent: ["light.toggle"] })[0].service,
  "light.toggle",
  "recent actions break otherwise close prefix matches predictably",
);

const registries = {
  entities: [
    { entity_id: "light.kitchen", domain: "light", friendly_name: "Kitchen" },
    { entity_id: "switch.fan", domain: "switch", friendly_name: "Fan" },
  ],
  addons: [{ slug: "core_ssh", name: "Terminal & SSH" }],
};
assert.deepEqual(
  Array.from(selectorValueCandidates("entity", { domain: "light" }, {}, registries), item => item.value),
  ["light.kitchen"],
  "entity selectors respect selector domains",
);
assert.deepEqual(
  Array.from(selectorValueCandidates("target", {}, {}, registries, { target: { entity: { domain: "switch" } } }), item => item.value),
  ["switch.fan"],
  "target selectors respect installed action constraints",
);
assert.deepEqual(
  Array.from(selectorValueCandidates("app", {}, {}, registries), item => item.value),
  ["core_ssh"],
  "HAOS app selectors offer installed add-on slugs",
);
assert.ok(Array.from(selectorValueCandidates("number", { min: 1, max: 5 }, { example: 3 }, registries), item => item.value).includes("3"));
assert.ok(Array.from(selectorValueCandidates("duration", {}, {}, registries), item => item.value).includes("00:05:00"));
const stateNow = 1_800_000_000_000;
assert.equal(metadataSandbox.metadataCompletionState(stateNow).type, "loading");
metadataSandbox.setMetadataState({ request: null, error: "Registry unavailable", metadata: {}, services: [] });
assert.equal(metadataSandbox.metadataCompletionState(stateNow).type, "unavailable");
metadataSandbox.setMetadataState({ request: null, error: null, metadata: { generated_at: (stateNow - 180_000) / 1000 }, services: [{ service: "light.turn_on" }] });
assert.equal(metadataSandbox.metadataCompletionState(stateNow).type, "stale");
metadataSandbox.setMetadataState({ request: null, error: null, metadata: { generated_at: stateNow / 1000 }, services: [] });
assert.equal(metadataSandbox.metadataCompletionState(stateNow).type, "empty");
metadataSandbox.setMetadataState({ request: null, error: null, metadata: { generated_at: stateNow / 1000 }, services: [{ service: "light.turn_on" }] });
assert.equal(metadataSandbox.metadataCompletionState(stateNow).type, "ready");
assert.deepEqual(
  filterSchemaSuggestions([
    { text: "conversation:" },
    { text: "conditions:" },
    { text: "name:" },
    { text: "icon:" },
  ], "con").map(item => item.text),
  ["conversation:", "conditions:"],
);
assert.deepEqual(
  filterSchemaSuggestions([{ text: "name:" }, { text: "name:" }], "na").map(item => item.text),
  ["name:"],
);
assert.deepEqual(
  { ...getCompletionPrefix("    - con", 9) },
  { text: "con", start: 6 },
);

function context(source, filePath = "") {
  const lines = source.replace(/^\n/, "").split("\n");
  return getStructuralYamlContext(lines.join("\n"), lines.length - 1, { filePath });
}

assert.deepEqual([...BLUEPRINT_DOMAINS], ["automation", "script", "template"]);
assert.deepEqual(YAML_CONTEXT_PARSER, { name: "yaml", version: "2.9.0" });

let result = context(`
- alias: Kitchen
  triggers:
    - trigger: state
      ent`);
assert.equal(result.section, "automation");
assert.equal(result.inTrigger, true);
assert.equal(result.atSequenceItem, false);

result = context(`
- alias: Kitchen
  triggers:
    - tr`);
assert.equal(result.inTrigger, true);
assert.equal(result.atSequenceItem, true);

result = context(`
blueprint:
  name: Test
  domain: automation
  input:
    motion:
      selector:
        entity: {}
triggers:
  - trigger: state
    ent`);
assert.equal(result.inBlueprint, true);
assert.equal(result.inTrigger, true);
assert.equal(result.inSelector, false);
assert.equal(result.atSequenceItem, false);
assert.equal(result.legacySyntax, false);
assert.deepEqual(result.blueprintInputNames, ["motion"]);

result = context(`
blueprint:
  name: Sections
  domain: automation
  input:
    lighting:
      name: Lighting
      collapsed: true
      input:
        target_light:
          selector:
            entity:
              domain: light
        transition:
          default: 2
          selector:
            number: {}
    standalone:
      selector:
        boolean: {}
triggers: []
actions:
  - action: light.turn_on
    target:
      entity_id: !input target_light
    `);
assert.deepEqual(result.blueprintInputNames, ["standalone", "target_light", "transition"]);
assert.deepEqual(result.blueprintInputSections, ["lighting"]);
assert.equal(result.legacySyntax, false);

result = context(`
- alias: Legacy automation
  trigger:
    - platform: state
      entity_id: binary_sensor.door
  condition: []
  action:
    - service: light.turn_on
      data_template:
        brightness_pct: 50
  `, "automations.yaml");
assert.equal(result.legacySyntax, true);
assert.equal(result.section, "automation");

result = context(`
- alias: Kitchen
  conditions:
    - condition: state
      st`);
assert.equal(result.inCondition, true);
assert.equal(result.atSequenceItem, false);

result = context(`
- alias: Kitchen
  actions:
    - action: light.turn_on
      tar`);
assert.equal(result.inAction, true);
assert.equal(result.atSequenceItem, false);
assert.equal(result.actionService, "light.turn_on");

result = context(`
- alias: Device automation
  triggers:
    - trigger: device
      device_id: abc123
      domain: binary_sensor
      ty`);
assert.equal(result.inTrigger, true);
assert.equal(result.deviceId, "abc123");

result = context(`
morning_lights:
  alias: Morning lights
  sequence:
    - action: light.turn_on
      target:
        ent`);
assert.equal(result.inAction, true);
assert.equal(result.atSequenceItem, false);
assert.equal(result.actionService, "light.turn_on");

result = context(`
- alias: Kitchen
  actions:
    - action: light.turn_on
      data:
        bri`);
assert.equal(result.inAction, true);
assert.equal(result.actionService, "light.turn_on");

const nestedActionFixtures = [
  {
    name: "choose sequence",
    source: `
- alias: Nested choose
  actions:
    - choose:
        - conditions:
            - condition: state
              entity_id: input_boolean.away
              state: "on"
          sequence:
            - action: light.turn_on
              dat`,
  },
  {
    name: "if then sequence",
    source: `
- alias: Nested if
  actions:
    - if:
        - condition: state
          entity_id: input_boolean.away
          state: "on"
      then:
        - action: light.turn_on
          tar`,
  },
  {
    name: "repeat sequence",
    source: `
- alias: Nested repeat
  actions:
    - repeat:
        count: 2
        sequence:
          - action: light.toggle
            tar`,
  },
  {
    name: "parallel sequence",
    source: `
- alias: Nested parallel
  actions:
    - parallel:
        - action: light.turn_on
          dat`,
  },
];

for (const fixture of nestedActionFixtures) {
  result = context(fixture.source);
  assert.equal(result.inAction, true, fixture.name);
  assert.equal(result.section, "automation", fixture.name);
}

result = context(`
- alias: Wait for another trigger
  actions:
    - wait_for_trigger:
        - trigger: state
          entity_id: binary_sensor.door
          t`);
assert.equal(result.inTrigger, true, "wait_for_trigger");
assert.equal(result.inAction, false, "wait_for_trigger");

const fileRoleFixtures = [
  {
    name: "configuration",
    source: `
default_config:
http:
  use_x_forwarded_for: tr`,
    filePath: "configuration.yaml",
    expected: { fileRole: "configuration", section: null, inBlueprint: false, inAction: false },
  },
  {
    name: "automation list",
    source: `
- alias: List automation
  actions:
    - action: light.turn_on
      tar`,
    filePath: "automations.yaml",
    expected: { fileRole: "automation-list", section: "automation", inBlueprint: false, inAction: true },
  },
  {
    name: "scripts mapping",
    source: `
morning_lights:
  alias: Morning lights
  sequence:
    - action: light.turn_on
      tar`,
    filePath: "scripts.yaml",
    expected: { fileRole: "script-map", section: "script", inBlueprint: false, inAction: true },
  },
  {
    name: "scenes list",
    source: `
- name: Evening
  entities:
    light.lounge:
      sta`,
    filePath: "scenes.yaml",
    expected: { fileRole: "scene-list", section: "scene", inBlueprint: false, inAction: false },
  },
  {
    name: "package automation",
    source: `
automation:
  - alias: Package automation
    actions:
      - action: light.turn_on
        tar`,
    filePath: "packages/lights.yaml",
    expected: { fileRole: "package", section: "automation", inBlueprint: false, inAction: true },
  },
  {
    name: "automation blueprint",
    source: `
blueprint:
  name: Automation blueprint
  domain: automation
triggers: []
actions:
  - action: light.turn_on
    tar`,
    filePath: "blueprints/automation/test.yaml",
    expected: { fileRole: "blueprint", blueprintDomain: "automation", section: "automation", inBlueprint: true, inAction: true },
  },
  {
    name: "script blueprint",
    source: `
blueprint:
  name: Script blueprint
  domain: script
sequence:
  - action: light.turn_on
    tar`,
    filePath: "blueprints/script/test.yaml",
    expected: { fileRole: "blueprint", blueprintDomain: "script", section: "script", inBlueprint: true, inAction: true },
  },
  {
    name: "template blueprint",
    source: `
blueprint:
  name: Template blueprint
  domain: template
variables:
  current_state: sta`,
    filePath: "blueprints/template/test.yaml",
    expected: { fileRole: "blueprint", blueprintDomain: "template", section: "template", inBlueprint: true, inAction: false },
  },
  {
    name: "template list",
    source: `
- sensor:
    - name: Room status
      sta`,
    filePath: "templates.yaml",
    expected: { fileRole: "template", section: "sensor", inBlueprint: false, inAction: false },
  },
  {
    name: "unknown",
    source: `
just some scalar text
next`,
    expected: { fileRole: "unknown", section: null, inBlueprint: false, inAction: false },
  },
];

for (const fixture of fileRoleFixtures) {
  result = context(fixture.source, fixture.filePath);
  for (const [key, value] of Object.entries(fixture.expected)) {
    assert.equal(result[key], value, `${fixture.name}: ${key}`);
  }
}

result = context(`
- alias: Legacy automation
  trigger:
    - platform: state
      ent`);
assert.equal(result.inTrigger, true, "legacy singular trigger");

result = context(`
- alias: Trigger group
  triggers:
    - trigger: or
      triggers:
        - trigger: state
          ent`);
assert.equal(result.inTrigger, true, "nested trigger group");
assert.equal(result.atSequenceItem, false, "nested trigger fields");

result = context(`
blueprint:
  name: Sections
  domain: automation
  input:
    lighting:
      name: Lighting
      input:
        target_light:
          selector:
            ent`);
assert.equal(result.blueprintSection, "selector");
assert.equal(result.inSelector, true);

result = context(`
blueprint:
  name: HAOS add-on restart
  domain: automation
  input:
    addon_id:
      selector:
        app: {}
triggers: []
actions:
  - action: hassio.addon_restart
    data:
      addon: !input addon_id
      `, "/config/blueprints/automation/addon_restart.yaml");
assert.equal(result.fileRole, "blueprint");
assert.equal(result.blueprintDomain, "automation");
assert.equal(result.inAction, true);
assert.equal(result.actionService, "hassio.addon_restart");
assert.equal(result.incomplete, false, "Home Assistant !input is valid editor structure");

result = context(`
automation: !include automations.yaml
script: !include scripts.yaml
http:
  trusted_proxies: !secret proxy_address
  `, "/config/configuration.yaml");
assert.equal(result.fileRole, "configuration");
assert.equal(result.incomplete, false, "Home Assistant include and secret tags are tolerated");

result = context(`
automation:
  - alias: Packaged HAOS automation
    actions:
      - action: hassio.addon_restart
        data:
          addon: core_ssh
          `, "/config/packages/supervisor.yaml");
assert.equal(result.fileRole, "package");
assert.equal(result.inAction, true);
assert.equal(result.actionService, "hassio.addon_restart");

result = context(`
blueprint:
  name: Incomplete
  domain: automation
triggers:
  - trigger: state
    entity_id: "binary_sensor.door
    ent`);
assert.equal(result.incomplete, true);
assert.equal(result.inTrigger, true, "incomplete scalar keeps structural parent");
assert.equal(result.parser, "yaml");

result = context(`
- alias: Temporary syntax error
  actions:
    - action: light.turn_on
      data: [
      bri`);
assert.equal(result.incomplete, true);
assert.equal(result.inAction, true, "temporarily invalid collection keeps action parent");

for (const incomplete of [
  'actions:\n  - action: light.turn_on\n    target: {',
  'triggers:\n  - trigger: state\n    entity_id: [',
  'blueprint:\n  name: \"unfinished',
  'sequence:\n  - choose:\n    - conditions: [',
]) {
  result = context(incomplete, "automations.yaml");
  assert.equal(typeof result.fileRole, "string");
  assert.ok(Array.isArray(result.path));
  assert.equal(result.parser === "yaml" || result.parser === "fallback", true);
}

result = context(`
- alias: False keys
  description: "triggers: actions: selector:"
  # conditions:
  variables:
    rendered: "{{ dict(trigger='state', action='light.turn_on') }}"
  actions:
    - action: light.turn_on
      data:
        mes`);
assert.equal(result.inAction, true);
assert.equal(result.inTrigger, false);
assert.equal(result.inCondition, false);
assert.equal(result.inSelector, false);
assert.equal(result.actionService, "light.turn_on");
assert.deepEqual(result.path, ["actions", "data"]);

const largeItems = Array.from({ length: 2500 }, (_, index) => `- alias: Automation ${index}\n  triggers: []\n  actions: []`).join("\n");
const largeSource = `${largeItems}\n- alias: Final\n  actions:\n    - action: light.turn_on\n      tar`;
const largeStartedAt = performance.now();
result = getStructuralYamlContext(largeSource, largeSource.split("\n").length - 1, { filePath: "automations.yaml" });
const largeElapsed = performance.now() - largeStartedAt;
assert.equal(result.inAction, true);
assert.ok(largeElapsed <= YAML_CONTEXT_LATENCY_BUDGET_MS, `large context took ${largeElapsed.toFixed(1)}ms`);
const cachedStartedAt = performance.now();
getStructuralYamlContext(largeSource, largeSource.split("\n").length - 1, { filePath: "automations.yaml" });
assert.ok(performance.now() - cachedStartedAt < 10, "unchanged large documents use the parse cache");

const oversizedSource = `${"# bounded\n".repeat(Math.ceil(YAML_CONTEXT_MAX_PARSE_CHARS / 10))}actions:\n  - action: light.turn_on\n    tar`;
result = getStructuralYamlContext(oversizedSource, oversizedSource.split("\n").length - 1, { filePath: "automations.yaml" });
assert.equal(result.parser, "fallback");
assert.equal(result.inAction, true);

const constants = fs.readFileSync(
  new URL("../../custom_components/blueprint_studio/www/modules/constants.js", import.meta.url),
  "utf8",
);
assert.ok((constants.match(/text: "entity_id:"/g) || []).length >= 4);
assert.match(constants, /text: "continue_on_error:"/);
assert.match(constants, /text: "response_variable:"/);
assert.match(constants, /"is_state"/);
assert.match(constants, /"label_entities"/);
assert.equal((source.match(/\.innerHTML\s*=/g) || []).length, 1, "only the static snippet renderer uses HTML");
assert.match(source, /value\.textContent = text/);
assert.match(source, /detail\.textContent = description/);
assert.match(source, /setAttribute\('role', 'listbox'\)/);
assert.match(source, /setAttribute\('role', 'option'\)/);
assert.match(source, /cm\.replaceRange\(item\.text, \{ line: cursor\.line, ch: start \}, \{ line: cursor\.line, ch: end \}\)/);

console.log("autocomplete context tests passed");
