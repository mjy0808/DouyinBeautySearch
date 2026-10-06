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
