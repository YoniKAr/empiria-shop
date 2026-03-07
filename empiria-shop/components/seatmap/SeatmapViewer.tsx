"use client";

import { useRef, useEffect, useCallback } from "react";
import { Canvas, Polygon, Circle, FabricImage, FabricText } from "fabric";
import type { SeatingConfig, ZoneDefinition, SectionDefinition } from "@/lib/seatmap-types";
import { migrateSeatingConfig } from "@/lib/migrate-seating-config";

interface SeatmapViewerProps {
  config: SeatingConfig;
  mode: "zone" | "seat";
  /** Map of zone/section tier_id to remaining_quantity */
  availability?: Record<string, number>;
  /** Called when a zone is clicked (zone mode) */
  onZoneClick?: (zoneId: string, tierId: string) => void;
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

const CANVAS_WIDTH = 700;
const CANVAS_HEIGHT = 500;

// Helper to get/set custom data on fabric objects (not in TS types but works at runtime)
function setObjData(obj: any, data: Record<string, any>) {
  obj.data = data;
}
function getObjData(obj: any): Record<string, any> | undefined {
  return obj?.data;
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<Canvas | null>(null);

  const getSeatColor = useCallback(
    (seatId: string) => {
      if (soldSeats.has(seatId)) return { fill: "#9ca3af80", stroke: "#6b7280" }; // gray - sold
      if (myHeldSeats.has(seatId)) return { fill: "#3b82f680", stroke: "#2563eb" }; // blue - my hold
      if (otherHeldSeats.has(seatId)) return { fill: "#f59e0b80", stroke: "#d97706" }; // yellow - other hold
      return { fill: "#22c55e80", stroke: "#16a34a" }; // green - available
    },
    [soldSeats, myHeldSeats, otherHeldSeats]
  );

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new Canvas(canvasRef.current, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      backgroundColor: "#f8fafc",
      selection: false,
    });

    fabricRef.current = canvas;

    const migratedConfig = migrateSeatingConfig(config);

    const renderContent = async () => {
      // Load background image
      if (migratedConfig.image_url) {
        try {
          const img = await FabricImage.fromURL(migratedConfig.image_url, {
            crossOrigin: "anonymous",
          });
          const scale = Math.min(
            CANVAS_WIDTH / img.width!,
            CANVAS_HEIGHT / img.height!
          );
          img.scaleX = scale;
          img.scaleY = scale;
          img.set({
            left: (CANVAS_WIDTH - img.width! * scale) / 2,
            top: (CANVAS_HEIGHT - img.height! * scale) / 2,
            selectable: false,
            evented: false,
          });
          canvas.backgroundImage = img;
        } catch {
          // Image load failed - continue without background
        }
      }

      if (mode === "zone" && migratedConfig.zones) {
        renderZones(canvas, migratedConfig.zones);
      } else if (mode === "seat" && migratedConfig.sections) {
        renderSections(canvas, migratedConfig.sections);
      }

      canvas.renderAll();
    };

    renderContent();

    return () => {
      canvas.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.image_url]);

  // Re-render zones/seats when selection or availability changes
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const migratedConfig = migrateSeatingConfig(config);

    // Remove all non-background objects
    const objects = canvas.getObjects();
    for (const obj of objects) {
      canvas.remove(obj);
    }

    if (mode === "zone" && migratedConfig.zones) {
      renderZones(canvas, migratedConfig.zones);
    } else if (mode === "seat" && migratedConfig.sections) {
      renderSections(canvas, migratedConfig.sections);
    }

    canvas.renderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedZoneId,
    availability,
    soldSeats,
    myHeldSeats,
    otherHeldSeats,
    mode,
    config.zones,
    config.sections,
  ]);

  function renderZones(canvas: Canvas, zones: ZoneDefinition[]) {
    // Track all polygon objects for hover group highlighting
    const zonePolygonMap = new Map<string, Polygon[]>();

    for (const zone of zones) {
      const remaining = availability[zone.tier_id] ?? -1;
      const isSoldOut = remaining === 0;
      const isSelected = selectedZoneId === zone.id;

      const fillColor = isSoldOut
        ? "#9ca3af40"
        : isSelected
        ? zone.color + "80"
        : zone.color + "40";
      const strokeColor = isSoldOut ? "#6b7280" : zone.color;

      const zonePolygons: Polygon[] = [];

      for (const poly of zone.polygons) {
        const polygon = new Polygon(
          poly.points.map(([x, y]) => ({ x, y })),
          {
            fill: fillColor,
            stroke: strokeColor,
            strokeWidth: isSelected ? 3 : 2,
            selectable: false,
            evented: !isSoldOut,
            hoverCursor: isSoldOut ? "not-allowed" : "pointer",
          }
        );
        setObjData(polygon, { zoneId: zone.id, tierId: zone.tier_id });
        canvas.add(polygon);
        zonePolygons.push(polygon);
      }

      zonePolygonMap.set(zone.id, zonePolygons);

      // Add zone label at center of first polygon
      if (zone.polygons.length > 0) {
        const center = getPolygonCenter(zone.polygons[0].points);
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

    // Zone click handler
    canvas.on("mouse:down", (e) => {
      const data = getObjData(e.target);
      if (data?.zoneId && onZoneClick) {
        onZoneClick(data.zoneId, data.tierId);
      }
    });

    // Hover effects — highlight all polygons in the same zone
    canvas.on("mouse:over", (e) => {
      const obj = e.target;
      const data = getObjData(obj);
      if (data?.zoneId) {
        const zone = zones.find((z) => z.id === data.zoneId);
        const remaining = zone ? (availability[zone.tier_id] ?? -1) : -1;
        if (remaining !== 0) {
          const siblings = zonePolygonMap.get(data.zoneId) || [];
          for (const sibling of siblings) {
            sibling.set({ strokeWidth: 3, opacity: 0.9 });
          }
          canvas.renderAll();
        }
      }
    });

    canvas.on("mouse:out", (e) => {
      const obj = e.target;
      const data = getObjData(obj);
      if (data?.zoneId) {
        const isSelected = selectedZoneId === data.zoneId;
        const siblings = zonePolygonMap.get(data.zoneId) || [];
        for (const sibling of siblings) {
          sibling.set({ strokeWidth: isSelected ? 3 : 2, opacity: 1 });
        }
        canvas.renderAll();
      }
    });
  }

  function renderSections(canvas: Canvas, sections: SectionDefinition[]) {
    for (const section of sections) {
      // Draw section boundary
      const polygon = new Polygon(
        section.points.map(([x, y]) => ({ x, y })),
        {
          fill: section.color + "15",
          stroke: section.color + "60",
          strokeWidth: 1,
          selectable: false,
          evented: false,
        }
      );
      canvas.add(polygon);

      // Section label
      const center = getPolygonCenter(section.points);
      const sectionLabel = new FabricText(section.name, {
        left: center.x,
        top: center.y - 15,
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

      // Draw individual seats
      for (const seat of section.seats) {
        const colors = getSeatColor(seat.id);
        const isSold = soldSeats.has(seat.id);
        const isHeldByOther = otherHeldSeats.has(seat.id);
        const isClickable = !isSold && !isHeldByOther;

        const circle = new Circle({
          left: seat.x - 8,
          top: seat.y - 8,
          radius: 8,
          fill: colors.fill,
          stroke: colors.stroke,
          strokeWidth: 1.5,
          selectable: false,
          evented: isClickable,
          hoverCursor: isClickable ? "pointer" : "not-allowed",
        });
        setObjData(circle, {
          seatId: seat.id,
          sectionId: section.id,
          label: seat.label,
        });

        canvas.add(circle);

        // Seat label on the dot
        const seatLabel = new FabricText(seat.label, {
          left: seat.x,
          top: seat.y,
          fontSize: 7,
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

    // Seat click handler
    canvas.on("mouse:down", (e) => {
      const data = getObjData(e.target);
      if (data?.seatId && onSeatClick) {
        onSeatClick(data.seatId, data.sectionId, data.label);
      }
    });

    // Seat hover
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
    <div className="border rounded-lg overflow-hidden bg-slate-50">
      <canvas ref={canvasRef} />
    </div>
  );
}

function getPolygonCenter(points: [number, number][]): { x: number; y: number } {
  const sumX = points.reduce((s, [x]) => s + x, 0);
  const sumY = points.reduce((s, [, y]) => s + y, 0);
  return { x: sumX / points.length, y: sumY / points.length };
}
