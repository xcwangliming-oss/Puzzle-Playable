/* eslint-disable no-console */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const PORT = Number(process.env.PLAYABLE_PORT || 5174);
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL6VwAAAABJRU5ErkJggg==';

function buildPlayable(initialState) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/build-playable?filename=prop-style-test.html&autoTutorial=false',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`playable build failed (${response.statusCode}): ${body}`));
          return;
        }
        resolve(body);
      });
    });
    request.on('error', reject);
    request.end(JSON.stringify({ initialState: JSON.stringify(initialState) }));
  });
}

async function main() {
  const state = {
    params: { gridCols: 11, totalRows: 18, viewportRows: 18, cellSize: 50, effectType: 'default' },
    exportedBlockCount: 1,
    blocks: [{
      id: 81,
      col: 3,
      row: 8,
      length: 7,
      color: 'red',
      noGravity: false,
      isCollectible: false,
      isProp: true,
      propType: 'peppermint',
      propDir: 'right',
    }],
    propStyle: {
      candy: PIXEL,
      machineFrames: [PIXEL],
      machineAttackFrames: [PIXEL],
    },
  };

  const html = await buildPlayable(state);
  const match = html.match(/window\.PLAYABLE_CONFIG = (.*?);<\/script>/);
  assert.ok(match, 'PLAYABLE_CONFIG was not injected');
  const config = JSON.parse(match[1]);
  const savedState = JSON.parse(config.initialState);

  assert.equal(savedState.propStyle.candy, PIXEL, 'custom candy image was not embedded');
  assert.deepEqual(savedState.propStyle.machineFrames, [PIXEL], 'custom machine frame was not embedded');
  assert.deepEqual(savedState.propStyle.machineAttackFrames, [PIXEL], 'custom attack frame was not embedded');
  assert.deepEqual(savedState.blocks[0], state.blocks[0], 'authored prop placement changed during export');

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-playable-prop-style-'));
  const outputPath = path.join(outputDir, 'prop-style-test.html');
  fs.writeFileSync(outputPath, html);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(outputPath).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__playableLoadedBlockCount === 1, null, { timeout: 30000 });
  const loadedProp = await page.evaluate(() => {
    const block = window.getBlocks()[0];
    return block && { isProp: block.isProp, length: block.length, col: block.col, row: block.row };
  });
  await browser.close();
  fs.rmSync(outputDir, { recursive: true, force: true });

  assert.deepEqual(errors, [], `standalone custom prop image caused runtime errors: ${errors.join('\n')}`);
  assert.deepEqual(loadedProp, { isProp: true, length: 7, col: 3, row: 8 }, 'custom prop did not initialize at its authored location');
  console.log('playable custom prop style export passed');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
