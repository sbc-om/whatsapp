import type { Chat, ChatMessage } from "./types";

function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}`;
}

export function createOutgoingMessage(args: {
  chatId: string;
  text: string;
  now?: Date;
}): ChatMessage {
  return {
    id: makeId("m"),
    chatId: args.chatId,
    direction: "out",
    text: args.text,
    sentAt: args.now ?? new Date(),
    status: "sent",
  };
}

export function updateChatsOnNewMessage(chats: Chat[], msg: ChatMessage): Chat[] {
  return chats.map((c) =>
    c.id === msg.chatId
      ? {
          ...c,
          lastMessageAt: msg.sentAt,
          lastMessagePreview: msg.text,
          // On outbound messages, we consider the chat "seen" on our side.
          unreadCount: msg.direction === "out" ? 0 : c.unreadCount,
          presence: "online" as const,
        }
      : c,
  );
}

export function clearChatUnread(chats: Chat[], chatId: string): Chat[] {
  return chats.map((c) => (c.id === chatId ? { ...c, unreadCount: 0 } : c));
}

export function setMessageStatus(
  messages: ChatMessage[],
  messageId: string,
  status: ChatMessage["status"],
): ChatMessage[] {
  return messages.map((m) => (m.id === messageId ? { ...m, status } : m));
}

export function scheduleOutgoingStatusSimulation(args: {
  messageId: string;
  onStatus: (status: NonNullable<ChatMessage["status"]>) => void;
}): void {
  // Simulate quick delivery/read to make the UI feel alive.
  window.setTimeout(() => args.onStatus("delivered"), 650);
  window.setTimeout(() => args.onStatus("read"), 1400);
}
