import { EventEmitter } from "node:events";

import type { WahaEventEnvelope } from "@/types/waha";

export const bus = new EventEmitter();

// Avoid warnings in dev with multiple SSE clients.
bus.setMaxListeners(0);

const MAX_BUFFER = 200;
const buffer: WahaEventEnvelope[] = [];

export function pushEvent(evt: WahaEventEnvelope) {
  buffer.unshift(evt);
  if (buffer.length > MAX_BUFFER) buffer.pop();
  bus.emit("event", evt);
}

export function getRecentEvents() {
  return buffer.slice(0, 50);
}
