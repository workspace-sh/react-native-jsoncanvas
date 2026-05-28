// App.tsx — minimal RN-macOS harness for smoke-testing @workspace.sh/react-native-jsoncanvas.
//
// Layout mirrors Workspace's apps/desktop (read-only reference): sidebar on
// the left listing opened .canvas files, main pane on the right rendering
// the active one via `<CanvasView />`. Fit / Recenter controls overlay the
// canvas at the bottom; a persistent toggle button at the top-left of the
// canvas pane shows / hides the sidebar.
//
// **Sidebar toggle UX** is ported from Workspace's DocumentPane:
// `getLastAction()` (a library-side callback exposed via `onReady`) tells
// us the user's most recent explicit camera intent — fit / recenter /
// manual. After toggling the sidebar, we replay that intent against the
// new canvas pane size so the content stays anchored where the user wanted
// it. 'manual' (pan / pinch / scroll-wheel / double-tap) means leave the
// camera alone — toggle just reveals / hides the sidebar.
//
// We don't need Workspace's debounce-vs-NSSplitView-animation dance: our
// sidebar is a pure-RN flex item, so the layout transition is one-frame.
// We don't need `leftOverlayWidth` either — the canvas pane sits *after* the
// sidebar in the flex row, so CanvasView's `onLayout` captures the
// post-toggle pane size directly and `fitToViewport()` with no inset is
// already correct.
//
// State management stays simple — useState in App, prop-drilled. No
// Zustand. File opening goes through the example-local `FilePicker`
// native module (NSOpenPanel under the hood, multi-select). Library
// surface stays content-string-in; never touches the filesystem.
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {NativeModules, Pressable, StyleSheet, Text, useColorScheme, View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {useSharedValue, withTiming, Easing} from 'react-native-reanimated';
import {CanvasView} from '@workspace.sh/react-native-jsoncanvas';
import {SAMPLE_CANVAS} from './fixtures';
import {Sidebar, type OpenedFile} from './Sidebar';

type Controls = {
  fitToViewport: (leftInset?: number) => void;
  recenter: (leftInset?: number) => void;
  getLastAction: () => 'fit' | 'recenter' | 'manual';
};

interface FilePickerResult {
  path: string;
  name: string;
  content: string;
}

interface FilePickerModule {
  openCanvasFiles(): Promise<FilePickerResult[]>;
}

const FilePicker = NativeModules.FilePicker as FilePickerModule | undefined;

// Built-in sample, pinned as the always-present first sidebar entry so the
// harness has something to render on first launch and the file list is
// never empty.
const SAMPLE_FILE: OpenedFile = {
  id: 'sample',
  name: 'hesprs-demo (sample)',
  content: SAMPLE_CANVAS,
};

// Sidebar open/close animation duration. 250ms matches NSSplitView's
// system-default toggle feel; long enough to read as deliberate, short
// enough to not block subsequent interaction.
const TOGGLE_ANIMATION_MS = 250;
// Padding past the animation duration before we replay the camera intent.
// CanvasView's `onLayout` fires throughout the animation, so we want the
// replay to land after the last layout event. 50ms is enough to clear the
// final commit boundary without feeling delayed.
const TOGGLE_REPLAY_PADDING_MS = 50;
// Initial / reset sidebar width. Matches what Workspace's NSSplitView
// uses as its default sidebar width, so the two apps feel like the same
// family at first launch.
const DEFAULT_SIDEBAR_WIDTH = 220;

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : path;
}

export default function App() {
  const controlsRef = useRef<Controls | null>(null);
  const [lastAction, setLastAction] = useState<string>('—');
  const [files, setFiles] = useState<OpenedFile[]>([SAMPLE_FILE]);
  const [activeId, setActiveId] = useState<string>(SAMPLE_FILE.id);
  // React-side mirror of the visibility state for the toggle button label /
  // accessibility hint. The actual width animation runs through the
  // `visibleSV` SharedValue below — this boolean is just so the JSX
  // knows which chevron / label to render.
  const [sidebarVisible, setSidebarVisible] = useState<boolean>(true);

  // Sidebar width + visibility, as Reanimated SharedValues:
  //
  //   - `widthSV` persists the user's drag-resized width. Survives close
  //     and re-open (we never write 0 here — the close animation goes
  //     through visibleSV instead).
  //   - `visibleSV` is the 0..1 animator. Sidebar's `useAnimatedStyle`
  //     reads `widthSV.value * visibleSV.value` to compute the rendered
  //     width every frame.
  //
  // Same shape Workspace uses for `sidebarWidthSV` (the SV it passes to
  // the library as `leftOverlayWidth`). If Workspace's NSSplitView ever
  // hands its sidebar width to a pure-RN host via this app, the SV they
  // already produce slots straight in.
  const widthSV = useSharedValue(DEFAULT_SIDEBAR_WIDTH);
  const visibleSV = useSharedValue(1);

  // Renderer text/nodes already react to useColorScheme internally; the
  // wrapper has to match so the canvas-empty background doesn't fight the
  // node colours (e.g. dark nodes on a white background in dark mode).
  const isDark = useColorScheme() === 'dark';

  const activeFile = useMemo(
    () => files.find(f => f.id === activeId) ?? files[0],
    [files, activeId],
  );

  const openFiles = useCallback(async () => {
    if (!FilePicker) return;
    try {
      const results = await FilePicker.openCanvasFiles();
      if (results.length === 0) return;
      setFiles(prev => {
        const next = [...prev];
        for (const r of results) {
          // De-dupe by absolute path — re-opening the same file refocuses
          // its existing entry instead of stacking duplicates.
          if (next.find(f => f.id === r.path)) continue;
          next.push({
            id: r.path,
            name: r.name,
            content: r.content,
            basePath: dirname(r.path),
          });
        }
        return next;
      });
      // Activate the first newly-opened file.
      setActiveId(results[0].path);
    } catch (err) {
      console.warn('[App] openCanvasFiles failed:', err);
    }
  }, []);

  const closeFile = useCallback((id: string) => {
    setFiles(prev => {
      const idx = prev.findIndex(f => f.id === id);
      if (idx < 0) return prev;
      const next = prev.filter(f => f.id !== id);
      // The sample is pinned in the sidebar so the list never empties —
      // belt-and-braces guard anyway.
      if (next.length === 0) return [SAMPLE_FILE];
      // If we just closed the active file, focus the neighbour to its left.
      if (id === activeId) {
        const fallback = next[Math.max(0, idx - 1)];
        setActiveId(fallback.id);
      }
      return next;
    });
  }, [activeId]);

  // Sidebar toggle — animate `visibleSV` 0..1, then replay the user's
  // last explicit camera intent against the new canvas pane. Ported from
  // Workspace's DocumentPane: `getLastAction()` tells us whether to refit
  // ('fit' → fitToViewport), recenter ('recenter' → recenter), or leave
  // the camera alone ('manual' — user has since panned or zoomed by hand).
  //
  // Why we animate `visibleSV` and not `widthSV`: keeping the user's
  // resized width preserved across close / re-open. Multiplying the two
  // gives the rendered width while keeping the "intended" width intact.
  //
  // No `leftOverlayWidth` arg passed to fit/recenter: the sidebar is
  // OUTSIDE the canvas pane in our flex layout, so CanvasView's `onLayout`
  // captures the correct post-animation pane size and the controls
  // already center against it.
  const toggleSidebar = useCallback(() => {
    const goingHidden = sidebarVisible;
    setSidebarVisible(v => !v);
    visibleSV.value = withTiming(goingHidden ? 0 : 1, {
      duration: TOGGLE_ANIMATION_MS,
      // easeInOutCubic — symmetric so close and re-open feel matched.
      easing: Easing.bezier(0.42, 0, 0.58, 1),
    });
    // Replay after the animation lands. CanvasView's onLayout fires
    // throughout the tween (sidebar's width changes every frame, canvas
    // pane reflows), so the final layout commit is what we react to.
    setTimeout(() => {
      const action = controlsRef.current?.getLastAction() ?? 'manual';
      if (action === 'fit') {
        controlsRef.current?.fitToViewport();
      } else if (action === 'recenter') {
        controlsRef.current?.recenter();
      }
      // 'manual' → leave camera alone; user explicitly placed it where
      // it is. Sidebar toggle shouldn't override that intent.
    }, TOGGLE_ANIMATION_MS + TOGGLE_REPLAY_PADDING_MS);
  }, [sidebarVisible, visibleSV]);

  // Surface `last:` for the status pill — bumped on every camera-action
  // button press. Initial value '—' updates after first interaction.
  useEffect(() => {
    setLastAction(controlsRef.current?.getLastAction() ?? '—');
  }, [activeId, sidebarVisible]);

  // Toggle button background tints. macOS-system palette to match Sidebar.
  const toggleBg = isDark ? '#2c2c2e' : '#f2f2f7';
  const toggleBorder = isDark ? '#3a3a3c' : '#c6c6c8';
  const toggleFg = isDark ? '#e5e5e7' : '#1c1c1e';

  return (
    <GestureHandlerRootView
      style={[styles.root, {backgroundColor: isDark ? '#000' : '#fff'}]}>
      <Sidebar
        files={files}
        activeId={activeId}
        pinnedId={SAMPLE_FILE.id}
        onActivate={setActiveId}
        onClose={closeFile}
        onOpen={openFiles}
        canOpen={FilePicker != null}
        widthSV={widthSV}
        visibleSV={visibleSV}
      />
      <View style={styles.canvasPane}>
        <CanvasView
          // `key` forces a clean remount on file switch so initial fit-content
          // re-runs against the new bounds; cheaper than wiring "switch active
          // document" through CanvasView's content-changed effect.
          key={activeFile.id}
          content={activeFile.content}
          basePath={activeFile.basePath}
          onReady={c => {
            controlsRef.current = c;
          }}
        />
        <Pressable
          onPress={toggleSidebar}
          style={[
            styles.sidebarToggle,
            {backgroundColor: toggleBg, borderColor: toggleBorder},
          ]}
          accessibilityLabel={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}>
          <Text style={[styles.sidebarToggleText, {color: toggleFg}]}>
            {sidebarVisible ? '◂' : '▸'}
          </Text>
        </Pressable>
        <View style={styles.controls} pointerEvents="box-none">
          <Pressable
            style={({pressed}) => [styles.button, pressed && styles.pressed]}
            onPress={() => {
              controlsRef.current?.recenter();
              setLastAction(controlsRef.current?.getLastAction() ?? '—');
            }}>
            <Text style={styles.buttonText}>Recenter</Text>
          </Pressable>
          <Pressable
            style={({pressed}) => [styles.button, pressed && styles.pressed]}
            onPress={() => {
              controlsRef.current?.fitToViewport();
              setLastAction(controlsRef.current?.getLastAction() ?? '—');
            }}>
            <Text style={styles.buttonText}>Fit</Text>
          </Pressable>
          <View style={styles.status}>
            <Text style={styles.statusText}>last: {lastAction}</Text>
          </View>
        </View>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, flexDirection: 'row'},
  canvasPane: {flex: 1},
  // Toggle button — persistent, sits at top-left of the canvas pane so
  // it's reachable whether the sidebar is open or closed. macOS-system
  // sizing (28pt circle) to feel native alongside the system-blue
  // Open File button in the sidebar.
  sidebarToggle: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarToggleText: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 14,
  },
  controls: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  button: {
    backgroundColor: '#222',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  buttonText: {color: '#fff', fontWeight: '600'},
  pressed: {opacity: 0.7},
  status: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginLeft: 'auto',
  },
  statusText: {color: '#fff', fontSize: 12},
});
