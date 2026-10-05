import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TIMESCALE_IMAGE } from "../../test/integration/timescale-image";

const COMPOSE_FILE = fileURLToPath(new URL("../../../../docker-compose.yml", import.meta.url));

/**
 * The `image:` of the `postgres` service, read without a YAML parser: from the 2-space-indented `postgres:` key, skip
 * blank, comment and deeper-indented lines (disjoint alternatives, so no backtracking blow-up) up to the service's own
 * 4-space-indented `image:`. The match fails rather than run into the next service, whose key is back at 2 spaces.
 */
const POSTGRES_SERVICE_IMAGE =
  /^ {2}postgres:[ \t]*(?:#.*)?\r?\n(?:(?:[ \t]*| *#.*| {4,}[^\s#].*)\r?\n)*? {4}image:[ \t]*["']?([^\s"'#]+)/m;

function composePostgresImage(): string | undefined {
  return POSTGRES_SERVICE_IMAGE.exec(readFileSync(COMPOSE_FILE, "utf8"))?.[1];
}

describe("Testcontainers image", () => {
  it("uses the same pinned Timescale image in compose and Testcontainers", () => {
    expect(composePostgresImage()).toBe(TIMESCALE_IMAGE);
    // Pinned to exact PostgreSQL and TimescaleDB versions: a floating tag (pg16, latest) would change the extension
    // version under existing volumes (plan D18).
    expect(TIMESCALE_IMAGE).toMatch(/^timescale\/timescaledb-ha:pg\d+\.\d+-ts\d+\.\d+\.\d+$/);
  });
});
