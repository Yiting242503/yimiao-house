import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';

const base = 'http://127.0.0.1:5173';
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];

async function albumReady(page) {
  await page.locator('.album-grid .entry-card').first().waitFor();
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => document.querySelector('.album-grid img')?.naturalWidth > 0);
  await page.waitForTimeout(400);
}

try {
  for (const [name, width, height, reduced, touch] of [
    ['desktop', 1440, 1000, false], ['tablet', 947, 871, false],
    ['mobile', 390, 844, false], ['small-mobile', 360, 800, false],
    ['reduced-motion', 390, 844, true], ['touch', 390, 844, false, true]
  ]) {
    const context = await browser.newContext({ viewport: { width, height },
      reducedMotion: reduced ? 'reduce' : 'no-preference', hasTouch: Boolean(touch) });
    try {
      const login = await context.request.post(`${base}/api/dev-login`, {
        data: { slot: 'yiting' }, headers: { 'X-House-Request': '1', Origin: base }
      });
      assert.equal(login.status(), 200);
      const before = await (await context.request.get(`${base}/api/house`)).json();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/?preview=original`);
      await page.locator('.hotspot').first().click();
      await albumReady(page);
      assert.equal(await page.locator('.album-border-glow').count(), 0);
      const normalCards = await page.locator('.album-grid .entry-card').evaluateAll(nodes => nodes.map(node => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height, text: node.textContent, image: node.querySelector('img')?.getAttribute('src') };
      }));

      await page.goto(`${base}/?preview=border`);
      await albumReady(page);
      await page.waitForFunction(() => document.querySelectorAll('.album-border-glow').length > 0);
      assert.equal(await page.locator('.album-border-glow').count(), normalCards.length);
      const previewCards = await page.locator('.album-grid .entry-card').evaluateAll(nodes => nodes.map(node => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height, text: node.textContent, image: node.querySelector('img')?.getAttribute('src') };
      }));
      previewCards.forEach((card, index) => {
        assert.equal(card.text, normalCards[index].text);
        assert.equal(card.image, normalCards[index].image);
        for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(card[key] - normalCards[index][key]) < 1, `${name}: card ${index} ${key} changed: ${normalCards[index][key]} -> ${card[key]}`);
      });
      const card = page.locator('.album-border-glow').first();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(800);
      const idle = await card.screenshot();
      const box = await card.boundingBox();
      await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
      await page.waitForTimeout(350);
      const edge = await card.evaluate(node => Number(node.style.getPropertyValue('--edge-proximity')));
      assert.ok(edge > 95, 'Pointer should reach the edge');
      const opacity = await card.locator('.edge-light').evaluate(node => Number(getComputedStyle(node).opacity));
      assert.ok(opacity > 0.9, 'Edge glow must be visible');
      const lit = await card.screenshot();
      const idlePixels = await sharp(idle).removeAlpha().raw().toBuffer();
      const litPixels = await sharp(lit).removeAlpha().raw().toBuffer();
      assert.equal(idlePixels.length, litPixels.length);
      const pixelDifference = idlePixels.reduce((sum, value, index) => sum + Math.abs(value - litPixels[index]), 0) / idlePixels.length;
      assert.ok(pixelDifference > 0.05, 'Glow must change rendered pixels');
      await page.screenshot({ path: `test-results/border-${name}-hover.png`, fullPage: true });
      await page.mouse.move(0, 0);
      await page.waitForTimeout(850);
      assert.ok(await card.locator('.edge-light').evaluate(node => Number(getComputedStyle(node).opacity)) < 0.01);
      await card.locator('button').focus();
      await page.waitForTimeout(350);
      assert.ok(await card.locator('.edge-light').evaluate(node => Number(getComputedStyle(node).opacity)) > 0.9, 'Keyboard focus should light the border');
      await card.locator('button').evaluate(node => node.blur());

      if (touch) {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 5, y: box.y + box.height / 2 }] });
        await page.waitForTimeout(300);
        assert.ok(await card.locator('.edge-light').evaluate(node => Number(getComputedStyle(node).opacity)) > 0.9);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        await page.waitForTimeout(850);
        assert.ok(await card.locator('.edge-light').evaluate(node => Number(getComputedStyle(node).opacity)) < 0.01);
        await cdp.detach();
      }
      await card.locator('button').click();
      await page.locator('.meeting-memory-modal').waitFor();
      assert.equal(await page.locator('.meeting-memory-modal .border-glow-card').count(), 0);
      await page.locator('.meeting-memory-modal').getByRole('button', { name: '关闭', exact: true }).click();
      await page.locator('.meeting-memory-modal').waitFor({ state: 'detached' });
      await page.locator('.album-cover-button').first().click();
      await page.locator('.album-cover-modal').waitFor();
      await page.locator('.album-cover-modal').getByRole('button', { name: '取消', exact: true }).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await page.locator('.sheet').evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'Album must not overflow horizontally');
      await page.screenshot({ path: `test-results/border-${name}-idle.png`, fullPage: true });
      await page.goto(base);
      await page.locator('.hotspot').first().click();
      await albumReady(page);
      await page.waitForFunction(() => document.querySelectorAll('.album-border-glow').length > 0);
      assert.equal(await page.locator('.album-border-glow').count(), normalCards.length, 'Confirmed border must appear in the normal entry');
      const after = await (await context.request.get(`${base}/api/house`)).json();
      assert.deepEqual(after, before);
      assert.deepEqual(errors, []);
      results.push({ name, albums: normalCards.length, pixelDifference: Number(pixelDifference.toFixed(3)), keyboard: true, touch: Boolean(touch), recordsUnchanged: true });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally { await browser.close(); }
