import type { BrokerAccountView } from "@finlytics/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockApi, problem } from "@/test/api-mock";
import { expectNoAxeViolations } from "@/test/axe";
import { navigation, nextNavigationMock, router } from "@/test/next-mocks";
import { renderWithProviders } from "@/test/render";
import { toast } from "@/stores/toast.store";

import { BrokersView, callbackErrorMessage } from "../components/brokers-view";
import { NeedsReloginBanner, accountsNeedingLogin } from "../components/needs-relogin-banner";

vi.mock("next/navigation", () => nextNavigationMock);

const NOW = Date.UTC(2026, 9, 6, 6, 0);
const UPSTOX: BrokerAccountView = {
  id: "acc_up",
  broker: "UPSTOX",
  label: "Main",
  status: "ACTIVE",
  isDefault: true,
  tokenExpiresAt: "2026-10-06T22:00:00.000Z",
  lastLoginAt: "2026-10-06T03:00:00.000Z",
  lastError: null,
};
const DHAN: BrokerAccountView = {
  id: "acc_dh",
  broker: "DHAN",
  label: "Dhan swing",
  status: "ACTIVE",
  isDefault: false,
  tokenExpiresAt: "2026-10-08T00:00:00.000Z",
  lastLoginAt: null,
  lastError: null,
};
const AUTH_URL = "https://api.upstox.com/v2/login/authorization/dialog?client_id=x&state=y";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  navigation.pathname = "/brokers";
});

afterEach(() => {
  vi.useRealTimers();
  act(() => {
    toast.clear();
  });
});

describe("BrokersView", () => {
  it("shows a shaped skeleton, then the account cards with status, expiry and actions", async () => {
    mockApi([{ path: "/v1/brokers", respond: () => Response.json([UPSTOX, DHAN]) }]);
    const { container } = renderWithProviders(<BrokersView />);
    expect(screen.getByRole("status", { name: "Loading broker accounts" })).toBeInTheDocument();

    const list = await screen.findByRole("list", { name: "Broker accounts" });
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    const upstox = within(cards[0] as HTMLElement);
    expect(upstox.getByRole("heading", { name: "Main" })).toBeInTheDocument();
    expect(upstox.getByText("Connected")).toBeInTheDocument();
    expect(upstox.getByText("Default")).toBeInTheDocument();
    expect(upstox.getByText("7 Oct 2026, 03:30 IST")).toBeInTheDocument();
    const dhan = within(cards[1] as HTMLElement);
    // Within three days: called out.
    expect(container.querySelector('[data-account-id="acc_dh"] [data-slot="broker-expiry"]')).toHaveAttribute(
      "data-expiry",
      "soon",
    );
    expect(dhan.getByRole("button", { name: "Make default" })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("shows the empty state with a CTA that opens the wizard", async () => {
    const actor = userEvent.setup();
    mockApi([{ path: "/v1/brokers", respond: () => Response.json([]) }]);
    renderWithProviders(<BrokersView />);
    await actor.click(await screen.findByRole("button", { name: "Add a broker" }));
    const dialog = screen.getByRole("dialog", { name: "Add a broker" });
    expect(within(dialog).getByRole("button", { name: /Upstox/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Dhan/ })).toBeInTheDocument();
  });

  it("shows a retryable error", async () => {
    const actor = userEvent.setup();
    let fail = true;
    mockApi([
      {
        path: "/v1/brokers",
        respond: () => (fail ? problem(500, "INTERNAL") : Response.json([UPSTOX])),
      },
    ]);
    const { container } = renderWithProviders(<BrokersView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Your broker accounts didn't load");
    expect(screen.getByText("req-12345678")).toBeInTheDocument();
    await expectNoAxeViolations(container);
    fail = false;
    await actor.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Main" })).toBeInTheDocument();
  });

  it("checks a pasted token's shape with the shared schema", async () => {
    const actor = userEvent.setup();
    mockApi([{ path: "/v1/brokers", respond: () => Response.json([]) }]);
    renderWithProviders(<BrokersView />);
    await actor.click(await screen.findByRole("button", { name: "Add a broker" }));
    await actor.click(screen.getByRole("button", { name: /Dhan/ }));
    await actor.type(screen.getByLabelText("Client ID"), "1000012345");
    await actor.type(screen.getByLabelText("Access token"), "short");
    await actor.click(screen.getByRole("button", { name: "Connect Dhan" }));
    expect(await screen.findByText("That doesn't look like a Dhan access token")).toBeInTheDocument();
  });

  it("validates the Dhan form, then connects and announces it", async () => {
    const actor = userEvent.setup();
    const calls = mockApi([
      { path: "/v1/brokers", respond: () => Response.json([]) },
      { method: "POST", path: "/v1/brokers/dhan", respond: () => Response.json({ ...DHAN, label: "Dhan" }) },
    ]);
    const { baseElement } = renderWithProviders(<BrokersView />);
    await actor.click(await screen.findByRole("button", { name: "Add a broker" }));
    await actor.click(screen.getByRole("button", { name: /Dhan/ }));
    const dialog = screen.getByRole("dialog", { name: "Connect Dhan" });

    await actor.click(within(dialog).getByRole("button", { name: "Connect Dhan" }));
    const token = within(dialog).getByLabelText("Access token");
    expect(token).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByText("Paste the access token from the Dhan dashboard")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter your Dhan client ID")).toBeInTheDocument();
    await expectNoAxeViolations(baseElement);

    await actor.type(within(dialog).getByLabelText("Client ID"), "1000012345");
    await actor.type(token, "eyJhbGciOiJIUzUxMiJ9.payload.signature");
    await actor.click(within(dialog).getByRole("button", { name: "Connect Dhan" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      label: "Dhan",
      clientId: "1000012345",
      accessToken: "eyJhbGciOiJIUzUxMiJ9.payload.signature",
    });
    expect(await screen.findByText("Dhan connected")).toBeInTheDocument();
  });

  it("shows the broker's refusal in the Dhan form", async () => {
    const actor = userEvent.setup();
    mockApi([
      { path: "/v1/brokers", respond: () => Response.json([]) },
      { method: "POST", path: "/v1/brokers/dhan", respond: () => problem(422, "BROKER_REJECTED") },
    ]);
    renderWithProviders(<BrokersView />);
    await actor.click(await screen.findByRole("button", { name: "Add a broker" }));
    await actor.click(screen.getByRole("button", { name: /Dhan/ }));
    const dialog = screen.getByRole("dialog", { name: "Connect Dhan" });
    await actor.type(within(dialog).getByLabelText("Client ID"), "1000012345");
    await actor.type(within(dialog).getByLabelText("Access token"), "eyJhbGciOiJIUzUxMiJ9.payload.signature");
    await actor.click(within(dialog).getByRole("button", { name: "Connect Dhan" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Dhan didn't accept these credentials");
  });

  it("sends the Upstox app's key and secret, then goes to the Upstox login", async () => {
    const actor = userEvent.setup();
    const navigate = vi.fn();
    const calls = mockApi([
      { path: "/v1/brokers", respond: () => Response.json([]) },
      {
        method: "POST",
        path: "/v1/brokers/upstox",
        respond: () => Response.json({ account: { ...UPSTOX, status: "PENDING" }, authUrl: AUTH_URL }),
      },
    ]);
    renderWithProviders(<BrokersView navigate={navigate} />);
    await actor.click(await screen.findByRole("button", { name: "Add a broker" }));
    await actor.click(screen.getByRole("button", { name: /Upstox/ }));
    const dialog = screen.getByRole("dialog", { name: "Connect Upstox" });
    expect(within(dialog).getByText(`${window.location.origin}/v1/brokers/upstox/callback`)).toBeInTheDocument();

    await actor.click(within(dialog).getByRole("button", { name: "Back" }));
    await actor.click(screen.getByRole("button", { name: /Upstox/ }));
    await actor.type(screen.getByLabelText("API key"), "my-api-key");
    await actor.type(screen.getByLabelText("API secret"), "my-api-secret");
    await actor.click(screen.getByRole("button", { name: "Continue to Upstox" }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(AUTH_URL);
    });
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      label: "Upstox",
      apiKey: "my-api-key",
      apiSecret: "my-api-secret",
    });
  });

  it("announces the OAuth callback once and drops the query parameter", async () => {
    mockApi([{ path: "/v1/brokers", respond: () => Response.json([UPSTOX]) }]);
    renderWithProviders(<BrokersView connectedId="acc_up" />);
    expect(await screen.findByText("Upstox connected")).toBeInTheDocument();
    expect(screen.getByText(/“Main” is ready/)).toBeInTheDocument();
    expect(router.replace).toHaveBeenCalledWith("/brokers", { scroll: false });
  });

  it("explains a failed OAuth callback", async () => {
    mockApi([{ path: "/v1/brokers", respond: () => Response.json([]) }]);
    renderWithProviders(<BrokersView connectError="state_invalid" />);
    expect(await screen.findByText("The broker login didn't finish")).toBeInTheDocument();
    expect(screen.getByText(callbackErrorMessage("state_invalid"))).toBeInTheDocument();
    expect(callbackErrorMessage("bogus")).toBe("Nothing was saved. Try connecting again.");
  });

  it("logs in again, makes default and removes (confirmed)", async () => {
    const actor = userEvent.setup();
    const navigate = vi.fn();
    const expired: BrokerAccountView = { ...UPSTOX, status: "NEEDS_RELOGIN", isDefault: false };
    const calls = mockApi([
      {
        path: "/v1/brokers",
        respond: () => Response.json([expired, { ...DHAN, status: "ERROR", lastError: "Token revoked" }]),
      },
      {
        method: "POST",
        path: "/v1/brokers/acc_up/relogin",
        respond: () => Response.json({ account: expired, authUrl: AUTH_URL }),
      },
      { method: "DELETE", path: "/v1/brokers/acc_dh", respond: () => new Response(null, { status: 204 }) },
    ]);
    renderWithProviders(<BrokersView navigate={navigate} />);
    expect(await screen.findByText("Token revoked")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Log in again" }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(AUTH_URL);
    });

    const dhanCard = screen.getByRole("heading", { name: "Dhan swing" }).closest('[data-slot="broker-card"]');
    await actor.click(within(dhanCard as HTMLElement).getByRole("button", { name: "Remove" }));
    const confirm = screen.getByRole("alertdialog", { name: "Remove “Dhan swing”?" });
    await actor.click(within(confirm).getByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(calls.some((call) => call.method === "DELETE")).toBe(true);
    });
    expect(await screen.findByText("Removed “Dhan swing”")).toBeInTheDocument();
  });

  it("makes an account the default", async () => {
    const actor = userEvent.setup();
    const calls = mockApi([
      { path: "/v1/brokers", respond: () => Response.json([UPSTOX, DHAN]) },
      { method: "PATCH", path: "/v1/brokers/acc_dh", respond: () => Response.json({ ...DHAN, isDefault: true }) },
    ]);
    renderWithProviders(<BrokersView />);
    await actor.click(await screen.findByRole("button", { name: "Make default" }));
    await waitFor(() => {
      expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ isDefault: true });
    });
    expect(await screen.findByText("“Dhan swing” is now your default broker")).toBeInTheDocument();
  });

  it("opens the Dhan form with the account's label to paste a new token", async () => {
    const actor = userEvent.setup();
    mockApi([{ path: "/v1/brokers", respond: () => Response.json([{ ...DHAN, status: "EXPIRED" }]) }]);
    renderWithProviders(<BrokersView />);
    await actor.click(await screen.findByRole("button", { name: "Paste a new token" }));
    const dialog = screen.getByRole("dialog", { name: "Connect Dhan" });
    expect(within(dialog).getByLabelText("Account name")).toHaveValue("Dhan swing");
    expect(within(dialog).queryByRole("button", { name: "Back" })).toBeNull();
  });
});

describe("NeedsReloginBanner", () => {
  it("is empty while every session is fine, and on /brokers", async () => {
    const calls = mockApi([
      { path: "/v1/brokers", respond: () => Response.json([{ ...UPSTOX, status: "NEEDS_RELOGIN" }]) },
    ]);
    renderWithProviders(<NeedsReloginBanner />);
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    await act(() => Promise.resolve());
    expect(screen.queryByRole("region")).toBeNull();
    expect(accountsNeedingLogin([UPSTOX])).toEqual([]);
  });

  it("offers the one-click Upstox login", async () => {
    navigation.pathname = "/watchlists";
    const actor = userEvent.setup();
    const navigate = vi.fn();
    const expired = { ...UPSTOX, status: "NEEDS_RELOGIN" as const };
    mockApi([
      { path: "/v1/brokers", respond: () => Response.json([expired]) },
      {
        method: "POST",
        path: "/v1/brokers/acc_up/relogin",
        respond: () => Response.json({ account: expired, authUrl: AUTH_URL }),
      },
    ]);
    const { container } = renderWithProviders(<NeedsReloginBanner navigate={navigate} />);
    const banner = await screen.findByRole("region", { name: "Broker login needed" });
    expect(banner).toHaveTextContent("Your Upstox session “Main” has ended");
    await expectNoAxeViolations(container);
    await actor.click(within(banner).getByRole("button", { name: "Log in to Upstox" }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(AUTH_URL);
    });
  });

  it("links to the brokers page when several sessions ended, and shows a failed relogin", async () => {
    navigation.pathname = "/dashboard";
    mockApi([
      {
        path: "/v1/brokers",
        respond: () =>
          Response.json([
            { ...UPSTOX, status: "NEEDS_RELOGIN" },
            { ...DHAN, status: "EXPIRED" },
          ]),
      },
    ]);
    renderWithProviders(<NeedsReloginBanner />);
    const banner = await screen.findByRole("region", { name: "Broker login needed" });
    expect(banner).toHaveTextContent("2 broker sessions have ended");
    expect(within(banner).getByRole("link", { name: "Review brokers" })).toHaveAttribute("href", "/brokers");
  });
});
