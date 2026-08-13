export function shouldPlayCompactDefaultShatter({
  isStandalone,
  hideShatter,
  availableTextureCount,
  selectedEffectType,
  hasCompactDefaultFrames,
}: {
  isStandalone: boolean;
  hideShatter: boolean;
  availableTextureCount: number;
  selectedEffectType: string;
  hasCompactDefaultFrames: boolean;
}): boolean {
  return isStandalone
    && !hideShatter
    && availableTextureCount === 0
    && selectedEffectType === 'default'
    && hasCompactDefaultFrames;
}
