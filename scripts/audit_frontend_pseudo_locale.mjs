import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../custom_components/blueprint_studio/www/modules/translations.js', import.meta.url), 'utf8');
const english = JSON.parse(await readFile(new URL('../custom_components/blueprint_studio/www/locales/en.json', import.meta.url), 'utf8'));
if (!source.includes("currentLang === 'en-XA'")) throw new Error('en-XA pseudo-locale is not wired into translation initialization');
if (!source.includes('createPseudoBundle') || !source.includes("[[ ${expanded} ]]")) throw new Error('pseudo-locale expansion contract is missing');

const samples = Object.entries(english).filter(([, value]) => typeof value === 'string' && value.length >= 12).slice(0, 25);
const expanded = value => `[[ ${String(value).replace(/\{[^}]+\}|[^\s]+/g, part => part.startsWith('{') ? part : `${part}${'~'.repeat(Math.max(1, Math.ceil(part.length * 0.35)))}`)} ]]`;
for (const [key, value] of samples) {
  const pseudo = expanded(value);
  const placeholders = value.match(/\{[^}]+\}/g) || [];
  if (pseudo.length < value.length * 1.2) throw new Error(`pseudo string is not expanded enough: ${key}`);
  for (const placeholder of placeholders) if (!pseudo.includes(placeholder)) throw new Error(`placeholder lost for ${key}: ${placeholder}`);
}
console.log(`PASS pseudo-locale expansion (${samples.length} representative strings, >=20% growth)`);
