import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(
  new URL("../../custom_components/blueprint_studio/www/modules/ha-autocomplete.js", import.meta.url),
  "utf8",
);
const prefixStart = source.indexOf("export function getCompletionPrefix");
const prefixEnd = source.indexOf("\n\n/**", prefixStart);
const prefixSource = source.slice(prefixStart, prefixEnd).replace(/export function/g, "function");
const functionStart = source.indexOf("export function getYamlContext");
const functionEnd = source.indexOf("\nexport function defineHAYamlMode", functionStart);
const functionSource = source.slice(functionStart, functionEnd).replace("export function", "function");
const sandbox = {};
vm.runInNewContext(
  `${prefixSource}\n${functionSource}\nthis.getCompletionPrefix = getCompletionPrefix; this.filterSchemaSuggestions = filterSchemaSuggestions; this.getYamlContext = getYamlContext;`,
  sandbox,
);
const { getCompletionPrefix, filterSchemaSuggestions, getYamlContext } = sandbox;

assert.deepEqual(
  { ...getCompletionPrefix("  con", 5) },
  { text: "con", start: 2 },
);
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

function context(source) {
  const lines = source.replace(/^\n/, "").split("\n");
  return getYamlContext({
    getLine: index => lines[index] ?? "",
    lineCount: () => lines.length,
  }, lines.length - 1);
}

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

const constants = fs.readFileSync(
  new URL("../../custom_components/blueprint_studio/www/modules/constants.js", import.meta.url),
  "utf8",
);
assert.ok((constants.match(/text: "entity_id:"/g) || []).length >= 4);
assert.match(constants, /text: "continue_on_error:"/);
assert.match(constants, /text: "response_variable:"/);

console.log("autocomplete context tests passed");
