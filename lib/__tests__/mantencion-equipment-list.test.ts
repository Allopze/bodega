import { describe, expect, it } from "vitest"
import {
  NO_SCHEDULE, filterFleet, hasEquipmentListFilters, matchesEquipmentSearch, parseEquipmentListFilters, sortFleetByState,
  toEquipmentListRow,
} from "@/lib/services/mantencion/equipment-list"
import type { FleetRow } from "@/lib/services/mantencion/fleet"
import type { MantEquipmentState } from "@/lib/mantencion/types"

/**
 * La lista de equipos (§10) es una función pura de la flota: filtros de la URL,
 * orden por estado y la búsqueda de la barra superior. Se prueba sin base de datos.
 */

function row(code: string, state: MantEquipmentState, overrides: Partial<FleetRow> & { remaining?: number | null } = {}): FleetRow {
  const { remaining = null, ...rest } = overrides
  return {
    vehicleId: `v-${code}`, code, plate: `PL-${code}`, noPlate: false, typeId: "t-camion", typeName: "Camión", unit: "km",
    brandId: "b-scania", brandName: "Scania", model: "R450", year: 2021, worksiteId: "ws-1", worksiteName: "Cholguán",
    scheduleId: "s-1", scheduleName: "Camiones y tractos", intervals: [10000, 20000], retired: state === "baja", retiredReason: null,
    initialReading: null, readings: [], recentPreventives: [],
    status: { state, currentReading: null, nextReading: null, remaining, nextIntervalValue: null, lastPreventive: null },
    workshop: null,
    ...rest,
  }
}

describe("parseEquipmentListFilters", () => {
  it("lee la URL y descarta lo que no es de la lista", () => {
    expect(parseEquipmentListFilters({ estado: "vencida", faena: "ws-1", pauta: NO_SCHEDULE, bajas: "1" }))
      .toEqual({ state: "vencida", worksiteId: "ws-1", scheduleId: NO_SCHEDULE, typeId: undefined, includeRetired: true })
    expect(parseEquipmentListFilters({ estado: "inventado" }).state).toBeUndefined()
    expect(parseEquipmentListFilters({ faena: ["a", "b"] }).worksiteId).toBe("a")
  })

  it("pedir «Dado de baja» muestra las bajas aunque la casilla no esté marcada", () => {
    expect(parseEquipmentListFilters({ estado: "baja" }).includeRetired).toBe(true)
    expect(hasEquipmentListFilters(parseEquipmentListFilters({}))).toBe(false)
    expect(hasEquipmentListFilters(parseEquipmentListFilters({ bajas: "1" }))).toBe(true)
  })
})

describe("filterFleet y sortFleetByState", () => {
  const fleet = [
    row("A-1", "al_dia", { remaining: 8000 }),
    row("A-2", "vencida", { remaining: -300 }),
    row("A-3", "proxima", { remaining: 900 }),
    row("A-4", "proxima", { remaining: 100 }),
    row("A-5", "sin_pauta", { scheduleId: null, scheduleName: null, intervals: [] }),
    row("A-6", "baja", { worksiteId: "ws-2", worksiteName: "Teno" }),
    row("A-7", "sin_lecturas"),
  ]

  it("ordena vencida → próxima → al día → sin lecturas → sin pauta → baja, y dentro del estado el más urgente primero", () => {
    expect(sortFleetByState(fleet).map((item) => item.code)).toEqual(["A-2", "A-4", "A-3", "A-1", "A-7", "A-5", "A-6"])
  })

  it("las bajas no salen salvo que se pidan", () => {
    expect(filterFleet(fleet, { includeRetired: false }).map((item) => item.code)).not.toContain("A-6")
    expect(filterFleet(fleet, { includeRetired: true }).map((item) => item.code)).toContain("A-6")
  })

  it("filtra por estado, faena y pauta (incluida «sin pauta»)", () => {
    expect(filterFleet(fleet, { includeRetired: false, state: "proxima" }).map((item) => item.code)).toEqual(["A-3", "A-4"])
    expect(filterFleet(fleet, { includeRetired: true, worksiteId: "ws-2" }).map((item) => item.code)).toEqual(["A-6"])
    expect(filterFleet(fleet, { includeRetired: false, scheduleId: NO_SCHEDULE }).map((item) => item.code)).toEqual(["A-5"])
    expect(filterFleet(fleet, { includeRetired: false, scheduleId: "s-1" })).toHaveLength(5)
  })

  it("la fracción de urgencia usa el intervalo base para no mezclar kilómetros con horas", () => {
    const km = toEquipmentListRow(row("K", "proxima", { remaining: 1000, intervals: [10000] }))
    const hours = toEquipmentListRow(row("H", "proxima", { remaining: 30, unit: "h", intervals: [300] }))
    expect(km.urgency).toBeCloseTo(0.1)
    expect(hours.urgency).toBeCloseTo(0.1)
    expect(toEquipmentListRow(row("N", "sin_lecturas")).urgency).toBeNull()
  })
})

describe("toEquipmentListRow y matchesEquipmentSearch", () => {
  it("muestra la patente aparte sólo si es distinta del código", () => {
    expect(toEquipmentListRow(row("KA-1", "al_dia")).showPlate).toBe(true)
    expect(toEquipmentListRow(row("TO-37", "al_dia", { plate: "TO-37", noPlate: true })).showPlate).toBe(false)
    expect(toEquipmentListRow(row("TO-38", "al_dia", { plate: "TO-38" })).showPlate).toBe(false)
  })

  it("la búsqueda ignora tildes y mayúsculas y exige todas las palabras", () => {
    const item = toEquipmentListRow(row("KA-135", "al_dia", { plate: "RBYD-98", worksiteName: "Cholguán" }))
    expect(matchesEquipmentSearch(item, "cholguan")).toBe(true)
    expect(matchesEquipmentSearch(item, "ka-135 scania")).toBe(true)
    expect(matchesEquipmentSearch(item, "rbyd")).toBe(true)
    expect(matchesEquipmentSearch(item, "ka-135 volvo")).toBe(false)
    expect(matchesEquipmentSearch(item, "   ")).toBe(true)
  })
})
