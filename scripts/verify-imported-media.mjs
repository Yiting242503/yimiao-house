import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { initialMeetings } from '../shared/seed.js';
import { reunionDays } from '../shared/dates.js';

const base = 'http://127.0.0.1:5173';
const photoCounts = [59, 67, 11, 34, 17, 39, 9, 2, 3, 5, 2, 8, 20, 10];
const videoCounts = [0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0];
const results = { environment: 'local-preview-only', meetings: [], viewports: [] };

async function login(slot) {
  const response = await fetch(`${base}/api/dev-login`, {
    method: 'POST',
    headers: { 'X-House-Request': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot })
  });
  assert.equal(response.status, 200, `Local login failed: ${slot}`);
  return response.headers.get('set-cookie').split(';')[0];
}

async function snapshot(cookie) {
  const response = await fetch(`${base}/api/house`, { headers: { cookie } });
  assert.equal(response.status, 200);
  return response.json();
}

function publishedState(house) {
  return JSON.stringify({
    meetings: [...house.meetings].sort((a, b) => a.id.localeCompare(b.id)),
    entries: house.entries.filter(entry => entry.status !== 'draft').sort((a, b) => a.id.localeCompare(b.id))
  });
}

function mediaFor(house, meeting) {
  return house.entries.filter(entry => entry.kind === 'memory' && entry.meeting_id === meeting.id)
    .flatMap(entry => entry.media.map(file => ({ ...file, author: entry.author })));
}

await mkdir('test-results', { recursive: true });
const cookies = { yiting: await login('yiting'), haomiao: await login('haomiao') };
const houses = { yiting: await snapshot(cookies.yiting), haomiao: await snapshot(cookies.haomiao) };
const baseline = publishedState(houses.yiting);
assert.equal(publishedState(houses.haomiao), baseline, 'Two sessions do not see the same published records');
assert.equal((await fetch(`${base}/api/house`)).status, 401);
assert.equal((await fetch(`${base}/api/house`, { headers: { cookie: 'house_session=not-authorized' } })).status, 401);
assert.equal(houses.yiting.meetings.length, 14, 'Unexpected meeting record count');
assert.equal(reunionDays(houses.yiting.meetings), 48);

for (const [index, seed] of initialMeetings.entries()) {
  const meeting = houses.yiting.meetings.find(record => record.start === seed.start && record.end === seed.end);
  assert.ok(meeting, `Missing exact date range for ${seed.title}`);
  assert.equal(meeting.title, seed.title);
  const media = mediaFor(houses.yiting, meeting);
  const photos = media.filter(file => file.type.startsWith('image/'));
  const videos = media.filter(file => file.type === 'video/mp4');
  assert.equal(photos.length, photoCounts[index], `Photo count differs for ${seed.title}`);
  assert.equal(videos.length, videoCounts[index], `Video count differs for ${seed.title}`);
  assert.ok(media.every(file => file.author === 'yiting'));
  results.meetings.push({ id: meeting.id, title: meeting.title, start: meeting.start, end: meeting.end, photos: photos.length, videos: videos.length });
  for (const file of [photos[0], ...videos].filter(Boolean)) {
    const path = `${base}/api/media/${file.id}`;
    assert.equal((await fetch(path)).status, 401, 'Anonymous private media read succeeded');
    assert.equal((await fetch(path, { headers: { cookie: 'house_session=not-authorized' } })).status, 401);
    for (const cookie of Object.values(cookies)) {
      const head = await fetch(path, { method: 'HEAD', headers: { cookie } });
      assert.equal(head.status, 200);
      assert.ok(head.headers.get('cache-control').includes('private'));
      assert.equal(head.headers.get('content-type'), file.type);
      if (file.type === 'video/mp4') {
        const range = await fetch(path, { headers: { cookie, Range: 'bytes=0-31' } });
        assert.equal(range.status, 206);
        assert.equal(range.headers.get('accept-ranges'), 'bytes');
        assert.match(range.headers.get('content-range'), /^bytes 0-31\/\d+$/);
        assert.equal((await range.arrayBuffer()).byteLength, 32);
      }
    }
    if (file.type.startsWith('image/')) {
      const response = await fetch(path, { headers: { cookie: cookies.yiting } });
      assert.equal(response.status, 200);
      const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
      assert.equal(metadata.exif, undefined);
      assert.ok(metadata.width > 0 && metadata.height > 0 && metadata.width <= 2000 && metadata.height <= 2000);
    }
  }
}

for (const [slot, house] of Object.entries(houses)) {
  assert.ok(house.entries.every(entry => entry.status !== 'draft' || entry.author === slot), 'Another author\'s draft leaked');
}
assert.equal(results.meetings.reduce((sum, meeting) => sum + meeting.photos, 0), 286);
assert.equal(results.meetings.reduce((sum, meeting) => sum + meeting.videos, 0), 4);

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--autoplay-policy=no-user-gesture-required']
});
const pageErrors = [];

async function openHome(page) {
  await page.goto(base);
  await page.locator('.room-image').waitFor();
  await page.locator('.room-image').evaluate(image => image.decode());
}

async function openCalendarMeeting(page, meeting) {
  await openHome(page);
  await page.locator('.hotspot').filter({ hasText: '见面日历' }).click();
  await page.locator('.meeting-summary').filter({ has: page.getByText(meeting.title, { exact: true }) }).click();
}

async function waitCounter(page, expected) {
  await page.waitForFunction(value => document.querySelector('.memory-counter')?.textContent.trim() === value, expected);
  await page.waitForFunction(() => document.querySelector('.circular-carousel')?.hasAttribute('data-ready'));
}

async function settleSheet(page) {
  await page.locator('.sheet').evaluate(async element => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
    const visibleImages = [...element.querySelectorAll('img')].filter(image => {
      const rect = image.getBoundingClientRect();
      return rect.top < innerHeight && rect.bottom > 0 && rect.left < innerWidth && rect.right > 0;
    });
    await Promise.all(visibleImages.map(image => image.decode()));
  });
}

try {
  for (const [label, width, height, slot] of [['desktop', 1440, 1000, 'yiting'], ['mobile', 390, 844, 'haomiao']]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await context.addCookies([{ name: 'house_session', value: cookies[slot].split('=')[1], url: base, httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    const videoPlayback = [];
    try {
      await openHome(page);
      await page.reload();
      await page.locator('.room-image').waitFor();
      await page.locator('.hotspot').filter({ hasText: '一起走过' }).click();
      const cards = page.locator('.meeting-album[data-meeting-id]');
      await cards.first().waitFor();
      assert.equal(await cards.count(), 14, 'Linked entries are still shown as split photo batches');
      for (const meeting of results.meetings) {
        const card = page.locator(`.meeting-album[data-meeting-id="${meeting.id}"]`);
        assert.equal(await card.count(), 1);
        assert.ok((await card.innerText()).includes(meeting.title));
      }
      await settleSheet(page);
      await page.screenshot({ path: `test-results/meeting-albums-${label}.png`, fullPage: false });

      const first = results.meetings[0];
      await page.locator(`.meeting-album[data-meeting-id="${first.id}"]`).click();
      await waitCounter(page, '1 / 59');
      assert.equal(await page.getByLabel('照片分组').count(), 0, 'Photo batch selector remains visible');
      assert.ok(await page.locator('[data-cc-index]').count() <= 8);
      const pause = page.getByRole('button', { name: '暂停相册转动', exact: true });
      if (await pause.count()) await pause.click();
      await page.locator('.circular-carousel').focus();
      await page.keyboard.press('End');
      await waitCounter(page, '59 / 59');
      await page.getByRole('button', { name: '下一张回忆', exact: true }).click();
      await waitCounter(page, '1 / 59');
      await page.locator('.circular-carousel').focus();
      await page.keyboard.press('Home');
      await waitCounter(page, '1 / 59');
      for (let index = 1; index < 9; index++) {
        await page.getByRole('button', { name: '下一张回忆', exact: true }).click();
        await waitCounter(page, `${index + 1} / 59`);
      }
      await page.getByRole('button', { name: '打开当前照片与留言', exact: true }).click();
      await page.locator('.photo-viewer img').evaluate(image => image.decode());
      assert.equal(await page.locator('.photo-viewer img').evaluate(image => image.naturalWidth > 0), true);
      await page.screenshot({ path: `test-results/meeting-photo-${label}.png` });

      for (const index of [1, 11]) {
        const meeting = results.meetings[index];
        await openCalendarMeeting(page, meeting);
        const videos = page.locator('.meeting-video video');
        assert.equal(await videos.count(), meeting.videos);
        for (let videoIndex = 0; videoIndex < meeting.videos; videoIndex++) {
          const video = videos.nth(videoIndex);
          await video.scrollIntoViewIfNeeded();
          await video.evaluate(element => new Promise((resolve, reject) => {
            if (element.readyState >= 1) return resolve();
            const timer = setTimeout(() => reject(new Error('Video metadata timed out')), 15000);
            element.addEventListener('loadedmetadata', () => { clearTimeout(timer); resolve(); }, { once: true });
            element.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`Video decode error ${element.error?.code}`)); }, { once: true });
            element.load();
          }));
          const attributes = await video.evaluate(element => ({ controls: element.controls, inline: element.playsInline, autoplay: element.autoplay, duration: element.duration }));
          assert.equal(attributes.controls, true);
          assert.equal(attributes.inline, true);
          assert.equal(attributes.autoplay, false);
          assert.ok(Number.isFinite(attributes.duration) && attributes.duration > 0);
          await video.evaluate(element => element.play());
          await page.waitForFunction(({ index: currentIndex }) => {
            const element = document.querySelectorAll('.meeting-video video')[currentIndex];
            return element.currentTime > 0.1 && !element.paused;
          }, { index: videoIndex });
          await video.evaluate(element => { element.pause(); element.currentTime = element.duration / 2; });
          await page.waitForFunction(({ index: currentIndex }) => {
            const element = document.querySelectorAll('.meeting-video video')[currentIndex];
            return !element.seeking && Math.abs(element.currentTime - element.duration / 2) < 0.5;
          }, { index: videoIndex });
          videoPlayback.push({ meeting: meeting.title, index: videoIndex + 1, duration: attributes.duration, played: true, seeked: true });
        }
        await page.screenshot({ path: `test-results/meeting-${index + 1}-videos-${label}.png` });
      }
      await openHome(page);
      assert.equal(await page.locator('.hotspot').count(), 6);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Horizontal page overflow');
      results.viewports.push({ label, width, height, albumCards: 14, continuousPhotos: 59, videoPlayback });
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(pageErrors, []);
} finally {
  await browser.close();
}

for (const cookie of Object.values(cookies)) {
  assert.equal(publishedState(await snapshot(cookie)), baseline, 'Published records changed during read-only verification');
}
results.savedAt = new Date().toISOString();
await writeFile('test-results/imported-media-verification.json', JSON.stringify(results, null, 2));
console.log('PASS 14 combined albums, 286 private photos, 4 playable videos, 48 reunion dates, A/B sharing, refresh persistence and desktop/mobile navigation. No published records changed.');
