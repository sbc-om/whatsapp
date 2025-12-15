"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { localeInfo, translations, type AppLocale, type I18nDict } from "./translations";

type I18nContextValue = {
  locale: AppLocale;
  dir: "ltr" | "rtl";
  intlLocale: string;
  t: (key: keyof I18nDict) => string;
  setLocale: (locale: AppLocale) => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = "wa.ui.locale";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(() => {
    if (typeof window === "undefined") return "en";
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === "en" || raw === "fa" || raw === "ar") return raw;
      return "en";
    } catch {
      return "en";
    }
  });

  const setLocale = useCallback((next: AppLocale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const meta = localeInfo[locale];

  useEffect(() => {
    // Keep html lang/dir in sync with the selected locale.
    document.documentElement.lang = locale;
    document.documentElement.dir = meta.dir;
  }, [locale, meta.dir]);

  const t = useCallback(
    (key: keyof I18nDict) => translations[locale][key] ?? String(key),
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      dir: meta.dir,
      intlLocale: meta.intlLocale,
      t,
      setLocale,
    }),
    [locale, meta.dir, meta.intlLocale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}
