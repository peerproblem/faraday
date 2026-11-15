import "./jsdom-stubs";
import "./mocks";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { AdminLayouts } from "@/components/admin/admin-layouts";
import { getAdminBoardLayout, getLayoutLibrary, saveAdminBoardLayout, saveLayoutTemplate } from "@/lib/client/views-api";

vi.mock("@/lib/client/views-api", async (original) => ({
  ...(await original<typeof import("@/lib/client/views-api")>()),
  getLayoutLibrary: vi.fn(),
  getAdminBoardLayout: vi.fn(),
  saveAdminBoardLayout: vi.fn(),
  saveLayoutTemplate: vi.fn(),
  clearAdminBoardLayout: vi.fn(),
}));

test("saves a template and applies a customized copy to the selected board", async () => {
  const user = userEvent.setup();
  const settings = { layout: "map", timelineOpen: true, evidenceOpen: false } as const;
  const template = { id: "template-1", name: "Regional alerts", settings, rev: 1 };
  vi.mocked(getLayoutLibrary).mockResolvedValue({
    templates: [], boards: [{ id: "b1", title: "Map board", slug: "sample-map" }],
  });
  vi.mocked(getAdminBoardLayout).mockResolvedValue({
    assignment: null, canUseMap: true, widgets: [{ key: "sources", type: "sources", title: "Reporting" }], rev: 0,
  });
  vi.mocked(saveLayoutTemplate).mockResolvedValue(template);
  vi.mocked(saveAdminBoardLayout).mockImplementation(async (_id, { rev, ...assignment }) => ({ assignment, rev: rev + 1 }));

  render(<AdminLayouts />);
  await user.type(await screen.findByRole("textbox", { name: "Template name" }), template.name);
  await user.click(screen.getByRole("button", { name: "Save template" }));
  await waitFor(() => expect(saveLayoutTemplate).toHaveBeenCalledWith(null, template.name, settings, 0));
  await user.click(screen.getByRole("button", { name: "Board to edit" }));
  await user.click(await screen.findByRole("option", { name: "Map board" }));
  await user.click(await screen.findByRole("combobox", { name: "Start from a template" }));
  await user.click(await screen.findByRole("option", { name: template.name }));
  const saveBoard = screen.getByRole("button", { name: "Save for this board" });
  const editor = within(saveBoard.closest("form")!);
  await user.click(editor.getByRole("switch", { name: "Open Evidence by default" }));
  await user.click(editor.getByRole("combobox", { name: "Left sidebar" }));
  await user.click(await screen.findByRole("option", { name: "Custom contents" }));
  await user.click(editor.getByRole("combobox", { name: "Content 1" }));
  await user.click(await screen.findByRole("option", { name: "Reporting" }));
  await user.click(saveBoard);
  await waitFor(() => expect(saveAdminBoardLayout).toHaveBeenCalledExactlyOnceWith("b1", {
    templateId: template.id, settings: {
      ...settings, evidenceOpen: true,
      sidebar: { title: "Details", open: true, contents: [{ kind: "widget", type: "sources", key: "sources" }] },
    }, rev: 0,
  }));
  expect(saveLayoutTemplate).toHaveBeenCalledTimes(1);
});
