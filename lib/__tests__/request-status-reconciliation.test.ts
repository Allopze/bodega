/**
 * `reconcileRequestStatuses` cierra las solicitudes que quedaron con el estado
 * que calculó una regla vieja.
 *
 * El caso real: `74adb8c3` (2026-07-04) quitó `received` de la regla de cierre
 * y `0a5bb3f1` (2026-09-02) lo devolvió. Las solicitudes recibidas en esa
 * ventana quedaron en `in_purchasing` con todos sus ítems en `received`, y
 * ninguna transición futura las cierra porque no queda ninguna por hacer.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { reconcileRequestStatuses, findRequestStatusDrift } =
  await import("@/lib/services/request-status-reconciliation")

const WORKSITE = "faena-1"
const USER = "user-1"
const SUPPLIER = "sup-1"

async function seedBase() {
  await inMemoryDb.insert(schema.worksites).values({ id: WORKSITE, name: "Faena Uno", code: "FN-001" })
  await inMemoryDb.insert(schema.suppliers).values({ id: SUPPLIER, name: "Proveedor" })
  await inMemoryDb.insert(schema.users).values({
    id: USER, email: "uno@chome.cl", name: "Uno", hashedPassword: "x",
  })
}

let seq = 0
async function addRequest(status: string, itemStatuses: string[]) {
  seq++
  const id = `req-${seq}`
  await inMemoryDb.insert(schema.purchaseRequests).values({
    id, code: `SOL-${String(seq).padStart(4, "0")}`, requestType: "epp", urgency: "normal",
    status, worksiteId: WORKSITE, requesterId: USER, submissionKey: `key-${id}`,
  })
  const itemIds: string[] = []
  for (const itemStatus of itemStatuses) {
    const itemId = nanoid()
    itemIds.push(itemId)
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: itemId, requestId: id, productNameFree: "Ítem", quantity: 1,
      unitOfMeasure: "unidad", status: itemStatus,
    })
  }
  return { id, itemIds }
}

/**
 * Línea de OC que aporta la cantidad recibida en faena del ítem. Sin esto
 * `fullyReceived` es falso y `partially_delivered` no cierra.
 */
async function receiveInto(requestItemId: string, quantity: number, received: number) {
  const orderId = `oc-${requestItemId}`
  await inMemoryDb.insert(schema.purchaseOrders).values({
    id: orderId, code: `OC-${requestItemId}`, supplierId: SUPPLIER,
    worksiteId: WORKSITE, createdBy: USER, status: "received",
  })
  await inMemoryDb.insert(schema.purchaseOrderItems).values({
    id: nanoid(), purchaseOrderId: orderId, requestItemId,
    quantity, quantityReceived: received, unitOfMeasure: "unidad",
  })
}

async function statusOf(id: string) {
  const row = await inMemoryDb.query.purchaseRequests.findFirst({
    where: eq(schema.purchaseRequests.id, id),
  })
  return row!.status
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.statusHistory)
  await inMemoryDb.delete(schema.purchaseOrderItems)
  await inMemoryDb.delete(schema.purchaseOrders)
  await inMemoryDb.delete(schema.purchaseRequestItems)
  await inMemoryDb.delete(schema.purchaseRequests)
  await inMemoryDb.delete(schema.users)
  await inMemoryDb.delete(schema.suppliers)
  await inMemoryDb.delete(schema.worksites)
  seq = 0
  await seedBase()
})

describe("findRequestStatusDrift", () => {
  it("detecta la solicitud recibida que quedó en in_purchasing", async () => {
    const { id } = await addRequest("in_purchasing", ["received"])

    const { drifts } = await findRequestStatusDrift()

    expect(drifts).toHaveLength(1)
    expect(drifts[0]).toMatchObject({ requestId: id, current: "in_purchasing", expected: "closed" })
  })

  it("no reporta la que sí tiene ítems pendientes", async () => {
    // `office_received` está recibido en oficina y todavía debe llegar a faena.
    await addRequest("in_purchasing", ["received", "office_received"])

    expect((await findRequestStatusDrift()).drifts).toEqual([])
  })

  it("no reporta una solicitud que ya está en su estado derivado", async () => {
    await addRequest("closed", ["received"])
    await addRequest("approved", ["approved"])

    expect((await findRequestStatusDrift()).drifts).toEqual([])
  })

  it("deja fuera borradores y canceladas, que el rollup no puede reescribir", async () => {
    await addRequest("draft", ["received"])
    await addRequest("cancelled", ["received"])

    expect((await findRequestStatusDrift()).drifts).toEqual([])
  })

  it("ignora una solicitud sin ítems, igual que el rollup", async () => {
    await addRequest("in_purchasing", [])

    expect((await findRequestStatusDrift()).drifts).toEqual([])
  })
})

describe("reconcileRequestStatuses", () => {
  it("por omisión informa y no escribe", async () => {
    const { id } = await addRequest("in_purchasing", ["received"])

    const summary = await reconcileRequestStatuses()

    expect(summary.dryRun).toBe(true)
    expect(summary.reconciled).toBe(0)
    expect(summary.drifts).toHaveLength(1)
    expect(await statusOf(id)).toBe("in_purchasing")
  })

  it("cierra la solicitud cuando se aplica", async () => {
    const { id } = await addRequest("in_purchasing", ["received", "rejected"])

    const summary = await reconcileRequestStatuses({ dryRun: false })

    expect(summary.reconciled).toBe(1)
    expect(await statusOf(id)).toBe("closed")
  })

  it("deja rastro en status_history, como cualquier transición", async () => {
    await addRequest("in_purchasing", ["received"])

    await reconcileRequestStatuses({ dryRun: false, userId: USER })

    const history = await inMemoryDb.select().from(schema.statusHistory)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      entityType: "purchase_request", fromStatus: "in_purchasing", toStatus: "closed",
    })
  })

  it("cierra `partially_delivered` cuando la cantidad confirma la llegada completa", async () => {
    // El caso de SOL-0001: 50 pedidas, 50 en faena, repartidas en parte.
    const { id, itemIds } = await addRequest("in_purchasing", ["partially_delivered"])
    await receiveInto(itemIds[0]!, 1, 1)

    await reconcileRequestStatuses({ dryRun: false })

    expect(await statusOf(id)).toBe("closed")
  })

  it("no cierra `partially_delivered` con saldo por llegar", async () => {
    // El caso de SOL-0027: pidió 3 y llegaron 2. `partially_delivered` no
    // distingue eso del anterior, así que la cantidad es la única señal.
    const { id, itemIds } = await addRequest("in_purchasing", ["delivered", "partially_delivered"])
    await receiveInto(itemIds[0]!, 1, 1)
    await receiveInto(itemIds[1]!, 1, 0.5)

    await reconcileRequestStatuses({ dryRun: false })

    expect(await statusOf(id)).toBe("in_purchasing")
  })

  it("es idempotente: la segunda corrida no encuentra deriva", async () => {
    await addRequest("in_purchasing", ["received"])

    await reconcileRequestStatuses({ dryRun: false })
    const second = await reconcileRequestStatuses({ dryRun: false })

    expect(second.drifts).toEqual([])
    expect(second.reconciled).toBe(0)
  })

  it("no toca la solicitud que está en su estado correcto", async () => {
    const { id: ok } = await addRequest("in_purchasing", ["received", "office_received"])
    const { id: drifted } = await addRequest("in_purchasing", ["received"])

    await reconcileRequestStatuses({ dryRun: false })

    expect(await statusOf(ok)).toBe("in_purchasing")
    expect(await statusOf(drifted)).toBe("closed")
  })
})
