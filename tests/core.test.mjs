import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCount, dateInZone, parseDetail, metadataRejection, visionAccepted, rankItems, mergeCandidates, validateConfig, videoUrl } from '../src/core.mjs';
import config from '../config.json' with { type: 'json' };
const good = { id: '7692412559458533049', author: '一扣', caption: '嗯……', published_at: '2026-10-03 20:09', likes: 92000, width: 576, height: 1024, duration_seconds: 6.566667, ai_label: false };
test('failed intraday retry keeps captured candidates and their original verification times', () => {
  const earlier = { ...good, verified_at: '2026-10-07T07:18:16Z', thumbnail: 'assets/7692412559458533049-1.jpg' };
  assert.deepEqual(mergeCandidates([earlier], [], config), [earlier]);
  const refreshed = { ...earlier, likes: 95000, verified_at: '2026-10-07T10:00:00Z' };
  assert.deepEqual(mergeCandidates([earlier], [refreshed], config), [refreshed]);
  assert.deepEqual(mergeCandidates([earlier], [], config, new Set([earlier.id])), []);
  assert.deepEqual(mergeCandidates([{ ...earlier, duration_seconds: 16 }], [], config), []);
});
test('count parsing accepts Douyin abbreviations without inventing missing counts', () => {
  assert.equal(parseCount('1.3万'), 13000); assert.equal(parseCount('9,070'), 9070); assert.equal(parseCount('1.3亿'), 130000000);
  assert.equal(parseCount(undefined), null); assert.equal(parseCount('获赞9.2万'), null);
});
test('day boundary uses Beijing time instead of host timezone', () => {
  assert.equal(dateInZone(new Date('2026-10-05T16:01:00Z')), '2026-10-06');
  assert.equal(dateInZone(new Date('2026-10-05T15:59:00Z')), '2026-10-05');
});
test('only the single-video counters are used, not author totals or comments', () => {
  const body = '\n00:02 / 00:07\n倍速\n嗯……\n9.2万\n296\n1.3万\n2.1万\n举报\n发布时间：2026-10-03 20:09\n全部评论\n评论999999\n立即登录\n一扣\n\n粉丝85.2万获赞765.9万\n关注';
  const parsed = parseDetail(body, good.id, { width: 576, height: 1024, duration: 6.56 });
  assert.equal(parsed.likes, 92000); assert.equal(parsed.author, '一扣'); assert.equal(parsed.caption, '嗯……');
  assert.equal(parsed.ai_label, false);
  assert.equal(parseDetail(body.replace('嗯……', '作品含 AI 生成内容\n嗯……'), good.id, {}).ai_label, true);
});
test('strict metadata gate rejects landscape canvas and fractions over 15 seconds', () => {
  assert.equal(metadataRejection(good, config), null);
  for (const change of [{ width: 1280, height: 720 }, { duration_seconds: 15.033333 }, { duration_seconds: 0 }, { likes: 4999 }, { likes: null }, { ai_label: true }, { author: '' }]) {
    assert.ok(metadataRejection({ ...good, ...change }, config));
  }
  assert.equal(metadataRejection({ ...good, duration_seconds: 15, likes: 5000 }, config), null);
});
test('uncertain, male, unreadable or static frames cannot pass visual review', () => {
  const review = { adult_woman_primary: true, real_person_likely: true, camera_motion: true, readable_frames: true, uncertain: false, confidence: .9, camera_note: '手机旋转' };
  assert.equal(visionAccepted(review, config), true);
  for (const change of [{ adult_woman_primary: false }, { camera_motion: false }, { uncertain: true }, { confidence: .7 }, { confidence: 2 }, { readable_frames: false }, { real_person_likely: false }, { camera_note: '' }]) assert.equal(visionAccepted({ ...review, ...change }, config), false);
});
test('10k likes preferred and recent works outrank older equal-style works', () => {
  assert.deepEqual(rankItems([{ id: 'a', likes: 7000, style_score: 99 }, { id: 'b', likes: 14000, style_score: 60, published_at: '2026-10-05' }, { id: 'c', likes: 18000, style_score: 60, published_at: '2026-10-04' }], config).map(item => item.id), ['b', 'c', 'a']);
});
test('configuration cannot weaken the user thresholds', () => {
  assert.equal(validateConfig(config), config);
  assert.throws(() => validateConfig({ ...config, minLikes: 1000 }));
  assert.throws(() => validateConfig({ ...config, maxDuration: 16 }));
  assert.throws(() => videoUrl('javascript:alert(1)'));
});
