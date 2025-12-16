import type { AppLocale } from "@/components/i18n/translations";

export type MessageDirection = "in" | "out";

export type InsightMessage = {
  direction: MessageDirection;
  text: string;
  sentAt?: string;
};

export type InsightChatInput = {
  chatId: string;
  title: string;
  messages: InsightMessage[];
};

export type InsightLabel = "positive" | "neutral" | "negative";

export type MessageInsightPrimary = "salesOpportunity" | "churnRisk" | "neutral";

export type MessageInsights = {
  label: InsightLabel;
  /** 0..1 (negative..positive) */
  sentiment: number;
  /** 0..100 */
  salesOpportunityPct: number;
  /** 0..100 */
  churnRiskPct: number;
  /** 0..100 */
  neutralPct: number;
  primary: MessageInsightPrimary;
  keySignals: string[];
};

export type ChatInsights = {
  chatId: string;
  label: InsightLabel | "ml5";
  /** 0..1 (negative..positive) */
  sentiment?: number;
  /** 0..100 */
  salesOpportunityPct: number;
  /** 0..100 */
  churnRiskPct: number;
  /** 0..100 */
  neutralPct: number;
  summary: string | null;
  keySignals: string[] | null;
  nextBestActions: string[] | null;
};

export type InsightsRequest = {
  uiLocale: AppLocale;
  chats: InsightChatInput[];
};

export type InsightsResponse = {
  provider: "gemini" | "heuristic";
  generatedAt: string;
  chats: ChatInsights[];
};
