import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

const required = [
  'apps/api/package.json',
  'apps/web/package.json',
  '.codex/hooks.json',
  '.claude/settings.json',
  'packages/evomate-sidecar/package.json'
];

const missing = required.filter((item) => !existsSync(path.join(repoRoot, item)));
if (missing.length) {
  console.error(`Missing desktop runtime dependency files:\n${missing.join('\n')}`);
  process.exit(1);
}

console.log('desktop runtime files ok');
