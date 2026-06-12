"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { Canvas, Polygon, Circle, FabricImage, FabricText, Point } from "fabric";
import type { SeatingConfig, ZoneDefinition, SectionDefinition } from "@/lib/seatmap-types";
import { migrateSeatingConfig } from "@/lib/migrate-seating-config";

interface SeatmapViewerProps {
  config: SeatingConfig;
  mode: "zone" | "seat";
  /** Map of zone ID (or tier ID) to remaining_quantity */
  availability?: Record<string, number>;
  /** Called when a zone is clicked (zone mode) */
  onZoneClick?: (zoneId: string) => void;
  /** Set of sold seat LABELS (seat mode) — tickets store seat labels, so sold
   *  status is keyed by `seat.label`. Holds below stay keyed by config seat ID. */
  soldSeats?: Set<string>;
  /** Set of config seat IDs held by current session */
  myHeldSeats?: Set<string>;
  /** Set of config seat IDs held by others */
  otherHeldSeats?: Set<string>;
  /** Called when a seat is clicked (seat mode) */
  onSeatClick?: (seatId: string, sectionId: string, label: string) => void;
  /** Currently selected zone ID for highlighting */
  selectedZoneId?: string | null;
}

const MAX_CANVAS_WIDTH = 1000;

// Zoom is relative to the fitted view: 1 = the whole map fits the canvas
// (zooming out below fit is pointless), 4 = 4x magnification.
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.5;
// A press that moves more than this many screen px is a pan/drag, not a click.
const CLICK_TOLERANCE_PX = 5;

const ZOOM_BTN_CLASS =
  "flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-900 shadow-md transition hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white";

// Helper to get/set custom data on fabric objects (not in TS types but works at runtime)
function setObjData(obj: any, data: Record<string, any>) {
  obj.data = data;
}
function getObjData(obj: any): Record<string, any> | undefined {
  return obj?.data;
}

// Seat circle radius in IMAGE-native pixels (so it scales with the map). Mirrors
// the designer: ~38% of the average seat spacing (true polygon area / seat count).
function nativeSeatRadius(points: [number, number][], seatCount: number): number {
  if (seatCount <= 0) return 14;
  let signed = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    signed += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
  }
  const area = Math.abs(signed) / 2;
  const spacing = Math.sqrt(area / seatCount);
  return spacing * 0.38;
}

export default function SeatmapViewer({
  config,
  mode,
  availability = {},
  onZoneClick,
  soldSeats = new Set(),
  myHeldSeats = new Set(),
  otherHeldSeats = new Set(),
  onSeatClick,
  selectedZoneId,
}: SeatmapViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<Canvas | null>(null);
  // Fit transform from image-native space -> canvas px (scale + offset).
  const fitRef = useRef({ scale: 1, offX: 0, offY: 0 });
  const [containerWidth, setContainerWidth] = useState(0);
  // Mirrors canvas.getZoom() so the overlay buttons can enable/disable.
  const [zoomLevel, setZoomLevel] = useState(1);
  // One press/drag gesture at a time (mouse or single touch).
  const gestureRef = useRef({
    active: false,
    panning: false,
    moved: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    data: undefined as Record<string, any> | undefined,
  });

  const migrated = migrateSeatingConfig(config);
  // Native image dimensions drive the canvas aspect ratio + coord projection.
  const imgW = migrated.image_width || 1000;
  const imgH = migrated.image_height || 700;

  // Responsive width via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setContainerWidth(Math.min(MAX_CANVAS_WIDTH, Math.floor(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sold is keyed by seat LABEL (tickets store labels); holds by config seat ID.
  const getSeatColor = useCallback(
    (seatId: string, seatLabel: string) => {
      if (soldSeats.has(seatLabel)) return { fill: "#9ca3af80", stroke: "#6b7280" }; // gray - sold
      if (myHeldSeats.has(seatId)) return { fill: "#3b82f680", stroke: "#2563eb" }; // blue - my hold
      if (otherHeldSeats.has(seatId)) return { fill: "#f59e0b80", stroke: "#d97706" }; // yellow - other hold
      return { fill: "#22c55e80", stroke: "#16a34a" }; // green - available
    },
    [soldSeats, myHeldSeats, otherHeldSeats]
  );

  const proj = useCallback((x: number, y: number): { x: number; y: number } => {
    const { scale, offX, offY } = fitRef.current;
    return { x: x * scale + offX, y: y * scale + offY };
  }, []);

  // --- Zoom & pan -----------------------------------------------------------
  // Content fills the canvas exactly at zoom 1 (objects carry the fit scale),
  // so an identity viewportTransform IS the fitted view. backgroundVpt is true
  // by default in Fabric v6, so canvas.backgroundImage follows the viewport
  // transform too — seats stay glued to the image at any zoom.

  // Clamp the viewport translation so the map can never be dragged out of view.
  const clampViewport = useCallback((canvas: Canvas) => {
    const vpt = canvas.viewportTransform;
    const zoom = canvas.getZoom();
    const w = canvas.getWidth();
    const h = canvas.getHeight();
    // Scene occupies w*zoom x h*zoom screen px; keep it covering the canvas.
    vpt[4] = Math.min(0, Math.max(w - w * zoom, vpt[4]));
    vpt[5] = Math.min(0, Math.max(h - h * zoom, vpt[5]));
    canvas.setViewportTransform(vpt);
  }, []);

  const syncZoomUi = useCallback((canvas: Canvas, zoom: number) => {
    canvas.defaultCursor = zoom > MIN_ZOOM ? "grab" : "default";
    setZoomLevel(zoom);
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, canvas.getZoom() * factor));
      canvas.zoomToPoint(new Point(canvas.getWidth() / 2, canvas.getHeight() / 2), next);
      clampViewport(canvas);
      syncZoomUi(canvas, next);
    },
    [clampViewport, syncZoomUi]
  );

  const resetZoom = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    syncZoomUi(canvas, 1);
  }, [syncZoomUi]);

  // Screen coords from a mouse or touch event (Fabric forwards both).
  function eventClientXY(ev: any): { x: number; y: number } | null {
    if (ev?.touches?.length) return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
    if (typeof ev?.clientX === "number") return { x: ev.clientX, y: ev.clientY };
    return null;
  }

  // Press started: remember the pressed object's data; if the press did NOT
  // start on a seat/zone and we're zoomed in, this gesture may become a pan.
  function beginPointer(canvas: Canvas, ev: any, data?: Record<string, any>) {
    const p = eventClientXY(ev);
    if (!p) return;
    const g = gestureRef.current;
    g.active = true;
    g.moved = false;
    g.data = data;
    g.panning = !data && canvas.getZoom() > MIN_ZOOM;
    g.startX = g.lastX = p.x;
    g.startY = g.lastY = p.y;
    if (g.panning) canvas.setCursor("grabbing");
  }

  // Pointer moved: flag the gesture as a drag past the click tolerance and,
  // when panning, translate the viewport (clamped).
  function trackPointer(canvas: Canvas, ev: any) {
    const g = gestureRef.current;
    if (!g.active) return;
    const p = eventClientXY(ev);
    if (!p) return;
    if (!g.moved && Math.hypot(p.x - g.startX, p.y - g.startY) > CLICK_TOLERANCE_PX) g.moved = true;
    if (g.panning && g.moved) {
      const vpt = canvas.viewportTransform;
      vpt[4] += p.x - g.lastX;
      vpt[5] += p.y - g.lastY;
      clampViewport(canvas);
      canvas.setCursor("grabbing");
    }
    g.lastX = p.x;
    g.lastY = p.y;
  }

  // Press ended: return the pressed object's data ONLY for a clean click —
  // a drag (pan) past the tolerance must never fire a seat/zone selection.
  function endPointer(canvas: Canvas): Record<string, any> | undefined {
    const g = gestureRef.current;
    if (!g.active) return undefined;
    const data = g.moved ? undefined : g.data;
    g.active = false;
    g.panning = false;
    g.data = undefined;
    canvas.setCursor(canvas.defaultCursor ?? "default");
    return data;
  }

  // (Re)create the canvas + render the background and content when the size or
  // the underlying map changes.
  useEffect(() => {
    if (!canvasRef.current || containerWidth <= 0) return;

    const cw = containerWidth;
    const ch = Math.round((cw * imgH) / imgW); // match image aspect → no letterbox/clipping
    const scale = cw / imgW; // image-native px → canvas px
    fitRef.current = { scale, offX: 0, offY: 0 };

    const canvas = new Canvas(canvasRef.current, {
      width: cw,
      height: ch,
      backgroundColor: "#f8fafc",
      selection: false,
    });
    fabricRef.current = canvas;

    // A fresh canvas (initial mount or container resize) starts at the fitted
    // view: zoom 1, identity pan. Reset the UI mirror so nothing drifts.
    syncZoomUi(canvas, 1);

    // Wheel/trackpad zoom, anchored at the cursor. Attached once per canvas —
    // the per-state render functions only off() mouse:down/move/up/over/out.
    canvas.on("mouse:wheel", (e) => {
      const we = e.e as WheelEvent;
      we.preventDefault(); // keep the page from scrolling while zooming the map
      we.stopPropagation();
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, canvas.getZoom() * Math.pow(0.999, we.deltaY)));
      canvas.zoomToPoint(new Point(we.offsetX, we.offsetY), next);
      clampViewport(canvas);
      syncZoomUi(canvas, next);
    });

    const render = async () => {
      if (migrated.image_url) {
        try {
          const img = await FabricImage.fromURL(migrated.image_url, { crossOrigin: "anonymous" });
          img.set({
            left: 0,
            top: 0,
            scaleX: cw / (img.width || imgW),
            scaleY: ch / (img.height || imgH),
            selectable: false,
            evented: false,
          });
          canvas.backgroundImage = img;
        } catch {
          // continue without background
        }
      }
      if (mode === "zone" && migrated.zones) renderZones(canvas, migrated.zones);
      else if (mode === "seat" && migrated.sections) renderSections(canvas, migrated.sections);
      canvas.renderAll();
    };
    render();

    return () => {
      canvas.dispose();
      fabricRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.image_url, containerWidth, imgW, imgH, mode]);

  // Re-render zones/seats (without recreating the canvas) on state changes.
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    for (const obj of canvas.getObjects()) canvas.remove(obj);
    if (mode === "zone" && migrated.zones) renderZones(canvas, migrated.zones);
    else if (mode === "seat" && migrated.sections) renderSections(canvas, migrated.sections);
    canvas.renderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedZoneId, availability, soldSeats, myHeldSeats, otherHeldSeats, mode, config.zones, config.sections]);

  function renderZones(canvas: Canvas, zones: ZoneDefinition[]) {
    // This runs on every state change — drop the previous generation's
    // listeners or every click fires once per re-render (duplicate selections).
    canvas.off("mouse:down");
    canvas.off("mouse:move");
    canvas.off("mouse:up");
    canvas.off("mouse:over");
    canvas.off("mouse:out");
    const zonePolygonMap = new Map<string, Polygon[]>();

    for (const zone of zones) {
      const remaining = availability[zone.id] ?? availability[zone.tier_id] ?? -1;
      const isSoldOut = remaining === 0;
      const isSelected = selectedZoneId === zone.id;

      const fillColor = isSoldOut ? "#9ca3af40" : isSelected ? zone.color + "80" : zone.color + "40";
      const strokeColor = isSoldOut ? "#6b7280" : zone.color;

      const zonePolygons: Polygon[] = [];
      for (const poly of zone.polygons) {
        const polygon = new Polygon(poly.points.map(([x, y]) => proj(x, y)), {
          fill: fillColor,
          stroke: strokeColor,
          strokeWidth: isSelected ? 3 : 2,
          selectable: false,
          evented: !isSoldOut,
          hoverCursor: isSoldOut ? "not-allowed" : "pointer",
        });
        setObjData(polygon, { zoneId: zone.id });
        canvas.add(polygon);
        zonePolygons.push(polygon);
      }
      zonePolygonMap.set(zone.id, zonePolygons);

      if (zone.polygons.length > 0) {
        const c = getPolygonCenter(zone.polygons[0].points);
        const center = proj(c.x, c.y);
        const label = new FabricText(zone.name, {
          left: center.x,
          top: center.y,
          fontSize: 13,
          fontFamily: "system-ui, sans-serif",
          fontWeight: "bold",
          fill: isSoldOut ? "#9ca3af" : "#1f2937",
          originX: "center",
          originY: "center",
          selectable: false,
          evented: false,
        });
        canvas.add(label);
      }
    }

    // Click vs pan: down records the pressed zone (or arms a background pan
    // when zoomed), move pans, up only selects if the pointer didn't drag.
    canvas.on("mouse:down", (e) => {
      beginPointer(canvas, e.e, getObjData(e.target));
    });
    canvas.on("mouse:move", (e) => trackPointer(canvas, e.e));
    canvas.on("mouse:up", () => {
      const data = endPointer(canvas);
      if (data?.zoneId && onZoneClick) onZoneClick(data.zoneId);
    });
    canvas.on("mouse:over", (e) => {
      const data = getObjData(e.target);
      if (data?.zoneId) {
        const zone = zones.find((z) => z.id === data.zoneId);
        const remaining = zone ? (availability[zone.id] ?? availability[zone.tier_id] ?? -1) : -1;
        if (remaining !== 0) {
          for (const sibling of zonePolygonMap.get(data.zoneId) || []) sibling.set({ strokeWidth: 3, opacity: 0.9 });
          canvas.renderAll();
        }
      }
    });
    canvas.on("mouse:out", (e) => {
      const data = getObjData(e.target);
      if (data?.zoneId) {
        const isSelected = selectedZoneId === data.zoneId;
        for (const sibling of zonePolygonMap.get(data.zoneId) || []) sibling.set({ strokeWidth: isSelected ? 3 : 2, opacity: 1 });
        canvas.renderAll();
      }
    });
  }

  function renderSections(canvas: Canvas, sections: SectionDefinition[]) {
    // Same listener hygiene as renderZones — exactly one handler generation.
    canvas.off("mouse:down");
    canvas.off("mouse:move");
    canvas.off("mouse:up");
    canvas.off("mouse:over");
    canvas.off("mouse:out");
    const scale = fitRef.current.scale;
    for (const section of sections) {
      const polygon = new Polygon(section.points.map(([x, y]) => proj(x, y)), {
        fill: section.color + "15",
        stroke: section.color + "60",
        strokeWidth: 1,
        selectable: false,
        evented: false,
      });
      canvas.add(polygon);

      const c = getPolygonCenter(section.points);
      const labelPos = proj(c.x, c.y);
      const sectionLabel = new FabricText(section.name, {
        left: labelPos.x,
        top: labelPos.y - 15,
        fontSize: 11,
        fontFamily: "system-ui, sans-serif",
        fontWeight: "bold",
        fill: section.color,
        originX: "center",
        originY: "center",
        selectable: false,
        evented: false,
      });
      canvas.add(sectionLabel);

      // Seat radius: native radius (from spacing) projected to canvas px, clamped.
      const r = Math.max(3, Math.min(16, nativeSeatRadius(section.points, section.seats.length) * scale));
      for (const seat of section.seats) {
        const colors = getSeatColor(seat.id, seat.label);
        const isSold = soldSeats.has(seat.label);
        const isHeldByOther = otherHeldSeats.has(seat.id);
        const isClickable = !isSold && !isHeldByOther;
        const p = proj(seat.x, seat.y);

        const circle = new Circle({
          left: p.x - r,
          top: p.y - r,
          radius: r,
          fill: colors.fill,
          stroke: colors.stroke,
          strokeWidth: 1.5,
          selectable: false,
          evented: isClickable,
          hoverCursor: isClickable ? "pointer" : "not-allowed",
        });
        setObjData(circle, { seatId: seat.id, sectionId: section.id, label: seat.label });
        canvas.add(circle);

        const seatLabel = new FabricText(seat.label, {
          left: p.x,
          top: p.y,
          fontSize: Math.max(6, Math.min(10, r * 0.9)),
          fontFamily: "system-ui, sans-serif",
          fill: "#ffffff",
          originX: "center",
          originY: "center",
          selectable: false,
          evented: false,
        });
        canvas.add(seatLabel);
      }
    }

    // Click vs pan: down records the pressed seat (or arms a background pan
    // when zoomed), move pans, up only selects if the pointer didn't drag.
    canvas.on("mouse:down", (e) => {
      beginPointer(canvas, e.e, getObjData(e.target));
    });
    canvas.on("mouse:move", (e) => trackPointer(canvas, e.e));
    canvas.on("mouse:up", () => {
      const data = endPointer(canvas);
      if (data?.seatId && onSeatClick) onSeatClick(data.seatId, data.sectionId, data.label);
    });
    canvas.on("mouse:over", (e) => {
      const data = getObjData(e.target);
      if (data?.seatId && e.target) {
        e.target.set({ strokeWidth: 2.5, scaleX: 1.15, scaleY: 1.15 });
        canvas.renderAll();
      }
    });
    canvas.on("mouse:out", (e) => {
      const data = getObjData(e.target);
      if (data?.seatId && e.target) {
        e.target.set({ strokeWidth: 1.5, scaleX: 1, scaleY: 1 });
        canvas.renderAll();
      }
    });
  }

  return (
    <div ref={containerRef} className="relative w-full rounded-lg border bg-slate-50 overflow-hidden">
      <canvas ref={canvasRef} />
      <div className="absolute right-2 top-2 z-10 flex flex-col gap-1.5">
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => zoomBy(ZOOM_STEP)}
          disabled={zoomLevel >= MAX_ZOOM - 0.001}
          className={ZOOM_BTN_CLASS}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          disabled={zoomLevel <= MIN_ZOOM + 0.001}
          className={ZOOM_BTN_CLASS}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Reset zoom"
          title="Fit to view"
          onClick={resetZoom}
          disabled={zoomLevel <= MIN_ZOOM + 0.001}
          className={ZOOM_BTN_CLASS}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3" />
            <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
            <path d="M3 16v3a2 2 0 0 0 2 2h3" />
            <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function getPolygonCenter(points: [number, number][]): { x: number; y: number } {
  const sumX = points.reduce((s, [x]) => s + x, 0);
  const sumY = points.reduce((s, [, y]) => s + y, 0);
  return { x: sumX / points.length, y: sumY / points.length };
}
