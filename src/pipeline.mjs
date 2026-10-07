import fs from 'node:fs/promises';
import path from 'node:path';
import { dateInZone, metadataRejection, mergeItems, validateConfig } from './core.mjs';
import { normalizeItem, normalizeReport } from './reports.mjs';
import { launchBrowser, readVideo, captureThumbnail } from './browser.mjs';
import { readJson, writeJson, saveReport } from './storage.mjs';

export async function bootstrap(root, config) {
  const seed = await readJson(path.join(root, 'seeds', 'manual.json'), null);
  const manual = seed ? normalizeReport(seed, config) : null;
  const frontier = await readJson(path.join(root, 'seeds', 'frontier.json'), []);
  const cached = await readJson(path.join(root, 'data', 'state.json'), null);
  const reports = Object.fromEntries(Object.entries(cached?.reports ?? (manual ? { [manual.date]: manual } : {}))
    .map(([day, report]) => [day, normalizeReport(report, config)]));
  const state = { seen: [...new Set([...(cached?.seen ?? []), ...Object.values(reports).flatMap(r => r.items.map(i => i.id))])],
    frontier: cached?.frontier ?? frontier, reports };
  await fs.mkdir(path.join(root, 'data', 'thumbnails'), { recursive: true });
  await fs.mkdir(path.join(root, 'site', 'assets'), { recursive: true });
  await fs.rm(path.join(root, 'data', 'pending.json'), { force: true });
  await fs.rm(path.join(root, 'data', 'frames'), { recursive: true, force: true });
  if (manual) {
    for (const item of manual.items) {
      try { await fs.copyFile(path.join(root, 'seeds', 'thumbnails', `${item.id}.jpg`), path.join(root, 'data', 'thumbnails', `${item.id}.jpg`)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  return { state, manual };
}

export async function runPipeline({ root = '.', config, seedOnly = false, force = false, probe = false, pageLimit, now = new Date() }) {
  validateConfig(config);
  const date = dateInZone(now, config.timezone);
  const { state, manual } = await bootstrap(root, config);
  if (seedOnly) {
    if (!manual) throw new Error('Initial seed is missing');
    const latest = state.reports[Object.keys(state.reports).sort().at(-1)] ?? manual;
    await saveReport(latest, state, config, root); return latest;
  }
  const previous = state.reports[date];
  if (previous?.status === 'complete' && !force && !probe) {
    await saveReport(previous, state, config, root); console.log('Today is already complete.'); return previous;
  }
  const seen = new Set(state.seen);
  if (force) for (const item of previous?.items ?? []) seen.delete(item.id);
  let items = force ? [] : [...(previous?.items ?? [])];
  const queue = [...new Set([...config.referenceIds, ...state.frontier, ...(manual?.items.map(item => item.id) ?? [])])];
  const visited = new Set(), excluded = new Set(), errors = [], rejected = {};
  let pages = 0, collected = 0, eligible = 0, thumbnailErrors = 0, browser, consecutiveErrors = 0;
  const started = Date.now(), maxPages = pageLimit ?? config.maxPages;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(config.pageTimeoutMs);
    while (queue.length && pages < maxPages && (probe || items.length < config.target) && Date.now() - started < config.maxSeconds * 1000) {
      const id = queue.shift(); if (visited.has(id)) continue;
      visited.add(id); pages++;
      try {
        const result = await readVideo(page, id, config, { root });
        consecutiveErrors = 0;
        for (const next of result.recommendations) if (!visited.has(next) && !queue.includes(next)) queue.push(next);
        if (seen.has(id) || config.referenceIds.includes(id)) continue;
        const item = result.item, rejection = metadataRejection(item, config);
        if (rejection) { excluded.add(id); rejected[rejection] = (rejected[rejection] ?? 0) + 1; console.log(`${id}: ${rejection}`); continue; }
        eligible++;
        if (probe) continue;
        let thumbnail;
        try { thumbnail = await captureThumbnail(page, result.video, item, root); }
        catch { thumbnailErrors++; console.warn(`${id}: cover unavailable; keeping valid video metadata`); }
        const selected = normalizeItem({ ...item, thumbnail, aspect_ratio: aspectRatio(item.width, item.height), collected_at: new Date().toISOString() });
        items = mergeItems(items, [selected], config); seen.add(id); collected++;
        console.log(`Collected video ${items.length}/${config.target}: ${id}`);
      } catch (error) {
        const message = /^(VIDEO_|DOUYIN_)/.test(String(error.message)) ? error.message : '公开详情页读取失败';
        errors.push({ id, reason: message, ...(error.source ? { source: error.source } : {}) }); console.warn(`${id}: ${message}`);
        consecutiveErrors++;
        if (/^DOUYIN_(?:VERIFICATION_REQUIRED|LOGIN_REQUIRED|HTTP_403)/.test(message)) break;
        if (consecutiveErrors >= (config.maxConsecutiveFailures ?? 6)) break;
      }
    }
  } catch { errors.push({ reason: '浏览器运行失败，请检查运行环境' }); }
  finally { if (browser) await browser.close(); }
  if (probe) {
    const result = { pages, eligible_metadata: eligible, errors, rejected };
    await writeJson(path.join(root, 'data', 'probe.json'), result); console.log(JSON.stringify(result)); return result;
  }
  items = mergeItems(previous?.items ?? [], items, config, excluded);
  state.frontier = [...new Set([...queue, ...visited])].filter(id => !config.referenceIds.includes(id)).slice(0, 800);
  state.seen = [...new Set([...state.seen, ...items.map(i => i.id)])];
  const allFailed = errors.length > 0 && errors.length >= pages;
  const report = normalizeReport({ date, generated_at: new Date().toISOString(), items,
    status: allFailed ? 'blocked' : items.length >= config.target ? 'complete' : 'partial',
    stats: { pages, collected, thumbnail_errors: thumbnailErrors, rejected, errors: errors.length } }, config);
  await writeJson(path.join(root, 'data', 'run-errors.json'), errors);
  await saveReport(report, state, config, root);
  await fs.rm(path.join(root, 'data', 'pending.json'), { force: true });
  await fs.rm(path.join(root, 'data', 'frames'), { recursive: true, force: true });
  return report;
}

function aspectRatio(width, height) {
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height); return `${width / divisor}:${height / divisor}`;
}
