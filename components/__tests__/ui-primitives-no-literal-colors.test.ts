/**
 * Guarda de regresión — ningún componente de `components/` ni ninguna pantalla
 * de `app/(app)/` debe usar colores Tailwind literales (slate-500, blue-600…)
 * en vez de los tokens semánticos `--color-*`.
 *
 * Nació acotada a `components/ui/` porque `TableHead` usaba
 * text-slate-500/bg-slate-50/border-slate-200 en silencio (auditoría
 * UIUX-019/020, 2026-07-28): el test de contraste de tokens no lo detectaba
 * porque esos literales quedan fuera de su alcance.
 *
 * Se extendió a las páginas el 2026-09-05: la pantalla de trazabilidad había
 * acumulado 135 literales (azul como color de marca, un arcoíris de siete hues
 * en el timeline) sin que nada avisara, justamente porque el guard sólo miraba
 * `components/ui/`. Un primitivo limpio no sirve de nada si la página lo pinta
 * por encima.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()

/** Raíces que se escanean: los componentes compartidos y las pantallas del shell. */
const SCANNED_ROOTS = ["components", "app/(app)"]

const PALETTE_PREFIXES = [
  "slate", "gray", "zinc", "neutral", "stone",
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
  "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose",
]

const LITERAL_COLOR_RE = new RegExp(
  `\\b(?:text|bg|border|ring|fill|stroke|from|to|via|outline|divide|decoration|placeholder)-(?:${PALETTE_PREFIXES.join("|")})-\\d{2,3}\\b`,
  "g",
)

/**
 * Deuda existente al extender el guard (2026-09-05), CONGELADA: estos archivos
 * pueden conservar sus literales pero no sumar ninguno, y ningún archivo nuevo
 * puede entrar a la lista. Migrarlos a tokens es trabajo aparte —toca navegación
 * y módulos que exigen QA visual propio—, no un efecto colateral de esta guarda.
 *
 * El número es el conteo exacto en el momento de congelar: si baja, hay que
 * bajarlo aquí (o sacar el archivo al llegar a 0); si sube, el test falla.
 */
const FROZEN_DEBT: Record<string, number> = {
  "components/layout/nav-rows.tsx": 19,
  "components/layout/sidebar-user-profile.tsx": 5,
  "components/layout/desktop-nav-areas.tsx": 5,
  "app/(app)/combustibles/bitacora/bitacora-table.tsx": 8,
  "app/(app)/admin/inventario-faena/inventory-list.tsx": 4,
  "app/(app)/combustibles/import-fuel-modal-upload.tsx": 4,
  "app/(app)/admin/inventario-faena/[id]/page.tsx": 3,
  "app/(app)/combustibles/cuenta-corriente/[id]/statement-detail.tsx": 2,
  "app/(app)/admin/contenedores/[id]/page.tsx": 2,
  "app/(app)/prevencion/inspecciones/seguimiento/page.tsx": 1,
  "app/(app)/modulo-inactivo/page.tsx": 1,
}

function countLiterals(relPath: string): string[] {
  const source = readFileSync(path.join(ROOT, relPath), "utf8")
  return [...source.matchAll(LITERAL_COLOR_RE)].map((m) => m[0])
}

/**
 * Sólo UI que se despacha: los `.test.tsx` quedan fuera porque sus fixtures y
 * aserciones pueden nombrar clases literales legítimamente sin que eso pinte
 * nada en pantalla.
 */
const files = SCANNED_ROOTS.flatMap((root) =>
  readdirSync(path.join(ROOT, root), { recursive: true, encoding: "utf8" })
    .map((entry) => `${root}/${entry.split(path.sep).join("/")}`)
    .filter((rel) => rel.endsWith(".tsx") && !rel.endsWith(".test.tsx")),
).sort()

describe("sin literales de paleta Tailwind fuera de los tokens (UIUX-019/020)", () => {
  it("encuentra archivos que escanear (el glob no quedó vacío)", () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it.each(files.filter((f) => !(f in FROZEN_DEBT)))(
    "%s no usa colores Tailwind literales — usar tokens --color-*",
    (relPath) => {
      expect(countLiterals(relPath)).toEqual([])
    },
  )

  it.each(Object.entries(FROZEN_DEBT))(
    "%s (deuda congelada) no suma literales nuevos",
    (relPath, allowed) => {
      // `toBeLessThanOrEqual` y no igualdad: limpiar de a poco no debe romper el
      // test, sólo sumar debe hacerlo.
      expect(countLiterals(relPath).length).toBeLessThanOrEqual(allowed)
    },
  )

  it("la lista de deuda congelada no tiene entradas muertas", () => {
    const stale = Object.keys(FROZEN_DEBT).filter((relPath) => countLiterals(relPath).length === 0)
    expect(stale, "archivos ya limpios: sácalos de FROZEN_DEBT").toEqual([])
  })
})
