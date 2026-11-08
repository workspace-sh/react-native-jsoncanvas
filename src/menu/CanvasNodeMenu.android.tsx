import React, {useCallback, useEffect, useRef, type ReactElement} from 'react';
import {StyleSheet, View} from 'react-native';
import {
  Box,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPopup,
  Host,
  Icon,
  Spacer,
  Text,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import {defaultMinSize, fillMaxSize, height, padding} from '@expo/ui/jetpack-compose/modifiers';
import {menuAnchor} from './menuAnchor';
import {menuGroups} from './menuGroups';
import type {CanvasNodeMenuProps} from './types';

/** A card's corners on the canvas, in its own points (SkiaCardRenderer's). */
const CARD_RADIUS = 8;
const GROUP_RADIUS = 12;
const ICON_SIZE = 24;
/** A menu item's least width and a group label's least height, in dp (Material's). */
const LABEL_MIN_WIDTH = 112;
const LABEL_MIN_HEIGHT = 32;

/** Material's gap between a menu's groups, in dp (MenuDefaults.GroupSpacing). */
const GROUP_SPACING = 2;

/**
 * A card's menu on Android: Material 3 Expressive's menu (Compose's
 * DropdownMenuPopup, through Expo UI) anchored to the long-pressed card,
 * opening below it, or above with no room below, and lined up with its
 * leading edge. Its actions are a rounded group, the destructive ones a
 * group of their own after them, each item rounded in its place; the title,
 * when there is one, is the first group's label. The card is
 * outlined in the theme's primary colour while its menu is open, so it's
 * clear which card the menu is for (Android has no lifted preview, as iOS's
 * context menu has). A tap outside the menu, or Back, closes it.
 *
 * Render it beside the `CanvasView`, over the canvas and in the same
 * coordinates, while a long-press is being answered.
 */
export function CanvasNodeMenu({node, press, items, title, onSelect, onDismiss}: CanvasNodeMenuProps): ReactElement | null {
  const colors = useMaterialColors();
  // Choosing an action closes the menu too: dismiss once, whichever came
  // first, once for each press (a host may keep one instance mounted).
  const closed = useRef(false);
  useEffect(() => {
    closed.current = false;
  }, [press]);
  const dismiss = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    onDismiss();
  }, [onDismiss]);
  if (items.length === 0) return null;

  const groups = menuGroups(items);
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
        <Box modifiers={[fillMaxSize()]}>
          <DropdownMenuPopup expanded onDismissRequest={dismiss}>
            {groups.map((group, g) => (
              <React.Fragment key={g}>
                {g > 0 ? <Spacer modifiers={[height(GROUP_SPACING)]} /> : null}
                <DropdownMenuGroup shapes={{index: g, count: groups.length}}>
                  {g === 0 && title ? (
                    // Material's group label (MenuDefaults.DropdownMenuGroupLabel): labelLarge, 12dp in.
                    <Text
                      style={{typography: 'labelLarge'}}
                      color={colors.onSurfaceVariant}
                      maxLines={1}
                      overflow="ellipsis"
                      modifiers={[defaultMinSize({minWidth: LABEL_MIN_WIDTH, minHeight: LABEL_MIN_HEIGHT}), padding(12, 10, 12, 6)]}
                    >
                      {title}
                    </Text>
                  ) : null}
                  {group.map((item, i) => (
                    <DropdownMenuItem
                      key={item.key}
                      shape={{index: i, count: group.length}}
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
                </DropdownMenuGroup>
              </React.Fragment>
            ))}
          </DropdownMenuPopup>
        </Box>
      </Host>
    </>
  );
}

const styles = StyleSheet.create({
  outline: {position: 'absolute', borderWidth: 2},
});
