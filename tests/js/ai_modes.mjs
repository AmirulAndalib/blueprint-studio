import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('custom_components/blueprint_studio/www/panels/panel_custom.html', 'utf8');
const aiUi = fs.readFileSync('custom_components/blueprint_studio/www/modules/ai-ui.js', 'utf8');
const modes = ['ask', 'explain', 'generate', 'fix', 'refactor'];

for (const mode of modes) {
  assert.match(html, new RegExp(`data-ai-mode="${mode}"`), `${mode} mode button is missing`);
}
assert.match(aiUi, /const AI_TASK_MODES = new Set\(\['ask', 'explain', 'generate', 'fix', 'refactor'\]\)/);
assert.match(aiUi, /button\.addEventListener\('click', \(\) => setAiTaskMode\(button\.dataset\.aiMode\)\)/);
assert.match(aiUi, /button\.setAttribute\('aria-pressed', String\(selected\)\)/);
console.log('AI mode wiring tests passed');
