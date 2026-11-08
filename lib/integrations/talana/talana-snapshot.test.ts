import { describe, expect, it } from "vitest"
import type { TalanaContractRow, TalanaListResult } from "./talana-client"
import { checkSnapshotComplete, evaluateActiveDrop, evaluateFusible, exceedsMassAltas } from "./talana-snapshot"

const TODAY = "2026-11-08"

function row(id: number, extra: Partial<TalanaContractRow> = {}): TalanaContractRow {
  return {
    id, personId: id, rut: `${id}-K`, rutValid: true, firstName: null, lastNamePaternal: null, lastNameMaternal: null, sex: null,
    employerName: null, contractType: null, cargo: null, costCenterId: null, costCenterName: null, jefeRut: null, jefeName: null,
    hiredOn: null, startsOn: null, endsOn: null, finiquitado: false, active: true, modifiedAt: null, ...extra,
  }
}

const list = (rows: TalanaContractRow[], extra: Partial<TalanaListResult<TalanaContractRow>> = {}): TalanaListResult<TalanaContractRow> =>
  ({ rows, rejected: 0, declaredCount: rows.length, pages: 1, truncated: false, ...extra })

describe("checkSnapshotComplete", () => {
  it("acepta una descarga coherente", () => {
    expect(checkSnapshotComplete({ all: list([row(1), row(2)]), active: list([row(1)]) })).toBeNull()
  })
  it("rechaza paginación cortada, conteo distinto o activos fuera de la lista completa", () => {
    expect(checkSnapshotComplete({ all: list([row(1)], { truncated: true }), active: list([]) })).toBe("pagination_truncated")
    expect(checkSnapshotComplete({ all: list([row(1)], { declaredCount: 5 }), active: list([]) })).toBe("count_mismatch")
    expect(checkSnapshotComplete({ all: list([row(1)]), active: list([row(9)]) })).toBe("active_not_in_full_list")
  })
  it("las filas descartadas cuentan para el conteo declarado", () => {
    expect(checkSnapshotComplete({ all: list([row(1)], { rejected: 1, declaredCount: 2 }), active: list([]) })).toBeNull()
  })
})

describe("fusible", () => {
  const previous = new Set(Array.from({ length: 100 }, (_, i) => i + 1))

  it("cero activos siempre bloquea, aun con el rearme", () => {
    expect(evaluateFusible({ activeCount: 0, drop: { previousActive: 0, unexplainedDrop: 0 }, bypassDrop: true })).toBe("no_active_contracts")
  })

  it("una caída del 30 % sin explicación bloquea", () => {
    const current = Array.from({ length: 100 }, (_, i) => row(i + 1))
    const activeIds = new Set(Array.from({ length: 70 }, (_, i) => i + 1))
    const drop = evaluateActiveDrop({ previousActiveIds: previous, current, currentActiveIds: activeIds, today: TODAY })
    expect(drop.unexplainedDrop).toBe(30)
    expect(evaluateFusible({ activeCount: 70, drop, bypassDrop: false })).toBe("active_drop")
    expect(evaluateFusible({ activeCount: 70, drop, bypassDrop: true })).toBeNull()
  })

  it("el escenario de agosto (81 finiquitos explícitos) NO bloquea", () => {
    const current = Array.from({ length: 100 }, (_, i) => row(i + 1, i < 81 ? { finiquitado: true, endsOn: "2026-08-30" } : {}))
    const activeIds = new Set(Array.from({ length: 19 }, (_, i) => i + 82))
    const drop = evaluateActiveDrop({ previousActiveIds: previous, current, currentActiveIds: activeIds, today: TODAY })
    expect(drop.unexplainedDrop).toBe(0)
    expect(evaluateFusible({ activeCount: 19, drop, bypassDrop: false })).toBeNull()
  })

  it("plazos vencidos y renovaciones explican la caída; un contrato que desaparece no", () => {
    const current = [
      row(1, { endsOn: "2026-10-31" }),
      row(2, { rut: "R2" }), row(200, { rut: "R2" }),
    ]
    const drop = evaluateActiveDrop({ previousActiveIds: new Set([1, 2, 3]), current, currentActiveIds: new Set([200]), today: TODAY })
    expect(drop.unexplainedDrop).toBe(1)
  })

  it("con menos de 10 activos en la base la proporción no se evalúa", () => {
    expect(evaluateFusible({ activeCount: 2, drop: { previousActive: 5, unexplainedDrop: 3 }, bypassDrop: false })).toBeNull()
  })

  it("demasiadas altas sólo cuentan después de la primera aplicación", () => {
    expect(exceedsMassAltas({ plannedAltas: 107, activeCount: 107, hasAppliedBefore: false, bypass: false })).toBe(false)
    expect(exceedsMassAltas({ plannedAltas: 10, activeCount: 20, hasAppliedBefore: true, bypass: false })).toBe(false)
    expect(exceedsMassAltas({ plannedAltas: 30, activeCount: 107, hasAppliedBefore: true, bypass: false })).toBe(true)
    expect(exceedsMassAltas({ plannedAltas: 30, activeCount: 107, hasAppliedBefore: true, bypass: true })).toBe(false)
  })
})
