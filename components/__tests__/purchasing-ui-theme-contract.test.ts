import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()

const PURCHASE_UI_FILES = [
  "app/(app)/compras/[id]/invoices-section.tsx",
  "app/(app)/compras/oc-list-rows.tsx",
]

describe("contrato de tema de Adquisiciones", () => {
  it("usa únicamente tokens semánticos de estado definidos", () => {
    const staleScaleReferences = PURCHASE_UI_FILES.flatMap((file) => {
      const source = readFileSync(join(ROOT, file), "utf8")
      return Array.from(source.matchAll(/--color-(?:danger|warning|success|signal)-\d+/g), (match) => `${file}: ${match[0]}`)
    })

    expect(staleScaleReferences).toEqual([])
  })

  it("no solicita firma en las entregas nuevas", () => {
    const source = readFileSync(join(ROOT, "app/(app)/entregas/delivery-form.tsx"), "utf8")

    expect(source).toContain("Comprobante")
    expect(source).not.toMatch(/firma|signature/i)
  })
})
