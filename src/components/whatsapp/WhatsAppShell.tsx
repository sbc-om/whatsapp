"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import EmojiPanel from "@/components/emoji/EmojiPanel";
import { useI18n } from "@/components/i18n/I18nProvider";
import { getMl5SentimentModel } from "@/lib/insights/ml5Sentiment";
import { ml5ScoreToMessageInsights, ml5ScoresToChatDistribution } from "@/lib/insights/ml5Mapping";
import type { ChatInsights, InsightsRequest, InsightsResponse, MessageInsights } from "@/lib/insights/types";
import { formatDayLabel, formatTime } from "./format";
import { readWahaUiSettings, WAHA_UI_SETTINGS_KEY } from "@/lib/wahaUiSettings";
import {
  clearChatUnread,
  createOutgoingMessage,
  scheduleOutgoingStatusSimulation,
  setMessageStatus,
  updateChatsOnNewMessage,
} from "./messageService";
import {
  IconArrowBack,
  IconCheck,
  IconCheckDouble,
  IconClip,
  IconDots,
  IconEmoji,
  IconMic,
  IconNewChat,
  IconSearch,
  IconSend,
} from "./icons";
import type { Chat, ChatMessage } from "./types";
import type { WahaEventEnvelope } from "@/types/waha";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function hashToBgClass(input: string) {
  const colors = [
    "bg-emerald-500",
    "bg-sky-500",
    "bg-orange-500",
    "bg-purple-500",
    "bg-rose-500",
    "bg-amber-500",
    "bg-teal-500",
    "bg-indigo-500",
  ];
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return colors[h % colors.length] ?? "bg-emerald-500";
}

function formatChatTitle(rawChatId: string): string {
  // Remove @c.us suffix from WhatsApp chat IDs to show clean phone numbers
  return rawChatId.replace(/@c\.us$/i, '');
}

function parseWahaMessagePayload(payload: unknown): {
  chatId?: string;
  body?: string;
  fromMe?: boolean;
  contactName?: string;
} {
  if (typeof payload !== "object" || !payload) return {};
  const p = payload as Record<string, unknown>;

  const fromMe = typeof p.fromMe === "boolean" ? p.fromMe : undefined;

  // For outgoing messages (fromMe=true), use 'to' (recipient)
  // For incoming messages (fromMe=false), use 'from' (sender)
  const chatId =
    typeof p.chatId === "string"
      ? p.chatId
      : fromMe
        ? typeof p.to === "string"
          ? p.to
          : undefined
        : typeof p.from === "string"
          ? p.from
          : undefined;

  const body =
    typeof p.body === "string"
      ? p.body
      : typeof p.text === "string"
        ? p.text
        : typeof p.caption === "string"
          ? p.caption
          : undefined;

  // Extract contact name from various possible fields
  let contactName: string | undefined;
  if (typeof p._data === "object" && p._data) {
    const data = p._data as Record<string, unknown>;
    if (typeof data.notifyName === "string" && data.notifyName) {
      contactName = data.notifyName;
    } else if (typeof data.pushName === "string" && data.pushName) {
      contactName = data.pushName;
    }
  }
  if (!contactName && typeof p.name === "string" && p.name) {
    contactName = p.name;
  }

  return { chatId, body, fromMe, contactName };
}

function sortChats(a: Chat, b: Chat) {
  const ap = a.pinned ? 1 : 0;
  const bp = b.pinned ? 1 : 0;
  if (ap !== bp) return bp - ap;
  return b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
}

function Avatar({ title, bgClass }: { title: string; bgClass: string }) {
  const initials = title
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <div
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-full text-xs font-semibold text-white",
        bgClass,
      )}
      aria-hidden="true"
    >
      {initials || "W"}
    </div>
  );
}

function StatusIcon({ status }: { status?: ChatMessage["status"] }) {
  if (!status || status === "sent") return <IconCheck className="size-4" />;
  if (status === "delivered") return <IconCheckDouble className="size-4" />;
  return <IconCheckDouble className="size-4 text-sky-500" />;
}

function PresencePill({
  presence,
  labels,
}: {
  presence?: Chat["presence"];
  labels: { typing: string; online: string };
}) {
  if (!presence) return null;

  const label =
    presence === "typing" ? labels.typing : presence === "online" ? labels.online : "";

  if (!label) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        presence === "typing"
          ? "bg-[color-mix(in_oklab,var(--wa-green)_14%,transparent)] text-(--wa-green-dark)"
          : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
      )}
    >
      {label}
    </span>
  );
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

function MessageInsightPill({
  label,
  value,
  variant,
  title,
}: {
  label: string;
  value: number;
  variant: "green" | "red" | "neutral";
  title?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        variant === "green"
          ? "bg-[color-mix(in_oklab,var(--wa-green)_14%,transparent)] text-(--wa-green-dark)"
          : variant === "red"
            ? "bg-[color-mix(in_oklab,rgba(244,63,94,0.85)_14%,transparent)] text-rose-700 dark:text-rose-200"
            : "bg-black/5 text-zinc-700 dark:bg-white/10 dark:text-zinc-200",
      )}
      title={title}
    >
      <span className="truncate">
        {label} {value}%
      </span>
    </span>
  );
}

export default function WhatsAppShell() {
  const { dir, intlLocale, t, locale } = useI18n();

  // Start empty: this screen should be driven by real WAHA events.
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeChatId, setActiveChatId] = useState<string>("");

  const [mobilePane, setMobilePane] = useState<"list" | "chat">("list");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);

  const [wahaUiSettings, setWahaUiSettings] = useState(() => readWahaUiSettings());

  // Keep session in sync if user changes it in Settings (localStorage).
  useEffect(() => {
    const sync = () => setWahaUiSettings(readWahaUiSettings());
    sync();

    const onStorage = (e: StorageEvent) => {
      if (e.key === WAHA_UI_SETTINGS_KEY) sync();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const [remoteChatInsights, setRemoteChatInsights] = useState<ChatInsights | null>(null);
  const [remoteProvider, setRemoteProvider] = useState<InsightsResponse["provider"] | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  const [ml5Analyzing, setMl5Analyzing] = useState(false);
  const [ml5ChatInsights, setMl5ChatInsights] = useState<ChatInsights | null>(null);
  const [ml5MessageInsights, setMl5MessageInsights] = useState<Map<string, MessageInsights | null>>(
    () => new Map(),
  );

  const list = useMemo(() => {
    const q = query.trim();
    const base = [...chats].sort(sortChats);
    if (!q) return base;
    return base.filter((c) => c.title.includes(q) || c.lastMessagePreview.includes(q));
  }, [chats, query]);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId) ?? null,
    [activeChatId, chats],
  );

  const activeMessages = useMemo(
    () =>
      messages
        .filter((m) => (activeChat ? m.chatId === activeChat.id : false))
        .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime()),
    [activeChat, messages],
  );

  const activeMessagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    activeMessagesRef.current = activeMessages;
  }, [activeMessages]);

  // Instant analysis via ml5 (client-side). Hide UI while ml5 is running.
  const ml5CacheRef = useRef<Map<string, MessageInsights | null>>(new Map());
  useEffect(() => {
    if (!activeChat) return;

    let cancelled = false;
    setMl5Analyzing(true);

    (async () => {
      const model = await getMl5SentimentModel();

      const nextById = new Map<string, MessageInsights | null>();
      const scores: number[] = [];

      for (const m of activeMessages.slice(-80)) {
        const cacheKey = `${m.id}:${m.text}`;
        const cached = ml5CacheRef.current.get(cacheKey);
        if (cached !== undefined) {
          nextById.set(m.id, cached);
          if (cached) scores.push(cached.sentiment);
          continue;
        }

        const r = model.predict(m.text);
        const score = typeof r?.score === "number" ? r.score : 0.5;
        const ins = ml5ScoreToMessageInsights(score, m.text, locale);
        ml5CacheRef.current.set(cacheKey, ins);
        nextById.set(m.id, ins);
        if (ins) scores.push(ins.sentiment);
      }

      const dist = ml5ScoresToChatDistribution(scores);
      const chat: ChatInsights = {
        chatId: activeChat.id,
        label: dist.avg > 0.58 ? "positive" : dist.avg < 0.42 ? "negative" : "neutral",
        sentiment: dist.avg,
        salesOpportunityPct: dist.salesPct,
        churnRiskPct: dist.churnPct,
        neutralPct: dist.neutralPct,
        summary: "",
        keySignals: [],
        nextBestActions: [],
      };

      if (cancelled) return;
      setMl5MessageInsights(nextById);
      setMl5ChatInsights(chat);
    })()
      .catch(() => {
        if (cancelled) return;
        setMl5MessageInsights(new Map());
        setMl5ChatInsights(null);
      })
      .finally(() => {
        if (cancelled) return;
        setMl5Analyzing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeChat, activeMessages, locale]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // WAHA realtime (SSE)
  useEffect(() => {
    const es = new EventSource("/api/waha/events");

    es.onmessage = (ev) => {
      try {
        const raw = JSON.parse(ev.data) as WahaEventEnvelope;
        console.log('🔵 UI received event:', raw.event, 'ID:', raw.id);
        
        const { chatId, body, fromMe, contactName } = parseWahaMessagePayload(raw.payload);
        if (!chatId || !body) {
          console.log('⚠️ Skipping event - no chatId or body');
          return;
        }

        const internalChatId = `waha:${chatId}`;
        const sentAt = new Date(typeof raw.timestamp === "number" ? raw.timestamp : Date.now());
        const phoneNumber = formatChatTitle(chatId);

        const msg: ChatMessage = {
          id: `w_${raw.id || Math.random().toString(16).slice(2)}`,
          chatId: internalChatId,
          direction: fromMe ? "out" : "in",
          text: body,
          sentAt,
          status: fromMe ? "delivered" : undefined,
        };

        console.log('📝 Creating message:', msg.id, 'text:', body, 'fromMe:', fromMe, 'contactName:', contactName);

        setMessages((prev) => {
          // De-dupe by id
          if (prev.some((m) => m.id === msg.id)) {
            console.log('🔄 Duplicate message detected, skipping:', msg.id);
            return prev;
          }
          console.log('✅ Adding new message:', msg.id);
          return [...prev, msg];
        });

        setChats((prev) => {
          const exists = prev.some((c) => c.id === internalChatId);
          const nextChat: Chat = exists
            ? (prev.find((c) => c.id === internalChatId) as Chat)
            : {
                id: internalChatId,
                // For outgoing messages (fromMe=true), contactName is sender (you), so use phoneNumber
                // For incoming messages (fromMe=false), contactName is the sender's name
                title: (!fromMe && contactName) ? contactName : phoneNumber,
                phoneNumber: phoneNumber,
                avatarBgClass: hashToBgClass(chatId),
                lastMessagePreview: "",
                lastMessageAt: sentAt,
                unreadCount: 0,
                presence: "online" as const,
              };

          // Use functional update to get current activeChatId without adding it as dependency
          const unreadBump = fromMe ? 0 : 1;
          const updated: Chat = {
            ...nextChat,
            lastMessageAt: sentAt,
            lastMessagePreview: body,
            unreadCount: Math.max(0, (nextChat.unreadCount ?? 0) + unreadBump),
            presence: fromMe ? "online" : "online",
          };

          const without = prev.filter((c) => c.id !== internalChatId);
          return [updated, ...without];
        });

        // Auto-open the first chat we ever receive.
        setActiveChatId((curr) => (curr ? curr : internalChatId));
      } catch {
        // ignore
      }
    };

    return () => es.close();
  }, []); // Empty dependency array - only run once on mount

  const runChatInsights = useCallback(
    async (signal?: AbortSignal) => {
      if (!activeChat) return;

      const latest = activeMessagesRef.current;
      const payload: InsightsRequest = {
        uiLocale: locale,
        chats: [
          {
            chatId: activeChat.id,
            title: activeChat.title,
            messages: latest.slice(-80).map((m) => ({
              direction: m.direction,
              text: m.text,
              sentAt: m.sentAt.toISOString(),
            })),
          },
        ],
      };

      setInsightsLoading(true);
      try {
        const res = await fetch("/api/insights/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal,
        });
        const json = (await res.json()) as InsightsResponse;
        setRemoteProvider(json.provider);
        setRemoteChatInsights(json.chats[0] ?? null);
      } catch {
        setRemoteProvider(null);
        setRemoteChatInsights(null);
      } finally {
        setInsightsLoading(false);
      }
    },
    [activeChat, locale],
  );

  const insertEmoji = useCallback(
    (emoji: string) => {
      const el = textareaRef.current;
      const start = el?.selectionStart ?? draft.length;
      const end = el?.selectionEnd ?? draft.length;
      const next = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`;
      setDraft(next);

      requestAnimationFrame(() => {
        const nextEl = textareaRef.current;
        if (!nextEl) return;
        nextEl.focus();
        const caret = start + emoji.length;
        nextEl.setSelectionRange(caret, caret);
      });
    },
    [draft],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [activeChat?.id, activeMessages.length]);

  // Reset Gemini insights when switching chats/locales; run only on button click.
  useEffect(() => {
    setRemoteChatInsights(null);
    setRemoteProvider(null);
  }, [activeChatId, locale]);

  const openChat = useCallback((id: string) => {
    setActiveChatId(id);
    setMobilePane("chat");
    setEmojiOpen(false);
    setChats((prev) => clearChatUnread(prev, id));
  }, []);

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text || !activeChat) return;

    const isWaha = activeChat.id.startsWith("waha:");
    if (!isWaha) {
      // Fallback (kept for future non-WAHA sources)
      const msg = createOutgoingMessage({ chatId: activeChat.id, text });
      setMessages((prev) => [...prev, msg]);
      setDraft("");
      setChats((prev) => updateChatsOnNewMessage(prev, msg));
      scheduleOutgoingStatusSimulation({
        messageId: msg.id,
        onStatus: (status) => setMessages((prev) => setMessageStatus(prev, msg.id, status)),
      });
      return;
    }

    const rawChatId = activeChat.id.slice("waha:".length);

    // Optimistic UI message
    const optimistic: ChatMessage = {
      id: `local_${Math.random().toString(16).slice(2)}`,
      chatId: activeChat.id,
      direction: "out",
      text,
      sentAt: new Date(),
      status: "sent",
    };

    setMessages((prev) => [...prev, optimistic]);
    setChats((prev) => updateChatsOnNewMessage(prev, optimistic));
    setDraft("");

    void fetch("/api/waha/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "text",
        chatId: rawChatId,
        text,
        session: wahaUiSettings.session,
      }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("send_failed");
        return r.json();
      })
      .then(() => {
        setMessages((prev) => setMessageStatus(prev, optimistic.id, "delivered"));
      })
      .catch(() => {
        // If send fails, keep message but mark as sent (no extra UI yet)
        setMessages((prev) => setMessageStatus(prev, optimistic.id, "sent"));
      });
  }, [activeChat, draft, wahaUiSettings.session]);

  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; items: ChatMessage[] }> = [];
    let currentKey: string | null = null;

    for (const m of activeMessages) {
      const key = new Date(m.sentAt);
      key.setHours(0, 0, 0, 0);
      const k = String(key.getTime());

      if (k !== currentKey) {
        currentKey = k;
        out.push({
          key: k,
          label: formatDayLabel(m.sentAt, intlLocale, {
            today: t("today"),
            yesterday: t("yesterday"),
          }),
          items: [m],
        });
      } else {
        out[out.length - 1]?.items.push(m);
      }
    }

    return out;
  }, [activeMessages, intlLocale, t]);

  const chatInsights = remoteChatInsights ?? ml5ChatInsights;

  return (
    <div className="relative h-dvh min-h-screen bg-(--wa-app-bg) text-zinc-900 dark:text-zinc-50">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-(--wa-green-dark)" />

      <div className="relative mx-auto flex h-full max-w-screen-2xl px-0 py-0 md:px-6 md:py-6">
        <div className="flex h-full w-full overflow-hidden bg-(--wa-panel) shadow-(--wa-shadow) ring-1 ring-(--wa-border) md:rounded-2xl">
          {/* Left: chat list */}
          <section
            className={cn(
              "w-full border-r border-(--wa-border) bg-(--wa-panel) md:w-105",
              mobilePane === "chat" ? "hidden md:flex" : "flex",
              "flex-col",
            )}
            aria-label="Chats"
          >
            <header className="flex items-center justify-between gap-3 border-b border-(--wa-border) px-4 py-3 wa-elevated">
              <div className="flex items-center gap-3">
                <Avatar title="Milad" bgClass="bg-(--wa-green-dark)" />
                <div className="leading-tight">
                  <div className="text-sm font-semibold">{t("appTitle")}</div>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="inline-flex size-10 items-center justify-center rounded-xl text-zinc-600 hover:bg-black/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                  aria-label={t("newChat")}
                >
                  <IconNewChat className="size-5" />
                </button>
                <Link
                  href="/insights"
                  className="inline-flex size-10 items-center justify-center rounded-xl text-zinc-600 hover:bg-black/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                  aria-label={t("insights")}
                  title={t("insights")}
                >
                  <span className="text-sm font-semibold">AI</span>
                </Link>
                <Link
                  href="/settings"
                  className="inline-flex size-10 items-center justify-center rounded-xl text-zinc-600 hover:bg-black/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                  aria-label={t("openSettings")}
                >
                  <IconDots className="size-5" />
                </Link>
              </div>
            </header>

            <div className="p-3">
              <div className="relative">
                <IconSearch
                  className={cn(
                    "pointer-events-none absolute top-1/2 size-5 -translate-y-1/2 text-zinc-400",
                    dir === "rtl" ? "right-3" : "left-3",
                  )}
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("searchChats")}
                  className={cn(
                    "h-11 w-full rounded-2xl border border-(--wa-border) bg-(--wa-panel-elev) text-sm outline-none ring-(--wa-green)/30 focus:ring-4",
                    dir === "rtl" ? "pr-4 pl-11" : "pl-11 pr-4",
                  )}
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              <ul className="space-y-1">
                {list.map((c) => {
                  const isActive = c.id === activeChat?.id;

                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => openChat(c.id)}
                        className={cn(
                          "group flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left",
                          isActive
                            ? "bg-[color-mix(in_oklab,var(--wa-green)_12%,white)] dark:bg-[color-mix(in_oklab,var(--wa-green)_16%,black)]"
                            : "hover:bg-black/5 dark:hover:bg-white/10",
                        )}
                      >
                        <Avatar title={c.title} bgClass={c.avatarBgClass} />

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">
                                {c.title}
                              </div>
                              {c.phoneNumber && (
                                <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                                  {c.phoneNumber}
                                </div>
                              )}
                              <div className="mt-0.5 flex items-center gap-2">
                                <PresencePill
                                  presence={c.presence}
                                  labels={{ typing: t("typing"), online: t("online") }}
                                />
                              </div>
                            </div>
                            <div className="shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">
                              {formatTime(c.lastMessageAt, intlLocale)}
                            </div>
                          </div>

                          <div className="mt-1 flex items-center justify-between gap-3">
                            <div className="min-w-0 truncate text-xs text-zinc-500 dark:text-zinc-400">
                              {c.lastMessagePreview}
                            </div>

                            <div className="flex shrink-0 items-center gap-2">
                              {c.muted ? (
                                <span className="text-[10px] text-zinc-400" aria-label="Muted">
                                  {t("muted")}
                                </span>
                              ) : null}
                              {c.unreadCount > 0 ? (
                                <span className="grid min-w-6 place-items-center rounded-full bg-(--wa-green) px-2 py-0.5 text-[11px] font-semibold text-white">
                                  {c.unreadCount}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          {/* Right: chat */}
          <section
            className={cn(
              "flex min-w-0 flex-1 flex-col",
              mobilePane === "list" ? "hidden md:flex" : "flex",
            )}
            aria-label="Active chat"
          >
            <header className="flex items-center justify-between gap-3 border-b border-(--wa-border) px-4 py-3 wa-elevated">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMobilePane("list")}
                  className="inline-flex size-10 items-center justify-center rounded-xl text-zinc-600 hover:bg-black/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white md:hidden"
                  aria-label={t("back")}
                >
                  <IconArrowBack className="size-5" />
                </button>

                {activeChat ? (
                  <>
                    <Avatar title={activeChat.title} bgClass={activeChat.avatarBgClass} />
                    <div className="leading-tight">
                      <div className="text-sm font-semibold">{activeChat.title}</div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {activeChat.phoneNumber ? (
                          <div>{activeChat.phoneNumber}</div>
                        ) : activeChat.presence === "typing" ? (
                          t("typing")
                        ) : activeChat.presence === "online" ? (
                          t("online")
                        ) : (
                          t("lastSeenRecently")
                        )}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="inline-flex size-10 items-center justify-center rounded-xl text-zinc-600 hover:bg-black/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                  aria-label={t("search")}
                >
                  <IconSearch className="size-5" />
                </button>
                <Link
                  href="/settings"
                  className="inline-flex size-10 items-center justify-center rounded-xl text-zinc-600 hover:bg-black/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                  aria-label={t("openSettings")}
                >
                  <IconDots className="size-5" />
                </Link>
              </div>
            </header>

            <div className="wa-chat-surface relative min-h-0 flex-1 overflow-y-auto" ref={scrollRef}>
              <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
                {activeChat && chatInsights && !insightsLoading && !ml5Analyzing ? (
                  <div className="overflow-hidden rounded-2xl bg-(--wa-panel) shadow-sm ring-1 ring-(--wa-border)">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--wa-border) px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold">{t("insights")}</div>
                        <Badge label={remoteProvider ? "Online AI" : "Local AI"} />
                      </div>
                      <button
                        type="button"
                        onClick={insightsLoading ? undefined : () => runChatInsights()}
                        disabled={insightsLoading}
                        className="inline-flex h-9 items-center justify-center rounded-xl px-3 text-sm font-medium text-zinc-700 hover:bg-black/5 dark:text-zinc-200 dark:hover:bg-white/10"
                        aria-label={t("analyze")}
                      >
                        {t("analyze")}
                      </button>
                    </div>

                    <div className="grid gap-3 px-4 py-3">
                      {chatInsights.summary ? (
                        <div className="text-xs text-zinc-600 dark:text-zinc-300">{chatInsights.summary}</div>
                      ) : null}

                      <div className="grid grid-cols-3 gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                        <div>
                          {t("salesOpportunity")}: <span className="font-semibold text-zinc-700 dark:text-zinc-100">{chatInsights.salesOpportunityPct}%</span>
                        </div>
                        <div>
                          {t("churnRisk")}: <span className="font-semibold text-zinc-700 dark:text-zinc-100">{chatInsights.churnRiskPct}%</span>
                        </div>
                        <div>
                          {t("neutral")}: <span className="font-semibold text-zinc-700 dark:text-zinc-100">{chatInsights.neutralPct}%</span>
                        </div>
                      </div>

                      <div className="grid gap-2">
                        <Bar value={chatInsights.salesOpportunityPct} variant="green" />
                        <Bar value={chatInsights.churnRiskPct} variant="red" />
                        <Bar value={chatInsights.neutralPct} variant="neutral" />
                      </div>
                    </div>
                  </div>
                ) : null}

                {groups.length === 0 ? (
                  <div className="mt-20 text-center text-sm text-zinc-500 dark:text-zinc-400">
                    {t("selectAChat")}
                  </div>
                ) : null}

                {groups.map((g) => (
                  <div key={g.key} className="space-y-3">
                    <div className="sticky top-2 z-10 flex justify-center">
                      <span className="rounded-full bg-black/10 px-3 py-1 text-xs text-zinc-700 backdrop-blur dark:bg-white/10 dark:text-zinc-200">
                        {g.label}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {g.items.map((m) => (
                        <div
                          key={m.id}
                          className={cn(
                            "flex",
                            m.direction === "out" ? "justify-end" : "justify-start",
                          )}
                        >
                          <div
                            className={cn(
                              "relative max-w-[78%] rounded-2xl px-3 py-2 text-sm leading-7 shadow-sm ring-1 ring-(--wa-border)",
                              m.direction === "out"
                                ? "bg-(--wa-bubble-out)"
                                : "bg-(--wa-bubble-in)",
                            )}
                          >
                            <div className="whitespace-pre-wrap">{m.text}</div>
                            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                              <div className="min-w-0">
                                {(() => {
                                  if (insightsLoading || ml5Analyzing) return null;
                                  const ins = ml5MessageInsights.get(m.id);
                                  if (!ins) return null;
                                  const primaryLabel =
                                    ins.primary === "salesOpportunity"
                                      ? t("salesOpportunity")
                                      : ins.primary === "churnRisk"
                                        ? t("churnRisk")
                                        : t("neutral");
                                  const primaryValue =
                                    ins.primary === "salesOpportunity"
                                      ? ins.salesOpportunityPct
                                      : ins.primary === "churnRisk"
                                        ? ins.churnRiskPct
                                        : ins.neutralPct;
                                  const variant =
                                    ins.primary === "salesOpportunity"
                                      ? "green"
                                      : ins.primary === "churnRisk"
                                        ? "red"
                                        : "neutral";

                                  // For per-message UI, don't show mostly-neutral pills.
                                  if (ins.primary === "neutral") return null;

                                  return (
                                    <MessageInsightPill
                                      label={primaryLabel}
                                      value={primaryValue}
                                      variant={variant}
                                      title={ins.keySignals.join(" • ")}
                                    />
                                  );
                                })()}
                              </div>

                              <div className="flex shrink-0 items-center justify-end gap-1">
                                <span>{formatTime(m.sentAt, intlLocale)}</span>
                                {m.direction === "out" ? (
                                  <span className="-mr-0.5 text-zinc-500 dark:text-zinc-400">
                                    <StatusIcon status={m.status} />
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <footer className="border-t border-(--wa-border) wa-elevated px-3 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
              <div className="mx-auto w-full max-w-3xl">
                <div className="relative flex items-end gap-2">
                  {emojiOpen ? (
                    <EmojiPanel
                      open
                      onClose={() => setEmojiOpen(false)}
                      onSelectEmoji={insertEmoji}
                    />
                  ) : null}

                  <button
                    type="button"
                    className="inline-flex size-11 items-center justify-center rounded-2xl text-zinc-600 hover:bg-black/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                    aria-label={t("emoji")}
                    aria-haspopup="dialog"
                    data-expanded={emojiOpen ? "true" : "false"}
                    onClick={() => setEmojiOpen((v) => !v)}
                  >
                    <IconEmoji className="size-5" />
                  </button>

                  <button
                    type="button"
                    className="hidden size-11 items-center justify-center rounded-2xl text-zinc-600 hover:bg-black/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white sm:inline-flex"
                    aria-label={t("attach")}
                  >
                    <IconClip className="size-5" />
                  </button>

                  <div className="flex min-w-0 flex-1 items-end rounded-2xl border border-(--wa-border) bg-(--wa-panel) px-3 py-2 shadow-sm focus-within:ring-4 focus-within:ring-(--wa-green)/20">
                    <textarea
                      ref={textareaRef}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={t("typeMessage")}
                      rows={1}
                      className="max-h-32 w-full resize-none bg-transparent text-sm leading-7 outline-none"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          send();
                        }
                      }}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={draft.trim() ? send : undefined}
                    className={cn(
                      "inline-flex size-11 items-center justify-center rounded-2xl",
                      draft.trim()
                        ? "bg-(--wa-green) text-white shadow-sm hover:brightness-[.98]"
                        : "text-zinc-600 hover:bg-black/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white",
                    )}
                    aria-label={draft.trim() ? t("send") : t("recordVoice")}
                  >
                    {draft.trim() ? <IconSend className="size-5" /> : <IconMic className="size-5" />}
                  </button>
                </div>
              </div>
            </footer>
          </section>
        </div>
      </div>

    </div>
  );
}
