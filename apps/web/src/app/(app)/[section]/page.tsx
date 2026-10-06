import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@finlytics/ui/components/button";
import { EmptyState } from "@finlytics/ui/components/empty-state";

import { navItemFor } from "@/components/shell/nav-items";

interface SectionPageProps {
  params: Promise<{ section: string }>;
}

function comingSoonItem(section: string) {
  const item = navItemFor(section);
  return item?.arrivesIn === undefined ? undefined : item;
}

export async function generateMetadata({ params }: SectionPageProps): Promise<Metadata> {
  const item = comingSoonItem((await params).section);
  return { title: item?.label ?? "Not found" };
}

/** Sections in the sidebar that later phases build: an honest empty state instead of a 404. */
export default async function SectionPage({ params }: SectionPageProps) {
  const item = comingSoonItem((await params).section);
  if (!item) notFound();
  const { Icon, label, description, accent, arrivesIn } = item;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{label}</h1>
        <p className="text-sm text-fg-muted">{description}</p>
      </header>
      <section className="rounded-md bg-surface-1" aria-label={`${label} status`}>
        <EmptyState
          icon={<Icon className={accent} />}
          title={`${label} is on its way`}
          description={`This section arrives with roadmap item ${String(arrivesIn)}.`}
          action={
            <Button asChild variant="secondary">
              <Link href="/dashboard">
                <ArrowLeft />
                Back to the dashboard
              </Link>
            </Button>
          }
        />
      </section>
    </div>
  );
}
