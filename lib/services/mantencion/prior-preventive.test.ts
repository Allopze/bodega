import { describe, expect, it } from "vitest"
import { diffEquipmentFields, type EquipmentFields } from "./equipment-history"
import { isEvidenceReference, resolveEquipmentPlan, resolvePriorPreventive, type EquipmentCurrent } from "./equipment-resolve"

// Preventiva declarada anterior a la plataforma (Trinorma, opción A): reglas del servidor que
// salieron de la auditoría del 2026-11-22.

const plan = { initialReading: 435_410, initialReadingDate: "2026-11-20", hasSchedule: true, intervals: [10_000, 20_000, 40_000] }
const ok = { date: "2026-08-20", reading: 414_394, intervalValue: 40_000, evidence: "OT 35513" }

describe("el respaldo tiene que ser una referencia verificable", () => {
  it("acepta números de orden de trabajo y de factura", () => {
    for (const text of ["OT 35513", "Factura 9876", "OT-AB12 · Taller propio", "35513"]) expect(isEvidenceReference(text)).toBe(true)
  })

  it("rechaza rellenos y textos sin número", () => {
    for (const text of ["", "  ", "-", "?", "S/R", "s/r", "N/A", "No", "sin respaldo", "pendiente", "Taller propio", "x"]) {
      expect(isEvidenceReference(text)).toBe(false)
    }
  })

  it("el servidor no guarda una declaración con un respaldo de relleno", () => {
    const result = resolvePriorPreventive({ ...ok, evidence: "S/R" }, plan, "2026-11-22")
    expect(result.value).toBeNull()
    expect(result.errors.priorPreventiveEvidence).toMatch(/número de orden de trabajo o de factura/)
  })
})

describe("validación de la declaración contra la lectura inicial y la pauta", () => {
  it("una declaración válida pasa", () => {
    expect(resolvePriorPreventive(ok, plan, "2026-11-22")).toEqual({ value: ok, errors: {} })
  })

  it("rechaza una fecha posterior a la lectura inicial y una lectura mayor que la inicial", () => {
    const result = resolvePriorPreventive({ ...ok, date: "2026-11-21", reading: 435_411 }, plan, "2026-11-22")
    expect(Object.keys(result.errors).sort()).toEqual(["priorPreventiveDate", "priorPreventiveReading"])
  })

  it("sin lectura inicial no se puede declarar", () => {
    const result = resolvePriorPreventive(ok, { ...plan, initialReading: null, initialReadingDate: null }, "2026-11-22")
    expect(result.errors.priorPreventiveDate).toMatch(/Primero indica la lectura inicial/)
  })

  it("un servicio fuera de la pauta se rechaza, salvo que sea el de la declaración ya guardada (pauta republicada)", () => {
    expect(resolvePriorPreventive({ ...ok, intervalValue: 30_000 }, plan, "2026-11-22").errors.priorPreventiveInterval).toBeTruthy()
    expect(resolvePriorPreventive({ ...ok, intervalValue: 30_000 }, { ...plan, storedInterval: 30_000 }, "2026-11-22").errors).toEqual({})
  })
})

describe("ninguna puerta deja la lectura inicial bajo la declarada guardada", () => {
  const fields: EquipmentFields = {
    code: "KCH-133", plate: "SRCJ-47", noPlate: false, type: "Tracto", brand: "MAN", model: null, year: 2023, worksite: "Biodiversa",
    schedule: "Camiones y tractos", initialReading: 435_410, initialReadingDate: "2026-11-20",
    priorPreventiveDate: "2026-08-20", priorPreventiveReading: 414_394, priorPreventiveInterval: 40_000, priorPreventiveEvidence: "OT 35513",
  }
  const current = {
    vehicleId: "v1", worksiteId: "w1", equipmentTypeId: "t1", active: true, retiredReason: null, unit: "km", recordCount: 0,
    brandId: "b1", scheduleId: "s1", fields, priorPreventiveDeclaredBy: "u-jefe", priorPreventiveSource: "Planilla", profileUpdatedAt: "2026-11-21",
  } satisfies EquipmentCurrent
  const schedules = [{ id: "s1", name: "Camiones y tractos", unit: "km" as const }]

  it("rechaza una lectura inicial menor o anterior a la declarada", () => {
    const result = resolveEquipmentPlan(schedules, { scheduleId: "s1", initialReading: 300_000, initialReadingDate: "2026-01-01" }, "km", current, { today: "2026-11-22" })
    expect(result.errors.initialReading).toMatch(/preventiva declarada/)
    expect(result.errors.initialReadingDate).toMatch(/preventiva declarada/)
  })

  it("no deja quitar la lectura inicial mientras haya una declarada", () => {
    const result = resolveEquipmentPlan(schedules, { scheduleId: "s1", initialReading: null, initialReadingDate: null }, "km", current, { today: "2026-11-22" })
    expect(result.errors.initialReading).toMatch(/Bórrala primero/)
  })

  it("si el formulario trae una declaración nueva, la lectura se valida contra ésa y no contra la guardada", () => {
    const result = resolveEquipmentPlan(schedules, { scheduleId: "s1", initialReading: 300_000, initialReadingDate: "2026-01-01" }, "km", current, { today: "2026-11-22", checkStoredPrior: false })
    expect(result.errors).toEqual({})
  })
})

describe("historial: un camino que no maneja la declarada no la registra como borrada", () => {
  const before: EquipmentFields = {
    code: "KA-140", plate: "SGCP-84", noPlate: false, type: "Camión", brand: "Volvo", model: null, year: 2020, worksite: "Biodiversa",
    schedule: "Camiones y tractos", initialReading: 438_715, initialReadingDate: "2026-11-19",
    priorPreventiveDate: "2026-05-28", priorPreventiveReading: 400_627, priorPreventiveInterval: 40_000, priorPreventiveEvidence: "OT 33753",
  }

  it("sin los campos de la declarada (padrón, importación), no hay cambios", () => {
    const { priorPreventiveDate: _d, priorPreventiveReading: _r, priorPreventiveInterval: _i, priorPreventiveEvidence: _e, ...withoutPrior } = before
    expect(diffEquipmentFields(before, { ...withoutPrior, model: "FH" })).toEqual({ Modelo: { from: null, to: "FH" } })
  })

  it("un borrado explícito (null) sí queda en el historial", () => {
    const changes = diffEquipmentFields(before, { ...before, priorPreventiveDate: null, priorPreventiveReading: null, priorPreventiveInterval: null, priorPreventiveEvidence: null })
    expect(Object.keys(changes)).toHaveLength(4)
  })
})
