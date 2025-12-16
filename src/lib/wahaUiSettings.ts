export type WahaUiSettings = {
  /** WAHA session name (e.g. "default" or "Milad") */
  session: string;
};

export const WAHA_UI_SETTINGS_KEY = "wa.waha.settings";

export function readWahaUiSettings(): WahaUiSettings {
  if (typeof window === "undefined") return { session: "default" };
  try {
    const raw = window.localStorage.getItem(WAHA_UI_SETTINGS_KEY);
    if (!raw) return { session: "default" };
    const parsed = JSON.parse(raw) as Partial<WahaUiSettings>;
    return {
      session: typeof parsed.session === "string" && parsed.session.trim() ? parsed.session : "default",
    };
  } catch {
    return { session: "default" };
  }
}

export function writeWahaUiSettings(next: WahaUiSettings) {
  window.localStorage.setItem(WAHA_UI_SETTINGS_KEY, JSON.stringify(next));
}
