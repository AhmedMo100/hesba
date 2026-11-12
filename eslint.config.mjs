import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import boundaries from "eslint-plugin-boundaries";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "node_modules/**",
    "public/**",
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
    "docs/**",
  ]),
  {
    plugins: {
      boundaries,
    },
    settings: {
      "boundaries/include": ["src/**/*"],
      "boundaries/elements": [
        { type: "client", pattern: "src/client/**" },
        { type: "server", pattern: "src/server/**" },
        { type: "domain", pattern: "src/domain/**" },
        { type: "schemas", pattern: "src/schemas/**" },
        { type: "app", pattern: "src/app/**" },
      ],
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "allow",
          policies: [
            {
              from: { element: { type: "client" } },
              disallow: [{ to: { element: { type: "server" } } }],
              message: "src/client may not import from src/server",
            },
            {
              from: { element: { type: ["domain", "schemas"] } },
              disallow: [
                { to: { element: { type: ["client", "server", "app"] } } },
              ],
              message:
                "src/domain and src/schemas may not import from app, client, or server",
            },
          ],
        },
      ],
    },
  },
  // ADR-0017 dependency rules. Each block targets a disjoint set of files, because a later
  // `no-restricted-imports` entry replaces (does not merge with) an earlier one for the same file.
  {
    files: ["src/domain/**", "src/schemas/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@prisma/*", "next", "next/*", "react", "react-dom", "react/*", "dexie", "server-only"],
              message: "src/domain and src/schemas must stay pure: no DB, framework, or React imports.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/client/shared/**", "src/client/offline/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/client/features/*", "@/client/app-shell", "@/client/app-shell/*", "**/features/*", "**/app-shell/*"],
              message: "shared/ and offline/ are used by features; they must not depend on a feature or the shell.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/app/**", "src/server/modules/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/modules/*/*"],
              message: "Import a server module through its public API (@/server/modules/<module>), not its internal files.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
