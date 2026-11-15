import { describe, expect, it } from "vitest";
import type { BoardLayout } from "../spec";
import { useTestDb } from "../test/db";
import { createBoard } from "./boards";
import { clearBoardLayout, createBoardLayoutTemplate, getBoardLayout, getBoardLayoutTemplate, setBoardLayout, updateBoardLayoutTemplate } from "./board-layouts";

const { enabled } = useTestDb("board_layouts");

describe.skipIf(!enabled)("board layout storage", () => {
  it("copies the same template to two boards and keeps edits isolated", async () => {
    const { id: first } = await createBoard("First map board", null, { origin: "system" });
    const { id: second } = await createBoard("Second map board", null, { origin: "system" });
    const { id: finance } = await createBoard("Financial dashboard", null, { origin: "system" });
    const settings: BoardLayout = { layout: "map", timelineOpen: true, evidenceOpen: false };
    const template = await createBoardLayoutTemplate("Map", settings);
    await setBoardLayout(first, { templateId: template.id, settings });
    await setBoardLayout(second, { templateId: template.id, settings });
    await setBoardLayout(first, { templateId: template.id, settings: { ...settings, timelineOpen: false } });
    await updateBoardLayoutTemplate(template.id, "Updated map", { ...settings, evidenceOpen: true });

    expect((await getBoardLayout(first))?.settings).toEqual({ ...settings, timelineOpen: false });
    expect((await getBoardLayout(second))?.settings).toEqual(settings);
    expect((await getBoardLayoutTemplate(template.id))?.settings.evidenceOpen).toBe(true);
    expect(await getBoardLayout(finance)).toBeNull();
    await clearBoardLayout(first);
    expect(await getBoardLayout(first)).toBeNull();
    expect((await getBoardLayout(second))?.settings).toEqual(settings);
  });
});
