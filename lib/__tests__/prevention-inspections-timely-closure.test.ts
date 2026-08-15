import { describe, expect, it } from "vitest"
import {
  INSPECTION_ORIGIN_LABELS,
  summarizeTimelyClosure,
  type FindingClosureRow,
} from "@/lib/prevention/inspections"

const asOf = "2026-08-13"
const finding = (over: Partial<FindingClosureRow> = {}): FindingClosureRow => ({
  targetDate: "2026-07-01",
  closedOn: null,
  ...over,
})

describe("origen de la inspección", () => {
  it("distingue comité, prevención y mandante", () => {
    expect(Object.keys(INSPECTION_ORIGIN_LABELS).sort()).toEqual(["cphs", "mandante", "prevencion"])
  })
})

describe("cierre oportuno de hallazgos", () => {
  it("un hallazgo sin plazo comprometido no entra al indicador", () => {
    const summary = summarizeTimelyClosure([finding({ targetDate: null, closedOn: "2026-06-01" })], asOf)
    expect(summary).toMatchObject({ tracked: 0, timelyPct: null })
  })

  /* La distinción que justifica el indicador: cerrar todo con atraso no puede
   * verse igual que cerrar a tiempo. */
  it("separa el cierre a tiempo del cierre tardío", () => {
    const summary = summarizeTimelyClosure([
      finding({ closedOn: "2026-06-20" }),
      finding({ closedOn: "2026-07-30" }),
    ], asOf)
    expect(summary).toMatchObject({ tracked: 2, closedOnTime: 1, closedLate: 1, timelyPct: 50 })
  })

  it("cerrar justo en el plazo cuenta como a tiempo", () => {
    const summary = summarizeTimelyClosure([finding({ closedOn: "2026-07-01" })], asOf)
    expect(summary).toMatchObject({ closedOnTime: 1, closedLate: 0, timelyPct: 100 })
  })

  it("lo abierto y vencido penaliza el indicador", () => {
    const summary = summarizeTimelyClosure([finding(), finding({ closedOn: "2026-06-01" })], asOf)
    expect(summary).toMatchObject({ overdue: 1, closedOnTime: 1, timelyPct: 50 })
  })

  /* Lo abierto dentro de plazo aún no es ni cumplimiento ni incumplimiento: si
   * entrara al denominador, un hallazgo recién creado bajaría el indicador. */
  it("lo abierto dentro de plazo queda fuera del denominador", () => {
    const summary = summarizeTimelyClosure([
      finding({ closedOn: "2026-06-01" }),
      finding({ targetDate: "2026-12-31" }),
    ], asOf)
    expect(summary).toMatchObject({ openOnTime: 1, timelyPct: 100 })
  })

  it("sin nada juzgable todavía no reporta porcentaje", () => {
    const summary = summarizeTimelyClosure([finding({ targetDate: "2026-12-31" })], asOf)
    expect(summary).toMatchObject({ tracked: 1, timelyPct: null })
  })
})
