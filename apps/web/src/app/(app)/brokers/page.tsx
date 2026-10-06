import type { Metadata } from "next";

import { BrokersView } from "@/features/brokers/components/brokers-view";

export const metadata: Metadata = { title: "Brokers" };

interface BrokersPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value !== "" && value.length <= 128 ? value : undefined;
}

/** Broker accounts (docs/05 Brokers). The api's Upstox callback lands here with `?connected=<id>` (plan P4). */
export default async function BrokersPage({ searchParams }: BrokersPageProps) {
  const params = await searchParams;
  return (
    <div className="w-full space-y-6">
      <BrokersView connectedId={single(params.connected)} connectError={single(params.error)} />
    </div>
  );
}
