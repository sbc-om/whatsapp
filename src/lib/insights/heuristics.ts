import type { AppLocale } from "@/components/i18n/translations";
import type { ChatInsights, InsightChatInput, InsightLabel, MessageDirection, MessageInsights } from "./types";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

const LEXICON = {
  positive: [
    // EN
    "thank", "thanks", "great", "awesome", "perfect", "love", "amazing", "good", "ok", "okay",
    // FA
    "ممنون", "مرسی", "عالی", "خیلی خوب", "خوبه", "اوکی", "باشه", "دمت گرم", "حله",
    // AR
    "شكرا", "شكرًا", "تمام", "ممتاز", "رائع", "جميل", "موافق", "حسنا", "حسنًا",
    // Emojis
    "✅", "👍", "😍", "😃", "😊",
  ],
  negative: [
    // EN
    "angry", "bad", "terrible", "refund", "cancel", "unacceptable", "late", "delay", "problem", "issue",
    "not happy", "disappointed", "complaint", "scam", "fraud", "waste",
    // FA
    "ناراضی", "بد", "افتضاح", "لغو", "کنسل", "مرجوع", "بازگشت", "تاخیر", "تاخیر", "مشکل", "شکایت",
    "کلاهبرداری", "پولم", "پس", "نمیخوام", "نمی خوام",
    // AR
    "سيء", "سيئ", "تأخير", "تأخر", "مشكلة", "مشكل", "شكوى", "إلغاء", "الغاء", "استرجاع", "احتيال",
    "غير مقبول", "غير راض",
    // Emojis
    "❌", "👎", "😡", "😠", "😞", "😤",
  ],
  buying: [
    // EN
    "price", "cost", "how much", "buy", "order", "invoice", "discount", "deal", "subscription", "trial",
    // FA
    "قیمت", "هزینه", "چنده", "خرید", "سفارش", "فاکتور", "تخفیف", "اشتراک", "دمو",
    // AR
    "سعر", "كم", "شراء", "طلب", "فاتورة", "خصم", "اشتراك", "تجربة",
  ],
  churn: [
    // EN
    "stop", "leave", "unsubscribe", "never", "done", "switch", "not interested",
    // FA
    "دیگه", "ولش", "انصراف", "لغو", "نمیخوام", "بیخیال", "عوض",
    // AR
    "إلغاء", "الغاء", "توقف", "سأترك", "مش مهتم", "غير مهتم", "سأغادر",
  ],
} as const;

function scoreText(text: string) {
  const t = text.toLowerCase();

  const count = (arr: readonly string[]) =>
    arr.reduce((acc, w) => acc + (t.includes(w.toLowerCase()) ? 1 : 0), 0);

  const pos = count(LEXICON.positive);
  const neg = count(LEXICON.negative);
  const buy = count(LEXICON.buying);
  const churn = count(LEXICON.churn);

  const ex = (text.match(/!/g) ?? []).length;
  const q = (text.match(/\?/g) ?? []).length;

  // Base sentiment in [-1..1]
  let s = 0;
  s += pos * 0.22;
  s -= neg * 0.28;

  // Questions often indicate buying intent; tone depends on other signals.
  s += Math.min(2, q) * 0.04;

  // Exclamation amplifies whichever direction.
  if (ex > 0) s *= 1 + Math.min(2, ex) * 0.08;

  s = clamp(s, -1, 1);

  return {
    sentimentSigned: s,
    buyingSignals: buy,
    churnSignals: churn,
    posSignals: pos,
    negSignals: neg,
  };
}

function labelFromSigned(s: number): InsightLabel {
  if (s > 0.15) return "positive";
  if (s < -0.15) return "negative";
  return "neutral";
}

function toPct(n: number) {
  return Math.round(clamp(n, 0, 100));
}

function localeJoin(locale: AppLocale, parts: string[]) {
  if (parts.length === 0) return "";
  // Very small helper—keeps output readable for fa/ar.
  const sep = locale === "en" ? "; " : "، ";
  return parts.join(sep);
}

export function analyzeMessageHeuristic(
  message: { direction: MessageDirection; text: string },
  uiLocale: AppLocale,
): MessageInsights {
  const s = scoreText(message.text);
  const label = labelFromSigned(s.sentimentSigned);
  const sentiment = clamp((s.sentimentSigned + 1) / 2, 0, 1);

  // If there are no strong lexicon signals, treat it as neutral.
  // This avoids nonsense outputs for short/low-context messages like "hi".
  const totalSignals = s.buyingSignals + s.churnSignals + s.posSignals + s.negSignals;
  if (totalSignals === 0) {
    return {
      label: "neutral",
      sentiment,
      salesOpportunityPct: 0,
      churnRiskPct: 0,
      neutralPct: 100,
      primary: "neutral",
      keySignals: [],
    };
  }

  // Message-level mapping: keep it simple and responsive.
  let sales = 25 + sentiment * 55 + s.buyingSignals * 12 + s.posSignals * 4;
  let churn = 20 + (1 - sentiment) * 65 + s.churnSignals * 16 + s.negSignals * 8;

  sales = clamp(sales, 0, 95);
  churn = clamp(churn, 0, 95);

  const neutral = clamp(100 - sales - churn, 8, 85);
  const total = sales + churn + neutral;
  const salesPct = toPct((sales / total) * 100);
  const churnPct = toPct((churn / total) * 100);
  const neutralPct = toPct(100 - salesPct - churnPct);

  const primary: MessageInsights["primary"] =
    churnPct >= salesPct && churnPct >= neutralPct
      ? "churnRisk"
      : salesPct >= churnPct && salesPct >= neutralPct
        ? "salesOpportunity"
        : "neutral";

  const keySignalsArr: string[] = [];
  if (s.buyingSignals) keySignalsArr.push(uiLocale === "en" ? "Buying intent" : uiLocale === "fa" ? "قصد خرید" : "نية شراء");
  if (s.churnSignals) keySignalsArr.push(uiLocale === "en" ? "Churn language" : uiLocale === "fa" ? "انصراف/ترک" : "إلغاء/مغادرة");
  if (s.negSignals) keySignalsArr.push(uiLocale === "en" ? "Negative tone" : uiLocale === "fa" ? "لحن منفی" : "نبرة سلبية");
  if (s.posSignals) keySignalsArr.push(uiLocale === "en" ? "Positive tone" : uiLocale === "fa" ? "لحن مثبت" : "نبرة إيجابية");

  return {
    label,
    sentiment,
    salesOpportunityPct: salesPct,
    churnRiskPct: churnPct,
    neutralPct,
    primary,
    keySignals: keySignalsArr,
  };
}

export function analyzeChatHeuristic(chat: InsightChatInput, uiLocale: AppLocale): ChatInsights {
  const incoming = chat.messages.filter((m) => m.direction === "in");
  const outgoing = chat.messages.filter((m) => m.direction === "out");

  const scored = incoming.map((m) => ({ m, s: scoreText(m.text) }));

  // If no inbound messages, use all messages lightly.
  const base = scored.length ? scored : chat.messages.map((m) => ({ m, s: scoreText(m.text) }));

  const avgSigned =
    base.reduce((acc, x) => acc + x.s.sentimentSigned, 0) / Math.max(1, base.length);

  const label = labelFromSigned(avgSigned);

  const buyingSignals = base.reduce((acc, x) => acc + x.s.buyingSignals, 0);
  const churnSignals = base.reduce((acc, x) => acc + x.s.churnSignals, 0);
  const negSignals = base.reduce((acc, x) => acc + x.s.negSignals, 0);
  const posSignals = base.reduce((acc, x) => acc + x.s.posSignals, 0);

  // Convert signed sentiment [-1..1] to [0..1]
  const sentiment = clamp((avgSigned + 1) / 2, 0, 1);

  // Core mapping (professional-ish but deterministic)
  let sales = 30 + sentiment * 50 + buyingSignals * 6;
  let churn = 25 + (1 - sentiment) * 55 + churnSignals * 10 + negSignals * 6;

  // Outgoing shouldn't dominate churn; dampen churn if we already apologized or offered help.
  const agentSofteners = outgoing.some((m) =>
    /(sorry|apolog|refund|replace|help|support|حل|متاسف|ببخشید|پشتیبانی)/i.test(m.text),
  );
  if (agentSofteners) churn *= 0.9;

  // If positive signals dominate, bump sales.
  if (posSignals >= 2 && negSignals === 0) sales += 8;

  sales = clamp(sales, 0, 95);
  churn = clamp(churn, 0, 95);

  // Neutral is the remainder, but keep some floor.
  const neutral = clamp(100 - sales - churn, 5, 80);

  // Rebalance to 100
  const total = sales + churn + neutral;
  const salesPct = toPct((sales / total) * 100);
  const churnPct = toPct((churn / total) * 100);
  const neutralPct = toPct(100 - salesPct - churnPct);

  const keySignalsArr: string[] = [];
  if (buyingSignals) keySignalsArr.push(uiLocale === "en" ? "Buying intent detected" : uiLocale === "fa" ? "نشانه‌های قصد خرید" : "إشارات نية شراء");
  if (churnSignals) keySignalsArr.push(uiLocale === "en" ? "Churn / cancellation language" : uiLocale === "fa" ? "نشانه‌های انصراف/ترک" : "إشارات إلغاء/مغادرة");
  if (negSignals) keySignalsArr.push(uiLocale === "en" ? "Negative tone" : uiLocale === "fa" ? "لحن منفی" : "نبرة سلبية");
  if (posSignals) keySignalsArr.push(uiLocale === "en" ? "Positive tone" : uiLocale === "fa" ? "لحن مثبت" : "نبرة إيجابية");

  const nextBestActions: string[] = [];
  if (churnPct >= 55) {
    nextBestActions.push(
      uiLocale === "en"
        ? "Respond fast, acknowledge issue, offer clear resolution"
        : uiLocale === "fa"
          ? "سریع پاسخ بده، مشکل را تایید کن و راه‌حل روشن ارائه بده"
          : "رد بسرعة، اعترف بالمشكلة وقدّم حلاً واضحاً",
    );
  } else if (salesPct >= 55) {
    nextBestActions.push(
      uiLocale === "en"
        ? "Ask a closing question and propose next step (invoice / checkout)"
        : uiLocale === "fa"
          ? "یک سوال برای نهایی‌کردن بپرس و قدم بعدی (فاکتور/پرداخت) را پیشنهاد بده"
          : "اطرح سؤال إغلاق واقترح الخطوة التالية (فاتورة/دفع)",
    );
  } else {
    nextBestActions.push(
      uiLocale === "en"
        ? "Clarify needs (budget, timeline) and summarize options"
        : uiLocale === "fa"
          ? "نیازها (بودجه/زمان) را شفاف کن و گزینه‌ها را خلاصه کن"
          : "وضّح الاحتياج (الميزانية/الوقت) ولخّص الخيارات",
    );
  }

  const summary =
    uiLocale === "en"
      ? localeJoin(uiLocale, [
          label === "positive" ? "Overall positive" : label === "negative" ? "Overall negative" : "Overall neutral",
          salesPct >= churnPct ? `Sales opportunity ~${salesPct}%` : `Churn risk ~${churnPct}%`,
        ])
      : uiLocale === "fa"
        ? localeJoin(uiLocale, [
            label === "positive" ? "کلی مثبت" : label === "negative" ? "کلی منفی" : "کلی خنثی",
            salesPct >= churnPct ? `فرصت فروش حدود ${salesPct}%` : `ریسک خروج حدود ${churnPct}%`,
          ])
        : localeJoin(uiLocale, [
            label === "positive" ? "إيجابي إجمالاً" : label === "negative" ? "سلبي إجمالاً" : "محايد إجمالاً",
            salesPct >= churnPct ? `فرصة بيع تقريباً ${salesPct}%` : `خطر مغادرة تقريباً ${churnPct}%`,
          ]);

  return {
    chatId: chat.chatId,
    label,
    sentiment,
    salesOpportunityPct: salesPct,
    churnRiskPct: churnPct,
    neutralPct,
    summary,
    keySignals: keySignalsArr,
    nextBestActions,
  };
}

export function analyzeAllHeuristic(chats: InsightChatInput[], uiLocale: AppLocale) {
  return chats.map((c) => analyzeChatHeuristic(c, uiLocale));
}
