import type { Migration } from "../migrate";

// Which API found a source (via), its language and an English display title for non-English sources,
// and the ISO country code of a geocoded place (used to target local search).
export const m009: Migration = {
  id: 9,
  name: "source_provenance",
  up: [
    `ALTER TABLE sources ADD COLUMN IF NOT EXISTS via VARCHAR(16) NULL`,
    `ALTER TABLE sources ADD COLUMN IF NOT EXISTS lang VARCHAR(8) NULL`,
    `ALTER TABLE sources ADD COLUMN IF NOT EXISTS title_en TEXT NULL`,
    `ALTER TABLE geocode_cache ADD COLUMN IF NOT EXISTS country_code CHAR(2) NULL`,
  ],
};
