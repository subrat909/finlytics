import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import NextTopLoader from "nextjs-toploader";
import type * as React from "react";

import { ThemeProvider } from "@finlytics/ui/components/theme-provider";
import { cn } from "@finlytics/ui/lib/utils";

import { Providers } from "@/components/providers";
import { StyleNonce } from "@/components/style-nonce";
import { getSession } from "@/lib/auth/session";

import { inter, jetbrainsMono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Finlytics", template: "%s · Finlytics" },
  description: "Algorithmic trading for the Indian market: charts, option chains, strategies, backtests and AI agents.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

/**
 * The root layout: fonts, the theme (no flash: next-themes' pre-paint script carries the CSP nonce from src/proxy.ts),
 * the route progress bar and the client providers. The account's theme is the default on devices without a choice.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const session = await getSession();

  return (
    <html lang="en-IN" suppressHydrationWarning className={cn(inter.variable, jetbrainsMono.variable)}>
      <body className="min-h-dvh antialiased">
        <ThemeProvider defaultTheme={session?.theme ?? "system"} nonce={nonce}>
          <NextTopLoader
            color="var(--primary)"
            height={2}
            showSpinner={false}
            shadow={false}
            {...(nonce === undefined ? {} : { nonce })}
          />
          <StyleNonce nonce={nonce} />
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
