import { NextResponse } from "next/server";

import { analyzeAllHeuristic } from "@/lib/insights/heuristics";
import { analyzeWithGemini } from "@/lib/insights/gemini";
import type { InsightsRequest, InsightsResponse } from "@/lib/insights/types";

export const runtime = "nodejs";

function isValidBody(body: unknown): body is InsightsRequest {
  if (typeof body !== "object" || body === null) return false;
  const b = body as { uiLocale?: unknown; chats?: unknown };
  const uiLocaleOk = b.uiLocale === "en" || b.uiLocale === "fa" || b.uiLocale === "ar";
  return uiLocaleOk && Array.isArray(b.chats);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!isValidBody(body)) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { chats, uiLocale } = body;

  // Prefer Gemini when configured; otherwise fall back to deterministic heuristics.
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);

  let payload: InsightsResponse;
  if (hasGemini) {
    try {
      payload = await analyzeWithGemini(chats, uiLocale);
    } catch {
      payload = {
        provider: "heuristic",
        generatedAt: new Date().toISOString(),
        chats: analyzeAllHeuristic(chats, uiLocale),
      };
    }
  } else {
    payload = {
      provider: "heuristic",
      generatedAt: new Date().toISOString(),
      chats: analyzeAllHeuristic(chats, uiLocale),
    };
  }

  return NextResponse.json(payload);
}
