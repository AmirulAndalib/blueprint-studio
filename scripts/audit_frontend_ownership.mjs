import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../custom_components/blueprint_studio/www/modules/app.js', import.meta.url), 'utf8');
const localDefinitions = app.match(/^(?:export\s+)?(?:async\s+)?function\s+\w+/gm) || [];
const hasCompatibilityExport = app.includes('export {') && app.includes('initializeEventHandlers');
console.log(`app.js local feature definitions: ${localDefinitions.length}`);
console.log(`app.js compatibility export surface: ${hasCompatibilityExport ? 'present' : 'missing'}`);
if (localDefinitions.length || !hasCompatibilityExport) throw new Error('app.js must remain a compatibility export surface, not a second feature implementation');
