const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const rulesPath = path.join(root, 'src', 'propRules.ts');

assert.ok(fs.existsSync(rulesPath), 'prop elimination rules must live in a shared module');

const source = fs.readFileSync(rulesPath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const rulesModule = new Module(rulesPath, module);
rulesModule.filename = rulesPath;
rulesModule.paths = Module._nodeModulePaths(path.dirname(rulesPath));
rulesModule._compile(compiled, rulesPath);

const { damagePropForClearedRows, getPropOccupiedColumns, isValidPropLength } = rulesModule.exports;

assert.deepEqual(
  getPropOccupiedColumns({ col: 2, length: 4, propDir: 'left' }),
  [2, 3, 4],
  'the machine head must not occupy a candy grid cell',
);
assert.deepEqual(
  getPropOccupiedColumns({ col: 2, length: 4, propDir: 'right' }),
  [3, 4, 5],
  'the machine head must be excluded on either side',
);
assert.deepEqual(
  getPropOccupiedColumns({ col: 5, length: 1, propDir: 'left' }),
  [],
  'a machine-head-only legacy prop must occupy no candy cells',
);

assert.equal(isValidPropLength(2), true, 'a prop with one candy segment and one machine head is valid');
assert.equal(isValidPropLength(1), false, 'a machine-head-only prop is invalid');

assert.deepEqual(
  damagePropForClearedRows(
    { row: 8, col: 2, length: 4, propDir: 'left' },
    [8],
  ),
  { triggered: true, col: 3, length: 3, destroyed: false },
  'clearing the prop row must remove exactly one candy segment',
);
assert.deepEqual(
  damagePropForClearedRows(
    { row: 8, col: 2, length: 4, propDir: 'right' },
    [7],
  ),
  { triggered: true, col: 2, length: 3, destroyed: false },
  'clearing an adjacent row must remove exactly one candy segment',
);
assert.deepEqual(
  damagePropForClearedRows(
    { row: 8, col: 2, length: 2, propDir: 'left' },
    [9],
  ),
  { triggered: true, col: 3, length: 0, destroyed: true },
  'the final candy segment and machine head must disappear together',
);
assert.deepEqual(
  damagePropForClearedRows(
    { row: 8, col: 2, length: 4, propDir: 'left' },
    [10],
  ),
  { triggered: false, col: 2, length: 4, destroyed: false },
  'non-adjacent clears must not damage the prop',
);

const mainSource = fs.readFileSync(path.join(root, 'src', 'main.ts'), 'utf8');
assert.doesNotMatch(
  mainSource,
  /extraPropRows|extraSimPropRows/,
  'prop rows must not be promoted into ordinary cleared rows',
);
assert.match(
  mainSource,
  /blocks\.filter\(b => !b\.isProp && fullRows\.includes\(b\.row\)\)/,
  'ordinary row removal must exclude props',
);
assert.match(
  mainSource,
  /if \(!simBlocks\[i\]\.isProp && fullRows\.includes\(simBlocks\[i\]\.row\)\)/,
  'simulated row removal must exclude props',
);
assert.match(
  mainSource,
  /if \(isProp && !isValidPropLength\(length\)\) return null;/,
  'legacy machine-head-only props must not be restored or spawned',
);

console.log('prop elimination regression checks passed');
