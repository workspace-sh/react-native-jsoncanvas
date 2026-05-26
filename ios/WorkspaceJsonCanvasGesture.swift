// macOS-only gesture bridge for `@workspace.sh/react-native-jsoncanvas`.
//
// Listens for two AppKit event streams that RNGH-macos can't see:
//
//   - `NSEvent.EventType.smartMagnify` (trackpad two-finger double-tap —
//     Safari's "Smart Zoom"). Forwarded as `onSmartMagnify`. RNGH's
//     `Gesture.Tap()` on macOS sees trackpad taps as single-pointer events
//     and never fires for two-finger gestures.
//
//   - `NSEvent.EventType.scrollWheel` (trackpad two-finger pan, mouse
//     wheel). Forwarded as `onScrollWheel` with `deltaX`/`deltaY`. RNGH's
//     `Gesture.Pan()` on macOS only sees click-and-drag mouse events.
//
// The whole class is gated on `#if os(macOS)` so the same file (and the same
// podspec) is safe to include on iOS — the symbol is simply not present on
// non-macOS platforms, and the JS side checks `Platform.OS === 'macos'`
// before trying to use it.
//
// LIMITATION (v1): `NSEvent.addLocalMonitorForEvents` is a window-global
// hook. The event coordinates / deltas we forward to JS are window-scoped,
// not canvas-view-scoped. For `onSmartMagnify` the (x, y) are
// window-relative — for a playground harness where the canvas fills the
// window that's fine; for an app with chrome the consumer subtracts the
// offset before world-coord conversion. For `onScrollWheel` we forward
// raw deltas, so scrolling *anywhere* in the window will pan the canvas;
// consumers that need region-scoped scrolling (e.g. a sidebar list) need
// to gate the listener in JS or wait for the view-component variant.
// Documented further in `src/renderer/NativeScrollWheelView.tsx`.
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
  private var scrollWheelMonitor: Any?
  private var hasListeners = false

  // RN module setup boilerplate. Main queue so it's safe to install/remove
  // NSEvent monitors which are AppKit-main-thread-only.
  @objc override static func requiresMainQueueSetup() -> Bool { true }

  override func supportedEvents() -> [String] {
    ["onSmartMagnify", "onScrollWheel"]
  }

  // `RCTEventEmitter` calls these as JS-side `addListener` / `removeListener`
  // calls arrive. Tracks observer count so we don't waste cycles maintaining
  // a global event monitor when no JS listener is attached.
  override func startObserving() {
    hasListeners = true
    DispatchQueue.main.async { [weak self] in
      self?.installMonitors()
    }
  }

  override func stopObserving() {
    hasListeners = false
    DispatchQueue.main.async { [weak self] in
      self?.removeMonitors()
    }
  }

  private func installMonitors() {
    installSmartMagnifyMonitor()
    installScrollWheelMonitor()
  }

  private func installSmartMagnifyMonitor() {
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

  private func installScrollWheelMonitor() {
    guard scrollWheelMonitor == nil else { return }
    scrollWheelMonitor = NSEvent.addLocalMonitorForEvents(
      matching: .scrollWheel
    ) { [weak self] event in
      guard let self = self, self.hasListeners else { return event }

      // `scrollingDeltaX/Y` is the post-acceleration delta on macOS 10.7+;
      // accounts for the user's trackpad/mouse speed preference. Sign matches
      // AppKit convention (deltaY positive = scroll up = content moves down);
      // CanvasView consumes deltaX/Y as direct camera translation, so panning
      // with two fingers down moves the content down (natural direct-touch).
      let body: [String: Any] = [
        "deltaX": event.scrollingDeltaX,
        "deltaY": event.scrollingDeltaY,
      ]
      self.sendEvent(withName: "onScrollWheel", body: body)

      // Pass the event through. Don't consume — other UI in the host app
      // (NSScrollView descendants, e.g. a sidebar list) needs scroll too.
      // The canvas is non-scrollable anyway, so duplicating into AppKit is
      // harmless for our use case.
      return event
    }
  }

  private func removeMonitors() {
    if let monitor = smartMagnifyMonitor {
      NSEvent.removeMonitor(monitor)
      smartMagnifyMonitor = nil
    }
    if let monitor = scrollWheelMonitor {
      NSEvent.removeMonitor(monitor)
      scrollWheelMonitor = nil
    }
  }

  deinit {
    removeMonitors()
  }
}

#endif
