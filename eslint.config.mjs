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
]);

export default eslintConfig;
