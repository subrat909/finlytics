import { AuthError } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signIn = vi.fn();
const signOut = vi.fn();
vi.mock("@/auth", () => ({ signIn, signOut }));

const { signInWithEmail, signInWithProvider, signOutAction } = await import("../actions");

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

beforeEach(() => {
  signIn.mockReset();
  signOut.mockReset();
});

describe("signInWithEmail", () => {
  it("validates the address before calling Auth.js", async () => {
    await expect(signInWithEmail({ status: "idle" }, form({ email: "asha" }))).resolves.toEqual({
      status: "error",
      fieldError: "Enter a valid email address, like you@example.com.",
      email: "asha",
    });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("sends the magic link to a safe callback path", async () => {
    await signInWithEmail({ status: "idle" }, form({ email: " Asha@Example.com ", callbackUrl: "//evil.example" }));
    expect(signIn).toHaveBeenCalledWith("email", { email: "Asha@Example.com", redirectTo: "/dashboard" });
  });

  it("turns an Auth.js failure into form state and rethrows anything else (the success redirect)", async () => {
    signIn.mockRejectedValueOnce(new AuthError("smtp down"));
    const state = await signInWithEmail({ status: "idle" }, form({ email: "asha@example.com" }));
    expect(state).toMatchObject({ status: "error", formError: expect.stringContaining("couldn't send") as string });
    expect(JSON.stringify(state)).not.toContain("smtp down");

    const redirect = new Error("NEXT_REDIRECT");
    signIn.mockRejectedValueOnce(redirect);
    await expect(signInWithEmail({ status: "idle" }, form({ email: "asha@example.com" }))).rejects.toBe(redirect);
  });
});

describe("signInWithProvider", () => {
  it("starts OAuth for a known provider only", async () => {
    await signInWithProvider(form({ provider: "github", callbackUrl: "/charts" }));
    expect(signIn).toHaveBeenCalledWith("github", { redirectTo: "/charts" });
    await expect(signInWithProvider(form({ provider: "credentials" }))).rejects.toThrow();
  });
});

describe("signOutAction", () => {
  it("signs out to /login", async () => {
    await signOutAction();
    expect(signOut).toHaveBeenCalledWith({ redirectTo: "/login" });
  });
});
