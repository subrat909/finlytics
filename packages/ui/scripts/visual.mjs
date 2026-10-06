// `pnpm test:visual`: runs the visual suite (playwright.visual.config.ts) where its baselines are valid, inside the
// pinned Playwright image (test/visual/playwright-image.json, plan D15).
// - Already inside the image (CI's `ui` job container): runs Playwright directly.
// - Elsewhere: runs it in that image with Docker, with the repo mounted at /repo. Always linux/amd64, the platform of
//   CI's runners, so a baseline made on an Apple-silicon Mac (emulated) matches CI's pixels.
//   The container has no network (`--network none`: the suite only talks to its own server on the container's
//   loopback), and every local env file in the mounted repo (.env, .env.local, …; never .env.example) is masked with
//   an empty read-only file, so nothing in the image can read secrets or send anything anywhere.
// Extra arguments go to `playwright test`: `pnpm test:visual -- --update-snapshots`, `-- --grep button`.
// Needs storybook-static/ (turbo runs build-storybook first).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UI_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO_DIR = path.resolve(UI_DIR, "../..");
const { image, digest, platform } = JSON.parse(
  readFileSync(path.join(UI_DIR, "test/visual/playwright-image.json"), "utf8"),
);
const PLAYWRIGHT = ["node_modules/@playwright/test/cli.js", "test", "-c", "playwright.visual.config.ts"];
const args = process.argv.slice(2).filter((arg) => arg !== "--");

if (!existsSync(path.join(UI_DIR, "storybook-static", "index.json"))) {
  console.error("storybook-static/ is missing: run `pnpm --filter @finlytics/ui build-storybook` first.");
  process.exit(1);
}

const insideImage = process.env.PLAYWRIGHT_BROWSERS_PATH === "/ms-playwright" && existsSync("/ms-playwright");

/** Local env files (by name only; never read) in the repo root and each app and package: .env, .env.local, … */
function envFiles() {
  const dirs = [
    ".",
    ...["apps", "packages"].flatMap((group) => {
      const groupDir = path.join(REPO_DIR, group);
      if (!existsSync(groupDir)) return [];
      return readdirSync(groupDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(group, entry.name));
    }),
  ];
  return dirs.flatMap((dir) =>
    readdirSync(path.join(REPO_DIR, dir), { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^\.env(\..+)?$/.test(entry.name) && !entry.name.endsWith(".example"))
      .map((entry) => path.posix.join(dir.split(path.sep).join("/"), entry.name)),
  );
}

/** Mounts an empty read-only file over each env file that exists. Only existing ones: Docker would create the others
 *  as empty files in the host's checkout. */
function envMasks() {
  return envFiles().flatMap((file) => ["-v", `/dev/null:${path.posix.join("/repo", file)}:ro`]);
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: UI_DIR, stdio: "inherit" });
  if (result.error) {
    console.error(`Could not run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

if (insideImage) {
  run(process.execPath, [...PLAYWRIGHT, ...args]);
} else {
  // On Linux hosts, write test results and baselines as the calling user, not root. Docker Desktop maps ownership.
  const user =
    process.platform === "linux" && typeof process.getuid === "function"
      ? ["--user", `${String(process.getuid())}:${String(process.getgid?.() ?? process.getuid())}`, "-e", "HOME=/tmp"]
      : [];
  run("docker", [
    "run",
    "--rm",
    "--init",
    "--ipc=host",
    "--network",
    "none",
    "--platform",
    platform,
    ...user,
    ...(process.env.CI ? ["-e", "CI"] : []),
    "-v",
    `${REPO_DIR}:/repo`,
    ...envMasks(),
    "-w",
    "/repo/packages/ui",
    `${image}@${digest}`,
    "node",
    ...PLAYWRIGHT,
    ...args,
  ]);
}
