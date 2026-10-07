import { Compass, LayoutDashboard } from "lucide-react";
import Link from "next/link";

import { Button } from "@finlytics/ui/components/button";
import { EmptyState } from "@finlytics/ui/components/empty-state";

import { PageContainer } from "@/components/page";

/** Not found inside the shell: the sidebar and the navbar stay, so the user can go anywhere from here. */
export default function AppNotFound() {
  return (
    <PageContainer>
      <h1 className="sr-only">Page not found</h1>
      <div className="rounded-sm border border-border bg-surface-1">
        <EmptyState
          icon={<Compass className="text-highlight" />}
          title="Nothing here"
          description="This address doesn't lead anywhere in Finlytics. Pick a section from the sidebar, search with ⌘K, or start from the dashboard."
          action={
            <Button asChild>
              <Link href="/dashboard">
                <LayoutDashboard />
                Go to the dashboard
              </Link>
            </Button>
          }
        />
      </div>
    </PageContainer>
  );
}
