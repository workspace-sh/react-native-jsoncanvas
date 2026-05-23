import {useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {StatusBar} from 'expo-status-bar';
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

  return (
    <GestureHandlerRootView style={styles.root}>
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
      <StatusBar style="auto" />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#fff'},
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
