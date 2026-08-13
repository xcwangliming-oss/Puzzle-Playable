import assert from 'node:assert/strict';
import {
  createInitialPlayableBlocks,
  hasContinuousScrollTopCollision,
  getNextCollectionMissionTarget,
  getBoardMechanicBehavior,
  getFallingTopSupplyRows,
  getRisingSupplyRowPlan,
  getTutorialSearchRows,
  getTutorialHandPlacement,
  getRisingRowsForCompletedMove,
  normalizeBoardMechanic,
  pickTutorialEliminationMove,
} from '../src/boardMechanics.ts';
import { getFailureOverlayMotion } from '../src/failureOverlay.ts';
import { getPlayableBlockLoadError } from '../src/playableStateContract.ts';

assert.equal(normalizeBoardMechanic({ boardMechanic: 'scroll' }), 'scroll');
assert.equal(normalizeBoardMechanic({ isFallingMode: true }), 'falling');
assert.equal(normalizeBoardMechanic({ boardAdvanceMode: 'rising' }), 'rising');
assert.equal(normalizeBoardMechanic({}), 'scroll');
assert.equal(normalizeBoardMechanic({ boardMechanic: 'falling', isFallingMode: false }), 'falling');
assert.equal(normalizeBoardMechanic({ boardMechanic: 'scroll', boardAdvanceMode: 'fixed' }), 'scroll');

assert.deepEqual(getBoardMechanicBehavior('fixed'), {
  refill: 'none',
  movement: 'none',
  failsAtTop: false,
});
assert.deepEqual(getBoardMechanicBehavior('rising'), {
  refill: 'bottom',
  movement: 'discrete',
  failsAtTop: true,
});
assert.deepEqual(getBoardMechanicBehavior('scroll'), {
  refill: 'bottom',
  movement: 'continuous',
  failsAtTop: true,
});
assert.deepEqual(getBoardMechanicBehavior('falling'), {
  refill: 'top',
  movement: 'gravity',
  failsAtTop: false,
});

const authoredBlocks = [
  { id: 7, col: 2, row: 1, length: 2, color: 'pink' },
  { id: 8, col: 0, row: 2, length: 1, color: 'blue' },
];

assert.deepEqual(
  createInitialPlayableBlocks({
    blocks: authoredBlocks,
    mechanic: 'fixed',
    cols: 5,
    rows: 3,
  }),
  authoredBlocks,
  'non-falling exports must preserve the authored board coordinates exactly',
);

const fallingBlocks = createInitialPlayableBlocks({
  blocks: authoredBlocks,
  mechanic: 'falling',
  cols: 5,
  rows: 3,
  holeMask: [
    [false, false, true, false, false],
    [false, false, false, false, false],
    [false, false, false, false, false],
  ],
  colors: ['red', 'blue'],
  random: () => 0.5,
});

assert.deepEqual(
  fallingBlocks,
  authoredBlocks,
  'falling exports must preserve the authored opening board exactly; new blocks enter later from above the viewport',
);

assert.equal(getRisingRowsForCompletedMove(0), 1, 'every successful rising move must advance one row');
assert.equal(getRisingRowsForCompletedMove(1), 1, 'a single cleared wave shares the move rise');
assert.equal(getRisingRowsForCompletedMove(2), 2, 'two chained elimination waves must advance two rows');
assert.equal(getRisingRowsForCompletedMove(8), 3, 'rising advances must cap chained eliminations at three rows');

assert.deepEqual(
  getRisingSupplyRowPlan(18),
  { spawnRow: 18, finalRow: 17 },
  'rising supply blocks must start one row below the viewport before entering through the bottom edge',
);

assert.deepEqual(
  getFallingTopSupplyRows(0, 0),
  [],
  'falling mode must not create supply when the visible top is occupied',
);
assert.deepEqual(
  getFallingTopSupplyRows(1, 0),
  [-1],
  'one blank top row must be replenished from one row above the viewport',
);
assert.deepEqual(
  getFallingTopSupplyRows(6, 0),
  [-3, -2, -1],
  'falling mode must cap its hidden supply queue at three rows',
);

assert.equal(
  hasContinuousScrollTopCollision([{ row: 1 }], 40, 39, 18),
  false,
  'a block one cell below the top must not fail before its edge reaches the viewport',
);
assert.equal(
  hasContinuousScrollTopCollision([{ row: 1 }], 40, 40, 18),
  true,
  'continuous scroll must fail as soon as a visible block reaches the top edge',
);
assert.equal(
  hasContinuousScrollTopCollision([{ row: 18 }], 40, 40, 18),
  false,
  'the supply row below the viewport must never be treated as a top collision',
);

assert.deepEqual(
  getTutorialHandPlacement({
    pointerX: 220,
    pointerY: 330,
    width: 100,
    height: 114,
  }),
  { left: 199, top: 323 },
  'tutorial hand must align its visible fingertip with the highlighted move target',
);

assert.deepEqual(
  getTutorialSearchRows(18, 18),
  { minRow: 0, maxRow: 17 },
  'tutorial validation must search the exported playable opening, not the editor camera position',
);

assert.equal(
  getNextCollectionMissionTarget(undefined),
  null,
  'collection mode without a configured target must not complete the mission',
);
assert.equal(getNextCollectionMissionTarget(1), 0, 'a configured one-item mission completes after one item');
assert.equal(getNextCollectionMissionTarget(30), 29, 'a configured mission decrements by one item');

assert.deepEqual(
  pickTutorialEliminationMove([
    { blockId: 1, fromCol: 1, toCol: 2, row: 5, totalCleared: 0, firstWaveRows: [] },
    { blockId: 2, fromCol: 5, toCol: 2, row: 7, totalCleared: 1, firstWaveRows: [7] },
    { blockId: 3, fromCol: 1, toCol: 2, row: 3, totalCleared: 2, firstWaveRows: [3, 4] },
  ]),
  { blockId: 3, fromCol: 1, toCol: 2, row: 3, totalCleared: 2, firstWaveRows: [3, 4] },
  'tutorial must choose a move whose first slide immediately clears the most rows',
);

assert.equal(
  pickTutorialEliminationMove([
    { blockId: 1, fromCol: 1, toCol: 3, row: 5, totalCleared: 0, firstWaveRows: [] },
  ]),
  null,
  'tutorial must not point at a move that cannot clear a row',
);

assert.deepEqual(
  getFailureOverlayMotion(),
  {
    overlayOpacity: 0.4,
    initialScale: 2.4,
    finalScale: 1,
    initialAlpha: 0,
    finalAlpha: 1,
    duration: 0.58,
    ease: 'power3.in',
  },
  'failure overlay must use a 40% black mask and a heavy fade-in impact motion',
);

assert.equal(
  getPlayableBlockLoadError(12, 12),
  null,
  'a playable can continue only when every exported block is loaded',
);
assert.equal(
  getPlayableBlockLoadError(12, 0),
  '试玩方块加载不完整：导出 12 个，实际加载 0 个。',
  'a blank playable must be rejected before it can be downloaded',
);

console.log('boardMechanics tests passed');
