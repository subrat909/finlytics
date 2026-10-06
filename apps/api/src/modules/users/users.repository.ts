/** User rows, through the tenancy-guarded client (User is scoped by its id). */
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../infra/prisma/prisma.service";

/** The columns `GET /v1/me` shows; never the role, password hash, 2FA secrets or lockout state. */
export interface UserProfileRow {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly image: string | null;
  readonly timezone: string;
  readonly createdAt: Date;
}

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The profile of a user that isn't deleted, or null. */
  findProfile(userId: string): Promise<UserProfileRow | null> {
    return this.prisma.db.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { id: true, email: true, name: true, image: true, timezone: true, createdAt: true },
    });
  }
}
