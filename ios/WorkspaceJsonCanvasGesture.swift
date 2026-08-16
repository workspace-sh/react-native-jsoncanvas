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
//   - `NSEvent.EventType.mouseMoved` (pointer position, for hover). Forwarded
//     as `onMouseMoved` with the same window-coord contract as
//     `onSmartMagnify`. RNGH's macOS hover handler reports only
//     `mouseEntered:` / `mouseExited:` with `forPointerInside:` extra data —
//     no coordinates at all (see `RNHoverHandler.m`, the `#else` /
//     non-`TARGET_OS_OSX` branch). That's enough to know the pointer is
//     somewhere over the canvas, and useless for picking out which of many
//     Skia-drawn nodes it is over, which is what hover-reveal needs.
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

  // --- Hover tracking state ---
  //
  // Opt-in (see `setHoverTracking`) rather than installed alongside the other
  // two monitors: `.mouseMoved` fires for every pointer movement anywhere in
  // the window, where the other two fire only on deliberate gestures. A
  // consumer that never reveals anything on hover shouldn't pay for that.
  private var mouseMovedMonitor: Any?
  private var lastHoverEmit: TimeInterval = 0
  private var lastHoverPoint = NSPoint(x: .greatestFiniteMagnitude, y: .greatestFiniteMagnitude)

  // Windows whose `acceptsMouseMovedEvents` we flipped on, held weakly so a
  // closed window doesn't keep us alive or crash the restore path.
  private let flippedWindows = NSHashTable<NSWindow>.weakObjects()
  private var windowObserver: NSObjectProtocol?

  // Emit at most ~30Hz, and only once the pointer has actually travelled.
  // Hover-reveal resolves to "which node is under the pointer" — a question
  // whose answer can't change faster than the pointer crosses a node border,
  // so bridging every one of AppKit's (up to 120Hz) movements would be pure
  // waste. Both thresholds are deliberately coarse.
  private static let hoverMinInterval: TimeInterval = 1.0 / 30.0
  private static let hoverMinDelta: CGFloat = 2.0

  // RN module setup boilerplate. Main queue so it's safe to install/remove
  // NSEvent monitors which are AppKit-main-thread-only.
  @objc override static func requiresMainQueueSetup() -> Bool { true }

  override func supportedEvents() -> [String] {
    ["onSmartMagnify", "onScrollWheel", "onMouseMoved"]
  }

  /// Start / stop forwarding pointer positions as `onMouseMoved`.
  ///
  /// Separate from the `startObserving` lifecycle because the JS side
  /// subscribes to this emitter for scroll-wheel and smart-magnify
  /// unconditionally, and hover is the one stream worth paying for only when
  /// something actually consumes it. `CanvasView` enables it on mount and
  /// disables it on unmount.
  @objc func setHoverTracking(_ enabled: Bool) {
    // NSEvent monitors and NSWindow are AppKit-main-thread-only.
    DispatchQueue.main.async { [weak self] in
      if enabled {
        self?.installMouseMovedMonitor()
      } else {
        self?.removeMouseMovedMonitor()
      }
    }
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

  private func installMouseMovedMonitor() {
    guard mouseMovedMonitor == nil else { return }

    // A window only receives mouse-moved events when it has asked for them —
    // `acceptsMouseMovedEvents` defaults to false, and an event the window
    // never receives is one our local monitor never sees. (NSTrackingArea is
    // the exception that doesn't need this flag, but a tracking area needs a
    // view to attach to, which this window-global module doesn't have — see
    // the view-component variant noted in FUTURE above.)
    //
    // We flip it rather than assume the host already did, and restore on
    // disable so a consumer that toggles hover off is left as we found it.
    enableMouseMovedDelivery()

    mouseMovedMonitor = NSEvent.addLocalMonitorForEvents(
      matching: .mouseMoved
    ) { [weak self] event in
      guard let self = self, self.hasListeners else { return event }

      let now = ProcessInfo.processInfo.systemUptime
      guard now - self.lastHoverEmit >= Self.hoverMinInterval else { return event }

      let pointInWindow = event.locationInWindow
      let dx = abs(pointInWindow.x - self.lastHoverPoint.x)
      let dy = abs(pointInWindow.y - self.lastHoverPoint.y)
      guard dx >= Self.hoverMinDelta || dy >= Self.hoverMinDelta else { return event }

      // No window means no coordinate space to report against — the pointer
      // is over another app or the desktop. Drop rather than guess.
      guard let windowHeight = event.window?.contentView?.bounds.height else { return event }

      self.lastHoverEmit = now
      self.lastHoverPoint = pointInWindow

      // Top-left-origin, matching `onSmartMagnify` exactly so the JS side can
      // run both through the same window→canvas-local→world conversion.
      let body: [String: Any] = [
        "x": pointInWindow.x,
        "y": windowHeight - pointInWindow.y,
      ]
      self.sendEvent(withName: "onMouseMoved", body: body)

      // Never consume. Moving the pointer is not our gesture to claim —
      // cursor rects, tracking areas, and every hover affordance in the host
      // app depend on this event continuing on its way.
      return event
    }
  }

  private func enableMouseMovedDelivery() {
    for window in NSApp.windows where !window.acceptsMouseMovedEvents {
      window.acceptsMouseMovedEvents = true
      flippedWindows.add(window)
    }

    // Windows that appear (or a document window opened) after hover tracking
    // was switched on would otherwise never deliver mouse-moved events.
    guard windowObserver == nil else { return }
    windowObserver = NotificationCenter.default.addObserver(
      forName: NSWindow.didBecomeKeyNotification,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      guard
        let self = self,
        let window = notification.object as? NSWindow,
        !window.acceptsMouseMovedEvents
      else { return }
      window.acceptsMouseMovedEvents = true
      self.flippedWindows.add(window)
    }
  }

  private func removeMouseMovedMonitor() {
    if let monitor = mouseMovedMonitor {
      NSEvent.removeMonitor(monitor)
      mouseMovedMonitor = nil
    }
    if let observer = windowObserver {
      NotificationCenter.default.removeObserver(observer)
      windowObserver = nil
    }
    for window in flippedWindows.allObjects {
      window.acceptsMouseMovedEvents = false
    }
    flippedWindows.removeAllObjects()
    lastHoverEmit = 0
    lastHoverPoint = NSPoint(x: .greatestFiniteMagnitude, y: .greatestFiniteMagnitude)
  }

  private func removeMonitors() {
    removeMouseMovedMonitor()
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
