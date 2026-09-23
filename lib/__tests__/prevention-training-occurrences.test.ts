import { describe, expect, it } from "vitest"
import {
  PREDEFINED_TRAINING_CATALOG_YEAR,
  PREDEFINED_TRAINING_CATALOG_VERSION,
  PREDEFINED_TRAINING_CATALOG,
  resolvePredefinedTrainingCatalogYear,
  occurrenceSeedRows,
} from "@/lib/prevention/training-occurrences-catalog"

describe("catálogo predefinido de capacitación", () => {
  it("conserva los 26 cursos y 7 campañas del programa 2026", () => {
    expect(PREDEFINED_TRAINING_CATALOG_YEAR).toBe(2026)
    expect(PREDEFINED_TRAINING_CATALOG_VERSION).toBe("programa-capacitacion-2026-v1")
    // Task 16 (2026-09-23): +6 cursos (CAP-21..26, N°53 y las 5 réplicas de
    // N°38) sobre los 27 que dejó Task 13.
    expect(PREDEFINED_TRAINING_CATALOG).toHaveLength(33)
    expect(PREDEFINED_TRAINING_CATALOG.filter((item) => item.itemType === "course")).toHaveLength(26)
    expect(PREDEFINED_TRAINING_CATALOG.filter((item) => item.itemType === "campaign")).toHaveLength(7)
    expect(new Set(PREDEFINED_TRAINING_CATALOG.map((item) => item.code)).size).toBe(33)
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
    // Task 8 (2026-09-22): N°16, 37, 51, 57, 59 y 60, antes sin ningún
    // instrumento vivo que las acredite.
    expect(mapped.get("CAP-15")).toEqual([16])
    expect(mapped.get("CAP-16")).toEqual([37])
    expect(mapped.get("CAP-17")).toEqual([51])
    expect(mapped.get("CAP-18")).toEqual([59])
    expect(mapped.get("CAP-19")).toEqual([60])
    expect(mapped.get("CAP-20")).toEqual([57])
    // Task 13 (2026-09-23): N°88 (Seguridad vial), antes sólo alcanzable
    // desde /prevencion/campanas.
    expect(mapped.get("CAM-07")).toEqual([88])
    // Task 16 (2026-09-23): N°53 (CAP-21) y las 5 réplicas idénticas de la
    // N°38 (CAP-22..26, decisión explícita del usuario — ver el comentario
    // junto a CAP-22 en training-occurrences-catalog.ts).
    expect(mapped.get("CAP-21")).toEqual([53])
    expect(mapped.get("CAP-22")).toEqual([38])
    expect(mapped.get("CAP-23")).toEqual([38])
    expect(mapped.get("CAP-24")).toEqual([38])
    expect(mapped.get("CAP-25")).toEqual([38])
    expect(mapped.get("CAP-26")).toEqual([38])

    expect(PREDEFINED_TRAINING_CATALOG.filter((item) => item.pdtpActivityNumbers.length === 0).map((item) => item.code))
      .toEqual(["CAP-01", "CAP-05", "CAP-06", "CAP-08", "CAP-09", "CAP-10", "CAP-12", "CAP-13", "CAP-14"])
  })

  it("refleja el cronograma alineado con la grilla del PDTP 2026", () => {
    // Task 16 (2026-09-23): las 4 semanas de los 12 meses (48 celdas), la
    // grilla completa que comparten CAP-21 y CAP-22..26.
    const allWeeksSlotKeys = Array.from({ length: 12 }, (_, monthIndex) =>
      Array.from({ length: 4 }, (_, weekIndex) => `m${String(monthIndex + 1).padStart(2, "0")}-w${weekIndex + 1}`),
    ).flat()

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
      ["CAP-15", ["annual"]],
      ["CAP-16", [
        "m01-w2", "m01-w4", "m02-w2", "m02-w4", "m03-w2", "m03-w4",
        "m04-w2", "m04-w4", "m05-w2", "m05-w4", "m06-w2", "m06-w4",
        "m07-w2", "m07-w4", "m08-w2", "m08-w4", "m09-w2", "m09-w4",
        "m10-w2", "m10-w4", "m11-w2", "m11-w4", "m12-w2", "m12-w4",
      ]],
      ["CAP-17", [
        "m01-w4", "m02-w2", "m03-w2", "m04-w2", "m05-w2", "m06-w2",
        "m07-w2", "m08-w2", "m09-w2", "m10-w2", "m11-w2", "m12-w2",
      ]],
      ["CAP-18", ["m03-w3", "m03-w4"]],
      ["CAP-19", ["m06-w2", "m06-w3"]],
      ["CAP-20", ["annual"]],
      ["CAM-07", [
        "m06-w1", "m06-w2", "m06-w3", "m06-w4",
        "m07-w1", "m07-w2", "m07-w3", "m07-w4",
      ]],
      ["CAP-21", allWeeksSlotKeys],
      ["CAP-22", allWeeksSlotKeys],
      ["CAP-23", allWeeksSlotKeys],
      ["CAP-24", allWeeksSlotKeys],
      ["CAP-25", allWeeksSlotKeys],
      ["CAP-26", allWeeksSlotKeys],
    ])
  })

  it("las 4 celdas de la N°85 (m02-w1..w4) quedan repartidas entre CAM-01/02/06 sin faltar ni sobrar ninguna", () => {
    const n85Codes = ["CAM-01", "CAM-02", "CAM-06"]
    const slots = PREDEFINED_TRAINING_CATALOG
      .filter((item) => n85Codes.includes(item.code))
      .flatMap((item) => item.schedule.map((slot) => slot.slotKey))

    expect(slots.slice().sort()).toEqual(["m02-w1", "m02-w2", "m02-w3", "m02-w4"])
  })

  it("genera 390 ocurrencias por faena, conserva repeticiones y representa los ítems anuales", () => {
    const rows = PREDEFINED_TRAINING_CATALOG.flatMap((item) => occurrenceSeedRows(item, "faena-1", 2026))

    // 102 (Task 5 + Task 8 + Task 13) + 288 de la Task 16: CAP-21 (48, N°53)
    // + CAP-22..26 (48 cada una, las 5 réplicas de la N°38) = 6 × 48.
    expect(rows).toHaveLength(390)
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
    expect(rows.filter((row) => row.catalogCode === "CAP-02")).toHaveLength(2)
    expect(rows.filter((row) => row.catalogCode === "CAP-04")).toHaveLength(10)
    expect(rows.filter((row) => row.catalogCode === "CAP-12")).toHaveLength(2)
    expect(rows.filter((row) => row.catalogCode === "CAM-04")).toHaveLength(8)
    expect(rows.filter((row) => row.catalogCode === "CAM-05")).toHaveLength(4)
    expect(rows.filter((row) => row.catalogCode === "CAM-07")).toHaveLength(8)
    expect(rows.filter((row) => row.catalogCode === "CAP-16")).toHaveLength(24)
    expect(rows.filter((row) => row.catalogCode === "CAP-17")).toHaveLength(12)
    expect(rows.filter((row) => row.catalogCode === "CAP-18")).toHaveLength(2)
    expect(rows.filter((row) => row.catalogCode === "CAP-19")).toHaveLength(2)
    expect(rows.filter((row) => row.catalogCode === "CAP-21")).toHaveLength(48)
    expect(rows.filter((row) => row.catalogCode === "CAP-22")).toHaveLength(48)
    expect(rows.filter((row) => row.catalogCode === "CAP-23")).toHaveLength(48)
    expect(rows.filter((row) => row.catalogCode === "CAP-24")).toHaveLength(48)
    expect(rows.filter((row) => row.catalogCode === "CAP-25")).toHaveLength(48)
    expect(rows.filter((row) => row.catalogCode === "CAP-26")).toHaveLength(48)
    expect(rows.find((row) => row.catalogCode === "CAP-01")).toMatchObject({
      slotKey: "annual",
      scheduledMonth: null,
      scheduledWeek: null,
    })
    // CAP-15 (N°16) y CAP-20 (N°57) son on_demand: mismo centinela "annual"
    // que CAP-01, ver Task 8.
    expect(rows.find((row) => row.catalogCode === "CAP-15")).toMatchObject({
      slotKey: "annual",
      scheduledMonth: null,
      scheduledWeek: null,
    })
    expect(rows.find((row) => row.catalogCode === "CAP-20")).toMatchObject({
      slotKey: "annual",
      scheduledMonth: null,
      scheduledWeek: null,
    })
    expect(rows.filter((row) => row.slotKey === "annual").map((row) => row.catalogCode).sort())
      .toEqual(["CAP-01", "CAP-15", "CAP-20"])
    expect(rows.find((row) => row.catalogCode === "CAM-05" && row.slotKey === "annual")).toBeUndefined()
    expect(rows.find((row) => row.catalogCode === "CAP-02" && row.slotKey === "m09-w4"))
      .toMatchObject({ scheduledMonth: 9, scheduledWeek: 4 })
  })

  it("normaliza años no publicados al único programa operativo", () => {
    expect(resolvePredefinedTrainingCatalogYear("2025")).toBe(PREDEFINED_TRAINING_CATALOG_YEAR)
    expect(resolvePredefinedTrainingCatalogYear("no-es-un-año")).toBe(PREDEFINED_TRAINING_CATALOG_YEAR)
  })
})
