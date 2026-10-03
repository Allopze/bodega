import { describe, expect, it } from "vitest"
import { programProgress, progressPercent } from "./progress"

describe("avance del programa", () => {
  it("cuenta realizadas (con fuera de plazo), pendientes, vencidas e incumplidas", () => {
    const progress = programProgress(
      [
        { outcome: "done", dueOn: "2026-01-31" },
        { outcome: "done", dueOn: "2026-02-28", late: true },
        { outcome: "pending", dueOn: "2026-03-31" },
        { outcome: "pending", dueOn: "2026-02-28" },
        { outcome: "not_done", dueOn: "2026-02-28" },
      ],
      "2026-03-15",
    )
    expect(progress).toEqual({ done: 2, late: 1, pending: 2, overdue: 1, failed: 1, planned: 5, ratio: 0.4 })
  })

  it("no marca vencida la que vence hoy", () => {
    const progress = programProgress([{ outcome: "pending", dueOn: "2026-03-15" }], "2026-03-15")
    expect(progress.pending).toBe(1)
    expect(progress.overdue).toBe(0)
  })

  it("sólo las realizadas pueden quedar marcadas fuera de plazo", () => {
    const progress = programProgress(
      [
        { outcome: "done", dueOn: "2026-01-31", late: true },
        { outcome: "not_done", dueOn: "2026-01-31", late: true },
      ],
      "2026-03-15",
    )
    expect(progress.late).toBe(1)
  })

  it("las reemplazadas no entran en el denominador", () => {
    const progress = programProgress(
      [
        { outcome: "done", dueOn: "2026-01-31" },
        { outcome: "superseded", dueOn: "2026-02-28" },
      ],
      "2026-12-31",
    )
    expect(progress).toEqual({ done: 1, late: 0, pending: 0, overdue: 0, failed: 0, planned: 1, ratio: 1 })
  })

  it("el resultado vigente es el que cuenta", () => {
    // Incumplida en su momento, luego registrada como hecha: la ocurrencia trae
    // el outcome vigente y cuenta como realizada.
    const progress = programProgress([{ outcome: "done", dueOn: "2026-01-31", late: true }], "2026-03-15")
    expect(progress.done).toBe(1)
    expect(progress.failed).toBe(0)
  })

  it("ratio nulo si no hay nada planificado", () => {
    expect(programProgress([], "2026-12-31").ratio).toBeNull()
    const onlySuperseded = programProgress([{ outcome: "superseded", dueOn: "2026-01-31" }], "2026-12-31")
    expect(onlySuperseded.planned).toBe(0)
    expect(onlySuperseded.ratio).toBeNull()
  })
})

describe("progressPercent", () => {
  it("redondea hacia abajo: 199 de 200 es 99%, nunca 100% con algo pendiente", () => {
    expect(progressPercent({ done: 199, planned: 200 })).toBe(99)
    expect(progressPercent({ done: 200, planned: 200 })).toBe(100)
    expect(progressPercent({ done: 1, planned: 3 })).toBe(33)
  })
  it("en enteros: 29 de 100 es 29% (`Math.floor(0.29 * 100)` daría 28)", () => {
    expect(progressPercent({ done: 29, planned: 100 })).toBe(29)
    expect(progressPercent({ done: 57, planned: 100 })).toBe(57)
  })
  it("sin nada planificado no hay porcentaje", () => {
    expect(progressPercent({ done: 0, planned: 0 })).toBeNull()
  })
})
