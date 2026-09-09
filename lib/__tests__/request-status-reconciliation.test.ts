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

async function seedBase() {
  await inMemoryDb.insert(schema.worksites).values({ id: WORKSITE, name: "Faena Uno", code: "FN-001" })
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
    status, worksiteId: WORKSITE, requesterId: USER, createdBy: USER,
    submissionKey: `key-${id}`,
  })
  for (const itemStatus of itemStatuses) {
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: nanoid(), requestId: id, description: "Ítem", quantity: 1,
      unitOfMeasure: "unidad", status: itemStatus,
    })
  }
  return id
}

async function statusOf(id: string) {
  const row = await inMemoryDb.query.purchaseRequests.findFirst({
    where: eq(schema.purchaseRequests.id, id),
  })
  return row!.status
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.statusHistory)
  await inMemoryDb.delete(schema.purchaseRequestItems)
  await inMemoryDb.delete(schema.purchaseRequests)
  await inMemoryDb.delete(schema.users)
  await inMemoryDb.delete(schema.worksites)
  seq = 0
  await seedBase()
})

describe("findRequestStatusDrift", () => {
  it("detecta la solicitud recibida que quedó en in_purchasing", async () => {
    const id = await addRequest("in_purchasing", ["received"])

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
    const id = await addRequest("in_purchasing", ["received"])

    const summary = await reconcileRequestStatuses()

    expect(summary.dryRun).toBe(true)
    expect(summary.reconciled).toBe(0)
    expect(summary.drifts).toHaveLength(1)
    expect(await statusOf(id)).toBe("in_purchasing")
  })

  it("cierra la solicitud cuando se aplica", async () => {
    const id = await addRequest("in_purchasing", ["received", "rejected"])

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

  it("es idempotente: la segunda corrida no encuentra deriva", async () => {
    await addRequest("in_purchasing", ["received"])

    await reconcileRequestStatuses({ dryRun: false })
    const second = await reconcileRequestStatuses({ dryRun: false })

    expect(second.drifts).toEqual([])
    expect(second.reconciled).toBe(0)
  })

  it("no toca la solicitud que está en su estado correcto", async () => {
    const ok = await addRequest("in_purchasing", ["received", "office_received"])
    const drifted = await addRequest("in_purchasing", ["received"])

    await reconcileRequestStatuses({ dryRun: false })

    expect(await statusOf(ok)).toBe("in_purchasing")
    expect(await statusOf(drifted)).toBe("closed")
  })
})
