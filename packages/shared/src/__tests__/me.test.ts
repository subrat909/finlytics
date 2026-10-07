import { describe, expect, it } from "vitest";

import { MeSchema } from "../schemas/me";
import type { Me } from "../schemas/me";

function me(): Me {
  return {
    id: "cmg1z8k3e0000qz8x1a2b3c4d",
    email: "trader@example.test",
    name: "Asha Trader",
    image: "https://avatars.example.test/u/1",
    timezone: "Asia/Kolkata",
    createdAt: new Date(Date.UTC(2026, 9, 6, 3, 30)).toISOString(),
  };
}

describe("MeSchema", () => {
  it("accepts the signed-in user, with null name and image", () => {
    expect(MeSchema.parse(me())).toEqual(me());
    expect(MeSchema.parse({ ...me(), name: null, image: null })).toMatchObject({ name: null, image: null });
  });

  it("rejects unknown members in Me and health payloads", () => {
    // Fields that exist on User but must never leave the server.
    for (const leaked of [
      { role: "ADMIN" },
      { passwordHash: "argon2id$..." },
      { totpSecretEnc: "..." },
      { lockedUntil: null },
      { settings: {} },
    ]) {
      expect(MeSchema.safeParse({ ...me(), ...leaked }).success, Object.keys(leaked).join()).toBe(false);
    }
  });

  it("does not re-validate the email as an address", () => {
    // Whatever the OAuth provider gave Auth.js is the user's email; an unusual address must not fail the response.
    expect(MeSchema.safeParse({ ...me(), email: "user+tag@sub.example" }).success).toBe(true);
    expect(MeSchema.safeParse({ ...me(), email: "local-only" }).success).toBe(true);
    expect(MeSchema.safeParse({ ...me(), email: "" }).success).toBe(false);
  });

  it("requires createdAt as an ISO 8601 UTC timestamp", () => {
    expect(MeSchema.safeParse({ ...me(), createdAt: "2026-10-06T03:30:00Z" }).success).toBe(true);
    for (const createdAt of ["2026-10-06", "06/10/2026", "2026-10-06T09:00:00+05:30", new Date(), 1_759_721_400_000]) {
      expect(MeSchema.safeParse({ ...me(), createdAt }).success, String(createdAt)).toBe(false);
    }
  });

  it("requires every member", () => {
    for (const key of Object.keys(me())) {
      const partial = Object.fromEntries(Object.entries(me()).filter(([member]) => member !== key));
      expect(MeSchema.safeParse(partial).success, key).toBe(false);
    }
  });
});
