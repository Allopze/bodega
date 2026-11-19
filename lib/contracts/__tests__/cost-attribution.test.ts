import { describe, expect, it } from "vitest"
import {
  attributeCosts,
  emptySums,
  type AssignmentWindow,
  type CostComponent,
  type DatedCost,
} from "../cost-attribution"

const V = "veh-1"

function costo(
  day: string,
  amount: number,
  opts: Partial<DatedCost> = {},
): DatedCost {
  return {
    vehicleId: V,
    day,
    amount,
    component: "fuel",
    spansMonth: false,
    ...opts,
  }
}

function ventana(opts: Partial<AssignmentWindow> = {}): AssignmentWindow {
  return {
    vehicleId: V,
    contractId: "c-1",
    worksiteId: "w-a",
    validFrom: "2026-01-01",
    validTo: null,
    ...opts,
  }
}

const FAENA_ACTUAL = new Map([[V, "w-a"]])

describe("attributeCosts", () => {
  it("atribuye una carga diaria al contrato vigente ese día", () => {
    const r = attributeCosts({
      costs: [costo("2026-03-10", 1000)],
      assignments: [ventana({ validFrom: "2026-03-01", validTo: "2026-03-31" })],
      vehicleWorksite: FAENA_ACTUAL,
    })
    expect(r.get("w-a")?.contracts.get("c-1")?.fuel).toBe(1000)
    expect(r.get("w-a")?.unassigned.fuel).toBe(0)
    expect(r.get("w-a")?.pending.fuel).toBe(0)
  })

  it("una carga sin asignación ese día va a Sin contrato de la faena actual", () => {
    const r = attributeCosts({
      costs: [costo("2026-02-10", 500)],
      assignments: [ventana({ validFrom: "2026-03-01" })],
      vehicleWorksite: FAENA_ACTUAL,
    })
    expect(r.get("w-a")?.unassigned.fuel).toBe(500)
    expect(r.get("w-a")?.contracts.size).toBe(0)
  })

  it("valid_to es inclusivo", () => {
    const w = ventana({ validFrom: "2026-03-01", validTo: "2026-03-20" })
    const r = attributeCosts({
      costs: [costo("2026-03-20", 700), costo("2026-03-21", 300)],
      assignments: [w],
      vehicleWorksite: FAENA_ACTUAL,
    })
    expect(r.get("w-a")?.contracts.get("c-1")?.fuel).toBe(700)
    expect(r.get("w-a")?.unassigned.fuel).toBe(300)
  })

  it("un agregado mensual con un solo contrato todo el mes va a ese contrato", () => {
    const r = attributeCosts({
      costs: [costo("2026-04-01", 9000, { spansMonth: true })],
      assignments: [ventana({ validFrom: "2026-01-01", validTo: "2026-04-30" })],
      vehicleWorksite: FAENA_ACTUAL,
    })
    expect(r.get("w-a")?.contracts.get("c-1")?.fuel).toBe(9000)
    expect(r.get("w-a")?.pending.fuel).toBe(0)
  })

  it("un agregado mensual sin ninguna asignación en el mes va a Sin contrato", () => {
    const r = attributeCosts({
      costs: [costo("2026-04-01", 9000, { spansMonth: true })],
      assignments: [ventana({ validFrom: "2026-05-01" })],
      vehicleWorksite: FAENA_ACTUAL,
    })
    expect(r.get("w-a")?.unassigned.fuel).toBe(9000)
    expect(r.get("w-a")?.pending.fuel).toBe(0)
  })

  it("un agregado mensual con cambio de contrato a mitad de mes va a Por repartir", () => {
    const r = attributeCosts({
      costs: [costo("2026-04-01", 9000, { spansMonth: true })],
      assignments: [
        ventana({ contractId: "c-1", validFrom: "2026-01-01", validTo: "2026-04-14" }),
        ventana({ contractId: "c-2", validFrom: "2026-04-15" }),
      ],
      vehicleWorksite: FAENA_ACTUAL,
    })
    const a = r.get("w-a")
    expect(a?.pending.fuel).toBe(9000)
    expect(a?.contracts.size).toBe(0)
    expect(a?.unassigned.fuel).toBe(0)
  })

  it("un agregado mensual con contrato sólo desde el día 10 va a Por repartir", () => {
    const r = attributeCosts({
      costs: [costo("2026-04-01", 9000, { spansMonth: true })],
      assignments: [ventana({ validFrom: "2026-04-10" })],
      vehicleWorksite: FAENA_ACTUAL,
    })
    expect(r.get("w-a")?.pending.fuel).toBe(9000)
    expect(r.get("w-a")?.contracts.size).toBe(0)
  })

  it("un agregado que cruza contratos de faenas distintas queda Por repartir en la faena actual", () => {
    const r = attributeCosts({
      costs: [costo("2026-04-01", 9000, { spansMonth: true })],
      assignments: [
        ventana({ contractId: "c-1", worksiteId: "w-a", validFrom: "2026-01-01", validTo: "2026-04-14" }),
        ventana({ contractId: "c-2", worksiteId: "w-b", validFrom: "2026-04-15" }),
      ],
      vehicleWorksite: new Map([[V, "w-b"]]),
    })
    expect(r.get("w-b")?.pending.fuel).toBe(9000)
    expect(r.get("w-a")?.pending.fuel ?? 0).toBe(0)
  })

  it("un costo de febrero va al contrato de febrero aunque el equipo hoy esté en otra faena", () => {
    const r = attributeCosts({
      costs: [costo("2026-02-10", 1200)],
      assignments: [
        ventana({ worksiteId: "w-a", validFrom: "2026-01-01", validTo: "2026-02-28" }),
      ],
      vehicleWorksite: new Map([[V, "w-b"]]),
    })
    expect(r.get("w-a")?.contracts.get("c-1")?.fuel).toBe(1200)
    const b = r.get("w-b")
    expect(b?.unassigned.fuel ?? 0).toBe(0)
    expect(b?.pending.fuel ?? 0).toBe(0)
    expect(b?.contracts.size ?? 0).toBe(0)
  })

  it("la suma de todas las cubetas es igual a la suma de los costos", () => {
    const costs: DatedCost[] = [
      costo("2026-03-05", 1000),
      costo("2026-03-25", 2000, { component: "workOrders" }),
      costo("2026-04-01", 4000, { spansMonth: true }),
      costo("2026-04-12", 8000, { component: "purchases" }),
      costo("2026-04-20", 16000),
      costo("2026-02-01", 32000, { component: "purchases" }),
    ]
    const r = attributeCosts({
      costs,
      assignments: [
        ventana({ contractId: "c-1", validFrom: "2026-03-01", validTo: "2026-04-14" }),
        ventana({ contractId: "c-2", worksiteId: "w-b", validFrom: "2026-04-15" }),
      ],
      vehicleWorksite: new Map([[V, "w-b"]]),
    })
    const componentes: CostComponent[] = ["fuel", "workOrders", "purchases"]
    for (const c of componentes) {
      const esperado = costs
        .filter((x) => x.component === c)
        .reduce((s, x) => s + x.amount, 0)
      let total = 0
      for (const f of r.values()) {
        total += f.unassigned[c] + f.pending[c]
        for (const s of f.contracts.values()) total += s[c]
      }
      expect(total).toBe(esperado)
    }
  })

  it("rechaza un equipo sin faena", () => {
    expect(() =>
      attributeCosts({
        costs: [costo("2026-03-10", 1, { vehicleId: "fantasma" })],
        assignments: [],
        vehicleWorksite: FAENA_ACTUAL,
      }),
    ).toThrow("Equipo sin faena: fantasma")
  })

  it("emptySums parte en cero", () => {
    expect(emptySums()).toEqual({ fuel: 0, workOrders: 0, purchases: 0 })
  })
})
