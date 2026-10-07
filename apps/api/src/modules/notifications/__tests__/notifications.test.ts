import { describe, expect, it, vi } from "vitest";

import { decodeUserEvent } from "../../realtime/quote-subscriber";
import { NotificationsService, toNotificationView } from "../notifications.service";
import type { NotificationsRepository, NotificationRow } from "../notifications.repository";
import { UserEventsRelay } from "../user-events.relay";

const ROW: NotificationRow = {
  id: "n1",
  title: "Upstox session ended",
  body: "Log in again to keep trading.",
  severity: "warning",
  category: "broker",
  createdAt: new Date("2026-10-07T03:00:00.000Z"),
  readAt: null,
};

function repository(rows: NotificationRow[] = [ROW], unread = 1) {
  return {
    latest: vi.fn(() => Promise.resolve(rows)),
    unread: vi.fn(() => Promise.resolve(unread)),
    markRead: vi.fn(() => Promise.resolve()),
  };
}

describe("NotificationsService", () => {
  it("lists the newest notifications with the unread count", async () => {
    const repo = repository();
    const service = new NotificationsService(repo as unknown as NotificationsRepository);
    expect(await service.list("u1")).toEqual({
      items: [
        {
          id: "n1",
          title: "Upstox session ended",
          body: "Log in again to keep trading.",
          severity: "warning",
          category: "broker",
          createdAt: "2026-10-07T03:00:00.000Z",
          readAt: null,
        },
      ],
      unread: 1,
    });
    expect(repo.latest).toHaveBeenCalledWith("u1");
  });

  it("maps an unknown severity to info", () => {
    expect(toNotificationView({ ...ROW, severity: "loud" }).severity).toBe("info");
  });

  it("marks the given ids (or all) read for that user only and returns the unread count left", async () => {
    const repo = repository([], 0);
    const service = new NotificationsService(repo as unknown as NotificationsRepository);
    const now = new Date("2026-10-07T04:00:00.000Z");
    expect(await service.markRead("u1", { ids: ["n1"] }, now)).toEqual({ unread: 0 });
    expect(repo.markRead).toHaveBeenCalledWith("u1", ["n1"], now);
    await service.markRead("u1", {}, now);
    expect(repo.markRead).toHaveBeenLastCalledWith("u1", undefined, now);
  });
});

describe("UserEventsRelay", () => {
  it("publishes broker account events on the user-event channel, and survives a Redis failure", async () => {
    const publish = vi.fn(() => Promise.resolve(1));
    const logger = { setContext: vi.fn(), warn: vi.fn() };
    const relay = new UserEventsRelay({ client: { publish } } as never, logger as never);
    await relay.onBrokerAccount({ userId: "u1", accountId: "a1", broker: "UPSTOX" });
    expect(publish).toHaveBeenCalledWith("rt:user", JSON.stringify({ userId: "u1", kind: "broker" }));
    publish.mockRejectedValueOnce(new Error("down"));
    await relay.publish("u1", "notification");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("decodes only well-formed user events", () => {
    expect(decodeUserEvent('{"userId":"u1","kind":"broker"}')).toEqual({ userId: "u1", kind: "broker" });
    expect(decodeUserEvent('{"userId":"u1","kind":"other"}')).toBeUndefined();
    expect(decodeUserEvent("not json")).toBeUndefined();
  });
});
