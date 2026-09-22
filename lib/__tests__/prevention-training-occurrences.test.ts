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

  it("refleja el cronograma alineado con la grilla del PDTP 2026", () => {
    expect(PREDEFINED_TRAINING_CATALOG.map((item) => [item.code, item.schedule.map((slot) => slot.slotKey)])).toEqual([
      ["CAP-01", ["annual"]],
      ["CAP-02", ["m09-w4", "m10-w4"]],
      ["CAP-03", ["m02-w3", "m05-w2", "m08-w2", "m09-w2", "m12-w2"]],
      ["CAP-04", [
        "m02-w4", "m03-w4", "m04-w4", "m05-w4", "m06-w4",
        "m07-w4", "m08-w4", "m09-w4", "m10-w4", "m11-w4",
      ]],
      ["CAP-05", ["m03-w3"]],
      ["CAP-06", ["m04-w2"]],
      ["CAP-07", ["m05-w3", "m05-w4"]],
      ["CAP-08", ["m04-w1"]],
      ["CAP-09", ["m06-w2"]],
      ["CAP-10", ["m09-w2"]],
      ["CAP-11", ["m02-w4", "m03-w1"]],
      ["CAP-12", ["m05-w2", "m07-w2"]],
      ["CAP-13", ["m08-w2"]],
      ["CAP-14", ["m10-w2"]],
      ["CAM-01", ["m02-w1"]],
      ["CAM-02", ["m02-w2", "m02-w3"]],
      ["CAM-03", ["m03-w1", "m03-w2", "m03-w3", "m03-w4", "m04-w1"]],
      ["CAM-04", ["m10-w1", "m10-w2", "m10-w3", "m10-w4", "m11-w1", "m11-w2", "m11-w3", "m11-w4"]],
      ["CAM-05", ["m08-w1", "m08-w2", "m08-w3", "m08-w4"]],
      ["CAM-06", ["m02-w4"]],
    ])
  })

  it("las 4 celdas de la N°85 (m02-w1..w4) quedan repartidas entre CAM-01/02/06 sin faltar ni sobrar ninguna", () => {
    const n85Codes = ["CAM-01", "CAM-02", "CAM-06"]
    const slots = PREDEFINED_TRAINING_CATALOG
      .filter((item) => n85Codes.includes(item.code))
      .flatMap((item) => item.schedule.map((slot) => slot.slotKey))

    expect(slots.slice().sort()).toEqual(["m02-w1", "m02-w2", "m02-w3", "m02-w4"])
  })

  it("genera 52 ocurrencias por faena, conserva repeticiones y representa el único ítem anual", () => {
    const rows = PREDEFINED_TRAINING_CATALOG.flatMap((item) => occurrenceSeedRows(item, "faena-1", 2026))

    expect(rows).toHaveLength(52)
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
    expect(rows.filter((row) => row.catalogCode === "CAP-02")).toHaveLength(2)
    expect(rows.filter((row) => row.catalogCode === "CAP-04")).toHaveLength(10)
    expect(rows.filter((row) => row.catalogCode === "CAP-12")).toHaveLength(2)
    expect(rows.filter((row) => row.catalogCode === "CAM-04")).toHaveLength(8)
    expect(rows.filter((row) => row.catalogCode === "CAM-05")).toHaveLength(4)
    expect(rows.find((row) => row.catalogCode === "CAP-01")).toMatchObject({
      slotKey: "annual",
      scheduledMonth: null,
      scheduledWeek: null,
    })
    expect(rows.find((row) => row.catalogCode === "CAM-05" && row.slotKey === "annual")).toBeUndefined()
    expect(rows.find((row) => row.catalogCode === "CAP-02" && row.slotKey === "m09-w4"))
      .toMatchObject({ scheduledMonth: 9, scheduledWeek: 4 })
  })

  it("normaliza años no publicados al único programa operativo", () => {
    expect(resolvePredefinedTrainingCatalogYear("2025")).toBe(PREDEFINED_TRAINING_CATALOG_YEAR)
    expect(resolvePredefinedTrainingCatalogYear("no-es-un-año")).toBe(PREDEFINED_TRAINING_CATALOG_YEAR)
  })
})
