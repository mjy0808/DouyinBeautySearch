import fs from 'node:fs/promises';
import path from 'node:path';

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
  const site = path.join(root, 'site');
  const reports = { ...(state.reports ?? {}), [report.date]: report };
  const days = Object.keys(reports).sort().reverse().slice(0, config.retentionDays);
  state.reports = Object.fromEntries(days.map(day => [day, reports[day]]));
  for (const day of days) await writeJson(path.join(site, 'archive', `${day}.json`), reports[day]);
  await writeJson(path.join(site, 'data', 'latest.json'), report);
  await writeJson(path.join(site, 'data', 'archive.json'), days.map(day => ({
    date: day, count: reports[day].items.length, status: reports[day].status,
  })));
  // Rebuild historic thumbnails from cached state; deployment never loses yesterday's images.
  for (const value of Object.values(state.reports)) {
    for (const item of [...value.items, ...(value.candidates ?? [])]) {
      if (item.thumbnail?.startsWith('assets/')) {
        try { await fs.copyFile(path.join(root, 'data', 'thumbnails', path.basename(item.thumbnail)), path.join(site, item.thumbnail)); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      for (const image of item.frame_images ?? []) {
        if (!/^assets\/[\d-]+\.jpg$/.test(image)) continue;
        try { await fs.copyFile(path.join(root, 'data', 'thumbnails', path.basename(image)), path.join(site, image)); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  }
  await writeJson(path.join(root, 'data', 'state.json'), state);
}
