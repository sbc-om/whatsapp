import type { Chat, ChatMessage } from "./types";

const now = Date.now();

export const mockChats: Chat[] = [
  {
    id: "c1",
    title: "تیم محصول",
    avatarBgClass: "bg-emerald-500",
    lastMessagePreview: "نسخه‌ی UI رو تا عصر آماده می‌کنم.",
    lastMessageAt: new Date(now - 2 * 60_000),
    unreadCount: 2,
    pinned: true,
    presence: "typing",
  },
  {
    id: "c2",
    title: "Milad",
    avatarBgClass: "bg-sky-500",
    lastMessagePreview: "اوکی، فردا دیپلوی می‌کنیم.",
    lastMessageAt: new Date(now - 38 * 60_000),
    unreadCount: 0,
    presence: "online",
  },
  {
    id: "c3",
    title: "پشتیبانی",
    avatarBgClass: "bg-orange-500",
    lastMessagePreview: "برای شماره‌ی جدید نیاز به تایید داریم.",
    lastMessageAt: new Date(now - 3.5 * 60 * 60_000),
    unreadCount: 5,
    muted: true,
    presence: "offline",
  },
  {
    id: "c4",
    title: "گروه خانواده",
    avatarBgClass: "bg-purple-500",
    lastMessagePreview: "عکس‌ها رسید، مرسی!",
    lastMessageAt: new Date(now - 26 * 60 * 60_000),
    unreadCount: 0,
    presence: "offline",
  },
];

export const mockMessages: ChatMessage[] = [
  {
    id: "m1",
    chatId: "c1",
    direction: "in",
    text: "سلام! می‌تونی UI رو شبیه واتس‌اپ وب دربیاری؟ با تم سبز و حرفه‌ای.",
    sentAt: new Date(now - 22 * 60_000),
  },
  {
    id: "m2",
    chatId: "c1",
    direction: "out",
    text: "حتماً. یک شِل حرفه‌ای با لیست چت‌ها، پیام‌ها و کامپوزر آماده می‌کنم.",
    sentAt: new Date(now - 18 * 60_000),
    status: "read",
  },
  {
    id: "m3",
    chatId: "c1",
    direction: "in",
    text: "فقط فعلاً UI باشه. API مرحله بعد.",
    sentAt: new Date(now - 12 * 60_000),
  },
  {
    id: "m4",
    chatId: "c1",
    direction: "out",
    text: "اوکی. حالت ریسپانسیو و دارک‌مود هم در نظر می‌گیرم.",
    sentAt: new Date(now - 9 * 60_000),
    status: "delivered",
  },
  {
    id: "m5",
    chatId: "c2",
    direction: "in",
    text: "بیا برای مرحله بعد هم ساختار سرویس پیام رو تمیز کنیم.",
    sentAt: new Date(now - 42 * 60_000),
  },
  {
    id: "m6",
    chatId: "c2",
    direction: "out",
    text: "حتماً. الان فقط UI رو می‌بندیم.",
    sentAt: new Date(now - 40 * 60_000),
    status: "read",
  },
  {
    id: "m7",
    chatId: "c3",
    direction: "in",
    text: "لطفاً وضعیت تحویل پیام‌ها هم در UI نمایش داده بشه.",
    sentAt: new Date(now - 4 * 60 * 60_000),
  },
  {
    id: "m8",
    chatId: "c4",
    direction: "in",
    text: "امشب شام چی داریم؟",
    sentAt: new Date(now - 26.3 * 60 * 60_000),
  },
];
