export type BoardMechanic = 'fixed' | 'rising' | 'scroll' | 'falling';

export type BoardMechanicBehavior = {
  refill: 'none' | 'bottom' | 'top';
  movement: 'none' | 'discrete' | 'continuous' | 'gravity';
  failsAtTop: boolean;
};

export type PlayableBlockSeed = {
  id?: number;
  col: number;
  row: number;
  length: number;
  color: string;
  [key: string]: unknown;
};

export type InitialPlayableBoardOptions = {
  blocks: PlayableBlockSeed[];
  mechanic: BoardMechanic;
  cols: number;
  rows: number;
  holeMask?: boolean[][];
  colors?: string[];
  random?: () => number;
};

export type TutorialEliminationMove = {
  blockId: number;
  fromCol: number;
  toCol: number;
  row: number;
  totalCleared: number;
  firstWaveRows: number[];
};

const BOARD_MECHANIC_BEHAVIORS: Record<BoardMechanic, BoardMechanicBehavior> = {
  fixed: { refill: 'none', movement: 'none', failsAtTop: false },
  rising: { refill: 'bottom', movement: 'discrete', failsAtTop: true },
  scroll: { refill: 'bottom', movement: 'continuous', failsAtTop: true },
  falling: { refill: 'top', movement: 'gravity', failsAtTop: false },
};

export function isBoardMechanic(value: unknown): value is BoardMechanic {
  return value === 'fixed' || value === 'rising' || value === 'scroll' || value === 'falling';
}

export function normalizeBoardMechanic(saved: Record<string, unknown>): BoardMechanic {
  if (isBoardMechanic(saved.boardMechanic)) return saved.boardMechanic;
  if (saved.isFallingMode === true) return 'falling';
  if (saved.boardAdvanceMode === 'fixed' || saved.boardAdvanceMode === 'rising' || saved.boardAdvanceMode === 'scroll') {
    return saved.boardAdvanceMode;
  }
  return 'scroll';
}

export function getBoardMechanicBehavior(mechanic: BoardMechanic): BoardMechanicBehavior {
  return BOARD_MECHANIC_BEHAVIORS[mechanic];
}

/** Generated playables always preserve the authored opening layout. */
export function createInitialPlayableBlocks({
  blocks,
}: InitialPlayableBoardOptions): PlayableBlockSeed[] {
  return blocks.map(block => ({ ...block }));
}

/**
 * A rising move always advances once. Each additional combo wave contributes
 * one more rise, with a hard cap so a single move never jumps the board too far.
 */
export function getRisingRowsForCompletedMove(eliminationWaves: number): number {
  return Math.min(3, Math.max(1, Math.floor(eliminationWaves) || 0));
}

export function getRisingSupplyRowPlan(totalRows: number): { spawnRow: number; finalRow: number } {
  const safeTotalRows = Math.max(1, Math.floor(totalRows));
  return {
    spawnRow: safeTotalRows,
    finalRow: safeTotalRows - 1,
  };
}

export function getFallingTopSupplyRows(blankRowsAtTop: number, minVisibleRow: number): number[] {
  const count = Math.min(3, Math.max(0, Math.floor(blankRowsAtTop)));
  const safeMinVisibleRow = Math.floor(minVisibleRow);
  return Array.from({ length: count }, (_, index) => safeMinVisibleRow - count + index);
}

export function hasContinuousScrollTopCollision(
  blocks: Array<Pick<PlayableBlockSeed, 'row'>>,
  cellSize: number,
  scrollOffset: number,
  totalRows: number,
): boolean {
  const safeCellSize = Math.max(1, cellSize);
  const safeTotalRows = Math.max(1, Math.floor(totalRows));
  const safeScrollOffset = Math.max(0, scrollOffset);

  return blocks.some(block => (
    block.row < safeTotalRows
    && block.row * safeCellSize - safeScrollOffset <= 0
  ));
}

export function getTutorialHandPlacement({
  pointerX,
  pointerY,
  width,
  height,
}: {
  pointerX: number;
  pointerY: number;
  width: number;
  height: number;
}): { left: number; top: number } {
  // The visible fingertip is near the upper-left of the hand art, not its center.
  return {
    left: Math.round(pointerX - width * 0.21),
    top: Math.round(pointerY - height * 0.06),
  };
}

export function getTutorialSearchRows(totalRows: number, viewportRows: number): {
  minRow: number;
  maxRow: number;
} {
  const safeTotalRows = Math.max(1, Math.floor(totalRows));
  const safeViewportRows = Math.max(1, Math.floor(viewportRows));

  return {
    minRow: 0,
    maxRow: Math.min(safeTotalRows - 1, safeViewportRows - 1),
  };
}

export function getNextCollectionMissionTarget(currentTarget: number | undefined): number | null {
  if (typeof currentTarget !== 'number' || !Number.isFinite(currentTarget) || currentTarget <= 0) {
    return null;
  }
  return Math.max(0, Math.floor(currentTarget) - 1);
}

export function pickTutorialEliminationMove(
  candidates: TutorialEliminationMove[],
): TutorialEliminationMove | null {
  const clearingMoves = candidates.filter(candidate => candidate.firstWaveRows.length > 0);
  if (clearingMoves.length === 0) return null;

  clearingMoves.sort((a, b) => {
    if (a.firstWaveRows.length !== b.firstWaveRows.length) {
      return b.firstWaveRows.length - a.firstWaveRows.length;
    }
    if (a.totalCleared !== b.totalCleared) return b.totalCleared - a.totalCleared;
    return Math.abs(a.toCol - a.fromCol) - Math.abs(b.toCol - b.fromCol);
  });

  return clearingMoves[0];
}
