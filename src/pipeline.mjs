import fs from 'node:fs/promises';
import path from 'node:path';
import { dateInZone, metadataRejection, rankItems, mergeCandidates, validateConfig, visionAccepted } from './core.mjs';
import { launchBrowser, readVideo, captureFrames } from './browser.mjs';
import { reviewFrames, visionSettings } from './vision.mjs';
import { readJson, writeJson, saveReport } from './storage.mjs';

export async function bootstrap(root, config) {
  const manual = await readJson(path.join(root, 'seeds', 'manual.json'), null);
  const frontier = await readJson(path.join(root, 'seeds', 'frontier.json'), []);
  let state = await readJson(path.join(root, 'data', 'state.json'), null);
  if (!state) state = { seen: manual?.items.map(item => item.id) ?? [], frontier, processed: {}, reports: manual ? { [manual.date]: manual } : {} };
  await fs.mkdir(path.join(root, 'data', 'thumbnails'), { recursive: true });
  await fs.mkdir(path.join(root, 'site', 'assets'), { recursive: true });
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
    if (!manual) throw new Error('Manual verified seed is missing');
    const latest = state.reports[Object.keys(state.reports).sort().at(-1)] ?? manual;
    await saveReport(latest, state, config, root); return latest;
  }
  const previous = state.reports[date];
  if (previous?.status === 'complete' && !force && !probe) {
    await saveReport(previous, state, config, root); console.log('Today is already complete.'); return previous;
  }
  const hasVision = !!visionSettings(config).key;
  const seen = new Set(state.seen);
  const previousCandidates = new Set(Object.entries(state.reports).filter(([day]) => day < date).flatMap(([, value]) => value.candidates?.map(item => item.id) ?? []));
  const items = !force && previous?.status !== 'seed' ? [...(previous?.items ?? [])] : [];
  const queue = [...new Set([...config.referenceIds, ...state.frontier, ...(manual?.items.map(item => item.id) ?? [])])];
  const visited = new Set(); const errors = []; const rejected = {}; const pending = [];
  const excludedCandidates = new Set();
  let pages = 0, reviews = 0, browser, consecutiveErrors = 0;
  const started = Date.now();
  const maxPages = pageLimit ?? config.maxPages;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(config.pageTimeoutMs);
    while (queue.length && pages < maxPages && (probe || items.length < config.target) && pending.length < config.maxPending && Date.now() - started < config.maxSeconds * 1000) {
      const id = queue.shift(); if (visited.has(id)) continue;
      visited.add(id); pages++;
      try {
        const result = await readVideo(page, id, config, { root });
        consecutiveErrors = 0;
        for (const next of result.recommendations) if (!visited.has(next) && !queue.includes(next)) queue.push(next);
        if (seen.has(id) || config.referenceIds.includes(id)) continue;
        const item = result.item;
        const rejection = metadataRejection(item, config);
        if (rejection) { excludedCandidates.add(id); rejected[rejection] = (rejected[rejection] ?? 0) + 1; console.log(`${id}: ${rejection}`); continue; }
        if (!hasVision || probe) {
          if (!probe && previousCandidates.has(id)) continue;
          let thumbnail, frame_images;
          if (!probe) {
            const frames = await captureFrames(page, result.video, item, root);
            frame_images = [];
            for (const [index, frame] of frames.entries()) {
              const name = `${id}-${index}.jpg`;
              await fs.copyFile(frame, path.join(root, 'data', 'thumbnails', name));
              frame_images.push(`assets/${name}`);
            }
            thumbnail = frame_images[1];
          }
          pending.push({ ...item, thumbnail, frame_images, aspect_ratio: aspectRatio(item.width, item.height),
            verified_at: new Date().toISOString(), review_status: 'awaiting_visual_review' });
          console.log(`Collected candidate ${pending.length}/${config.maxPending}: ${id}`); continue;
        }
        if (reviews >= config.maxReviews) break;
        const processed = state.processed[id];
        if (processed?.date === date && processed.status === 'rejected') continue;
        const frames = await captureFrames(page, result.video, item, root); reviews++;
        const review = await reviewFrames(item, frames, config);
        const accepted = visionAccepted(review, config);
        excludedCandidates.add(id);
        state.processed[id] = { date, status: accepted ? 'accepted' : 'rejected', review };
        if (!accepted) { rejected['画面审核未通过'] = (rejected['画面审核未通过'] ?? 0) + 1; continue; }
        const thumbnail = `assets/${id}.jpg`;
        await fs.copyFile(frames[1], path.join(root, 'data', 'thumbnails', `${id}.jpg`));
        items.push({ ...item, camera_note: review.camera_note, style_score: review.style_score,
          verified_at: new Date().toISOString(), aspect_ratio: aspectRatio(item.width, item.height),
          thumbnail, verification: '自动画面审核', confidence: review.confidence });
        seen.add(id);
        console.log(`Verified ${items.length}/${config.target}: ${id}`);
      } catch (error) {
        const message = /^(VISION_|VIDEO_|DOUYIN_)/.test(String(error.message)) ? error.message : '公开详情页读取失败';
        errors.push({ id, reason: message, ...(error.source ? { source: error.source } : {}) }); console.warn(`${id}: ${message}`);
        consecutiveErrors++;
        if (/^VISION_HTTP_(?:401|403)|^VISION_NOT_CONFIGURED/.test(message)) break;
        if (/^DOUYIN_(?:VERIFICATION_REQUIRED|LOGIN_REQUIRED|HTTP_403)/.test(message)) break;
        if (consecutiveErrors >= (config.maxConsecutiveFailures ?? 6)) break;
      }
    }
  } catch (error) { errors.push({ reason: '浏览器启动失败，请检查运行环境' }); }
  finally { if (browser) await browser.close(); }
  if (probe) {
    const result = { pages, eligible_metadata: pending.length, errors, rejected };
    await writeJson(path.join(root, 'data', 'probe.json'), result); console.log(JSON.stringify(result)); return result;
  }
  // Unreviewed candidates remain in tomorrow's discovery queue; they are never promoted to selections.
  state.frontier = [...new Set([...pending.map(item => item.id), ...queue, ...visited])].filter(id => !config.referenceIds.includes(id)).slice(0, 800);
  state.seen = [...seen];
  const allFailed = errors.length > 0 && errors.length >= pages;
  const status = items.length >= config.target ? 'complete' : allFailed ? 'blocked' : !hasVision ? 'pending' : items.length || pages ? 'partial' : 'blocked';
  const candidates = mergeCandidates(previous?.candidates ?? [], pending, config, excludedCandidates);
  let report = {
    date, generated_at: new Date().toISOString(), status, target: config.target,
    items: rankItems(items, config).slice(0, config.target), candidates,
    criteria: { min_likes: config.minLikes, preferred_likes: config.preferredLikes, max_duration: config.maxDuration, portrait: true },
    stats: { pages, reviews, pending: pending.length, retained_candidates: candidates.length, rejected, errors: errors.length },
    notice: status === 'complete' ? '今日精选已更新' : status === 'blocked' ? '本次无法读取足够的公开详情页，稍后自动重试。' : !hasVision ? '独立采集已运行；新作品等待核对人物与运镜。' : items.length ? `已核实${items.length}条，还差${config.target - items.length}条。` : '本次未获得足够核验信息，稍后自动重试。',
    workflow_url: config.workflowUrl,
  };
  // Keep the initial human-verified day visible while the independent worker is being configured.
  if (previous?.status === 'seed' && report.items.length === 0) {
    report = { ...previous, generated_at: report.generated_at, collection_status: report.status, notice: report.notice, stats: report.stats, candidates: report.candidates };
  }
  await writeJson(path.join(root, 'data', 'pending.json'), candidates);
  await writeJson(path.join(root, 'data', 'run-errors.json'), errors);
  await saveReport(report, state, config, root);
  await fs.rm(path.join(root, 'data', 'frames'), { recursive: true, force: true });
  return report;
}

function aspectRatio(width, height) {
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height); return `${width / divisor}:${height / divisor}`;
}
