import { describe, expect, it } from "vitest";

import { devSessionProblem } from "../../scripts/dev-session.mjs";

const LOCAL = "postgresql://finlytics:finlytics@localhost:5433/finlytics";
const DEV = { NODE_ENV: "development" } as const;

describe("scripts/dev-session.mts", () => {
  it("refuses to create a session outside development or against a non-local database", () => {
    expect(devSessionProblem({ NODE_ENV: "production", DATABASE_URL: LOCAL })).toBe(
      "refusing to run: NODE_ENV must be development",
    );
    expect(devSessionProblem({ NODE_ENV: "test", DATABASE_URL: LOCAL })).toMatch(/NODE_ENV/);
    expect(devSessionProblem({ ...DEV, DATABASE_URL: "postgresql://u:p@db.prod.internal:5432/finlytics" })).toBe(
      "refusing to run: DATABASE_URL must point at localhost or 127.0.0.1",
    );
    expect(devSessionProblem({ ...DEV, DATABASE_URL: "postgresql://u:p@localhost.evil.example/x" })).toMatch(
      /localhost/,
    );
    expect(devSessionProblem(DEV)).toBe("DATABASE_URL is not set");
    expect(devSessionProblem({ ...DEV, DATABASE_URL: "not a url" })).toBe("DATABASE_URL is not a URL");
  });

  it("requires NODE_ENV to be exactly development: unset or empty is refused", () => {
    for (const nodeEnv of [undefined, "", "Development", " development"]) {
      expect(devSessionProblem({ NODE_ENV: nodeEnv, DATABASE_URL: LOCAL }), String(nodeEnv)).toBe(
        "refusing to run: NODE_ENV must be development",
      );
    }
    expect(devSessionProblem({ DATABASE_URL: LOCAL })).toBe("refusing to run: NODE_ENV must be development");
  });

  it("refuses a local URL whose query parameters would send pg to another host or port", () => {
    for (const query of [
      "?host=db.prod.internal",
      "?hostaddr=10.0.0.5",
      "?port=6432",
      "?sslmode=disable&HOST=db.prod.internal",
      "?host=%2Fvar%2Frun%2Fpostgresql",
    ]) {
      expect(devSessionProblem({ ...DEV, DATABASE_URL: `${LOCAL}${query}` }), query).toBe(
        "refusing to run: DATABASE_URL must not set host, hostaddr or port as query parameters",
      );
    }
    expect(devSessionProblem({ ...DEV, DATABASE_URL: `${LOCAL}?sslmode=disable` })).toBeUndefined();
  });

  it("runs in development against localhost, 127.0.0.1 or [::1]", () => {
    expect(devSessionProblem({ ...DEV, DATABASE_URL: LOCAL })).toBeUndefined();
    expect(devSessionProblem({ ...DEV, DATABASE_URL: LOCAL.replace("localhost", "127.0.0.1") })).toBeUndefined();
    expect(devSessionProblem({ ...DEV, DATABASE_URL: LOCAL.replace("localhost", "[::1]") })).toBeUndefined();
  });

  it("never echoes the database URL in its messages", () => {
    const messages = [
      devSessionProblem({ ...DEV, DATABASE_URL: "postgresql://u:hunter2@db.example:5432/x" }),
      devSessionProblem({ ...DEV, DATABASE_URL: "postgresql://u:hunter2@localhost:5432/x?host=db.example" }),
    ].join("\n");

    expect(messages).not.toContain("hunter2");
    expect(messages).not.toContain("db.example");
  });
});
