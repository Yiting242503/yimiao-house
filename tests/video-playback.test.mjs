import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoPlaybackCoordinator } from '../src/components/video-playback.js';

test('starting another video suspends the previous download while pause events preserve the new player', () => {
  const playback = createVideoPlaybackCoordinator(), first = {}, next = {}, observations = [];
  let firstSuspends = 0, nextSuspends = 0;
  playback.register(first, () => { firstSuspends++; playback.stop(first); });
  playback.register(next, () => { nextSuspends++; playback.stop(next); });
  const unsubscribe = playback.subscribe(() => observations.push(playback.isPlaying()));
  playback.play(first);
  assert.equal(playback.isPlaying(), true);
  assert.equal(nextSuspends, 1);
  playback.play(next);
  assert.equal(firstSuspends, 1);
  assert.equal(playback.isPlaying(), true);
  playback.stop(first);
  assert.equal(playback.isPlaying(), true);
  playback.stop(next);
  assert.equal(playback.isPlaying(), false);
  assert.deepEqual(observations, [true, true, false]);
  unsubscribe();
});

test('background suspension releases all players and unmounting cannot leave an active player', () => {
  const playback = createVideoPlaybackCoordinator(), first = {}, next = {};
  let suspended = 0;
  const removeFirst = playback.register(first, () => suspended++);
  playback.register(next, () => suspended++);
  playback.play(first);
  playback.suspendAll();
  assert.equal(suspended, 3);
  assert.equal(playback.isPlaying(), false);
  playback.play(first);
  removeFirst();
  assert.equal(playback.isPlaying(), false);
  playback.play(first);
  assert.equal(playback.isPlaying(), false);
});
