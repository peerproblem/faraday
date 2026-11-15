import { addColumn, type Migration } from "./steps";

export const m015: Migration = {
  id: 15,
  name: "per-topic category overrides",
  up: [addColumn("boards", "topic_category", "VARCHAR(32) NULL")],
};
