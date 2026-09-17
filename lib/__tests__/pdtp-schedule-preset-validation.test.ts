import { describe, expect, it } from "vitest"
import { pdtpSchedulePresetBatchSchema } from "@/lib/validation/prevention-module/pdtp"

describe("pdtpSchedulePresetBatchSchema", () => {
  const base = {
    programId: "prog-1",
    activityIds: ["act-1"],
    mode: "replace" as const,
  }

  it("acepta un preset con regla sin params", () => {
    const r = pdtpSchedulePresetBatchSchema.parse({ ...base, preset: "weekly", params: {} })
    expect(r.preset).toBe("weekly")
  })

  it("rechaza plannedQuantity: 0 — alineado con pdtpRecurrenceRuleSchema.positive(), no .min(0)", () => {
    // Ronda de arreglos 1/5, Important 2: con `.min(0)` un `plannedQuantity: 0`
    // pasaba la validación, la proyección clampaba y descartaba las celdas
    // por no ser positivas, y para una actividad de fuente "rule" el lote
    // terminaba escribiendo el calendario entero en cero sin confirmación.
    expect(() => pdtpSchedulePresetBatchSchema.parse({
      ...base, preset: "daily", params: { plannedQuantity: 0 },
    })).toThrow()
  })

  it("rechaza plannedQuantity negativo", () => {
    expect(() => pdtpSchedulePresetBatchSchema.parse({
      ...base, preset: "daily", params: { plannedQuantity: -1 },
    })).toThrow()
  })

  it("acepta plannedQuantity positivo", () => {
    const r = pdtpSchedulePresetBatchSchema.parse({ ...base, preset: "daily", params: { plannedQuantity: 5 } })
    expect(r.params.plannedQuantity).toBe(5)
  })

  it("rechaza el preset puntual sin params.cells", () => {
    // Important 1: `punctual` sin celdas proyecta cero celdas — el Zod lo
    // ataja en el formulario en vez de descubrirlo en el servicio.
    expect(() => pdtpSchedulePresetBatchSchema.parse({
      ...base, preset: "punctual", params: {},
    })).toThrow(/celda/i)
  })

  it("rechaza el preset puntual con params.cells vacío", () => {
    expect(() => pdtpSchedulePresetBatchSchema.parse({
      ...base, preset: "punctual", params: { cells: [] },
    })).toThrow(/celda/i)
  })

  it("acepta el preset puntual con al menos una celda", () => {
    const r = pdtpSchedulePresetBatchSchema.parse({
      ...base, preset: "punctual", params: { cells: [{ month: 3, week: 2 }] },
    })
    expect(r.params.cells).toEqual([{ month: 3, week: 2 }])
  })

  it("rechaza celdas puntuales con (mes, semana) repetido", () => {
    // Misma protección que `scheduleCellArraySchema`: dos celdas iguales
    // producen el mismo id determinista y una pisa a la otra en silencio.
    expect(() => pdtpSchedulePresetBatchSchema.parse({
      ...base,
      preset: "punctual",
      params: { cells: [{ month: 3, week: 2 }, { month: 3, week: 2 }] },
    })).toThrow(/repetida/i)
  })

  it("acepta replaceConfirmedActivityIds como lista explícita de ids", () => {
    const r = pdtpSchedulePresetBatchSchema.parse({
      ...base, preset: "weekly", params: {}, replaceConfirmedActivityIds: ["act-1"],
    })
    expect(r.replaceConfirmedActivityIds).toEqual(["act-1"])
  })
})
