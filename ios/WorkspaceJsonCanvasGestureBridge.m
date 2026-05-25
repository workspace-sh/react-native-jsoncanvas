// Objective-C registration shim for the Swift `WorkspaceJsonCanvasGesture`
// class. React Native's bridge discovers native modules through ObjC at
// runtime, so a Swift class needs a matching `.m` with `RCT_EXTERN_MODULE`
// to be visible.
//
// Gated on `TARGET_OS_OSX` so iOS builds skip this entirely — the Swift
// class itself is `#if os(macOS)`, so without this guard the linker would
// fail to resolve `WorkspaceJsonCanvasGesture` on iOS.

#if TARGET_OS_OSX

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(WorkspaceJsonCanvasGesture, RCTEventEmitter)

@end

#endif
