import { Check, LayoutDashboard } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@finlytics/ui/components/badge";
import { Button } from "@finlytics/ui/components/button";
import { EmptyState } from "@finlytics/ui/components/empty-state";

import { PageContainer, PageHeader, Panel } from "@/components/page";
import { isComingSoon, navItemFor } from "@/components/shell/nav-items";

interface SectionPageProps {
  params: Promise<{ section: string }>;
}

function comingSoonItem(section: string) {
  const item = navItemFor(section);
  return item !== undefined && isComingSoon(item) ? item : undefined;
}

export async function generateMetadata({ params }: SectionPageProps): Promise<Metadata> {
  const item = comingSoonItem((await params).section);
  return { title: item?.label ?? "Not found" };
}

/**
 * Sections in the sidebar that later phases build ("Soon"): an honest page instead of a 404 — what the section will
 * do, when it arrives (the roadmap item) and what it will offer, with a way back.
 */
export default async function SectionPage({ params }: SectionPageProps) {
  const item = comingSoonItem((await params).section);
  if (!item) notFound();
  const { Icon, label, description, accent, arrivesIn, highlights = [] } = item;

  return (
    <PageContainer>
      <PageHeader
        icon={<Icon className={accent} />}
        title={label}
        description={description}
        badge={<Badge tone="info">Soon</Badge>}
      />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
        <Panel aria-label={`${label} status`}>
          <EmptyState
            icon={<Icon className={accent} />}
            title={`${label} is on its way`}
            description={`It arrives with roadmap item ${String(arrivesIn)}. Until then, the dashboard, watchlists and charts are ready to use.`}
            action={
              <Button asChild>
                <Link href="/dashboard">
                  <LayoutDashboard />
                  Go to the dashboard
                </Link>
              </Button>
            }
          />
        </Panel>
        {highlights.length > 0 ? (
          <Panel title="What's coming" actions={<Badge size="sm">Roadmap {arrivesIn}</Badge>}>
            <ul className="flex flex-col gap-2.5 p-3 text-sm">
              {highlights.map((highlight) => (
                <li key={highlight} className="flex items-start gap-2 text-fg">
                  <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-profit" />
                  {highlight}
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </PageContainer>
  );
}
