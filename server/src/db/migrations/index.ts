import type { Migration } from "../migrate";
import { m001 } from "./001_baseline";
import { m002 } from "./002_runtime";
import { m003 } from "./003_facts";
import { m004 } from "./004_boards";
import { m005 } from "./005_monitor_sync";
import { m006 } from "./006_social";

// F-DB owns this folder. Add 005, 006... here in order. Never edit an applied migration.
export const migrations: Migration[] = [m001, m002, m003, m004, m005, m006];
