import * as Adw from '@gtkx/gi/adw';
import * as Gdk from '@gtkx/gi/gdk';
import * as Gtk from '@gtkx/gi/gtk';
import {
  GtkBox,
  GtkButton,
  GtkDrawingArea,
  GtkEventControllerMotion,
  GtkEventControllerScroll,
  GtkGestureDrag,
  GtkGestureZoom,
  GtkOverlay,
} from '@gtkx/jsx/gtk';
import { useProperty } from '@gtkx/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  drawCanvas,
  fitCamera,
  panBy,
  parseCanvasDocument,
  recenterCamera,
  zoomAt,
  type Camera,
} from './render.js';

/** The same two schemes as the React Native renderer's `ColorScheme`. */
export type ColorScheme = 'light' | 'dark';

/**
 * The scheme a canvas draws in: the one given, or else libadwaita's own
 * (`Adw.StyleManager`), followed live as the system switches. Anything the app
 * paints itself must be told the scheme; this is the telling, defaulted.
 */
export function useCanvasColorScheme(colorScheme?: ColorScheme): ColorScheme {
  // Read whether or not a scheme is given: a hook can't be conditional.
  const dark = useProperty(Adw.StyleManager.getDefault(), 'dark') === true;
  return colorScheme ?? (dark ? 'dark' : 'light');
}

/**
 * How long the camera must sit still before it is written down.
 *
 * The same 300ms the React Native canvas uses, and for the same reason: a pan
 * is a stream of events and the camera is a persisted value, so writing on
 * every frame would mean a file write per frame for a number nobody reads
 * until the next launch.
 */
const CAMERA_SAVE_DEBOUNCE_MS = 300;

/**
 * How long to wait after the sidebar is toggled before re-applying the camera.
 *
 * The same 350ms the macOS pane waits, and for the same reason: the split view
 * animates, so the pane is still growing when React hears about the toggle.
 * Acting on the state change directly would centre the document against the
 * width it is leaving rather than the one it is arriving at, which lands it
 * off-centre by however much the sidebar was worth.
 *
 * macOS has to debounce a STREAM of intermediate widths, because there the
 * sidebar overlays the canvas and the centring maths needs the number. Here
 * the split view genuinely resizes the drawing area, so nothing has to be
 * plumbed through — the width is read back off the widget when the timer
 * fires, and all the delay has to do is outlast the animation.
 */
const SIDEBAR_SETTLE_MS = 350;

/**
 * How long the drawing area must stop changing size before the camera is
 * re-applied to it.
 *
 * A resize is a STREAM — a compositor placing the window at launch, a tiling
 * rule, someone dragging an edge, the split view animating — and re-fitting on
 * each event would fit to every intermediate width on the way to the one that
 * matters. Debouncing means the last size wins, which is the only one anybody
 * sees.
 *
 * Shorter than `SIDEBAR_SETTLE_MS` because it is a different kind of wait. That
 * one has to OUTLAST an animation it cannot observe, so it is a guess with
 * margin in it; this one only has to outlast the gap between two resize events,
 * which is a frame. 150ms is far more than a frame and still quick enough that
 * the corrected fit lands while the window is still settling rather than
 * visibly jumping afterwards.
 */
const RESIZE_SETTLE_MS = 150;

/**
 * The last thing the user did to the camera, and what a resize should repeat.
 *
 * `manual` — a pan, a zoom or a restored camera — means leave it alone. That
 * is the important one: someone who has put the view where they want it is not
 * asking for it to be re-centred every time the sidebar comes and goes.
 */
type CameraAction = 'fit' | 'recenter' | 'manual';

/**
 * A JSON Canvas document on a `GtkDrawingArea`, with pan and zoom.
 *
 * The camera lives in a ref and the widget is told to redraw, rather than
 * living in state. A pan is a stream of motion events, and routing each one
 * through React would reconcile the tree per frame to change two numbers that
 * only Cairo reads. This is the same reasoning the macOS canvas applies when
 * it keeps `isPinching` in a shared value and refuses to `runOnJS` — the
 * mechanism differs, the reason does not.
 *
 * Gestures, following the platform rather than the RN app:
 * - scroll pans, and ctrl+scroll zooms about the pointer, which is what every
 *   GTK canvas application does;
 * - drag pans, for a mouse without a scroll wheel and for touch;
 * - pinch zooms about the gesture's own centre.
 */
export function CanvasView({
  source,
  label,
  initialCamera,
  onCameraChange,
  sidebarShown = false,
  colorScheme,
}: {
  source: string;
  label?: string;
  /** Where this document was last left. Applied once, at the first draw. */
  initialCamera?: Camera;
  onCameraChange?: (camera: Camera) => void;
  /** Whether the shell's sidebar is out. A change re-applies the last action. */
  sidebarShown?: boolean;
  /**
   * Light or dark, as the React Native `CanvasView` takes it. Left out, the
   * canvas follows libadwaita's own scheme (`Adw.StyleManager`), live, so a
   * libadwaita app gets a canvas that matches its window with no wiring.
   */
  colorScheme?: ColorScheme;
}) {
  const scheme = useCanvasColorScheme(colorScheme);
  const model = useMemo(() => parseCanvasDocument(source), [source]);

  const areaRef = useRef<Gtk.DrawingArea | null>(null);
  /** `null` until the first draw, which is when the viewport size is known. */
  const camera = useRef<Camera | null>(null);
  /** Camera as it was when the current gesture began. */
  const gestureOrigin = useRef<Camera | null>(null);
  const pointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  /**
   * The restored camera, consumed by the first draw.
   *
   * Held rather than read from the prop each time, because the prop is still
   * the camera as it was at LAUNCH: an external edit re-parses the document
   * and clears `camera`, and re-applying the saved value there would undo
   * every pan since. The first draw is the only draw that has nothing to
   * undo.
   */
  const restored = useRef<Camera | null>(initialCamera ?? null);
  /** Whether the camera has moved since it was last written down. */
  const moved = useRef(false);
  /**
   * A restored camera counts as `manual`.
   *
   * It is where the user left this document, so it is their choice as much
   * as a pan is — re-centring over it when the sidebar moves would throw
   * away the thing the persistence exists to keep. A document with no saved
   * camera opened by being fitted, so `fit` is what a resize repeats.
   */
  const lastAction = useRef<CameraAction>(
    initialCamera === undefined ? 'fit' : 'manual',
  );
  /**
   * The viewport the current camera was computed against.
   *
   * This is what makes a resize answerable: `fit` and `recenter` are
   * functions of the nodes AND the viewport, so a camera is only still
   * correct while the viewport it was derived from is still the one on
   * screen. Null until the first draw, which is the first moment anything
   * knows how big the widget is.
   */
  const lastSize = useRef<{ width: number; height: number } | null>(null);
  /** Previous `sidebarShown`, so the effect below fires on a change only. */
  const wasSidebarShown = useRef(sidebarShown);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read through a ref by the unmount flush, which runs once and would
  // otherwise be holding the first render's callback.
  const onCameraChangeRef = useRef(onCameraChange);
  useEffect(() => {
    onCameraChangeRef.current = onCameraChange;
  });

  const redraw = useCallback((): void => {
    areaRef.current?.queueDraw();
  }, []);

  /** Write the camera down now, cancelling anything scheduled. */
  const saveNow = useCallback((): void => {
    if (saveTimer.current !== null) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const current = camera.current;
    if (!moved.current || current === null) return;
    moved.current = false;
    onCameraChangeRef.current?.(current);
  }, []);

  // Taken on the way out, including on unmount.
  //
  // Switching documents is the common case and it happens well inside the
  // debounce: leaving the timer to expire would either lose the last part of
  // a pan or — since this component is keyed per document — write it against
  // whichever document arrived next. Flushing here settles both.
  useEffect(() => saveNow, [saveNow]);

  // A new document gets a fresh fit rather than inheriting the last one's
  // camera, which would open it off-screen.
  useEffect(() => {
    camera.current = null;
    redraw();
  }, [model, redraw]);

  const drawFunc = useCallback(
    (
      _area: Gtk.DrawingArea,
      cr: Parameters<Gtk.DrawingAreaDrawFunc>[1],
      width: number,
      height: number,
    ) => {
      if (camera.current === null) {
        camera.current =
          restored.current ?? fitCamera(model.nodes, width, height);
        restored.current = null;
        // The size this camera belongs to. Recorded here rather than
        // only in `fit`, because the first fit happens HERE — GTK hands
        // the draw its allocation, and until this runs nothing else in
        // the component knows the widget's size at all.
        lastSize.current = { width, height };
      }
      drawCanvas(cr, model, width, height, camera.current, scheme);
    },
    [model, scheme],
  );

  const apply = useCallback(
    (next: Camera, action: CameraAction = 'manual'): void => {
      camera.current = next;
      lastAction.current = action;
      moved.current = true;
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        saveNow();
      }, CAMERA_SAVE_DEBOUNCE_MS);
      redraw();
    },
    [redraw, saveNow],
  );

  /**
   * The drawing area's allocation, or `null` before it has one.
   *
   * `fitCamera` and `recenterCamera` both need the viewport, and until now
   * the only place that knew it was the draw callback, which is handed it by
   * GTK. A button press is not inside a draw, so it asks the widget — GTK4's
   * `getWidth`/`getHeight` are the allocated size, and are zero until the
   * widget has been through a size allocation.
   */
  const viewport = useCallback((): { width: number; height: number } | null => {
    const area = areaRef.current;
    if (area === null) return null;
    const width = area.getWidth();
    const height = area.getHeight();
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  }, []);

  const fit = useCallback((): void => {
    const size = viewport();
    if (size === null) return;
    lastSize.current = size;
    apply(fitCamera(model.nodes, size.width, size.height), 'fit');
  }, [apply, model, viewport]);

  const recenter = useCallback((): void => {
    const size = viewport();
    const current = camera.current;
    // Before the first draw there is no scale to keep, and fitting is what
    // is about to happen anyway.
    if (size === null || current === null) return;
    lastSize.current = size;
    apply(
      recenterCamera(model.nodes, size.width, size.height, current.scale),
      'recenter',
    );
  }, [apply, model, viewport]);

  /**
   * Do again whatever the user last asked for, against the viewport as it is
   * now.
   *
   * `manual` is the important case and it does nothing: someone who has
   * panned or zoomed to where they want to be is not asking for that to be
   * undone because the window changed shape. `fit` and `recenter` are the two
   * that were derived from a viewport, so they are the two a new viewport
   * invalidates.
   *
   * Read at the moment of replay rather than captured when the replay was
   * scheduled — the settle time is time in which the user may have panned,
   * and having done so they have said where they want the camera.
   */
  const replay = useCallback((): void => {
    if (lastAction.current === 'fit') fit();
    else if (lastAction.current === 'recenter') recenter();
  }, [fit, recenter]);

  /**
   * The drawing area changed size, so the camera derived from the old one is
   * wrong (#351).
   *
   * This is what fixes the fit everybody saw and nobody could name: the
   * window opens at its remembered size, the first draw fits the document to
   * THAT, and the compositor then resizes the window to whatever it has
   * decided the window should be. Without this the board spends the rest of
   * the session off-centre and a little too small, because the only fit that
   * ever ran was fitted to a window that existed for one frame.
   *
   * Compared against `lastSize` rather than replayed on every resize, and the
   * comparison is what keeps "opening a document" from counting as "moving
   * the camera": `GtkDrawingArea::resize` also fires once when the widget is
   * realized, at the size the first draw is about to use, and re-fitting to
   * the size you already fitted to is a write and a repaint for nothing.
   *
   * Null `lastSize` means nothing has been drawn yet. There is no camera to
   * correct, and the first draw will fit to the size that is current then.
   */
  const onResized = useCallback((): void => {
    if (resizeTimer.current !== null) clearTimeout(resizeTimer.current);
    resizeTimer.current = setTimeout(() => {
      resizeTimer.current = null;
      const size = viewport();
      const previous = lastSize.current;
      if (size === null || previous === null) return;
      if (size.width === previous.width && size.height === previous.height)
        return;
      replay();
    }, RESIZE_SETTLE_MS);
  }, [replay, viewport]);

  // Nothing outlives the view.
  //
  // Hygiene rather than a fix, and worth saying so: React nulls `areaRef` on
  // unmount, so a timer that did survive would find no widget, get `null`
  // from `viewport()` and return — which is why no test can tell this cleanup
  // from its absence. It is here because a component that leaves timers
  // running after it is gone is a component whose next change has a real bug
  // in it, not because it is stopping one today.
  useEffect(
    () => () => {
      if (resizeTimer.current !== null) clearTimeout(resizeTimer.current);
    },
    [],
  );

  // The sidebar coming and going, replayed the same way.
  //
  // Kept alongside the resize trigger rather than folded into it. Side by
  // side — which is how the shell configures `AdwOverlaySplitView` today —
  // the toggle really does resize the drawing area, so the resize path would
  // cover it; set `collapsed`, which is what a narrow window is supposed to
  // do, and the sidebar becomes an OVERLAY above the content, the canvas
  // keeps its allocation and no resize is emitted at all. The prop is the
  // shell saying what it did; the allocation is GTK saying what happened, and
  // they are not the same claim.
  //
  // Guarded on the value rather than run on every render of this effect,
  // because `fit` and `recenter` change identity whenever the document is
  // re-parsed, and an external edit is not a sidebar toggle.
  useEffect(() => {
    if (wasSidebarShown.current === sidebarShown) return;
    wasSidebarShown.current = sidebarShown;
    const timer = setTimeout(replay, SIDEBAR_SETTLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [sidebarShown, replay]);

  return (
    <GtkOverlay
      hexpand
      vexpand
      // Bottom trailing corner, the same corner the macOS floating panel
      // takes, and in the same order: recentre then fit. Two buttons over
      // a drawing area rather than in the header bar, because they act on
      // the view rather than on the document — and because the header bar
      // belongs to the pane, which shows markdown just as often.
      overlays={
        <GtkBox
          orientation={Gtk.Orientation.HORIZONTAL}
          spacing={6}
          halign={Gtk.Align.END}
          valign={Gtk.Align.END}
          marginEnd={12}
          marginBottom={12}
        >
          <GtkButton
            iconName="find-location-symbolic"
            cssClasses={['flat', 'circular']}
            tooltipText="Recenter canvas"
            onClicked={recenter}
          />
          <GtkButton
            iconName="zoom-fit-best-symbolic"
            cssClasses={['flat', 'circular']}
            tooltipText="Fit all content to viewport"
            onClicked={fit}
          />
        </GtkBox>
      }
    >
      <GtkDrawingArea
        ref={areaRef}
        drawFunc={drawFunc}
        onResize={onResized}
        hexpand
        vexpand
        // A drawing area is opaque to assistive technology: it is one
        // rectangle of pixels with no children to announce. Naming it, and
        // saying how big the document is, is the least it can offer.
        accessibleLabel={label ?? 'Canvas'}
        accessibleDescription={`${model.nodes.length} nodes, ${model.edges.length} edges. Scroll to pan, ctrl and scroll to zoom.`}
        controllers={
          <>
            <GtkEventControllerMotion
              onMotion={(x, y) => {
                pointer.current = { x, y };
              }}
            />
            <GtkEventControllerScroll
              flags={Gtk.EventControllerScrollFlags.BOTH_AXES}
              onScroll={(dx, dy, self) => {
                const current = camera.current;
                if (current === null) return false;
                // Guarded: reading modifier state with no current
                // event trips a GDK assertion, which a synthesised
                // scroll (a test, or an assistive tool) can produce.
                const ctrl =
                  self.getCurrentEvent() !== null &&
                  // eslint-disable-next-line no-bitwise -- a GDK modifier mask is a bit field
                  (self.getCurrentEventState() &
                    Gdk.ModifierType.CONTROL_MASK) !==
                    0;
                if (ctrl) {
                  // Zoom about the pointer, so the thing under the
                  // cursor stays under the cursor.
                  apply(
                    zoomAt(
                      current,
                      Math.pow(0.9, dy),
                      pointer.current.x,
                      pointer.current.y,
                    ),
                  );
                } else {
                  // Wheel notches are ±1; a scroll of one notch
                  // should move a useful distance, not one pixel.
                  apply(panBy(current, -dx * 60, -dy * 60));
                }
                return true;
              }}
            />
            <GtkGestureDrag
              onDragBegin={() => {
                gestureOrigin.current = camera.current;
              }}
              onDragUpdate={(offsetX, offsetY) => {
                const origin = gestureOrigin.current;
                if (origin === null) return;
                // Offsets are from the gesture's start, so they are
                // applied to the camera as it was then — accumulating
                // per-event deltas would drift.
                apply(panBy(origin, offsetX, offsetY));
              }}
              onDragEnd={() => {
                gestureOrigin.current = null;
              }}
            />
            <GtkGestureZoom
              onScaleChanged={(scale, self) => {
                const origin = gestureOrigin.current ?? camera.current;
                if (origin === null) return;
                gestureOrigin.current ??= origin;

                // A gesture GTK has not recognized has no points
                // to average, and asking for their centre makes
                // it dereference a sequence event that is not
                // there — three `GDK_IS_EVENT` criticals per
                // call, which `@gtkx/runtime` raises as JS errors
                // from a log-writer callback where no `try` can
                // catch them. `getBoundingBoxCenter` handles the
                // empty case correctly and returns false; the
                // noise is on the way in, so the only cure is not
                // to ask.
                //
                // A real pinch is always recognized by the time
                // it scales, so this changes nothing a person
                // does. It is the same shape as the
                // `getCurrentEvent() !== null` guard on the
                // scroll controller above, and for the same
                // reason: a synthesised gesture reaches these
                // handlers without the event GTK assumes.
                if (!self.isRecognized()) return;

                const [ok, cx, cy] = self.getBoundingBoxCenter();
                apply(
                  zoomAt(
                    origin,
                    scale,
                    ok ? cx : pointer.current.x,
                    ok ? cy : pointer.current.y,
                  ),
                );
              }}
            />
          </>
        }
      />
    </GtkOverlay>
  );
}
