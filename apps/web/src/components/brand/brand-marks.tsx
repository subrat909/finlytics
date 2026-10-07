import type * as React from "react";

/**
 * Provider marks for the sign-in buttons, drawn in `currentColor` (tokens only: no brand hex in components). Promote to
 * packages/ui/src/icons/brand with brand-colour tokens (plan W9).
 */
export function GoogleMark(props: React.ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor" {...props}>
      <path d="M21.35 11.1H12v2.98h5.35c-.23 1.43-1.67 4.2-5.35 4.2-3.22 0-5.85-2.67-5.85-5.96S8.78 6.36 12 6.36c1.83 0 3.06.78 3.76 1.45l2.57-2.47C16.68 3.8 14.55 2.86 12 2.86 6.96 2.86 2.88 6.95 2.88 12s4.08 9.14 9.12 9.14c5.26 0 8.75-3.7 8.75-8.9 0-.6-.06-1.05-.14-1.5Z" />
    </svg>
  );
}

export function GitHubMark(props: React.ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor" {...props}>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}
