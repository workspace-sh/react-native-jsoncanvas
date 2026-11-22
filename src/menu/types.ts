import type {ImageSourcePropType} from 'react-native';
import type {CanvasNode} from '../core';
import type {NodeLongPress} from '../renderer/CanvasView';

/** One action in a card's menu. */
export interface CanvasNodeMenuItem {
  /** What `onSelect` is told when the action is chosen. */
  key: string;
  /** The action's name, as the menu shows it ("Copy Text"). */
  title: string;
  /**
   * Its leading icon: a Material Symbol's vector drawable, e.g.
   * `require('@expo/material-symbols/content_copy.xml')`.
   */
  icon?: ImageSourcePropType;
  /** An action that removes something: drawn in the theme's error colour. */
  destructive?: boolean;
}

export interface CanvasNodeMenuProps {
  /** The long-pressed node, as `CanvasView`'s `onNodeLongPress` gave it. */
  node: CanvasNode;
  /** Where it was pressed, from the same call: the menu is anchored to `press.frame`. */
  press: NodeLongPress;
  /** What the card offers, in order. */
  items: CanvasNodeMenuItem[];
  /** A label above the actions, where the card doesn't say what it is in a line (a file's name, a link's host). */
  title?: string;
  /** An action was chosen. The menu has closed (`onDismiss` was called first). */
  onSelect: (key: string) => void;
  /** The menu closed: an action was chosen, or the reader tapped outside it or pressed Back. */
  onDismiss: () => void;
}
