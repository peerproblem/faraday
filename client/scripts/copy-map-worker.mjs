// MapLibre starts its worker from a file next to its own module. A bundler moves the module, so the
// worker 404s and the map stays blank. This copies the worker into public/, where the app serves it
// from a fixed URL (see src/components/ui/point-map.tsx). Runs after every install.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const pkg = path.dirname(require.resolve("maplibre-gl/package.json"));
const out = path.join(root, "public", "vendor");
mkdirSync(out, { recursive: true });
copyFileSync(path.join(pkg, "dist", "maplibre-gl-worker.mjs"), path.join(out, "maplibre-gl-worker.mjs"));
console.log("public/vendor/maplibre-gl-worker.mjs copied from maplibre-gl");
