import { Button } from "@finlytics/ui/components/button";

import { GitHubMark, GoogleMark } from "@/components/brand/brand-marks";

import { signInWithProvider } from "../actions";
import type { OAuthProviderId } from "../schemas";

const LABELS: Readonly<Record<OAuthProviderId, { label: string; Mark: typeof GoogleMark }>> = {
  google: { label: "Continue with Google", Mark: GoogleMark },
  github: { label: "Continue with GitHub", Mark: GitHubMark },
};

/** One form per provider: works without JavaScript (a plain POST to the server action). */
export function OAuthButtons({
  providers,
  callbackUrl,
}: {
  providers: readonly OAuthProviderId[];
  callbackUrl?: string | undefined;
}) {
  return (
    <div className="space-y-2">
      {providers.map((provider) => {
        const { label, Mark } = LABELS[provider];
        return (
          <form key={provider} action={signInWithProvider}>
            <input type="hidden" name="provider" value={provider} />
            {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}
            <Button type="submit" variant="secondary" className="w-full">
              <Mark />
              {label}
            </Button>
          </form>
        );
      })}
    </div>
  );
}
