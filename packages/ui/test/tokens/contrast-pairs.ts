/**
 * The contrast matrix (plan §4): every token pair the components render, checked in both themes. Text needs 4.5:1
 * (WCAG 1.4.3); the focus outline, the checked segment and an input's edge need 3:1 (WCAG 1.4.11). The `border` token
 * (cards, menus, dividers) is decorative, so it isn't in the matrix. Add a row when a component starts putting a token
 * on a new surface.
 */

/** A token, or a token at an alpha over an opaque surface (an opacity modifier such as `hover:bg-primary/90`). */
export type Surface = string | { readonly token: string; readonly alpha: number; readonly over: string };

export interface ContrastPair {
  readonly foreground: string;
  readonly background: Surface;
  readonly min: 4.5 | 3;
}

export function surfaceLabel(surface: Surface): string {
  return typeof surface === "string"
    ? surface
    : `${surface.token}/${String(Math.round(surface.alpha * 100))} over ${surface.over}`;
}

const SURFACES = ["bg", "surface-1", "surface-2", "surface-3"];
/** Hover surfaces (surface-3) carry only fg and fg-muted text. */
const ACCENT_SURFACES = ["bg", "surface-1", "surface-2"];
const ACCENTS = ["primary", "highlight", "profit", "loss", "warning", "info", "violet", "orange"];
/** Filled buttons: their text token, the fill, and the fill's 90% hover over a card. */
const FILLS = [
  ["primary-fg", "primary"],
  ["profit-fg", "profit"],
  ["loss-fg", "loss"],
] as const;

export const TEXT_PAIRS: readonly ContrastPair[] = [
  ...["fg", "fg-muted"].flatMap((foreground) =>
    SURFACES.map((background): ContrastPair => ({ foreground, background, min: 4.5 })),
  ),
  ...ACCENTS.flatMap((foreground) =>
    ACCENT_SURFACES.map((background): ContrastPair => ({ foreground, background, min: 4.5 })),
  ),
  ...FILLS.flatMap(([foreground, fill]): ContrastPair[] => [
    { foreground, background: fill, min: 4.5 },
    { foreground, background: { token: fill, alpha: 0.9, over: "surface-1" }, min: 4.5 },
  ]),
  // An invalid input: aria-invalid:bg-loss/10 behind the value and the placeholder.
  ...["fg", "fg-muted"].map((foreground): ContrastPair => ({
    foreground,
    background: { token: "loss", alpha: 0.1, over: "surface-1" },
    min: 4.5,
  })),
];

export const NON_TEXT_PAIRS: readonly ContrastPair[] = [
  // The focus outline, wherever a focusable control sits.
  ...SURFACES.map((background): ContrastPair => ({ foreground: "ring", background, min: 3 })),
  // The checked SegmentedControl / ThemeToggle option (bg-primary) on the control's surface-2 track.
  { foreground: "primary", background: "surface-2", min: 3 },
  // An input's 1px edge (border-strong): against the page, a card and a surface-2 panel around it, and its own
  // surface-2 fill inside.
  ...ACCENT_SURFACES.map((background): ContrastPair => ({ foreground: "border-strong", background, min: 3 })),
];
