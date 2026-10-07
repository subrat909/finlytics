import { vi } from "vitest";

/** Shared spies for `next/navigation` (vi.mock factories in tests return these). */
export const router = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
};

export const navigation = {
  pathname: "/dashboard",
};

export const nextNavigationMock = {
  usePathname: () => navigation.pathname,
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
};
