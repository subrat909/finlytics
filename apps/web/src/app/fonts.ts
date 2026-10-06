/**
 * Self-hosted variable fonts (ui plan D13): Inter for the UI, JetBrains Mono for numbers. `next/font/local` preloads
 * them and adds fallback metrics; never Google Fonts at runtime (CSP `font-src 'self'`).
 *
 * The files come from @finlytics/ui's fontsource dependencies (plan W13: until apps/web depends on them itself).
 */
import localFont from "next/font/local";

export const inter = localFont({
  src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});

export const jetbrainsMono = localFont({
  src: "../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-jetbrains-mono",
  weight: "100 800",
  display: "swap",
});
