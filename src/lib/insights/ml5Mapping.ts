import type { AppLocale } from "@/components/i18n/translations";
import type { MessageInsights } from "./types";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function labelFromScore(score: number): MessageInsights["label"] {
  // score is 0..1
  if (score > 0.58) return "positive";
  if (score < 0.42) return "negative";
  return "neutral";
}

function normalizeText(s: string) {
  return s.trim().toLowerCase();
}

function isLowSignal(text: string) {
  const t = normalizeText(text);
  if (!t) return true;
  // Very short messages ("hi", "ok", "؟") shouldn't get risk/opportunity labels.
  if (t.length <= 3) return true;

  // Common greetings / acknowledgements.
  if (/^(hi|hello|hey|ok|okay|kk|k|yo|سلام|درود|مرسی|ممنون|اوکی|باشه|تمام|شكرا|شكرًا|تم|تمام)$/.test(t)) {
    return true;
  }

  // Only punctuation/emojis.
  if (/^[\p{P}\p{S}\s]+$/u.test(text)) return true;

  return false;
}

export function ml5ScoreToMessageInsights(
  score: number,
  text: string,
  uiLocale: AppLocale,
): MessageInsights | null {
  const s = clamp(score, 0, 1);
  if (isLowSignal(text)) return null;

  // Neutrality is based on closeness to 0.5.
  const delta = clamp(Math.abs(s - 0.5) * 2, 0, 1); // 0..1
  const neutralPct = Math.round((1 - delta) * 100);

  // If it's mostly neutral, don't show anything.
  if (neutralPct >= 72) return null;

  const remaining = 100 - neutralPct;
  const salesOpportunityPct = s >= 0.5 ? remaining : 0;
  const churnRiskPct = s < 0.5 ? remaining : 0;

  const primary: MessageInsights["primary"] =
    salesOpportunityPct > churnRiskPct
      ? "salesOpportunity"
      : churnRiskPct > salesOpportunityPct
        ? "churnRisk"
        : "neutral";

  const keySignals: string[] = [];
  const lbl = labelFromScore(s);
  if (lbl === "positive") {
    keySignals.push(uiLocale === "en" ? "Positive sentiment" : uiLocale === "fa" ? "حس مثبت" : "مشاعر إيجابية");
  } else if (lbl === "negative") {
    keySignals.push(uiLocale === "en" ? "Negative sentiment" : uiLocale === "fa" ? "حس منفی" : "مشاعر سلبية");
  }

  return {
    label: lbl,
    sentiment: s,
    salesOpportunityPct,
    churnRiskPct,
    neutralPct,
    primary,
    keySignals,
  };
}

export function ml5ScoresToChatDistribution(scores: number[]) {
  if (!scores.length) {
    return { avg: 0.5, neutralPct: 100, salesPct: 0, churnPct: 0 };
  }

  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const delta = clamp(Math.abs(avg - 0.5) * 2, 0, 1);
  const neutralPct = Math.round((1 - delta) * 100);
  const remaining = 100 - neutralPct;

  const salesPct = avg >= 0.5 ? remaining : 0;
  const churnPct = avg < 0.5 ? remaining : 0;

  return { avg, neutralPct, salesPct, churnPct };
}
