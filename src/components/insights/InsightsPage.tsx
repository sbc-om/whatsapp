"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useI18n } from "@/components/i18n/I18nProvider";
import type { Chat, ChatMessage } from "@/components/whatsapp/types";
import type { WahaEventEnvelope } from "@/types/waha";
import { getMl5SentimentModel, ml5SentimentScore } from "@/lib/insights/ml5Sentiment";
import { ml5ScoresToChatDistribution } from "@/lib/insights/ml5Mapping";
import type { ChatInsights } from "@/lib/insights/types";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function Badge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-black/5 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:bg-white/10 dark:text-zinc-100">
      {label}
    </span>
  );
}

function Bar({ value, variant }: { value: number; variant: "green" | "red" | "neutral" }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <progress
      className={cn(
        "wa-progress",
        variant === "green"
          ? "wa-progress--green"
          : variant === "red"
            ? "wa-progress--red"
            : "wa-progress--neutral",
      )}
      value={v}
      max={100}
      aria-label={String(v)}
    />
  );
}

export default function InsightsPage() {
  const { t } = useI18n();

  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [ml5Analyzing, setMl5Analyzing] = useState(false);
  const [insights, setInsights] = useState<Map<string, ChatInsights>>(new Map());

  // Subscribe to WAHA SSE events for real-time message ingestion
  useEffect(() => {
    let isMounted = true;
    const evSource = new EventSource("/api/waha/events");

    evSource.onmessage = (evt) => {
      if (!isMounted) return;

      try {
        const envelope: WahaEventEnvelope = JSON.parse(evt.data);
        const type = envelope.event;
        if (type !== "message" && type !== "message.any") return;

        const payload = envelope.payload as Record<string, unknown> | null;
        if (!payload) return;

        const body = ((payload.body ?? "") as string).trim();
        if (!body) return;

        const from = (payload.from ?? "") as string;
        const chatId = from.replace(/@.*$/, "");
        const fullChatId = `waha:${chatId}`;
        const fromMe = (payload.fromMe ?? false) as boolean;

        setChats((prev) => {
          if (prev.find((c) => c.id === fullChatId)) return prev;
          const title = from.includes("@g.us") ? `Group ${chatId.slice(0, 10)}` : chatId.slice(0, 15);
          const newChat: Chat = {
            id: fullChatId,
            title,
            avatarBgClass: "bg-emerald-500",
            lastMessagePreview: body.slice(0, 40),
            lastMessageAt: new Date(),
            unreadCount: 0,
          };
          return [...prev, newChat];
        });

        const newMsg: ChatMessage = {
          id: `${fullChatId}:${Date.now()}`,
          chatId: fullChatId,
          text: body,
          direction: fromMe ? "out" : "in",
          sentAt: new Date(),
          status: "read",
        };

        setMessages((prev) => [...prev, newMsg]);
      } catch {
        // ignore parse errors
      }
    };

    return () => {
      isMounted = false;
      evSource.close();
    };
  }, []);

  // Real-time ml5 analysis for all messages
  useEffect(() => {
    if (messages.length === 0) return;

    let isMounted = true;

    async function analyze() {
      setMl5Analyzing(true);
      try {
        const newInsights = new Map<string, ChatInsights>();

        for (const chat of chats) {
          const chatMessages = messages.filter((m) => m.chatId === chat.id);
          const scores: number[] = [];

          for (const msg of chatMessages) {
            const score = await ml5SentimentScore(msg.text);
            if (score !== null) scores.push(score);
          }

          if (scores.length > 0) {
            const dist = ml5ScoresToChatDistribution(scores);
            newInsights.set(chat.id, {
              chatId: chat.id,
              salesOpportunityPct: dist.salesPct,
              churnRiskPct: dist.churnPct,
              neutralPct: dist.neutralPct,
              label: "ml5",
              summary: null,
              keySignals: null,
              nextBestActions: null,
            });
          }
        }

        if (isMounted) {
          setInsights(newInsights);
        }
      } finally {
        if (isMounted) {
          setMl5Analyzing(false);
        }
      }
    }

    analyze();

    return () => {
      isMounted = false;
    };
  }, [messages, chats]);

  const rows = useMemo(() => {
    return chats
      .map((c) => ({
        chat: c,
        insights: insights.get(c.id) ?? null,
      }))
      .sort((a, b) => {
        const as = a.insights?.churnRiskPct ?? 0;
        const bs = b.insights?.churnRiskPct ?? 0;
        return bs - as;
      });
  }, [chats, insights]);

  return (
    <div className="min-h-screen bg-(--wa-app-bg) px-4 py-8 text-zinc-900 dark:text-zinc-50">
      <div className="mx-auto w-full max-w-5xl">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">{t("insights")}</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {ml5Analyzing ? t("analyzing") : `ml5 • ${chats.length} chats • ${messages.length} messages`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="inline-flex h-10 items-center justify-center rounded-xl px-3 text-sm font-medium text-zinc-700 hover:bg-black/5 dark:text-zinc-200 dark:hover:bg-white/10"
            >
              {t("back")}
            </Link>
          </div>
        </header>

        <div className="mt-6 overflow-hidden rounded-2xl bg-(--wa-panel) shadow-(--wa-shadow) ring-1 ring-(--wa-border)">
          <div className="grid grid-cols-1 gap-0 divide-y divide-(--wa-border)">
            {rows.map(({ chat, insights }) => (
              <div key={chat.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold">{chat.title}</div>
                      {insights ? <Badge label={insights.label} /> : null}
                    </div>
                    {insights?.summary ? (
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{insights.summary}</div>
                    ) : null}
                  </div>

                  <div className="grid w-full max-w-xl gap-2">
                    <div className="grid grid-cols-3 gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <div>
                        {t("salesOpportunity")}: <span className="font-semibold text-zinc-700 dark:text-zinc-100">{insights?.salesOpportunityPct ?? 0}%</span>
                      </div>
                      <div>
                        {t("churnRisk")}: <span className="font-semibold text-zinc-700 dark:text-zinc-100">{insights?.churnRiskPct ?? 0}%</span>
                      </div>
                      <div>
                        {t("neutral")}: <span className="font-semibold text-zinc-700 dark:text-zinc-100">{insights?.neutralPct ?? 0}%</span>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Bar value={insights?.salesOpportunityPct ?? 0} variant="green" />
                      <Bar value={insights?.churnRiskPct ?? 0} variant="red" />
                      <Bar value={insights?.neutralPct ?? 0} variant="neutral" />
                    </div>

                    {insights?.keySignals?.length ? (
                      <ul className="mt-1 grid gap-1 text-xs text-zinc-600 dark:text-zinc-300">
                        {insights.keySignals.slice(0, 4).map((s, i) => (
                          <li key={i}>• {s}</li>
                        ))}
                      </ul>
                    ) : null}

                    {insights?.nextBestActions?.length ? (
                      <ul className="mt-2 grid gap-1 text-xs font-medium text-zinc-800 dark:text-zinc-100">
                        {insights.nextBestActions.slice(0, 3).map((s, i) => (
                          <li key={i}>→ {s}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="mx-auto mt-4 max-w-5xl text-[11px] text-zinc-500 dark:text-zinc-400">
          Real-time ml5 sentiment analysis. Percentages update automatically as new messages arrive via WAHA.
        </p>
      </div>
    </div>
  );
}
