// macOS-only gesture bridge for `@workspace.sh/react-native-jsoncanvas`.
//
// Listens for `NSEvent.EventType.smartMagnify` (the macOS trackpad two-finger
// double-tap — Safari's "Smart Zoom") and emits an `onSmartMagnify` event
// to JS through `RCTEventEmitter`. RNGH's `Gesture.Tap()` on macOS sees
// trackpad taps as single-pointer events and never fires for two-finger
// gestures, so we bypass it via the native AppKit event stream.
//
// The whole class is gated on `#if os(macOS)` so the same file (and the same
// podspec) is safe to include on iOS — the symbol is simply not present on
// non-macOS platforms, and the JS side checks `Platform.OS === 'macos'`
// before trying to use it.
//
// LIMITATION (v1): `NSEvent.addLocalMonitorForEvents` is a window-global
// hook. The event coordinates we forward to JS are window-relative, not
// canvas-view-relative. For a playground harness where the canvas fills
// the window that's fine; for an app with multi-pane layout the JS
// `onSmartMagnify` consumer needs to subtract any chrome offset. Documented
// in `src/renderer/NativeScrollWheelView.tsx`'s `SmartMagnifyEvent` JSDoc.
//
// FUTURE: ship a view-component variant (`<WorkspaceJsonCanvasGestureView />`)
// that consumers can mount over their canvas to get view-local coordinates
// and a per-instance lifecycle.

#if os(macOS)

import Cocoa
import React

@objc(WorkspaceJsonCanvasGesture)
class WorkspaceJsonCanvasGesture: RCTEventEmitter {
  private var smartMagnifyMonitor: Any?
  private var hasListeners = false

  // RN module setup boilerplate. Main queue so it's safe to install/remove
  // NSEvent monitors which are AppKit-main-thread-only.
  @objc override static func requiresMainQueueSetup() -> Bool { true }

  override func supportedEvents() -> [String] {
    ["onSmartMagnify"]
  }

  // `RCTEventEmitter` calls these as JS-side `addListener` / `removeListener`
  // calls arrive. Tracks observer count so we don't waste cycles maintaining
  // a global event monitor when no JS listener is attached.
  override func startObserving() {
    hasListeners = true
    DispatchQueue.main.async { [weak self] in
      self?.installMonitor()
    }
  }

  override func stopObserving() {
    hasListeners = false
    DispatchQueue.main.async { [weak self] in
      self?.removeMonitor()
    }
  }

  private func installMonitor() {
    guard smartMagnifyMonitor == nil else { return }
    smartMagnifyMonitor = NSEvent.addLocalMonitorForEvents(
      matching: .smartMagnify
    ) { [weak self] event in
      guard let self = self, self.hasListeners else { return event }

      // Top-left-origin coords to match what RNGH's `Tap.onEnd` would have
      // sent on iOS. AppKit's default view coordinate space has origin at
      // bottom-left; flip Y so the JS-side world-coord conversion in
      // CanvasView is identical to the iOS tap path.
      let pointInWindow = event.locationInWindow
      let windowHeight = event.window?.contentView?.bounds.height ?? 0
      let body: [String: Any] = [
        "x": pointInWindow.x,
        "y": windowHeight - pointInWindow.y,
      ]
      self.sendEvent(withName: "onSmartMagnify", body: body)

      // Return nil to consume — otherwise macOS's default browser-style
      // SmartZoom animation (which the system applies to NSScrollView
      // descendants) would also fire on top of our handler.
      return nil
    }
  }

  private func removeMonitor() {
    if let monitor = smartMagnifyMonitor {
      NSEvent.removeMonitor(monitor)
      smartMagnifyMonitor = nil
    }
  }

  deinit {
    removeMonitor()
  }
}

#endif
