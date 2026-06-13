"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { SeatHold } from "@/lib/seatmap-types";

interface UseSeatHoldsOptions {
  eventId: string;
  sessionId: string;
  /** When set, holds are stored occurrence-scoped: the DB seat_id becomes
   *  `${occurrenceId}:${seatId}` so the (event_id, seat_id) unique constraint
   *  only blocks the same seat for the SAME occurrence. Un-prefixed holds are
   *  event-wide and block every occurrence. */
  occurrenceId?: string;
}

interface UseSeatHoldsReturn {
  /** Raw config seat IDs held by current session (current occurrence scope) */
  myHeldSeats: Set<string>;
  /** Raw config seat IDs held by other sessions (current occurrence scope) */
  otherHeldSeats: Set<string>;
  /** All holds for the event (seat_id may be occurrence-composed) */
  holds: SeatHold[];
  /** Hold a seat for the current session. Pass the seat LABEL so the server
   *  can run its sold-check against tickets (tickets store labels). */
  holdSeat: (
    seatId: string,
    seatLabel?: string
  ) => Promise<{ success: boolean; error?: string }>;
  /** Release a held seat (raw config seat ID) */
  releaseSeat: (seatId: string) => Promise<void>;
  /** Release all seats held by the current session (any occurrence) */
  releaseAll: () => Promise<void>;
  /** Stop the pagehide/unmount auto-release — call right before navigating to
   *  Stripe so the holds survive the payment redirect (SHOP-1c). */
  suppressRelease: () => void;
  /** Loading state */
  loading: boolean;
}

export function useSeatHolds({
  eventId,
  sessionId,
  occurrenceId,
}: UseSeatHoldsOptions): UseSeatHoldsReturn {
  const [holds, setHolds] = useState<SeatHold[]>([]);
  const [loading, setLoading] = useState(true);
  const holdsRef = useRef<SeatHold[]>([]);
  // When true, pagehide/unmount do NOT release this session's holds — set just
  // before the checkout redirect to Stripe so the seats stay protected while
  // the customer pays. Tab close / back-nav without checkout still releases.
  const suppressReleaseRef = useRef(false);

  // Occurrence-scoped seat_id composition (see UseSeatHoldsOptions docs).
  const compose = useCallback(
    (seatId: string) => (occurrenceId ? `${occurrenceId}:${seatId}` : seatId),
    [occurrenceId]
  );
  // A stored seat_id is in the current scope when it's event-wide (no prefix)
  // or prefixed with the currently selected occurrence. Holds for OTHER
  // occurrences don't block this one.
  const inScope = useCallback(
    (storedSeatId: string) => {
      const idx = storedSeatId.indexOf(":");
      if (idx === -1) return true;
      return !!occurrenceId && storedSeatId.startsWith(`${occurrenceId}:`);
    },
    [occurrenceId]
  );
  const toRawSeatId = useCallback((storedSeatId: string) => {
    const idx = storedSeatId.indexOf(":");
    return idx === -1 ? storedSeatId : storedSeatId.slice(idx + 1);
  }, []);

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

  // Release all my holds on unmount AND on page hide (tab close / refresh /
  // navigation away) — the unmount cleanup alone misses those, leaving ghost
  // holds that block the same person on retry. `keepalive` lets the request
  // survive the page teardown. Suppressed when the teardown IS the checkout
  // redirect to Stripe (suppressRelease) — releasing then would expose the
  // seats to double-sell during payment.
  useEffect(() => {
    const releaseMine = () => {
      if (suppressReleaseRef.current) return;
      const myHolds = holdsRef.current.filter(
        (h) => h.session_id === sessionId
      );
      for (const hold of myHolds) {
        // hold.seat_id is the STORED id (possibly occurrence-composed) — send
        // it as-is, never re-compose.
        fetch("/api/seat-holds", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, seatId: hold.seat_id, sessionId }),
          keepalive: true,
        }).catch(() => {});
      }
    };

    window.addEventListener("pagehide", releaseMine);
    return () => {
      window.removeEventListener("pagehide", releaseMine);
      releaseMine();
    };
    // Only run on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const holdSeat = useCallback(
    async (
      seatId: string,
      seatLabel?: string
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/seat-holds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId,
            seatId: compose(seatId),
            sessionId,
            seatLabel,
            occurrenceId,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          return { success: false, error: data.error || "Failed to hold seat" };
        }

        // Optimistic update — SSE will confirm
        if (data.hold) {
          setHolds((prev) => {
            if (prev.some((h) => h.seat_id === data.hold.seat_id)) return prev;
            return [...prev, data.hold];
          });
        }

        return { success: true };
      } catch {
        return { success: false, error: "Network error" };
      }
    },
    [eventId, sessionId, occurrenceId, compose]
  );

  // Internal: delete by the STORED seat_id (already composed when applicable).
  const releaseStored = useCallback(
    async (storedSeatId: string) => {
      try {
        await fetch("/api/seat-holds", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, seatId: storedSeatId, sessionId }),
        });

        // Optimistic update
        setHolds((prev) =>
          prev.filter(
            (h) => !(h.seat_id === storedSeatId && h.session_id === sessionId)
          )
        );
      } catch (err) {
        console.error("Failed to release seat:", err);
      }
    },
    [eventId, sessionId]
  );

  const releaseSeat = useCallback(
    async (seatId: string) => {
      await releaseStored(compose(seatId));
    },
    [releaseStored, compose]
  );

  const releaseAll = useCallback(async () => {
    const myHolds = holdsRef.current.filter((h) => h.session_id === sessionId);
    await Promise.all(myHolds.map((h) => releaseStored(h.seat_id)));
  }, [sessionId, releaseStored]);

  const suppressRelease = useCallback(() => {
    suppressReleaseRef.current = true;
  }, []);

  const myHeldSeats = new Set(
    holds
      .filter((h) => h.session_id === sessionId && inScope(h.seat_id))
      .map((h) => toRawSeatId(h.seat_id))
  );

  const otherHeldSeats = new Set(
    holds
      .filter((h) => h.session_id !== sessionId && inScope(h.seat_id))
      .map((h) => toRawSeatId(h.seat_id))
  );

  return {
    myHeldSeats,
    otherHeldSeats,
    holds,
    holdSeat,
    releaseSeat,
    releaseAll,
    suppressRelease,
    loading,
  };
}
