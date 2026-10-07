/**
 * The shell's tooltip moved to the design system (`@finlytics/ui/components/tooltip`, plan phase-1b "Shell"). These
 * names stay for existing imports: `ShellTooltip` is the ui `Tooltip` (hover and keyboard focus only; never stale
 * when `enabled` flips), `TooltipProvider` the shared delay.
 */
export { Tooltip as ShellTooltip, TooltipProvider } from "@finlytics/ui/components/tooltip";
export type { TooltipProps as ShellTooltipProps } from "@finlytics/ui/components/tooltip";
