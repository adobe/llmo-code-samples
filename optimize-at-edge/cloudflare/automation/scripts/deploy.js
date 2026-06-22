#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const wranglerTomlPath = resolve(root, 'wrangler.toml');
const wranglerToml = readFileSync(wranglerTomlPath, 'utf8');

function extractVar(name) {
  const match = wranglerToml.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"`, 'm'));
  if (!match) {
    throw new Error(`Missing required var "${name}" in wrangler.toml [vars] section.`);
  }
  return match[1];
}

const route = extractVar('CF_ROUTE');
const zone = extractVar('CF_ZONE');

const routesBlock = `\nroutes = [\n  { pattern = "${route}", zone_name = "${zone}" }\n]\n`;
const absoluteMain = resolve(root, 'src/worker.js');
const generated = wranglerToml
  .replace(/^main\s*=\s*"[^"]+"/m, `main = "${absoluteMain}"`)
  .replace(/(\n\[observability\])/, `${routesBlock}$1`);

const outDir = resolve(root, '.wrangler');
const outFile = resolve(outDir, 'wrangler.generated.toml');
mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, generated);

console.log(`Deploying with route: ${route} (zone: ${zone})`);
const result = spawnSync('npx', ['wrangler', 'deploy', '--config', outFile], {
  stdio: 'inherit',
  cwd: root,
  shell: true,
});
process.exit(result.status ?? 1);
