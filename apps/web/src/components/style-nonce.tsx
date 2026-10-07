"use client";

import { useEffect } from "react";

/**
 * Gives the request's CSP nonce to libraries that insert `<style>` elements at runtime: Radix's scroll lock
 * (react-remove-scroll through react-style-singleton) reads it from `__webpack_nonce__` via get-nonce, a global lookup
 * that Turbopack leaves as is. Without it the CSP (`style-src 'nonce-…'`) blocks those styles whenever a dialog, menu
 * or sheet opens. The nonce is already in the page for next-themes and the top loader, so this exposes nothing new.
 */
export function StyleNonce({ nonce }: { nonce: string | undefined }) {
  useEffect(() => {
    if (nonce !== undefined) (globalThis as { __webpack_nonce__?: string }).__webpack_nonce__ = nonce;
  }, [nonce]);
  return null;
}
