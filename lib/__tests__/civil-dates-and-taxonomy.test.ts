/**
 * CO-020 / CO-024 / CO-036 / CO-041: cuatro entradas que pasaban validación y
 * después rompían o mentían aguas abajo — una fecha inexistente que revienta
 * `::date`, filtros con valores fuera del enum de la columna, tipos documentales
 * inventados y el día UTC usado como si fuera el chileno.
 */
import { describe, expect, it } from "vitest"
import { createMaintenanceRecordSchema } from "@/lib/validation/maintenance"
import { fleetDocumentMetadataSchema, FLEET_DOCUMENT_TYPES } from "@/lib/validation/fleet-documents"
import { FUEL_VEHICLE_STATUSES } from "@/lib/combustibles/validation"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"

const maintenance = (maintenanceDate: string) => createMaintenanceRecordSchema.safeParse({
  vehicleId: "veh-1",
  maintenanceDate,
  maintenanceType: "preventiva",
  status: "scheduled",
  netAmount: 0,
  taxAmount: 0,
  totalAmount: 0,
})

describe("fecha civil real en mantenciones (CO-020)", () => {
  it("acepta una fecha que existe", () => {
    expect(maintenance("2026-02-28").success).toBe(true)
  })

  it("rechaza un día que no existe en el mes", () => {
    // La regex la aceptaba y el string llegaba crudo a `${fecha}::date`.
    expect(maintenance("2026-02-31").success).toBe(false)
  })

  it("rechaza un mes fuera de rango", () => {
    expect(maintenance("2026-13-01").success).toBe(false)
  })
})

describe("metadatos de documentos de flota (CO-036)", () => {
  it("acepta un tipo del catálogo y un vencimiento real", () => {
    const parsed = fleetDocumentMetadataSchema.safeParse({ vehicleId: "veh-1", documentType: "SOAP", expiresAt: "2027-03-31" })
    expect(parsed.success).toBe(true)
  })

  it("rechaza un tipo inventado", () => {
    const parsed = fleetDocumentMetadataSchema.safeParse({ vehicleId: "veh-1", documentType: "Cualquier cosa", expiresAt: null })
    expect(parsed.success).toBe(false)
  })

  it("rechaza un vencimiento inexistente", () => {
    const parsed = fleetDocumentMetadataSchema.safeParse({ vehicleId: "veh-1", documentType: "Seguro", expiresAt: "2027-02-30" })
    expect(parsed.success).toBe(false)
  })

  it("la taxonomía compartida conserva los tipos que la ficha ya usaba", () => {
    expect(FLEET_DOCUMENT_TYPES).toContain("SOAP")
    expect(FLEET_DOCUMENT_TYPES).toContain("Revisión técnica")
    expect(FLEET_DOCUMENT_TYPES).toContain("Otro")
  })
})

describe("estados operacionales de Bitácora (CO-024)", () => {
  it("los valores del filtro son los del enum de la columna", () => {
    // Los antiguos `inactivo_*` no existen en `fuel_vehicles.operational_status`:
    // filtraban a cero filas y se leían como "no hubo cargas".
    expect([...FUEL_VEHICLE_STATUSES]).toEqual(["operativo", "mantencion", "fuera_servicio"])
    for (const legacy of ["inactivo_mantencion", "inactivo_fuera_servicio", "inactivo_revision"]) {
      expect(FUEL_VEHICLE_STATUSES as readonly string[]).not.toContain(legacy)
    }
  })
})

describe("día chileno del rango TAE por defecto (CO-041)", () => {
  it("a las 21:30 de Chile el día sigue siendo el de hoy, no el UTC de mañana", () => {
    // 2026-08-08T01:30Z = 21:30 del 07-08 en Chile (UTC−4).
    const instant = new Date("2026-08-08T01:30:00Z")
    expect(todayInChile(instant)).toBe("2026-08-07")
    expect(instant.toISOString().slice(0, 10)).toBe("2026-08-08")
    expect(addDaysToPlainDate(todayInChile(instant), -90)).toBe("2026-05-09")
  })
})
