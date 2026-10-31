import { describe, expect, it } from "vitest"
import { FLEET_STOPPED_STATUSES, filterFleetOverviewRows } from "@/lib/fleet-overview-filters"
import { MAINTENANCE_OPEN_STATUSES, resolveMaintenanceStatusFilter } from "@/lib/validation/maintenance"
import {
  ATTENTION_HREFS,
  documentsTile,
  fuelReviewTile,
  stoppedTile,
  workOrdersTile,
  type FuelPendingCounts,
} from "./attention-tiles"

/** Las cuatro colas de «Por revisar»; lo que no se nombra está en cero. */
const fuelCounts = (overrides: Partial<FuelPendingCounts> = {}): FuelPendingCounts => ({ carga: 0, caso: 0, patente: 0, pedido: 0, ...overrides })

describe("destinos de los tiles", () => {
  it("cada tile enlaza a su subconjunto con la sintaxis exacta de la lista", () => {
    expect(ATTENTION_HREFS).toEqual({
      stopped: "/flota?estado=detenidos",
      workOrders: "/mantenciones?status=abiertas",
      documents: "/flota?vencimiento=vencidos",
      fuel: "/combustibles/revisar",
    })
  })

  it("las listas entienden el valor que lleva el enlace", () => {
    const estado = new URL(ATTENTION_HREFS.stopped, "http://x").searchParams.get("estado")!
    const row = (operationalStatus: string) => ({
      plate: "P", brand: null, model: null, type: "T", worksiteName: "W", operationalStatus, responsibleName: null, nextExpiryDate: null,
    })
    const dates = { today: "2026-10-22", warningWindowEnd: "2026-11-21" }
    const accepted = filterFleetOverviewRows(
      [row("operativo"), ...FLEET_STOPPED_STATUSES.map(row)],
      { operationalStatus: estado },
      dates,
    )
    expect(accepted.map((r) => r.operationalStatus)).toEqual([...FLEET_STOPPED_STATUSES])

    const status = new URL(ATTENTION_HREFS.workOrders, "http://x").searchParams.get("status")
    expect(resolveMaintenanceStatusFilter(status)).toEqual(MAINTENANCE_OPEN_STATUSES)

    const vencimiento = new URL(ATTENTION_HREFS.documents, "http://x").searchParams.get("vencimiento")
    expect(vencimiento).toBe("vencidos")
  })
})

describe("stoppedTile", () => {
  it("detalla mantención y fuera de servicio", () => {
    expect(stoppedTile({ total: 3, inMaintenance: 2, outOfService: 1 }, 10)).toMatchObject({
      value: "3",
      detail: "2 en mantención · 1 fuera de servicio",
      tone: "signal",
    })
  })

  it("sin detenidos dice que todo está operativo, no 0", () => {
    expect(stoppedTile({ total: 0, inMaintenance: 0, outOfService: 0 }, 10)).toMatchObject({
      value: "Ninguno",
      detail: "Todo operativo",
      tone: "neutral",
    })
  })

  it("sin equipos en el alcance no dice «todo operativo»", () => {
    const tile = stoppedTile({ total: 0, inMaintenance: 0, outOfService: 0 }, 0)
    expect(tile.value).toBe("Sin equipos")
    expect(tile.detail).not.toContain("Todo operativo")
  })

  it("si no se pudo calcular lo dice en vez de pintar 0", () => {
    expect(stoppedTile(null, 10)).toMatchObject({ value: "Sin dato", detail: "No se pudo calcular", tone: "neutral" })
  })
})

describe("workOrdersTile", () => {
  it("muestra el total abierto", () => {
    expect(workOrdersTile(12)).toMatchObject({ value: "12", detail: "Programadas o en curso", tone: "neutral" })
  })

  it("sin OT abiertas lo dice en lenguaje de usuario", () => {
    expect(workOrdersTile(0)).toMatchObject({ value: "Ninguna", detail: "Sin OT programadas ni en curso" })
  })

  it("si no se pudo calcular lo dice", () => {
    expect(workOrdersTile(null)).toMatchObject({ value: "Sin dato", detail: "No se pudo calcular" })
  })
})

describe("documentsTile", () => {
  it("con vencidos, los cuenta y dice cuántos más vencen en la ventana de Flota", () => {
    expect(documentsTile({ expired: 4, expiringSoon: 2, warningDays: 30 })).toMatchObject({
      value: "4",
      detail: "Equipos con documentos vencidos · 2 por vencer en 30 días",
      tone: "danger",
    })
  })

  it("usa los días de aviso configurados, no un 30 fijo", () => {
    expect(documentsTile({ expired: 1, expiringSoon: 0, warningDays: 45 }).detail)
      .toBe("Equipos con documentos vencidos · ninguno por vencer en 45 días")
  })

  it("sin vencidos pero con por vencer, el detalle lo advierte", () => {
    expect(documentsTile({ expired: 0, expiringSoon: 1, warningDays: 30 })).toMatchObject({
      value: "Ninguno",
      detail: "1 equipo por vencer en 30 días",
      tone: "neutral",
    })
  })

  it("sin nada vencido ni por vencer, el estado bueno", () => {
    expect(documentsTile({ expired: 0, expiringSoon: 0, warningDays: 30 })).toMatchObject({
      value: "Ninguno",
      detail: "Nada por vencer en 30 días",
    })
  })

  it("si no se pudo calcular lo dice", () => {
    expect(documentsTile(null)).toMatchObject({ value: "Sin dato", detail: "No se pudo calcular" })
  })
})

describe("fuelReviewTile", () => {
  it("suma las cuatro colas de «Por revisar» y las detalla", () => {
    expect(fuelReviewTile(fuelCounts({ carga: 3, caso: 2, patente: 1, pedido: 1 }))).toMatchObject({
      value: "7",
      detail: "3 cargas por decidir · 2 casos · 1 patente sin vincular · 1 pedido de revisión",
      tone: "signal",
      href: "/combustibles/revisar",
    })
  })

  it("no nombra las partes en cero", () => {
    expect(fuelReviewTile(fuelCounts({ caso: 2, pedido: 5 }))).toMatchObject({ value: "7", detail: "2 casos · 5 pedidos de revisión" })
    expect(fuelReviewTile(fuelCounts({ patente: 3 }))).toMatchObject({ value: "3", detail: "3 patentes sin vincular" })
  })

  it("concuerda en singular y en plural", () => {
    expect(fuelReviewTile(fuelCounts({ carga: 1, caso: 1, patente: 1, pedido: 1 })).detail)
      .toBe("1 carga por decidir · 1 caso · 1 patente sin vincular · 1 pedido de revisión")
    expect(fuelReviewTile(fuelCounts({ carga: 2, caso: 2, patente: 2, pedido: 2 })).detail)
      .toBe("2 cargas por decidir · 2 casos · 2 patentes sin vincular · 2 pedidos de revisión")
  })

  it("separa los miles como el resto de la plataforma", () => {
    expect(fuelReviewTile(fuelCounts({ carga: 1234, caso: 6 }))).toMatchObject({ value: "1.240", detail: "1.234 cargas por decidir · 6 casos" })
  })

  it("con las cuatro colas vacías dice «Al día»", () => {
    expect(fuelReviewTile(fuelCounts())).toMatchObject({
      value: "Al día",
      detail: "Nada espera a una persona",
      tone: "neutral",
      href: "/combustibles/revisar",
    })
  })

  it("si un tipo falló, no pinta un total parcial: nombra lo que falló y lo que sí se contó", () => {
    const tile = fuelReviewTile(fuelCounts({ carga: 4, caso: null, pedido: 1 }))
    expect(tile.value).toBe("Sin dato")
    expect(tile.detail).toBe("4 cargas por decidir · Casos: no se pudo calcular · 1 pedido de revisión")
    expect(tile.tone).toBe("neutral")

    const other = fuelReviewTile(fuelCounts({ carga: null, patente: 2 }))
    expect(other.value).toBe("Sin dato")
    expect(other.detail).toBe("Cargas por decidir: no se pudo calcular · 2 patentes sin vincular")
  })

  it("un tipo caído no se esconde aunque lo demás esté en cero", () => {
    expect(fuelReviewTile(fuelCounts({ pedido: null }))).toMatchObject({ value: "Sin dato", detail: "Pedidos de revisión: no se pudo calcular" })
    expect(fuelReviewTile(fuelCounts({ patente: null, pedido: null })).detail)
      .toBe("Patentes sin vincular: no se pudo calcular · Pedidos de revisión: no se pudo calcular")
  })

  it("si fallaron las cuatro, lo dice", () => {
    expect(fuelReviewTile({ carga: null, caso: null, patente: null, pedido: null })).toMatchObject({ value: "Sin dato", detail: "No se pudo calcular" })
  })

  it("sigue enlazando a «Por revisar»: la cifra y la lista que abre cuentan lo mismo", () => {
    for (const counts of [fuelCounts({ carga: 1 }), fuelCounts(), fuelCounts({ caso: null })]) {
      expect(fuelReviewTile(counts).href).toBe(ATTENTION_HREFS.fuel)
    }
  })
})

describe("A1: ningún tile pinta un 0 pelado", () => {
  it("el valor de un tile vacío nunca es «0» ni «—»", () => {
    const empties = [
      stoppedTile({ total: 0, inMaintenance: 0, outOfService: 0 }, 5),
      stoppedTile({ total: 0, inMaintenance: 0, outOfService: 0 }, 0),
      workOrdersTile(0),
      documentsTile({ expired: 0, expiringSoon: 0, warningDays: 30 }),
      fuelReviewTile(fuelCounts()),
      stoppedTile(null, 0),
      workOrdersTile(null),
      documentsTile(null),
      fuelReviewTile({ carga: null, caso: null, patente: null, pedido: null }),
      // Un tipo caído tampoco deja un 0: el valor es «Sin dato».
      fuelReviewTile(fuelCounts({ carga: null })),
    ]
    for (const tile of empties) {
      expect(tile.value).not.toMatch(/^(0|—)$/)
      expect(tile.detail.length).toBeGreaterThan(0)
    }
  })
})
