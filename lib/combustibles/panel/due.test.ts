import { describe, expect, it } from "vitest"
import type { FuelInboxRow } from "@/lib/combustibles/inbox/types"
import { pickRowsToFix, toPanelDueRow } from "./due"

const TODAY = "2026-10-31"

function row(partial: Partial<FuelInboxRow> = {}): FuelInboxRow {
  return {
    key: "carga:l1",
    kind: "carga",
    id: "l1",
    worksiteId: "w1",
    worksiteName: "Biodiversa",
    equipmentLabel: "CA-14 · KPRT·14",
    vehicleId: "v1",
    title: "Lectura menor a la anterior",
    reasonCodes: ["meter_regression"],
    reasonLabel: "Lectura menor a la anterior",
    datum: "182.310 km; la carga anterior marcó 182.900 km",
    dataMonth: "2026-10",
    dueDate: "2026-10-31",
    waitingSince: "2026-10-25T14:00:00.000Z",
    href: "/combustibles/cargas/terreno/l1",
    canAct: false,
    ...partial,
  }
}

describe("fila de «Lo que vence primero»", () => {
  it("compone título, detalle y fecha límite en palabras", () => {
    expect(toPanelDueRow(row(), (href) => href, TODAY)).toEqual({
      key: "carga:l1",
      href: "/combustibles/cargas/terreno/l1",
      dueLabel: "31 oct",
      overdue: false,
      equipment: "CA-14 · KPRT·14",
      title: "Lectura menor a la anterior",
      detail: "Espera hace 6 días · 182.310 km; la carga anterior marcó 182.900 km",
      waitingSince: "2026-10-25T14:00:00.000Z",
    })
  })

  it("una fecha límite anterior a hoy está vencida", () => {
    expect(toPanelDueRow(row({ dueDate: "2026-09-30", dataMonth: "2026-09" }), (href) => href, TODAY)).toMatchObject({ dueLabel: "30 sep", overdue: true })
    expect(toPanelDueRow(row({ dueDate: "2026-10-31" }), (href) => href, TODAY).overdue).toBe(false)
  })

  it("sin ficha propia abre el caso en la bandeja, con el período", () => {
    const due = toPanelDueRow(row({ href: null, kind: "patente", key: "patente:tarjeta:b1:HXJT21" }), (href) => `${href}&periodo=2026-10`, TODAY)
    expect(due.href).toBe("/combustibles/revisar?tipo=patente&item=patente%3Atarjeta%3Ab1%3AHXJT21&periodo=2026-10")
  })

  it("sin dato ni equipo no deja separadores sueltos", () => {
    const due = toPanelDueRow(row({ datum: "", equipmentLabel: "", title: "Caso · Sello repetido", waitingSince: "2026-10-31T13:00:00.000Z" }), (href) => href, TODAY)
    expect(due).toMatchObject({ equipment: "", title: "Caso · Sello repetido" })
    expect(due.detail).toBe("Llegó hoy")
  })
})

describe("lo que le toca corregir a quien no decide", () => {
  const rows = [
    row({ key: "carga:l1", id: "l1" }),
    row({ key: "carga:l2", id: "l2" }),
    row({ key: "caso:c1", kind: "caso", id: "c1", canAct: false }),
    row({ key: "patente:p1", kind: "patente", id: "p1", canAct: true }),
    row({ key: "carga:l3", id: "l3", canAct: true }),
  ]

  it("deja lo que su rol puede resolver y las cargas que registró ella misma", () => {
    expect(pickRowsToFix(rows, new Set(["l2"]), 10).map((r) => r.key)).toEqual(["carga:l2", "patente:p1", "carga:l3"])
  })

  it("reconoce la carga también por el id de su registro en terreno", () => {
    expect(pickRowsToFix([row({ id: "sub-9", key: "carga:sub-9" })], new Set(["sub-9"]), 10)).toHaveLength(1)
  })

  it("no cuela casos ajenos aunque compartan el id", () => {
    expect(pickRowsToFix([row({ kind: "caso", id: "l2", key: "caso:l2" })], new Set(["l2"]), 10)).toEqual([])
  })

  it("respeta el tope", () => {
    expect(pickRowsToFix(rows, new Set(["l1", "l2"]), 2)).toHaveLength(2)
  })
})
