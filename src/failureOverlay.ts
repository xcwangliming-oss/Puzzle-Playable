export function getFailureOverlayMotion() {
  return {
    overlayOpacity: 0.4,
    initialScale: 2.4,
    finalScale: 1,
    initialAlpha: 0,
    finalAlpha: 1,
    duration: 0.58,
    ease: 'power3.in',
  } as const;
}
