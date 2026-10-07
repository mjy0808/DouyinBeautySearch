import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeReport } from './reports.mjs';

export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n');
  await fs.rename(temp, file);
}

export async function saveReport(report, state, config, root = '.') {
  report = normalizeReport(report, config);
  const site = path.join(root, 'site');
  const reports = Object.fromEntries(Object.entries({ ...(state.reports ?? {}), [report.date]: report })
    .map(([day, value]) => [day, normalizeReport(value, config)]));
  const days = Object.keys(reports).sort().reverse().slice(0, config.retentionDays);
  state.reports = Object.fromEntries(days.map(day => [day, reports[day]]));
  for (const day of days) await writeJson(path.join(site, 'archive', `${day}.json`), reports[day]);
  await writeJson(path.join(site, 'data', 'latest.json'), report);
  await writeJson(path.join(site, 'data', 'archive.json'), days.map(day => ({
    date: day, count: reports[day].items.length, status: reports[day].status,
  })));
  // Rebuild historic thumbnails from cached state; deployment never loses yesterday's images.
  for (const value of Object.values(state.reports)) {
    for (const item of value.items) {
      if (item.thumbnail?.startsWith('assets/')) {
        try { await fs.copyFile(path.join(root, 'data', 'thumbnails', path.basename(item.thumbnail)), path.join(site, item.thumbnail)); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  }
  const used = new Set(Object.values(state.reports).flatMap(r => r.items.map(i => path.basename(i.thumbnail ?? ''))));
  for (const directory of [path.join(site, 'assets'), path.join(root, 'data', 'thumbnails')]) {
    for (const name of await fs.readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
      if (/^\d{18,20}(?:-\d)?\.jpg$/.test(name) && !used.has(name)) await fs.rm(path.join(directory, name));
    }
  }
  await writeJson(path.join(root, 'data', 'state.json'), state);
}
