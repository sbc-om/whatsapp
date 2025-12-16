import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});
import Providers from "./providers";

export const metadata: Metadata = {
  title: "WhatsApp Web — UI",
  description: "A professional WhatsApp-style UI (API integration comes next).",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("wa.ui.theme")?.value;
  const initialThemeClass =
    themeCookie === "light" ? "light" : themeCookie === "dark" ? "dark" : "";

  return (
    <html
      lang="en"
      dir="ltr"
      className={initialThemeClass}
      suppressHydrationWarning
    >
      <head>
        <script
          // Prevent light/dark theme flash on refresh by setting the class before hydration.
          // Uses the same storage key as ThemeProvider.
          dangerouslySetInnerHTML={{
            __html: `(() => {
  try {
    const key = 'wa.ui.theme';
    const raw = localStorage.getItem(key);
    const theme = raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const resolved = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;

    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    if (theme === 'light') root.classList.add('light');
    else if (resolved === 'dark') root.classList.add('dark');

    root.style.colorScheme = resolved;
  } catch {
    // ignore
  }
})();`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
