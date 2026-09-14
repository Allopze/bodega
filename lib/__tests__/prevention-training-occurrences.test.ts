import { describe, expect, it } from "vitest"
import {
  PREDEFINED_TRAINING_CATALOG_YEAR,
  PREDEFINED_TRAINING_CATALOG_VERSION,
  PREDEFINED_TRAINING_CATALOG,
  resolvePredefinedTrainingCatalogYear,
  occurrenceSeedRows,
} from "@/lib/prevention/training-occurrences-catalog"

describe("catálogo predefinido de capacitación", () => {
  it("conserva los 14 cursos y 6 campañas del programa 2026", () => {
    expect(PREDEFINED_TRAINING_CATALOG_YEAR).toBe(2026)
    expect(PREDEFINED_TRAINING_CATALOG_VERSION).toBe("programa-capacitacion-2026-v1")
    expect(PREDEFINED_TRAINING_CATALOG).toHaveLength(20)
    expect(PREDEFINED_TRAINING_CATALOG.filter((item) => item.itemType === "course")).toHaveLength(14)
    expect(PREDEFINED_TRAINING_CATALOG.filter((item) => item.itemType === "campaign")).toHaveLength(6)
    expect(new Set(PREDEFINED_TRAINING_CATALOG.map((item) => item.code)).size).toBe(20)
    expect(new Set(PREDEFINED_TRAINING_CATALOG.map((item) => item.audience))).toEqual(new Set(["Dirigido a todo el personal."]))
  })

  it("mantiene el mapeo PDTP explícito y no inventa actividades", () => {
    const mapped = new Map(
      PREDEFINED_TRAINING_CATALOG.map((item) => [item.code, item.pdtpActivityNumbers]),
    )

    expect(mapped.get("CAP-02")).toEqual([54])
    expect(mapped.get("CAP-03")).toEqual([63])
    expect(mapped.get("CAP-04")).toEqual([56])
    expect(mapped.get("CAP-07")).toEqual([55])
    expect(mapped.get("CAP-11")).toEqual([58])
    expect(mapped.get("CAM-01")).toEqual([85])
    expect(mapped.get("CAM-02")).toEqual([85])
    expect(mapped.get("CAM-03")).toEqual([86])
    expect(mapped.get("CAM-04")).toEqual([89])
    expect(mapped.get("CAM-05")).toEqual([87])
    expect(mapped.get("CAM-06")).toEqual([85])

    expect(PREDEFINED_TRAINING_CATALOG.filter((item) => item.pdtpActivityNumbers.length === 0).map((item) => item.code))
      .toEqual(["CAP-01", "CAP-05", "CAP-06", "CAP-08", "CAP-09", "CAP-10", "CAP-12", "CAP-13", "CAP-14"])
  })

  it("refleja las semanas marcadas en la planilla fuente", () => {
    expect(PREDEFINED_TRAINING_CATALOG.map((item) => [item.code, item.schedule.map((slot) => slot.slotKey)])).toEqual([
      ["CAP-01", ["annual"]],
      ["CAP-02", ["m03-w2", "m04-w3"]],
      ["CAP-03", ["m02-w1", "m03-w3"]],
      ["CAP-04", ["m01-w4"]],
      ["CAP-05", ["m03-w3"]],
      ["CAP-06", ["m04-w2"]],
      ["CAP-07", ["m05-w2"]],
      ["CAP-08", ["m04-w1"]],
      ["CAP-09", ["m06-w2"]],
      ["CAP-10", ["m09-w2"]],
      ["CAP-11", ["m03-w4"]],
      ["CAP-12", ["m05-w2", "m07-w2"]],
      ["CAP-13", ["m08-w2"]],
      ["CAP-14", ["m10-w2"]],
      ["CAM-01", ["m03-w2"]],
      ["CAM-02", ["m01-w1", "m04-w2"]],
      ["CAM-03", ["m05-w1"]],
      ["CAM-04", ["m11-w2"]],
      ["CAM-05", ["annual"]],
      ["CAM-06", ["m10-w2"]],
    ])
  })

  it("genera 24 ocurrencias por faena, conserva repeticiones y representa los dos ítems anuales", () => {
    const rows = PREDEFINED_TRAINING_CATALOG.flatMap((item) => occurrenceSeedRows(item, "faena-1", 2026))

    expect(rows).toHaveLength(24)
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
    expect(rows.filter((row) => row.catalogCode === "CAP-02")).toHaveLength(2)
    expect(rows.filter((row) => row.catalogCode === "CAP-12")).toHaveLength(2)
    expect(rows.find((row) => row.catalogCode === "CAP-01")).toMatchObject({
      slotKey: "annual",
      scheduledMonth: null,
      scheduledWeek: null,
    })
    expect(rows.find((row) => row.catalogCode === "CAM-05")).toMatchObject({
      slotKey: "annual",
      scheduledMonth: null,
      scheduledWeek: null,
    })
    expect(rows.find((row) => row.catalogCode === "CAP-02" && row.slotKey === "m03-w2"))
      .toMatchObject({ scheduledMonth: 3, scheduledWeek: 2 })
  })

  it("normaliza años no publicados al único programa operativo", () => {
    expect(resolvePredefinedTrainingCatalogYear("2025")).toBe(PREDEFINED_TRAINING_CATALOG_YEAR)
    expect(resolvePredefinedTrainingCatalogYear("no-es-un-año")).toBe(PREDEFINED_TRAINING_CATALOG_YEAR)
  })
})
