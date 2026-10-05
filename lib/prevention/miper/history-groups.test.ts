import { describe, expect, it } from "vitest"
import type { MiperHistoryEvent } from "@/lib/services/miper/queries"
import { groupHistoryEvents } from "./history-groups"

const ev = (id: string, over: Partial<MiperHistoryEvent> = {}): MiperHistoryEvent => ({ id, at: "2026-10-01T12:00:05.000Z", actorName: "Ana", actingAs: null, changeType: "import_applied", object: "entry", reason: null, ...over })

describe("groupHistoryEvents", () => {
  it("colapsa una racha consecutiva idéntica", () => {
    const groups = groupHistoryEvents([ev("a"), ev("b", { at: "2026-10-01T12:00:50.000Z" }), ev("c")])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ count: 3, ids: ["a", "b", "c"] })
    expect(groups[0]!.first.id).toBe("a")
  })
  it("no agrupa eventos no consecutivos", () => {
    const groups = groupHistoryEvents([ev("a"), ev("x", { changeType: "submitted" }), ev("b")])
    expect(groups.map((g) => g.count)).toEqual([1, 1, 1])
  })
  it("un motivo rompe el grupo, también el del primero", () => {
    expect(groupHistoryEvents([ev("a"), ev("b", { reason: "porque sí" }), ev("c")]).map((g) => g.count)).toEqual([1, 1, 1])
    expect(groupHistoryEvents([ev("a", { reason: "r" }), ev("b")]).map((g) => g.count)).toEqual([1, 1])
  })
  it("el límite de minuto parte el grupo", () => {
    expect(groupHistoryEvents([ev("a"), ev("b", { at: "2026-10-01T12:01:00.000Z" })]).map((g) => g.count)).toEqual([1, 1])
  })
  it("distinto objeto, actor o rol no se agrupa", () => {
    expect(groupHistoryEvents([ev("a"), ev("b", { object: "matrix" }), ev("c", { actorName: "Luis" }), ev("d", { actingAs: "prevention:risk:edit" })]).map((g) => g.count)).toEqual([1, 1, 1, 1])
  })
  it("lista vacía", () => expect(groupHistoryEvents([])).toEqual([]))
})
