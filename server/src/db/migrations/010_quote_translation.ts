import { addColumn, type Migration } from "./steps";

// An English translation of a fact's verbatim quote, for sources that are not in English. The board is English
// only: the translation is what people read, and the original sentence is shown folded away beside it.
export const m010: Migration = {
  id: 10,
  name: "quote_translation",
  up: [addColumn("facts", "quote_en", "TEXT NULL")],
};
