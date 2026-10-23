import { describe, expect, it } from "vitest"
import {
  countFleetDocumentExpiry,
  countStoppedVehicles,
  type AttentionVehicle,
  type AttentionVehicleDocument,
} from "@/lib/operational-control/attention"
import { FLEET_STOPPED_FILTER, filterFleetOverviewRows } from "@/lib/fleet-overview-filters"

/**
 * Los tiles de «Requiere atención» enlazan a `/flota?estado=detenidos` y
 * `/flota?vencimiento=vencidos`. La regla A1 pide que la cifra del tile sea la
 * de la lista que abre: estas pruebas fijan el criterio (fechas civiles
 * inclusivas, universo sin distinguir activos de inactivos) y comprueban la
 * paridad contra el filtro que usa la lista.
 */

const DATES = { today: "2026-10-22", warningWindowEnd: "2026-11-21" }

function vehicle(id: string, overrides: Partial<AttentionVehicle> = {}): AttentionVehicle & { id: string } {
  return {
    id,
    plate: `PL-${id}`,
    type: "Camioneta",
    worksiteName: "Faena Norte",
    operationalStatus: "operativo",
    soapExpiresAt: null,
    technicalReviewExpiresAt: null,
    circulationPermitExpiresAt: null,
    insuranceExpiresAt: null,
    ...overrides,
  }
}

function doc(vehicleId: string, documentType: string, expiresAt: string | null): AttentionVehicleDocument {
  return { vehicleId, documentType, expiresAt }
}

describe("countStoppedVehicles", () => {
  it("cuenta mantención y fuera de servicio, y deja fuera a los operativos", () => {
    const result = countStoppedVehicles([
      vehicle("a", { operationalStatus: "operativo" }),
      vehicle("b", { operationalStatus: "mantencion" }),
      vehicle("c", { operationalStatus: "mantencion" }),
      vehicle("d", { operationalStatus: "fuera_servicio" }),
    ])
    expect(result).toEqual({ total: 3, inMaintenance: 2, outOfService: 1 })
  })

  it("sin equipos o sin detenidos devuelve ceros, no null", () => {
    expect(countStoppedVehicles([])).toEqual({ total: 0, inMaintenance: 0, outOfService: 0 })
    expect(countStoppedVehicles([vehicle("a")])).toEqual({ total: 0, inMaintenance: 0, outOfService: 0 })
  })

  it("coincide con las filas que la lista de flota deja pasar con estado=detenidos", () => {
    const fleet = [
      vehicle("a", { operationalStatus: "operativo" }),
      vehicle("b", { operationalStatus: "mantencion" }),
      vehicle("c", { operationalStatus: "fuera_servicio" }),
      vehicle("d", { operationalStatus: "estado_desconocido" }),
    ]
    const listRows = filterFleetOverviewRows(
      fleet.map((v) => ({ ...v, brand: null, model: null, responsibleName: null, nextExpiryDate: null })),
      { operationalStatus: FLEET_STOPPED_FILTER },
      DATES,
    )
    expect(countStoppedVehicles(fleet).total).toBe(listRows.length)
  })
})

describe("countFleetDocumentExpiry", () => {
  it("lo que vence hoy no está vencido: está por vencer", () => {
    const result = countFleetDocumentExpiry([vehicle("a", { soapExpiresAt: "2026-10-22" })], [], DATES)
    expect(result).toEqual({ expired: 0, expiringSoon: 1 })
  })

  it("lo de ayer está vencido", () => {
    const result = countFleetDocumentExpiry([vehicle("a", { soapExpiresAt: "2026-10-21" })], [], DATES)
    expect(result).toEqual({ expired: 1, expiringSoon: 0 })
  })

  it("el último día de la ventana de aviso entra y el siguiente no", () => {
    const result = countFleetDocumentExpiry(
      [
        vehicle("fin-ventana", { insuranceExpiresAt: "2026-11-21" }),
        vehicle("despues", { insuranceExpiresAt: "2026-11-22" }),
      ],
      [],
      DATES,
    )
    expect(result).toEqual({ expired: 0, expiringSoon: 1 })
  })

  it("un equipo sin ninguna fecha no cuenta en ninguno", () => {
    expect(countFleetDocumentExpiry([vehicle("a")], [], DATES)).toEqual({ expired: 0, expiringSoon: 0 })
  })

  it("cuenta equipos, no documentos: dos vencidos en el mismo equipo suman uno", () => {
    const result = countFleetDocumentExpiry(
      [vehicle("a", { soapExpiresAt: "2026-01-01", technicalReviewExpiresAt: "2026-02-01" })],
      [doc("a", "Padrón", "2026-03-01")],
      DATES,
    )
    expect(result.expired).toBe(1)
  })

  it("usa el menor de los vencimientos: un equipo vencido no cuenta además como por vencer", () => {
    const result = countFleetDocumentExpiry(
      [vehicle("a", { soapExpiresAt: "2026-09-01", insuranceExpiresAt: "2026-11-01" })],
      [],
      DATES,
    )
    expect(result).toEqual({ expired: 1, expiringSoon: 0 })
  })

  it("toma el documento vigente cuando la columna del equipo está vacía", () => {
    const result = countFleetDocumentExpiry([vehicle("a")], [doc("a", "SOAP", "2026-09-01")], DATES)
    expect(result.expired).toBe(1)
  })

  it("la columna declarada manda sobre el documento del mismo tipo", () => {
    // El SOAP de la ficha vence en 2027; el documento subido, vencido, no lo mueve.
    const result = countFleetDocumentExpiry(
      [vehicle("a", { soapExpiresAt: "2027-06-01" })],
      [doc("a", "SOAP", "2026-01-01")],
      DATES,
    )
    expect(result).toEqual({ expired: 0, expiringSoon: 0 })
  })

  it("los documentos de un equipo no se atribuyen a otro", () => {
    const result = countFleetDocumentExpiry(
      [vehicle("a"), vehicle("b")],
      [doc("b", "Seguro", "2026-01-01")],
      DATES,
    )
    expect(result.expired).toBe(1)
  })

  it("ignora los documentos sin fecha", () => {
    expect(countFleetDocumentExpiry([vehicle("a")], [doc("a", "Padrón", null)], DATES)).toEqual({ expired: 0, expiringSoon: 0 })
  })

  it("coincide con las filas que la lista deja pasar con vencimiento=vencidos y proximos", () => {
    const fleet = [
      vehicle("vencido", { soapExpiresAt: "2026-10-01" }),
      vehicle("hoy", { soapExpiresAt: "2026-10-22" }),
      vehicle("fin", { soapExpiresAt: "2026-11-21" }),
      vehicle("lejos", { soapExpiresAt: "2027-01-01" }),
      vehicle("solo-documento"),
    ]
    const documents = [doc("solo-documento", "Revisión técnica", "2026-10-15")]
    const result = countFleetDocumentExpiry(fleet, documents, DATES)
    // Lo que declara la ficha o el documento vigente, resuelto como lo hace la lista.
    const nextByVehicle: Record<string, string | null> = {
      vencido: "2026-10-01",
      hoy: "2026-10-22",
      fin: "2026-11-21",
      lejos: "2027-01-01",
      "solo-documento": "2026-10-15",
    }
    const listRows = fleet.map((v) => ({ ...v, brand: null, model: null, responsibleName: null, nextExpiryDate: nextByVehicle[v.id]! }))
    expect(result.expired).toBe(filterFleetOverviewRows(listRows, { expiry: "vencidos" }, DATES).length)
    expect(result.expiringSoon).toBe(filterFleetOverviewRows(listRows, { expiry: "proximos" }, DATES).length)
    expect(result).toEqual({ expired: 2, expiringSoon: 2 })
  })
})
