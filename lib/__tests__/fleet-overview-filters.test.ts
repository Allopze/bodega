import { describe, expect, it } from "vitest"
import { FLEET_STOPPED_FILTER, FLEET_STOPPED_STATUSES, filterFleetOverviewRows } from "@/lib/fleet-overview-filters"
import { FUEL_VEHICLE_STATUSES } from "@/lib/combustibles/validation"

const dates = { today: "2026-08-22", warningWindowEnd: "2026-09-21" }
const rows = [
  { plate: "AA-BB-11", brand: "Volvo", model: "FH", type: "Camión", worksiteName: "Norte", operationalStatus: "operativo", responsibleName: "Ana", nextExpiryDate: "2026-08-20" },
  { plate: "CC-DD-22", brand: "Komatsu", model: "WA", type: "Cargador", worksiteName: "Centro", operationalStatus: "mantencion", responsibleName: "Bruno", nextExpiryDate: "2026-09-01" },
  { plate: "EE-FF-33", brand: null, model: null, type: "Camioneta", worksiteName: "Sur", operationalStatus: "operativo", responsibleName: null, nextExpiryDate: null },
]

describe("filterFleetOverviewRows", () => {
  it("combina búsqueda y filtros estructurados sin perder acentos ni mayúsculas", () => {
    expect(filterFleetOverviewRows(rows, { operationalStatus: "mantencion", q: "KOMATSU" }, dates))
      .toEqual([rows[1]])
    expect(filterFleetOverviewRows(rows, { responsibleName: "Ana" }, dates)).toEqual([rows[0]])
  })

  it("separa vencidos, próximos y al día con límites inclusivos", () => {
    expect(filterFleetOverviewRows(rows, { expiry: "vencidos" }, dates)).toEqual([rows[0]])
    expect(filterFleetOverviewRows(rows, { expiry: "proximos" }, dates)).toEqual([rows[1]])
    expect(filterFleetOverviewRows(rows, { expiry: "al-dia" }, dates)).toEqual([rows[2]])
  })

  // `/flota?estado=detenidos`: el Panel operacional enlaza aquí con su cifra de
  // equipos detenidos, así que lista y cifra tienen que coincidir.
  describe("alias estado=detenidos", () => {
    const stopped = { ...rows[0]!, plate: "GG-HH-44", operationalStatus: "fuera_servicio" }
    const all = [...rows, stopped]

    it("agrupa los vehículos en mantención o fuera de servicio y deja fuera a los operativos", () => {
      expect(filterFleetOverviewRows(all, { operationalStatus: FLEET_STOPPED_FILTER }, dates))
        .toEqual([rows[1], stopped])
      expect(FLEET_STOPPED_FILTER).toBe("detenidos")
    })

    it("cubre exactamente los estados no operativos del catálogo", () => {
      expect([...FLEET_STOPPED_STATUSES].sort())
        .toEqual(FUEL_VEHICLE_STATUSES.filter((status) => status !== "operativo").sort())
    })

    it("se combina con los demás filtros", () => {
      expect(filterFleetOverviewRows(all, { operationalStatus: FLEET_STOPPED_FILTER, q: "komatsu" }, dates))
        .toEqual([rows[1]])
      expect(filterFleetOverviewRows(all, { operationalStatus: FLEET_STOPPED_FILTER, expiry: "vencidos" }, dates))
        .toEqual([stopped])
    })

    it("un estado concreto sigue filtrando por igualdad y un valor desconocido no coincide con nada", () => {
      expect(filterFleetOverviewRows(all, { operationalStatus: "fuera_servicio" }, dates)).toEqual([stopped])
      expect(filterFleetOverviewRows(all, { operationalStatus: "operativo" }, dates)).toEqual([rows[0], rows[2]])
      expect(filterFleetOverviewRows(all, { operationalStatus: "inexistente" }, dates)).toEqual([])
      expect(filterFleetOverviewRows(all, { operationalStatus: "" }, dates)).toEqual(all)
    })
  })
})
