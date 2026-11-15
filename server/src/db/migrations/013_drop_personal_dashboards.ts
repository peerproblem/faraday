import type { Migration } from "./steps";

/** Sign-in and personal dashboards are gone: their tables (and the signed-in people's emails) go with them. */
export const m013: Migration = {
  id: 13,
  name: "drop_personal_dashboards",
  up: [
    `DROP TABLE IF EXISTS personal_view_revisions`,
    `DROP TABLE IF EXISTS personal_views`,
    `DROP TABLE IF EXISTS topic_requests`,
    `DROP TABLE IF EXISTS users`,
  ],
};
