import {cameraActionForResize} from '../keepCameraOnResize';

const small = {width: 800, height: 600};
const large = {width: 1600, height: 1000};

describe('cameraActionForResize', () => {
  it('keeps a fit through a resize', () => {
    expect(cameraActionForResize(small, large, 'fit')).toBe('fit');
    expect(cameraActionForResize(large, small, 'fit')).toBe('fit');
  });

  it('keeps a recentre through a resize', () => {
    expect(cameraActionForResize(small, large, 'recenter')).toBe('recenter');
  });

  it('leaves a camera the reader moved themselves alone', () => {
    // Pan, pinch, scroll-wheel and double-tap all leave 'manual' behind.
    expect(cameraActionForResize(small, large, 'manual')).toBeNull();
  });

  it('does nothing when the size has not changed', () => {
    expect(cameraActionForResize(small, {...small}, 'fit')).toBeNull();
  });

  it('does nothing on the first measurement', () => {
    // The initial view state owns the first layout; a fresh canvas has not
    // been resized.
    expect(cameraActionForResize(null, small, 'fit')).toBeNull();
  });

  it('ignores a viewport with no area', () => {
    expect(cameraActionForResize(small, {width: 0, height: 600}, 'fit')).toBeNull();
  });
});
