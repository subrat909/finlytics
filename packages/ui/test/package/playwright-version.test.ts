import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PACKAGE_DIR } from "./package-files";

/**
 * The visual baselines are only valid in one Playwright image (plan D18). Its tag carries the Playwright version, so a
 * bump of the npm packages without the image (or the reverse) would compare screenshots from different browsers.
 */
const REPO_DIR = path.resolve(PACKAGE_DIR, "../..");
const require = createRequire(import.meta.url);

interface ImagePin {
  readonly image: string;
  readonly digest: string;
  readonly platform: string;
}

function catalogVersion(name: string): string | undefined {
  const workspace = readFileSync(path.join(REPO_DIR, "pnpm-workspace.yaml"), "utf8");
  const quoted = name.replace(/[/@]/g, (character) => `\\${character}`);
  return new RegExp(`^\\s+"?${quoted}"?:\\s*"?([^"\\s]+)"?\\s*$`, "m").exec(workspace)?.[1];
}

function installedVersion(name: string): string {
  return (require(`${name}/package.json`) as { version: string }).version;
}

describe("Playwright version", () => {
  it("uses one Playwright version in package.json, the Docker image tag and ci.yml", () => {
    const pin = JSON.parse(
      readFileSync(path.join(PACKAGE_DIR, "test/visual/playwright-image.json"), "utf8"),
    ) as ImagePin;
    const tagVersion = /^mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble$/.exec(pin.image)?.[1];
    const ci = readFileSync(path.join(REPO_DIR, ".github/workflows/ci.yml"), "utf8");
    const ciImages = [...ci.matchAll(/image:\s*(mcr\.microsoft\.com\/playwright:\S+)/g)].map((match) => match[1]);

    expect(tagVersion, "playwright-image.json names a vX.Y.Z-noble tag").toBeDefined();
    expect(catalogVersion("playwright")).toBe(tagVersion);
    expect(catalogVersion("@playwright/test")).toBe(tagVersion);
    expect(installedVersion("playwright")).toBe(tagVersion);
    expect(installedVersion("@playwright/test")).toBe(tagVersion);
    expect(pin.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(ciImages).toEqual([`${pin.image}@${pin.digest}`]);
  });

  it("runs the visual suite on the platform of CI's runners", () => {
    const pin = JSON.parse(
      readFileSync(path.join(PACKAGE_DIR, "test/visual/playwright-image.json"), "utf8"),
    ) as ImagePin;
    const ci = readFileSync(path.join(REPO_DIR, ".github/workflows/ci.yml"), "utf8");

    // GitHub's ubuntu-24.04 runners are x86-64; scripts/visual.mjs runs the image as linux/amd64 everywhere else.
    expect(pin.platform).toBe("linux/amd64");
    expect(ci).toMatch(/ui:\n(?:.*\n)*?\s+runs-on: ubuntu-24\.04\n/);
  });
});
