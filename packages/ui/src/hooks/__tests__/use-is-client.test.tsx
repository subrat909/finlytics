import { act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { useIsClient } from "../use-is-client";

describe("useIsClient", () => {
  it("returns false on the server and during hydration, then true", async () => {
    const renders: boolean[] = [];
    function Probe() {
      const isClient = useIsClient();
      renders.push(isClient);
      return <span>{isClient ? "client" : "server"}</span>;
    }

    const container = document.createElement("div");
    container.innerHTML = renderToString(<Probe />);
    document.body.append(container);
    expect(renders).toEqual([false]);
    expect(container).toHaveTextContent("server");

    await act(async () => {
      hydrateRoot(container, <Probe />);
      await Promise.resolve();
    });

    // The hydration render must match the server HTML; only the renders after it may see the client.
    expect(renders[1]).toBe(false);
    expect(renders.at(-1)).toBe(true);
    expect(container).toHaveTextContent("client");
    container.remove();
  });
});
