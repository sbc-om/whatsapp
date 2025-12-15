export type AppLocale = "en" | "fa" | "ar";

export const localeInfo: Record<
  AppLocale,
  {
    label: string;
    dir: "ltr" | "rtl";
    intlLocale: string;
  }
> = {
  en: { label: "English", dir: "ltr", intlLocale: "en-US" },
  fa: { label: "فارسی", dir: "rtl", intlLocale: "fa-IR" },
  ar: { label: "العربية", dir: "rtl", intlLocale: "ar" },
};

type Keys =
  | "appTitle"
  | "uiPrototype"
  | "searchChats"
  | "muted"
  | "online"
  | "typing"
  | "lastSeenRecently"
  | "selectAChat"
  | "typeMessage"
  | "stageUiOnly"
  | "newChat"
  | "menu"
  | "search"
  | "back"
  | "close"
  | "emoji"
  | "attach"
  | "send"
  | "recordVoice"
  | "settings"
  | "openSettings"
  | "settingsTabsLanguage"
  | "settingsTabsAppearance"
  | "settingsTabsApi"
  | "language"
  | "appearance"
  | "theme"
  | "themeSystem"
  | "themeLight"
  | "themeDark"
  | "apiConnection"
  | "apiBaseUrl"
  | "apiKey"
  | "save"
  | "saved"
  | "reset"
  | "apiSettingsNote"
  | "today"
  | "yesterday";

export type I18nDict = Record<Keys, string>;

export const translations: Record<AppLocale, I18nDict> = {
  en: {
    appTitle: "WhatsApp",
    uiPrototype: "UI Prototype",
    searchChats: "Search chats",
    muted: "Muted",
    online: "Online",
    typing: "Typing…",
    lastSeenRecently: "Last seen recently",
    selectAChat: "Select a chat",
    typeMessage: "Type a message",
    stageUiOnly: "Current stage: UI only — WhatsApp API comes next.",
    newChat: "New chat",
    menu: "Menu",
    search: "Search",
    back: "Back",
    close: "Close",
    emoji: "Emoji",
    attach: "Attach",
    send: "Send",
    recordVoice: "Record voice",
    settings: "Settings",
    openSettings: "Open settings",
    settingsTabsLanguage: "Language",
    settingsTabsAppearance: "Appearance",
    settingsTabsApi: "API connection",
    language: "Language",
    appearance: "Appearance",
    theme: "Theme",
    themeSystem: "System",
    themeLight: "Light",
    themeDark: "Dark",
    apiConnection: "API connection",
    apiBaseUrl: "API base URL",
    apiKey: "API key",
    save: "Save",
    saved: "Saved",
    reset: "Reset",
    apiSettingsNote: "UI only for now — these values are stored locally and not used yet.",
    today: "Today",
    yesterday: "Yesterday",
  },
  fa: {
    appTitle: "واتس‌اپ",
    uiPrototype: "نمونه رابط کاربری",
    searchChats: "جستجو در چت‌ها",
    muted: "بی‌صدا",
    online: "آنلاین",
    typing: "در حال نوشتن…",
    lastSeenRecently: "آخرین بازدید اخیر",
    selectAChat: "یک چت را انتخاب کنید.",
    typeMessage: "پیام بنویسید",
    stageUiOnly: "مرحله فعلی: فقط UI — اتصال به API واتس‌اپ در مرحله بعد.",
    newChat: "چت جدید",
    menu: "منو",
    search: "جستجو",
    back: "بازگشت",
    close: "بستن",
    emoji: "ایموجی",
    attach: "پیوست",
    send: "ارسال",
    recordVoice: "ضبط صدا",
    settings: "تنظیمات",
    openSettings: "باز کردن تنظیمات",
    settingsTabsLanguage: "زبان",
    settingsTabsAppearance: "ظاهر",
    settingsTabsApi: "اتصال به API",
    language: "زبان",
    appearance: "ظاهر",
    theme: "تم",
    themeSystem: "سیستم",
    themeLight: "روشن",
    themeDark: "تاریک",
    apiConnection: "اتصال به API",
    apiBaseUrl: "آدرس پایهٔ API",
    apiKey: "کلید API",
    save: "ذخیره",
    saved: "ذخیره شد",
    reset: "بازنشانی",
    apiSettingsNote: "فعلاً فقط UI است — این مقادیر محلی ذخیره می‌شوند و هنوز استفاده نمی‌شوند.",
    today: "امروز",
    yesterday: "دیروز",
  },
  ar: {
    appTitle: "واتساب",
    uiPrototype: "واجهة تجريبية",
    searchChats: "ابحث في الدردشات",
    muted: "كتم",
    online: "متصل",
    typing: "يكتب…",
    lastSeenRecently: "آخر ظهور مؤخراً",
    selectAChat: "اختر دردشة",
    typeMessage: "اكتب رسالة",
    stageUiOnly: "المرحلة الحالية: واجهة فقط — ربط API واتساب لاحقاً.",
    newChat: "دردشة جديدة",
    menu: "القائمة",
    search: "بحث",
    back: "رجوع",
    close: "إغلاق",
    emoji: "رموز تعبيرية",
    attach: "إرفاق",
    send: "إرسال",
    recordVoice: "تسجيل صوت",
    settings: "الإعدادات",
    openSettings: "فتح الإعدادات",
    settingsTabsLanguage: "اللغة",
    settingsTabsAppearance: "المظهر",
    settingsTabsApi: "اتصال API",
    language: "اللغة",
    appearance: "المظهر",
    theme: "السمة",
    themeSystem: "النظام",
    themeLight: "فاتح",
    themeDark: "داكن",
    apiConnection: "اتصال API",
    apiBaseUrl: "عنوان URL الأساسي للـ API",
    apiKey: "مفتاح API",
    save: "حفظ",
    saved: "تم الحفظ",
    reset: "إعادة ضبط",
    apiSettingsNote: "واجهة فقط حالياً — تُحفظ هذه القيم محلياً ولا تُستخدم بعد.",
    today: "اليوم",
    yesterday: "أمس",
  },
};
