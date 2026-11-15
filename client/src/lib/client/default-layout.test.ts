import { describe, expect, test } from "vitest";
import { getFixture } from "../../../e2e/fixtures";
import type { BoardSpecV2 } from "@/lib/spec";
import { defaultDesign, defaultLayout } from "./default-layout";

const spec = (): BoardSpecV2 => structuredClone(getFixture("strike")!.board.spec!);

describe("default personal layout", () => {
  test("a board with a map starts as the map monitor, like the shared board", () => {
    expect(defaultDesign(spec())).toBe("map-overlay");
    const layout = defaultLayout({ version: 7, spec: spec() });
    expect(layout.design).toBe("map-overlay");
    expect(layout.baseVersion).toBe(7);
    expect(layout.hidden).toEqual([]);
  });

  test("finance boards, boards without a map and boards still building keep the card grid", () => {
    expect(defaultDesign({ ...spec(), template: "finance" } as BoardSpecV2)).toBe("standard");
    const s = spec();
    expect(defaultDesign({ ...s, widgets: s.widgets.filter((w) => w.type !== "map") })).toBe("standard");
    expect(defaultDesign(null)).toBe("standard");
  });
});
