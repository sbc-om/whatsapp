import { NextResponse } from "next/server";

import { getWahaWsBridgeStatus } from "@/lib/wahaWsBridge";

export const runtime = "nodejs";

export async function GET() {
  const apiUrl = process.env.WAHA_API_URL ?? "";
  const hasApiKey = Boolean(process.env.WAHA_API_KEY);
  const webhookTokenSet = Boolean(process.env.WAHA_WEBHOOK_TOKEN);
  const ws = getWahaWsBridgeStatus();

  return NextResponse.json({
    ok: true,
    apiUrl,
    hasApiKey,
    webhookTokenSet,
    ws,
  });
}
