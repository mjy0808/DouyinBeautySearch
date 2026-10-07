import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeReport } from '../src/reports.mjs';
import { readJson, writeJson } from '../src/storage.mjs';
import config from '../config.json' with { type: 'json' };

const reports = [];
const directory = 'site/archive';
for (const name of await fs.readdir(directory)) {
  if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
  const file = path.join(directory, name);
  const report = normalizeReport(await readJson(file), config);
  await writeJson(file, report); reports.push(report);
}
const latest = normalizeReport(await readJson('site/data/latest.json'), config);
await writeJson('site/data/latest.json', latest);
await writeJson('site/data/archive.json', reports.sort((a,b) => b.date.localeCompare(a.date))
  .map(r => ({date:r.date,count:r.items.length,status:r.status})));
const used = new Set([latest, ...reports].flatMap(r => r.items.map(i => path.basename(i.thumbnail ?? ''))));
for (const name of await fs.readdir('site/assets')) {
  if (/^\d{18,20}(?:-\d)?\.jpg$/.test(name) && !used.has(name)) await fs.rm(path.join('site/assets', name));
}
console.log(`Built ${latest.date}: ${latest.items.length} videos`);
