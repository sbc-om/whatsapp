"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import EmojiPanel from "@/components/emoji/EmojiPanel";
import { formatDayLabel, formatTime } from "./format";
import { mockChats, mockMessages } from "./mock";
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
import { useI18n } from "@/components/i18n/I18nProvider";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
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

export default function WhatsAppShell() {
  const { dir, intlLocale, t } = useI18n();

  const [chats, setChats] = useState<Chat[]>(() => [...mockChats].sort(sortChats));
  const [messages, setMessages] = useState<ChatMessage[]>(() => [...mockMessages]);
  const [activeChatId, setActiveChatId] = useState<string>(chats[0]?.id ?? "");

  const [mobilePane, setMobilePane] = useState<"list" | "chat">("list");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);

  const list = useMemo(() => {
    const q = query.trim();
    const base = [...chats].sort(sortChats);
    if (!q) return base;
    return base.filter((c) => c.title.includes(q) || c.lastMessagePreview.includes(q));
  }, [chats, query]);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId) ?? chats[0],
    [activeChatId, chats],
  );

  const activeMessages = useMemo(
    () => messages.filter((m) => m.chatId === activeChat?.id).sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime()),
    [activeChat?.id, messages],
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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

  const openChat = useCallback((id: string) => {
    setActiveChatId(id);
    setMobilePane("chat");
    setEmojiOpen(false);
    setChats((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)),
    );
  }, []);

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text || !activeChat) return;

    const msg: ChatMessage = {
      id: `m_${Math.random().toString(16).slice(2)}`,
      chatId: activeChat.id,
      direction: "out",
      text,
      sentAt: new Date(),
      status: "sent",
    };

    setMessages((prev) => [...prev, msg]);
    setDraft("");

    setChats((prev) => {
      const next = prev.map((c) =>
        c.id === activeChat.id
          ? {
              ...c,
              lastMessageAt: msg.sentAt,
              lastMessagePreview: msg.text,
              unreadCount: 0,
              presence: "online" as const,
            }
          : c,
      );
      return next;
    });

    // Simulate quick delivery/read to make the UI feel alive.
    window.setTimeout(() => {
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, status: "delivered" } : m)),
      );
    }, 650);

    window.setTimeout(() => {
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, status: "read" } : m)),
      );
    }, 1400);
  }, [activeChat, draft]);

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
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t("uiPrototype")}
                  </div>
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
                        {activeChat.presence === "typing"
                          ? t("typing")
                          : activeChat.presence === "online"
                            ? t("online")
                            : t("lastSeenRecently")}
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
                            <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                              <span>{formatTime(m.sentAt, intlLocale)}</span>
                              {m.direction === "out" ? (
                                <span className="-mr-0.5 text-zinc-500 dark:text-zinc-400">
                                  <StatusIcon status={m.status} />
                                </span>
                              ) : null}
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

              <div className="mx-auto mt-2 w-full max-w-3xl text-center text-[11px] text-zinc-400">
                {t("stageUiOnly")}
              </div>
            </footer>
          </section>
        </div>
      </div>

    </div>
  );
}
