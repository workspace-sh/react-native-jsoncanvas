import React from 'react';
import {Platform, requireNativeComponent, StyleSheet, View, type ViewProps} from 'react-native';

export interface CanvasGlassProps extends ViewProps {
  /** The glass's corner radius, in points. */
  cornerRadius?: number;
}

const NativeGlass =
  Platform.OS === 'macos' ? requireNativeComponent<CanvasGlassProps>('JsonCanvasGlass') : null;

/**
 * Liquid Glass behind its children, on the Mac (NSGlassEffectView; a visual
 * effect view before macOS 26): the minimap's default background there, and
 * a surface for a host's own canvas controls. Elsewhere a plain view: iOS
 * hosts pass their own glass (expo-glass-effect) through `minimapBackground`.
 */
export function CanvasGlass({cornerRadius, style, ...props}: CanvasGlassProps) {
  if (NativeGlass) return <NativeGlass cornerRadius={cornerRadius} style={style} {...props} />;
  return <View style={[style, cornerRadius != null && styles.clip, cornerRadius != null && {borderRadius: cornerRadius}]} {...props} />;
}

const styles = StyleSheet.create({
  clip: {overflow: 'hidden'},
});

export interface CanvasGlassButtonProps extends ViewProps {
  /** An SF Symbol's name. */
  symbol: string;
  /** Its tooltip and accessibility label. */
  help: string;
  onPress: () => void;
}

const NativeGlassButton =
  Platform.OS === 'macos'
    ? requireNativeComponent<Omit<CanvasGlassButtonProps, 'onPress'> & {onGlassPress: () => void}>('JsonCanvasGlassButton')
    : null;

/**
 * The Mac's own Liquid Glass button (an NSButton with the system's glass
 * bezel, macOS 26) showing an SF Symbol: for a host's canvas controls, such
 * as Recenter and Fit. Null where there's no native one (iOS and Android
 * hosts draw their own).
 */
export function CanvasGlassButton({onPress, ...props}: CanvasGlassButtonProps) {
  if (!NativeGlassButton) return null;
  return <NativeGlassButton {...props} onGlassPress={onPress} />;
}
