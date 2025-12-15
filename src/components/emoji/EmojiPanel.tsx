"use client";

import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";
import { useEffect, useMemo, useRef } from "react";

import { useI18n } from "@/components/i18n/I18nProvider";
import { useTheme } from "@/components/theme/ThemeProvider";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export type EmojiPanelProps = {
  open: boolean;
  onClose: () => void;
  onSelectEmoji: (emoji: string) => void;
  className?: string;
};

export default function EmojiPanel({
  open,
  onClose,
  onSelectEmoji,
  className,
}: EmojiPanelProps) {
  const { dir, locale, t } = useI18n();
  const { resolvedTheme } = useTheme();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      onClose();
    };

    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onClose, open]);

  const pickerLocale = useMemo(() => {
    // emoji-mart locales are limited; default to English.
    if (locale === "fa") return "fa";
    if (locale === "ar") return "ar";
    return "en";
  }, [locale]);

  const pickerTheme = resolvedTheme === "dark" ? "dark" : "light";

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className={cn(
        "absolute bottom-full z-50 mb-2 w-[min(420px,calc(100vw-32px))]",
        dir === "rtl" ? "right-0" : "left-0",
        className,
      )}
      role="dialog"
      aria-label={t("emoji")}
    >
      <Picker
        data={data}
        theme={pickerTheme}
        locale={pickerLocale}
        navPosition="top"
        searchPosition="sticky"
        previewPosition="none"
        skinTonePosition="search"
        perLine={9}
        onEmojiSelect={(e: { native?: string }) => {
          const emoji = e?.native;
          if (!emoji) return;
          onSelectEmoji(emoji);
        }}
      />
    </div>
  );
}
