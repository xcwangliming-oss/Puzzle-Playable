export type PropDirection = 'left' | 'right';

export interface PropGeometry {
  col: number;
  length: number;
  propDir?: PropDirection;
}

export interface PropState extends PropGeometry {
  row: number;
}

export interface PropDamageResult {
  triggered: boolean;
  col: number;
  length: number;
  destroyed: boolean;
}

export function isValidPropLength(length: number): boolean {
  return length > 1;
}

export function getPropOccupiedColumns(prop: PropGeometry): number[] {
  if (!isValidPropLength(prop.length)) return [];

  const columns: number[] = [];
  const direction = prop.propDir || 'left';
  const firstCandyColumn = direction === 'left' ? prop.col : prop.col + 1;
  const candyCount = prop.length - 1;

  for (let offset = 0; offset < candyCount; offset++) {
    columns.push(firstCandyColumn + offset);
  }

  return columns;
}

export function damagePropForClearedRows(
  prop: PropState,
  clearedRows: number[],
): PropDamageResult {
  const triggered = clearedRows.some(row => Math.abs(row - prop.row) <= 1);
  if (!triggered || !isValidPropLength(prop.length)) {
    return {
      triggered: false,
      col: prop.col,
      length: prop.length,
      destroyed: !isValidPropLength(prop.length),
    };
  }

  const direction = prop.propDir || 'left';
  const col = direction === 'left' ? prop.col + 1 : prop.col;
  const shortenedLength = prop.length - 1;
  const destroyed = !isValidPropLength(shortenedLength);

  return {
    triggered: true,
    col,
    length: destroyed ? 0 : shortenedLength,
    destroyed,
  };
}
