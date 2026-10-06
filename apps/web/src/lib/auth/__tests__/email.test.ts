import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));
vi.mock("nodemailer", () => ({ createTransport }));

const { MAGIC_LINK_MAX_AGE_SEC, emailProvider, magicLinkMessage, normalizeEmailIdentifier, undeliveredCount } =
  await import("../email");

beforeEach(() => {
  sendMail.mockReset();
});

describe("normalizeEmailIdentifier", () => {
  it("trims and lowercases one address", () => {
    expect(normalizeEmailIdentifier("  Asha.Rao+trading@Example.IN ")).toBe("asha.rao+trading@example.in");
  });

  it.each(["a@b.c,evil@x.y", "Asha <a@b.c>", "no-at-sign", "a@b", "a b@c.d", `${"a".repeat(250)}@b.cd`])(
    "refuses %j",
    (identifier) => {
      expect(() => normalizeEmailIdentifier(identifier)).toThrow("Expected a single email address");
    },
  );
});

describe("magicLinkMessage", () => {
  it("puts the link in the text and escapes it in the HTML", () => {
    const url = 'http://localhost:3000/api/auth/callback/email?token=a&email=b"><script>';
    const message = magicLinkMessage(url);

    expect(message.subject).toBe("Sign in to Finlytics");
    expect(message.text).toContain(url);
    expect(message.text).toContain("expires in 10 minutes");
    expect(message.html).toContain("token=a&amp;email=b&quot;&gt;&lt;script&gt;");
    expect(message.html).not.toContain("<script>");
  });
});

describe("undeliveredCount", () => {
  it("counts rejected and pending recipients, tolerating odd results", () => {
    expect(undeliveredCount({ rejected: ["a"], pending: ["b", "c"] })).toBe(3);
    expect(undeliveredCount({ accepted: ["a"] })).toBe(0);
    expect(undeliveredCount(undefined)).toBe(0);
  });
});

describe("emailProvider", () => {
  const provider = emailProvider({ server: "smtp://127.0.0.1:1025", from: "Finlytics <no-reply@finlytics.local>" });
  const params = {
    identifier: "asha@example.com",
    url: "http://localhost:3000/api/auth/callback/email?token=t",
    expires: new Date(),
    provider,
    token: "t",
    theme: {},
    request: new Request("http://localhost:3000"),
  };

  it("is the `email` provider with 10-minute links and our normaliser", () => {
    expect(provider).toMatchObject({ id: "email", type: "email", maxAge: MAGIC_LINK_MAX_AGE_SEC });
    expect(provider.normalizeIdentifier).toBe(normalizeEmailIdentifier);
  });

  it("sends the message through one transport per server", async () => {
    sendMail.mockResolvedValue({ accepted: ["asha@example.com"], rejected: [] });
    await provider.sendVerificationRequest(params);
    await provider.sendVerificationRequest(params);

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith("smtp://127.0.0.1:1025");
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "asha@example.com", from: "Finlytics <no-reply@finlytics.local>" }),
    );
  });

  it("fails without naming the address when the server refuses it", async () => {
    sendMail.mockResolvedValue({ rejected: ["asha@example.com"] });
    const failure = provider.sendVerificationRequest(params);
    await expect(failure).rejects.toThrow("The sign-in email could not be delivered");
    await expect(failure).rejects.not.toThrow(/asha/);
  });
});
