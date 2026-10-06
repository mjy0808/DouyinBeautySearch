import test from 'node:test';
import assert from 'node:assert/strict';
import { largestVisibleVideoIndex } from '../src/browser.mjs';
test('hidden SDK videos cannot supply the main video duration or orientation', () => {
  const video = (width, height) => ({ getBoundingClientRect: () => ({ width, height }) });
  assert.equal(largestVisibleVideoIndex([video(0, 0), video(800, 450), video(32, 32)]), 1);
  assert.equal(largestVisibleVideoIndex([video(0, 0), video(32, 32)]), -1);
  assert.equal(largestVisibleVideoIndex([]), -1);
});
