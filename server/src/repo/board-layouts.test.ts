import { describe, expect, it } from "vitest";
import type { BoardLayout } from "../spec";
import { useTestDb } from "../test/db";
import { createBoard } from "./boards";
import { createBoardLayoutTemplate, getBoardLayout, getBoardLayoutTemplate, setBoardLayout, updateBoardLayoutTemplate } from "./board-layouts";

const { enabled } = useTestDb("board_layouts");

describe.skipIf(!enabled)("board layout storage", () => {
  it("copies the same template to two boards and keeps edits isolated", async () => {
    const { id: first } = await createBoard("First map board", null, { origin: "system" });
    const { id: second } = await createBoard("Second map board", null, { origin: "system" });
    const { id: finance } = await createBoard("Financial dashboard", null, { origin: "system" });
    const { id: security } = await createBoard("Security dashboard", null, { origin: "system" });
    const settings: BoardLayout = { layout: "map", timelineOpen: true, evidenceOpen: false };
    const template = await createBoardLayoutTemplate("Map", settings);
    await setBoardLayout(first, { templateId: template.id, settings }, 0);
    await setBoardLayout(second, { templateId: template.id, settings }, 0);
    const securitySettings = { ...settings, layout: "grid" as const, cards: [] };
    await setBoardLayout(security, { templateId: null, settings: securitySettings }, 0);
    const customized: BoardLayout = {
      ...settings, timelineOpen: false,
      cards: [{ id: "access", title: "Access", placement: "right", open: true, contents: [{ kind: "status-chart", chart: "bars" }] }],
    };
    await setBoardLayout(first, { templateId: template.id, settings: customized }, 1);
    await updateBoardLayoutTemplate(template.id, "Updated map", { ...settings, evidenceOpen: true }, 1);

    expect((await getBoardLayout(first)).assignment?.settings).toEqual(customized);
    expect((await getBoardLayout(second)).assignment?.settings).toEqual(settings);
    expect((await getBoardLayoutTemplate(template.id))?.settings.evidenceOpen).toBe(true);
    expect(await getBoardLayout(finance)).toEqual({ rev: 0, assignment: null });
    expect((await getBoardLayout(security)).assignment?.settings).toEqual(securitySettings);
    await setBoardLayout(first, null, 2);
    expect(await getBoardLayout(first)).toEqual({ rev: 3, assignment: null });
    expect((await getBoardLayout(second)).assignment?.settings).toEqual(settings);
  });

  it("rejects competing saves and preserves the current revision through a reset", async () => {
    const { id } = await createBoard("Regional dashboard", null, { origin: "system" });
    const settings: BoardLayout = { layout: "grid", timelineOpen: true, evidenceOpen: false };
    const assignment = { templateId: null, settings };
    const writes = await Promise.all([setBoardLayout(id, assignment, 0), setBoardLayout(id, assignment, 0)]);
    expect(writes.filter((result) => result.ok)).toHaveLength(1);
    expect(await setBoardLayout(id, null, 1)).toEqual({ ok: true, value: { rev: 2, assignment: null } });
    expect(await setBoardLayout(id, assignment, 1)).toEqual({ ok: false, current: { rev: 2, assignment: null } });

    const template = await createBoardLayoutTemplate("Regional", settings);
    await updateBoardLayoutTemplate(template.id, "Newer name", settings, 1);
    expect(await updateBoardLayoutTemplate(template.id, "Stale name", settings, 1)).toEqual({
      ok: false, current: { ...template, name: "Newer name", rev: 2 },
    });
  });
});
