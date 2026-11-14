import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// A hex color like #ef4444 (3, 4, 6 or 8 digits) at the start of a string or after a space, "[", "(", ":" or ",".
const HEX = String.raw`/(^|[\s\[(:,])#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})($|[^0-9a-zA-Z_-])/`;
const hexMessage = "Use a design system colour (bg-background, text-accent, var(--sw-danger)...) instead of a hex colour. Colours come from @sw3/ui.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.tsx"],
    ignores: ["src/components/ui/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: `Literal[value=${HEX}]`, message: hexMessage },
        { selector: `TemplateElement[value.raw=${HEX}]`, message: hexMessage },
        { selector: `JSXText[value=${HEX}]`, message: hexMessage },
      ],
    },
  },
  {
    // The design system is only imported in the adapter folder, so an upgrade of @sw3/ui is absorbed in one place.
    files: ["src/**/*.{ts,tsx}", "e2e/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@sw3/ui", "@sw3/ui/*"], message: "Import from @/components/ui/* instead. Only the adapter folder imports @sw3/ui (see src/components/ui/MIGRATION.md)." },
            { group: ["maplibre-gl", "maplibre-gl/*", "@unovis/*", "motion", "motion/*"], message: "Use the design system through @/components/ui/* instead of its underlying libraries." },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/vendor/**",
  ]),
]);

export default eslintConfig;
