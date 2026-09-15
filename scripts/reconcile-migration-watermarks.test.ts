import { describe, expect, it } from "vitest"
import { buildWatermarkReconciliation, LEGACY_FUTURE_WATERMARKS } from "./reconcile-migration-watermarks.mjs"

describe("reconciliación segura del watermark de migraciones", () => {
  const journal = [
    { tag: "0275_cot001_awarded_quotation", when: 1789380000000, hash: "hash-275" },
    ...LEGACY_FUTURE_WATERMARKS.slice(0, 2).map((entry, index) => ({
      tag: entry.tag,
      when: entry.correctedWhen,
      hash: `hash-${276 + index}`,
    })),
  ]

  it("corrige sólo filas cuyo hash y watermark legado coinciden", () => {
    const rows = LEGACY_FUTURE_WATERMARKS.slice(0, 2).map((entry, index) => ({
      id: 277 + index,
      hash: `hash-${276 + index}`,
      createdAt: entry.legacyWhen,
    }))

    expect(buildWatermarkReconciliation({ journal, appliedRows: rows })).toEqual([
      { id: 277, tag: LEGACY_FUTURE_WATERMARKS[0]!.tag, from: LEGACY_FUTURE_WATERMARKS[0]!.legacyWhen, to: LEGACY_FUTURE_WATERMARKS[0]!.correctedWhen },
      { id: 278, tag: LEGACY_FUTURE_WATERMARKS[1]!.tag, from: LEGACY_FUTURE_WATERMARKS[1]!.legacyWhen, to: LEGACY_FUTURE_WATERMARKS[1]!.correctedWhen },
    ])
  })

  it("bloquea si el hash aplicado no corresponde al SQL del journal", () => {
    const entry = LEGACY_FUTURE_WATERMARKS[0]!
    expect(() => buildWatermarkReconciliation({
      journal,
      appliedRows: [{ id: 277, hash: "hash-incorrecto", createdAt: entry.legacyWhen }],
    })).toThrow(/hash/i)
  })

  it("no altera ambientes que ya están reconciliados", () => {
    expect(buildWatermarkReconciliation({
      journal,
      appliedRows: [{ id: 277, hash: "hash-276", createdAt: LEGACY_FUTURE_WATERMARKS[0]!.correctedWhen }],
    })).toEqual([])
  })
})
