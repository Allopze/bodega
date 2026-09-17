/**
 * lib/__tests__/pdtp-epp-delivery-accreditation.test.ts
 *
 * La N°62 del PDTP ("Registrar la entrega de los EPP y dejar documentada su
 * entrega a los trabajadores") debe acreditarse desde la ruta de entrega que
 * de verdad usa la aplicación: `registerWorkerStockDelivery`. Antes de esta
 * corrección el único conector vivía en `registerWorkerEppDelivery`, un
 * servicio sin llamador de producción — la N°62 nunca acreditaba nada.
 *
 * Cobertura:
 * - Entregar al menos un producto marcado EPP acredita la N°62 una sola vez
 *   por entrega, en la faena de origen.
 * - Entregar sólo productos no-EPP no acredita nada.
 * - Anular la entrega revoca la acreditación y dqueda el motivo de la
 *   anulación como evidencia del evento de revocación.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import { chileDateParts } from "@/lib/utils"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const { registerWorkerStockDelivery } = await import("@/lib/services/deliveries-worker-stock")
const { voidWorkerStockDelivery } = await import("@/lib/services/deliveries-void")

const PROGRAM_YEAR = chileDateParts().year
const PROGRAM_ID = "pdtp-epp-delivery-v1"
const ACT_N = 62
const ACT_ID = `${PROGRAM_ID}-a-062`

const USER_ID = "user-epp-delivery-1"
const WS_ID = "ws-epp-delivery-1"
const CATEGORY_ID = "cat-epp-delivery-1"
const EPP_PRODUCT_ID = "prod-epp-delivery-epp-1"
const PLAIN_PRODUCT_ID = "prod-epp-delivery-plain-1"
const WORKER_ID = "worker-epp-delivery-1"

async function seedProgram() {
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: PROGRAM_YEAR, title: `PDTP ${PROGRAM_YEAR} entrega EPP`,
    status: "active", appliesToAllWorksites: true, elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: ACT_ID, programId: PROGRAM_ID, n: ACT_N,
    activity: "Registrar la entrega de los EPP y dejar documentada su entrega",
    program: "Prevención PDTP",
    responsibleSlugs: ["prevencionista"], responsibleDisplay: "Prevencionista",
    scheduleMode: "scheduled", scheduleClassificationStatus: "confirmed",
    mechanism: "enganche", evidenceRequirement: "Comprobante de entrega",
    sourceSheetRow: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.attachments)
  await inMemoryDb.delete(schema.deliveryItems)
  await inMemoryDb.delete(schema.deliveries)
  await inMemoryDb.delete(schema.inventoryMovements)
  await inMemoryDb.delete(schema.worksiteStock)
  await inMemoryDb.delete(schema.products)
  await inMemoryDb.delete(schema.productCategories)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.users).values({
    id: USER_ID, name: "Bodeguero", email: "bodega-epp-delivery@example.test",
    hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: WS_ID, name: "Faena EPP Delivery", code: "FED", isActive: true, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.workers).values({
    id: WORKER_ID, firstName: "Andrea", lastName: "Operadora", worksiteId: WS_ID,
    isActive: true, createdAt: now,
  })
  await inMemoryDb.insert(schema.productCategories).values({
    id: CATEGORY_ID, name: "Categoría entrega EPP", slug: "categoria-entrega-epp", sortOrder: 0,
  })
  await inMemoryDb.insert(schema.products).values([
    {
      id: EPP_PRODUCT_ID, sku: "EPP-DELIVERY-1", name: "Guante de protección",
      categoryId: CATEGORY_ID, unitOfMeasure: "par", isActive: true, isService: false,
      isEpp: true, createdAt: now, updatedAt: now,
    },
    {
      id: PLAIN_PRODUCT_ID, sku: "PLAIN-DELIVERY-1", name: "Cinta adhesiva",
      categoryId: CATEGORY_ID, unitOfMeasure: "unidad", isActive: true, isService: false,
      isEpp: false, createdAt: now, updatedAt: now,
    },
  ])
  await inMemoryDb.insert(schema.worksiteStock).values([
    { id: "stock-epp-delivery-epp", worksiteId: WS_ID, productId: EPP_PRODUCT_ID, quantity: 10, minStock: 0, lastMovementAt: now, updatedAt: now },
    { id: "stock-epp-delivery-plain", worksiteId: WS_ID, productId: PLAIN_PRODUCT_ID, quantity: 10, minStock: 0, lastMovementAt: now, updatedAt: now },
  ])

  await seedProgram()
})

describe("registerWorkerStockDelivery acredita la N°62 del PDTP", () => {
  it("entregar un EPP acredita la N°62 en la faena de la entrega", async () => {
    const deliveryId = await registerWorkerStockDelivery({
      sourceWorksiteId: WS_ID, workerId: WORKER_ID, deliveredBy: USER_ID,
      items: [{ productId: EPP_PRODUCT_ID, quantity: 1 }],
    })

    const events = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      sourceType: "epp", sourceId: deliveryId, eventType: "completed", status: "accredited", worksiteId: WS_ID,
    })

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, ACT_ID))
    expect(executions).toHaveLength(1)
  })

  it("una sola acreditación por entrega aunque haya varios ítems EPP", async () => {
    const deliveryId = await registerWorkerStockDelivery({
      sourceWorksiteId: WS_ID, workerId: WORKER_ID, deliveredBy: USER_ID,
      items: [
        { productId: EPP_PRODUCT_ID, quantity: 1 },
        { productId: PLAIN_PRODUCT_ID, quantity: 1 },
      ],
    })

    const events = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
      .where(eq(schema.pdtpFulfillmentEvents.sourceId, deliveryId))
    expect(events).toHaveLength(1)
  })

  it("captura la ruta del adjunto de respaldo como evidencia real", async () => {
    await registerWorkerStockDelivery({
      sourceWorksiteId: WS_ID, workerId: WORKER_ID, deliveredBy: USER_ID,
      items: [{ productId: EPP_PRODUCT_ID, quantity: 1 }],
      proofAttachment: {
        fileName: "comprobante.pdf",
        filePath: "storage/deliveries/comprobante.pdf",
        fileSize: 1024,
        mimeType: "application/pdf",
      },
    })

    const [event] = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
    expect(event?.evidenceRef).toBe("storage/deliveries/comprobante.pdf")

    const [execution] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, ACT_ID))
    expect(execution?.evidenceStatus).toBe("provided")
  })

  it("una entrega sin ningún EPP no acredita nada", async () => {
    await registerWorkerStockDelivery({
      sourceWorksiteId: WS_ID, workerId: WORKER_ID, deliveredBy: USER_ID,
      items: [{ productId: PLAIN_PRODUCT_ID, quantity: 1 }],
    })
    expect(await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)).toEqual([])
  })

  it("anular la entrega revoca la acreditación y deja el motivo", async () => {
    const deliveryId = await registerWorkerStockDelivery({
      sourceWorksiteId: WS_ID, workerId: WORKER_ID, deliveredBy: USER_ID,
      items: [{ productId: EPP_PRODUCT_ID, quantity: 1 }],
    })
    await voidWorkerStockDelivery({ deliveryId, voidedBy: USER_ID, reason: "Trabajador equivocado en la guía" })

    const revocacion = (await inMemoryDb.select().from(schema.pdtpFulfillmentEvents))
      .find((event) => event.eventType === "revoked")
    expect(revocacion).toMatchObject({ sourceType: "epp", sourceId: deliveryId, status: "revoked" })
    expect(revocacion?.evidenceRef).toContain("Trabajador equivocado")

    const [ejecucion] = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(ejecucion?.status).toBe("draft")
  })
})
