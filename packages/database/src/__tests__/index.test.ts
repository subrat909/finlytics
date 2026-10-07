import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, expectTypeOf, it } from "vitest";

import { createPrismaClient, PrismaClient } from "../index";

/** Syntactically valid but never connected to: nothing here runs a query (port 1 refuses connections). */
const UNREACHABLE_URL = "postgresql://finlytics:not-a-secret@127.0.0.1:1/never";

describe("package entry", () => {
  it("exports PrismaClient as a type only, so clients come from createPrismaClient", async () => {
    // The real assertion is the @ts-expect-error, enforced by `pnpm typecheck`: if PrismaClient becomes a value export
    // again, the directive is unused and tsc fails. The arguments are valid, so TS1362 is the only possible error.
    const bypassFactoryGuards = () =>
      // @ts-expect-error -- TS1362: 'PrismaClient' cannot be used as a value because it was exported using 'export type'.
      new PrismaClient({ adapter: new PrismaPg({ connectionString: UNREACHABLE_URL }), log: ["query"] });

    // The type stays usable, and it is what the factory returns.
    const client: PrismaClient = createPrismaClient({ url: UNREACHABLE_URL });

    expectTypeOf(bypassFactoryGuards).toBeFunction();
    expectTypeOf(createPrismaClient).returns.toEqualTypeOf<PrismaClient>();
    expect(typeof client.$disconnect).toBe("function");
    await client.$disconnect();
  });
});
