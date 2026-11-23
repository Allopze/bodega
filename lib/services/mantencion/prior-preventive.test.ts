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

const fields: EquipmentFields = {
  code: "KCH-133", plate: "SRCJ-47", noPlate: false, type: "Tracto", brand: "MAN", model: null, year: 2023, worksite: "Biodiversa",
  schedule: "Camiones y tractos", initialReading: 435_410, initialReadingDate: "2026-11-20",
  priorPreventiveDate: "2026-08-20", priorPreventiveReading: 414_394, priorPreventiveInterval: 40_000, priorPreventiveEvidence: "OT 35513",
}
const current = {
  vehicleId: "v1", worksiteId: "w1", equipmentTypeId: "t1", active: true, retiredReason: null, unit: "km", recordCount: 0, activeRecordCount: 0, firstActiveRecord: null,
  brandId: "b1", scheduleId: "s1", fields, priorPreventiveDeclaredBy: "u-jefe", priorPreventiveSource: "Planilla", profileUpdatedAt: "2026-11-21",
} satisfies EquipmentCurrent
const schedules = [{ id: "s1", name: "Camiones y tractos", unit: "km" as const }]


describe("EQN-1: sin lectura inicial y con registros vigentes, la declarada se valida contra el primer registro", () => {
  const noInitial = { ...plan, initialReading: null, initialReadingDate: null, unit: "km" as const }
  const first = { date: "2026-10-05", reading: 420_000 }

  it("acepta una declarada de fecha y lectura iguales o menores a las del primer registro vigente", () => {
    expect(resolvePriorPreventive(ok, { ...noInitial, firstActiveRecord: first }, "2026-11-22")).toEqual({ value: ok, errors: {} })
    const same = { ...ok, date: first.date, reading: first.reading }
    expect(resolvePriorPreventive(same, { ...noInitial, firstActiveRecord: first }, "2026-11-22").errors).toEqual({})
  })

  it("rechaza una fecha posterior al primer registro, con la fecha en dd-mm-aaaa", () => {
    const result = resolvePriorPreventive({ ...ok, date: "2026-10-06" }, { ...noInitial, firstActiveRecord: first }, "2026-11-22")
    expect(result.value).toBeNull()
    expect(result.errors.priorPreventiveDate).toContain("05-10-2026")
    expect(result.errors.priorPreventiveDate).not.toContain("2026-10-05")
    expect(result.errors.priorPreventiveReading).toBeUndefined()
  })

  it("rechaza una lectura mayor que la del primer registro, con miles chilenos y unidad", () => {
    const result = resolvePriorPreventive({ ...ok, reading: 420_001 }, { ...noInitial, firstActiveRecord: first }, "2026-11-22")
    expect(result.errors.priorPreventiveReading).toContain("420.000 km")
    expect(result.errors.priorPreventiveDate).toBeUndefined()
  })

  it("sin lectura inicial ni registros vigentes se exige la lectura inicial, como antes", () => {
    for (const firstActiveRecord of [null, undefined]) {
      const result = resolvePriorPreventive(ok, { ...noInitial, firstActiveRecord }, "2026-11-22")
      expect(result.errors.priorPreventiveDate).toMatch(/Primero indica la lectura inicial/)
    }
  })

  it("con lectura inicial manda la lectura inicial, aunque haya primer registro", () => {
    const result = resolvePriorPreventive({ ...ok, date: "2026-11-21" }, { ...plan, unit: "km", firstActiveRecord: { date: "2026-12-01", reading: 500_000 } }, "2026-11-22")
    expect(result.errors.priorPreventiveDate).toContain("20-11-2026")
  })
})

describe("EQN-6: los mensajes escriben las fechas y las lecturas como las lee una persona", () => {
  it("la declarada contra la lectura inicial: dd-mm-aaaa y miles con unidad", () => {
    const result = resolvePriorPreventive({ ...ok, date: "2026-11-21", reading: 435_411 }, { ...plan, unit: "km" }, "2026-11-22")
    expect(result.errors.priorPreventiveDate).toBe("La fecha de la preventiva no puede ser posterior a la de la lectura inicial (20-11-2026).")
    expect(result.errors.priorPreventiveReading).toBe("La lectura de la preventiva no puede ser mayor que la lectura inicial (435.410 km).")
  })

  it("sin unidad conocida igual lleva separador de miles", () => {
    expect(resolvePriorPreventive({ ...ok, reading: 435_411 }, plan, "2026-11-22").errors.priorPreventiveReading).toContain("435.410")
  })

  it("la lectura inicial contra la declarada guardada", () => {
    const result = resolveEquipmentPlan(schedules, { scheduleId: "s1", initialReading: 300_000, initialReadingDate: "2026-01-01" }, "km", current, { today: "2026-11-22" })
    expect(result.errors.initialReading).toBe("La lectura inicial no puede ser menor que la de la preventiva declarada (414.394 km).")
    expect(result.errors.initialReadingDate).toBe("La fecha de la lectura inicial no puede ser anterior a la de la preventiva declarada (20-08-2026).")
  })
})

describe("EQN-1: sólo los registros vigentes fijan la lectura inicial", () => {
  const withRecords = (patch: Partial<EquipmentCurrent>): EquipmentCurrent => ({
    ...current, recordCount: 2, activeRecordCount: 0, firstActiveRecord: null,
    fields: { ...fields, initialReading: null, initialReadingDate: null, priorPreventiveDate: null, priorPreventiveReading: null, priorPreventiveInterval: null, priorPreventiveEvidence: null },
    ...patch,
  })
  const input = { scheduleId: "s1", initialReading: 150_000, initialReadingDate: "2026-11-01" }

  it("con registros sólo anulados se puede fijar la lectura inicial", () => {
    const result = resolveEquipmentPlan(schedules, input, "km", withRecords({}), { today: "2026-11-22" })
    expect(result.errors).toEqual({})
    expect(result.value).toMatchObject({ initialReading: 150_000, initialReadingDate: "2026-11-01" })
  })

  it("con un registro vigente la lectura inicial sigue fija (nula)", () => {
    const result = resolveEquipmentPlan(schedules, input, "km", withRecords({ activeRecordCount: 1, firstActiveRecord: { date: "2026-10-05", reading: 420_000 } }), { today: "2026-11-22" })
    expect(result.errors.initialReading).toMatch(/ya tiene registros/)
    expect(result.value.initialReading).toBeNull()
  })

  it("un equipo sin lectura inicial y con declarada guardada puede editar su pauta sin que le «quiten» una lectura que nunca tuvo", () => {
    const stored = withRecords({
      activeRecordCount: 1, firstActiveRecord: { date: "2026-10-05", reading: 420_000 },
      fields: { ...fields, initialReading: null, initialReadingDate: null },
    })
    const result = resolveEquipmentPlan(schedules, { scheduleId: "s1", initialReading: null, initialReadingDate: null }, "km", stored, { today: "2026-11-22" })
    expect(result.errors).toEqual({})
  })
})

describe("ninguna puerta deja la lectura inicial bajo la declarada guardada", () => {
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
