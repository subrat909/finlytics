import { ThemeProvider } from "@finlytics/ui/components/theme-provider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type * as React from "react";

import { TooltipProvider } from "@/components/shell/tooltip";

export function testQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

/** Renders with the app's client providers: theme, TanStack Query, tooltips. */
export function renderWithProviders(ui: React.ReactElement, queryClient: QueryClient = testQueryClient()) {
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{ui}</TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}
