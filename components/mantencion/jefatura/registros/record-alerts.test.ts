import { describe, expect, it } from "vitest"
import { photoCaption } from "./photo-labels"
import { gapText, recordAlertTags } from "./record-alerts"

const equipment = { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Biodiversa", unit: "km" as const }

const clean = {
  readingJumpAlert: false, readingJumpConfirmed: false, outOfWorksite: false, worksiteName: "Biodiversa",
  schedule: null, duplicateOf: null, duplicateConfirmed: false, stampGap: null, photos: [],
  reading: 40_312, unit: "km" as const, previousReading: null, equipment, receivedAt: "2026-10-30T15:00:00.000Z",
}

describe("alertas de un registro", () => {
  it("un registro limpio no trae ninguna", () => {
    expect(recordAlertTags(clean)).toEqual([])
  })

  it("dice cada alerta con su nombre corto y, en pantalla, qué pasó y qué hacer", () => {
    const tags = recordAlertTags({
      ...clean,
      readingJumpAlert: true, readingJumpConfirmed: true, outOfWorksite: true, worksiteName: "Santa Fe",
      previousReading: { value: 20_100, date: "2026-09-12", source: "MP-BIO-0000" },
      schedule: { name: "Camiones y tractos", version: 2, intervalValue: 20_000, suggestedIntervalValue: 40_000, manualReason: "Pedido de la jefatura" },
      duplicateOf: { id: "rec-1", folio: "MP-BIO-0001" }, duplicateConfirmed: true,
      stampGap: { hours: 2400, subject: "firma", photoId: null, at: "2026-07-22T12:00:00.000Z" },
    })
    expect(tags.map((tag) => tag.key)).toEqual(["jump", "outside", "manual", "duplicate", "stamp"])
    // El nombre corto es el del PDF y el del filtro: no cambia.
    expect(tags.map((tag) => tag.label)).toEqual([
      "Salto de lectura", "Fuera de faena", "Pauta elegida a mano", "Preventiva duplicada", "Hora del sello y de recepción difieren más de 72 h",
    ])
    const byKey = Object.fromEntries(tags.map((tag) => [tag.key, tag]))
    expect(byKey.jump!.message).toContain("20.212 km más que la anterior (20.100 km, del 12-09-2026)")
    expect(byKey.jump!.message).toContain("El mecánico la confirmó en el teléfono")
    expect(byKey.outside!.message).toBe("Se registró en la faena Santa Fe, pero el equipo pertenece a Biodiversa.")
    expect(byKey.manual!.message).toContain("de 20.000 km en vez de la sugerida, de 40.000 km")
    expect(byKey.manual!.message).toContain("Motivo: Pedido de la jefatura.")
    expect(byKey.duplicate!.linkTo).toEqual({ id: "rec-1", folio: "MP-BIO-0001" })
    expect(byKey.duplicate!.message).toContain("confirmó en el teléfono que era otro trabajo")
    // Cada alerta dice qué hacer: nada queda sólo en un `title`.
    for (const tag of tags) {
      expect(tag.title.length).toBeGreaterThan(0)
      expect(tag.action.length).toBeGreaterThan(0)
    }
  })

  it("una pauta sin motivo lo dice y pide el motivo", () => {
    const [tag] = recordAlertTags({ ...clean, schedule: { name: "P", version: 1, intervalValue: 20_000, suggestedIntervalValue: 40_000, manualReason: null } })
    expect(tag!.message).toContain("Motivo: sin motivo registrado.")
    expect(tag!.action).toContain("Pide el motivo")
  })

  it("la pauta sugerida no es «elegida a mano»", () => {
    const tags = recordAlertTags({ ...clean, schedule: { name: "P", version: 1, intervalValue: 40_000, suggestedIntervalValue: 40_000, manualReason: null } })
    expect(tags).toEqual([])
  })

  it("si la fecha que no cuadra es la de una foto, nombra la foto y enlaza a ella", () => {
    const [tag] = recordAlertTags({
      ...clean,
      photos: [
        { id: "ph-1", kind: "filtros", stampedAt: "2026-10-30T14:00:00.000Z", receivedAt: "2026-10-30T15:00:00.000Z", width: 800, height: 600 },
        { id: "ph-2", kind: "sticker", stampedAt: "2026-07-22T11:38:00.000Z", receivedAt: "2026-10-30T15:00:00.000Z", width: 800, height: 600 },
      ],
      stampGap: { hours: 2400, subject: "foto", photoId: "ph-2", at: "2026-07-22T11:38:00.000Z" },
    })
    expect(tag!.key).toBe("stamp")
    expect(tag!.label).toContain("72 h")
    expect(tag!.message).toContain("«Sticker de mantención» es del 22-07-2026, 3 meses antes de que se recibiera el registro")
    expect(tag!.action).toBe("Pide una foto nueva o confirma con el mecánico.")
    expect(tag!.anchor).toEqual({ href: "#foto-ph-2", label: "Ver la foto" })
  })

  it("si la que no cuadra es la hora de la firma, lo dice y lleva a los datos", () => {
    const [tag] = recordAlertTags({ ...clean, stampGap: { hours: 120, subject: "firma", photoId: null, at: "2026-10-25T15:00:00.000Z" } })
    expect(tag!.message).toContain("El teléfono firmó el registro el 25-10-2026")
    expect(tag!.message).toContain("5 días antes de que llegara a la plataforma")
    expect(tag!.anchor?.href).toBe("#datos-del-registro")
  })
})

describe("diferencia dicha como la diría una persona", () => {
  it("horas hasta dos días, días hasta dos meses y meses después", () => {
    expect(gapText(5)).toBe("5 horas")
    expect(gapText(1)).toBe("1 hora")
    expect(gapText(120)).toBe("5 días")
    expect(gapText(2400)).toBe("3 meses")
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
