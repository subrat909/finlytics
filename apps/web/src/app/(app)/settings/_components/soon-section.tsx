import { Badge } from "@finlytics/ui/components/badge";

import type { SettingsSection } from "./settings-sections";

/** A settings section still to be built: its title with "Soon", what it's for, and what it will hold. */
export function SoonSection({ section }: { section: SettingsSection }) {
  const { id, title, Icon, accent, description, items = [] } = section;
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-slot="settings-soon-section"
      className="scroll-mt-4 rounded-md border border-border bg-surface-1"
    >
      <div className="flex h-10 items-center justify-between gap-2 border-b border-border px-4">
        <h2 id={headingId} className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Icon aria-hidden="true" className={`size-4 shrink-0 ${accent}`} />
          {title}
        </h2>
        <Badge tone="info" size="sm">
          Soon
        </Badge>
      </div>
      <div className="space-y-2.5 px-4 py-3">
        <p className="text-sm text-fg-muted">{description}</p>
        {items.length > 0 ? (
          <ul className="grid gap-x-6 gap-y-1.5 text-[0.8125rem] text-fg sm:grid-cols-2">
            {items.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong" />
                {item}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
