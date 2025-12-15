"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { useI18n } from "@/components/i18n/I18nProvider";
import { localeInfo, type AppLocale } from "@/components/i18n/translations";
import { useTheme, type ThemePreference } from "@/components/theme/ThemeProvider";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type SettingsTab = "language" | "appearance" | "api";

type ApiSettings = {
  baseUrl: string;
  apiKey: string;
};

const API_SETTINGS_STORAGE_KEY = "wa.api.settings";

function readApiSettings(): ApiSettings {
  if (typeof window === "undefined") return { baseUrl: "", apiKey: "" };
  try {
    const raw = window.localStorage.getItem(API_SETTINGS_STORAGE_KEY);
    if (!raw) return { baseUrl: "", apiKey: "" };
    const parsed = JSON.parse(raw) as Partial<ApiSettings>;
    return {
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
    };
  } catch {
    return { baseUrl: "", apiKey: "" };
  }
}

function writeApiSettings(next: ApiSettings) {
  window.localStorage.setItem(API_SETTINGS_STORAGE_KEY, JSON.stringify(next));
}

function normalizeTab(input: string | null): SettingsTab {
  if (input === "api") return "api";
  if (input === "appearance") return "appearance";
  return "language";
}

export default function SettingsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { locale, t, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();

  const tab = useMemo(() => normalizeTab(params.get("tab")), [params]);

  const [apiSettings, setApiSettings] = useState<ApiSettings>(() => readApiSettings());
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const switchTab = (nextTab: SettingsTab) => {
    const url =
      nextTab === "language"
        ? "/settings"
        : nextTab === "appearance"
          ? "/settings?tab=appearance"
          : "/settings?tab=api";
    router.replace(url);
  };

  const saveApi = () => {
    const next = { baseUrl: apiSettings.baseUrl.trim(), apiKey: apiSettings.apiKey.trim() };
    writeApiSettings(next);
    setApiSettings(next);
    setSavedAt(Date.now());
  };

  const resetApi = () => {
    const next = { baseUrl: "", apiKey: "" };
    setApiSettings(next);
    writeApiSettings({ baseUrl: "", apiKey: "" });
    setSavedAt(Date.now());
  };

  return (
    <div className="min-h-screen bg-(--wa-app-bg) px-4 py-8 text-zinc-900 dark:text-zinc-50">
      <div className="mx-auto w-full max-w-3xl">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">{t("settings")}</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {tab === "language"
                ? t("language")
                : tab === "appearance"
                  ? t("appearance")
                  : t("apiConnection")}
            </p>
          </div>

          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-xl px-3 text-sm font-medium text-zinc-700 hover:bg-black/5 dark:text-zinc-200 dark:hover:bg-white/10"
          >
            {t("back")}
          </Link>
        </header>

        <div className="mt-6 overflow-hidden rounded-2xl bg-(--wa-panel) shadow-(--wa-shadow) ring-1 ring-(--wa-border)">
          <div className="flex items-center gap-2 border-b border-(--wa-border) wa-elevated p-2">
            <button
              type="button"
              onClick={() => switchTab("language")}
              className={cn(
                "h-10 flex-1 rounded-xl px-3 text-sm font-medium",
                tab === "language"
                  ? "bg-[color-mix(in_oklab,var(--wa-green)_10%,white)] text-(--wa-green-dark) ring-1 ring-(--wa-green)/35 dark:bg-[color-mix(in_oklab,var(--wa-green)_14%,black)]"
                  : "text-zinc-700 hover:bg-black/5 dark:text-zinc-200 dark:hover:bg-white/10",
              )}
            >
              {t("settingsTabsLanguage")}
            </button>

            <button
              type="button"
              onClick={() => switchTab("appearance")}
              className={cn(
                "h-10 flex-1 rounded-xl px-3 text-sm font-medium",
                tab === "appearance"
                  ? "bg-[color-mix(in_oklab,var(--wa-green)_10%,white)] text-(--wa-green-dark) ring-1 ring-(--wa-green)/35 dark:bg-[color-mix(in_oklab,var(--wa-green)_14%,black)]"
                  : "text-zinc-700 hover:bg-black/5 dark:text-zinc-200 dark:hover:bg-white/10",
              )}
            >
              {t("settingsTabsAppearance")}
            </button>

            <button
              type="button"
              onClick={() => switchTab("api")}
              className={cn(
                "h-10 flex-1 rounded-xl px-3 text-sm font-medium",
                tab === "api"
                  ? "bg-[color-mix(in_oklab,var(--wa-green)_10%,white)] text-(--wa-green-dark) ring-1 ring-(--wa-green)/35 dark:bg-[color-mix(in_oklab,var(--wa-green)_14%,black)]"
                  : "text-zinc-700 hover:bg-black/5 dark:text-zinc-200 dark:hover:bg-white/10",
              )}
            >
              {t("settingsTabsApi")}
            </button>
          </div>

          <div className="p-4">
            {tab === "language" ? (
              <div className="grid gap-2">
                {(Object.keys(localeInfo) as AppLocale[]).map((l) => {
                  const isActive = l === locale;
                  return (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setLocale(l)}
                      className={cn(
                        "flex items-center justify-between rounded-2xl border px-4 py-3 text-sm",
                        isActive
                          ? "border-(--wa-green) bg-[color-mix(in_oklab,var(--wa-green)_10%,white)] dark:bg-[color-mix(in_oklab,var(--wa-green)_12%,black)]"
                          : "border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10",
                      )}
                    >
                      <span className="font-medium">{localeInfo[l].label}</span>
                      {isActive ? (
                        <span className="text-xs text-(--wa-green-dark)">✓</span>
                      ) : (
                        <span className="text-xs text-zinc-400">{localeInfo[l].dir.toUpperCase()}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : tab === "appearance" ? (
              <div className="space-y-4">
                <div>
                  <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                    {t("theme")}
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    {([
                      { value: "system", label: t("themeSystem") },
                      { value: "light", label: t("themeLight") },
                      { value: "dark", label: t("themeDark") },
                    ] as const).map((opt) => {
                      const active = opt.value === theme;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setTheme(opt.value as ThemePreference)}
                          className={cn(
                            "flex items-center justify-between rounded-2xl border px-4 py-3 text-sm",
                            active
                              ? "border-(--wa-green) bg-[color-mix(in_oklab,var(--wa-green)_10%,white)] dark:bg-[color-mix(in_oklab,var(--wa-green)_12%,black)]"
                              : "border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10",
                          )}
                        >
                          <span className="font-medium">{opt.label}</span>
                          {active ? (
                            <span className="text-xs text-(--wa-green-dark)">✓</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("apiSettingsNote")}</p>

                <div className="grid gap-3">
                  <label className="grid gap-1">
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                      {t("apiBaseUrl")}
                    </span>
                    <input
                      value={apiSettings.baseUrl}
                      onChange={(e) =>
                        setApiSettings((prev) => ({ ...prev, baseUrl: e.target.value }))
                      }
                      placeholder="https://api.example.com"
                      className="h-11 w-full rounded-2xl border border-black/10 bg-white px-4 text-sm outline-none ring-(--wa-green)/30 focus:ring-4 dark:border-white/10 dark:bg-zinc-900"
                    />
                  </label>

                  <label className="grid gap-1">
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                      {t("apiKey")}
                    </span>
                    <input
                      value={apiSettings.apiKey}
                      onChange={(e) =>
                        setApiSettings((prev) => ({ ...prev, apiKey: e.target.value }))
                      }
                      placeholder="••••••••••••••••"
                      className="h-11 w-full rounded-2xl border border-black/10 bg-white px-4 text-sm outline-none ring-(--wa-green)/30 focus:ring-4 dark:border-white/10 dark:bg-zinc-900"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={saveApi}
                    className="inline-flex h-10 items-center justify-center rounded-xl bg-(--wa-green) px-4 text-sm font-semibold text-white shadow-sm hover:brightness-[.98]"
                  >
                    {t("save")}
                  </button>

                  <button
                    type="button"
                    onClick={resetApi}
                    className="inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm font-medium text-zinc-700 hover:bg-black/5 dark:text-zinc-200 dark:hover:bg-white/10"
                  >
                    {t("reset")}
                  </button>

                  {savedAt ? (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {t("saved")}
                    </span>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
