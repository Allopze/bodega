import { describe, expect, it } from "vitest"
import { filterFleetOverviewRows } from "@/lib/fleet-overview-filters"

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

})
