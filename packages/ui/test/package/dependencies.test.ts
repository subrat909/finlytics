import { describe, expect, it } from "vitest";

import { readManifest } from "./package-files";

/**
 * Runtime dependencies a consumer installs with @finlytics/ui (plan §2b). Anything else, such as the `cn` package or
 * `@radix-ui/*` that a shadcn generator adds, is rejected (plan D8).
 */
const RUNTIME_DEPENDENCIES = [
  "@finlytics/shared",
  "@fontsource-variable/inter",
  "@fontsource-variable/jetbrains-mono",
  "class-variance-authority",
  "clsx",
  "lucide-react",
  "next-themes",
  "radix-ui",
  "tailwind-merge",
  "tailwindcss",
  "tw-animate-css",
];

const manifest = readManifest();

describe("dependencies", () => {
  it("declares only allowlisted runtime dependencies, all from the catalog or the workspace", () => {
    expect(Object.keys(manifest.dependencies).sort()).toEqual([...RUNTIME_DEPENDENCIES].sort());

    const specs = { ...manifest.dependencies, ...manifest.devDependencies };
    const unpinned = Object.entries(specs).filter(
      ([name, spec]) => spec !== "catalog:" && !(name.startsWith("@finlytics/") && spec === "workspace:*"),
    );
    expect(unpinned).toEqual([]);
  });

  it("takes React from the consumer as a peer", () => {
    expect(manifest.peerDependencies).toEqual({ react: "^19.2.0", "react-dom": "^19.2.0" });
    expect(manifest.dependencies).not.toHaveProperty("react");
    expect(manifest.dependencies).not.toHaveProperty("react-dom");
  });
});
