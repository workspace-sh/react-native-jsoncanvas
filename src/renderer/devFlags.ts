/**
 * Runtime-mutable flags for A/B performance experiments.
 * Flip at runtime via debugger or dev menu — no persistence needed.
 */
export const devFlags = {
  skipImageGroupClip: false,
  memoizeEdgeGeometry: false,
  skipDashPathEffect: false,
  enablePictureRecording: true,
};
