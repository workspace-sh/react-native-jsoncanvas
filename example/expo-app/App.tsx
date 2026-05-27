import {useCallback, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, useColorScheme, View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {StatusBar} from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import {CanvasView} from '@workspace.sh/react-native-jsoncanvas';
import {SAMPLE_CANVAS} from './fixtures';

type Controls = {
  fitToViewport: (leftInset?: number) => void;
  recenter: (leftInset?: number) => void;
  getLastAction: () => 'fit' | 'recenter' | 'manual';
};

function dirname(uri: string): string {
  const i = uri.lastIndexOf('/');
  return i >= 0 ? uri.slice(0, i + 1) : uri;
}

export default function App() {
  const controlsRef = useRef<Controls | null>(null);
  const [lastAction, setLastAction] = useState<string>('—');
  // Active canvas content + basePath for the renderer. Defaults to the
  // built-in sample so the harness shows something on first launch.
  const [content, setContent] = useState<string>(SAMPLE_CANVAS);
  const [basePath, setBasePath] = useState<string | undefined>(undefined);
  const [openName, setOpenName] = useState<string>('hesprs-demo (sample)');
  // Renderer text/nodes already react to useColorScheme internally; the
  // wrapper has to match so canvas-empty background doesn't fight node
  // colours (e.g. dark nodes on a white background in dark mode).
  const isDark = useColorScheme() === 'dark';

  const openFile = useCallback(async () => {
    try {
      // No MIME type for .canvas exists in Apple's UTI registry; '*/*' lets
      // the user pick any file. Filter happens client-side via extension
      // check / parse failure inside CanvasView (graceful unable-to-load
      // banner).
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];
      const text = await FileSystem.readAsStringAsync(asset.uri, {encoding: 'utf8'});
      setContent(text);
      setBasePath(dirname(asset.uri));
      setOpenName(asset.name ?? 'untitled');
    } catch (err) {
      console.warn('[App] open file failed:', err);
    }
  }, []);

  const resetToSample = useCallback(() => {
    setContent(SAMPLE_CANVAS);
    setBasePath(undefined);
    setOpenName('hesprs-demo (sample)');
  }, []);

  return (
    <GestureHandlerRootView
      style={[styles.root, {backgroundColor: isDark ? '#000' : '#fff'}]}
    >
      <CanvasView
        // `key` forces a clean remount on file swap so initial fit-content
        // re-runs against the new bounds; cheaper than wiring file change
        // through CanvasView's own content-changed effect.
        key={openName}
        content={content}
        basePath={basePath}
        onReady={c => {
          controlsRef.current = c;
        }}
      />
      <View style={styles.controls} pointerEvents="box-none">
        <Pressable
          style={({pressed}) => [styles.button, pressed && styles.pressed]}
          onPress={openFile}
        >
          <Text style={styles.buttonText}>Open</Text>
        </Pressable>
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
        <Pressable
          style={({pressed}) => [styles.status, pressed && styles.pressed]}
          onPress={resetToSample}
        >
          <Text style={styles.statusText} numberOfLines={1}>
            {openName}
          </Text>
        </Pressable>
      </View>
      <StatusBar style="auto" />
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
    maxWidth: 200,
  },
  statusText: {color: '#fff', fontSize: 12},
});
