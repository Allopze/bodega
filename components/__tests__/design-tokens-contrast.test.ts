/**
 * Guarda de regresión de contraste — WCAG 2.2.
 *
 * Los tokens de color viven en `app/globals.css` dentro de `@theme`, en OKLCH.
 * Este test los parsea, los convierte a luminancia relativa sRGB y verifica los
 * mínimos normativos. Existe porque el borde de los controles rendía 1.27:1
 * (auditoría 2026-07-24, hallazgo C-2): un ajuste de paleta no debe poder
 * reintroducir esa falla en silencio.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

const CSS = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8")

/** Extrae `--color-x: oklch(L C H)` del bloque @theme. */
function readToken(name: string): [number, number, number] {
  const re = new RegExp(`--${name}:\\s*oklch\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)`)
  const m = CSS.match(re)
  if (!m) throw new Error(`Token --${name} no encontrado en app/globals.css`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** OKLab → sRGB lineal (Björn Ottosson). */
function oklchToLinearRgb(L: number, C: number, h: number): [number, number, number] {
  const hr = (h * Math.PI) / 180
  const a = C * Math.cos(hr)
  const b = C * Math.sin(hr)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** Luminancia relativa WCAG. El sRGB lineal ya está des-gammado. */
function luminance(token: string): number {
  const [r, g, b] = oklchToLinearRgb(...readToken(token))
  const clamp = (c: number) => Math.min(1, Math.max(0, c))
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b)
}

function contrast(fg: string, bg: string): number {
  const a = luminance(fg)
  const b = luminance(bg)
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Contraste contra blanco puro.
 *
 * El texto del tile hero no sale de un token: es `text-white` sobre un relleno
 * macizo, así que no hay par de tokens que comparar.
 */
function contrastWithWhite(token: string): number {
  return (1 + 0.05) / (luminance(token) + 0.05)
}

describe("contraste de tokens de diseño", () => {
  describe("texto sobre superficie — WCAG 1.4.3 (AA, 4.5:1)", () => {
    const TEXT_TOKENS = ["color-text", "color-text-muted", "color-text-subtle", "color-text-faint"]

    it.each(TEXT_TOKENS)("%s cumple 4.5:1 sobre --color-surface", (token) => {
      expect(contrast(token, "color-surface")).toBeGreaterThanOrEqual(4.5)
    })

    it.each(TEXT_TOKENS)("%s cumple 4.5:1 sobre --color-chrome (sidebar/topbar)", (token) => {
      expect(contrast(token, "color-chrome")).toBeGreaterThanOrEqual(4.5)
    })

    // El texto no vive sólo sobre `surface`: `surface-2` es hover y secundario,
    // `surface-3` es inset y `bg` es el lienzo. El par más ajustado de la paleta
    // es text-faint sobre surface-3 (4.53:1): 0.03 de margen, así que oscurecer
    // ese fondo o aclarar ese texto rompe AA sin que nada más lo note.
    const SURFACES = ["color-surface-2", "color-surface-3", "color-bg"]
    it.each(TEXT_TOKENS.flatMap((token) => SURFACES.map((surface) => [token, surface])))(
      "%s cumple 4.5:1 sobre --%s",
      (token, surface) => {
        expect(contrast(token, surface)).toBeGreaterThanOrEqual(4.5)
      },
    )
  })

  /**
   * `--color-primary-deep` está documentado en DESIGN.md como "Fondo hero card"
   * y no se usó hasta el tile hero del tablero. El mínimo se fija acá porque si
   * un ajuste de paleta lo aclara, el número blanco deja de leerse y nadie lo
   * nota a ojo: la tarjeta sigue viéndose "verde y bonita".
   *
   * AAA (7:1) y no AA: el valor del tile es la cifra, y va en grande sobre un
   * relleno macizo — es el peor caso de lectura de toda la pantalla.
   */
  describe("tile hero — texto blanco sobre relleno macizo", () => {
    it("primary-deep sostiene texto blanco con contraste AAA", () => {
      expect(contrastWithWhite("color-primary-deep")).toBeGreaterThanOrEqual(7)
    })

    // El detalle del tile va a 70% de opacidad sobre el mismo fondo. La
    // aproximación conservadora es exigirle AA al blanco pleno con margen.
    it("y su texto secundario al 70% sigue sobre AA", () => {
      expect(contrastWithWhite("color-primary-deep")).toBeGreaterThanOrEqual(4.5 / 0.7)
    })
  })

  describe("texto de badge sobre su propio tint — WCAG 1.4.3", () => {
    it.each(["primary", "signal", "accent", "warning", "danger", "info", "success"])(
      "%s-ink cumple 4.5:1 sobre %s-tint",
      (family) => {
        expect(contrast(`color-${family}-ink`, `color-${family}-tint`)).toBeGreaterThanOrEqual(4.5)
      },
    )
  })

  describe("límite de controles — WCAG 1.4.11 (AA, 3:1)", () => {
    // Los campos son blancos sobre lienzo blanco: el borde es su único identificador.
    it("--color-border-control cumple 3:1 sobre --color-surface", () => {
      expect(contrast("color-border-control", "color-surface")).toBeGreaterThanOrEqual(3)
    })

    it("--color-border-control cumple 3:1 sobre --color-surface-2", () => {
      expect(contrast("color-border-control", "color-surface-2")).toBeGreaterThanOrEqual(3)
    })

    it("el hover del control no es más claro que su estado por defecto", () => {
      expect(luminance("color-border-control-hover")).toBeLessThan(luminance("color-border-control"))
    })
  })

  describe("texto blanco sobre rellenos sólidos — WCAG 1.4.3", () => {
    // Sólo las familias que efectivamente se usan como relleno con texto blanco.
    // signal/accent/warning NO se usan así (van como tint+ink); ver DESIGN.md.
    it.each(["primary", "danger", "info"])("blanco cumple 4.5:1 sobre --color-%s", (family) => {
      expect(contrast("color-bg", `color-${family}`)).toBeGreaterThanOrEqual(4.5)
    })
  })
})
