import { MeSchema } from "@finlytics/shared";
import { describe, expect, it, vi } from "vitest";

import { UnauthenticatedError } from "../../../common/problem-json/domain-errors";
import { toMe } from "../users.mapper";
import type { UserProfileRow, UsersRepository } from "../users.repository";
import { UsersService } from "../users.service";

const ROW: UserProfileRow = {
  id: "u1",
  email: "Asha@Example.com",
  name: null,
  image: "https://example.com/a.png",
  timezone: "Asia/Kolkata",
  createdAt: new Date("2026-10-01T09:30:00.000Z"),
};

describe("UsersService.getMe", () => {
  it("maps the signed-in user to the Me contract", async () => {
    const repository = { findProfile: vi.fn<UsersRepository["findProfile"]>().mockResolvedValue(ROW) };

    const me = await new UsersService(repository as unknown as UsersRepository).getMe("u1");

    expect(repository.findProfile).toHaveBeenCalledWith("u1");
    expect(MeSchema.parse(me)).toEqual({ ...ROW, createdAt: "2026-10-01T09:30:00.000Z" });
  });

  it("treats a user deleted since the session check like an ended session", async () => {
    const repository = { findProfile: vi.fn<UsersRepository["findProfile"]>().mockResolvedValue(null) };

    await expect(new UsersService(repository as unknown as UsersRepository).getMe("u1")).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it("never passes columns through that the contract doesn't name", () => {
    const withExtras = { ...ROW, passwordHash: "argon2", role: "ADMIN" } as UserProfileRow;

    expect(Object.keys(toMe(withExtras)).sort()).toEqual(["createdAt", "email", "id", "image", "name", "timezone"]);
  });
});
