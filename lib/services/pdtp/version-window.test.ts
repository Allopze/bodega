import { describe, expect, it } from "vitest"
import {
  comparePdtpPeriods,
  filterPdtpRowsBeforeSuccessor,
  isPdtpMonthBeforeSuccessor,
  isPdtpPeriodInVersionWindow,
  resolvePdtpVersionOwningPeriod,
  resolvePdtpVersionWindows,
} from "./version-window"

const rows = [
  { id: "v1", year: 2026, version: 1, status: "closed", activatedAt: "2026-01-05T15:00:00.000Z" },
  { id: "v2", year: 2026, version: 2, status: "closed", activatedAt: "2026-05-12T15:00:00.000Z" },
  { id: "v3", year: 2026, version: 3, status: "active", activatedAt: "2026-09-20T15:00:00.000Z" },
  { id: "draft", year: 2026, version: 4, status: "draft", activatedAt: null },
  { id: "archived-never", year: 2026, version: 5, status: "archived", activatedAt: null },
]

describe("ventanas por versión (PREV-C05-B)", () => {
  it("encadena las versiones vigentes del año sin solape", () => {
    const windows = resolvePdtpVersionWindows(rows)
    expect([...windows.keys()]).toEqual(["v1", "v2", "v3"])
    expect(windows.get("v1")).toMatchObject({ from: { month: 1, week: 1 }, until: { month: 5, week: 2 }, successor: { programId: "v2", version: 2 } })
    expect(windows.get("v2")).toMatchObject({ from: { month: 5, week: 2 }, until: { month: 9, week: 3 } })
    expect(windows.get("v3")).toMatchObject({ from: { month: 9, week: 3 }, until: null, successor: null })
  })

  it("la semana de activación es de la versión que entra", () => {
    const windows = resolvePdtpVersionWindows(rows)
    expect(isPdtpPeriodInVersionWindow({ year: 2026, month: 5, week: 2 }, windows.get("v1")!)).toBe(false)
    expect(isPdtpPeriodInVersionWindow({ year: 2026, month: 5, week: 1 }, windows.get("v1")!)).toBe(true)
    expect(isPdtpPeriodInVersionWindow({ year: 2026, month: 5, week: 2 }, windows.get("v2")!)).toBe(true)
  })

  it("el dueño de un período anterior a toda activación es la línea de base", () => {
    expect(resolvePdtpVersionOwningPeriod(rows, { year: 2026, month: 1, week: 1 })?.id).toBe("v1")
    expect(resolvePdtpVersionOwningPeriod([{ ...rows[1]! }, { ...rows[2]! }], { year: 2026, month: 2, week: 1 })?.id).toBe("v2")
    expect(resolvePdtpVersionOwningPeriod(rows, { year: 2026, month: 7, week: 4 })?.id).toBe("v2")
    expect(resolvePdtpVersionOwningPeriod(rows, { year: 2026, month: 12, week: 4 })?.id).toBe("v3")
    expect(resolvePdtpVersionOwningPeriod(rows, { year: 2025, month: 1, week: 1 })).toBeNull()
  })

  it("recorta filas y meses al límite superior", () => {
    const until = { year: 2026, month: 5, week: 2 }
    const cells = [{ year: 2026, month: 5, week: 1 }, { year: 2026, month: 5, week: 2 }, { year: 2026, month: 6, week: 1 }]
    expect(filterPdtpRowsBeforeSuccessor(cells, until)).toEqual([cells[0]])
    expect(filterPdtpRowsBeforeSuccessor(cells, null)).toEqual(cells)
    expect(isPdtpMonthBeforeSuccessor(2026, 5, until)).toBe(true)
    expect(isPdtpMonthBeforeSuccessor(2026, 5, { year: 2026, month: 5, week: 1 })).toBe(false)
    expect(isPdtpMonthBeforeSuccessor(2026, 6, until)).toBe(false)
    expect(comparePdtpPeriods({ year: 2026, month: 1, week: 1 }, { year: 2025, month: 12, week: 4 })).toBeGreaterThan(0)
  })
})
