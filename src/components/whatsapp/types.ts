export type Presence = "online" | "typing" | "offline";

export type ChatMessage = {
  id: string;
  chatId: string;
  direction: "in" | "out";
  text: string;
  sentAt: Date;
  status?: "sent" | "delivered" | "read";
};

export type Chat = {
  id: string;
  title: string;
  avatarBgClass: string; // Tailwind class (e.g. "bg-emerald-500")
  lastMessagePreview: string;
  lastMessageAt: Date;
  unreadCount: number;
  pinned?: boolean;
  muted?: boolean;
  presence?: Presence;
};
