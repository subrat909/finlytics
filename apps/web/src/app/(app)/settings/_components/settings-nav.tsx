import { Badge } from "@finlytics/ui/components/badge";
import { cn } from "@finlytics/ui/lib/utils";

import { SETTINGS_SECTIONS } from "./settings-sections";

/**
 * The section list beside the settings (a row that scrolls sideways on phones): in-page links to each section's
 * anchor, "Soon" on the ones still to come. Server-rendered; the browser does the scrolling.
 */
export function SettingsNav({ className }: { className?: string | undefined }) {
  return (
    <nav aria-label="Settings sections" className={cn("min-w-0", className)}>
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {SETTINGS_SECTIONS.map(({ id, title, Icon, accent, soon }) => (
          <li key={id} className="shrink-0">
            <a
              href={`#${id}`}
              data-slot="settings-nav-link"
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[0.8125rem] font-medium whitespace-nowrap text-fg-muted",
                "transition-[color,background-color] hover:bg-surface-2 hover:text-fg",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
              )}
            >
              <Icon aria-hidden="true" className={cn("size-4 shrink-0", accent)} />
              <span className="flex-1">{title}</span>
              {soon ? (
                <>
                  <Badge size="sm" aria-hidden="true">
                    Soon
                  </Badge>
                  <span className="sr-only">, coming soon</span>
                </>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
