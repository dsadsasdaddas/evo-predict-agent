import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(root, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const errors = [];

if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
if (!manifest.background?.service_worker) errors.push('background.service_worker required');
if (!Array.isArray(manifest.content_scripts) || manifest.content_scripts.length === 0) errors.push('content_scripts required');
if (!Array.isArray(manifest.host_permissions) || !manifest.host_permissions.some((host) => host.includes('100.70.188.115:8878'))) errors.push('hosted server permission missing');

const referencedFiles = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...manifest.content_scripts.flatMap((script) => script.js || []),
  'src/popup.js',
  'src/popup.css'
].filter(Boolean);

for (const file of referencedFiles) {
  if (!existsSync(resolve(root, file))) errors.push(`missing referenced file: ${file}`);
}

for (const file of ['src/background.js', 'src/content-script.js', 'src/popup.js']) {
  const code = await readFile(resolve(root, file), 'utf8');
  if (/\beval\s*\(/.test(code)) errors.push(`${file} uses eval`);
  if (/innerHTML\s*=/.test(code) && file !== 'src/popup.js') errors.push(`${file} writes innerHTML outside popup`);
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log('browser-extension manifest OK');
