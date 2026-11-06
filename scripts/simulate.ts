import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from '../src/simulation/scenarios';
import { runSuite } from '../src/simulation/suite';
import { buildArtifacts } from './balance-report';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
let out = path.join(root, 'docs/balance/generated');
let runs = 6;
let maxDays = 90;
let check = false;
const selected: string[] = [];
for (let index = 0; index < args.length; index += 1) {
  const flag = args[index];
  if (flag === '--check') { check = true; continue; }
  if (flag === '--help') {
    process.stdout.write('npm run simulate -- [--out DIR] [--scenario ID] [--runs 1..100] [--max-days DAYS] [--check]\n');
    process.stdout.write(SCENARIOS.map((scenario) => `${scenario.id}: ${scenario.label}`).join('\n') + '\n');
    process.exit(0);
  }
  if (!['--out', '--scenario', '--runs', '--max-days'].includes(flag ?? '')) throw new Error(`Unknown option: ${flag}`);
  const value = args[++index];
  if (!value || value.startsWith('--')) throw new Error(`Missing value: ${flag}`);
  if (flag === '--out') out = path.resolve(value);
  if (flag === '--scenario') selected.push(value);
  if (flag === '--runs') runs = Number(value);
  if (flag === '--max-days') maxDays = Number(value);
}
if (!Number.isFinite(maxDays) || maxDays <= 0 || maxDays > 365) throw new RangeError('max-days must be >0 and <=365.');
if (new Set(selected).size !== selected.length || selected.some((id) => !SCENARIOS.some((scenario) => scenario.id === id))) throw new RangeError('Unknown or duplicate scenario.');
const scenarios = selected.length > 0 ? selected.map((id) => SCENARIOS.find((scenario) => scenario.id === id)!) : SCENARIOS;
const modelFiles = ['src/core/state.ts', 'src/core/game.ts', 'src/core/skills.ts', 'src/core/prestige.ts', 'src/core/save.ts',
  'src/core/breakthrough.ts', 'src/data/scoreCaps.ts', 'src/data/balance.ts', 'src/data/equipment.ts', 'src/data/skills.ts'];
const hash = createHash('sha256');
for (const name of modelFiles) hash.update(name + '\n' + (await readFile(path.join(root, name), 'utf8')).replaceAll('\r\n', '\n') + '\n');
const suite = runSuite(scenarios, runs, maxDays * 86_400);
const artifacts = buildArtifacts(suite, hash.digest('hex'));
if (!check) await mkdir(out, { recursive: true });
for (const [name, content] of Object.entries(artifacts)) {
  const destination = path.join(out, name);
  if (check) {
    const existing = await readFile(destination, 'utf8').catch(() => null);
    if (existing?.replaceAll('\r\n', '\n') !== content) {
      process.stderr.write(`Stale simulation artifact: ${name}. Run npm run simulate.\n`);
      process.exitCode = 1;
    }
  } else await writeFile(destination, content, 'utf8');
}
for (const campaign of suite.campaigns) process.stdout.write(`${campaign.scenario.id}: ${campaign.completedRuns}/${runs} runs, ${(campaign.elapsedSeconds / 3_600).toFixed(3)}h\n`);
process.stdout.write(`${check ? 'Checked' : 'Wrote'} ${Object.keys(artifacts).length} artifacts: ${out}\n`);
