// A card's long-press menu, as Workspace offers it: copy, share, open. On
// Android it's the library's CanvasNodeMenu (Material's dropdown, anchored
// to the card); elsewhere the playground keeps the canvas's own long-press,
// which reveals an image's name.
import {useCallback, useState, type ReactElement} from 'react';
import {Linking, Platform, Share} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {AndroidHaptics, performAndroidHapticsAsync} from 'expo-haptics';
import {resolveFileUri, type CanvasNode, type NodeLongPress} from '@workspace.sh/react-native-jsoncanvas';
import {CanvasNodeMenu, type CanvasNodeMenuItem} from '@workspace.sh/react-native-jsoncanvas/menu';

interface Action {
  item: CanvasNodeMenuItem;
  run: () => void;
}

const ICONS = {
  copy: require('@expo/material-symbols/content_copy.xml'),
  share: require('@expo/material-symbols/share.xml'),
  open: require('@expo/material-symbols/open_in_browser.xml'),
  link: require('@expo/material-symbols/link.xml'),
};

/** The menu's title: what the card is, where the card doesn't say it in a line. */
function titleOf(node: CanvasNode): string | undefined {
  switch (node.type) {
    case 'file':
      return node.file.split('/').pop() ?? node.file;
    case 'link':
      try {
        return new URL(node.url).host;
      } catch {
        return node.url;
      }
    default:
      return undefined;
  }
}

function actionsOf(node: CanvasNode, basePath: string | undefined): Action[] {
  const share = (content: {url: string} | {message: string}): Action => ({
    item: {key: 'share', title: 'Share…', icon: ICONS.share},
    // Android's share sheet takes text, so a link goes as its message.
    run: () => void Share.share('url' in content ? {message: content.url} : content),
  });
  switch (node.type) {
    case 'text':
      return [
        {item: {key: 'copy', title: 'Copy text', icon: ICONS.copy}, run: () => void Clipboard.setStringAsync(node.text)},
        share({message: node.text}),
      ];
    case 'link':
      return [
        {item: {key: 'open', title: 'Open link', icon: ICONS.open}, run: () => void Linking.openURL(node.url)},
        {item: {key: 'copy', title: 'Copy link', icon: ICONS.link}, run: () => void Clipboard.setStringAsync(node.url)},
        share({url: node.url}),
      ];
    case 'file': {
      const uri = resolveFileUri(node.file, basePath);
      return uri ? [share({url: uri})] : [];
    }
    default:
      return [];
  }
}

export function useNodeMenu(basePath: string | undefined): {
  onNodeLongPress: ((node: CanvasNode, press: NodeLongPress) => void) | undefined;
  menu: ReactElement | null;
} {
  const [pressed, setPressed] = useState<{node: CanvasNode; press: NodeLongPress} | null>(null);
  const onNodeLongPress = useCallback(
    (node: CanvasNode, press: NodeLongPress) => {
      // Nothing to offer (a group), no menu.
      if (actionsOf(node, basePath).length === 0) return;
      void performAndroidHapticsAsync(AndroidHaptics.Long_Press).catch(() => {});
      setPressed({node, press});
    },
    [basePath],
  );
  if (Platform.OS !== 'android') return {onNodeLongPress: undefined, menu: null};
  if (!pressed) return {onNodeLongPress, menu: null};
  const actions = actionsOf(pressed.node, basePath);
  const menu = (
    <CanvasNodeMenu
      key={`${pressed.node.id}:${pressed.press.at.x}:${pressed.press.at.y}`}
      node={pressed.node}
      press={pressed.press}
      title={titleOf(pressed.node)}
      items={actions.map(a => a.item)}
      onSelect={key => actions.find(a => a.item.key === key)?.run()}
      onDismiss={() => setPressed(null)}
    />
  );
  return {onNodeLongPress, menu};
}
