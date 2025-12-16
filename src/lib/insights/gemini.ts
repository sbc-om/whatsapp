import { GoogleGenerativeAI } from "@google/generative-ai";

import type { AppLocale } from "@/components/i18n/translations";
import type { ChatInsights, InsightChatInput, InsightsResponse } from "./types";

function env(name: string) {
  return process.env[name];
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normalizePercent(n: unknown) {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(clamp(v, 0, 100));
}

function normalizeSentiment(n: unknown) {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0.5;
  return clamp(v, 0, 1);
}

function asRecord(x: unknown): Record<string, unknown> {
  return typeof x === "object" && x !== null ? (x as Record<string, unknown>) : {};
}

function readStringArray(v: unknown, limit: number) {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === "string").slice(0, limit);
}

function sanitizeChatInsights(x: unknown, chatId: string): ChatInsights {
  const o = asRecord(x);

  const sales = normalizePercent(o.salesOpportunityPct);
  const churn = normalizePercent(o.churnRiskPct);
  const neutral = normalizePercent(o.neutralPct);
  const sum = sales + churn + neutral;

  const labelRaw = o.label;
  const label: ChatInsights["label"] =
    labelRaw === "positive" || labelRaw === "negative" || labelRaw === "neutral" ? labelRaw : "neutral";
  const sentiment = normalizeSentiment(o.sentiment);

  // Ensure totals are ~100.
  const fixedSales = sum === 100 ? sales : normalizePercent((sales / Math.max(1, sum)) * 100);
  const fixedChurn = sum === 100 ? churn : normalizePercent((churn / Math.max(1, sum)) * 100);
  const fixedNeutral = clamp(100 - fixedSales - fixedChurn, 0, 100);

  return {
    chatId,
    label,
    sentiment,
    salesOpportunityPct: fixedSales,
    churnRiskPct: fixedChurn,
    neutralPct: fixedNeutral,
    summary: typeof o.summary === "string" ? o.summary : "",
    keySignals: readStringArray(o.keySignals, 8),
    nextBestActions: readStringArray(o.nextBestActions, 6),
  };
}

export async function analyzeWithGemini(
  chats: InsightChatInput[],
  uiLocale: AppLocale,
): Promise<InsightsResponse> {
  const apiKey = env("GEMINI_API_KEY");
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const modelName = env("GEMINI_MODEL") || "gemini-2.5-pro";

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  });

  const prompt = {
    role: "user" as const,
    parts: [
      {
        text: `You are a senior CRM analyst for a WhatsApp-style messaging inbox.

Goal: analyze each chat's overall sentiment and quantify:
- salesOpportunityPct (0..100)
- churnRiskPct (0..100)
- neutralPct (0..100)
These 3 must sum to 100.

Also return:
- label: one of "positive" | "neutral" | "negative"
- sentiment: number in [0..1] (0=negative, 1=positive)
- summary: a short executive summary (in the UI language)
- keySignals: 3-8 short bullets (in the UI language)
- nextBestActions: 2-6 short bullets (in the UI language)

Be robust for Persian (fa), Arabic (ar) and English. Use business judgment:
- Strong buying intent (pricing, invoice, order) increases salesOpportunity.
- Complaints, frustration, cancellation language increase churnRisk.
- Unclear or informational messages are neutral.

IMPORTANT:
- Output JSON ONLY.
- Follow this exact schema:
{
  "chats": [
    {
      "chatId": string,
      "label": "positive"|"neutral"|"negative",
      "sentiment": number,
      "salesOpportunityPct": number,
      "churnRiskPct": number,
      "neutralPct": number,
      "summary": string,
      "keySignals": string[],
      "nextBestActions": string[]
    }
  ]
}

UI language: ${uiLocale}.

Input chats:
${JSON.stringify(chats)}
`,
      },
    ],
  };

  const result = await model.generateContent({ contents: [prompt] });
  const text = result.response.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Some models may wrap JSON; attempt to extract.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      parsed = JSON.parse(text.slice(start, end + 1));
    } else {
      throw new Error("Gemini returned non-JSON output");
    }
  }

  const out: ChatInsights[] = [];
  const byId = new Map(chats.map((c) => [c.chatId, c] as const));

  const parsedRec = asRecord(parsed);
  const parsedChats = Array.isArray(parsedRec.chats) ? (parsedRec.chats as unknown[]) : [];

  for (const item of parsedChats) {
    const itemRec = asRecord(item);
    const chatId = typeof itemRec.chatId === "string" ? itemRec.chatId : "";
    if (!chatId || !byId.has(chatId)) continue;
    out.push(sanitizeChatInsights(itemRec, chatId));
  }

  // Ensure every input chat has an output.
  for (const c of chats) {
    if (!out.find((x) => x.chatId === c.chatId)) {
      out.push(
        sanitizeChatInsights(
          {
            chatId: c.chatId,
            label: "neutral",
            sentiment: 0.5,
            salesOpportunityPct: 33,
            churnRiskPct: 33,
            neutralPct: 34,
            summary: "",
            keySignals: [],
            nextBestActions: [],
          },
          c.chatId,
        ),
      );
    }
  }

  return {
    provider: "gemini",
    generatedAt: new Date().toISOString(),
    chats: out,
  };
}
