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

// ── Rule: ban raw <Badge variant={...}> driven by a local state/variant map ──
// El vocabulario de variant puede vivir en MetaBadge/state-badge.tsx o en
// wrappers canónicos del dominio (ej. StateBadge). Este rule está diseñado para
// ser conservador: reporta solo cuando el valor de `variant` parece derivarse de
// un mapa/local helper en vez de invocar directamente a una primitiva canónica.
// Nota importante: el detector `hasLocalVariantMapPattern` también reporta
// variant conditionally-driven (ternarios/conjunción lógica) porque esos son
// típicamente los reemplazos más naturales de MetaBadge/metaFor.
const noRawBadgeVariantMap = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Prohíbe montar <Badge variant={...}> a partir de un mapa de estado/variant local; usa MetaBadge (ver components/states/state-badge.tsx) o el wrapper canónico del dominio.",
    },
    schema: [],
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (context.getFilename().endsWith("components/states/state-badge.tsx")) return;
        if (node.name.type !== "JSXIdentifier") return;
        if (node.name.name !== "variant") return;
        if (node.parent?.type !== "JSXOpeningElement") return;
        const openingElement = node.parent;
        if (openingElement.name.type !== "JSXIdentifier") return;
        if (openingElement.name.name !== "Badge") return;

        const value = node.value;
        if (!value) return;
        if (value.type !== "JSXExpressionContainer") return;
        const expr = value.expression;
        if (!expr) return;

        if (!hasLocalVariantMapPattern(expr)) {
          return;
        }

        context.report({
          node,
          message:
            "No uses <Badge variant={…}> con un mapa de estado/variant local; reemplaza por MetaBadge (components/states/state-badge.tsx) o usa el wrapper canónico del dominio.",
        });
      },
    };
  },
};

function hasLocalVariantMapPattern(expr) {
  if (expr.type === "Identifier") {
    return false;
  }

  if (expr.type === "CallExpression") {
    if (expr.callee.type === "Identifier") {
      const name = expr.callee.name;
      if (/BadgeVariant|variantFor|getBadgeVariant|variantOf|statusVariant/i.test(name)) {
        return true;
      }
    }
    return false;
  }

  if (expr.type === "MemberExpression") {
    const property = expr.property;
    if (!property) return false;
    const propertyName = property.type === "Identifier" ? property.name : null;
    if (!propertyName) return false;

    if (/variant|variantField/.test(propertyName)) {
      return true;
    }
    if (expr.object.type === "Identifier") {
      const name = expr.object.name;
      if (/map|variant|status|meta|badge/i.test(name)) {
        return true;
      }
    }
    return false;
  }

  if (expr.type === "ConditionalExpression" || expr.type === "LogicalExpression") {
    return true;
  }

  return false;
}

/** grupo B de la auditoría 2026-08-16: calcular HOY en UTC.
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
];

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
    // Scratches de QA local (scripts desechables, ya ignorados por git).
    ".tmp/**",
    // Runner temporal de `/docs:execute`. `.gitignore` ya lo declara "nunca
    // debe versionarse", pero ESLint no lee `.gitignore`: sin esta entrada, un
    // error de lint dentro del runner bloquea CUALQUIER commit del repo —
    // mismo síntoma que motivó la entrada de `.claude/worktrees/**`.
    "scripts/.docs-runner/**",
    // Worktrees de sesión: son copias completas del repo, así que lintearlas
    // duplica cada archivo y además aplica las reglas a las rutas que esta
    // misma lista excluye en la raíz (`referencia/**`, `odoo-19.0/**`), que
    // bajo el prefijo del worktree ya no calzan. `.gitignore` las excluye
    // desde 1ae474e4; sin esta entrada el pre-commit fallaba con ~160 errores
    // ajenos al cambio y ningún commit podía aterrizar.
    ".claude/worktrees/**",
    "next-env.d.ts",
    "app_cumplimiento/**",
    // Proyectos externos de referencia; no forman parte de la aplicación.
    "erpnext-develop/**",
    "odoo-19.0/**",
    // Muestra estática de composición visual (no es código de la app).
    "referencia/**",
  ]),
  {
    plugins: {
      local: {
        rules: {
          "no-sql-alias-order-by": noSqlAliasOrderBy,
          "no-bare-to-locale": noBareToLocale,
          "no-raw-badge-variant-map": noRawBadgeVariantMap,
        },
      },
    },
    rules: {
      "local/no-sql-alias-order-by": "error",
      "local/no-bare-to-locale": "error",
      "local/no-raw-badge-variant-map": "error",
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
  // ── La ruta de un archivo almacenado se arma en un solo lugar ─────────────
  // Turbopack evalúa `path.join` como patrón de archivo y traza todo lo que calce;
  // con un primer argumento de runtime, el patrón globea el proyecto entero. Así
  // `.next/standalone` llegó a 2,5 GB con 10.316 archivos subidos por usuarios dentro
  // del artefacto de despliegue. `resolveStorageFile` (lib/storage/config.ts) encapsula
  // ese join con el `turbopackIgnore` —que es léxico y por eso no se puede delegar— y
  // además valida el nombre.
  //
  // Las excepciones son rutas que NO son del almacenamiento de la app (BACKUP_DIR,
  // process.cwd(), tessdata, assets de public/) o usos de string puro (extname/basename).
  {
    files: ["app/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    ignores: [
      "lib/storage/**",
      "lib/testing/**",
      "**/*.test.{ts,tsx}",
      "**/__tests__/**",
      // Rutas del host o de assets, no del almacenamiento de la app.
      "app/(app)/admin/backups/actions.ts",
      "**/oc-pdfcn-render.ts",
      "lib/services/platform-health.ts",
      "lib/services/purchasing-module/invoice-ocr.ts",
      // Sólo manipulan el nombre (extname/basename), nunca arman una ruta de escritura.
      "app/api/prevencion/documentacion/bulk-download/route.ts",
      "lib/requests/request-service-module/add-quotation.ts",
      "lib/services/fuel-tae.ts",
      "lib/services/prevention-documents/utils.ts",
      "lib/services/prevention-sensitive-files.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "node:path",
              message:
                "[storage] No armes rutas de archivos almacenados con path.join: usa resolveStorageFile() de @/lib/storage/config. Sin su `turbopackIgnore` el build mete el repositorio entero —incluidos los archivos subidos por usuarios— en .next/standalone.",
            },
          ],
        },
      ],
    },
  },
  {
    // Código vendorizado de pdfcn (ver components/pdf/README.md). Sus `<img>` y
    // demás etiquetas no son DOM: son primitivas que el renderer de Takumi
    // interpreta para componer el PDF, así que las reglas pensadas para páginas
    // web no aplican. Se limita a este árbol para no relajarlas en la app.
    files: ["components/pdf/**/*.{ts,tsx}"],
    // Los `eslint-disable` que trae el original apuntan a la configuración de
    // upstream; aquí sobran, pero borrarlos sólo aumenta la diferencia con el
    // registro sin ganar nada.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      "@next/next/no-img-element": "off",
      "jsx-a11y/alt-text": "off",
    },
  },
]);

export default eslintConfig;
