import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { migrateSeatingConfig } from "@/lib/migrate-seating-config";
import { clientIp, rateLimit } from "@/lib/ratelimit";

const HOLD_DURATION_MINUTES = 10;
// Backstop against one session holding an entire seat map. No legitimate single
// buyer reserves anywhere near this many seats.
const MAX_ACTIVE_HOLDS_PER_SESSION = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Hold keying convention: holds are keyed by config seat ID (NOT the seat label
// — labels are the keying for SOLD tickets). When the buyer has picked an
// occurrence, the client (useSeatHolds) composes the stored seat_id as
// `${occurrenceId}:${seatId}` so the (event_id, seat_id) unique constraint
// scopes holds per occurrence. Un-prefixed seat_ids are event-wide holds.
export async function POST(request: NextRequest) {
  try {
    const { eventId, seatId, sessionId, seatLabel, occurrenceId } =
      await request.json();

    if (!eventId || !seatId || !sessionId) {
      return NextResponse.json(
        { error: "Missing eventId, seatId, or sessionId" },
        { status: 400 }
      );
    }
    if (occurrenceId && !UUID_RE.test(occurrenceId)) {
      return NextResponse.json(
        { error: "Invalid occurrenceId" },
        { status: 400 }
      );
    }

    // Throttle holds per IP — an unauthenticated write that could otherwise be
    // spammed to lock up an event's inventory. 60 / minute is far above any
    // real buyer's selection/refresh rate.
    if (!(await rateLimit(`seathold:${clientIp(request)}`, 60, 60))) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        { status: 429 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Backstop: cap concurrent active holds per session (allow refresh of a seat
    // this session already holds, so a legit buyer at the cap isn't blocked).
    const { count: activeHolds } = await supabase
      .from("seat_holds")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .gt("expires_at", new Date().toISOString());
    if ((activeHolds ?? 0) >= MAX_ACTIVE_HOLDS_PER_SESSION) {
      const { data: ownThisSeat } = await supabase
        .from("seat_holds")
        .select("id")
        .eq("event_id", eventId)
        .eq("seat_id", seatId)
        .eq("session_id", sessionId)
        .maybeSingle();
      if (!ownThisSeat) {
        return NextResponse.json(
          { error: "Too many seats held. Release some before adding more." },
          { status: 429 }
        );
      }
    }

    // Clean up expired holds first
    const { error: rpcError } = await supabase.rpc("cleanup_expired_holds");
    if (rpcError) {
      // If the RPC doesn't exist yet, do manual cleanup
      await supabase
        .from("seat_holds")
        .delete()
        .lt("expires_at", new Date().toISOString());
    }

    // Check if the seat is already sold. Tickets store seat LABELS, so the
    // check uses seatLabel (the previous seatId-based check never matched).
    // Occurrence-scoped: tickets for OTHER occurrences don't block this one;
    // tickets with no occurrence_id are event-wide and block everything.
    if (seatLabel) {
      let soldQuery = supabase
        .from("tickets")
        .select("id")
        .eq("event_id", eventId)
        .eq("seat_label", seatLabel)
        .in("status", ["valid", "used"]);
      if (occurrenceId) {
        soldQuery = soldQuery.or(
          `occurrence_id.eq.${occurrenceId},occurrence_id.is.null`
        );
      }
      const { data: existingTicket } = await soldQuery.limit(1).maybeSingle();

      if (existingTicket) {
        return NextResponse.json(
          { error: "This seat has already been sold" },
          { status: 409 }
        );
      }
    }

    // Reject holds on seats inside a HIDDEN (issue-only) section — buyers can't
    // reserve them (the UI greys them out; this is the server backstop). The
    // stored seat_id is occurrence-composed (`${occurrenceId}:${configSeatId}`),
    // so strip any prefix before matching the config.
    {
      const rawSeatId = String(seatId).includes(":")
        ? String(seatId).split(":").pop()
        : String(seatId);
      const { data: ev } = await supabase
        .from("events")
        .select("seating_config")
        .eq("id", eventId)
        .maybeSingle();
      if (ev?.seating_config) {
        const migrated = migrateSeatingConfig(ev.seating_config);
        const hiddenSection = (migrated.sections || []).find(
          (s) =>
            s.is_hidden === true &&
            (s.seats || []).some(
              (st) => st.id === rawSeatId || st.label === seatLabel
            )
        );
        if (hiddenSection) {
          return NextResponse.json(
            { error: "This seat is not available for purchase" },
            { status: 400 }
          );
        }
      }
    }

    // Try to create the hold (UNIQUE constraint prevents double-holds)
    const expiresAt = new Date(
      Date.now() + HOLD_DURATION_MINUTES * 60 * 1000
    ).toISOString();

    const { data: hold, error } = await supabase
      .from("seat_holds")
      .insert({
        event_id: eventId,
        seat_id: seatId,
        session_id: sessionId,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (error) {
      // Unique constraint violation = a hold already exists for this seat.
      if (error.code === "23505") {
        // If *this* session already holds it, treat as success and refresh the
        // expiry — guards against double-fires, re-selects, and remounts.
        const { data: existingHold } = await supabase
          .from("seat_holds")
          .select("*")
          .eq("event_id", eventId)
          .eq("seat_id", seatId)
          .maybeSingle();

        if (existingHold && existingHold.session_id === sessionId) {
          const { data: refreshed } = await supabase
            .from("seat_holds")
            .update({ expires_at: expiresAt })
            .eq("id", existingHold.id)
            .select()
            .single();
          return NextResponse.json({ hold: refreshed ?? existingHold });
        }

        return NextResponse.json(
          { error: "This seat is currently held by another customer" },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ hold });
  } catch (err) {
    console.error("[Seat Holds API] POST error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { eventId, seatId, sessionId } = await request.json();

    if (!eventId || !seatId || !sessionId) {
      return NextResponse.json(
        { error: "Missing eventId, seatId, or sessionId" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from("seat_holds")
      .delete()
      .eq("event_id", eventId)
      .eq("seat_id", seatId)
      .eq("session_id", sessionId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ released: true });
  } catch (err) {
    console.error("[Seat Holds API] DELETE error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get("eventId");

    if (!eventId) {
      return NextResponse.json(
        { error: "Missing eventId parameter" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Clean up expired holds
    await supabase
      .from("seat_holds")
      .delete()
      .lt("expires_at", new Date().toISOString());

    const { data: holds, error } = await supabase
      .from("seat_holds")
      .select("*")
      .eq("event_id", eventId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ holds: holds || [] });
  } catch (err) {
    console.error("[Seat Holds API] GET error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
