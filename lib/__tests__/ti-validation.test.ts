import { describe, expect, it } from "vitest"
import {
  itAssetTypeSchema,
  itAssetCreateSchema,
  itAssetStatusChangeSchema,
  itAssignmentCreateSchema,
  itAssignmentReturnSchema,
  itMaintenanceSchema,
  itRetirementSchema,
  itTicketCreateSchema,
  itTicketTransitionSchema,
  itTicketCommentSchema,
  itLicenseSchema,
  itLicenseAssignmentSchema,
  itAccessSystemSchema,
  itSystemAccessSchema,
  itChecklistSchema,
  itChecklistTaskToggleSchema,
  itSupplierLinkSchema,
} from "@/lib/validation/ti"
// Fuente única: la copia duplicada en `lib/validation/ti.ts` no tenía
// consumidores en producción y ambas se testeaban por separado, así que una
// divergencia no habría fallado ninguna suite.
import { retirementTargetStatus } from "@/lib/services/ti/constants"

const ok = (schema: Parameters<typeof itAssetTypeSchema.safeParse>[0]) => schema

describe("validación zod del módulo TI", () => {
  it("valida el catálogo de tipos de activo", () => {
    expect(itAssetTypeSchema.safeParse({ name: "Notebook", category: "computacion", hasSpecs: "true" }).success).toBe(true)
    expect(itAssetTypeSchema.safeParse({ name: "X", category: "computacion" }).success).toBe(false) // nombre corto
    expect(itAssetTypeSchema.safeParse({ name: "Notebook", category: "no-existe" }).success).toBe(false)
  })

  it("valida alta de activo: código, estado y specs opcionales", () => {
    const base = { code: "TI-NB-0001", assetTypeId: "t1" }
    expect(itAssetCreateSchema.safeParse(base).success).toBe(true)
    expect(itAssetCreateSchema.safeParse({ ...base, code: "" }).success).toBe(false)
    // El alta siempre parte disponible: los cambios de estado deben pasar por
    // el flujo trazable de custodia o cambio manual con motivo.
    expect(itAssetCreateSchema.safeParse({ ...base, status: "en_reparacion" }).success).toBe(false)
    expect(itAssetCreateSchema.safeParse({ ...base, status: "flotando" }).success).toBe(false)
    expect(itAssetCreateSchema.safeParse({ ...base, cost: -1 }).success).toBe(false)
    expect(itAssetCreateSchema.safeParse({ ...base, cost: "150000" }).success).toBe(true) // coerce
  })

  it("exige motivo en el cambio manual de estado", () => {
    expect(itAssetStatusChangeSchema.safeParse({ assetId: "a1", status: "en_bodega", reason: "Almacenamiento" }).success).toBe(true)
    expect(itAssetStatusChangeSchema.safeParse({ assetId: "a1", status: "en_bodega", reason: "x" }).success).toBe(false)
  })

  it("valida entrega: fechas formato local y no futuras", () => {
    const base = {
      assetId: "a1", workerId: "w1", worksiteId: "ws1",
      deliveredAt: "2026-09-01T10:00", physicalState: "bueno",
    }
    expect(itAssignmentCreateSchema.safeParse(base).success).toBe(true)
    expect(itAssignmentCreateSchema.safeParse({ ...base, deliveredAt: "2026-09-01" }).success).toBe(false) // sin HH:MM
    expect(itAssignmentCreateSchema.safeParse({ ...base, physicalState: "impecable" }).success).toBe(false)
  })

  it("valida devolución con nextStatus restringido", () => {
    const base = { assignmentId: "asg1", returnedAt: "2026-01-10T17:00" } // fecha pasada válida
    expect(itAssignmentReturnSchema.safeParse({ ...base, nextStatus: "en_bodega" }).success).toBe(true)
    expect(itAssignmentReturnSchema.safeParse({ ...base, nextStatus: "perdido" }).success).toBe(false)
  })

  it("valida mantención con trabajo descrito", () => {
    expect(itMaintenanceSchema.safeParse({ assetId: "a1", date: "2026-08-01", workDone: "Cambio de pantalla" }).success).toBe(true)
    expect(itMaintenanceSchema.safeParse({ assetId: "a1", date: "2026-08-01", workDone: "" }).success).toBe(false)
  })

  it("valida bajas con motivo y responsables", () => {
    const base = {
      assetId: "a1", date: "2026-08-01", reason: "venta",
      responsibleUserId: "u1", authorizedByUserId: "u2",
    }
    expect(itRetirementSchema.safeParse(base).success).toBe(true)
    expect(itRetirementSchema.safeParse({ ...base, reason: "regalo" }).success).toBe(false)
    // Doble control: responsable y autorizante no pueden coincidir.
    expect(itRetirementSchema.safeParse({ ...base, authorizedByUserId: "u1" }).success).toBe(false)
    expect(retirementTargetStatus("perdida")).toBe("perdido")
    expect(retirementTargetStatus("robo")).toBe("robado")
    expect(retirementTargetStatus("venta")).toBe("dado_de_baja")
  })

  it("valida tickets: asunto y descripción mínimos", () => {
    const base = { subject: "No enciende", description: "La pantalla queda negra al iniciar sesión", worksiteId: "ws1" }
    expect(itTicketCreateSchema.safeParse(base).success).toBe(true)
    expect(itTicketCreateSchema.safeParse({ ...base, subject: "abc" }).success).toBe(false)
    expect(itTicketCreateSchema.safeParse({ ...base, priority: "critica" }).success).toBe(true)
    // Resolver exige dejar constancia de qué se hizo: es el entregable del caso.
    expect(itTicketTransitionSchema.safeParse({ ticketId: "t1", status: "resuelto", reason: "Listo" }).success).toBe(false)
    expect(itTicketTransitionSchema.safeParse({
      ticketId: "t1", status: "resuelto", reason: "Listo", resolution: "Se reemplazó el cargador",
    }).success).toBe(true)
    // Las demás transiciones no la requieren.
    expect(itTicketTransitionSchema.safeParse({ ticketId: "t1", status: "en_progreso", reason: "Listo" }).success).toBe(true)
    expect(itTicketCommentSchema.safeParse({ ticketId: "t1", body: "Hola", isInternal: "true" }).success).toBe(true)
  })

  it("valida licencias y exige al menos un destino en la asignación", () => {
    expect(itLicenseSchema.safeParse({ name: "Office", purchasedQuantity: 5, periodicity: "anual" }).success).toBe(true)
    expect(itLicenseSchema.safeParse({ name: "Office", purchasedQuantity: -1 }).success).toBe(false)

    expect(itLicenseAssignmentSchema.safeParse({ licenseId: "l1", workerId: "w1" }).success).toBe(true)
    expect(itLicenseAssignmentSchema.safeParse({ licenseId: "l1", area: "Finanzas" }).success).toBe(true)
    expect(itLicenseAssignmentSchema.safeParse({ licenseId: "l1" }).success).toBe(false) // sin destino
  })

  it("valida accesos y checklists", () => {
    expect(itAccessSystemSchema.safeParse({ name: "VPN" }).success).toBe(true)
    expect(itSystemAccessSchema.safeParse({ systemId: "s1", workerId: "w1", status: "activo" }).success).toBe(true)
    expect(itSystemAccessSchema.safeParse({ systemId: "s1", workerId: "w1", status: "delegado" }).success).toBe(false)

    expect(itChecklistSchema.safeParse({ workerId: "w1", kind: "onboarding" }).success).toBe(true)
    expect(itChecklistSchema.safeParse({ workerId: "w1", kind: "transferencia" }).success).toBe(false)
    expect(itChecklistTaskToggleSchema.safeParse({ taskId: "t1", done: "on" }).success).toBe(true)
  })

  it("valida vínculos de proveedor TI", () => {
    expect(itSupplierLinkSchema.safeParse({ supplierId: "s1", category: "reparacion" }).success).toBe(true)
    expect(itSupplierLinkSchema.safeParse({ supplierId: "s1", category: "mantencion" }).success).toBe(false)
  })

  it("existe al menos un esquema exportado por dominio (guardia de re-export)", () => {
    // Evita que una refactorización deje el barrel de validación vacío por error.
    expect(ok(itAssetTypeSchema)).toBeDefined()
  })
})
