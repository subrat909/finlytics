import { describe, expect, it, vi } from "vitest";

import {
  chartHref,
  isEditableTarget,
  itemLimitFrom,
  readActiveList,
  reorderedIds,
  rowButtonId,
  rowDepthId,
  writeActiveList,
} from "../lib/watchlist-lib";

const ITEMS = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("watchlist helpers", () => {
  it("moves one id and clamps the target", () => {
    expect(reorderedIds(ITEMS, 0, 2)).toEqual(["b", "c", "a"]);
    expect(reorderedIds(ITEMS, 2, 0)).toEqual(["c", "a", "b"]);
    expect(reorderedIds(ITEMS, 1, 9)).toEqual(["a", "c", "b"]);
    expect(reorderedIds(ITEMS, 5, 0)).toEqual(["a", "b", "c"]);
  });

  it("reads the plan's item limit from the api's detail", () => {
    expect(itemLimitFrom("Your plan allows 50 instruments per watchlist.")).toBe(50);
    expect(itemLimitFrom("Your plan allows 1 instrument per watchlist.")).toBe(1);
    expect(itemLimitFrom("Your plan allows 3 watchlists.")).toBeUndefined();
    expect(itemLimitFrom(undefined)).toBeUndefined();
  });

  it("remembers the open list, and survives blocked storage", () => {
    expect(readActiveList()).toBeUndefined();
    writeActiveList("wl2");
    expect(readActiveList()).toBe("wl2");
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readActiveList()).toBeUndefined();
    expect(() => {
      writeActiveList("wl3");
    }).not.toThrow();
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it("builds links, ids and knows typing targets", () => {
    expect(chartHref("NSE_FO|NIFTY|2025-10-30|24000|CE")).toBe("/charts?key=NSE_FO%7CNIFTY%7C2025-10-30%7C24000%7CCE");
    expect(rowButtonId("x1")).toBe("watchlist-row-x1");
    expect(rowDepthId("x1")).toBe("watchlist-depth-x1");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(editable)).toBe(true);
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
