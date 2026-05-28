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
//   - The sidebar is resizable via a drag handle on its right edge, and
//     opens / closes with an animated width tween (`visibleSV` 0..1
//     multiplied by `widthSV`). Workspace gets this for free via
//     NSSplitView; pure-RN hosts roll their own — this is that.
//
// Layout / colour decisions match Workspace's so the two shells feel like
// the same family of app. System-blue (`#0a84ff`) "Open File" button,
// uppercase "FILES" header, hairline-bordered separator. macOS-system
// palette throughout.
//
// `widthSV` + `visibleSV` are Reanimated SharedValues so they update
// without JS re-renders — drag-handler writes happen UI-thread-side,
// open/close uses `withTiming`. The same pattern is what Workspace's
// `apps/desktop` passes to the library as `leftOverlayWidth`; if Workspace
// adopts this harness's resize affordance someday, the SV they already
// have feeds straight in.
import React, {useMemo} from 'react';
import {FlatList, Pressable, StyleSheet, Text, View, useColorScheme} from 'react-native';
import Animated, {useAnimatedStyle, type SharedValue} from 'react-native-reanimated';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';

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
  /** Sidebar width in points. Drag-handle pan writes to it on the UI
   *  thread; open/close animation reads from it. SharedValue rather
   *  than React state so per-frame width changes during drag don't
   *  trigger React reconciliation. */
  widthSV: SharedValue<number>;
  /** Effective visibility, 0..1. Animated by App.tsx via `withTiming` on
   *  toggle. Multiplied with `widthSV` for the rendered width so the
   *  collapse animation runs through this single shared value rather
   *  than mutating `widthSV` itself (which we want to preserve as the
   *  user's resized width). */
  visibleSV: SharedValue<number>;
}

// Clamp range for drag-resize. Below 180 the file rows truncate too
// aggressively; above 400 it eats the canvas pane. Workspace's NSSplitView
// uses similar floors for the same reason.
const MIN_WIDTH = 180;
const MAX_WIDTH = 400;
// Width of the invisible-but-interactive drag column at the sidebar's
// right edge. 6pt is wide enough to hit reliably without making the
// sidebar's right border feel "chunky".
const RESIZE_HANDLE_WIDTH = 6;

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
  widthSV,
  visibleSV,
}: Props) {
  const isDark = useColorScheme() === 'dark';

  // Effective width = current resized width × visibility (0..1). When fully
  // hidden we still mount the View (width: 0, overflow hidden) so the
  // open animation doesn't have to remount the FlatList.
  const animatedStyle = useAnimatedStyle(() => ({
    width: widthSV.value * visibleSV.value,
  }));

  // Drag gesture — Pan on the right-edge handle. UI-thread writes to
  // `widthSV` so the sidebar tracks the cursor at native frame rate.
  // Min/max clamp inline rather than via reactions so the gesture itself
  // never "fights" itself against a clamp event.
  const dragGesture = useMemo(
    () =>
      Gesture.Pan()
        .onChange(event => {
          'worklet';
          const next = widthSV.value + event.changeX;
          widthSV.value = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, next));
        }),
    [widthSV],
  );

  return (
    <Animated.View
      style={[
        styles.container,
        isDark ? styles.containerDark : styles.containerLight,
        animatedStyle,
      ]}>
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
      {/* Right-edge drag handle. Sits on top of the sidebar's right
          border via absolute positioning so it's hit-target-only — no
          visual change. Z-order doesn't matter because the GestureDetector
          intercepts before content underneath. */}
      <GestureDetector gesture={dragGesture}>
        <View style={styles.resizeHandle} />
      </GestureDetector>
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
  resizeHandle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    // Straddle the sidebar's right border by half the handle width so the
    // hit region extends a few px into the canvas pane — easier to grab.
    right: -RESIZE_HANDLE_WIDTH / 2,
    width: RESIZE_HANDLE_WIDTH,
  },
});
