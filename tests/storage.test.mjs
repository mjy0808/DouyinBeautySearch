import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveReport, readJson } from '../src/storage.mjs';
import { runPipeline } from '../src/pipeline.mjs';
import config from '../config.json' with { type: 'json' };
test('archive survives partial days and preserves original verification timestamps', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'beauty-state-'));
  try {
    const old = { date: '2026-10-05', status: 'complete', items: [], generated_at: '2026-10-05T03:00:00Z' };
    const state = { reports: { [old.date]: old } };
    const report = { date: '2026-10-06', status: 'pending', items: [], candidates: [] };
    await saveReport(report, state, config, root);
    assert.equal((await readJson(path.join(root, 'site/data/latest.json'))).status, 'pending');
    assert.equal((await readJson(path.join(root, 'site/archive/2026-10-05.json'))).generated_at, old.generated_at);
    assert.equal((await readJson(path.join(root, 'site/data/archive.json'))).length, 2);
    await fs.mkdir(path.join(root, 'seeds'), { recursive: true });
    await fs.writeFile(path.join(root, 'seeds/manual.json'), JSON.stringify({ date: '2026-10-04', status: 'seed', items: [] }));
    const built = await runPipeline({ root, config, seedOnly: true });
    assert.equal(built.date, '2026-10-06'); // startup must not reset the latest report to the seed date
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('missing file uses fallback but corrupt state is reported', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'beauty-json-'));
  try {
    assert.deepEqual(await readJson(path.join(root, 'missing.json'), []), []);
    await fs.writeFile(path.join(root, 'bad.json'), '{bad');
    await assert.rejects(readJson(path.join(root, 'bad.json'), {}));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('a blocked second run cannot erase the 40 candidates already saved today', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'beauty-retry-'));
  const previousModule = process.env.PLAYWRIGHT_MODULE;
  try {
    const fake = path.join(root, 'blocked-browser.cjs');
    await fs.writeFile(fake, `module.exports = { chromium: { launch: async () => ({
      newPage: async () => ({
        setDefaultTimeout() {}, goto: async () => ({status: () => 403}),
        evaluate: async () => ({http:403, body_excerpt:'Access denied', videos:[]}),
        screenshot: async () => {}, waitForTimeout: async () => {}
      }), close: async () => {}
    }) } };`);
    process.env.PLAYWRIGHT_MODULE = fake;
    const candidates = Array.from({length:40}, (_, i) => ({
      id: String(7692412559458533049n + BigInt(i)), author:'测试作者', caption:'运镜',
      published_at:'2026-10-07 14:00', likes:12000, width:576, height:1024,
      duration_seconds:9, verified_at:'2026-10-07T07:18:16Z'
    }));
    const earlier = {date:'2026-10-07',status:'pending',items:[],candidates};
    await saveReport(earlier, {seen:[],frontier:[],processed:{},reports:{}}, config, root);
    const report = await runPipeline({root,config,now:new Date('2026-10-07T10:15:00Z')});
    assert.equal(report.status, 'blocked');
    assert.equal(report.candidates.length, 40);
    assert.equal(report.stats.pending, 0);
    const stored = await readJson(path.join(root, 'site/data/latest.json'));
    assert.equal(stored.candidates.length, 40);
    assert.ok(stored.candidates.every(c => c.verified_at === '2026-10-07T07:18:16Z'));
    assert.equal((await readJson(path.join(root, 'data/pending.json'))).length, 40);
  } finally {
    if (previousModule === undefined) delete process.env.PLAYWRIGHT_MODULE;
    else process.env.PLAYWRIGHT_MODULE = previousModule;
    await fs.rm(root, {recursive:true,force:true});
  }
});
