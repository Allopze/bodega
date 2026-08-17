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

/** Regla ESLint custom: prohíbe `toLocaleString`/`toLocaleDateString`/
 *  `toLocaleTimeString` sin locale explícito en componentes .tsx.
 *
 *  Sin locale usan el del runtime: el del servidor (contenedor en UTC/en-US) no
 *  coincide con el del navegador, así que el texto renderizado difiere y React
 *  lanza el error #418 de hidratación. Pasó de verdad en 4 rutas
 *  (admin/notificaciones, admin/seguridad, admin/folios) y `AGENTS.md` ya lo
 *  prohibía en prosa sin nada que lo hiciera cumplir.
 *  Usa formatDate/formatDateTime de @/lib/utils, que fijan la zona de Chile. */
const noBareToLocale = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Usa formatDate/formatDateTime de @/lib/utils en vez de toLocale*String() sin locale: el locale del runtime difiere entre servidor y navegador y rompe la hidratación.",
    },
    schema: [],
  },
  create(context) {
    const BANNED = new Set(["toLocaleString", "toLocaleDateString", "toLocaleTimeString"]);
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression") return;
        if (callee.property.type !== "Identifier") return;
        if (!BANNED.has(callee.property.name)) return;
        // Con locale explícito es determinista y está permitido.
        if (node.arguments.length > 0) return;
        context.report({
          node,
          message:
            "{{ name }}() sin locale usa el del runtime y rompe la hidratación (React #418). Usa formatDate/formatDateTime de @/lib/utils.",
          data: { name: callee.property.name },
        });
      },
    };
  },
};

/** Grupo B de la auditoría 2026-08-16: calcular HOY en UTC.
 *
 *  Se restringe a la forma "ahora mismo" (`new Date()` sin argumentos) y no a
 *  `getUTCFullYear()`/`toISOString().slice(0,10)` en general: sobre una fecha ya
 *  normalizada con `Date.UTC(...)` esos métodos son la aritmética correcta (ver
 *  `addDaysToPlainDate` en lib/utils.ts) y prohibirlos obligaría a ~40
 *  excepciones por ruta, que es una regla apagada donde importa. Lo que nunca
 *  es correcto es preguntarle a UTC qué día es hoy: entre las 20:00 y la
 *  medianoche chilena contesta mañana. Usa todayInChile()/codeYear(). */
const UTC_TODAY_RESTRICTIONS = [
  {
    selector:
      "CallExpression[callee.property.name='slice'][callee.object.callee.property.name='toISOString'][callee.object.callee.object.type='NewExpression'][callee.object.callee.object.callee.name='Date'][callee.object.callee.object.arguments.length=0]",
    message:
      "new Date().toISOString().slice(0,10) es el día en UTC: entre las 20:00 y la medianoche chilena adelanta la fecha. Usa todayInChile() de @/lib/utils.",
  },
  {
    selector:
      "MemberExpression[object.callee.property.name='split'][object.callee.object.callee.property.name='toISOString'][object.callee.object.callee.object.type='NewExpression'][object.callee.object.callee.object.callee.name='Date'][object.callee.object.callee.object.arguments.length=0]",
    message:
      'new Date().toISOString().split("T")[0] es el día en UTC: entre las 20:00 y la medianoche chilena adelanta la fecha. Usa todayInChile() de @/lib/utils.',
  },
  {
    selector:
      "CallExpression[callee.property.name='getUTCFullYear'][callee.object.type='NewExpression'][callee.object.callee.name='Date'][callee.object.arguments.length=0]",
    message:
      "new Date().getUTCFullYear() es el año en UTC: la noche del 31 de diciembre chileno ya es el año siguiente. Usa codeYear() de @/lib/utils.",
  },
]

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "test-results/**",
    "audit/**",
    "next-env.d.ts",
    "app_cumplimiento/**",
    // Muestra estática de composición visual (no es código de la app).
    "referencia/**",
  ]),
  {
    plugins: {
      local: {
        rules: {
          "no-sql-alias-order-by": noSqlAliasOrderBy,
          "no-bare-to-locale": noBareToLocale,
        },
      },
    },
    rules: {
      "local/no-sql-alias-order-by": "error",
      "local/no-bare-to-locale": "error",
      "no-restricted-syntax": ["error", ...UTC_TODAY_RESTRICTIONS],
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
  // ── Excepciones del día civil (UTC_TODAY_RESTRICTIONS) ────────────────────
  // Tests: varios usan la forma UTC como CONTROL —`prevention-dia-civil-chileno`
  // afirma que a las 23:00 de Chile `new Date().toISOString().slice(0,10)` da el
  // día siguiente, que es justo el bug que la regla previene—. Prohibirla ahí
  // borraría la prueba de que el bug existía.
  // scripts/: herramientas fuera de la aplicación (mantención puntual, nombre
  // del directorio de capturas); no escriben datos que un fiscalizador lea.
  {
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/__tests__/**/*.{ts,tsx}",
      "scripts/**/*.{ts,tsx,mjs}",
      "e2e/**/*.{ts,tsx}",
    ],
    rules: { "no-restricted-syntax": "off" },
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
  // ── Design system: el feedback pasa siempre por el wrapper de toast ────────
  // lib/toast.ts añade barra de progreso y duración de error consistentes.
  // Importar `toast` de "sonner" directamente se salta ese comportamiento.
  // Excepciones: el propio wrapper y los dos layouts que montan <Toaster>.
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    ignores: ["lib/toast.ts", "app/(app)/layout.tsx", "app/(public)/layout.tsx"],
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
          paths: [
            {
              name: "sonner",
              importNames: ["toast"],
              message:
                "[design-system] Importa `toast` desde @/lib/toast, no de sonner: el wrapper fija la duración y la barra de progreso de los errores.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
