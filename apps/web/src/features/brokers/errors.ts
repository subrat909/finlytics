/**
 * Messages for broker mutations, by problem `code` (clients branch on `code`, never `title`). A problem's `detail` is
 * written for users by the api (a plan limit, the broker's reason), so it's preferred when present.
 */
import { isApiError } from "@/lib/api/client";

export function brokerErrorMessage(error: unknown, broker: string): string {
  if (!isApiError(error)) return "Something went wrong. Try again.";
  if (error.detail) return error.detail;
  switch (error.code) {
    case "VALIDATION":
      return "Check the highlighted fields.";
    case "CONFLICT":
      return "You already have an account with that name. Choose another.";
    case "FORBIDDEN":
      return "Your plan doesn't allow another broker account.";
    case "BROKER_REJECTED":
      return `${broker} didn't accept these credentials. Check them and try again.`;
    case "BROKER_UNAVAILABLE":
      return `${broker} isn't answering right now. Try again in a minute.`;
    case "RATE_LIMITED":
      return "Too many attempts. Wait a moment and try again.";
    case "NETWORK":
      return "You seem to be offline. Check your connection.";
    default:
      return "Finlytics couldn't finish that. Try again in a moment.";
  }
}
