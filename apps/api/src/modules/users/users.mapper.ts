/** Maps user rows to API payloads: never a Prisma model straight through (backend.md). */
import type { Me } from "@finlytics/shared";

import type { UserProfileRow } from "./users.repository";

export function toMe(row: UserProfileRow): Me {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    image: row.image,
    timezone: row.timezone,
    createdAt: row.createdAt.toISOString(),
  };
}
