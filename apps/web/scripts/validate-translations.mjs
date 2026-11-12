import { readdir, readFile } from 'node:fs/promises';

const directory = new URL('../public/i18n/', import.meta.url);
const files = (await readdir(directory)).filter(file => file.endsWith('.json')).sort();
if (!files.length) throw new Error('No translation dictionaries found');
let reference;
let referenceDictionary;
const placeholders = text => [...new Set(Array.from(text.matchAll(/\{\{\s*(\w+)\s*}}/g), match => match[1]))].sort();
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
  if (referenceDictionary) {
    for (const key of keys) {
      if (JSON.stringify(placeholders(dictionary[key])) !== JSON.stringify(placeholders(referenceDictionary[key]))) {
        throw new Error(`${file}: mismatched placeholders for ${key}`);
      }
    }
  }
  referenceDictionary = dictionary;
}
const sourceRoot = new URL('../src/app/', import.meta.url);
for (const file of await readdir(sourceRoot, { recursive: true })) {
  if (!/\.(html|ts)$/.test(file) || file.endsWith('.spec.ts')) continue;
  const source = await readFile(new URL(file.replaceAll('\\', '/'), sourceRoot), 'utf8');
  for (const match of source.matchAll(/['"]((?:ui|a11y|time|round|ordinal|jobs|language|navigation|notifications)\.[\w.-]+)['"]/g)) {
    const key = match[1];
    if (!key.endsWith('.') && !Object.hasOwn(referenceDictionary, key)) {
      throw new Error(`${file}: unknown translation key ${key}`);
    }
  }
}
console.log(`Validated ${files.length} translation dictionaries (${reference.length} keys each).`);
