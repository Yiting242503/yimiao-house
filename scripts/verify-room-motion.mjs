import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';

const base = 'http://127.0.0.1:5173';
const cases = [
  ['desktop', 1440, 900, false],
  ['mobile', 390, 844, false],
  ['small-mobile', 360, 800, false],
  ['reduced-motion', 390, 844, true]
];
const results = [];
const pixels = buffer => sharp(buffer).removeAlpha().raw().toBuffer();
const difference = (a, b) => {
  assert.equal(a.length, b.length);
  return a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length;
};
const intersect = (a, b) => Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x)
  && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);

await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });

async function settled(page) {
  await page.locator('.room-motion').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.room-hotspot-glass').length === 6);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await document.querySelector('.room-image').decode();
    document.querySelector('.room-motion').scrollIntoView({ block: 'center' });
  });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

async function animationState(page) {
  return page.locator('.room-motion').evaluate(root => {
    const image = root.querySelector('.room-image');
    const light = root.querySelector('.room-daylight');
    const shadow = root.querySelector('.room-window-shadow');
    const imageStyle = getComputedStyle(image);
    const lightStyle = getComputedStyle(light);
    const shadowStyle = getComputedStyle(shadow);
    return {
      motion: root.dataset.motion,
      transform: imageStyle.transform,
      translate: imageStyle.translate,
      opacity: lightStyle.opacity,
      imageAnimation: imageStyle.animationName,
      lightAnimation: lightStyle.animationName,
      imageState: imageStyle.animationPlayState,
      lightState: lightStyle.animationPlayState,
      shadowAnimation: shadowStyle.animationName,
      shadowState: shadowStyle.animationPlayState,
      shadowOpacity: shadowStyle.opacity,
      currentTimes: [...image.getAnimations(), ...light.getAnimations(), ...shadow.getAnimations()].map(animation => animation.currentTime)
    };
  });
}

async function boxes(page) {
  return page.locator('.room-motion, .hotspot, .room-motion-toggle, .room-corner').evaluateAll(nodes => nodes.map(node => {
    const { x, y, width, height } = node.getBoundingClientRect();
    return { x, y, width, height };
  }));
}

try {
  for (const [name, width, height, reduced] of cases) {
    const context = await browser.newContext({
      viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference'
    });
    try {
      assert.equal((await context.request.post(`${base}/api/dev-login`, {
        data: { slot: 'yiting' }, headers: { 'X-House-Request': '1', Origin: base }
      })).status(), 200);
      const before = await (await context.request.get(`${base}/api/house`)).json();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(base);
      await settled(page);
      const room = page.locator('.room-motion');
      const control = page.locator('.room-motion-toggle');
      const image = await page.locator('.room-image').evaluate(node => ({
        source: node.getAttribute('src'), width: node.naturalWidth, height: node.naturalHeight,
        directChild: node.parentElement.classList.contains('room-motion')
      }));
      assert.ok(image.width > 0 && image.height > 0 && image.directChild, 'The existing room image must load intact');
      assert.ok(image.source.startsWith('/api/media/'), 'Use the authenticated personalized room, not a replacement asset');
      assert.equal(await page.locator('.room-daylight[aria-hidden="true"]').count(), 1);
      assert.equal(await page.locator('.room-window-shadow[aria-hidden="true"]').count(), 1);
      assert.equal(await page.locator('.hotspot').count(), 6);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');

      const originalBoxes = await boxes(page);
      const roomBox = await room.boundingBox();
      const controlBox = await control.boundingBox();
      assert.equal(controlBox.width, 44);
      assert.equal(controlBox.height, 44);
      const buttonAppearance = await control.evaluate(node => {
        node.focus();
        const style = getComputedStyle(node);
        const face = getComputedStyle(node, '::before');
        const result = { outline: style.outlineStyle, width: face.width, height: face.height, border: face.borderWidth };
        node.blur();
        return result;
      });
      assert.deepEqual(buttonAppearance, { outline: 'none', width: '30px', height: '30px', border: '0px' });
      assert.ok(controlBox.x >= roomBox.x && controlBox.y >= roomBox.y
        && controlBox.x + controlBox.width <= roomBox.x + roomBox.width
        && controlBox.y + controlBox.height <= roomBox.y + roomBox.height, 'Pause control must stay within the scene');
      for (const node of await page.locator('.hotspot, .room-corner, .first-tip, .site-header').all()) {
        assert.ok(!intersect(controlBox, await node.boundingBox()), 'Pause control must not overlap room controls or the header');
      }
      const initial = await animationState(page);
      const first = await pixels(await room.screenshot());
      assert.ok(Math.max(...first.subarray(0, 10000)) - Math.min(...first.subarray(0, 10000)) > 40, 'Scene must be nonblank');
      await page.waitForTimeout(2000);
      const animated = await animationState(page);
      const motion = difference(first, await pixels(await room.screenshot()));
      const nextBoxes = await boxes(page);
      originalBoxes.forEach((box, index) => Object.keys(box).forEach(key => {
        assert.ok(Math.abs(box[key] - nextBoxes[index][key]) <= 0.5, `Fixed room element ${index} ${key} moved`);
      }));

      if (reduced) {
        assert.equal(initial.motion, 'paused');
        assert.equal(initial.imageAnimation, 'none');
        assert.equal(initial.lightAnimation, 'none');
        assert.equal(initial.shadowAnimation, 'none');
        assert.equal(initial.transform, 'none');
        assert.equal(initial.opacity, '0');
        assert.equal(initial.shadowOpacity, '0');
        assert.equal(await control.getAttribute('aria-label'), '已遵循减少动态设置');
        assert.ok(await control.isDisabled());
        assert.ok(motion < 0.02, `Reduced motion must remain still: ${motion}`);
      } else {
        assert.equal(initial.motion, 'playing');
        assert.notEqual(initial.transform, animated.transform, 'The room image must move subtly');
        assert.notEqual(initial.opacity, animated.opacity, 'Daylight must change gradually');
        assert.notEqual(initial.shadowOpacity, animated.shadowOpacity, 'Window shadows must move gradually');
        assert.ok(motion > 0.05, `The living room must visibly animate: ${motion}`);
        if (name === 'desktop') {
          await page.mouse.move(roomBox.x + roomBox.width * 0.1, roomBox.y + roomBox.height * 0.45);
          await page.waitForTimeout(1000);
          const leftTranslate = (await animationState(page)).translate;
          await page.mouse.move(roomBox.x + roomBox.width * 0.85, roomBox.y + roomBox.height * 0.45);
          await page.waitForTimeout(1000);
          assert.notEqual((await animationState(page)).translate, leftTranslate, 'Mouse movement must shift the image perspective');
          await page.mouse.move(0, 0);
          await page.waitForTimeout(300);
          const pointerBoxes = await boxes(page);
          originalBoxes.forEach((box, index) => Object.keys(box).forEach(key => {
            assert.ok(Math.abs(box[key] - pointerBoxes[index][key]) <= 0.5, `Pointer parallax must not move control ${index}`);
          }));
        }
        await page.getByRole('button', { name: '暂停小屋动效', exact: true }).click();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(300);
        assert.equal((await animationState(page)).motion, 'paused');
        const frozen = await animationState(page);
        const pausedPixels = await pixels(await room.screenshot());
        await page.waitForTimeout(800);
        assert.deepEqual(await animationState(page), frozen, 'Pause must freeze both animation clocks');
        assert.ok(difference(pausedPixels, await pixels(await room.screenshot())) < 0.02, 'Paused image must remain still');
        assert.equal(await page.evaluate(() => localStorage.getItem('house-room-motion')), 'paused');
        await page.reload();
        await settled(page);
        assert.equal((await animationState(page)).motion, 'paused', 'Pause choice must survive reload');
        await page.getByRole('button', { name: '播放小屋动效', exact: true }).click();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(150);
        const resumed = await animationState(page);
        await page.waitForTimeout(350);
        assert.equal(resumed.motion, 'playing');
        assert.notEqual((await animationState(page)).transform, resumed.transform, 'Resume must restart image movement');
        assert.equal(await page.evaluate(() => localStorage.getItem('house-room-motion')), 'playing');

        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        if ((await room.boundingBox()).y + (await room.boundingBox()).height > 0) {
          await page.setViewportSize({ width, height: 260 });
          await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        }
        await page.waitForFunction(() => document.querySelector('.room-motion').dataset.motion === 'paused');
        const hidden = await animationState(page);
        await page.waitForTimeout(300);
        assert.deepEqual(await animationState(page), hidden, 'Offscreen room must stop spending animation work');
        await page.setViewportSize({ width, height });
        await settled(page);
        await page.waitForFunction(() => document.querySelector('.room-motion').dataset.motion === 'playing');
      }

      // Avoid "miss you": it saves a real record. The other hotspots only open views.
      for (const index of [0, 1, 2, 4, 5]) {
        await page.locator('.hotspot').nth(index).click();
        await page.locator('.sheet').waitFor();
        assert.equal((await animationState(page)).motion, 'paused', 'Covered home must pause');
        await page.getByRole('button', { name: '回到小屋', exact: true }).last().click();
        await page.locator('.sheet').waitFor({ state: 'detached' });
        await settled(page);
      }
      await page.screenshot({ path: `test-results/room-motion-${name}.png`, fullPage: true });
      assert.deepEqual(await (await context.request.get(`${base}/api/house`)).json(), before, 'Read-only motion checks must not change any records');
      assert.deepEqual(errors, []);
      results.push({ name, image: `${image.width}x${image.height}`, motion: Number(motion.toFixed(3)),
        fixedHotspots: true, reducedMotion: reduced, controlsWork: true, recordsUnchanged: true });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally { await browser.close(); }
