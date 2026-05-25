// App.tsx — minimal RN-macOS harness for smoke-testing @workspace.sh/react-native-jsoncanvas.
//
// Mirrors example/expo-app/App.tsx's shape so the two harnesses demonstrate
// the same surface: Fit / Recenter buttons that drive onReady controls, a
// status pill showing getLastAction(). Only difference is platform plumbing —
// bare RN + react-native-macos here, Expo CNG there.
//
// Per #21: this is a MINIMAL vanilla macOS shell. No NSSplitView, no custom
// title bar, no native modules. The point is to prove the renderer mounts
// and behaves on macOS, not to recreate Workspace's apps/desktop.
import React, {useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, useColorScheme, View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {CanvasView} from '@workspace.sh/react-native-jsoncanvas';
import {SAMPLE_CANVAS} from './fixtures';

type Controls = {
  fitToViewport: (leftInset?: number) => void;
  recenter: (leftInset?: number) => void;
  getLastAction: () => 'fit' | 'recenter' | 'manual';
};

export default function App() {
  const controlsRef = useRef<Controls | null>(null);
  const [lastAction, setLastAction] = useState<string>('—');
  // Renderer text/nodes already react to useColorScheme internally; the
  // wrapper has to match so the canvas-empty background doesn't fight the
  // node colours (e.g. dark nodes on a white background in dark mode).
  const isDark = useColorScheme() === 'dark';

  return (
    <GestureHandlerRootView
      style={[styles.root, {backgroundColor: isDark ? '#000' : '#fff'}]}
    >
      <CanvasView
        content={SAMPLE_CANVAS}
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
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
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
