import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ── Architecture freeze rules ──────────────────────────────────────────────
// The live business logic is in lib/ and app/. The old modular migration
// (core/, modules/*/services, etc.) was pruned. modules/ now only keeps
// registry/manifest for navigation and permissions.
//
// These rules prevent importing stale code from the frozen module scaffolding.
// See AGENTS.md and modules/README.md for context.

/** Regla ESLint custom: detecta .orderBy(sql`alias desc`) donde el "alias"
 *  no existe en el SQL generado porque Drizzle no alía los sql`...` fragments.
 *  Ver: https://github.com/drizzle-team/drizzle-orm/discussions/… 
 *  El patrón seguro siempre interpola ${drizzleColumn} dentro del template. */
const noSqlAliasOrderBy = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Usa desc(alias) o asc(alias) en vez de sql`alias desc`. Drizzle no alía sql`...` fragments en el SQL generado.',
    },
    schema: [],
  },
  create(context) {
    return {
      TaggedTemplateExpression(node) {
        // Solo tagged templates con tag `sql`
        if (node.tag.type !== "Identifier" || node.tag.name !== "sql") return;
        // Si tiene interpolaciones (${...}), es seguro
        if (node.quasi.expressions.length > 0) return;
        const raw = node.quasi.quasis[0]?.value?.raw?.trim();
        if (!raw) return;

        // Match: simpleIdentifier asc|desc  (ej. "totalLiters desc")
        const match = raw.match(/^([a-z_][a-zA-Z0-9_]*)\s+(asc|desc)$/i);
        if (!match) return;

        context.report({
          node,
          message:
            'Usa desc(alias) o asc(alias) en vez de sql`{{ alias }} {{ dir }}`. Drizzle no alía sql`...` fragments en el SQL generado.',
          data: { alias: match[1], dir: match[2] },
        });
      },
    };
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "app_cumplimiento/**",
  ]),
  {
    plugins: {
      local: {
        rules: {
          "no-sql-alias-order-by": noSqlAliasOrderBy,
        },
      },
    },
    rules: {
      "local/no-sql-alias-order-by": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // ── Freeze: prevent importing stale module scaffolding ─────────────────────
  // app/, lib/, components/ are the source of truth. The old copies in
  // modules/*/{services,actions,schema,validation} and core/ were pruned.
  // This rule prevents reintroducing stale logic by mistake.
  {
    files: ["app/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/modules/*/services/*",
                "@/modules/*/actions/*",
                "@/modules/*/schema",
                "@/modules/*/validation",
              ],
              message:
                "[freeze] No importes las copias stale de modules/*. Fuente de verdad: lib/ + app/ (ver modules/README.md).",
            },
            {
              group: ["@/core/*", "@/core"],
              message:
                "[freeze] core/ fue removido; usa las primitivas equivalentes en lib/.",
            },
            {
              group: ["**/*-form-kit*", "**/form-kit*"],
              message:
                "[design-system] No crees ni importes archivos form-kit locales. Usa useOperation de @/lib/hooks/use-operation y Field de @/components/ui/field (ver AGENTS.md).",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
