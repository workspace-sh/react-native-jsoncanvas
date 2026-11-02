import {fitCamera} from '../fitCamera';

const limits = {min: 0.1, max: 6};

describe('fitCamera', () => {
  it('centres the content in the view at the scale that shows all of it', () => {
    const cam = fitCamera({width: 1000, height: 500}, {x: 0, y: 0, width: 200, height: 100}, limits);
    expect(cam.s).toBe(5);
    expect(cam.tx).toBe(0);
    expect(cam.ty).toBe(0);
  });

  it('centres across what the left strip leaves', () => {
    const cam = fitCamera({width: 1300, height: 500, left: 300}, {x: 0, y: 0, width: 1000, height: 100}, limits);
    expect(cam.s).toBe(1);
    // The content's centre (500) lands at the visible area's centre (300 + 500).
    expect(cam.tx + 500 * cam.s).toBe(800);
  });

  it('keeps the margin clear above and below, still centred down the whole view', () => {
    const cam = fitCamera({width: 2000, height: 600, margin: 50}, {x: 0, y: 0, width: 100, height: 100}, limits);
    expect(cam.s).toBe(5);
    const top = cam.ty;
    const bottom = cam.ty + 100 * cam.s;
    expect(top).toBe(50);
    expect(bottom).toBe(550);
  });

  it('puts the origin at the centre when there is nothing to fit', () => {
    expect(fitCamera({width: 800, height: 600, left: 200}, {x: 0, y: 0, width: 0, height: 0}, limits)).toEqual({tx: 500, ty: 300, s: 1});
  });

  it('keeps to the scale limits', () => {
    expect(fitCamera({width: 1000, height: 1000}, {x: 0, y: 0, width: 1, height: 1}, limits).s).toBe(6);
    expect(fitCamera({width: 100, height: 100}, {x: 0, y: 0, width: 100000, height: 100000}, limits).s).toBe(0.1);
  });
});
