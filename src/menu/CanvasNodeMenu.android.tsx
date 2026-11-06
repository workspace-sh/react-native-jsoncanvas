import {useCallback, useRef, type ReactElement} from 'react';
import {StyleSheet, View} from 'react-native';
import {
  Box,
  DropdownMenu,
  DropdownMenuItem,
  Host,
  HorizontalDivider,
  Icon,
  Text,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import {fillMaxSize} from '@expo/ui/jetpack-compose/modifiers';
import {menuAnchor} from './menuAnchor';
import type {CanvasNodeMenuProps} from './types';

/** A card's corners on the canvas, in its own points (SkiaCardRenderer's). */
const CARD_RADIUS = 8;
const GROUP_RADIUS = 12;
const ICON_SIZE = 24;

/**
 * A card's menu on Android: Material 3's dropdown menu (Compose's, through
 * Expo UI) anchored to the long-pressed card, opening below it, or above
 * with no room below, and lined up with its leading edge. The card is
 * outlined in the theme's primary colour while its menu is open, so it's
 * clear which card the menu is for (Android has no lifted preview, as iOS's
 * context menu has). A tap outside the menu, or Back, closes it.
 *
 * Render it beside the `CanvasView`, over the canvas and in the same
 * coordinates, while a long-press is being answered.
 */
export function CanvasNodeMenu({node, press, items, title, onSelect, onDismiss}: CanvasNodeMenuProps): ReactElement | null {
  const colors = useMaterialColors();
  // Choosing an action closes the menu too: dismiss once, whichever came first.
  const closed = useRef(false);
  const dismiss = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    onDismiss();
  }, [onDismiss]);
  if (items.length === 0) return null;

  const anchor = menuAnchor(press);
  const {frame} = press;
  const zoom = node.width > 0 ? frame.width / node.width : 1;
  const radius = (node.type === 'group' ? GROUP_RADIUS : CARD_RADIUS) * zoom;

  return (
    <>
      <View
        pointerEvents="none"
        style={[
          styles.outline,
          {left: frame.x - 2, top: frame.y - 2, width: frame.width + 4, height: frame.height + 4, borderRadius: radius + 2, borderColor: colors.primary},
        ]}
      />
      <Host style={{position: 'absolute', left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height}}>
        <DropdownMenu expanded onDismissRequest={dismiss}>
          <DropdownMenu.Trigger>
            <Box modifiers={[fillMaxSize()]} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Items>
            {title ? (
              <DropdownMenuItem enabled={false} elementColors={{disabledTextColor: colors.onSurfaceVariant}}>
                <DropdownMenuItem.Text>
                  <Text style={{typography: 'labelLarge'}} maxLines={1} overflow="ellipsis">
                    {title}
                  </Text>
                </DropdownMenuItem.Text>
              </DropdownMenuItem>
            ) : null}
            {title ? <HorizontalDivider /> : null}
            {items.map(item => (
              <DropdownMenuItem
                key={item.key}
                elementColors={item.destructive ? {textColor: colors.error, leadingIconColor: colors.error} : undefined}
                onClick={() => {
                  dismiss();
                  onSelect(item.key);
                }}
              >
                {item.icon ? (
                  <DropdownMenuItem.LeadingIcon>
                    <Icon source={item.icon} size={ICON_SIZE} />
                  </DropdownMenuItem.LeadingIcon>
                ) : null}
                <DropdownMenuItem.Text>
                  <Text>{item.title}</Text>
                </DropdownMenuItem.Text>
              </DropdownMenuItem>
            ))}
          </DropdownMenu.Items>
        </DropdownMenu>
      </Host>
    </>
  );
}

const styles = StyleSheet.create({
  outline: {position: 'absolute', borderWidth: 2},
});
