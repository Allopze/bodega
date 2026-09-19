/**
 * Guarda de regresión — los dos usos indebidos de `components/ui/tabs.tsx`
 * que produjeron 4 de las 5 fallas de accesibilidad de la auditoría axe
 * (WCAG AA, `aria-valid-attr-value`) del 2026-09-19.
 *
 * El diagnóstico original culpaba a que Radix desmonta el `TabsContent`
 * inactivo, y el fix que se intentó (`forceMount`) no arreglaba nada: axe-core
 * exime de validación el `aria-controls` de cualquier trigger con
 * `aria-selected="false"` (`node_modules/axe-core/axe.js:27132-27178`), así
 * que el panel inactivo nunca se valida, esté montado o no. Las causas reales
 * eran otras dos, y las dos son detectables por escaneo estático:
 *
 * 1. `<Tabs>`/`<TabsList>`/`<TabsTrigger>` usado como filtro de una sola vista,
 *    sin ningún `<TabsContent>` — el trigger activo emite `aria-controls` hacia
 *    un id que nunca existió, ni montado ni desmontado.
 * 2. `<TabsContent id="...">` — Radix arma las props como
 *    `{ id: contentId, ...contentProps }`, y el spread pisa el id generado.
 *    El `aria-controls` del trigger activo queda apuntando a un id que nadie
 *    tiene.
 *
 * Mismo patrón de escaneo que `ui-primitives-no-literal-colors.test.ts`: sin
 * navegador, corre en cada `npm test`, no depende de que alguien vuelva a
 * correr la auditoría E2E completa (~12 minutos) para notar la regresión.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const SCANNED_ROOTS = ["components", "app/(app)"]

function scannedFiles(): string[] {
  return SCANNED_ROOTS.flatMap((root) =>
    readdirSync(path.join(ROOT, root), { recursive: true, encoding: "utf8" })
      .map((entry) => `${root}/${entry.split(path.sep).join("/")}`)
      .filter((rel) => rel.endsWith(".tsx") && !rel.endsWith(".test.tsx")),
  ).sort()
}

const files = scannedFiles()

describe("primitivo Tabs — sin id propio en TabsContent", () => {
  it("encuentra archivos que escanear (el glob no quedó vacío)", () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it.each(files)("%s no pasa id= a TabsContent — Radix lo pisa (aria-controls roto)", (relPath) => {
    const source = readFileSync(path.join(ROOT, relPath), "utf8")
    const offenders = [...source.matchAll(/<TabsContent\b[^>]*\bid=/g)].map((m) => m[0])
    expect(offenders).toEqual([])
  })
})

describe("primitivo Tabs — TabsTrigger siempre con un TabsContent real", () => {
  /**
   * Sólo lo que de verdad importa `TabsTrigger`: `evaluation-section-nav.tsx`
   * navega con `<Select>` y nunca importa `TabsTrigger`, así que queda fuera
   * por construcción, no por excepción.
   */
  it.each(files)(
    "%s: si importa TabsTrigger de components/ui/tabs, también importa TabsContent",
    (relPath) => {
      const source = readFileSync(path.join(ROOT, relPath), "utf8")
      const importLine = source
        .split("\n")
        .find((line) => line.includes('from "@/components/ui/tabs"'))
      if (!importLine || !importLine.includes("TabsTrigger")) return
      expect(importLine).toContain("TabsContent")
    },
  )
})
