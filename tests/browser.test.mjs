import test from 'node:test';
import assert from 'node:assert/strict';
import { largestVisibleVideoIndex, sourceFailure, retryableSourceFailure } from '../src/browser.mjs';
test('hidden SDK videos cannot supply the main video duration or orientation', () => {
  const video = (width, height) => ({ getBoundingClientRect: () => ({ width, height }) });
  assert.equal(largestVisibleVideoIndex([video(0, 0), video(800, 450), video(32, 32)]), 1);
  assert.equal(largestVisibleVideoIndex([video(0, 0), video(32, 32)]), -1);
  assert.equal(largestVisibleVideoIndex([]), -1);
});
test('a real access gate stops retries while a transient missing player can retry', () => {
  assert.equal(sourceFailure('请完成安全验证'), 'DOUYIN_VERIFICATION_REQUIRED');
  assert.equal(sourceFailure('访问受限'), 'DOUYIN_VERIFICATION_REQUIRED');
  assert.equal(sourceFailure('请登录后观看'), 'DOUYIN_LOGIN_REQUIRED');
  assert.equal(sourceFailure('', 403), 'DOUYIN_HTTP_403');
  assert.equal(sourceFailure('登录后免费畅享高清视频'), 'VIDEO_UNAVAILABLE');
  for (const reason of ['DOUYIN_VERIFICATION_REQUIRED', 'DOUYIN_LOGIN_REQUIRED', 'DOUYIN_HTTP_403', 'DOUYIN_HTTP_404']) assert.equal(retryableSourceFailure(reason), false);
  for (const reason of ['VIDEO_UNAVAILABLE', 'VIDEO_METADATA_UNAVAILABLE', 'DOUYIN_NAVIGATION_TIMEOUT', 'DOUYIN_HTTP_502']) assert.equal(retryableSourceFailure(reason), true);
});
