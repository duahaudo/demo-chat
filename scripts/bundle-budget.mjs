/**
 * Initial-JS budget (TECHNICAL-DESIGN §8). The threshold in `bundle-budget.json` was set at the
 * first green build; a regression fails the job rather than landing quietly. Gzip, because that is
 * what crosses the wire.
 *
 * Raising the number is a decision, not a fix: say in the pull request what bought the bytes.
 */
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const ASSETS = 'dist/assets';
const budget = JSON.parse(readFileSync('bundle-budget.json', 'utf8'));

const files = readdirSync(ASSETS)
  .filter((name) => name.endsWith('.js'))
  .map((name) => {
    const gzip = gzipSync(readFileSync(join(ASSETS, name))).byteLength;
    return { name, gzip };
  })
  .sort((a, b) => b.gzip - a.gzip);

const total = files.reduce((sum, file) => sum + file.gzip, 0);
const limit = budget.initialJsGzipBytes;
const over = total > limit;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

const report = [
  `### Bundle budget — ${over ? '❌ over' : '✅ within'} budget`,
  '',
  `Initial JS, gzipped: **${kb(total)}** of ${kb(limit)} (${((total / limit) * 100).toFixed(0)}%).`,
  '',
  '| File | gzip |',
  '| ---- | ---- |',
  ...files.map((file) => `| \`${file.name}\` | ${kb(file.gzip)} |`),
].join('\n');

console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);

if (over) {
  console.error(
    `::error::Initial JS is ${kb(total)}, over the ${kb(limit)} budget. Cut it, or raise the budget deliberately.`,
  );
  process.exit(1);
}
