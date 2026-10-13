import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';

const base = 'http://127.0.0.1:5173';
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
const palettes = ['珍珠', '日光', '夜色', '晨雾', '花信', '青瓷', '海盐', '月白', '暮霞', '星河'];
const pixels = buffer => sharp(buffer).removeAlpha().raw().toBuffer();
const difference = (a, b) => a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length;

try {
  for (const [name, width, height, reduced, touch, noGpu] of [
    ['desktop', 1440, 900], ['mobile', 390, 844], ['small-mobile', 360, 800],
    ['touch', 390, 844, false, true], ['reduced-motion', 390, 844, true],
    ['no-webgpu', 390, 844, false, false, true]
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: Boolean(touch),
      reducedMotion: reduced ? 'reduce' : 'no-preference' });
    try {
      if (noGpu) await context.addInitScript(() => Object.defineProperty(navigator, 'gpu', { get: () => undefined }));
      assert.equal((await context.request.post(`${base}/api/dev-login`, {
        data: { slot: 'yiting' }, headers: { 'X-House-Request': '1', Origin: base }
      })).status(), 200);
      const before = await (await context.request.get(`${base}/api/house`)).json();
      const page = await context.newPage();
      const errors = [];
      const requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('request', request => requests.push(request.url()));
      await page.goto(base);
      await page.locator('.room-image').waitFor();
      await page.waitForFunction(() => document.querySelectorAll('.room-hotspot-glass').length === 6);
      assert.ok(!requests.some(url => url.includes('/AeroShards/')), 'Main entry must not load Aero GPU code');
      assert.equal(await page.locator('.room-hotspot-glass').count(), 6);
      await page.goto(`${base}/?preview=aero`);
      await page.locator('.aero-preview').waitFor();
      assert.equal(await page.locator('.room-image').count(), 0);
      assert.equal(await page.getByRole('group', { name: '配色', exact: true }).getByRole('button').count(), palettes.length);
      for (const palette of palettes) {
        const button = page.getByRole('button', { name: `${palette}配色`, exact: true });
        const box = await button.boundingBox();
        assert.ok(box.width >= 44 && box.height >= 44, `${palette} needs a touch-sized swatch`);
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height, `${palette} must stay on screen`);
      }
      if (noGpu) {
        await page.getByRole('alert').waitFor();
        assert.equal(await page.locator('.aero-shards[data-failed="true"]').count(), 1);
        await page.getByRole('button', { name: '重试', exact: true }).click();
        await page.getByRole('alert').waitFor();
      } else {
        await page.locator('.aero-shards[data-ready="true"]').waitFor({ timeout: 30000 });
        await page.waitForTimeout(1400);
        const canvas = page.locator('.aero-shards canvas');
        const dimensions = await canvas.evaluate(node => ({ width: node.width, height: node.height, box: { width: node.clientWidth, height: node.clientHeight } }));
        assert.equal(dimensions.box.width, width);
        assert.equal(dimensions.box.height, height);
        assert.ok(dimensions.width >= width && dimensions.height >= height);
        const first = await pixels(await canvas.screenshot());
        let foreground = 0;
        for (let i = 0; i < first.length; i += 3) {
          if (Math.abs(first[i] - 246) + Math.abs(first[i + 1] - 243) + Math.abs(first[i + 2] - 237) > 35) foreground++;
        }
        const coverage = foreground / (first.length / 3);
        assert.ok(coverage > 0.005 && coverage < 0.9, 'Scene must visibly render shards against its background');
        await page.waitForTimeout(1000);
        const second = await pixels(await canvas.screenshot());
        const motion = difference(first, second);
        if (reduced) assert.ok(motion < 0.02, `Reduced motion must stay still: ${motion}`);
        else assert.ok(motion > 0.1, 'Shard animation must move');
        await page.getByRole('button', { name: '暂停动画', exact: true }).click();
        await page.mouse.move(0, height - 1);
        await page.waitForTimeout(3800);
        const pausedBefore = await pixels(await canvas.screenshot());
        await page.waitForTimeout(500);
        const pausedAfter = await pixels(await canvas.screenshot());
        assert.ok(difference(pausedBefore, pausedAfter) < 0.02, 'Paused scene must stop');
        if (name === 'desktop' || name === 'small-mobile') {
          const originalCanvas = await canvas.elementHandle();
          let previous = pausedAfter;
          for (const palette of palettes.slice(1)) {
            await page.getByRole('button', { name: `${palette}配色`, exact: true }).click();
            await page.mouse.move(0, height - 1);
            await page.waitForTimeout(450);
            assert.equal(await page.locator('.aero-preview__palette-name').textContent(), palette);
            assert.equal(await page.getByRole('group', { name: '配色', exact: true }).locator('[aria-pressed="true"]').count(), 1);
            assert.equal(await originalCanvas.evaluate(node => node === document.querySelector('.aero-shards canvas')), true, 'Changing colors must reuse the GPU canvas');
            assert.equal(await page.locator('.aero-preview--dark').count(), ['夜色', '暮霞', '星河'].includes(palette) ? 1 : 0);
            const next = await pixels(await canvas.screenshot());
            assert.ok(difference(previous, next) > 0.08, `${palette} must change the rendered colors`);
            previous = next;
            if (name === 'desktop') await page.screenshot({ path: `test-results/aero-palette-${palettes.indexOf(palette)}.png` });
          }
          await originalCanvas.dispose();
        }
        await page.getByRole('button', { name: '旋涡', exact: true }).click();
        await page.getByLabel('材质', { exact: true }).selectOption('chrome');
        await page.getByRole('button', { name: '夜色配色', exact: true }).click();
        await page.mouse.move(0, height - 1);
        await page.waitForTimeout(1800);
        assert.equal(await page.getByRole('button', { name: '旋涡', exact: true }).getAttribute('aria-pressed'), 'true');
        assert.ok(difference(pausedAfter, await pixels(await canvas.screenshot())) > 10, 'Visual controls must change the rendered scene');
        await page.getByRole('button', { name: '播放动画', exact: true }).click();
        if (touch) {
          const cdp = await context.newCDPSession(page);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: width / 2, y: height / 2 }] });
          await page.waitForTimeout(250);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: width / 2 + 40, y: height / 2 - 40 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await cdp.detach();
        } else if (!reduced) {
          await page.mouse.move(width / 2, height / 2);
          await page.mouse.down();
          await page.waitForTimeout(200);
          await page.mouse.move(width / 2 + 70, height / 2 - 50);
          await page.mouse.up();
        }
        await page.waitForTimeout(800);
        assert.equal(await page.locator('.aero-preview__error').count(), 0);
        await page.screenshot({ path: `test-results/aero-${name}-night.png` });
        await page.getByRole('button', { name: '珍珠配色', exact: true }).click();
        await page.getByRole('button', { name: '丝带', exact: true }).click();
        await page.getByLabel('材质', { exact: true }).selectOption('pearl');
        await page.mouse.move(0, height - 1);
        await page.waitForTimeout(1800);
        results.push({ name, coverage: Number(coverage.toFixed(3)), motion: Number(motion.toFixed(3)), canvas: `${dimensions.width}x${dimensions.height}`, palettes: palettes.length, colorsVerified: name === 'desktop' || name === 'small-mobile' });
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1));
      const controls = await page.locator('.aero-preview__toolbar').boundingBox();
      assert.ok(controls.x >= 0 && controls.y >= 0 && controls.x + controls.width <= width + 1 && controls.y + controls.height <= height + 1);
      await page.screenshot({ path: `test-results/aero-${name}.png` });
      await page.getByRole('link', { name: '返回小屋', exact: true }).click();
      await page.locator('.room-image').waitFor();
      await page.waitForFunction(() => document.querySelectorAll('.room-hotspot-glass').length === 6);
      assert.equal(await page.locator('.aero-preview').count(), 0);
      assert.equal(await page.locator('.room-hotspot-glass').count(), 6);
      assert.deepEqual(await (await context.request.get(`${base}/api/house`)).json(), before);
      assert.deepEqual(errors, []);
      if (noGpu) results.push({ name, fallback: true, recordsUnchanged: true });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally { await browser.close(); }
