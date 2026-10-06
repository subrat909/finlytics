import pg from "pg";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { createPrismaClient } from "../../src/index";
import type { CreatePrismaClientOptions, PrismaClient } from "../../src/index";
import { databaseError, sharedDatabaseUrl, uniqueSuffix } from "./harness";

/** SQLSTATE query_canceled: what PostgreSQL reports when statement_timeout cancels a statement. */
const QUERY_CANCELED = "57014";

/** SQLSTATE idle_in_transaction_session_timeout: the FATAL error that ends a session idle inside a transaction. */
const IDLE_IN_TRANSACTION_SESSION_TIMEOUT = "25P03";

/** Runs `work` with a client configured by `options` (on the shared database) and disconnects afterwards. */
async function withConfiguredClient<T>(
  options: Omit<CreatePrismaClientOptions, "url">,
  work: (prisma: PrismaClient) => Promise<T>,
): Promise<T> {
  const prisma = createPrismaClient({ url: sharedDatabaseUrl(), log: [], ...options });
  try {
    return await work(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

/** How long `promise` took to settle, and how: its value or its rejection. */
async function timed<T>(promise: Promise<T>): Promise<{ ms: number; value?: T; error?: unknown }> {
  const started = performance.now();
  try {
    const value = await promise;
    return { ms: performance.now() - started, value };
  } catch (error: unknown) {
    return { ms: performance.now() - started, error };
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** The connection timeouts createPrismaClient configures (review D1), as PostgreSQL itself sees them. */
describe("createPrismaClient against PostgreSQL", () => {
  it("applies the statement and idle-in-transaction timeouts and the application name to every pooled connection", async () => {
    // No URL parameter can undercut them: createPrismaClient refuses the ones pg would let override them (unit tests).
    const sessions = await withConfiguredClient(
      {
        poolMax: 3,
        statementTimeoutMs: 1_234,
        idleInTransactionTimeoutMs: 4_321,
        applicationName: "finlytics-it",
      },
      // Three concurrent transactions hold three connections at once.
      (prisma) =>
        Promise.all(
          [0, 1, 2].map(() =>
            prisma.$transaction(async (tx) => {
              await tx.$executeRaw`SELECT pg_sleep(0.1)`;
              const rows = await tx.$queryRaw<{ pid: number; statement: string; idle: string; application: string }[]>`
                SELECT pg_backend_pid() AS pid, current_setting('statement_timeout') AS statement,
                       current_setting('idle_in_transaction_session_timeout') AS idle,
                       current_setting('application_name') AS application`;
              return rows[0];
            }),
          ),
        ),
    );

    expect(new Set(sessions.map((session) => session?.pid)).size).toBe(3);
    for (const session of sessions) {
      expect(session).toMatchObject({ statement: "1234ms", idle: "4321ms", application: "finlytics-it" });
    }
  });

  it("cancels a statement in PostgreSQL once it runs past the statement timeout", async () => {
    const outcome = await withConfiguredClient({ statementTimeoutMs: 200 }, (prisma) =>
      timed(prisma.$executeRaw`SELECT pg_sleep(2)`),
    );

    // PostgreSQL cancelled it (the api maps SQLSTATE 57014 to SERVICE_UNAVAILABLE), well before pg_sleep finished.
    expect(databaseError(outcome.error)).toMatchObject({ prismaCode: "P2010", sqlState: QUERY_CANCELED });
    expect(outcome.ms).toBeLessThan(1_500);
  });

  it("rolls back an interactive transaction that runs past its timeout", async () => {
    const email = `expired-tx-${uniqueSuffix()}@example.test`;

    // The statement timeout must stay below the transaction's; every statement here takes milliseconds.
    const outcome = await withConfiguredClient(
      { statementTimeoutMs: 250, transaction: { timeoutMs: 300 } },
      async (prisma) => {
        const result = await timed(
          prisma.$transaction(async (tx) => {
            await tx.user.create({ data: { email } });
            await sleep(600);
            await tx.$executeRaw`SELECT 1`;
          }),
        );
        return { ...result, saved: await prisma.user.count({ where: { email } }) };
      },
    );

    expect(outcome.error).toMatchObject({ name: "PrismaClientKnownRequestError", code: "P2028" });
    expect(outcome.saved).toBe(0);
  });

  it("fails a query after the connect timeout while every pooled connection is busy, then recovers", async () => {
    await withConfiguredClient(
      {
        poolMax: 1,
        connectTimeoutMs: 300,
        statementTimeoutMs: 4_000,
        transaction: { maxWaitMs: 300, timeoutMs: 5_000 },
      },
      async (prisma) => {
        // The only connection is held by a transaction for one second.
        const holder = prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_sleep(1)`;
        });
        await sleep(100);

        const query = await timed(prisma.$queryRaw`SELECT 1`);
        const transaction = await timed(prisma.$transaction(async (tx) => tx.$queryRaw`SELECT 1`));
        await holder;

        // pg-pool rejects a waiting query with a plain Error (no Prisma name or code): the api recognises it by message.
        expect(query.error).toMatchObject({ name: "Error", message: "timeout exceeded when trying to connect" });
        expect(query.ms).toBeGreaterThanOrEqual(250);
        expect(query.ms).toBeLessThan(900);
        // A transaction that can't get a connection within maxWait fails with P2028.
        expect(transaction.error).toMatchObject({ name: "PrismaClientKnownRequestError", code: "P2028" });
        expect(await prisma.$queryRaw<{ one: number }[]>`SELECT 1 AS one`).toEqual([{ one: 1 }]);
      },
    );
  });

  it("ends a session left idle inside a transaction, and the pool recovers", async () => {
    // PostgreSQL reports the termination to the idle connection itself, as an `error` event (adapter-pg's
    // onConnectionError); the transaction's next statement only learns that the connection is gone.
    const emit = vi.spyOn(pg.Client.prototype, "emit");
    // pg emits `error` only with an Error (a pg DatabaseError when the server sent it).
    const connectionErrors = () =>
      emit.mock.calls.filter(([event]) => event === "error").map(([, error]) => error as Error);
    onTestFinished(() => {
      emit.mockRestore();
    });

    await withConfiguredClient(
      { poolMax: 1, idleInTransactionTimeoutMs: 300, statementTimeoutMs: 4_000, transaction: { timeoutMs: 5_000 } },
      async (prisma) => {
        const outcome = await timed(
          prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT 1`;
            await sleep(900); // idle inside the transaction: PostgreSQL terminates the session after 300 ms
            await tx.$executeRaw`SELECT 2`;
          }),
        );

        // First the server's FATAL error, then pg's own "Connection terminated unexpectedly" as the socket closes.
        const errors = connectionErrors();
        expect(errors[0]).toMatchObject({
          name: "error",
          severity: "FATAL",
          code: IDLE_IN_TRANSACTION_SESSION_TIMEOUT,
        });
        expect(errors[0]?.message).toMatch(/^terminating connection due to idle-in-transaction timeout/);
        for (const error of errors) expect(error.message).toMatch(/terminat/i);
        expect(outcome.error).toMatchObject({
          name: "Error",
          message: "Client has encountered a connection error and is not queryable",
        });
        expect(await prisma.$queryRaw<{ one: number }[]>`SELECT 1 AS one`).toEqual([{ one: 1 }]);
      },
    );
  });
});
