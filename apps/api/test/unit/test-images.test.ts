/** Tests and local development run the same Redis (plan D16): the Testcontainers tag is the compose one. */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { REDIS_IMAGE } from "../integration/containers";

describe("test images", () => {
  it("uses the same Redis image in compose and Testcontainers", () => {
    const compose = readFileSync(path.resolve(__dirname, "../../../../docker-compose.yml"), "utf8");
    const redisService = /^\s{2}redis:\s*\n\s+image:\s*(\S+)/m.exec(compose)?.[1];

    expect(redisService).toBe(REDIS_IMAGE);
  });
});
