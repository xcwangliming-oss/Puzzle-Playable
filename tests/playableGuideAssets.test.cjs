const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'src', 'main.ts'), 'utf8');

assert.equal(
  fs.existsSync(path.join(root, 'assets', 'ui', 'jewel-hand.png')),
  true,
  'The standalone build must own the Jewel tutorial hand asset.',
);
assert.equal(
  fs.existsSync(path.join(root, 'assets', 'ui', 'jewel-arrow.png')),
  true,
  'The standalone build must own the Jewel tutorial arrow asset.',
);
assert.match(
  mainSource,
  /import jewelHandUrl from '\.\.\/assets\/ui\/jewel-hand\.png';?/,
  'The tutorial hand must be imported through Vite so it is embedded in downloads.',
);
assert.match(
  mainSource,
  /import jewelArrowUrl from '\.\.\/assets\/ui\/jewel-arrow\.png';?/,
  'The tutorial arrow must be imported through Vite so it is embedded in downloads.',
);
assert.match(
  mainSource,
  /hand\.style\.backgroundImage\s*=\s*`url\("\$\{jewelHandUrl\}"\)`/,
  'The tutorial hand element must use the bundled image URL.',
);
assert.match(
  mainSource,
  /arrow\.style\.backgroundImage\s*=\s*`url\("\$\{jewelArrowUrl\}"\)`/,
  'The tutorial arrow element must use the bundled image URL.',
);
assert.match(
  mainSource,
  /if \(isStandalonePlayable\) \{\s*\/\/ Exported playables use only the effect selected at export time\.\s*restoreDefaultEffects\(\);\s*\} else try \{\s*await effectDB\.init\(\);/s,
  'A standalone playable must not restore an editor-local custom shatter pack.',
);
assert.match(
  mainSource,
  /const PLAYABLE_IOS_STORE_URL = 'https:\/\/apps\.apple\.com\/us\/app\/jewel-sliding-block-puzzle\/id1476678178';/,
  'The exported playable must own the configured Apple App Store destination.',
);
assert.match(
  mainSource,
  /const PLAYABLE_ANDROID_STORE_URL = 'https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.sportbrain\.jewelpuzzle';/,
  'The exported playable must own the configured Google Play destination.',
);
assert.match(
  mainSource,
  /function openPlayableStore\(\): void \{[\s\S]*?mraid\.open\(targetUrl\)[\s\S]*?window\.location\.assign\(targetUrl\)/,
  'Playables must route click-throughs to the matching store through MRAID or browser navigation.',
);
assert.match(
  mainSource,
  /showFailureImpact\(\);[\s\S]*?if \(isStandalonePlayable\) \{[\s\S]*?triggerPlayableCTA\(\);[\s\S]*?return;/,
  'A standalone playable failure must show the impact briefly before redirecting.',
);

const tutorialFunction = mainSource.match(/function getPlayableTutorialTarget\(\) \{([\s\S]*?)\n\}\n\n\n\nfunction getImmediatePlayableFullRows/);
assert.ok(tutorialFunction, 'The playable tutorial search must remain available for regression coverage.');
assert.match(
  tutorialFunction[1],
  /const simResult = simulateSimMove\(cloneBlocks, block\.id, toCol\);[\s\S]*?const firstWaveRows = simResult\.eliminationWaves\[0\] \|\| \[\];/,
  'Tutorial validation must follow the same move, gravity, and elimination sequence as live gameplay.',
);

const editorSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const playableGameUiRule = editorSource.match(/body\.is-playable #game-ui\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';
const playableBoardRule = editorSource.match(/body\.is-playable #board-wrapper\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';

assert.match(
  playableGameUiRule,
  /width:\s*min\(100vw, calc\(100dvh \* 9 \/ 16\)\) !important;/,
  'Exported playables must preserve their portrait width on wide desktop viewports.',
);
assert.match(
  playableGameUiRule,
  /height:\s*min\(100dvh, calc\(100vw \* 16 \/ 9\)\) !important;/,
  'Exported playables must preserve their portrait height on short or narrow viewports.',
);
assert.match(
  playableBoardRule,
  /aspect-ratio:\s*9 \/ 16 !important;/,
  'The exported board stage must keep the same 9:16 phone ratio as the generated playable.',
);
assert.doesNotMatch(
  playableBoardRule,
  /aspect-ratio:\s*auto !important;/,
  'The exported board stage must never stretch to the browser viewport ratio.',
);
assert.match(
  editorSource,
  /body\.is-playable \.header-item\s*\{[\s\S]*?font-size:\s*clamp\(18px, 5vw, 30px\) !important;/,
  'The exported playable header must remain readable at both desktop and phone sizes.',
);

assert.doesNotMatch(
  editorSource,
  /if \(autoTutorial && exportedState\.tutorialMoveAvailable !== true\)\s*\{\s*throw new Error\(/s,
  'A missing automatic tutorial target must not block playable export.',
);

const viteSource = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
assert.match(
  viteSource,
  /effectType === 'default'[\s\S]*?assets\/effects\/playable-default[\s\S]*?l_\$\{String\(index\)\.padStart\(2, '0'\)\}\.webp[\s\S]*?r_\$\{String\(index\)\.padStart\(2, '0'\)\}\.webp/,
  'Default shatter must use the compact playable frames rather than the full editor PNG sequence.',
);
const defaultEffectExport = viteSource.match(/if \(effectType === 'default'\) \{([\s\S]*?)\n  \}/);
assert.ok(defaultEffectExport, 'The default effect export branch must remain available.');
assert.doesNotMatch(
  defaultEffectExport[1],
  /throw new Error/,
  'The default effect must not be rejected by the export-time size guard.',
);

console.log('playable guide asset tests passed');
