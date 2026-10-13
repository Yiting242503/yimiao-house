import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:5173';
const run = crypto.randomUUID();
const title = `TEST cover ${run.slice(0, 8)}`;
const entryIds = new Set();
const mediaIds = [];
const checks = [];
const errors = [];
let meetingId;
let browser;

async function login(slot) {
  const response = await fetch(`${base}/api/dev-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-House-Request': '1' }, body: JSON.stringify({ slot })
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

async function response(cookie, path, method = 'GET', data) {
  return fetch(`${base}/api${path}`, {
    method, headers: { cookie, 'Content-Type': 'application/json', 'X-House-Request': '1' },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
}

async function call(cookie, path, method = 'GET', data) {
  const result = await response(cookie, path, method, data);
  assert.equal(result.status, 200, await result.clone().text());
  return result.json();
}

function coversWithoutFixture(settings) {
  const covers = { ...settings.albumCovers };
  if (meetingId) delete covers[meetingId];
  return covers;
}

async function removeFixtureCover(cookie) {
  if (!meetingId) return;
  // Fetch the current version for every retry; remove only our unique temporary key.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { settings } = await call(cookie, '/house');
    if (!Object.hasOwn(settings.albumCovers || {}, meetingId)) return;
    const albumCovers = { ...settings.albumCovers };
    delete albumCovers[meetingId];
    const result = await response(cookie, '/settings', 'PUT', { ...settings, albumCovers });
    if (result.status === 200) return;
    if (result.status !== 409) throw new Error(`Fixture cover cleanup failed: ${await result.text()}`);
  }
  throw new Error('Fixture cover cleanup could not get a current settings version');
}

function mark(message) {
  checks.push(message);
  console.log(`PASS ${message}`);
}

await mkdir('test-results', { recursive: true });
const cookies = { yiting: await login('yiting'), haomiao: await login('haomiao') };
const before = await call(cookies.yiting, '/house');
assert.equal(before.session.localPreview, true, 'Fixture tests must run only in the local preview');
const originalCovers = structuredClone(before.settings.albumCovers || {});
const originalMeetings = new Map(before.meetings.map(meeting => [meeting.id, meeting]));
const originalEntries = new Map(before.entries.map(entry => [entry.id, entry]));

async function createContext(width, height, slot) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await context.addCookies([{ name: 'house_session', value: cookies[slot].slice(cookies[slot].indexOf('=') + 1), url: base, httpOnly: true, sameSite: 'Strict' }]);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return { context, page };
}

async function openAlbum(page) {
  await page.goto(base);
  await page.locator('.room-image').waitFor();
  await page.locator('.hotspot').filter({ hasText: '一起走过' }).click();
  await page.locator(`.meeting-album[data-meeting-id="${meetingId}"]`).waitFor();
}

function card(page) {
  return page.locator(`.meeting-album[data-meeting-id="${meetingId}"]`);
}

async function assertCard(page, fileId) {
  const image = card(page).locator('img');
  await image.evaluate(element => element.decode());
  assert.equal(await image.getAttribute('src'), `/api/media/${fileId}`);
}

async function openEditor(page) {
  await card(page).locator('..').getByRole('button', { name: `设置${title}相册封面`, exact: true }).click();
  const editor = page.locator('.album-cover-modal');
  await editor.waitFor();
  assert.equal(await editor.getByRole('radio').count(), 3);
  return editor;
}

async function assertSharedCover(fileId) {
  for (const cookie of Object.values(cookies)) {
    const house = await call(cookie, '/house');
    assert.equal(house.settings.albumCovers?.[meetingId], fileId);
    assert.deepEqual(coversWithoutFixture(house.settings), originalCovers, 'A real album cover was altered');
  }
}

try {
  const meeting = await call(cookies.yiting, '/meetings', 'POST', {
    title, start: '2099-02-01', end: '2099-02-01', place: 'TEST fixture', story: 'Temporary album cover verification fixture'
  });
  meetingId = meeting.id;
  const bytes = await readFile('public/assets/room.webp');
  for (let index = 0; index < 2; index++) {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'image/webp' }), `cover-fixture-${index + 1}.webp`);
    const result = await fetch(`${base}/api/upload`, { method: 'POST', headers: { cookie: cookies.yiting, 'X-House-Request': '1' }, body: form });
    assert.equal(result.status, 200, await result.clone().text());
    mediaIds.push((await result.json()).id);
  }
  const requestId = `cover-fixture-${run}`;
  entryIds.add(requestId);
  await call(cookies.yiting, '/entries', 'POST', {
    requestId, kind: 'memory', text: 'TEST album cover verification photos', date: '2099-02-01', meetingId, media: mediaIds
  });
  const entry = (await call(cookies.haomiao, '/house')).entries.find(record => record.id === requestId);
  assert.deepEqual(entry.media.map(file => file.id), mediaIds);
  for (const fileId of mediaIds) {
    assert.equal((await fetch(`${base}/api/media/${fileId}`)).status, 401);
    for (const cookie of Object.values(cookies)) {
      assert.equal((await fetch(`${base}/api/media/${fileId}`, { headers: { cookie } })).status, 200);
    }
  }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) });

  for (const [label, width, height, editorSlot, readerSlot] of [
    ['desktop', 1440, 1000, 'yiting', 'haomiao'], ['mobile', 390, 844, 'haomiao', 'yiting']
  ]) {
    const editorSession = await createContext(width, height, editorSlot);
    const readerSession = await createContext(width, height, readerSlot);
    const page = editorSession.page;
    try {
      await openAlbum(page);
      await assertCard(page, mediaIds[0]);
      let editor = await openEditor(page);
      await editor.getByRole('radio', { name: '第 2 张照片', exact: true }).locator('..').click();
      assert.equal(await editor.getByRole('radio', { name: '第 2 张照片', exact: true }).isChecked(), true);
      await editor.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
      await page.screenshot({ path: `test-results/album-cover-editor-${label}.png` });
      await editor.getByRole('button', { name: '保存封面', exact: true }).click();
      await editor.waitFor({ state: 'hidden' });
      await assertCard(page, mediaIds[1]);
      await assertSharedCover(mediaIds[1]);
      await openAlbum(readerSession.page);
      await assertCard(readerSession.page, mediaIds[1]);
      await openAlbum(page);
      await assertCard(page, mediaIds[1]);
      mark(`${label}: choose the second photo, save, and both independent sessions share it after refresh.`);

      editor = await openEditor(page);
      await editor.getByRole('radio', { name: '第 1 张照片', exact: true }).locator('..').click();
      await editor.getByRole('button', { name: '取消', exact: true }).click();
      await editor.waitFor({ state: 'hidden' });
      await assertCard(page, mediaIds[1]);
      await assertSharedCover(mediaIds[1]);
      mark(`${label}: cancel keeps the saved cover unchanged.`);

      editor = await openEditor(page);
      await editor.getByRole('radio', { name: '自动使用第一张照片', exact: true }).check();
      await editor.getByRole('button', { name: '保存封面', exact: true }).click();
      await editor.waitFor({ state: 'hidden' });
      await assertSharedCover(undefined);
      await assertCard(page, mediaIds[0]);
      await openAlbum(readerSession.page);
      await assertCard(readerSession.page, mediaIds[0]);
      await page.screenshot({ path: `test-results/album-cover-default-${label}.png` });
      mark(`${label}: automatic default removes only the fixture cover and returns to the first real photo.`);
    } finally {
      await editorSession.context.close();
      await readerSession.context.close();
    }
  }
  assert.deepEqual(errors, []);
} finally {
  const cleanupErrors = [];
  if (browser) {
    try { await browser.close(); } catch (error) { cleanupErrors.push(error); }
  }
  try { await removeFixtureCover(cookies.yiting); } catch (error) { cleanupErrors.push(error); }
  let house;
  try { house = await call(cookies.yiting, '/house'); } catch (error) { cleanupErrors.push(error); }
  if (house) {
    const existing = new Set(house.entries.map(entry => entry.id));
    const attached = new Set(house.entries.filter(entry => entryIds.has(entry.id)).flatMap(entry => entry.media.map(file => file.id)));
    const orphaned = mediaIds.filter(fileId => !attached.has(fileId));
    if (orphaned.length) {
      const requestId = `cover-cleanup-${run}`;
      entryIds.add(requestId);
      try {
        await call(cookies.yiting, '/entries', 'POST', { requestId, kind: 'memory', text: 'TEST orphan upload cleanup', date: '2099-02-01', media: orphaned });
        existing.add(requestId);
      } catch (error) { cleanupErrors.push(error); }
    }
    for (const id of entryIds) {
      if (!existing.has(id)) continue;
      try { await call(cookies.yiting, `/entries/${id}`, 'DELETE'); } catch (error) { cleanupErrors.push(error); }
    }
    const fixtureMeetings = house.meetings.filter(meeting => meeting.id === meetingId || meeting.title === title);
    for (const meeting of fixtureMeetings) {
      try { await call(cookies.yiting, `/meetings/${meeting.id}`, 'DELETE'); } catch (error) { cleanupErrors.push(error); }
    }
  }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Temporary cover fixtures were not all cleaned up');
}

const after = await call(cookies.yiting, '/house');
assert.deepEqual(after.settings.albumCovers || {}, originalCovers);
assert.equal(after.meetings.length, originalMeetings.size);
assert.equal(after.entries.length, originalEntries.size);
for (const [id, original] of originalMeetings) assert.deepEqual(after.meetings.find(meeting => meeting.id === id), original);
for (const [id, original] of originalEntries) assert.deepEqual(after.entries.find(entry => entry.id === id), original);
for (const fileId of mediaIds) {
  assert.equal((await fetch(`${base}/api/media/${fileId}`, { headers: { cookie: cookies.yiting } })).status, 404);
}
mark('Temporary cover settings, photos, entry and meeting removed; all real cover choices and records are unchanged.');
await writeFile('test-results/album-cover-verification.json', JSON.stringify({ verifiedAt: new Date().toISOString(), scope: 'Local preview; independent 2099 fixture only', checks }, null, 2));
