import { describe, expect, it } from "vitest"
import { parseWorkOrderQuery } from "@/components/mantencion/jefatura/ot/ot-filters"
import { createWorkOrderSchema, changeWorkOrderEstimateSchema, dropHiddenItems, editWorkOrderSchema, finishWorkOrderSchema, reclassifyWorkOrderSchema } from "./work-order-schemas"

/** Las fechas de la OT son fechas civiles reales: `2026-02-31` no pasa. */

const base = {
  clientRequestId: "7b0c8e2e-3b6d-4b53-9e0a-0d1b2c3d4e5f", vehicleId: "v-1", repair: true, maintenance: false,
  requesterName: "Ana Contrato", repairDescription: "Fuga de aceite en el motor", observations: null,
  annexItems: [], maintenanceItems: [], assignedToUserId: null,
}

describe("fechas de los esquemas de la OT", () => {
  it("createWorkOrderSchema rechaza una fecha de solicitud inexistente y acepta una real", () => {
    expect(createWorkOrderSchema.safeParse({ ...base, requestDate: "2026-02-31" }).success).toBe(false)
    expect(createWorkOrderSchema.safeParse({ ...base, requestDate: "2026-13-01" }).success).toBe(false)
    expect(createWorkOrderSchema.safeParse({ ...base, requestDate: "2026-02-28" }).success).toBe(true)
    expect(createWorkOrderSchema.safeParse({ ...base, requestDate: "2028-02-29" }).success).toBe(true)
    expect(createWorkOrderSchema.safeParse({ ...base, requestDate: "2027-02-29" }).success).toBe(false)
  })

  it("changeWorkOrderEstimateSchema rechaza una fecha estimada de entrega inexistente", () => {
    const parse = (estimatedDeliveryDate: string) => changeWorkOrderEstimateSchema.safeParse({
      workOrderId: "ot-1", expectedVersion: 1, estimatedDeliveryDate, reason: null,
    })
    expect(parse("2026-04-31").success).toBe(false)
    expect(parse("2026-04-30").success).toBe(true)
  })
})

describe("clasificación y término (Trinorma R4)", () => {
  const withDate = { ...base, requestDate: "2026-11-02" }
  it("el alta acepta tipo, especialidades y faena de ejecución, todos opcionales", () => {
    expect(createWorkOrderSchema.safeParse(withDate).success).toBe(true)
    expect(createWorkOrderSchema.safeParse({ ...withDate, actionType: "preventiva", specialties: ["mecanica", "electrica"], executionWorksiteId: "ws-2" }).success).toBe(true)
    expect(createWorkOrderSchema.safeParse({ ...withDate, actionType: "otro" }).success).toBe(false)
    expect(createWorkOrderSchema.safeParse({ ...withDate, specialties: ["carpinteria"] }).success).toBe(false)
  })
  it("terminar: horas entre 0 y 10.000, trabajo realizado opcional", () => {
    const finish = { workOrderId: "ot-1", expectedVersion: 1, exitAt: "2026-11-03T14:00:00.000Z", note: null }
    expect(finishWorkOrderSchema.safeParse(finish).success).toBe(true)
    expect(finishWorkOrderSchema.safeParse({ ...finish, laborHours: 0, workPerformed: null }).success).toBe(true)
    expect(finishWorkOrderSchema.safeParse({ ...finish, laborHours: 10_000 }).success).toBe(true)
    expect(finishWorkOrderSchema.safeParse({ ...finish, laborHours: -0.5 }).success).toBe(false)
    expect(finishWorkOrderSchema.safeParse({ ...finish, laborHours: 10_000.5 }).success).toBe(false)
    expect(finishWorkOrderSchema.safeParse({ ...finish, exitAt: undefined }).success).toBe(false)
  })
})

describe("ítems de un tipo desmarcado (OT-5)", () => {
  const withDate = { ...base, requestDate: "2026-11-02" }
  it("el alta y la edición descartan los ítems del tipo desmarcado ANTES de validar", () => {
    const created = createWorkOrderSchema.safeParse({ ...withDate, repair: true, maintenance: false, annexItems: ["Cambiar pastillas"], maintenanceItems: ["ab"] })
    expect(created.success).toBe(true)
    if (created.success) expect(created.data).toMatchObject({ annexItems: ["Cambiar pastillas"], maintenanceItems: [] })
    const edit = { workOrderId: "ot-1", expectedVersion: 2, requestDate: "2026-11-02", requesterName: "Ana", repairDescription: null, observations: null }
    const edited = editWorkOrderSchema.safeParse({ ...edit, repair: false, maintenance: true, annexItems: ["Quitar"], maintenanceItems: ["Cambio de aceite"] })
    expect(edited.success).toBe(true)
    if (edited.success) expect(edited.data).toMatchObject({ annexItems: [], maintenanceItems: ["Cambio de aceite"] })
    // Un ítem corto de un tipo MARCADO sí se rechaza.
    expect(createWorkOrderSchema.safeParse({ ...withDate, repair: true, maintenance: false, annexItems: ["ab"] }).success).toBe(false)
  })

  it("dropHiddenItems no toca entradas que no son objetos ni tipos marcados", () => {
    expect(dropHiddenItems(null)).toBeNull()
    expect(dropHiddenItems("x")).toBe("x")
    const both = { repair: true, maintenance: true, annexItems: ["a"], maintenanceItems: ["b"] }
    expect(dropHiddenItems(both)).toEqual(both)
  })
})

describe("reclassifyWorkOrderSchema", () => {
  const input = { workOrderId: "ot-1", expectedVersion: 3, reason: "Se registró mal el tipo de acción" }
  it("exige motivo y versión; tipo, especialidades, faena y horas son opcionales (undefined conserva, null borra)", () => {
    expect(reclassifyWorkOrderSchema.safeParse(input).success).toBe(true)
    expect(reclassifyWorkOrderSchema.safeParse({ ...input, reason: "corto" }).success).toBe(false)
    expect(reclassifyWorkOrderSchema.safeParse({ ...input, expectedVersion: undefined }).success).toBe(false)
    expect(reclassifyWorkOrderSchema.safeParse({ ...input, actionType: null, specialties: [], executionWorksiteId: null, laborHours: null }).success).toBe(true)
    expect(reclassifyWorkOrderSchema.safeParse({ ...input, actionType: "urgente" }).success).toBe(false)
    expect(reclassifyWorkOrderSchema.safeParse({ ...input, laborHours: 10_001 }).success).toBe(false)
  })
})

describe("parseWorkOrderQuery", () => {
  it("descarta desde/hasta que no son fechas reales", () => {
    const parsed = parseWorkOrderQuery({ desde: "2026-02-31", hasta: "2026-03-05" })
    expect(parsed.from).toBeUndefined()
    expect(parsed.to).toBe("2026-03-05")
  })

  it("lee cerradaDesde/cerradaHasta y descarta los mal formados", () => {
    expect(parseWorkOrderQuery({ cerradaDesde: "2026-11-01", cerradaHasta: "2026-11-15" })).toMatchObject({ closedFrom: "2026-11-01", closedTo: "2026-11-15" })
    expect(parseWorkOrderQuery({ cerradaDesde: "2026-02-31", cerradaHasta: "x" })).toMatchObject({ closedFrom: undefined, closedTo: undefined })
  })
})
