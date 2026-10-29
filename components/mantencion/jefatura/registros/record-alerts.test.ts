import { describe, expect, it } from "vitest"
import { photoCaption } from "./photo-labels"
import { recordAlertTags } from "./record-alerts"

const clean = {
  readingJumpAlert: false, readingJumpConfirmed: false, outOfWorksite: false, worksiteName: "Biodiversa",
  schedule: null, duplicateOf: null, stampGapHours: null,
}

describe("alertas de un registro como etiquetas", () => {
  it("un registro limpio no trae ninguna", () => {
    expect(recordAlertTags(clean)).toEqual([])
  })

  it("dice cada alerta con su nombre, y la del sello sólo cuando la diferencia supera las 72 h", () => {
    const tags = recordAlertTags({
      ...clean,
      readingJumpAlert: true, readingJumpConfirmed: true, outOfWorksite: true,
      schedule: { name: "Camiones y tractos", version: 2, intervalValue: 20_000, suggestedIntervalValue: 40_000, manualReason: "Pedido de la jefatura" },
      duplicateOf: { id: "rec-1", folio: "MP-BIO-0001" },
      stampGapHours: 2400,
    })
    expect(tags.map((tag) => tag.key)).toEqual(["jump", "outside", "manual", "duplicate", "stamp"])
    expect(tags.find((tag) => tag.key === "stamp")?.label).toContain("72 h")
    expect(tags.find((tag) => tag.key === "duplicate")?.linkTo).toEqual({ id: "rec-1", folio: "MP-BIO-0001" })
    expect(tags.find((tag) => tag.key === "manual")?.hint).toBe("Pedido de la jefatura")
    expect(tags.find((tag) => tag.key === "outside")?.hint).toContain("Biodiversa")
  })

  it("la pauta sugerida no es «elegida a mano»", () => {
    const tags = recordAlertTags({ ...clean, schedule: { name: "P", version: 1, intervalValue: 40_000, suggestedIntervalValue: 40_000, manualReason: null } })
    expect(tags).toEqual([])
  })
})

describe("nombre de cada foto", () => {
  it("numera sólo las que comparten tipo", () => {
    const preventive = [{ kind: "filtros" as const }, { kind: "sticker" as const }]
    expect(photoCaption(preventive, 0)).toBe("Filtros usados")
    expect(photoCaption(preventive, 1)).toBe("Sticker de mantención")
    const corrective = [{ kind: "correctiva" as const }, { kind: "correctiva" as const }, { kind: "correctiva" as const }]
    expect(photoCaption(corrective, 0)).toBe("Foto del trabajo 1 de 3")
    expect(photoCaption(corrective, 2)).toBe("Foto del trabajo 3 de 3")
    expect(photoCaption(corrective, 9)).toBe("")
  })
})
