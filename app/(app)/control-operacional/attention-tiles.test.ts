import { describe, expect, it } from "vitest"
import { FLEET_STOPPED_STATUSES, filterFleetOverviewRows } from "@/lib/fleet-overview-filters"
import { MAINTENANCE_OPEN_STATUSES, resolveMaintenanceStatusFilter } from "@/lib/validation/maintenance"
import {
  ATTENTION_HREFS,
  documentsTile,
  fuelReviewTile,
  stoppedTile,
  workOrdersTile,
} from "./attention-tiles"

describe("destinos de los tiles", () => {
  it("cada tile enlaza a su subconjunto con la sintaxis exacta de la lista", () => {
    expect(ATTENTION_HREFS).toEqual({
      stopped: "/flota?estado=detenidos",
      workOrders: "/mantenciones?status=abiertas",
      documents: "/flota?vencimiento=vencidos",
      fuel: "/combustibles/revision",
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
  it("suma las dos colas y las detalla", () => {
    expect(fuelReviewTile({ flagged: 3, anomalies: 2 })).toMatchObject({
      value: "5",
      detail: "3 cargas marcadas · 2 anomalías",
      tone: "signal",
    })
  })

  it("concuerda en singular", () => {
    expect(fuelReviewTile({ flagged: 1, anomalies: 1 }).detail).toBe("1 carga marcada · 1 anomalía")
  })

  it("con las dos colas vacías dice «Al día»", () => {
    expect(fuelReviewTile({ flagged: 0, anomalies: 0 })).toMatchObject({
      value: "Al día",
      detail: "Sin cargas marcadas ni anomalías",
      tone: "neutral",
    })
  })

  it("si un conteo falló, no pinta un total parcial: nombra lo que falló", () => {
    const tile = fuelReviewTile({ flagged: 4, anomalies: null })
    expect(tile.value).toBe("Sin dato")
    expect(tile.detail).toBe("4 cargas marcadas · anomalías: no se pudo calcular")

    const other = fuelReviewTile({ flagged: null, anomalies: 2 })
    expect(other.value).toBe("Sin dato")
    expect(other.detail).toBe("Cargas marcadas: no se pudo calcular · 2 anomalías")
  })

  it("si fallaron los dos, lo dice", () => {
    expect(fuelReviewTile({ flagged: null, anomalies: null })).toMatchObject({ value: "Sin dato", detail: "No se pudo calcular" })
  })
})

describe("A1: ningún tile pinta un 0 pelado", () => {
  it("el valor de un tile vacío nunca es «0» ni «—»", () => {
    const empties = [
      stoppedTile({ total: 0, inMaintenance: 0, outOfService: 0 }, 5),
      stoppedTile({ total: 0, inMaintenance: 0, outOfService: 0 }, 0),
      workOrdersTile(0),
      documentsTile({ expired: 0, expiringSoon: 0, warningDays: 30 }),
      fuelReviewTile({ flagged: 0, anomalies: 0 }),
      stoppedTile(null, 0),
      workOrdersTile(null),
      documentsTile(null),
      fuelReviewTile({ flagged: null, anomalies: null }),
    ]
    for (const tile of empties) {
      expect(tile.value).not.toMatch(/^(0|—)$/)
      expect(tile.detail.length).toBeGreaterThan(0)
    }
  })
})
