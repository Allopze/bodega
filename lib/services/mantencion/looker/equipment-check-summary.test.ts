import { describe, expect, it } from "vitest"
import { groupItems, NO_SYSTEM, pendingItems, pendingText, systemResolver, type DetailItem } from "./equipment-check-summary"

const item = (name: string, state: DetailItem["state"], system: string | null = null, reason: string | null = null): DetailItem => ({
  name, system, state, reason,
})

describe("Ficha · lo pendiente del período", () => {
  const checks = [
    { date: "2026-09-15", items: [item("Filtro aire", "no_realizado", "Motor"), item("Aceite", "realizado", "Motor"), item("ABS", "no_aplica", "Frenos")] },
    { date: "2026-10-20", items: [item("Filtro aire", "no_realizado", "Motor"), item("Aceite", "no_realizado", "Motor"), item("Frenos", "realizado", "Frenos")] },
    { date: "2026-11-10", items: [item("Filtro aire", "no_realizado", "Motor"), item("Aceite", "realizado", "Motor"), item("Frenos", "realizado", "Frenos")] },
  ]

  it("cuenta las repeticiones, ordena por ellas y deja fuera lo que siempre se hizo", () => {
    const pending = pendingItems(checks)
    expect(pending.map((row) => row.name)).toEqual(["Filtro aire", "Aceite"])
    expect(pending[0]).toMatchObject({ notDoneCount: 3, applicableCount: 3, system: "Motor", doneSince: false })
    expect(pending[0]!.dates).toEqual(["2026-11-10", "2026-10-20", "2026-09-15"])
  })

  it("«No aplica» no entra en el total de pautas donde el ítem aplicaba", () => {
    const [row] = pendingItems([
      { date: "2026-09-01", items: [item("Filtro", "no_aplica")] },
      { date: "2026-10-01", items: [item("Filtro", "no_realizado")] },
      { date: "2026-11-01", items: [item("Filtro", "realizado")] },
    ])
    expect(row).toMatchObject({ notDoneCount: 1, applicableCount: 2, doneSince: true })
  })

  it("no depende del orden de entrada y desempata por la fecha más reciente", () => {
    const rows = pendingItems([
      { date: "2026-09-01", items: [item("A", "no_realizado")] },
      { date: "2026-11-01", items: [item("B", "no_realizado")] },
    ])
    expect(rows.map((row) => row.name)).toEqual(["B", "A"])
    expect(pendingItems([...checks].reverse())).toEqual(pendingItems(checks))
  })

  it("sin ítems no realizados no hay pendientes", () => {
    expect(pendingItems([{ date: "2026-10-01", items: [item("A", "realizado")] }])).toEqual([])
    expect(pendingItems([])).toEqual([])
  })

  it("dice la fecha cuando fue una vez y «N de M pautas» cuando se repitió", () => {
    const [once] = pendingItems([{ date: "2026-09-15", items: [item("Filtro", "no_realizado")] }, { date: "2026-10-15", items: [item("Filtro", "realizado")] }])
    expect(pendingText({ ...once!, doneSince: false })).toBe("No se hizo el 15-09-2026")
    expect(pendingText(once!)).toBe("No se hizo el 15-09-2026; después sí se hizo")
    const [twice] = pendingItems(checks.slice(0, 2))
    expect(pendingText(twice!)).toBe("No se hizo en 2 de 2 pautas")
  })
})

describe("Ficha · ítems agrupados", () => {
  it("lo no realizado primero, lo hecho por sistema (sin sistema al final) y «No aplica» aparte", () => {
    const grouped = groupItems([
      item("Sin sistema A", "realizado"),
      item("Aceite", "realizado", "Motor"),
      item("Frenos", "no_realizado", "Frenos", "Sin repuesto"),
      item("ABS", "no_aplica", "Frenos"),
      item("Filtro", "realizado", "Motor"),
    ])
    expect(grouped.notDone.map((row) => row.name)).toEqual(["Frenos"])
    expect(grouped.doneBySystem.map((group) => group.system)).toEqual(["Motor", NO_SYSTEM])
    expect(grouped.doneBySystem[0]!.items.map((row) => row.name)).toEqual(["Aceite", "Filtro"])
    expect(grouped.notApplicable.map((row) => row.name)).toEqual(["ABS"])
  })
})

describe("Ficha · sistema de un ítem del histórico", () => {
  const resolve = systemResolver([
    { name: "Motor", items: [{ name: "Cambio aceite" }, { name: "Revisión general" }] },
    { name: "Frenos", items: [{ name: "Revisión general" }, { name: "Pastillas" }] },
  ])

  it("sólo lo resuelve cuando el nombre es exacto y está en un único sistema", () => {
    expect(resolve("Cambio aceite")).toBe("Motor")
    expect(resolve("Revisión general")).toBeNull()
    expect(resolve("cambio aceite")).toBeNull()
    expect(resolve("Otro ítem")).toBeNull()
  })
})
