import { PRISMA_ENUM_MIRRORS } from "@finlytics/shared";
import { describe, expect, it } from "vitest";

import * as prismaEnums from "../generated/enums";

// @finlytics/shared must stay browser-safe, so it mirrors these enums with Zod instead of importing Prisma (plan D17).
// This test is what keeps the two in step: same names, same values, same order.
const PRISMA_ENUMS: Readonly<Record<string, Readonly<Record<string, string>> | undefined>> = prismaEnums;

describe("Prisma enum mirrors", () => {
  it("mirrors every Prisma enum value in @finlytics/shared", () => {
    const mirrors = Object.entries(PRISMA_ENUM_MIRRORS);
    expect(mirrors).not.toHaveLength(0); // an empty table would make the loop below pass vacuously
    for (const [name, mirror] of mirrors) {
      const prismaEnum = PRISMA_ENUMS[name];
      expect(prismaEnum, `${name} is not an enum in schema.prisma`).toBeDefined();
      expect([...mirror], `${name} values differ between schema.prisma and @finlytics/shared`).toEqual(
        Object.values(prismaEnum ?? {}),
      );
    }
  });
});
