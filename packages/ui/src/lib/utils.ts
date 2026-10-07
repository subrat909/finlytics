import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge with the theme's custom scales registered (plan D9), so conflicts resolve like Tailwind does:
 * `animate-shimmer` (theme.css) is in the same group as `animate-pulse` and `animate-spin`. Register custom text sizes
 * here when they're added to the theme. Token colours (`bg-surface-2`, `text-fg-muted`) need nothing: any unknown
 * colour-position value is treated as a colour.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      animate: ["shimmer"],
      // theme.css `--text-2xs`: a font size, not a colour, so it never cancels `text-fg-muted`.
      text: ["2xs"],
    },
  },
});

/**
 * Joins class names (clsx) and resolves Tailwind conflicts, last one wins (tailwind-merge). Components merge the
 * caller's `className` last. Cached by tailwind-merge, but never call it per tick: precompute class strings instead.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
