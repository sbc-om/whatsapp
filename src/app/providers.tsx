"use client";

import { I18nProvider } from "@/components/i18n/I18nProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>{children}</I18nProvider>
    </ThemeProvider>
  );
}
