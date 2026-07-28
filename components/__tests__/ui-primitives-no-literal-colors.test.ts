/**
 * Guarda de regresión — ningún primitive en components/ui/ debe usar colores
 * Tailwind literales (slate-500, etc.) en vez de tokens semánticos --color-*.
 * Existe porque `TableHead` usaba text-slate-500/bg-slate-50/border-slate-200
 * en silencio (auditoría UIUX-019/020, 2026-07-28): el test de contraste de
 * tokens no lo detectaba porque esos literales quedan fuera de su alcance.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

const UI_DIR = path.join(process.cwd(), "components/ui")

const PALETTE_PREFIXES = [
  "slate", "gray", "zinc", "neutral", "stone",
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
  "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose",
]

const LITERAL_COLOR_RE = new RegExp(
  `\\b(?:text|bg|border|ring|fill|stroke|from|to|via|outline|divide|decoration|placeholder)-(?:${PALETTE_PREFIXES.join("|")})-\\d{2,3}\\b`,
  "g",
)

const files = readdirSync(UI_DIR, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
  .map((entry) => entry.name)

describe("components/ui sin literales de paleta Tailwind (UIUX-019/020)", () => {
  it.each(files)("%s no usa colores Tailwind literales — usar tokens --color-*", (name) => {
    const source = readFileSync(path.join(UI_DIR, name), "utf8")
    const matches = [...source.matchAll(LITERAL_COLOR_RE)].map((m) => m[0])
    expect(matches).toEqual([])
  })
})
