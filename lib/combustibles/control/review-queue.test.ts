import { describe, expect, it, vi } from "vitest"

vi.mock("@/db", () => ({ db: {} }))

const { REVIEW_TABS, normalizeFlagReasons, originHrefFor, parseReviewTab } = await import("./review-queue")
const { MIN_DECISION_NOTE_LENGTH, formatMeterReading, formatPerformance, validateDecisionNote } = await import(
  "@/app/(app)/combustibles/control/revision/review-helpers"
)

describe("parseReviewTab", () => {
  it("usa «En revisión» sin parámetro o con un valor desconocido", () => {
    expect(parseReviewTab(undefined).status).toBe("flagged")
    expect(parseReviewTab("cualquier-cosa").status).toBe("flagged")
  })

  it("mapea cada pestaña a su estado de revisión", () => {
    expect(REVIEW_TABS.map((tab) => [tab.value, tab.status])).toEqual([
      ["en-revision", "flagged"],
      ["aprobadas", "approved"],
      ["rechazadas", "rejected"],
    ])
    expect(parseReviewTab("aprobadas").status).toBe("approved")
    expect(parseReviewTab(["rechazadas", "aprobadas"]).status).toBe("rejected")
  })
})

describe("normalizeFlagReasons", () => {
  it("conserva solo motivos conocidos", () => {
    expect(normalizeFlagReasons(["outlier", "inventado", 3, "over_capacity"])).toEqual(["outlier", "over_capacity"])
  })

  it("tolera jsonb que no es un arreglo", () => {
    expect(normalizeFlagReasons(null)).toEqual([])
    expect(normalizeFlagReasons({ outlier: true })).toEqual([])
  })
})

describe("originHrefFor", () => {
  it("enlaza las cargas en terreno y el histórico al detalle TAE", () => {
    expect(originHrefFor({ source: "field", taeSubmissionId: "t1", operationBatchId: null })).toBe("/combustibles/tae/t1")
    expect(originHrefFor({ source: "legacy_tae", taeSubmissionId: "t2", operationBatchId: null })).toBe("/combustibles/tae/t2")
  })

  it("enlaza la planilla de cargas a su lote", () => {
    expect(originHrefFor({ source: "operations_import", taeSubmissionId: null, operationBatchId: "b1" })).toBe("/combustibles/importar/operaciones/b1")
  })

  it("devuelve null si falta el origen", () => {
    expect(originHrefFor({ source: "operations_import", taeSubmissionId: null, operationBatchId: null })).toBeNull()
  })
})

describe("validateDecisionNote", () => {
  it("exige el mínimo de caracteres sobre el texto recortado", () => {
    expect(validateDecisionNote("corta")).toMatch(String(MIN_DECISION_NOTE_LENGTH))
    expect(validateDecisionNote("   123456789   ")).not.toBeNull()
    expect(validateDecisionNote("1234567890")).toBeNull()
  })

  it("rechaza notas demasiado largas", () => {
    expect(validateDecisionNote("x".repeat(501))).not.toBeNull()
  })
})

describe("formato de la cola", () => {
  it("muestra el rendimiento con su unidad y «—» si falta", () => {
    expect(formatPerformance(3.5, "km_per_liter")).toBe("3,5 km/L")
    expect(formatPerformance(12, "liters_per_hour")).toBe("12 L/h")
    expect(formatPerformance(null, "km_per_liter")).toBe("—")
    expect(formatPerformance(3, null)).toBe("—")
  })

  it("rotula la lectura según el medidor", () => {
    expect(formatMeterReading(1500, "odometer")).toMatch(/km$/)
    expect(formatMeterReading(820.5, "hour_meter")).toMatch(/h$/)
    expect(formatMeterReading(null, "odometer")).toBe("—")
  })
})
