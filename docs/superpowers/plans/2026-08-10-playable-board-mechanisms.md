# Playable Board Mechanisms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make editor, embedded preview, and exported playable share one explicit game-rule plus board-mechanism configuration, with fixed, discrete infinite-rising, continuous scrolling, and endless falling mechanics.

**Architecture:** Keep colour and effect selection as `gameRule`; introduce `boardMechanic` as the only source of truth for how the board replenishes and fails. Normalize legacy `isFallingMode` and `boardAdvanceMode` at the load boundary so existing saves still load, while every new export uses the explicit two-field model.

**Tech Stack:** TypeScript, PIXI.js, GSAP, Vite, Node 24 type stripping for focused unit tests.

## Global Constraints

- Default board mechanism is `scroll`.
- `normal` is only a five-colour baseline game rule and must not modify the chosen board mechanism.
- `fixed` has no replenishment and wins when no blocks remain.
- `rising` replenishes from the bottom and advances only after a completed move/elimination, one to three rows.
- `scroll` replenishes from the bottom and continuously rises after the tutorial; top contact is failure.
- `falling` replenishes from the top under gravity and has no game-over condition.
- New exports contain `gameRule` and `boardMechanic`; loading supports old `isFallingMode` and `boardAdvanceMode` data.

---

### Task 1: Define and test the shared board-mechanism model

**Files:**
- Create: `src/boardMechanics.ts`
- Create: `tests/boardMechanics.test.ts`
- Modify: `src/main.ts:107-204`

**Interfaces:**
- Produces `BoardMechanic`, `normalizeBoardMechanic(saved)`, and `getBoardMechanicBehavior(mechanic)`.
- Consumes legacy `isFallingMode` and `boardAdvanceMode` only during load normalization.

- [x] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import { normalizeBoardMechanic, getBoardMechanicBehavior } from '../src/boardMechanics.ts';

assert.equal(normalizeBoardMechanic({ boardMechanic: 'scroll' }), 'scroll');
assert.equal(normalizeBoardMechanic({ isFallingMode: true }), 'falling');
assert.equal(normalizeBoardMechanic({ boardAdvanceMode: 'rising' }), 'rising');
assert.equal(normalizeBoardMechanic({}), 'scroll');
assert.deepEqual(getBoardMechanicBehavior('falling'), { refill: 'top', movement: 'gravity', failsAtTop: false });
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types tests/boardMechanics.test.ts`

Expected: failure because `src/boardMechanics.ts` does not exist.

- [x] **Step 3: Implement the minimal mechanism module**

```ts
export type BoardMechanic = 'fixed' | 'rising' | 'scroll' | 'falling';

export function normalizeBoardMechanic(saved: Record<string, unknown>): BoardMechanic {
  if (saved.boardMechanic === 'fixed' || saved.boardMechanic === 'rising' || saved.boardMechanic === 'scroll' || saved.boardMechanic === 'falling') return saved.boardMechanic;
  if (saved.isFallingMode === true) return 'falling';
  if (saved.boardAdvanceMode === 'fixed' || saved.boardAdvanceMode === 'rising' || saved.boardAdvanceMode === 'scroll') return saved.boardAdvanceMode;
  return 'scroll';
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types tests/boardMechanics.test.ts`

Expected: exit code 0.

### Task 2: Wire the editor controls to the normalized model

**Files:**
- Modify: `index.html:405-415`
- Modify: `src/main.ts:420-550, 32180-32740`
- Modify: `src/style.css` only if the new scroll button needs existing menu layout styling.

**Interfaces:**
- Consumes `BoardMechanic` from Task 1.
- Produces `getActiveBoardMechanic()` and `setBoardMechanic(mechanic)` as the only editor mutators.

- [x] **Step 1: Write the failing test**

```ts
assert.equal(normalizeBoardMechanic({}), 'scroll');
assert.equal(normalizeBoardMechanic({ boardMechanic: 'fixed' }), 'fixed');
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types tests/boardMechanics.test.ts`

Expected: the default assertion fails until Task 1 defaults to `scroll`.

- [x] **Step 3: Implement the controls**

```ts
function setBoardMechanic(mechanic: BoardMechanic) {
  boardMechanic = mechanic;
  isFallingMode = mechanic === 'falling';
  boardAdvanceMode = mechanic === 'falling' ? 'fixed' : mechanic;
  localStorage.setItem('boardMechanic', mechanic);
  syncModeButtonsUI();
}
```

Add a fourth wide `匀速滚动` control under `牌面机制`, make it active by default, and remove all direct mechanic resets from `普通玩法` and colour-rule handlers.

- [x] **Step 4: Run focused test and build**

Run: `node --experimental-strip-types tests/boardMechanics.test.ts; npm.cmd run build`

Expected: both commands exit 0.

### Task 3: Make exported playable state preserve the selected mechanic

**Files:**
- Modify: `src/main.ts:119-282`

**Interfaces:**
- Consumes `normalizeBoardMechanic`.
- Exports `gameRule` and `boardMechanic` at the top level and under `modes`.
- Reads the explicit values before legacy compatibility fields.

- [x] **Step 1: Extend the failing test**

```ts
assert.equal(normalizeBoardMechanic({ boardMechanic: 'falling', isFallingMode: false }), 'falling');
assert.equal(normalizeBoardMechanic({ boardMechanic: 'scroll', boardAdvanceMode: 'fixed' }), 'scroll');
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types tests/boardMechanics.test.ts`

Expected: failure until explicit board mechanism takes precedence.

- [x] **Step 3: Implement export/load consistency**

Remove the playable-only `isFallingMode = false` overwrite. During load, normalize once, derive legacy fields from that result, and initialize the correct starting camera: top for fixed/rising/scroll, bottom for falling.

- [x] **Step 4: Run test and build**

Run: `node --experimental-strip-types tests/boardMechanics.test.ts; npm.cmd run build`

Expected: both commands exit 0.

### Task 4: Separate all four runtime behaviours and verify generated playable

**Files:**
- Modify: `src/main.ts:7937-8075, 15018-15265, 20780-21065, 23152-24085, 24694-25420, 31150-31240`

**Interfaces:**
- Consumes `getActiveBoardMechanic()`.
- Fixed: no refill, victory when empty.
- Rising: discrete post-move rise with bottom replenishment; cap chained rise at 3 rows.
- Scroll: start after tutorial, move at `PARAMS.scrollSpeed`, replenish bottom rows, fail at top.
- Falling: top refill and gravity only; never call game-over due to top contact.

- [x] **Step 1: Add a failing source-level regression assertion for behavior mapping**

```ts
assert.deepEqual(getBoardMechanicBehavior('fixed'), { refill: 'none', movement: 'none', failsAtTop: false });
assert.deepEqual(getBoardMechanicBehavior('rising'), { refill: 'bottom', movement: 'discrete', failsAtTop: true });
assert.deepEqual(getBoardMechanicBehavior('scroll'), { refill: 'bottom', movement: 'continuous', failsAtTop: true });
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types tests/boardMechanics.test.ts`

Expected: failure until the complete behavior mapping exists.

- [x] **Step 3: Implement runtime guards**

Use the behavior mapping at the existing refill, rising, and game-over call sites. In particular, do not execute `maybeRefillFallingTopArea` outside `falling`, and do not run the ticker top-contact failure check for `falling` or `fixed`.

- [ ] **Step 4: Complete the four-mechanic manual preview matrix**

Run: `node --experimental-strip-types tests/boardMechanics.test.ts; npm.cmd run build`

Manual matrix: generate one playable per mechanic, confirm header state in exported `initialState`; fixed does not add blocks, rising advances after a move, scroll begins continuous upward movement after tutorial, falling keeps spawning under gravity without top-failure.

Expected: commands exit 0 and all four observed mechanics match their definitions.

## Self-Review

- Explicitly covers default scrolling, top/bottom refill source, movement timing, and failure condition for each of the four mechanics.
- Keeps game rules independent from mechanics.
- Includes backwards compatibility for old playable data.
- No task requires a git commit because this workspace is not a git repository.
