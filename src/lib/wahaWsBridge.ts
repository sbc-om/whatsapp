import WebSocket from "ws";

import { pushEvent } from "@/lib/realtime";
import type { WahaEventEnvelope } from "@/types/waha";

const WAHA_API_URL = process.env.WAHA_API_URL ?? "http://localhost:3000";
const WAHA_API_KEY = process.env.WAHA_API_KEY ?? "";
const WAHA_WS_URL = process.env.WAHA_WS_URL;
const WAHA_WS_SESSION = process.env.WAHA_WS_SESSION;

type BridgeState = {
  started: boolean;
  ws: WebSocket | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  pingTimer: ReturnType<typeof setInterval> | null;
  backoffMs: number;
};

declare global {
  var __wahaWsBridge: BridgeState | undefined;
}

function getState(): BridgeState {
  if (!globalThis.__wahaWsBridge) {
    globalThis.__wahaWsBridge = {
      started: false,
      ws: null,
      reconnectTimer: null,
      pingTimer: null,
      backoffMs: 500,
    };
  }
  return globalThis.__wahaWsBridge;
}

function deriveWsUrl(): string {
  if (WAHA_WS_URL && WAHA_WS_URL.trim()) {
    // If WAHA_WS_URL is provided, use it as-is but add API key if needed
    const url = new URL(WAHA_WS_URL.trim());
    if (WAHA_API_KEY && !url.searchParams.has('x-api-key')) {
      url.searchParams.set('x-api-key', WAHA_API_KEY);
    }
    return url.toString();
  }

  // Convert http(s)://host[:port] -> ws(s)://host[:port]/ws
  const httpUrl = new URL(WAHA_API_URL);
  const protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = new URL(`${protocol}//${httpUrl.host}/ws`);

  // Add API key in query parameter (WAHA requires this)
  if (WAHA_API_KEY) {
    wsUrl.searchParams.set('x-api-key', WAHA_API_KEY);
  }

  // Add session parameter (or * for all sessions)
  const session = WAHA_WS_SESSION && WAHA_WS_SESSION.trim() ? WAHA_WS_SESSION.trim() : '*';
  wsUrl.searchParams.set('session', session);

  // Add events parameter (listen to all events)
  wsUrl.searchParams.append('events', '*');

  return wsUrl.toString();
}

function asEnvelope(data: unknown): WahaEventEnvelope | null {
  if (!data || typeof data !== "object") return null;

  const obj = data as Record<string, unknown>;

  // If it already looks like our envelope, accept it.
  if (typeof obj.id === "string" && typeof obj.timestamp === "number" && "payload" in obj) {
    return {
      id: obj.id,
      timestamp: obj.timestamp,
      event: typeof obj.event === "string" ? obj.event : undefined,
      session: typeof obj.session === "string" ? obj.session : undefined,
      payload: obj.payload,
      metadata: typeof obj.metadata === "object" && obj.metadata ? (obj.metadata as Record<string, unknown>) : undefined,
    };
  }

  // Otherwise wrap it.
  return {
    id: `ws_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    timestamp: Date.now(),
    event: typeof obj.event === "string" ? obj.event : "ws",
    session: typeof obj.session === "string" ? obj.session : undefined,
    payload: obj.payload ?? obj,
    metadata: { source: "waha-ws" },
  };
}

function cleanupTimers(state: BridgeState) {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  if (state.pingTimer) {
    clearInterval(state.pingTimer);
    state.pingTimer = null;
  }
}

function scheduleReconnect(state: BridgeState) {
  if (!state.started) return;
  if (state.reconnectTimer) return;

  const wait = state.backoffMs;
  state.backoffMs = Math.min(state.backoffMs * 2, 30_000);

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connect(state);
  }, wait);
}

function connect(state: BridgeState) {
  cleanupTimers(state);

  if (state.ws) {
    try {
      state.ws.terminate();
    } catch {
      // ignore
    }
    state.ws = null;
  }

  const url = deriveWsUrl();
  
  console.log('🔌 Connecting to WAHA WebSocket:', url.replace(/x-api-key=[^&]+/, 'x-api-key=***'));

  // WAHA WebSocket doesn't need headers, API key is in query param
  const ws = new WebSocket(url);

  state.ws = ws;

  ws.on("open", () => {
    state.backoffMs = 500;
    console.log('✅ WAHA WebSocket connected successfully!');

    // Some servers require client pings to keep the connection alive.
    state.pingTimer = setInterval(() => {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      } catch {
        // ignore
      }
    }, 25_000);
  });

  ws.on("message", (raw) => {
    let parsed: unknown;
    try {
      const text = typeof raw === "string" ? raw : raw.toString("utf-8");
      parsed = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      return;
    }

    if (Array.isArray(parsed)) {
      console.log(`📦 Received ${parsed.length} events from WAHA WebSocket`);
      for (const item of parsed) {
        const env = asEnvelope(item);
        if (env) pushEvent(env);
      }
      return;
    }

    const env = asEnvelope(parsed);
    if (env) {
      console.log('📨 WebSocket event:', env.event || 'unknown', 'ID:', env.id);
      
      // Skip duplicate events: WAHA sends both 'message.any' and 'message' for each message
      // We only process 'message' to avoid duplicates
      if (env.event === 'message.any') {
        console.log('⏭️  Skipping message.any (duplicate of message event)');
        return;
      }
      
      console.log('✅ Pushing event to EventBus');
      pushEvent(env);
    }
  });

  ws.on("close", (code, reason) => {
    console.log(`🔌 WAHA WebSocket closed: ${code} ${reason.toString()}`);
    cleanupTimers(state);
    scheduleReconnect(state);
  });

  ws.on("error", (err) => {
    console.error('❌ WAHA WebSocket error:', err.message);
    // Close will trigger reconnect.
  });
}

/**
 * Starts a singleton WS connection to WAHA (server-side) and forwards events to the in-memory bus.
 *
 * Intended for self-hosted deployments. On serverless platforms, long-lived WS connections are not reliable.
 */
export function ensureWahaWsBridgeStarted() {
  const state = getState();
  if (state.started) return;

  state.started = true;
  connect(state);
}

export function getWahaWsBridgeStatus() {
  const state = getState();
  return {
    started: state.started,
    connected: state.ws?.readyState === WebSocket.OPEN,
    url: WAHA_WS_URL?.trim() || deriveWsUrl(),
  };
}
