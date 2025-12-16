"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (next: ThemePreference) => void;
};

const THEME_STORAGE_KEY = "wa.ui.theme";
const THEME_COOKIE_KEY = "wa.ui.theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function readStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
    return "system";
  } catch {
    return "system";
  }
}

function applyThemeToDocument(theme: ThemePreference, resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.remove("dark", "light");

  // If the user forces light, we add .light to override system dark.
  // Otherwise we add .dark whenever the resolved theme is dark (explicit dark or system dark).
  if (theme === "light") root.classList.add("light");
  else if (resolved === "dark") root.classList.add("dark");

  // Helps built-in form controls pick the right palette.
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() => readStoredTheme());
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme());

  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemTheme(mql.matches ? "dark" : "light");

    update();

    // Safari < 14 doesn't support addEventListener on MediaQueryList.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    }

    mql.addListener(update);
    return () => mql.removeListener(update);
  }, []);

  const resolvedTheme = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    applyThemeToDocument(theme, resolvedTheme);
  }, [resolvedTheme, theme]);

  // Keep a cookie in sync so SSR can avoid a theme flash (for explicit light/dark choices).
  useEffect(() => {
    try {
      const maxAge = 60 * 60 * 24 * 365; // 1 year
      document.cookie = `${THEME_COOKIE_KEY}=${encodeURIComponent(theme)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
    } catch {
      // ignore
    }
  }, [theme]);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // ignore
    }

    try {
      const maxAge = 60 * 60 * 24 * 365; // 1 year
      document.cookie = `${THEME_COOKIE_KEY}=${encodeURIComponent(next)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [resolvedTheme, setTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
