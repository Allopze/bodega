import { describe, expect, it } from "vitest"
import type { DriverRosterRow } from "@/lib/services/driver-licenses-contract"
import { DRIVER_STATUSES, type DriverStatus } from "@/lib/validation/driver-licenses"
import {
  classesLabel,
  countDriversByEstado,
  defaultDriverEstado,
  displayPosition,
  driverSearchText,
  driverStatusDetail,
  driverUrgency,
  filterDriversByEstado,
  parseDriverEstado,
  requiredClassesLabel,
  requirementText,
  statusMatchesEstado,
} from "./drivers-view"

const row = (status: DriverStatus, overrides: Partial<DriverRosterRow> = {}): DriverRosterRow => ({
  workerId: `w-${status}`,
  name: "Ana Pérez",
  rut: "12.345.678-5",
  worksiteId: "ws-1",
  worksiteName: "Planta Norte",
  positionId: "pos-1",
  positionName: "Conductor de camión",
  requiresLicense: true,
  requiredClasses: ["A4", "A5"],
  license: null,
  status,
  expiry: null,
  missingClasses: [],
  ...overrides,
})

describe("vistas de conductores", () => {
  it("«Requieren atención» y «Vigentes» parten el conjunto: nadie queda fuera ni en las dos", () => {
    for (const status of DRIVER_STATUSES) {
      const inAttention = statusMatchesEstado(status, "atencion")
      const inValid = statusMatchesEstado(status, "vigentes")
      expect(inAttention !== inValid, status).toBe(true)
      expect(statusMatchesEstado(status, "todos")).toBe(true)
    }
  })

  it("una licencia sin fecha cuenta como atención: no se puede controlar", () => {
    expect(statusMatchesEstado("sin_fecha", "atencion")).toBe(true)
    expect(statusMatchesEstado("vigente", "atencion")).toBe(false)
  })

  it("cuenta cada vista sobre las mismas filas que muestra", () => {
    const rows = [row("vencida"), row("sin_licencia"), row("clase_insuficiente"), row("por_vencer"), row("vigente"), row("vigente")]
    expect(countDriversByEstado(rows)).toEqual({ atencion: 4, vigentes: 2, todos: 6 })
    expect(filterDriversByEstado(rows, "atencion")).toHaveLength(4)
    expect(filterDriversByEstado(rows, "vigentes")).toHaveLength(2)
    expect(filterDriversByEstado(rows, "todos")).toHaveLength(6)
  })

  it("abre en atención si hay algo y en la lista completa si no", () => {
    expect(defaultDriverEstado({ atencion: 3, vigentes: 2, todos: 5 })).toBe("atencion")
    expect(defaultDriverEstado({ atencion: 0, vigentes: 2, todos: 2 })).toBe("todos")
    expect(defaultDriverEstado({ atencion: 0, vigentes: 0, todos: 0 })).toBe("todos")
  })

  it("lee el parámetro ?estado= y descarta lo desconocido", () => {
    expect(parseDriverEstado("vigentes")).toBe("vigentes")
    expect(parseDriverEstado("atencion")).toBe("atencion")
    expect(parseDriverEstado("TODOS")).toBeNull()
    expect(parseDriverEstado(["todos"])).toBeNull()
    expect(parseDriverEstado(undefined)).toBeNull()
  })
})

describe("textos de la fila", () => {
  it("«Sin clasificar» se lee «Sin cargo»", () => {
    expect(displayPosition(null)).toBe("Sin cargo")
    expect(displayPosition("Sin clasificar")).toBe("Sin cargo")
    expect(displayPosition(" sin clasificar ")).toBe("Sin cargo")
    expect(displayPosition("Conductor de camión")).toBe("Conductor de camión")
  })

  it("el buscador encuentra por nombre sin tildes y por RUT sin puntos", () => {
    const text = driverSearchText(row("vigente"))
    expect(text).toContain("pérez")
    expect(text).toContain("perez")
    expect(text).toContain("12345678")
    expect(text).toContain("planta norte")
    expect(text).toContain("conductor de camión")
  })

  it("etiqueta las clases con su forma corta", () => {
    expect(classesLabel(["A2", "A4", "B"])).toBe("A2, A4, B")
    expect(classesLabel(["A1_ANTIGUA", "B"])).toBe("A1 antigua, B")
    expect(classesLabel([])).toBe("")
  })

  it("«su cargo exige…» nombra las clases y, sin clase fija, la licencia", () => {
    expect(requirementText(["A4", "A5"])).toBe("su cargo exige A4 o A5")
    expect(requirementText(["D"])).toBe("su cargo exige D")
    expect(requirementText([])).toBe("su cargo exige licencia de conducir")
  })

  it("sin licencia y clase insuficiente llevan su frase; el resto la dice ExpiryStatus", () => {
    expect(driverStatusDetail(row("sin_licencia"))).toBe("su cargo exige A4 o A5")
    expect(
      driverStatusDetail(row("clase_insuficiente", {
        requiredClasses: ["D"],
        license: { classes: ["A2", "B"], expiresAt: "2027-01-01", notes: null, updatedAt: "2026-11-01T00:00:00.000Z" },
      })),
    ).toBe("Tiene A2 y B · su cargo exige D")
    expect(driverStatusDetail(row("vencida"))).toBeNull()
    expect(driverStatusDetail(row("vigente"))).toBeNull()
  })

  it("la columna «Clases exigidas» distingue no exige, cualquiera y clases fijas", () => {
    expect(requiredClassesLabel({ requiresLicense: false, requiredClasses: [] })).toBe("No exige")
    expect(requiredClassesLabel({ requiresLicense: true, requiredClasses: [] })).toBe("Cualquiera")
    expect(requiredClassesLabel({ requiresLicense: true, requiredClasses: ["A4", "A5"] })).toBe("A4 o A5")
  })
})

describe("orden por vigencia", () => {
  it("lo vencido va antes que lo sin licencia, y lo más viejo antes que lo reciente", () => {
    const vencidaHaceMucho = driverUrgency({ status: "vencida", expiry: { state: "vencido", days: -90, expiresAt: "2026-08-01" } })
    const vencidaAyer = driverUrgency({ status: "vencida", expiry: { state: "vencido", days: -1, expiresAt: "2026-11-04" } })
    const sinLicencia = driverUrgency({ status: "sin_licencia", expiry: null })
    const porVencer = driverUrgency({ status: "por_vencer", expiry: { state: "por_vencer", days: 5, expiresAt: "2026-11-10" } })
    const vigente = driverUrgency({ status: "vigente", expiry: { state: "vigente", days: 400, expiresAt: "2027-12-10" } })

    expect([vigente, porVencer, sinLicencia, vencidaAyer, vencidaHaceMucho].sort((a, b) => a - b)).toEqual([
      vencidaHaceMucho,
      vencidaAyer,
      sinLicencia,
      porVencer,
      vigente,
    ])
  })
})
