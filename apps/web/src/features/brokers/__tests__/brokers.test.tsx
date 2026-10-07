import type { BrokerAccountView } from "@finlytics/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_URL, DHAN, LIMITS, NOW, UPSTOX, overview } from "@/features/dashboard/__tests__/fixtures";
import { mockApi, problem } from "@/test/api-mock";
import type { ApiRoute } from "@/test/api-mock";
import { expectNoAxeViolations } from "@/test/axe";
import { navigation, nextNavigationMock, router } from "@/test/next-mocks";
import { renderWithProviders } from "@/test/render";
import { toast } from "@/stores/toast.store";

import { BrokersView, callbackErrorMessage } from "../components/brokers-view";
import { NeedsReloginBanner, accountsNeedingLogin } from "../components/needs-relogin-banner";

vi.mock("next/navigation", () => nextNavigationMock);

const VALID_TOKEN = "eyJhbGciOiJIUzUxMiJ9.payload.signature";

/** The page's reads: the account list, the plan limits and the market overview (for the feed marker). */
function pageRoutes(accounts: BrokerAccountView[], extra: ApiRoute[] = [], limits = LIMITS): ApiRoute[] {
  return [
    ...extra,
    { path: "/v1/brokers", respond: () => Response.json(accounts) },
    { path: "/v1/brokers/limits", respond: () => Response.json(limits) },
    { path: "/v1/market/overview", respond: () => Response.json(overview(true)) },
  ];
}

function rowOf(label: string): HTMLElement {
  const row = screen.getByText(label, { selector: '[data-slot="broker-account-label"]' }).closest('[role="row"]');
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${label}`);
  return row;
}

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
  it("shows a shaped skeleton, then the accounts table with status, session, last login, feed and plan usage", async () => {
    mockApi(pageRoutes([UPSTOX, DHAN]));
    const { container } = renderWithProviders(<BrokersView />);
    expect(screen.getByRole("status", { name: "Loading broker accounts" })).toBeInTheDocument();

    const table = await screen.findByRole("table", { name: "Broker accounts" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Account", "Status", "Session", "Last login", "Market data", "Actions"]);
    const upstox = within(rowOf("Main"));
    expect(upstox.getByText("Connected")).toBeInTheDocument();
    expect(upstox.getByText("Default")).toBeInTheDocument();
    expect(upstox.getByText("Ends in 16h 00m")).toBeInTheDocument();
    expect(upstox.getByText("6 Oct 2026, 08:30 IST")).toBeInTheDocument();
    expect(await upstox.findByText("Feeds market data")).toBeInTheDocument();
    expect(upstox.getByRole("meter", { name: "Session time left" })).toHaveAttribute("aria-valuenow", "84");

    // Dhan's token ends within two hours: called out (the renewal job is due).
    const dhan = rowOf("Dhan swing");
    expect(dhan.querySelector('[data-slot="broker-session"]')).toHaveAttribute("data-session", "soon");
    expect(within(dhan).queryByText("Feeds market data")).toBeNull();

    expect(await screen.findByText("1 of 2 broker accounts")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Broker accounts used" })).toHaveAttribute("aria-valuenow", "50");
    const catalog = screen.getByRole("list", { name: "Supported brokers" });
    expect(within(catalog).getByRole("button", { name: "Connect Upstox" })).toBeInTheDocument();
    expect(within(catalog).getByRole("button", { name: "Add paper account" })).toBeInTheDocument();
    expect(within(catalog).getAllByText("Coming soon")).toHaveLength(3);
    await expectNoAxeViolations(container);
  });

  it("shows the empty state with a CTA that opens the wizard on the broker picker", async () => {
    const actor = userEvent.setup();
    mockApi(pageRoutes([], [], { ...LIMITS, brokerAccounts: 0 }));
    const { baseElement } = renderWithProviders(<BrokersView />);
    await actor.click(await screen.findByRole("button", { name: "Connect your first broker" }));
    const dialog = screen.getByRole("dialog", { name: "Connect a broker" });
    const options = within(within(dialog).getByRole("list", { name: "Brokers" })).getAllByRole("button");
    expect(options.map((option) => option.getAttribute("data-broker"))).toEqual(["UPSTOX", "DHAN", "PAPER"]);
    expect(within(dialog).getByText("Coming soon: Zerodha, Angel One, Fyers.")).toBeInTheDocument();
    await expectNoAxeViolations(baseElement);
  });

  it("shows a retryable error", async () => {
    const actor = userEvent.setup();
    let fail = true;
    mockApi([
      { path: "/v1/brokers", respond: () => (fail ? problem(500, "INTERNAL") : Response.json([UPSTOX])) },
      { path: "/v1/brokers/limits", respond: () => Response.json(LIMITS) },
    ]);
    const { container } = renderWithProviders(<BrokersView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Your broker accounts didn't load");
    expect(screen.getByText("req-12345678")).toBeInTheDocument();
    await expectNoAxeViolations(container);
    fail = false;
    await actor.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table", { name: "Broker accounts" })).toBeInTheDocument();
  });

  it("disables connecting a real broker at the plan limit and says why; paper is still open", async () => {
    const actor = userEvent.setup();
    const full = { ...LIMITS, brokerAccounts: 2 };
    mockApi(pageRoutes([UPSTOX, DHAN], [], full));
    renderWithProviders(<BrokersView />);
    const reason = "Your plan allows 2 broker accounts, all in use. Remove one to connect another.";
    const connect = await screen.findByRole("button", { name: "Connect broker" });
    await waitFor(() => {
      expect(connect).toHaveAttribute("aria-disabled", "true");
    });
    expect(connect).toHaveAccessibleDescription(`${reason} Paper accounts don't count towards it.`);
    expect(screen.getByText("2 of 2 broker accounts")).toBeInTheDocument();
    await actor.click(connect);
    expect(screen.queryByRole("dialog")).toBeNull();

    const catalog = screen.getByRole("list", { name: "Supported brokers" });
    expect(within(catalog).getByRole("button", { name: "Connect Dhan" })).toHaveAccessibleDescription(reason);
    await actor.click(within(catalog).getByRole("button", { name: "Add paper account" }));
    expect(screen.getByRole("dialog", { name: "Add a paper account" })).toBeInTheDocument();
  });

  it("walks the Dhan steps: instructions, then the form validated like the api, then connects", async () => {
    const actor = userEvent.setup();
    const calls = mockApi(
      pageRoutes(
        [],
        [{ method: "POST", path: "/v1/brokers/dhan", respond: () => Response.json({ ...DHAN, label: "Dhan" }) }],
        {
          ...LIMITS,
          brokerAccounts: 0,
        },
      ),
    );
    const { baseElement } = renderWithProviders(<BrokersView />);
    await actor.click(await screen.findByRole("button", { name: "Connect broker" }));
    await actor.click(screen.getByRole("button", { name: /Dhan/ }));
    const dialog = screen.getByRole("dialog", { name: "Connect Dhan" });
    const steps = within(dialog).getByRole("list", { name: "Steps" });
    expect(within(steps).getByText("Generate token").closest("li")).toHaveAttribute("aria-current", "step");
    expect(within(dialog).getByRole("link", { name: /web\.dhan\.co/ })).toHaveAttribute("href", "https://web.dhan.co");
    await expectNoAxeViolations(baseElement);

    await actor.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(within(steps).getByText("Enter details").closest("li")).toHaveAttribute("aria-current", "step");
    await actor.click(within(dialog).getByRole("button", { name: "Connect Dhan" }));
    const token = within(dialog).getByLabelText("Access token");
    expect(token).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByText("Paste the access token from the Dhan dashboard")).toBeInTheDocument();
    // The client ID is optional: the api reads it from the token.
    expect(within(dialog).getByLabelText("Client ID")).not.toHaveAttribute("aria-invalid");
    expect(within(dialog).getByLabelText("Client ID")).toHaveAccessibleDescription("Optional — read from your token.");
    expect(token).toHaveAccessibleDescription(/Valid 24 hours, renewed automatically/);

    await actor.type(within(dialog).getByLabelText("Client ID"), "1000012345");
    await actor.type(token, "short");
    await actor.click(within(dialog).getByRole("button", { name: "Connect Dhan" }));
    expect(await within(dialog).findByText("That doesn't look like a Dhan access token")).toBeInTheDocument();

    await actor.clear(token);
    await actor.type(token, VALID_TOKEN);
    await actor.click(within(dialog).getByRole("button", { name: "Connect Dhan" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      label: "Dhan",
      clientId: "1000012345",
      accessToken: VALID_TOKEN,
    });
    expect(await screen.findByText("Dhan connected")).toBeInTheDocument();
  });

  it("accepts a pasted Bearer token without a client ID, and checks a client ID that is given", async () => {
    const actor = userEvent.setup();
    const calls = mockApi(
      pageRoutes(
        [],
        [{ method: "POST", path: "/v1/brokers/dhan", respond: () => Response.json({ ...DHAN, label: "Dhan" }) }],
      ),
    );
    renderWithProviders(<BrokersView />);
    await actor.click(await screen.findByRole("button", { name: "Connect broker" }));
    await actor.click(screen.getByRole("button", { name: /Dhan/ }));
    const dialog = screen.getByRole("dialog", { name: "Connect Dhan" });
    await actor.click(within(dialog).getByRole("button", { name: "Next" }));

    await actor.type(within(dialog).getByLabelText("Client ID"), "10-00");
    await actor.type(within(dialog).getByLabelText("Access token"), `  "Bearer ${VALID_TOKEN}"  `);
    await actor.click(within(dialog).getByRole("button", { name: "Connect Dhan" }));
    expect(
      await within(dialog).findByText("Use the client ID from Dhan (letters and digits), or leave it empty"),
    ).toBeInTheDocument();

    await actor.clear(within(dialog).getByLabelText("Client ID"));
    await actor.click(within(dialog).getByRole("button", { name: "Connect Dhan" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    const body = calls.find((call) => call.method === "POST")?.body;
    expect(body).toEqual({ label: "Dhan", accessToken: VALID_TOKEN });
    expect(body).not.toHaveProperty("clientId");
  });

  it.each([
    [problem(422, "BROKER_REJECTED"), "Dhan didn't accept these credentials. Check them and try again."],
    [
      problem(403, "FORBIDDEN", { detail: "Your plan allows 2 broker accounts." }),
      "Your plan allows 2 broker accounts.",
    ],
    [problem(503, "BROKER_UNAVAILABLE"), "Dhan isn't answering right now. Try again in a minute."],
  ])("explains a refused Dhan connection (%#)", async (response, message) => {
    const actor = userEvent.setup();
    mockApi(pageRoutes([], [{ method: "POST", path: "/v1/brokers/dhan", respond: () => response.clone() }]));
    renderWithProviders(<BrokersView />);
    await actor.click(await screen.findByRole("button", { name: "Connect broker" }));
    await actor.click(screen.getByRole("button", { name: /Dhan/ }));
    const dialog = screen.getByRole("dialog", { name: "Connect Dhan" });
    await actor.click(within(dialog).getByRole("button", { name: "Next" }));
    await actor.type(within(dialog).getByLabelText("Client ID"), "1000012345");
    await actor.type(within(dialog).getByLabelText("Access token"), VALID_TOKEN);
    await actor.click(within(dialog).getByRole("button", { name: "Connect Dhan" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(message);
  });

  it("walks the Upstox steps: create the app, copy the exact redirect URL, keys, then the Upstox login", async () => {
    const actor = userEvent.setup();
    const navigate = vi.fn();
    const calls = mockApi(
      pageRoutes(
        [],
        [
          {
            method: "POST",
            path: "/v1/brokers/upstox",
            respond: () => Response.json({ account: { ...UPSTOX, status: "PENDING" }, authUrl: AUTH_URL }),
          },
        ],
      ),
    );
    renderWithProviders(<BrokersView navigate={navigate} />);
    await actor.click(await screen.findByRole("button", { name: "Connect broker" }));
    await actor.click(screen.getByRole("button", { name: /Upstox/ }));
    const dialog = screen.getByRole("dialog", { name: "Connect Upstox" });
    expect(within(dialog).getByRole("link", { name: /Upstox developer console/ })).toHaveAttribute(
      "href",
      "https://account.upstox.com/developer/apps",
    );
    await actor.click(within(dialog).getByRole("button", { name: "Next" }));

    const redirect = within(dialog).getByLabelText("Redirect URL");
    expect(redirect).toHaveValue(`${window.location.origin}/v1/brokers/upstox/callback`);
    await actor.click(within(dialog).getByRole("button", { name: "Copy" }));
    expect(await within(dialog).findByRole("button", { name: "Copied" })).toBeInTheDocument();
    await expect(navigator.clipboard.readText()).resolves.toBe(`${window.location.origin}/v1/brokers/upstox/callback`);

    await actor.click(within(dialog).getByRole("button", { name: "I've set it" }));
    await actor.type(within(dialog).getByLabelText("API key"), "my-api-key");
    await actor.type(within(dialog).getByLabelText("API secret"), "my-api-secret");
    await actor.click(within(dialog).getByRole("button", { name: "Continue to Upstox" }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(AUTH_URL);
    });
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      label: "Upstox",
      apiKey: "my-api-key",
      apiSecret: "my-api-secret",
    });
    const steps = within(dialog).getByRole("list", { name: "Steps" });
    expect(within(steps).getByText("Log in").closest("li")).toHaveAttribute("aria-current", "step");
  });

  it("adds a paper account from the catalog", async () => {
    const actor = userEvent.setup();
    const paper: BrokerAccountView = { ...UPSTOX, id: "acc_pa", broker: "PAPER", label: "Paper", isDefault: false };
    const calls = mockApi(
      pageRoutes([], [{ method: "POST", path: "/v1/brokers/paper", respond: () => Response.json(paper) }]),
    );
    renderWithProviders(<BrokersView />);
    const catalog = await screen.findByRole("list", { name: "Supported brokers" });
    await actor.click(within(catalog).getByRole("button", { name: "Add paper account" }));
    const dialog = screen.getByRole("dialog", { name: "Add a paper account" });
    expect(within(dialog).getByLabelText("Account name")).toHaveValue("Paper");
    await actor.click(within(dialog).getByRole("button", { name: "Add paper account" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(calls.find((call) => call.method === "POST")).toMatchObject({
      path: "/v1/brokers/paper",
      body: { label: "Paper" },
    });
    expect(await screen.findByText("Paper account added")).toBeInTheDocument();
  });

  it("logs in again inline, and from the menu sets the default, renames and disconnects (confirmed)", async () => {
    const actor = userEvent.setup();
    const navigate = vi.fn();
    const expired: BrokerAccountView = { ...UPSTOX, status: "NEEDS_RELOGIN", isDefault: false };
    const calls = mockApi(
      pageRoutes(
        [expired, DHAN],
        [
          {
            method: "POST",
            path: "/v1/brokers/acc_up/relogin",
            respond: () => Response.json({ account: expired, authUrl: AUTH_URL }),
          },
          {
            method: "PATCH",
            path: "/v1/brokers/acc_dh",
            respond: (call) => Response.json({ ...DHAN, ...(call.body as object) }),
          },
          { method: "DELETE", path: "/v1/brokers/acc_dh", respond: () => new Response(null, { status: 204 }) },
        ],
      ),
    );
    const { baseElement } = renderWithProviders(<BrokersView navigate={navigate} />);
    await screen.findByRole("table", { name: "Broker accounts" });
    await actor.click(within(rowOf("Main")).getByRole("button", { name: "Log in again" }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(AUTH_URL);
    });

    await actor.click(screen.getByRole("button", { name: "Actions for Dhan swing" }));
    const menu = screen.getByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Renew token", "Set as default", "Rename", "Disconnect"]);
    await expectNoAxeViolations(baseElement);
    await actor.click(within(menu).getByRole("menuitem", { name: "Set as default" }));
    await waitFor(() => {
      expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ isDefault: true });
    });
    expect(await screen.findByText("“Dhan swing” is now your default broker")).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Actions for Dhan swing" }));
    await actor.click(screen.getByRole("menuitem", { name: "Rename" }));
    const rename = screen.getByRole("dialog", { name: "Rename “Dhan swing”" });
    const name = within(rename).getByLabelText("Account name");
    await actor.clear(name);
    await actor.type(name, "Dhan long-term");
    await actor.click(within(rename).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(calls.filter((call) => call.method === "PATCH").at(-1)?.body).toEqual({ label: "Dhan long-term" });
    });
    expect(await screen.findByText("Renamed to “Dhan long-term”")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    await actor.click(screen.getByRole("button", { name: "Actions for Dhan swing" }));
    await actor.click(screen.getByRole("menuitem", { name: "Disconnect" }));
    const confirm = screen.getByRole("alertdialog", { name: "Disconnect “Dhan swing”?" });
    await actor.click(within(confirm).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => {
      expect(calls.some((call) => call.method === "DELETE")).toBe(true);
    });
    expect(await screen.findByText("Disconnected “Dhan swing”")).toBeInTheDocument();
  });

  it("opens the Dhan token step with the account's label to paste a new token", async () => {
    const actor = userEvent.setup();
    mockApi(pageRoutes([{ ...DHAN, status: "NEEDS_RELOGIN", lastError: "The token was revoked on Dhan." }]));
    renderWithProviders(<BrokersView />);
    expect(await screen.findByText("The token was revoked on Dhan.")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Paste new token" }));
    const dialog = screen.getByRole("dialog", { name: "Renew Dhan token" });
    expect(within(dialog).getByLabelText("Account name")).toHaveValue("Dhan swing");
    expect(within(dialog).getByText("Keep the name to replace this account's token.")).toBeInTheDocument();
  });

  it("announces the OAuth callback once and drops the query parameter", async () => {
    mockApi(pageRoutes([UPSTOX]));
    renderWithProviders(<BrokersView connectedId="acc_up" />);
    expect(await screen.findByText("Upstox connected")).toBeInTheDocument();
    expect(screen.getByText(/“Main” is ready/)).toBeInTheDocument();
    expect(router.replace).toHaveBeenCalledWith("/brokers", { scroll: false });
  });

  it("explains a failed OAuth callback", async () => {
    mockApi(pageRoutes([]));
    renderWithProviders(<BrokersView connectError="state_invalid" />);
    expect(await screen.findByText("The broker login didn't finish")).toBeInTheDocument();
    expect(screen.getByText(callbackErrorMessage("state_invalid"))).toBeInTheDocument();
    expect(callbackErrorMessage("bogus")).toBe("Nothing was saved. Try connecting again.");
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

  it("links to the brokers page when several sessions ended", async () => {
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
