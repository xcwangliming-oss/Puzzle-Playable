/* eslint-disable no-console */
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium } = require('playwright');

const PORT = Number(process.env.PLAYABLE_PORT || 5174);
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function buildPlayable(initialState) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/build-playable?filename=channel-test.html&autoTutorial=false',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => response.statusCode === 200 ? resolve(body) : reject(new Error(body)));
    });
    request.on('error', reject);
    request.end(JSON.stringify({ initialState: JSON.stringify(initialState) }));
  });
}

async function main() {
  const state = {
    params: { gridCols: 11, totalRows: 18, viewportRows: 18, cellSize: 50, effectType: 'default' },
    exportedBlockCount: 1,
    blocks: [{ id: 1, col: 5, row: 16, length: 3, color: 'red', noGravity: false, isCollectible: false, isProp: false, propDir: 'left' }],
  };
  console.log('building base playable');
  const playableHtml = await buildPlayable(state);
  console.log('launching browser');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  console.log('loading editor');
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  console.log('building channel artifacts');
  const bundle = await page.evaluate(async (html) => {
    const built = await window.__buildChannelBundleForTest(html, 'channel-test.html');
    const decoder = new TextDecoder();
    const getArtifact = channel => built.artifacts.find(artifact => artifact.channel === channel);
    const inspectHtml = channel => {
      const text = decoder.decode(getArtifact(channel).data);
      return {
        marker: text.includes(`BLOCK_PUZZLE_CHANNEL:${channel}`),
        bridge: text.includes('triggerPlayableCTA=wrapped'),
      };
    };
    return {
      zip: { bytes: built.zip.length, signature: [built.zip[0], built.zip[1]] },
      artifacts: built.artifacts.map(artifact => ({ name: artifact.name, bytes: artifact.data.length })),
      html: {
        AppLovin: inspectHtml('AppLovin'),
        Moloco: inspectHtml('Moloco'),
        Unity: inspectHtml('Unity'),
      },
      archives: {
        Facebook: Array.from(getArtifact('Facebook').data.slice(0, 2)),
        Google: Array.from(getArtifact('Google').data.slice(0, 2)),
      },
    };
  }, playableHtml);
  console.log('validating artifacts');
  await browser.close();

  assert.deepEqual(bundle.artifacts.map(entry => entry.name), [
    'BlockPuzzle_channel-test_apl.html',
    'BlockPuzzle_channel-test_fb.zip',
    'BlockPuzzle_channel-test_gg.zip',
    'BlockPuzzle_channel-test_moloco.html',
    'BlockPuzzle_channel-test_unt.html',
  ], 'five-channel archive contents changed');
  assert.ok(bundle.artifacts.every(artifact => artifact.bytes > 0 && artifact.bytes <= 5 * 1024 * 1024), 'a channel artifact is empty or exceeds 5 MB');
  for (const channel of ['AppLovin', 'Moloco', 'Unity']) {
    assert.equal(bundle.html[channel].marker, true, `${channel} marker missing`);
    assert.equal(bundle.html[channel].bridge, true, `${channel} CTA bridge missing`);
  }
  for (const channel of ['Facebook', 'Google']) {
    assert.deepEqual(bundle.archives[channel], [0x50, 0x4b], `${channel} ZIP is invalid`);
  }
  assert.deepEqual(bundle.zip.signature, [0x50, 0x4b], 'outer channel bundle is invalid');
  assert.ok(bundle.zip.bytes > 0, 'outer channel bundle is empty');
  console.log('playable five-channel bundle export passed');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
