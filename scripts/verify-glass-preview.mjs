import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';

const base = 'http://127.0.0.1:5173';
const cases = [
  ['desktop', 1440, 1000, false],
  ['tablet', 947, 871, false],
  ['mobile', 390, 844, false],
  ['small-mobile', 360, 800, false],
  ['reduced-motion', 390, 844, true],
  ['fallback', 390, 844, false, true]
];
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];

async function settled(page) {
  await page.locator('.hotspot').first().waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
    const image = document.querySelector('.room-image');
    if (!image.complete) await new Promise(resolve => image.addEventListener('load', resolve, { once: true }));
  });
  assert.ok(await page.locator('.room-image').evaluate(image => image.naturalWidth > 0));
}

try {
  for (const [name, width, height, reduced, fallback] of cases) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: reduced ? 'reduce' : 'no-preference',
      ...(fallback ? { userAgent: 'Mozilla/5.0 Firefox/131.0' } : {})
    });
    try {
      const login = await context.request.post(`${base}/api/dev-login`, {
        data: { slot: 'yiting' }, headers: { 'X-House-Request': '1', Origin: base }
      });
      assert.equal(login.status(), 200);
      const before = await (await context.request.get(`${base}/api/house`)).json();
      const page = await context.newPage();
      const errors = [];
      const requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => requests.push(request.url()));
      await page.goto(`${base}/?preview=original`);
      await settled(page);
      assert.equal(await page.locator('.hotspot').count(), 6);
      assert.equal(await page.locator('.glass-surface').count(), 0);
      assert.ok(!requests.some(url => url.includes('/GlassSurface/')), 'Normal entry must not load glass preview');
      const boxes = await page.locator('.hotspot').evaluateAll(nodes => nodes.map(node => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      }));
      const normal = await page.locator('.hotspot').first().screenshot();
      await page.screenshot({ path: `test-results/glass-${name}-original.png`, fullPage: true });

      await page.goto(`${base}/?preview=glass`);
      await settled(page);
      await page.waitForFunction(() => document.querySelectorAll('.hotspot > .glass-surface').length === 6);
      if (!fallback) {
        await page.waitForFunction(() => [...document.querySelectorAll('.glass-surface feImage')]
          .every(node => node.getAttribute('href')?.startsWith('data:image/svg+xml,')));
      }
      await page.waitForTimeout(500);
      assert.equal(await page.locator('.glass-surface').count(), 6);
      const renderers = await page.locator('.glass-surface').evaluateAll(nodes => nodes.map(node => node.dataset.glassRenderer));
      assert.ok(renderers.every(renderer => renderer === (fallback ? 'fallback' : 'svg')));
      const ids = await page.locator('.glass-surface [id]').evaluateAll(nodes => nodes.map(node => node.id));
      assert.equal(new Set(ids).size, ids.length, 'Filter identifiers must be unique');
      const previews = await page.locator('.hotspot').evaluateAll(nodes => nodes.map(node => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      }));
      previews.forEach((box, index) => Object.keys(box).forEach(key => {
        assert.ok(Math.abs(box[key] - boxes[index][key]) < 1, `Button ${index} ${key} moved`);
      }));
      const preview = await page.locator('.hotspot').first().screenshot();
      const originalPixels = await sharp(normal).removeAlpha().raw().toBuffer();
      const previewPixels = await sharp(preview).removeAlpha().raw().toBuffer();
      assert.equal(originalPixels.length, previewPixels.length);
      const meanDifference = originalPixels.reduce((sum, value, i) => sum + Math.abs(value - previewPixels[i]), 0) / originalPixels.length;
      assert.ok(meanDifference > 3, 'Preview must visibly change the surface');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
      await page.locator('.title-crystal[data-crystal-state="ready"]').waitFor();
      await page.waitForTimeout(2300);
      await page.screenshot({ path: `test-results/glass-${name}-preview.png`, fullPage: true });

      // Keep the "miss you" action untouched: it would save a real record.
      for (const index of [0, 1, 2, 4, 5]) {
        await page.locator('.hotspot').nth(index).click();
        await page.locator('.sheet').waitFor();
        await page.getByRole('button', { name: '回到小屋', exact: true }).last().click();
        await page.locator('.sheet').waitFor({ state: 'detached' });
      }
      await page.goto(base);
      await settled(page);
      await page.waitForFunction(() => document.querySelectorAll('.hotspot > .glass-surface').length === 6);
      const after = await (await context.request.get(`${base}/api/house`)).json();
      assert.deepEqual(after, before);
      assert.deepEqual(errors, []);
      results.push({ name, renderer: renderers[0], meanDifference: Number(meanDifference.toFixed(2)), buttonsWork: true, recordsUnchanged: true });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally { await browser.close(); }
