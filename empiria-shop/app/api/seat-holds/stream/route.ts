import { getSupabaseAdmin } from "@/lib/supabase";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("eventId");

  if (!eventId) {
    return new Response("Missing eventId parameter", { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function send(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      }

      // Send initial event so the client knows the connection is live
      send("connected", { eventId });

      // Heartbeat every 30s to keep connection alive through proxies
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      const channel = supabase
        .channel(`seat-holds-sse-${eventId}-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "seat_holds",
            filter: `event_id=eq.${eventId}`,
          },
          (payload) => {
            try {
              send("INSERT", payload.new);
            } catch {
              // Stream already closed
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "seat_holds",
            filter: `event_id=eq.${eventId}`,
          },
          (payload) => {
            try {
              send("DELETE", payload.old);
            } catch {
              // Stream already closed
            }
          }
        )
        .subscribe();

      // Clean up on client disconnect
      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        supabase.removeChannel(channel);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
