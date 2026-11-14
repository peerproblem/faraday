import { addColumn, type Migration } from "./steps";

// Which API found a source (via), its language and an English display title for non-English sources,
// and the ISO country code of a geocoded place (used to target local search).
export const m009: Migration = {
  id: 9,
  name: "source_provenance",
  up: [
    addColumn("sources", "via", "VARCHAR(16) NULL"),
    addColumn("sources", "lang", "VARCHAR(8) NULL"),
    addColumn("sources", "title_en", "TEXT NULL"),
    addColumn("geocode_cache", "country_code", "CHAR(2) NULL"),
  ],
};
