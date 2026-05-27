// App.tsx — minimal RN-macOS harness for smoke-testing @workspace.sh/react-native-jsoncanvas.
//
// Layout mirrors Workspace's apps/desktop (read-only reference): sidebar on
// the left listing opened .canvas files, main pane on the right rendering
// the active one via `<CanvasView />`. Fit / Recenter controls overlay the
// canvas at the bottom.
//
// State management stays simple — useState in App, prop-drilled into
// Sidebar. No Zustand for a smoke harness. File opening goes through the
// example-local `FilePicker` native module (NSOpenPanel under the hood,
// multi-select). The library's surface stays content-string-in, never
// touches the filesystem.
//
// Per #21: this is still a minimal vanilla macOS shell. No NSSplitView with
// a draggable divider, no resize persistence, no custom title bar — the
// shell exists to prove the renderer works, not to recreate Workspace.
import React, {useCallback, useMemo, useRef, useState} from 'react';
import {NativeModules, Pressable, StyleSheet, Text, useColorScheme, View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
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

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : path;
}

export default function App() {
  const controlsRef = useRef<Controls | null>(null);
  const [lastAction, setLastAction] = useState<string>('—');
  const [files, setFiles] = useState<OpenedFile[]>([SAMPLE_FILE]);
  const [activeId, setActiveId] = useState<string>(SAMPLE_FILE.id);

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
