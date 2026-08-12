import { readFile } from 'node:fs/promises';

const root = new URL('../custom_components/blueprint_studio/www/modules/', import.meta.url);
const contracts = [
  ['global-search.js', 'AbortController', 'stale search cancellation'],
  ['downloads-uploads.js', 'AbortController', 'transfer cancellation'],
  ['api.js', 'Session expired. Please login again.', 'expired Home Assistant authentication'],
  ['github-integration.js', 'GitHub authentication is no longer valid', 'expired provider authentication'],
  ['activity-rail.js', "'unavailable'", 'unavailable feature state'],
  ['problems.js', "validation:stale", 'stale validation results'],
  ['ha-autocomplete.js', "type: 'stale'", 'stale Home Assistant metadata'],
];
for (const [file, marker, description] of contracts) {
  const source = await readFile(new URL(file, root), 'utf8');
  if (!source.includes(marker)) throw new Error(`${description} contract missing in ${file}`);
  console.log(`PASS ${description}`);
}
