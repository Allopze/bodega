import { describe, expect, it } from "vitest"
import {
  createMaintenanceRecordSchema,
  maintenanceCostApprovalSchema,
  maintenanceDocumentMetadataSchema,
  maintenanceDocumentPolicySchema,
  maintenanceLaborSchema,
  maintenancePartSchema,
  maintenancePlanSchema,
  maintenanceTaskSchema,
  MAINTENANCE_STATUSES,
  MAINTENANCE_STATUS_LABELS,
  transitionMaintenanceRecordSchema,
  updateMaintenanceRecordSchema,
} from "@/lib/validation/maintenance"

const base = {
  vehicleId: "veh-1",
  maintenanceDate: "2026-06-01",
  maintenanceType: "preventiva",
  status: "scheduled" as const,
  netAmount: 100000,
  taxAmount: 19000,
  totalAmount: 119000,
}

describe("createMaintenanceRecordSchema", () => {
  it("keeps the status vocabulary and its user-facing labels together", () => {
    expect(MAINTENANCE_STATUSES).toEqual(["scheduled", "in_progress", "completed", "cancelled"])
    expect(MAINTENANCE_STATUS_LABELS).toEqual({
      scheduled: "Programada",
      in_progress: "En curso",
      completed: "Completada",
      cancelled: "Cancelada",
    })
  })

  it("accepts a coherent total (neto + IVA)", () => {
    const result = createMaintenanceRecordSchema.safeParse(base)
    expect(result.success).toBe(true)
  })

  it("rechaza crear directamente como completada o cancelada", () => {
    expect(createMaintenanceRecordSchema.safeParse({ ...base, status: "completed" }).success).toBe(false)
    expect(createMaintenanceRecordSchema.safeParse({ ...base, status: "cancelled" }).success).toBe(false)
  })

  it("rejects a total that does not equal neto + IVA", () => {
    const result = createMaintenanceRecordSchema.safeParse({ ...base, totalAmount: 500000 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.totalAmount).toBeDefined()
    }
  })

  it("tolerates ±1 CLP of rounding", () => {
    const result = createMaintenanceRecordSchema.safeParse({ ...base, totalAmount: 119001 })
    expect(result.success).toBe(true)
  })

  it("requires a vehicle", () => {
    const result = createMaintenanceRecordSchema.safeParse({ ...base, vehicleId: "" })
    expect(result.success).toBe(false)
  })
})

describe("updateMaintenanceRecordSchema", () => {
  it("requires an id", () => {
    const result = updateMaintenanceRecordSchema.safeParse(base)
    expect(result.success).toBe(false)
  })

  it("accepts a coherent update with id", () => {
    const result = updateMaintenanceRecordSchema.safeParse({ id: "mr-1", ...base })
    expect(result.success).toBe(true)
  })

  it("still enforces total = neto + IVA on update", () => {
    const result = updateMaintenanceRecordSchema.safeParse({ id: "mr-1", ...base, totalAmount: 1 })
    expect(result.success).toBe(false)
  })
})

describe("transitionMaintenanceRecordSchema", () => {
  it("exige estado esperado y motivo trazable", () => {
    expect(transitionMaintenanceRecordSchema.safeParse({
      id: "mr-1",
      expectedStatus: "in_progress",
      transition: "complete",
      reason: "Trabajo verificado por taller",
    }).success).toBe(true)
    expect(transitionMaintenanceRecordSchema.safeParse({
      id: "mr-1",
      expectedStatus: "in_progress",
      transition: "complete",
      reason: "ok",
    }).success).toBe(false)
  })
})

describe("maintenancePlanSchema", () => {
  const plan = {
    vehicleId: "veh-1",
    name: "Preventiva 10.000 km",
    maintenanceType: "preventiva",
    strategy: "odometer" as const,
    intervalUnits: 10_000,
    advanceDays: 7,
    advanceUnits: 500,
  }

  it("exige el intervalo que corresponde a la estrategia", () => {
    expect(maintenancePlanSchema.safeParse(plan).success).toBe(true)
    expect(maintenancePlanSchema.safeParse({ ...plan, intervalUnits: null }).success).toBe(false)
    expect(maintenancePlanSchema.safeParse({
      ...plan,
      strategy: "calendar",
      intervalUnits: null,
      intervalDays: 90,
    }).success).toBe(true)
    expect(maintenancePlanSchema.safeParse({
      ...plan,
      strategy: "combined",
      intervalDays: 90,
    }).success).toBe(true)
    expect(maintenancePlanSchema.safeParse({
      ...plan,
      strategy: "combined",
      intervalDays: null,
    }).success).toBe(false)
  })

  it("rechaza una próxima fecha civil inexistente", () => {
    expect(maintenancePlanSchema.safeParse({ ...plan, nextDueDate: "2026-02-31" }).success).toBe(false)
  })
})

describe("detalle de orden de trabajo", () => {
  it("valida tareas, repuestos y mano de obra con cantidades positivas", () => {
    expect(maintenanceTaskSchema.safeParse({ maintenanceId: "ot-1", description: "Revisar frenos" }).success).toBe(true)
    expect(maintenanceTaskSchema.safeParse({ maintenanceId: "ot-1", description: "x" }).success).toBe(false)
    expect(maintenancePartSchema.safeParse({
      maintenanceId: "ot-1",
      description: "Pastillas de freno",
      quantity: 2,
      unit: "un",
      unitCost: 35_000,
    }).success).toBe(true)
    expect(maintenancePartSchema.safeParse({
      maintenanceId: "ot-1",
      description: "Pastillas de freno",
      quantity: 0,
      unit: "un",
      unitCost: 35_000,
    }).success).toBe(false)
    expect(maintenanceLaborSchema.safeParse({
      maintenanceId: "ot-1",
      description: "Diagnóstico y cambio",
      hours: 3.5,
      hourlyRate: 25_000,
    }).success).toBe(true)
    expect(maintenanceLaborSchema.safeParse({
      maintenanceId: "ot-1",
      description: "Diagnóstico y cambio",
      hours: -1,
      hourlyRate: 25_000,
    }).success).toBe(false)
  })

  it("mantiene cerradas las taxonomías documental y de aprobación", () => {
    expect(maintenanceDocumentMetadataSchema.safeParse({ maintenanceId: "ot-1", documentType: "diagnosis" }).success).toBe(true)
    expect(maintenanceDocumentMetadataSchema.safeParse({ maintenanceId: "ot-1", documentType: "archivo_libre" }).success).toBe(false)
    expect(maintenanceDocumentPolicySchema.safeParse({
      equipmentTypeId: "camion",
      documentType: "work_order",
      requiredAt: "before_complete",
    }).success).toBe(true)
    expect(maintenanceDocumentPolicySchema.safeParse({
      equipmentTypeId: "camion",
      documentType: "work_order",
      requiredAt: "after_complete",
    }).success).toBe(false)
    expect(maintenanceCostApprovalSchema.safeParse({ maintenanceId: "ot-1", decision: "approve" }).success).toBe(true)
    expect(maintenanceCostApprovalSchema.safeParse({ maintenanceId: "ot-1", decision: "self_approve" }).success).toBe(false)
  })
})
