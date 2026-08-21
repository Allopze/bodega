import { describe, expect, it } from "vitest"
import {
  createMaintenanceRecordSchema,
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
