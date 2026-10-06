import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseDetail, validId, videoUrl } from './core.mjs';

export async function launchBrowser() {
  // A local bundled runtime may be supplied without changing production dependencies.
  const require = createRequire(import.meta.url);
  const { chromium } = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : await import('playwright');
  return chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
}

export async function readVideo(page, id, config) {
  await page.goto(videoUrl(id), { waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs });
  await page.waitForTimeout(2500);
  const body = await page.locator('body').innerText();
  if (body.includes('登录后免费畅享高清视频')) await page.mouse.click(963, 249);
  await page.waitForFunction(() => [...document.querySelectorAll('video')].some(v => {
    const rect = v.getBoundingClientRect(); return rect.width > 100 && rect.height > 100 && v.videoWidth > 0 && Number.isFinite(v.duration);
  }), undefined, { timeout: 8000 }).catch(() => {});
  const index = await page.locator('video').evaluateAll(vs => vs.map((v, i) => ({ i, area: v.getBoundingClientRect().width * v.getBoundingClientRect().height })).sort((a, b) => b.area - a.area)[0]?.i ?? -1);
  if (index < 0) throw new Error(/安全验证|请完成.*验证|拖动滑块/.test(body) ? 'DOUYIN_VERIFICATION_REQUIRED' : 'VIDEO_UNAVAILABLE');
  const video = page.locator('video').nth(index);
  const media = await video.evaluate(v => { v.pause(); return { width: v.videoWidth, height: v.videoHeight, duration: v.duration }; });
  if (!media.width || !Number.isFinite(media.duration)) throw new Error(/安全验证|请完成.*验证|拖动滑块/.test(body) ? 'DOUYIN_VERIFICATION_REQUIRED' : 'VIDEO_METADATA_UNAVAILABLE');
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
