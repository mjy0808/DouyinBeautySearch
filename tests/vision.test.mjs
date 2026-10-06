import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { reviewFrames, visionSettings } from '../src/vision.mjs';
import config from '../config.json' with { type: 'json' };
test('no API key means no request and no invented approval', async () => {
  assert.equal(visionSettings(config, {}).key, '');
  await assert.rejects(reviewFrames({}, [], config, () => { throw new Error('must not call'); }, {}), /VISION_NOT_CONFIGURED/);
});
test('Responses request has structured image input and refuses incomplete responses', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'beauty-vision-'));
  try {
    const image = path.join(root, 'frame.jpg'); await fs.writeFile(image, 'test image');
    const result = { style_score: 86, camera_motion: true };
    let request;
    const fake = async (url, options) => { request = { url, ...options, body: JSON.parse(options.body) }; return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }] }) }; };
    assert.deepEqual(await reviewFrames({ caption: '测试', duration_seconds: 8 }, [image], config, fake, { VISION_API_KEY: 'fixture-only' }), result);
    assert.equal(request.body.store, false); assert.equal(request.body.input[0].content[1].type, 'input_image'); assert.equal(request.body.text.format.strict, true);
    await assert.rejects(reviewFrames({}, [], config, async () => ({ ok: true, json: async () => ({ output: [] }) }), { VISION_API_KEY: 'fixture-only' }), /VISION_EMPTY_RESPONSE/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
