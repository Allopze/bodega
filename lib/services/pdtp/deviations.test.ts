/**
 * Pruebas puras de `applyDeviationsToSchedule` y `deviationsByActivityMonth`:
 * sin base de datos, sólo transformación de filas. El comportamiento con
 * base de datos real (`recordPdtpDeviation`, `withdrawPdtpDeviation`,
 * exclusión mutua con ejecuciones, huella no afectada) vive en
 * `lib/__tests__/pdtp-deviations.test.ts` (PGlite).
 */
import { describe, expect, it } from "vitest"
import type { PdtpExecutionDeviation } from "@/db/schema"
import { applyDeviationsToSchedule, deviationsByActivityMonth } from "./deviations"

type ScheduleRow = {
  id: string
  activityId: string
  year: number
  month: number
  week: number
  plannedQuantity: number
  sourceColumn: string
}

function cell(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    id: `a1-s-2050-${String(overrides.month ?? 1).padStart(2, "0")}-${overrides.week ?? 1}`,
    activityId: "a1",
    year: 2050,
    month: 1,
    week: 1,
    plannedQuantity: 5,
    sourceColumn: "catalog",
    ...overrides,
  }
}

function deviation(overrides: Partial<PdtpExecutionDeviation> = {}): PdtpExecutionDeviation {
  return {
    id: "dev-1",
    activityId: "a1",
    worksiteId: "ws-1",
    year: 2050,
    month: 1,
    week: 1,
    kind: "not_performed",
    reason: "Motivo de prueba con más de diez caracteres.",
    targetMonth: null,
    targetWeek: null,
    status: "active",
    createdByUserId: "user-1",
    createdAt: "2050-01-01T00:00:00.000Z",
    withdrawnByUserId: null,
    withdrawnAt: null,
    withdrawReason: null,
    ...overrides,
  } as PdtpExecutionDeviation
}

describe("applyDeviationsToSchedule", () => {
  it("sin desvíos, devuelve las filas sin tocar (misma referencia)", () => {
    const rows = [cell()]
    expect(applyDeviationsToSchedule(rows, [])).toBe(rows)
  })

  it("not_applicable elimina la celda del calendario", () => {
    const rows = [cell({ month: 1, week: 1, plannedQuantity: 5 }), cell({ month: 2, week: 1, plannedQuantity: 3, id: "a1-s-2050-02-1" })]
    const result = applyDeviationsToSchedule(rows, [
      deviation({ kind: "not_applicable", month: 1, week: 1 }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(expect.objectContaining({ month: 2, week: 1, plannedQuantity: 3 }))
  })

  it("reprogrammed mueve el planificado al destino y suma si ya tenía algo", () => {
    const rows = [
      cell({ month: 3, week: 2, plannedQuantity: 5, id: "origin" }),
      cell({ month: 4, week: 1, plannedQuantity: 2, id: "destino-previo" }),
    ]
    const result = applyDeviationsToSchedule(rows, [
      deviation({ id: "dev-repro", kind: "reprogrammed", month: 3, week: 2, targetMonth: 4, targetWeek: 1 }),
    ])
    // La celda de origen desaparece: su planificado ya no exige nada esa semana.
    expect(result.find((r) => r.month === 3 && r.week === 2)).toBeUndefined()
    // La celda destino suma 2 (previo) + 5 (movido) = 7, y queda marcada.
    const target = result.find((r) => r.month === 4 && r.week === 1)
    expect(target).toEqual(expect.objectContaining({ plannedQuantity: 7, sourceColumn: "deviation:dev-repro" }))
    expect(result).toHaveLength(1)
  })

  it("reprogrammed a una celda destino que no existía la crea, clonando el resto de las columnas", () => {
    const rows = [cell({ month: 3, week: 2, plannedQuantity: 5, id: "origin" })]
    const result = applyDeviationsToSchedule(rows, [
      deviation({ id: "dev-repro-2", kind: "reprogrammed", month: 3, week: 2, targetMonth: 6, targetWeek: 3 }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(expect.objectContaining({
      activityId: "a1", month: 6, week: 3, plannedQuantity: 5, sourceColumn: "deviation:dev-repro-2",
    }))
  })

  it("not_performed no toca el planificado: la celda sigue exigiéndose", () => {
    const rows = [cell({ month: 1, week: 1, plannedQuantity: 5 })]
    const result = applyDeviationsToSchedule(rows, [
      deviation({ kind: "not_performed", month: 1, week: 1 }),
    ])
    expect(result).toEqual(rows)
  })

  it("un desvío withdrawn no se aplica", () => {
    const rows = [cell({ month: 1, week: 1, plannedQuantity: 5 })]
    const result = applyDeviationsToSchedule(rows, [
      deviation({ kind: "not_applicable", month: 1, week: 1, status: "withdrawn" }),
    ])
    expect(result).toEqual(rows)
  })

  it("no afecta celdas de otra faena o actividad (la celda se identifica por actividad+mes+semana, la faena ya viene resuelta por el caller)", () => {
    const rows = [cell({ activityId: "a2", month: 1, week: 1, plannedQuantity: 9 })]
    const result = applyDeviationsToSchedule(rows, [
      deviation({ kind: "not_applicable", activityId: "a1", month: 1, week: 1 }),
    ])
    expect(result).toEqual(rows)
  })
})

describe("deviationsByActivityMonth", () => {
  it("cuenta desvíos activos por actividad y mes, ignorando los retirados", () => {
    const map = deviationsByActivityMonth([
      deviation({ kind: "not_performed", activityId: "a1", month: 1 }),
      deviation({ kind: "not_performed", activityId: "a1", month: 1, id: "dev-2" }),
      deviation({ kind: "not_applicable", activityId: "a1", month: 1, id: "dev-3" }),
      deviation({ kind: "reprogrammed", activityId: "a1", month: 2, id: "dev-4", targetMonth: 3, targetWeek: 1 }),
      deviation({ kind: "not_performed", activityId: "a1", month: 1, id: "dev-5", status: "withdrawn" }),
    ])
    expect(map.get("a1::1")).toEqual({ notPerformed: 2, notApplicable: 1, reprogrammed: 0 })
    expect(map.get("a1::2")).toEqual({ notPerformed: 0, notApplicable: 0, reprogrammed: 1 })
    expect(map.has("a1::3")).toBe(false)
  })
})
