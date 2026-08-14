/* eslint-disable no-console */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.ts'), 'utf8');

assert.match(indexHtml, /window\.super_html=Object\.assign\(\{\},previous/);
assert.match(indexHtml, /download:function\(url\)\{cta\(url\);\}/);
assert.doesNotMatch(indexHtml, /previousDownload\.call\(window\.super_html/);
assert.match(indexHtml, /https:\/\/tpc\.googlesyndication\.com\/pagead\/gadgets\/html5\/api\/exitapi\.js/);
assert.match(indexHtml, /indexHtml: html\.replace\(configPattern, '<script src="res\.js">'/);
assert.match(indexHtml, /resJs: `window\.PLAYABLE_CONFIG = \$\{match\[1\]\};`/);
assert.match(indexHtml, /AppLovin: 'apl', Facebook: 'fb', Google: 'gg', Moloco: 'moloco', Unity: 'unt'/);
assert.match(mainSource, /viewableChange/);
assert.match(mainSource, /isViewable\(\)/);
assert.match(mainSource, /freeToPlayUrl/);
assert.match(indexHtml, /playable-cta-breathe/);
assert.match(indexHtml, /bottom: 15px/);
assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'ui', 'free-to-play.png')));

console.log('playable channel packaging static checks passed');
