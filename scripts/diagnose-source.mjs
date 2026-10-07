import fs from 'node:fs/promises';
import { launchBrowser } from '../src/browser.mjs';
import config from '../config.json' with { type: 'json' };

await fs.mkdir('data/diagnostics', { recursive: true });
const browser = await launchBrowser();
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  for (const id of config.referenceIds) {
    const failures = [];
    const failed = request => {
      const u = new URL(request.url());
      if (failures.length < 20) failures.push({ host: u.host, type: request.resourceType(), error: request.failure()?.errorText });
    };
    page.on('requestfailed', failed);
    const started = Date.now();
    const result = { id, snapshots: [] };
    try {
      const response = await page.goto(`https://www.douyin.com/video/${id}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      result.http = response?.status();
      for (const delay of [2500, 10000, 15000]) {
        await page.waitForTimeout(delay);
        result.snapshots.push(await page.evaluate(() => ({
          title: document.title, path: location.pathname,
          body: document.body.innerText.slice(0, 2200),
          videos: [...document.querySelectorAll('video')].map(v => {
            const rect = v.getBoundingClientRect();
            return { box: [rect.width, rect.height], width: v.videoWidth, height: v.videoHeight,
              duration: Number.isFinite(v.duration) ? v.duration : null,
              ready: v.readyState, error: v.error?.code ?? null };
          })
        })));
      }
      await page.screenshot({ path: `data/diagnostics/${id}.jpg`, type: 'jpeg', quality: 65 });
    } catch (error) { result.error = error.message.slice(0, 200); }
    result.elapsed_ms = Date.now() - started;
    result.network_failures = failures;
    page.off('requestfailed', failed);
    results.push(result);
    console.log(JSON.stringify(result));
  }
} finally { await browser.close(); }
await fs.writeFile('data/diagnostics/source.json', JSON.stringify(results, null, 2));
