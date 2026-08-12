import { readFile } from 'node:fs/promises';

const root = new URL('../custom_components/blueprint_studio/www/modules/', import.meta.url);
const checks = [
  ['ai-ui.js', 'document.querySelectorAll(\'[data-ai-mode]\')', 'AI mode controls are scoped to #ai-sidebar'],
  ['split-view.js', 'document.querySelectorAll(\'.tab.drop-target', 'Split drag state is scoped to tab containers'],
  ['translations.js', 'document.querySelectorAll(".search-mode-tab")', 'Search tabs are scoped to #view-search'],
  ['ui.js', 'document.querySelectorAll(".theme-menu-item")', 'Theme items are scoped to the theme menu'],
  ['coordinators/UICoordinator.js', 'document.querySelectorAll(".tree-item.active")', 'Tree active state is scoped to #file-tree'],
  ['git-diff.js', 'document.querySelectorAll(".git-history-item")', 'Git history is scoped to the active modal'],
];
const failures = [];
for (const [file, forbidden, explanation] of checks) {
  const source = await readFile(new URL(file, root), 'utf8');
  if (source.includes(forbidden)) failures.push(`${file}: ${explanation}`);
  else console.log(`PASS ${file}: ${explanation}`);
}
if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exitCode = 1;
}
