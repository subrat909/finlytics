import { describe, expect, it } from "vitest";

import { normalizeEmail } from "../email";

describe("normalizeEmail", () => {
  it("trims surrounding whitespace and lowercases the whole address", () => {
    expect(normalizeEmail("  Asha.Rao@Example.IN \n")).toBe("asha.rao@example.in");
    expect(normalizeEmail("\tUSER+Alerts@GMAIL.COM")).toBe("user+alerts@gmail.com");
  });

  it("keeps dots and plus tags, which may name different mailboxes", () => {
    expect(normalizeEmail("a.b+c@x.in")).toBe("a.b+c@x.in");
    expect(normalizeEmail("ab@x.in")).not.toBe(normalizeEmail("a.b@x.in"));
  });

  it("is idempotent, so normalising a stored address changes nothing", () => {
    for (const email of ["Asha@X.in", " ÉLODIE@exemple.fr ", "already@lower.case", ""]) {
      const once = normalizeEmail(email);
      expect(normalizeEmail(once)).toBe(once);
    }
  });

  it("returns an address that equals its lowercase form (the database CHECK)", () => {
    for (const email of ["MiXeD@CaSe.IN", "ÉLODIE@EXEMPLE.FR", "  spaced@x.in  "]) {
      const stored = normalizeEmail(email);
      expect(stored).toBe(stored.toLowerCase());
      expect(stored).toBe(stored.trim());
    }
  });
});
