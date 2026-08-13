/* eslint-disable no-console */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PLAYABLE_PORT || 5174);
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function buildPlayable(initialState) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      request.destroy(new Error('playable build request timed out'));
    }, 45000);
    const request = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/build-playable?filename=feedback-test.html&autoTutorial=true',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        clearTimeout(timeout);
        if (response.statusCode !== 200) {
          reject(new Error(`playable build failed (${response.statusCode}): ${body}`));
          return;
        }
        resolve(body);
      });
    });
    request.on('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    request.end(JSON.stringify({ initialState: JSON.stringify(initialState) }));
  });
}

function block(id, col, row, length, color) {
  return { id, col, row, length, color, noGravity: false, isCollectible: false, isProp: false, propDir: 'left' };
}

async function main() {
  const effectType = process.env.PLAYABLE_EFFECT_TYPE || 'default';
  const state = {
    params: { gridCols: 11, totalRows: 18, viewportRows: 18, cellSize: 50, effectType, shatterMode: 2 },
    probs: { 1: 20, 2: 40, 3: 30, 4: 10 },
    modes: { boardMechanic: 'fixed', boardAdvanceMode: 'fixed', gameRule: 'normal' },
    boardMechanic: 'fixed',
    boardAdvanceMode: 'fixed',
    gameRule: 'normal',
    background: { enabled: false, dataUrl: '', activeId: 'none' },
    audio: { muteVocals: false },
    currentLevel: 284,
    currentScore: 0,
    tutorialMoveAvailable: true,
    tutorialTarget: { blockId: 4, fromCol: 9, toCol: 10, row: 15, dir: 1, cells: 1, eliminationRow: 17, totalCleared: 1 },
    exportedBlockCount: 4,
    blocks: [
      block(1, 0, 16, 4, 'red'),
      block(2, 4, 16, 4, 'green'),
      block(3, 8, 16, 2, 'blue'),
      block(4, 9, 15, 1, 'yellow'),
    ],
  };
  console.log('building playable');
  const html = await buildPlayable(state);
  assert.match(html, /effectFrames/);
  assert.match(html, /data:audio/);

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-playable-feedback-'));
  const outputPath = path.join(outputDir, 'feedback-test.html');
  fs.writeFileSync(outputPath, html);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const errors = [];
  const failedRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
  });
  page.on('requestfailed', request => failedRequests.push(`${request.url()} :: ${request.failure()?.errorText || ''}`));
  await page.addInitScript(() => {
    window.__playedAudioSources = [];
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function patchedPlay() {
      window.__playedAudioSources.push(this.currentSrc || this.src || '');
      return originalPlay.call(this);
    };
  });
  console.log('opening playable');
  await page.goto(pathToFileURL(outputPath).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    canvas.style.touchAction = 'none';
    canvas.style.pointerEvents = 'auto';
  });
  console.log('waiting for runtime initialization');
  await page.waitForFunction(() => window.__playableLoadedBlockCount === 4, null, { timeout: 30000 });
  await page.waitForSelector('.playable-guide-overlay', { timeout: 30000 });
  await page.waitForSelector('.playable-hand-cue', { timeout: 30000 });
  await page.waitForSelector('.playable-hand-arrow', { timeout: 30000 });
  await page.waitForTimeout(400);

  const headerLayout = await page.evaluate(() => {
    const header = document.querySelector('#game-header').getBoundingClientRect();
    const items = Array.from(document.querySelectorAll('#game-header .header-item')).map(item => item.getBoundingClientRect());
    return { header: { left: header.left, width: header.width }, items: items.map(item => ({ left: item.left, width: item.width })) };
  });
  assert.equal(headerLayout.items.length, 2, 'playable header items are missing');
  assert.ok(Math.abs((headerLayout.items[0].left + headerLayout.items[0].width / 2) - (headerLayout.header.left + headerLayout.header.width / 4)) < 2, 'level is not centered in the left header half');
  assert.ok(Math.abs((headerLayout.items[1].left + headerLayout.items[1].width / 2) - (headerLayout.header.left + headerLayout.header.width * 0.75)) < 2, 'score is not centered in the right header half');

  const geometry = await page.evaluate(() => {
    const target = window.getBlocks().find(block => block.id === 4);
    const global = target.sprite.getGlobalPosition();
    const bounds = target.sprite.getBounds();
    const canvas = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: canvas.left + (global.x + target.sprite.width / 2) * canvas.width / 373,
      y: canvas.top + (global.y + target.sprite.height / 2) * canvas.height / 590,
      bounds,
    };
  });
  assert.ok(Number.isFinite(geometry.x) && Number.isFinite(geometry.y), 'playable block geometry is invalid');
  const effectAssets = await page.evaluate(() => window.getPlayableEffectAssetStatus());
  console.log('triggering one-row elimination');
  await page.evaluate(() => {
    const target = window.getBlocks().find(block => block.id === 4);
    const start = { x: target.sprite.x + target.sprite.width / 2, y: target.sprite.y + target.sprite.height / 2 };
    let stage = target.sprite;
    while (stage.parent) stage = stage.parent;
    target.sprite.emit('pointerdown', { global: start });
    stage.emit('pointermove', { global: { x: start.x + 40, y: start.y } });
    stage.emit('pointerup', { global: { x: start.x + 40, y: start.y } });
  });
  await page.waitForTimeout(1800);

  const result = await page.evaluate(() => ({
    shatterCells: window.getLastShatterCellColors(),
    playedAudio: window.__playedAudioSources.map(source => source.slice(0, 24)),
    blockCount: window.getBlocksCount(),
    blocks: window.getBlocks().map(block => ({ id: block.id, col: block.col, row: block.row, x: block.sprite.x, y: block.sprite.y })),
  }));
  await page.screenshot({ path: path.join(ROOT, 'codex_playable_feedback_integration.png'), fullPage: true });
  console.log('closing browser');
  await browser.close();
  fs.rmSync(outputDir, { recursive: true, force: true });

  console.log(JSON.stringify({ effectAssets, result, errors, failedRequests }));
  const unexpectedFailures = failedRequests.filter(message => !message.includes('/assets/ui/free-to-play.png'));
  assert.equal(unexpectedFailures.length, 0, unexpectedFailures.join('\n'));
  if (effectType === 'default') {
    assert.equal(effectAssets.left, 44, 'default left shatter frames did not load');
    assert.equal(effectAssets.right, 44, 'default right shatter frames did not load');
  } else if (effectType === 'highlight') {
    assert.equal(effectAssets.highlight, 34, 'highlight shatter frames did not load');
  } else if (effectType === 'traditional') {
    assert.equal(effectAssets.traditional, 34, 'traditional shatter frames did not load');
  }
  assert.ok(result.shatterCells.length >= 11, 'full row did not trigger shatter frames');
  assert.ok(result.playedAudio.some(source => source.startsWith('data:audio')), 'playable did not request embedded audio playback');
  console.log(JSON.stringify(result));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
