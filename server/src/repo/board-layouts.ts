import { nanoid } from "nanoid";
import { all, json, one, run } from "../db/pool";
import { boardLayoutSchema, type BoardLayout, type BoardLayoutAssignment, type BoardLayoutTemplate } from "../spec";

type TemplateRow = { id: string; name: string; settings: string | object };
type AssignmentRow = { template_id: string | null; settings: string | object };

function readSettings(settings: string | object): BoardLayout {
  return boardLayoutSchema.parse(typeof settings === "string" ? json(settings) : settings);
}

export async function listBoardLayoutTemplates(): Promise<BoardLayoutTemplate[]> {
  const rows = await all<TemplateRow>("SELECT id, name, settings FROM board_layout_templates ORDER BY name, id");
  return rows.map((row) => ({ id: row.id, name: row.name, settings: readSettings(row.settings) }));
}

export async function getBoardLayoutTemplate(id: string): Promise<BoardLayoutTemplate | null> {
  const row = await one<TemplateRow>("SELECT id, name, settings FROM board_layout_templates WHERE id = ?", [id]);
  return row ? { id: row.id, name: row.name, settings: readSettings(row.settings) } : null;
}

export async function createBoardLayoutTemplate(name: string, settings: BoardLayout): Promise<BoardLayoutTemplate> {
  const id = nanoid(12);
  await run("INSERT INTO board_layout_templates (id, name, settings) VALUES (?, ?, ?)", [id, name, JSON.stringify(settings)]);
  return { id, name, settings };
}

export async function updateBoardLayoutTemplate(id: string, name: string, settings: BoardLayout): Promise<BoardLayoutTemplate | null> {
  const result = await run("UPDATE board_layout_templates SET name = ?, settings = ? WHERE id = ?", [name, JSON.stringify(settings), id]);
  return result.affectedRows ? { id, name, settings } : getBoardLayoutTemplate(id);
}

export async function getBoardLayout(id: string): Promise<BoardLayoutAssignment | null> {
  const row = await one<AssignmentRow>("SELECT template_id, settings FROM board_layouts WHERE board_id = ?", [id]);
  return row ? { templateId: row.template_id, settings: readSettings(row.settings) } : null;
}

export async function setBoardLayout(id: string, assignment: BoardLayoutAssignment): Promise<void> {
  await run(
    `INSERT INTO board_layouts (board_id, template_id, settings) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE template_id = VALUES(template_id), settings = VALUES(settings)`,
    [id, assignment.templateId, JSON.stringify(assignment.settings)],
  );
}

export async function clearBoardLayout(id: string): Promise<void> {
  await run("DELETE FROM board_layouts WHERE board_id = ?", [id]);
}
