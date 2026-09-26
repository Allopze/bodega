import { describe, expect, it } from "vitest"
import { objectivesFromRe36 } from "./period-closures"

type Doc = Parameters<typeof objectivesFromRe36>[0]

function row(activityId: string, janP: number, janE: number) {
  const cells = Array.from({ length: 48 }, () => ({ p: null as number | null, e: null as number | null }))
  cells[0] = { p: janP, e: janE }
  return { activityId, objectiveCode: "1", objectiveName: "Objetivo 1", cells }
}

describe("objectivesFromRe36 (PREV-C02)", () => {
  it("dentro de un objetivo, una actividad sobreejecutada no cubre a otra en cero", () => {
    const document = { sheets: [{ rows: [row("a", 1, 2), row("b", 1, 0)] }] } as unknown as Doc
    const [objective] = objectivesFromRe36(document, 1)
    expect(objective).toMatchObject({ planned: 2, executed: 1, percent: 0.5 })
  })
})
