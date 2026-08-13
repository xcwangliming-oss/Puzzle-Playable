export function getPlayableBlockLoadError(expectedCount: number, actualCount: number): string | null {
  if (expectedCount === actualCount) return null;
  return `试玩方块加载不完整：导出 ${expectedCount} 个，实际加载 ${actualCount} 个。`;
}
