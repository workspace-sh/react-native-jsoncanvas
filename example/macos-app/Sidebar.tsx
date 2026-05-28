// Left-side file list, styled after Workspace's apps/desktop/src/components/Sidebar.tsx
// (read-only reference at /Users/leslieoa/Code/Projects/workspace/workspace/...).
//
// Differences from Workspace's version:
//
//   - State is *passed as props* rather than read from Zustand. The harness
//     keeps everything in App.tsx's useState / shared values — no global
//     store, no dependency on `zustand`, no `setActiveFile` action plumbing.
//   - First entry is a non-closable "sample" pinned at the top so the
//     harness has something to render on first launch.
//   - The sidebar opens / closes with an animated width tween, driven by
//     `visibleSV` (0..1) multiplied by a fixed width.
//
// DRAG-RESIZE WAS REMOVED. An earlier revision added a Pan-gesture drag
// handle on the right edge to make the sidebar resizable. On RNGH-macos a
// second `GestureDetector` (sibling to the canvas's own pan/pinch/tap
// detector) corrupts gesture arbitration for *both* — canvas pinch/pan
// stopped working. This is the same class of RNGH-macos fragility that
// forced the native-smartMagnify bridge (RNGH-macos can't reliably
// hit-test trackpad gestures). Resizable sidebar isn't worth destabilising
// the canvas in a smoke harness; if we ever need it, the path is a native
// NSSplitView (what Workspace actually uses) rather than a JS gesture.
//
// Layout / colour decisions match Workspace's so the two shells feel like
// the same family of app. System-blue (`#0a84ff`) "Open File" button,
// uppercase "FILES" header, hairline-bordered separator. macOS-system
// palette throughout.
import React from 'react';
import {FlatList, Pressable, StyleSheet, Text, View, useColorScheme} from 'react-native';
import Animated, {useAnimatedStyle, type SharedValue} from 'react-native-reanimated';

export interface OpenedFile {
  id: string;
  name: string;
  content: string;
  /** Absolute path to the file's directory — used as `basePath` for
   *  resolving relative image references inside the canvas. Absent for
   *  the bundled sample. */
  basePath?: string;
}

interface Props {
  files: OpenedFile[];
  activeId: string;
  /** ID of the always-present sample tab — never gets a × close button. */
  pinnedId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onOpen: () => void;
  /** Whether the native FilePicker module is available. Hides the Open
   *  button when running in an environment without it (web, sim without
   *  the module linked, etc.). */
  canOpen: boolean;
  /** Effective visibility, 0..1. Animated by App.tsx via `withTiming` on
   *  toggle. Multiplied with the fixed `SIDEBAR_WIDTH` for the rendered
   *  width so the collapse animation runs through this single shared
   *  value. */
  visibleSV: SharedValue<number>;
  /** Whether the sidebar should accept pointer events. Decoupled from
   *  the animated visibility because the React tree stays mounted at
   *  full width-as-prop even while the *rendered* width is 0 — without
   *  this gate, off-screen rows would still claim taps meant for the
   *  canvas. App flips it `false` the instant a close is initiated and
   *  `true` the instant a re-open is initiated. */
  interactable: boolean;
}

// Fixed sidebar width. Matches Workspace's NSSplitView default so the two
// apps feel like the same family at first launch.
const SIDEBAR_WIDTH = 220;

function FileItem({
  file,
  isActive,
  isPinned,
  onActivate,
  onClose,
  isDark,
}: {
  file: OpenedFile;
  isActive: boolean;
  isPinned: boolean;
  onActivate: () => void;
  onClose: () => void;
  isDark: boolean;
}) {
  return (
    <Pressable
      style={[
        styles.fileItem,
        isActive && (isDark ? styles.fileItemActiveDark : styles.fileItemActiveLight),
      ]}
      onPress={onActivate}>
      <Text
        style={[styles.fileName, !isDark && styles.fileNameLight]}
        numberOfLines={1}>
        {file.name}
      </Text>
      {!isPinned && (
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={styles.closeButton}>×</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

export function Sidebar({
  files,
  activeId,
  pinnedId,
  onActivate,
  onClose,
  onOpen,
  canOpen,
  visibleSV,
  interactable,
}: Props) {
  const isDark = useColorScheme() === 'dark';

  // Rendered width = fixed width × visibility (0..1). The View stays
  // mounted at width 0 when fully hidden (overflow clipped) so the open
  // animation doesn't have to remount the FlatList.
  const animatedStyle = useAnimatedStyle(() => ({
    width: SIDEBAR_WIDTH * visibleSV.value,
  }));

  return (
    <Animated.View
      pointerEvents={interactable ? 'auto' : 'none'}
      style={[
        styles.container,
        isDark ? styles.containerDark : styles.containerLight,
        animatedStyle,
      ]}>
      {/* Inner pane is pinned to the fixed width so its content doesn't
          reflow as the outer width animates 0..220 — only the clip
          window changes, the layout inside stays put. */}
      <View style={styles.inner}>
        <Text style={[styles.header, !isDark && styles.headerLight]}>Files</Text>
        {canOpen && (
          <Pressable style={styles.openButton} onPress={onOpen}>
            <Text style={styles.openButtonText}>Open File</Text>
          </Pressable>
        )}
        <FlatList
          data={files}
          keyExtractor={f => f.id}
          renderItem={({item}) => (
            <FileItem
              file={item}
              isActive={item.id === activeId}
              isPinned={item.id === pinnedId}
              onActivate={() => onActivate(item.id)}
              onClose={() => onClose(item.id)}
              isDark={isDark}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    // Width is animated via `useAnimatedStyle` above; no static value here.
    borderRightWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  inner: {
    // Pinned width so content doesn't reflow during the collapse animation.
    width: SIDEBAR_WIDTH,
    flex: 1,
    padding: 12,
  },
  containerDark: {
    backgroundColor: '#1c1c1e',
    borderRightColor: '#3a3a3c',
  },
  containerLight: {
    backgroundColor: '#f2f2f7',
    borderRightColor: '#c6c6c8',
  },
  header: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8e8e93',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  // Workspace uses the same #8e8e93 in both modes; we follow.
  headerLight: {},
  openButton: {
    backgroundColor: '#0a84ff',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  openButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  fileItemActiveDark: {
    backgroundColor: '#2c2c2e',
  },
  fileItemActiveLight: {
    backgroundColor: '#d1d1d6',
  },
  fileName: {
    flex: 1,
    color: '#fff',
    fontSize: 13,
  },
  fileNameLight: {
    color: '#1c1c1e',
  },
  closeButton: {
    color: '#8e8e93',
    fontSize: 16,
    marginLeft: 4,
  },
  separator: {
    height: 2,
  },
});
