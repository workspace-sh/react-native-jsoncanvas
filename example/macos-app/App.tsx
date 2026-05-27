// App.tsx — minimal RN-macOS harness for smoke-testing @workspace.sh/react-native-jsoncanvas.
//
// Mirrors example/expo-app/App.tsx's shape so the two harnesses demonstrate
// the same surface: Fit / Recenter buttons that drive onReady controls, a
// status pill showing getLastAction(). Beyond that, the macOS version adds:
//
//   - File opening via the `FilePicker` native module (NSOpenPanel under
//     the hood, multi-select). Renders any number of files as switchable
//     tabs at the top of the window.
//   - The library's `SAMPLE_CANVAS` fixture is the initial tab so the
//     harness has something to show on first launch without opening
//     anything.
//
// Per #21: still a minimal vanilla macOS shell. No NSSplitView, no custom
// title bar. The native module lives in the example app, NOT the library —
// file IO is a consumer concern.
import React, {useCallback, useMemo, useRef, useState} from 'react';
import {NativeModules, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {CanvasView} from '@workspace.sh/react-native-jsoncanvas';
import {SAMPLE_CANVAS} from './fixtures';

type Controls = {
  fitToViewport: (leftInset?: number) => void;
  recenter: (leftInset?: number) => void;
  getLastAction: () => 'fit' | 'recenter' | 'manual';
};

interface OpenedFile {
  id: string;
  name: string;
  content: string;
  // Absolute path to the file's directory, used as `basePath` for
  // resolving relative image references inside the canvas.
  basePath?: string;
}

interface FilePickerResult {
  path: string;
  name: string;
  content: string;
}

interface FilePickerModule {
  openCanvasFiles(): Promise<FilePickerResult[]>;
}

const FilePicker = NativeModules.FilePicker as FilePickerModule | undefined;

// Built-in sample so the harness has something to show before any file is
// opened. Synthesised into an OpenedFile so the tab strip is uniform.
const SAMPLE_TAB: OpenedFile = {
  id: 'sample',
  name: 'hesprs-demo (sample)',
  content: SAMPLE_CANVAS,
};

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : path;
}

export default function App() {
  const controlsRef = useRef<Controls | null>(null);
  const [lastAction, setLastAction] = useState<string>('—');
  const [tabs, setTabs] = useState<OpenedFile[]>([SAMPLE_TAB]);
  const [activeId, setActiveId] = useState<string>(SAMPLE_TAB.id);

  // Renderer text/nodes already react to useColorScheme internally; the
  // wrapper has to match so the canvas-empty background doesn't fight the
  // node colours (e.g. dark nodes on a white background in dark mode).
  const isDark = useColorScheme() === 'dark';

  const activeTab = useMemo(
    () => tabs.find(t => t.id === activeId) ?? tabs[0],
    [tabs, activeId],
  );

  const openFiles = useCallback(async () => {
    if (!FilePicker) return;
    try {
      const results = await FilePicker.openCanvasFiles();
      if (results.length === 0) return;
      setTabs(prev => {
        const next = [...prev];
        for (const r of results) {
          // De-dupe by absolute path — re-opening the same file just
          // re-focuses its existing tab instead of stacking duplicates.
          const existing = next.find(t => t.id === r.path);
          if (existing) continue;
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

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === id);
      if (idx < 0) return prev;
      const next = prev.filter(t => t.id !== id);
      // Empty list shouldn't happen (sample stays around), but guard anyway.
      if (next.length === 0) return [SAMPLE_TAB];
      // If we just closed the active tab, focus the neighbour to its left
      // (or the new first tab if we closed the leftmost).
      if (id === activeId) {
        const fallback = next[Math.max(0, idx - 1)];
        setActiveId(fallback.id);
      }
      return next;
    });
  }, [activeId]);

  const tabBarBg = isDark ? '#1a1a1a' : '#f0f0f0';
  const tabBg = isDark ? '#2a2a2a' : '#ffffff';
  const tabActiveBg = isDark ? '#3a3a3a' : '#dcdcdc';
  const tabText = isDark ? '#e5e5e5' : '#222';
  const tabBorder = isDark ? '#3a3a3a' : '#ccc';

  return (
    <GestureHandlerRootView
      style={[styles.root, {backgroundColor: isDark ? '#000' : '#fff'}]}
    >
      <View style={[styles.tabBar, {backgroundColor: tabBarBg, borderBottomColor: tabBorder}]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBarContent}>
          {tabs.map(tab => {
            const isActive = tab.id === activeId;
            return (
              <Pressable
                key={tab.id}
                onPress={() => setActiveId(tab.id)}
                style={[
                  styles.tab,
                  {backgroundColor: isActive ? tabActiveBg : tabBg, borderColor: tabBorder},
                ]}
              >
                <Text style={[styles.tabText, {color: tabText}]} numberOfLines={1}>
                  {tab.name}
                </Text>
                {tab.id !== SAMPLE_TAB.id && (
                  <Pressable
                    onPress={() => closeTab(tab.id)}
                    hitSlop={4}
                    style={styles.tabClose}
                  >
                    <Text style={[styles.tabCloseText, {color: tabText}]}>×</Text>
                  </Pressable>
                )}
              </Pressable>
            );
          })}
          {FilePicker && (
            <Pressable
              onPress={openFiles}
              style={[styles.openButton, {backgroundColor: tabBg, borderColor: tabBorder}]}
            >
              <Text style={[styles.openButtonText, {color: tabText}]}>+ Open…</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
      <View style={styles.canvasWrap}>
        <CanvasView
          // `key` forces a remount on tab switch so initialViewState /
          // fit-content effects re-run for the new content. Cheaper than
          // wiring "switch active document" through CanvasView's own
          // content-changed effect, and our renderer is fast to mount.
          key={activeTab.id}
          content={activeTab.content}
          basePath={activeTab.basePath}
          onReady={c => {
            controlsRef.current = c;
          }}
        />
        <View style={styles.controls} pointerEvents="box-none">
          <Pressable
            style={({pressed}) => [styles.button, pressed && styles.pressed]}
            onPress={() => {
              controlsRef.current?.recenter();
              setLastAction(controlsRef.current?.getLastAction() ?? '—');
            }}
          >
            <Text style={styles.buttonText}>Recenter</Text>
          </Pressable>
          <Pressable
            style={({pressed}) => [styles.button, pressed && styles.pressed]}
            onPress={() => {
              controlsRef.current?.fitToViewport();
              setLastAction(controlsRef.current?.getLastAction() ?? '—');
            }}
          >
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
  root: {flex: 1},
  tabBar: {
    borderBottomWidth: 1,
  },
  tabBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingLeft: 12,
    paddingRight: 8,
    borderRadius: 6,
    borderWidth: 1,
    maxWidth: 220,
    gap: 6,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '500',
  },
  tabClose: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabCloseText: {
    fontSize: 14,
    lineHeight: 14,
    fontWeight: '600',
  },
  openButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    marginLeft: 4,
  },
  openButtonText: {
    fontSize: 12,
    fontWeight: '500',
  },
  canvasWrap: {flex: 1},
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
