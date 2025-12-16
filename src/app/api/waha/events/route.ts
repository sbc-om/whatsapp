import { bus, getRecentEvents } from "@/lib/realtime";
import { ensureWahaWsBridgeStarted } from "@/lib/wahaWsBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sse(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function GET() {
  const encoder = new TextEncoder();

  // Optional: if self-hosted, ingest events directly from WAHA via WebSocket.
  // UI still consumes our SSE stream (no API key exposure).
  ensureWahaWsBridgeStarted();

  let closed = false;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let onEvent: ((evt: unknown) => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
          if (keepAlive) {
            clearInterval(keepAlive);
            keepAlive = null;
          }
          if (onEvent) {
            bus.off("event", onEvent);
            onEvent = null;
          }
        }
      };

      // Send a few recent events on connect.
      for (const evt of getRecentEvents().reverse()) {
        safeEnqueue(encoder.encode(sse(evt)));
      }

      onEvent = (evt: unknown) => {
        safeEnqueue(encoder.encode(sse(evt)));
      };

      bus.on("event", onEvent);

      keepAlive = setInterval(() => {
        safeEnqueue(encoder.encode(`: ping\n\n`));
      }, 25_000);
    },

    cancel() {
      closed = true;
      if (keepAlive) {
        clearInterval(keepAlive);
        keepAlive = null;
      }
      if (onEvent) {
        bus.off("event", onEvent);
        onEvent = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
