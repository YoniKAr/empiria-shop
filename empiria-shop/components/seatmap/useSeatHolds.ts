"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { SeatHold } from "@/lib/seatmap-types";

interface UseSeatHoldsOptions {
  eventId: string;
  sessionId: string;
}

interface UseSeatHoldsReturn {
  /** Seat IDs held by current session */
  myHeldSeats: Set<string>;
  /** Seat IDs held by other sessions */
  otherHeldSeats: Set<string>;
  /** All holds for the event */
  holds: SeatHold[];
  /** Hold a seat for the current session */
  holdSeat: (seatId: string) => Promise<{ success: boolean; error?: string }>;
  /** Release a held seat */
  releaseSeat: (seatId: string) => Promise<void>;
  /** Release all seats held by the current session */
  releaseAll: () => Promise<void>;
  /** Loading state */
  loading: boolean;
}

export function useSeatHolds({
  eventId,
  sessionId,
}: UseSeatHoldsOptions): UseSeatHoldsReturn {
  const [holds, setHolds] = useState<SeatHold[]>([]);
  const [loading, setLoading] = useState(true);
  const holdsRef = useRef<SeatHold[]>([]);

  // Keep ref in sync for unmount cleanup
  useEffect(() => {
    holdsRef.current = holds;
  }, [holds]);

  // Fetch existing holds on mount
  useEffect(() => {
    async function fetchHolds() {
      setLoading(true);
      try {
        const res = await fetch(`/api/seat-holds?eventId=${eventId}`);
        const data = await res.json();
        if (data.holds) {
          setHolds(data.holds);
        }
      } catch (err) {
        console.error("Failed to fetch seat holds:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchHolds();
  }, [eventId]);

  // Subscribe to SSE stream for realtime updates
  useEffect(() => {
    const es = new EventSource(
      `/api/seat-holds/stream?eventId=${encodeURIComponent(eventId)}`
    );

    es.addEventListener("INSERT", (e) => {
      const newHold = JSON.parse(e.data) as SeatHold;
      setHolds((prev) => {
        if (prev.some((h) => h.id === newHold.id)) return prev;
        return [...prev, newHold];
      });
    });

    es.addEventListener("DELETE", (e) => {
      const oldHold = JSON.parse(e.data) as { id: string };
      setHolds((prev) => prev.filter((h) => h.id !== oldHold.id));
    });

    return () => {
      es.close();
    };
  }, [eventId]);

  // Release all holds on unmount
  useEffect(() => {
    return () => {
      const myHolds = holdsRef.current.filter(
        (h) => h.session_id === sessionId
      );
      for (const hold of myHolds) {
        fetch("/api/seat-holds", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId,
            seatId: hold.seat_id,
            sessionId,
          }),
        }).catch(() => {});
      }
    };
    // Only run on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const holdSeat = useCallback(
    async (seatId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/seat-holds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, seatId, sessionId }),
        });

        const data = await res.json();

        if (!res.ok) {
          return { success: false, error: data.error || "Failed to hold seat" };
        }

        // Optimistic update — SSE will confirm
        if (data.hold) {
          setHolds((prev) => {
            if (prev.some((h) => h.seat_id === seatId)) return prev;
            return [...prev, data.hold];
          });
        }

        return { success: true };
      } catch {
        return { success: false, error: "Network error" };
      }
    },
    [eventId, sessionId]
  );

  const releaseSeat = useCallback(
    async (seatId: string) => {
      try {
        await fetch("/api/seat-holds", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, seatId, sessionId }),
        });

        // Optimistic update
        setHolds((prev) =>
          prev.filter(
            (h) => !(h.seat_id === seatId && h.session_id === sessionId)
          )
        );
      } catch (err) {
        console.error("Failed to release seat:", err);
      }
    },
    [eventId, sessionId]
  );

  const releaseAll = useCallback(async () => {
    const myHolds = holds.filter((h) => h.session_id === sessionId);
    await Promise.all(myHolds.map((h) => releaseSeat(h.seat_id)));
  }, [holds, sessionId, releaseSeat]);

  const myHeldSeats = new Set(
    holds.filter((h) => h.session_id === sessionId).map((h) => h.seat_id)
  );

  const otherHeldSeats = new Set(
    holds.filter((h) => h.session_id !== sessionId).map((h) => h.seat_id)
  );

  return {
    myHeldSeats,
    otherHeldSeats,
    holds,
    holdSeat,
    releaseSeat,
    releaseAll,
    loading,
  };
}
