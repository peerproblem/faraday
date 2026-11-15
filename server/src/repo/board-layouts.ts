import { nanoid } from "nanoid";
import { all, json, one, run } from "../db/pool";
import { boardLayoutSchema, type BoardLayout, type BoardLayoutAssignment, type BoardLayoutState, type BoardLayoutTemplate } from "../spec";

type TemplateRow = { id: string; name: string; settings: string | object; rev: number };
type AssignmentRow = { template_id: string | null; settings: string | object | null; rev: number };
type WriteResult<T> = { ok: true; value: T } | { ok: false; current: T };

function readSettings(settings: string | object): BoardLayout {
  return boardLayoutSchema.parse(typeof settings === "string" ? json(settings) : settings);
}

export async function listBoardLayoutTemplates(): Promise<BoardLayoutTemplate[]> {
  const rows = await all<TemplateRow>("SELECT id, name, settings, rev FROM board_layout_templates ORDER BY name, id");
  return rows.map((row) => ({ ...row, settings: readSettings(row.settings) }));
}

export async function getBoardLayoutTemplate(id: string): Promise<BoardLayoutTemplate | null> {
  const row = await one<TemplateRow>("SELECT id, name, settings, rev FROM board_layout_templates WHERE id = ?", [id]);
  return row ? { ...row, settings: readSettings(row.settings) } : null;
}

export async function createBoardLayoutTemplate(name: string, settings: BoardLayout): Promise<BoardLayoutTemplate> {
  const id = nanoid(12);
  await run("INSERT INTO board_layout_templates (id, name, settings) VALUES (?, ?, ?)", [id, name, JSON.stringify(settings)]);
  return { id, name, settings, rev: 1 };
}

export async function updateBoardLayoutTemplate(id: string, name: string, settings: BoardLayout, rev: number): Promise<WriteResult<BoardLayoutTemplate | null>> {
  const result = await run("UPDATE board_layout_templates SET name = ?, settings = ?, rev = rev + 1 WHERE id = ? AND rev = ?",
    [name, JSON.stringify(settings), id, rev]);
  if (result.affectedRows) return { ok: true, value: { id, name, settings, rev: rev + 1 } };
  return { ok: false, current: await getBoardLayoutTemplate(id) };
}

export async function getBoardLayout(id: string): Promise<BoardLayoutState> {
  const row = await one<AssignmentRow>("SELECT template_id, settings, rev FROM board_layouts WHERE board_id = ?", [id]);
  return { assignment: row?.settings == null ? null : { templateId: row.template_id, settings: readSettings(row.settings) }, rev: row?.rev ?? 0 };
}

// Keep the revision through a reset so old drafts cannot recreate a cleared assignment.
export async function setBoardLayout(id: string, assignment: BoardLayoutAssignment | null, rev: number): Promise<WriteResult<BoardLayoutState>> {
  const settings = assignment ? JSON.stringify(assignment.settings) : null;
  const template = assignment?.templateId ?? null;
  if (rev === 0) {
    try {
      await run("INSERT INTO board_layouts (board_id, template_id, settings) VALUES (?, ?, ?)", [id, template, settings]);
      return { ok: true, value: { assignment, rev: 1 } };
    } catch (error) {
      if ((error as { code?: string }).code !== "ER_DUP_ENTRY") throw error;
    }
  } else {
    const result = await run("UPDATE board_layouts SET template_id = ?, settings = ?, rev = rev + 1 WHERE board_id = ? AND rev = ?",
      [template, settings, id, rev]);
    if (result.affectedRows) return { ok: true, value: { assignment, rev: rev + 1 } };
  }
  return { ok: false, current: await getBoardLayout(id) };
}
