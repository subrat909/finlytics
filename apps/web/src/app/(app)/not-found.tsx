import { Compass } from "lucide-react";
import Link from "next/link";

import { Button } from "@finlytics/ui/components/button";
import { EmptyState } from "@finlytics/ui/components/empty-state";

/** Not found inside the shell: the sidebar stays, so the user can go anywhere from here. */
export default function AppNotFound() {
  return (
    <div className="mx-auto w-full max-w-6xl">
      <h1 className="sr-only">Page not found</h1>
      <EmptyState
        icon={<Compass className="text-highlight" />}
        title="Nothing here"
        description="This address doesn't lead anywhere in Finlytics. Pick a section from the sidebar, or start from the dashboard."
        action={
          <Button asChild>
            <Link href="/dashboard">Go to the dashboard</Link>
          </Button>
        }
      />
    </div>
  );
}
