/**
 * The editor allows obstacle blocks to span more than four grid cells.
 * Keep those authored lengths when a playable reloads its initial state,
 * while normal blocks retain the editor's 1-4 cell rule.
 */
export function getPlayableBlockLength(
  length: unknown,
  isProp: boolean,
  gridCols: number,
): number {
  const parsedLength = Number(length);
  const fallbackLength = Number.isFinite(parsedLength) ? parsedLength : 1;
  const maxLength = isProp ? Math.max(1, Math.floor(gridCols)) : 4;
  return Math.max(1, Math.min(maxLength, Math.floor(fallbackLength)));
}

export function getPlayableBlockLoadError(expectedCount: number, actualCount: number): string | null {
  if (expectedCount === actualCount) return null;
  return `试玩方块加载不完整：导出 ${expectedCount} 个，实际加载 ${actualCount} 个。`;
}
