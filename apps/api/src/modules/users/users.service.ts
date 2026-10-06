/** The signed-in user's own account (plan D15). */
import type { Me } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";

import { UnauthenticatedError } from "../../common/problem-json/domain-errors";

import { toMe } from "./users.mapper";
import { UsersRepository } from "./users.repository";

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  /**
   * `GET /v1/me`. The session guard has already checked that the user exists and isn't deleted; a user deleted in
   * between is treated like an ended session.
   */
  async getMe(userId: string): Promise<Me> {
    const row = await this.users.findProfile(userId);
    if (row === null) throw new UnauthenticatedError("Sign in to continue.");
    return toMe(row);
  }
}
