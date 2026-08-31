import ExcelJS from "exceljs"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq, isNull, sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

import {
  assignEmergencyResource,
  confirmEmergencyInventoryImport,
  exportEmergencyInventoryXlsx,
  listEmergencyResourceCoverage,
  previewEmergencyInventoryImport,
} from "@/lib/services/worksite-inventory"
import { createSubmittedRequest } from "@/lib/services/requests-draft"
import { registerReceipt } from "@/lib/services/receiving"
import { cancelRequest } from "@/lib/requests/request-service-module/cancel-request"

const worksiteId = "ws-emergency-import"
const userId = "user-emergency-import"
const access = {
  userId,
  permissions: ["admin:worksite_inventory"],
  scope: [worksiteId],
} as const
const serviceAccess = {
  userId,
  permissions: ["admin:worksite_inventory_service"],
  scope: [worksiteId],
} as const

async function workbook() {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet("Inventario")
  for (let line = 1; line < 11; line += 1) sheet.addRow([`Cabecera ${line}`])
  sheet.addRow(["N°", "Categoría", "Patente", "Marca", "ID extintor", "Agente", "Capacidad", "Última mantención", "Próximo vencimiento", "Ubicación", "Estado técnico"])
  sheet.addRow([1, "Taller", null, null, "EXT-001", "PQS", "6 kg", "15/01/2026", "15/01/2027", "Bodega", "OK"])
  sheet.addRow([2, "Taller", null, null, "EXT-002", "PQS", "6 kg", "15/01/2026", "15/01/2027", "Comedor", "PERCUTADO EN SIMULACRO"])
  return Buffer.from(await book.xlsx.writeBuffer())
}

describe("inventario canónico de activos de emergencia", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    const now = new Date().toISOString()
    await testDb.insert(schema.users).values({
      id: userId,
      name: "Prevencionista",
      email: "emergency-import@chome.cl",
      hashedPassword: "hash",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    await testDb.insert(schema.worksites).values({
      id: worksiteId,
      name: "Faena Emergencias",
      code: "EMERGENCY",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
  })

  afterAll(async () => pg.close())

  it("previsualiza, confirma una sola vez y conserva 2 activos, 2 puntos y 2 asignaciones", async () => {
    const file = await workbook()
    const preview = await previewEmergencyInventoryImport({ worksiteId, fileBuffer: file }, access)
    expect(preview).toMatchObject({
      headerLine: 11,
      canConfirm: true,
      alreadyApplied: false,
      counts: { create: 2, update: 0, unchanged: 0, conflict: 0 },
    })

    const confirmed = await confirmEmergencyInventoryImport({
      worksiteId,
      fileBuffer: file,
      fileName: "inventario-biodiversa.xlsx",
    }, access)
    expect(confirmed).toMatchObject({ created: 2, updated: 0, unchanged: 0, points: 2 })

    const [resources, points, assignments, batches] = await Promise.all([
      testDb.select().from(schema.preventionEmergencyResources).where(eq(schema.preventionEmergencyResources.worksiteId, worksiteId)),
      testDb.select().from(schema.preventionEmergencyResourcePoints).where(eq(schema.preventionEmergencyResourcePoints.worksiteId, worksiteId)),
      testDb.select().from(schema.preventionEmergencyResourceAssignments).where(isNull(schema.preventionEmergencyResourceAssignments.unassignedAt)),
      testDb.select().from(schema.preventionEmergencyResourceImportBatches).where(eq(schema.preventionEmergencyResourceImportBatches.worksiteId, worksiteId)),
    ])
    expect(resources).toHaveLength(2)
    expect(resources.find((resource) => resource.assetCode === "EXT-002")?.status).toBe("needs_maintenance")
    expect(points).toHaveLength(2)
    expect(assignments).toHaveLength(2)
    expect(batches).toHaveLength(1)

    const exported = await exportEmergencyInventoryXlsx(access)
    const roundTrip = await previewEmergencyInventoryImport({ worksiteId, fileBuffer: exported }, access)
    expect(roundTrip.counts).toMatchObject({ create: 0, update: 0, unchanged: 2, conflict: 0 })

    await expect(confirmEmergencyInventoryImport({
      worksiteId,
      fileBuffer: file,
      fileName: "inventario-biodiversa.xlsx",
    }, access)).rejects.toThrow("ya fue confirmado")
  })

  it("impide dos asignaciones activas para el mismo punto o activo", async () => {
    const [assignment] = await testDb.select().from(schema.preventionEmergencyResourceAssignments)
      .where(isNull(schema.preventionEmergencyResourceAssignments.unassignedAt)).limit(1)
    expect(assignment).toBeDefined()
    await expect(testDb.insert(schema.preventionEmergencyResourceAssignments).values({
      id: "duplicate-active-assignment",
      pointId: assignment!.pointId,
      resourceId: assignment!.resourceId,
      actorUserId: userId,
    })).rejects.toThrow()
  })

  it("enviar la solicitud abre un solo caso, termina la asignación y abre la brecha", async () => {
    const [resource] = await testDb.select().from(schema.preventionEmergencyResources)
      .where(eq(schema.preventionEmergencyResources.assetCode, "EXT-001")).limit(1)
    expect(resource).toBeDefined()

    const result = await createSubmittedRequest(userId, "emergency-import@chome.cl", {
      worksiteId,
      requestType: "otro",
      urgency: "critical",
      requiredDate: "2026-12-01",
      deliveryMode: "directo_faena",
      notes: "Recarga preventiva",
      items: [{
        productId: "prod-srv-recarga-extintor",
        productNameFree: null,
        quantity: 1,
        unitOfMeasure: "servicio",
        urgency: "critical",
        requiredDate: "2026-12-01",
        workerId: null,
        emergencyResourceId: resource!.id,
        suggestedSupplierId: null,
        supplierHint: null,
        sortOrder: 0,
        notes: null,
        attributes: [],
      }],
    })
    expect(result.kind).toBe("created")

    const [serviceCase] = await testDb.select().from(schema.preventionEmergencyResourceServiceCases)
      .where(eq(schema.preventionEmergencyResourceServiceCases.resourceId, resource!.id))
    expect(serviceCase?.status).toBe("open")
    expect(serviceCase?.previousPointId).toBeTruthy()

    const [after] = await testDb.select().from(schema.preventionEmergencyResources)
      .where(eq(schema.preventionEmergencyResources.id, resource!.id))
    expect(after?.status).toBe("needs_maintenance")
    const active = await testDb.select().from(schema.preventionEmergencyResourceAssignments).where(and(
      eq(schema.preventionEmergencyResourceAssignments.resourceId, resource!.id),
      isNull(schema.preventionEmergencyResourceAssignments.unassignedAt),
    ))
    expect(active).toHaveLength(0)

    const [type] = await testDb.select().from(schema.preventionEmergencyResourceTypes)
      .where(eq(schema.preventionEmergencyResourceTypes.id, resource!.typeId!)).limit(1)
    await testDb.insert(schema.preventionEmergencyResources).values({
      id: "resource-spare", worksiteId, assetCode: "EXT-SPARE", typeId: type!.id,
      name: "Extintor de reemplazo", kind: "Extintor", location: "Bodega",
      status: "operational", expiresAt: "2027-12-31",
    })
    await assignEmergencyResource({
      pointId: serviceCase!.previousPointId!,
      resourceId: "resource-spare",
      reason: "Reemplazo mientras EXT-001 está en recarga",
    }, serviceAccess)
    const coverage = await listEmergencyResourceCoverage(serviceAccess)
    expect(coverage.find((row) => row.point.id === serviceCase!.previousPointId)).toMatchObject({
      assignedResourceId: "resource-spare",
      coverage: { state: "covered", covered: true },
    })

    await expect(createSubmittedRequest(userId, "emergency-import@chome.cl", {
      worksiteId,
      requestType: "otro",
      urgency: "critical",
      requiredDate: "2026-12-01",
      deliveryMode: "directo_faena",
      notes: "Duplicada",
      items: [{
        productId: "prod-srv-recarga-extintor",
        productNameFree: null,
        quantity: 1,
        unitOfMeasure: "servicio",
        urgency: "critical",
        requiredDate: "2026-12-01",
        workerId: null,
        emergencyResourceId: resource!.id,
        suggestedSupplierId: null,
        supplierHint: null,
        sortOrder: 0,
        notes: null,
        attributes: [],
      }],
    })).rejects.toThrow("caso de recarga abierto")
  })

  it("sólo la recepción final conforme con ambas fechas reactiva y restaura el punto libre", async () => {
    const [serviceCase] = await testDb.select().from(schema.preventionEmergencyResourceServiceCases)
      .where(eq(schema.preventionEmergencyResourceServiceCases.status, "open")).limit(1)
    expect(serviceCase).toBeDefined()
    const now = new Date().toISOString()
    await testDb.insert(schema.suppliers).values({
      id: "supplier-extinguisher",
      name: "Recargas Seguras",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    await testDb.insert(schema.purchaseOrders).values({
      id: "po-extinguisher",
      code: "OC-EXT-001",
      worksiteId,
      supplierId: "supplier-extinguisher",
      createdBy: userId,
      issuedBy: userId,
      status: "sent",
      deliveryMode: "directo_faena",
      issuedAt: now,
      sentAt: now,
    })
    await testDb.insert(schema.purchaseOrderItems).values({
      id: "po-item-extinguisher",
      purchaseOrderId: "po-extinguisher",
      requestItemId: serviceCase!.requestItemId,
      productId: "prod-srv-recarga-extintor",
      quantity: 1,
      unitOfMeasure: "servicio",
      unitPrice: null,
      subtotal: null,
    })
    await testDb.update(schema.purchaseRequestItems)
      .set({ status: "purchased" })
      .where(eq(schema.purchaseRequestItems.id, serviceCase!.requestItemId))

    await expect(registerReceipt({
      purchaseOrderId: "po-extinguisher",
      receivedBy: userId,
      stage: "faena",
      worksiteId,
      items: [{ purchaseOrderItemId: "po-item-extinguisher", quantityReceived: 1 }],
    }, [worksiteId])).rejects.toThrow("fecha de mantención")

    await registerReceipt({
      purchaseOrderId: "po-extinguisher",
      receivedBy: userId,
      stage: "faena",
      worksiteId,
      items: [{
        purchaseOrderItemId: "po-item-extinguisher",
        quantityReceived: 0.5,
        maintenanceDate: "2026-09-01",
        nextExpiryDate: "2027-09-01",
      }],
    }, [worksiteId])
    const [partialResource] = await testDb.select().from(schema.preventionEmergencyResources)
      .where(eq(schema.preventionEmergencyResources.id, serviceCase!.resourceId))
    expect(partialResource?.status).toBe("needs_maintenance")

    await registerReceipt({
      purchaseOrderId: "po-extinguisher",
      receivedBy: userId,
      stage: "faena",
      worksiteId,
      items: [{
        purchaseOrderItemId: "po-item-extinguisher",
        quantityReceived: 0.5,
        maintenanceDate: "2026-09-01",
        nextExpiryDate: "2027-09-01",
      }],
    }, [worksiteId])

    const [completed, resource, originalAssignment, replacementAssignment] = await Promise.all([
      testDb.select().from(schema.preventionEmergencyResourceServiceCases)
        .where(eq(schema.preventionEmergencyResourceServiceCases.id, serviceCase!.id)).then((rows) => rows[0]),
      testDb.select().from(schema.preventionEmergencyResources)
        .where(eq(schema.preventionEmergencyResources.id, serviceCase!.resourceId)).then((rows) => rows[0]),
      testDb.select().from(schema.preventionEmergencyResourceAssignments).where(and(
        eq(schema.preventionEmergencyResourceAssignments.resourceId, serviceCase!.resourceId),
        isNull(schema.preventionEmergencyResourceAssignments.unassignedAt),
      )).then((rows) => rows[0]),
      testDb.select().from(schema.preventionEmergencyResourceAssignments).where(and(
        eq(schema.preventionEmergencyResourceAssignments.resourceId, "resource-spare"),
        isNull(schema.preventionEmergencyResourceAssignments.unassignedAt),
      )).then((rows) => rows[0]),
    ])
    expect(completed).toMatchObject({ status: "completed" })
    expect(resource).toMatchObject({
      status: "operational",
      lastMaintenanceAt: "2026-09-01",
      expiresAt: "2027-09-01",
    })
    expect(originalAssignment).toBeUndefined()
    expect(replacementAssignment?.pointId).toBe(serviceCase!.previousPointId)
  })

  it("cancelar la solicitud cierra el caso pero no reactiva ni restaura cobertura", async () => {
    const [resource] = await testDb.select().from(schema.preventionEmergencyResources)
      .where(eq(schema.preventionEmergencyResources.assetCode, "EXT-002"))
      .limit(1)
    expect(resource).toBeDefined()
    await createSubmittedRequest(userId, "emergency-import@chome.cl", {
      worksiteId,
      requestType: "otro",
      urgency: "critical",
      requiredDate: "2026-12-02",
      deliveryMode: "directo_faena",
      notes: "Recarga posterior al simulacro",
      items: [{
        productId: "prod-srv-recarga-extintor", productNameFree: null,
        quantity: 1, unitOfMeasure: "servicio", urgency: "critical",
        requiredDate: "2026-12-02", workerId: null,
        emergencyResourceId: resource!.id, suggestedSupplierId: null,
        supplierHint: null, sortOrder: 0, notes: null, attributes: [],
      }],
    })
    const [serviceCase] = await testDb.select().from(schema.preventionEmergencyResourceServiceCases)
      .where(and(
        eq(schema.preventionEmergencyResourceServiceCases.resourceId, resource!.id),
        eq(schema.preventionEmergencyResourceServiceCases.status, "open"),
      )).limit(1)
    const [requestItem] = await testDb.select().from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.id, serviceCase!.requestItemId)).limit(1)

    await cancelRequest(requestItem!.requestId, userId, "Servicio cancelado por operación")

    const [cancelledCase] = await testDb.select().from(schema.preventionEmergencyResourceServiceCases)
      .where(eq(schema.preventionEmergencyResourceServiceCases.id, serviceCase!.id))
    const [after] = await testDb.select().from(schema.preventionEmergencyResources)
      .where(eq(schema.preventionEmergencyResources.id, resource!.id))
    const active = await testDb.select().from(schema.preventionEmergencyResourceAssignments).where(and(
      eq(schema.preventionEmergencyResourceAssignments.resourceId, resource!.id),
      isNull(schema.preventionEmergencyResourceAssignments.unassignedAt),
    ))
    expect(cancelledCase?.status).toBe("cancelled")
    expect(after?.status).toBe("needs_maintenance")
    expect(active).toHaveLength(0)
  })

  it("hace inmutables los eventos y no filtra activos de otra faena", async () => {
    const [event] = await testDb.select().from(schema.preventionEmergencyResourceEvents).limit(1)
    expect(event).toBeDefined()
    await expect(testDb.update(schema.preventionEmergencyResourceEvents)
      .set({ notes: "alterado" })
      .where(eq(schema.preventionEmergencyResourceEvents.id, event!.id))).rejects.toThrow()

    await expect(previewEmergencyInventoryImport({
      worksiteId,
      fileBuffer: await workbook(),
    }, { ...access, scope: ["ws-ajena"] })).rejects.toThrow("fuera de alcance")

    const openAssignments = await testDb.select({ count: sql<number>`count(*)::int` })
      .from(schema.preventionEmergencyResourceAssignments)
      .innerJoin(schema.preventionEmergencyResourcePoints, eq(schema.preventionEmergencyResourceAssignments.pointId, schema.preventionEmergencyResourcePoints.id))
      .where(and(
        eq(schema.preventionEmergencyResourcePoints.worksiteId, worksiteId),
        isNull(schema.preventionEmergencyResourceAssignments.unassignedAt),
      ))
    // La recepción final conforme restauró EXT-001. La cancelación de EXT-002
    // no restauró su punto, así que esa brecha permanece abierta.
    expect(openAssignments[0]?.count).toBe(1)
  })
})
