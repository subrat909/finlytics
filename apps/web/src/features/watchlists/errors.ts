/**
 * Messages for watchlist mutations by problem `code`. Plan limits (`Plan.maxWatchlists`, `maxWatchlistItems`) come back
 * as problem+json whose `detail` names the limit; it's shown as is.
 */
import { isApiError } from "@/lib/api/client";

export function watchlistErrorMessage(error: unknown, fallback: string): string {
  if (!isApiError(error)) return fallback;
  if (error.detail) return error.detail;
  switch (error.code) {
    case "CONFLICT":
      return "That's already there.";
    case "FORBIDDEN":
      return "Your plan's limit is reached. Remove something first, or upgrade.";
    case "NOT_FOUND":
      return "That watchlist no longer exists. Refresh the page.";
    case "VALIDATION":
      return "That isn't valid. Check it and try again.";
    case "RATE_LIMITED":
      return "Too many changes at once. Wait a moment and try again.";
    case "NETWORK":
      return "You seem to be offline. Check your connection.";
    default:
      return fallback;
  }
}
