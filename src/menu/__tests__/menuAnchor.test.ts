import {menuAnchor} from '../menuAnchor';

const viewport = {width: 400, height: 800};

describe('menuAnchor', () => {
  it('hangs the menu from a card that is wholly on screen', () => {
    const frame = {x: 40, y: 100, width: 200, height: 120};
    expect(menuAnchor({frame, at: {x: 50, y: 150}, viewport})).toEqual(frame);
  });

  it('keeps to the part of a card that is on screen', () => {
    const frame = {x: -100, y: 700, width: 300, height: 300};
    expect(menuAnchor({frame, at: {x: 50, y: 750}, viewport})).toEqual({x: 0, y: 700, width: 200, height: 100});
  });

  it('opens at the finger when the card fills most of the view', () => {
    const frame = {x: 20, y: -200, width: 360, height: 1400};
    expect(menuAnchor({frame, at: {x: 100, y: 420}, viewport})).toEqual({x: 20, y: 420, width: 360, height: 1});
  });
});
