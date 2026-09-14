/**
 * Contrato de la auditoría automática de accesibilidad, verificado SIN
 * navegador: la suite `accessibility.spec.ts` sólo corre en E2E, así que sin
 * esto los dos hallazgos que la afectan (UX-001 y UX-002) no tendrían ninguna
 * red que impidiera revertirlos.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { discoverRoutePatterns } from "../scripts/capture-route-inventory"
import {
  accessibilityTargets,
  AXE_DISABLED_RULES,
  AXE_TAGS,
  dynamicRoutesWithoutFixture,
  EXCLUDED_ROUTES,
  ROUTE_URL_OVERRIDES,
  uncoveredStaticRoutes,
} from "./accessibility-targets"

describe("UX-001 — la regla de contraste no puede volver a apagarse", () => {
  /**
   * La suite corría con las etiquetas WCAG hasta 2.2 AA y acto seguido
   * desactivaba `color-contrast` ("audited separately in AUDITORIA.md"). Con
   * eso, la verificación de contraste quedaba delegada a una revisión
   * documental puntual y ningún cambio de token podía hacer fallar una prueba.
   */
  it("no desactiva `color-contrast` (ni ninguna otra regla sin motivo escrito)", () => {
    expect(AXE_DISABLED_RULES).not.toContain("color-contrast")
    expect(AXE_DISABLED_RULES).toEqual([])
  })

  it("conserva la cobertura de etiquetas WCAG hasta 2.2 AA", () => {
    expect([...AXE_TAGS]).toEqual(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
  })
})

// ── Contraste real de la paleta, también sin navegador ────────────────────────

/**
 * Reactivar la regla sólo sirve si la paleta la aprueba. axe mide el contraste
 * del DOM pintado, que aquí no existe; esto mide el de los tokens que producen
 * ese DOM, que es donde se introduce la regresión. Los pares son los que el
 * sistema de diseño realmente usa: texto sobre superficie/fondo, y cada
 * `*-ink` sobre su `*-tint` (el patrón de todos los badges y avisos).
 *
 * Los tres tokens sólidos que NO alcanzan 4.5:1 contra blanco —`signal`,
 * `warning` y `accent`— quedan fuera a propósito: un barrido de
 * `bg-signal`/`bg-warning`/`bg-accent` en `app/` y `components/` no encuentra
 * ninguno usado como fondo de texto; sólo aparecen como relleno de íconos
 * (`aria-hidden`/`alt`) y bordes, donde el criterio 1.4.3 no aplica.
 */
const AA_NORMAL_TEXT = 4.5

const TEXT_ON_SURFACE_PAIRS: Array<[string, string]> = [
  ["--color-text", "--color-surface"],
  ["--color-text", "--color-bg"],
  ["--color-text-muted", "--color-surface"],
  ["--color-text-muted", "--color-bg"],
  ["--color-text-subtle", "--color-surface"],
  ["--color-text-subtle", "--color-bg"],
  ["--color-text-faint", "--color-surface"],
  ["--color-text-faint", "--color-bg"],
  ["--color-text-faint", "--color-surface-3"],
  ["--color-brand-text", "--color-brand-surface"],
  ["--color-brand-text-muted", "--color-brand-surface"],
  ["--color-primary-ink", "--color-primary-tint"],
  ["--color-signal-ink", "--color-signal-tint"],
  ["--color-accent-ink", "--color-accent-tint"],
  ["--color-info-ink", "--color-info-tint"],
  ["--color-warning-ink", "--color-warning-tint"],
  ["--color-danger-ink", "--color-danger-tint"],
  ["--color-success-ink", "--color-success-tint"],
  // Botón primario y hero card: texto blanco sobre verde de marca.
  ["#ffffff", "--color-primary"],
  ["#ffffff", "--color-primary-strong"],
  ["#ffffff", "--color-primary-deep"],
  ["#ffffff", "--color-danger"],
  ["#ffffff", "--color-info"],
]

type Rgb = [number, number, number]

/** oklch → sRGB (matriz OKLab de Björn Ottosson), recortado al gamut. */
function oklchToSrgb(lightness: number, chroma: number, hue: number): Rgb {
  const radians = (hue * Math.PI) / 180
  const a = chroma * Math.cos(radians)
  const b = chroma * Math.sin(radians)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ]
  return linear.map((channel) => {
    const encoded = channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055
    return Math.min(1, Math.max(0, encoded))
  }) as Rgb
}

function relativeLuminance([r, g, b]: Rgb): number {
  const linearize = (channel: number) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

function contrastRatio(foreground: Rgb, background: Rgb): number {
  const [high, low] = [relativeLuminance(foreground), relativeLuminance(background)].sort((x, y) => y - x)
  return (high! + 0.05) / (low! + 0.05)
}

/** Lee los tokens `--color-*: oklch(L C H)` declarados en el bloque `@theme`. */
function readOklchTokens(): Map<string, Rgb> {
  const css = fs.readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8")
  const tokens = new Map<string, Rgb>()
  const pattern = /(--color-[\w-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/g
  for (const match of css.matchAll(pattern)) {
    if (tokens.has(match[1]!)) continue // primera declaración = tema claro
    tokens.set(match[1]!, oklchToSrgb(Number(match[2]), Number(match[3]), Number(match[4])))
  }
  return tokens
}

describe("UX-001 — la paleta declarada aprueba el contraste que la regla exige", () => {
  const tokens = readOklchTokens()
  const resolve = (name: string): Rgb => {
    if (name === "#ffffff") return [1, 1, 1]
    const value = tokens.get(name)
    if (!value) throw new Error(`Token ausente en app/globals.css: ${name}`)
    return value
  }

  it.each(TEXT_ON_SURFACE_PAIRS)("%s sobre %s alcanza AA (4.5:1)", (foreground, background) => {
    const ratio = contrastRatio(resolve(foreground), resolve(background))
    expect(Number(ratio.toFixed(2))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
  })
})

// ── UX-002: la cobertura sale del inventario, no de una lista fija ────────────

describe("UX-002 — el alcance de la auditoría no puede volver a ser una lista fija", () => {
  /**
   * Antes: 20 páginas declaradas a mano sobre 207. Módulos completos
   * (combustibles, flota, mantenciones, facturación, TI, recepción,
   * trazabilidad) quedaban fuera, y una pantalla nueva nacía fuera del alcance
   * sin que nada avisara.
   */
  it("audita toda página estática descubierta en `app/`", () => {
    expect(uncoveredStaticRoutes()).toEqual([])
  })

  it("cubre los módulos que la lista fija dejaba fuera", () => {
    const covered = accessibilityTargets().map((target) => target.pattern)
    for (const route of [
      "/combustibles/cuenta-corriente", "/flota", "/mantenciones",
      "/facturacion", "/ti/activos", "/recepcion", "/trazabilidad",
    ]) {
      expect(covered).toContain(route)
    }
    // Y sigue cubriendo lo que la lista fija ya traía, incluida la vía pública.
    expect(covered).toContain("/dashboard")
    expect(covered).toContain("/ppa")
    expect(accessibilityTargets().find((t) => t.pattern === "/ppa")?.auth).toBe(false)
    expect(accessibilityTargets().find((t) => t.pattern === "/dashboard")?.auth).toBe(true)
  })

  it("crece sola cuando aparece una página nueva", () => {
    const appDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-targets-"))
    const page = path.join(appDirectory, "(app)", "modulo-recien-nacido", "page.tsx")
    try {
      fs.mkdirSync(path.dirname(page), { recursive: true })
      fs.writeFileSync(page, "export default function Page() { return null }")

      expect(accessibilityTargets(appDirectory).map((t) => t.path)).toContain("/modulo-recien-nacido")
      expect(uncoveredStaticRoutes(appDirectory)).toEqual([])
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true })
    }
  })

  it("resuelve con fixture las rutas que no se pueden visitar tal cual", () => {
    const byPattern = new Map(accessibilityTargets().map((t) => [t.pattern, t.path]))
    expect(byPattern.get("/recepcion/nueva")).toBe("/recepcion/nueva?oc=po-audit-1")
    expect(byPattern.get("/compras/[id]/print")).toBe("/compras/oc-e2e/print")
    expect(byPattern.get("/entregas/[id]/print")).toBe("/entregas/del-e2e/print")
  })

  it("no conserva exclusiones ni fixtures de rutas que ya no existen", () => {
    const patterns = new Set(discoverRoutePatterns().map((route) => route.pattern))
    for (const pattern of [...Object.keys(EXCLUDED_ROUTES), ...Object.keys(ROUTE_URL_OVERRIDES)]) {
      expect({ pattern, existe: patterns.has(pattern) }).toEqual({ pattern, existe: true })
    }
  })

  it("declara qué rutas dinámicas siguen sin fixture en vez de callarlas", () => {
    // No es un fallo: es deuda visible. Lo que sí falla es que una ruta
    // dinámica se cuele al alcance sin URL concreta que visitar.
    const pending = dynamicRoutesWithoutFixture()
    expect(pending.every((pattern) => pattern.includes("["))).toBe(true)
    expect(accessibilityTargets().every((target) => !target.path.includes("["))).toBe(true)
  })
})
