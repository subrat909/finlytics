import { Compass } from "lucide-react";
import Link from "next/link";

import { Button } from "@finlytics/ui/components/button";
import { EmptyState } from "@finlytics/ui/components/empty-state";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4">
      <h1 className="sr-only">Page not found</h1>
      <EmptyState
        icon={<Compass className="text-highlight" />}
        title="Nothing here"
        description="This address doesn't lead anywhere in Finlytics. Check the link, or start from the dashboard."
        action={
          <Button asChild>
            <Link href="/dashboard">Go to the dashboard</Link>
          </Button>
        }
      />
    </main>
  );
}
