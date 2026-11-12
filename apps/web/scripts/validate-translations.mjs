import { readdir, readFile } from 'node:fs/promises';

const directory = new URL('../public/i18n/', import.meta.url);
const files = (await readdir(directory)).filter(file => file.endsWith('.json')).sort();
if (!files.length) throw new Error('No translation dictionaries found');
let reference;
for (const file of files) {
  const dictionary = JSON.parse(await readFile(new URL(file, directory), 'utf8'));
  if (!dictionary || typeof dictionary !== 'object' || Array.isArray(dictionary)
    || Object.values(dictionary).some(value => typeof value !== 'string')) {
    throw new Error(`${file}: dictionary must be an object containing only strings`);
  }
  const keys = Object.keys(dictionary).sort();
  if (reference && JSON.stringify(keys) !== JSON.stringify(reference)) {
    const missing = reference.filter(key => !keys.includes(key));
    const extra = keys.filter(key => !reference.includes(key));
    throw new Error(`${file}: mismatched keys; missing: ${missing.join(', ')}; extra: ${extra.join(', ')}`);
  }
  reference = keys;
}
console.log(`Validated ${files.length} translation dictionaries (${reference.length} keys each).`);
