import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "@/test/axe";

import { EmailSignInForm } from "../components/email-sign-in-form";
import { OAuthButtons } from "../components/oauth-buttons";
import { GENERIC_SIGN_IN_ERROR, signInErrorMessage } from "../errors";
import type { EmailSignInState } from "../schemas";
import { EmailSignInSchema } from "../schemas";

vi.mock("../actions", () => ({ signInWithEmail: vi.fn(), signInWithProvider: vi.fn() }));

describe("EmailSignInForm", () => {
  it("is a labelled field and a submit button, with no axe violations", async () => {
    const { container } = render(<EmailSignInForm callbackUrl="/charts" />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(container.querySelector('input[name="callbackUrl"]')).toHaveValue("/charts");
    await expectNoAxeViolations(container);
  });

  it("shows the server's field error on the input and keeps what was typed", async () => {
    const actor = userEvent.setup();
    const action = vi.fn((_state: EmailSignInState, formData: FormData): Promise<EmailSignInState> =>
      Promise.resolve({
        status: "error",
        fieldError: "Enter a valid email address.",
        email: formData.get("email") as string,
      }),
    );
    const { container } = render(<EmailSignInForm action={action} />);

    await actor.type(screen.getByLabelText("Email"), "asha@");
    await actor.click(screen.getByRole("button", { name: "Email me a sign-in link" }));

    const input = await screen.findByLabelText("Email");
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a valid email address.");
    expect(input).toHaveValue("asha@");
    await expectNoAxeViolations(container);
  });

  it("announces a delivery failure", async () => {
    const actor = userEvent.setup();
    const action = vi.fn(() =>
      Promise.resolve<EmailSignInState>({ status: "error", formError: "We couldn't send it." }),
    );
    render(<EmailSignInForm action={action} />);
    await actor.type(screen.getByLabelText("Email"), "asha@example.com");
    await actor.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't send it.");
  });
});

describe("OAuthButtons", () => {
  it("renders one form per configured provider", () => {
    const { container } = render(<OAuthButtons providers={["google", "github"]} callbackUrl="/dashboard" />);
    expect(screen.getByRole("button", { name: "Continue with Google" })).toHaveAttribute("type", "submit");
    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeInTheDocument();
    expect(container.querySelectorAll('input[name="provider"]')).toHaveLength(2);
    expect(container.querySelectorAll('input[name="callbackUrl"]')).toHaveLength(2);
  });
});

describe("EmailSignInSchema", () => {
  it("trims a valid address and explains an invalid one", () => {
    expect(EmailSignInSchema.parse({ email: "  asha@example.com " }).email).toBe("asha@example.com");
    expect(EmailSignInSchema.safeParse({ email: "" }).error?.issues[0]?.message).toBe("Enter your email address.");
    expect(EmailSignInSchema.safeParse({ email: "asha" }).error?.issues[0]?.message).toMatch(/valid email/);
  });
});

describe("signInErrorMessage", () => {
  it("maps known Auth.js codes and never echoes an unknown one", () => {
    expect(signInErrorMessage("Verification")).toMatch(/expired or was already used/);
    expect(signInErrorMessage("<script>")).toBe(GENERIC_SIGN_IN_ERROR);
    expect(signInErrorMessage("toString")).toBe(GENERIC_SIGN_IN_ERROR);
    expect(signInErrorMessage(undefined)).toBeUndefined();
    expect(signInErrorMessage("")).toBeUndefined();
  });
});
