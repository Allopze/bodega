import { describe, expect, it } from "vitest"
import { shapeN45Status, type N45SlotInput } from "./n45-status"

const worksites = [
  { id: "ws-b", name: "Faena Beta" },
  { id: "ws-a", name: "Faena Alfa" },
  { id: "ws-c", name: "Faena Gamma" },
  { id: "ws-d", name: "Faena Delta" },
  { id: "ws-e", name: "Faena Épsilon" },
]

const slot = (over: Partial<N45SlotInput> & Pick<N45SlotInput, "worksiteId" | "status">): N45SlotInput => ({
  scheduledMonth: 2, measuredOn: null, groupCode: null, ...over,
})

describe("shapeN45Status", () => {
  it("una fila por faena con el estado de su casilla N°45, la fecha si está hecha y el mes si está pendiente", () => {
    const { rows } = shapeN45Status(worksites, [
      slot({ worksiteId: "ws-a", status: "completed", measuredOn: "2026-02-12", groupCode: "SIO2-A" }),
      slot({ worksiteId: "ws-b", status: "pending" }),
    ])
    expect(rows.find((row) => row.worksiteId === "ws-a")).toEqual({
      worksiteId: "ws-a", worksiteName: "Faena Alfa", status: "completed", scheduledMonth: 2, measuredOn: "2026-02-12", groupCode: "SIO2-A",
    })
    expect(rows.find((row) => row.worksiteId === "ws-b")).toMatchObject({ status: "pending", scheduledMonth: 2, measuredOn: null })
  })

  it("una faena sin casilla del año se nombra («none»): no se la da por hecha ni por pendiente", () => {
    const { rows } = shapeN45Status(worksites, [slot({ worksiteId: "ws-a", status: "completed", measuredOn: "2026-02-12" })])
    expect(rows.find((row) => row.worksiteId === "ws-c")).toMatchObject({ status: "none", scheduledMonth: null, measuredOn: null })
  })

  it("lo que falta va primero (no hecha, pendiente), después lo hecho, y al final lo que no aplica o no tiene casilla; por nombre dentro de cada grupo", () => {
    const { rows } = shapeN45Status(worksites, [
      slot({ worksiteId: "ws-a", status: "completed", measuredOn: "2026-02-12" }),
      slot({ worksiteId: "ws-b", status: "pending" }),
      slot({ worksiteId: "ws-c", status: "not_completed" }),
      slot({ worksiteId: "ws-d", status: "not_applicable" }),
    ])
    expect(rows.map((row) => [row.worksiteName, row.status])).toEqual([
      ["Faena Gamma", "not_completed"],
      ["Faena Beta", "pending"],
      ["Faena Alfa", "completed"],
      ["Faena Delta", "not_applicable"],
      ["Faena Épsilon", "none"],
    ])
  })

  it("el resumen cuenta hechas sobre las exigibles: «no aplica» y «sin casilla» salen del denominador", () => {
    const { done, due } = shapeN45Status(worksites, [
      slot({ worksiteId: "ws-a", status: "completed", measuredOn: "2026-02-12" }),
      slot({ worksiteId: "ws-b", status: "pending" }),
      slot({ worksiteId: "ws-c", status: "not_completed" }),
      slot({ worksiteId: "ws-d", status: "not_applicable" }),
    ])
    expect({ done, due }).toEqual({ done: 1, due: 3 })
  })

  it("si una faena tuviera más de una casilla, la hecha gana", () => {
    const { rows } = shapeN45Status([{ id: "ws-a", name: "Faena Alfa" }], [
      slot({ worksiteId: "ws-a", status: "pending" }),
      slot({ worksiteId: "ws-a", status: "completed", measuredOn: "2026-03-01" }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: "completed", measuredOn: "2026-03-01" })
  })

  it("las casillas de faenas fuera de la lista no crean filas", () => {
    const { rows } = shapeN45Status([{ id: "ws-a", name: "Faena Alfa" }], [slot({ worksiteId: "ws-zzz", status: "pending" })])
    expect(rows.map((row) => row.worksiteId)).toEqual(["ws-a"])
  })
})
