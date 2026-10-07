import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseDetail, validId, videoUrl } from './core.mjs';

export function largestVisibleVideoIndex(videos) {
  return videos.map((video, index) => {
    const box = video.getBoundingClientRect();
    return { index, width: box.width, height: box.height, area: box.width * box.height };
  }).filter(value => value.width > 100 && value.height > 100).sort((a, b) => b.area - a.area)[0]?.index ?? -1;
}

export async function launchBrowser() {
  // A local bundled runtime may be supplied without changing production dependencies.
  const require = createRequire(import.meta.url);
  const { chromium } = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : await import('playwright');
  return chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
}

export function sourceFailure(body, http = 200, fallback = 'VIDEO_UNAVAILABLE') {
  if (/安全验证|请完成.{0,15}验证|拖动滑块|访问过于频繁|访问受限/.test(body)) return 'DOUYIN_VERIFICATION_REQUIRED';
  if (/请登录后观看|登录后才可观看|请先登录才能观看/.test(body)) return 'DOUYIN_LOGIN_REQUIRED';
  if (http >= 400) return `DOUYIN_HTTP_${http}`;
  return fallback;
}

export function retryableSourceFailure(reason) {
  return /^(?:VIDEO_UNAVAILABLE|VIDEO_METADATA_UNAVAILABLE|DOUYIN_NAVIGATION_TIMEOUT|DOUYIN_NAVIGATION_FAILED|DOUYIN_HTTP_5\d\d)$/.test(reason);
}

async function sourceSnapshot(page, http) {
  return page.evaluate(http => ({
    http, title: document.title, path: location.pathname,
    body_excerpt: document.body.innerText.slice(0, 1800),
    videos: [...document.querySelectorAll('video')].map(v => {
      const box = v.getBoundingClientRect();
      return { visible: box.width > 100 && box.height > 100, width: v.videoWidth, height: v.videoHeight,
        duration: Number.isFinite(v.duration) ? v.duration : null, ready: v.readyState, media_error: v.error?.code ?? null };
    })
  }), http).catch(() => ({ http, unavailable: true }));
}

export async function readVideo(page, id, config, { root = '.' } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await readVideoAttempt(page, id, config); }
    catch (error) {
      const source = await sourceSnapshot(page, error.http ?? null);
      let reason = /^(VIDEO_|DOUYIN_)/.test(error.message) ? error.message
        : error.name === 'TimeoutError' ? 'DOUYIN_NAVIGATION_TIMEOUT' : 'DOUYIN_NAVIGATION_FAILED';
      reason = sourceFailure(source.body_excerpt ?? '', source.http ?? 200, reason);
      if (attempt === 0 && retryableSourceFailure(reason)) {
        console.warn(`${id}: ${reason}, retrying once`);
        await page.waitForTimeout(1500);
        continue;
      }
      const directory = path.join(root, 'data', 'diagnostics');
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, `${id}.json`), JSON.stringify({ reason, ...source }, null, 2));
      await page.screenshot({ path: path.join(directory, `${id}.jpg`), type: 'jpeg', quality: 60, timeout: 5000 }).catch(() => {});
      const failure = new Error(reason); failure.source = source; throw failure;
    }
  }
}

async function readVideoAttempt(page, id, config) {
  const response = await page.goto(videoUrl(id), { waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs });
  const http = response?.status() ?? 200;
  if (http >= 400) { const error = new Error(`DOUYIN_HTTP_${http}`); error.http = http; throw error; }
  await page.waitForTimeout(2500);
  const body = await page.locator('body').innerText();
  if (body.includes('登录后免费畅享高清视频')) await page.mouse.click(963, 249);
  await page.waitForFunction(() => [...document.querySelectorAll('video')].some(v => {
    const rect = v.getBoundingClientRect(); return rect.width > 100 && rect.height > 100 && v.videoWidth > 0 && Number.isFinite(v.duration);
  }) || /安全验证|请完成.{0,15}验证|拖动滑块|访问过于频繁|访问受限/.test(document.body.innerText), undefined, { timeout: config.playerTimeoutMs ?? 20000 }).catch(() => {});
  const loadedBody = await page.locator('body').innerText();
  const index = await page.locator('video').evaluateAll(largestVisibleVideoIndex);
  if (index < 0) throw new Error(sourceFailure(loadedBody, http));
  const video = page.locator('video').nth(index);
  const media = await video.evaluate(v => { v.pause(); return { width: v.videoWidth, height: v.videoHeight, duration: v.duration }; });
  if (!media.width || !Number.isFinite(media.duration)) throw new Error(sourceFailure(loadedBody, http, 'VIDEO_METADATA_UNAVAILABLE'));
  if (!new URL(page.url()).pathname.includes(`/video/${id}`)) throw new Error('VIDEO_CHANGED_DURING_LOAD');
  const currentBody = await page.locator('body').innerText();
  const recommendations = await page.locator('a[href*="/video/"]').evaluateAll(as => [...new Set(as.filter(a => /^\s*(?:付费\s*)?00:(?:0[0-9]|1[0-5])\b/.test(a.innerText)).map(a => a.href.match(/\/video\/(\d+)/)?.[1]).filter(Boolean))]);
  return { item: parseDetail(currentBody, id, media), video, recommendations: recommendations.filter(validId) };
}

export async function captureFrames(page, video, item, root = '.') {
  const directory = path.join(root, 'data', 'frames', item.id);
  await fs.mkdir(directory, { recursive: true });
  const files = [];
  for (const [index, fraction] of [0.05, 0.35, 0.65, 0.95].entries()) {
    const time = Math.min(item.duration_seconds - 0.08, item.duration_seconds * fraction);
    await video.evaluate((v, time) => new Promise(resolve => {
      const finish = () => { v.removeEventListener('seeked', finish); resolve(); };
      v.addEventListener('seeked', finish, { once: true }); v.pause(); v.currentTime = time;
      setTimeout(finish, 1800);
    }), time);
    await page.waitForTimeout(250);
    const box = await video.boundingBox();
    if (!box || box.height < 100 || box.width < 100) throw new Error('FRAME_UNAVAILABLE');
    // Crop only the displayed portrait image; do not infer orientation from this box.
    const ratio = item.width / item.height;
    const width = Math.min(box.width, box.height * ratio);
    const height = Math.min(box.height, box.width / ratio);
    const clip = { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
    const file = path.join(directory, `${index}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 75, clip, timeout: 5000 });
    files.push(file);
  }
  return files;
}
