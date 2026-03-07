import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

const HOLD_DURATION_MINUTES = 10;

export async function POST(request: NextRequest) {
  try {
    const { eventId, seatId, sessionId } = await request.json();

    if (!eventId || !seatId || !sessionId) {
      return NextResponse.json(
        { error: "Missing eventId, seatId, or sessionId" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Clean up expired holds first
    await supabase.rpc("cleanup_expired_holds").catch(() => {
      // If the RPC doesn't exist yet, do manual cleanup
      return supabase
        .from("seat_holds")
        .delete()
        .lt("expires_at", new Date().toISOString());
    });

    // Check if seat is already sold (ticket with this seat_label exists)
    const { data: existingTicket } = await supabase
      .from("tickets")
      .select("id")
      .eq("event_id", eventId)
      .eq("seat_label", seatId)
      .eq("status", "valid")
      .limit(1)
      .maybeSingle();

    if (existingTicket) {
      return NextResponse.json(
        { error: "This seat has already been sold" },
        { status: 409 }
      );
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
      // Unique constraint violation = seat already held
      if (error.code === "23505") {
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
