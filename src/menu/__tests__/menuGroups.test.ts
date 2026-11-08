import {menuGroups} from '../menuGroups';

const item = (key: string, destructive?: boolean) => ({key, title: key, destructive});

describe('menuGroups', () => {
  it('keeps actions in one group, in order', () => {
    expect(menuGroups([item('open'), item('copy'), item('share')])).toEqual([[item('open'), item('copy'), item('share')]]);
  });

  it('puts destructive actions in a group of their own, after the rest', () => {
    expect(menuGroups([item('delete', true), item('copy'), item('share')])).toEqual([[item('copy'), item('share')], [item('delete', true)]]);
  });

  it('makes no empty group', () => {
    expect(menuGroups([item('delete', true)])).toEqual([[item('delete', true)]]);
    expect(menuGroups([])).toEqual([]);
  });
});
