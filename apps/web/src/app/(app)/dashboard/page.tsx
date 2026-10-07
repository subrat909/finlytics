import type { Metadata } from "next";

import { PageContainer } from "@/components/page";
import { DashboardView } from "@/features/dashboard/components/dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * The algo dashboard (plan phase-1b "Dashboard"): the server renders the frame; the panels are client leaves fed by
 * TanStack Query (portfolio, market overview) and live ticks.
 */
export default function DashboardPage() {
  return (
    <PageContainer>
      <DashboardView />
    </PageContainer>
  );
}
