"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { Canvas, Polygon, Circle, FabricImage, FabricText } from "fabric";
import type { SeatingConfig, ZoneDefinition, SectionDefinition } from "@/lib/seatmap-types";
import { migrateSeatingConfig } from "@/lib/migrate-seating-config";

interface SeatmapViewerProps {
  config: SeatingConfig;
  mode: "zone" | "seat";
  /** Map of zone ID (or tier ID) to remaining_quantity */
  availability?: Record<string, number>;
  /** Called when a zone is clicked (zone mode) */
  onZoneClick?: (zoneId: string) => void;
  /** Set of sold seat IDs (seat mode) */
  soldSeats?: Set<string>;
  /** Set of seat IDs held by current session */
  myHeldSeats?: Set<string>;
  /** Set of seat IDs held by others */
  otherHeldSeats?: Set<string>;
  /** Called when a seat is clicked (seat mode) */
  onSeatClick?: (seatId: string, sectionId: string, label: string) => void;
  /** Currently selected zone ID for highlighting */
  selectedZoneId?: string | null;
}

const MAX_CANVAS_WIDTH = 1000;

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

  const getSeatColor = useCallback(
    (seatId: string) => {
      if (soldSeats.has(seatId)) return { fill: "#9ca3af80", stroke: "#6b7280" }; // gray - sold
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

    canvas.on("mouse:down", (e) => {
      const data = getObjData(e.target);
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
        const colors = getSeatColor(seat.id);
        const isSold = soldSeats.has(seat.id);
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

    canvas.on("mouse:down", (e) => {
      const data = getObjData(e.target);
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
    <div ref={containerRef} className="w-full rounded-lg border bg-slate-50 overflow-hidden">
      <canvas ref={canvasRef} />
    </div>
  );
}

function getPolygonCenter(points: [number, number][]): { x: number; y: number } {
  const sumX = points.reduce((s, [x]) => s + x, 0);
  const sumY = points.reduce((s, [, y]) => s + y, 0);
  return { x: sumX / points.length, y: sumY / points.length };
}
