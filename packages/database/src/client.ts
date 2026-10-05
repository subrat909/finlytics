import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function create(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: process.env["DATABASE_URL"],
    max: Number(process.env["DB_POOL_MAX"] ?? 20),
  });
  return new PrismaClient({
    adapter,
    log: process.env["NODE_ENV"] === "development" ? ["warn", "error"] : ["error"],
  });
}

/** Singleton — avoids pool exhaustion under Next.js HMR and in worker processes. */
export const prisma: PrismaClient = globalThis.__prisma ?? create();
if (process.env["NODE_ENV"] !== "production") globalThis.__prisma = prisma;

export * from "./generated/client";
