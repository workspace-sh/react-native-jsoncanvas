import type {CanvasNodeMenuItem} from './types';

/**
 * A menu's items in Material 3 Expressive's groups: the actions in the order
 * given, then the destructive ones in a group of their own, as Material
 * separates an action that removes something. No empty groups.
 */
export function menuGroups(items: CanvasNodeMenuItem[]): CanvasNodeMenuItem[][] {
  const plain = items.filter(item => !item.destructive);
  const destructive = items.filter(item => item.destructive);
  return [plain, destructive].filter(group => group.length > 0);
}
