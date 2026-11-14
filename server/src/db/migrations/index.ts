import type { Migration } from "./steps";
import { m001 } from "./001_baseline";
import { m002 } from "./002_runtime";
import { m003 } from "./003_facts";
import { m004 } from "./004_boards";
import { m005 } from "./005_monitor_sync";
import { m006 } from "./006_social";
import { m007 } from "./007_topics_and_views";
import { m008 } from "./008_app_settings";
import { m009 } from "./009_source_provenance";
import { m010 } from "./010_quote_translation";

// F-DB owns this folder. Add 010, 011... here in order. Never change what an applied migration does; rewrites for
// engine compatibility (MariaDB and MySQL) must leave the same schema and data.
export const migrations: Migration[] = [m001, m002, m003, m004, m005, m006, m007, m008, m009, m010];
