/**
 * Durable idempotency for the explicit EPP stock confirmation.
 *
 * This must run on PostgreSQL: PGlite validates the transaction shape, but a
 * real unique index and `FOR SHARE` locks are needed to prove two simultaneous
 * confirmation clicks leave only one request, item, audit entry and status row.
 *
 * Gate: EPP_REQUEST_CONCURRENCY_DATABASE_URL +
 * EPP_REQUEST_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET=true
 */
import path from "node:path"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { asc, eq, inArray, sql } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { RequestFormData } from "@/lib/validation/operations"
import type { CreatedSubmittedRequest, CreateSubmittedRequestResult } from "@/lib/services/requests-draft"
import type { Session } from "next-auth"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"

const databaseUrl = process.env.EPP_REQUEST_CONCURRENCY_DATABASE_URL
const canResetDatabase = process.env.EPP_REQUEST_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip
const originalDatabaseUrl = process.env.DATABASE_URL
const originalAuthSecret = process.env.AUTH_SECRET

let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined
let createSubmittedRequest: typeof import("@/lib/services/requests-draft")["createSubmittedRequest"]
let readEppStockAvailability: typeof import("@/lib/services/epp-stock-availability")["readEppStockAvailability"]
let lockActiveEppStockWorksite: typeof import("@/lib/services/epp-stock-availability")["lockActiveEppStockWorksite"]
let readEppStockAvailabilityForLockedWorksite: typeof import("@/lib/services/epp-stock-availability")["readEppStockAvailabilityForLockedWorksite"]
let getEppStockWarnings: typeof import("@/lib/services/epp-stock-availability")["getEppStockWarnings"]
let applyMovement: typeof import("@/lib/services/stock-movement")["applyMovement"]
let closePhysicalInventoryCount: typeof import("@/lib/services/physical-inventory")["closePhysicalInventoryCount"]
let lockCatalogProductsForUpdateTx: typeof import("@/lib/services/catalog-product-locks")["lockCatalogProductsForUpdateTx"]
let hashRequestSubmissionPayload: typeof import("@/lib/services/epp-stock-confirmation")["hashRequestSubmissionPayload"]

const userId = "user-epp-request-concurrency"
const worksiteId = "ws-epp-request-concurrency"
const productId = "prod-epp-request-concurrency"
const absentStockProductId = "prod-epp-request-absent-stock"
const zeroStockProductId = "prod-epp-request-zero-stock"
const physicalCountProductId = "prod-epp-request-physical-count"
const physicalCountAbsentStockProductId = "prod-epp-request-physical-count-absent"
const otherWorksiteId = "ws-epp-request-concurrency-other"
const dbOrderedHyphenProductId = "prod-epp-request-product-lock-a-"
const dbOrderedUnderscoreProductId = "prod-epp-request-product-lock-a_"
const physicalInventoryGateKey = 7_290_041
const physicalInventoryGateFunction = "epp_request_physical_inventory_gate"
const physicalInventoryGateTrigger = "epp_request_physical_inventory_gate_trigger"

const physicalInventorySession = {
  user: {
    id: userId,
    name: "EPP concurrency",
    email: "epp-concurrency@test.local",
    permissions: ["warehouse:adjust_stock"],
    roles: ["bodeguero"],
    worksiteIds: [worksiteId],
    primaryWorksiteId: worksiteId,
    avatarColor: null,
    isActive: true,
  },
  expires: new Date(Date.now() + 86_400_000).toISOString(),
} as unknown as Session

const data: RequestFormData = {
  worksiteId,
  requestType: "epp",
  urgency: "normal",
  deliveryMode: "via_oficina",
  requiredDate: "2026-12-01",
  notes: "Prueba de doble confirmación EPP",
  items: [{
    productId,
    productNameFree: null,
    quantity: 3,
    unitOfMeasure: "unidad",
    urgency: "normal",
    attributes: [],
    sortOrder: 0,
  }],
}

describeIf("EPP request confirmation concurrency on real Postgres", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "EPP_REQUEST_CONCURRENCY",
    })
    await ensureDatabaseExists(databaseUrl!)
    await resetPublicSchema(databaseUrl!)

    const migrationClient = postgres(databaseUrl!, { max: 1 })
    await migrate(drizzle(migrationClient), {
      migrationsFolder: path.resolve(process.cwd(), "db/migrations"),
    })
    await migrationClient.end()

    client = postgres(databaseUrl!, { max: 10 })
    testDb = drizzle(client, { schema })
    await seedFixture(getTestDb())

    process.env.DATABASE_URL = databaseUrl
    process.env.AUTH_SECRET = "epp-request-concurrency-test-secret"
    const globalWithDb = globalThis as typeof globalThis & { __db?: unknown }
    globalWithDb.__db = undefined
    vi.resetModules()
    const requestService = await import("@/lib/services/requests-draft")
    createSubmittedRequest = requestService.createSubmittedRequest
    const availabilityService = await import("@/lib/services/epp-stock-availability")
    readEppStockAvailability = availabilityService.readEppStockAvailability
    lockActiveEppStockWorksite = availabilityService.lockActiveEppStockWorksite
    readEppStockAvailabilityForLockedWorksite = availabilityService.readEppStockAvailabilityForLockedWorksite
    getEppStockWarnings = availabilityService.getEppStockWarnings
    const stockMovementService = await import("@/lib/services/stock-movement")
    applyMovement = stockMovementService.applyMovement
    const physicalInventoryService = await import("@/lib/services/physical-inventory")
    closePhysicalInventoryCount = physicalInventoryService.closePhysicalInventoryCount
    const catalogProductLocks = await import("@/lib/services/catalog-product-locks")
    lockCatalogProductsForUpdateTx = catalogProductLocks.lockCatalogProductsForUpdateTx
    const confirmationService = await import("@/lib/services/epp-stock-confirmation")
    hashRequestSubmissionPayload = confirmationService.hashRequestSubmissionPayload
  }, 300_000)

  afterAll(async () => {
    const globalWithDb = globalThis as typeof globalThis & { __db?: unknown }
    globalWithDb.__db = undefined
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDatabaseUrl
    if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = originalAuthSecret
    await client?.end()
  })

  it("creates one request when the same valid confirmation is submitted concurrently", async () => {
    const submissionKey = "epp-request-concurrent-0001"
    const warning = await createSubmittedRequest(userId, "epp-concurrency@test.local", data, { submissionKey })
    expect(warning.kind).toBe("epp-stock-warning")
    if (warning.kind !== "epp-stock-warning") throw new Error("Expected stock warning")

    const results = await Promise.all([
      createSubmittedRequest(userId, "epp-concurrency@test.local", data, {
        submissionKey,
        confirmationToken: warning.confirmationToken,
      }),
      createSubmittedRequest(userId, "epp-concurrency@test.local", data, {
        submissionKey,
        confirmationToken: warning.confirmationToken,
      }),
    ])

    expect(results.every((result) => result.kind === "created")).toBe(true)
    const created = results.filter((result): result is CreatedSubmittedRequest => result.kind === "created")
    expect(created.filter((result) => !result.replayed)).toHaveLength(1)
    expect(created.filter((result) => result.replayed)).toHaveLength(1)
    expect(new Set(created.map((result) => result.requestId)).size).toBe(1)

    const db = getTestDb()
    const requests = await db.select().from(schema.purchaseRequests)
      .where(eq(schema.purchaseRequests.submissionKey, submissionKey))
    expect(requests).toHaveLength(1)

    const requestId = requests[0]!.id
    const [items, audits, history] = await Promise.all([
      db.select().from(schema.purchaseRequestItems).where(eq(schema.purchaseRequestItems.requestId, requestId)),
      db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, requestId)),
      db.select().from(schema.statusHistory).where(eq(schema.statusHistory.entityId, requestId)),
    ])
    expect(items).toHaveLength(1)
    expect(audits.filter((row) => row.entityType === "purchase_request")).toHaveLength(1)
    expect(history.filter((row) => row.entityType === "purchase_request" && row.toStatus === "submitted")).toHaveLength(1)
  })

  it("serializes simultaneous zero-stock submissions without a lock-upgrade deadlock", async () => {
    const requestWithoutStock: RequestFormData = {
      ...data,
      notes: "Prueba de dos solicitudes sin stock",
      items: [{ ...data.items[0]!, productId: zeroStockProductId }],
    }
    const results = await Promise.all([
      createSubmittedRequest(userId, "epp-concurrency@test.local", requestWithoutStock, {
        submissionKey: "epp-request-zero-stock-0001",
      }),
      createSubmittedRequest(userId, "epp-concurrency@test.local", requestWithoutStock, {
        submissionKey: "epp-request-zero-stock-0002",
      }),
    ])

    expect(results.every((result) => result.kind === "created" && !result.replayed)).toBe(true)
    expect(new Set(results.map((result) => result.kind === "created" ? result.requestId : null)).size).toBe(2)
  })

  it("blocks an ingreso until the final no-stock snapshot transaction finishes", async () => {
    const requestWithoutStock: RequestFormData = {
      ...data,
      notes: "Prueba de barrera de ingreso sin fila inicial",
      items: [{ ...data.items[0]!, productId: absentStockProductId }],
    }

    let movement: Promise<number> | null = null
    await getTestDb().transaction(async (tx) => {
      const lockedSnapshot = await readEppStockAvailability(tx, {
        worksiteId,
        items: requestWithoutStock.items,
        worksiteLock: "no key update",
      })
      expect(getEppStockWarnings(lockedSnapshot.snapshot)).toEqual([])

      // applyMovement takes FOR SHARE on the same worksite. It must remain
      // blocked while the final request snapshot owns FOR NO KEY UPDATE, even
      // though there is no worksite_stock row yet to lock.
      movement = applyMovement({
        worksiteId,
        productId: absentStockProductId,
        type: "ingreso_oc",
        quantity: 2,
        performedBy: userId,
        userEmail: "epp-concurrency@test.local",
        referenceType: "test_ingreso",
      })
      await waitForDatabaseLockWait()
    })
    if (!movement) throw new Error("Expected concurrent inventory movement")
    expect(await movement).toBe(2)
  })

  it("replays an identical retry after stock moved while it waited for the selected-worksite barrier", async () => {
    const submissionKey = "epp-request-replay-after-barrier-0001"
    const replayData: RequestFormData = {
      ...data,
      notes: "Prueba de replay tras movimiento en barrera de faena",
      items: [{ ...data.items[0]!, productId: zeroStockProductId }],
    }

    let movement: Promise<number> | undefined
    let retry: Promise<CreateSubmittedRequestResult> | undefined

    await getTestDb().transaction(async (tx) => {
      const [worksite] = await tx
        .select({ id: schema.worksites.id })
        .from(schema.worksites)
        .where(eq(schema.worksites.id, worksiteId))
        .for("no key update")
        .limit(1)
      expect(worksite).toBeDefined()

      // Queue the movement before the retry. The retry completes its first
      // replay lookup, then waits behind this movement on the worksite barrier.
      movement = applyMovement({
        worksiteId,
        productId: zeroStockProductId,
        type: "ingreso_oc",
        quantity: 2,
        performedBy: userId,
        userEmail: "epp-concurrency@test.local",
        referenceType: "test_ingreso_replay",
      })
      await waitForDatabaseLockWait()

      retry = createSubmittedRequest(userId, "epp-concurrency@test.local", replayData, { submissionKey })
      await waitForDatabaseLockWait(2)

      // This represents the first attempt committing while the retry was
      // blocked. It shares the exact durable idempotency identity.
      await getTestDb().insert(schema.purchaseRequests).values({
        id: "req-epp-replay-after-barrier",
        code: "SOL-EPP-REPLAY-BARRIER",
        worksiteId,
        requesterId: userId,
        requestType: "epp",
        urgency: "normal",
        requiredDate: replayData.requiredDate,
        status: "submitted",
        submittedAt: new Date().toISOString(),
        notes: replayData.notes,
        deliveryMode: "via_oficina",
        submissionKey,
        submissionPayloadHash: hashRequestSubmissionPayload(replayData),
      })
    })

    if (!movement || !retry) throw new Error("La carrera de replay no se inició")
    expect(await movement).toBe(2)

    const result = await resolveWithin(retry, "El reintento quedó bloqueado después de la barrera")
    expect(result).toEqual({
      kind: "created",
      requestId: "req-epp-replay-after-barrier",
      code: "SOL-EPP-REPLAY-BARRIER",
      replayed: true,
    })
  })

  it("settles a physical-count adjustment and final EPP preflight without a worksite/product deadlock", async () => {
    await installPhysicalInventoryGate()
    const gateClient = postgres(databaseUrl!, { max: 1 })
    const gateLocked = deferred<void>()
    const releaseGate = deferred<void>()
    const preflightLocked = deferred<void>()
    const beginPreflightRead = deferred<void>()
    let preflight: Promise<Awaited<ReturnType<typeof readEppStockAvailability>>> | undefined
    let count: Promise<Awaited<ReturnType<typeof closePhysicalInventoryCount>>> | undefined
    const gateTransaction = gateClient.begin(async (gateTx) => {
      await gateTx`SELECT pg_advisory_xact_lock(${physicalInventoryGateKey})`
      gateLocked.resolve()
      await releaseGate.promise
    })

    try {
      await gateLocked.promise
      preflight = getTestDb().transaction(async (tx) => {
        const worksite = await lockActiveEppStockWorksite(tx, worksiteId, "no key update")
        preflightLocked.resolve()
        await beginPreflightRead.promise
        return await readEppStockAvailabilityForLockedWorksite(tx, {
          worksite,
          items: [{ productId: physicalCountProductId, quantity: 3 }],
        })
      })
      await preflightLocked.promise

      // With the correct global worksite → product → stock order this count is
      // stopped at the worksite barrier. The historical product → stock order
      // instead reaches the advisory gate holding the product update lock.
      count = closePhysicalInventoryCount(
        physicalInventorySession,
        {
          worksiteId,
          notes: "Prueba de orden global de bloqueos",
          items: [{ productId: physicalCountProductId, countedQuantity: 7 }],
        },
        [worksiteId],
      )
      await waitForDatabaseLockWait()

      beginPreflightRead.resolve()
      const snapshot = await resolveWithin(preflight, "El preflight final quedó esperando el producto del conteo")
      expect(snapshot.snapshot.lines).toEqual([expect.objectContaining({
        productId: physicalCountProductId,
        requestedQuantity: 3,
        availableQuantity: 8,
      })])

      // Once the preflight commits, the count reaches this trigger before it
      // applies its adjustment. Holding it here makes the old opposite order
      // deterministic: it would wait for the worksite while the preflight
      // waits for its product.
      await waitForDatabaseLockWait()
      releaseGate.resolve()
      await gateTransaction

      if (!count) throw new Error("El conteo físico no se inició")
      await expect(resolveWithin(count, "El conteo físico quedó bloqueado después del preflight")).resolves.toMatchObject({
        adjustmentCount: 1,
      })
    } finally {
      beginPreflightRead.resolve()
      releaseGate.resolve()
      await Promise.allSettled([
        preflight ?? Promise.resolve(),
        count ?? Promise.resolve(),
        gateTransaction,
      ])
      await gateClient.end()
      await removePhysicalInventoryGate()
    }
  })

  it("keeps a positive ingreso behind the physical count's worksite barrier before an absent balance is created", async () => {
    await installPhysicalInventoryGate()
    const gateClient = postgres(databaseUrl!, { max: 1 })
    const gateLocked = deferred<void>()
    const releaseGate = deferred<void>()
    let count: Promise<Awaited<ReturnType<typeof closePhysicalInventoryCount>>> | undefined
    let ingreso: Promise<number> | undefined
    const gateTransaction = gateClient.begin(async (gateTx) => {
      await gateTx`SELECT pg_advisory_xact_lock(${physicalInventoryGateKey})`
      gateLocked.resolve()
      await releaseGate.promise
    })

    try {
      await gateLocked.promise
      count = closePhysicalInventoryCount(
        physicalInventorySession,
        {
          worksiteId,
          notes: "Conteo sobre saldo inexistente antes de ingreso concurrente",
          items: [{ productId: physicalCountAbsentStockProductId, countedQuantity: 4 }],
        },
        [worksiteId],
      )

      // The count now owns worksites FOR NO KEY UPDATE and is stopped by the
      // test-only count-item trigger after it read the absent balance. A real
      // ingreso starts with worksites FOR SHARE, so observing its own waiting
      // SELECT proves it did not progress to a speculative stock upsert.
      await waitForDatabaseLockWait()
      ingreso = applyMovement({
        worksiteId,
        productId: physicalCountAbsentStockProductId,
        type: "ingreso_oc",
        quantity: 2,
        performedBy: userId,
        userEmail: "epp-concurrency@test.local",
        referenceType: "test_ingreso_during_physical_count",
      })
      await waitForWaitingWorksiteShareLock()

      releaseGate.resolve()
      await gateTransaction

      if (!count || !ingreso) throw new Error("La carrera de conteo e ingreso no se inició")
      await expect(resolveWithin(count, "El conteo físico quedó bloqueado al liberar su barrera")).resolves.toMatchObject({
        adjustmentCount: 1,
      })
      await expect(resolveWithin(ingreso, "El ingreso quedó bloqueado después del conteo físico")).resolves.toBe(6)

      const [stock] = await getTestDb()
        .select({ quantity: schema.worksiteStock.quantity })
        .from(schema.worksiteStock)
        .where(eq(schema.worksiteStock.productId, physicalCountAbsentStockProductId))
      expect(stock).toEqual({ quantity: 6 })
    } finally {
      releaseGate.resolve()
      await Promise.allSettled([
        count ?? Promise.resolve(),
        ingreso ?? Promise.resolve(),
        gateTransaction,
      ])
      await gateClient.end()
      await removePhysicalInventoryGate()
    }
  })

  it("locks physical-count products in PostgreSQL order before a later product lock can wait", async () => {
    const orderedProductIds = [dbOrderedHyphenProductId, dbOrderedUnderscoreProductId]
    const dbOrderedProducts = await getTestDb()
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(inArray(schema.products.id, orderedProductIds))
      .orderBy(asc(schema.products.id))
    const dbOrder = dbOrderedProducts.map((product) => product.id)
    const javaScriptOrder = [...orderedProductIds].sort((left, right) => left.localeCompare(right))
    expect(dbOrder).toEqual([dbOrderedHyphenProductId, dbOrderedUnderscoreProductId])
    expect(javaScriptOrder).toEqual([dbOrderedUnderscoreProductId, dbOrderedHyphenProductId])

    const gateClient = postgres(databaseUrl!, { max: 1 })
    const gateLocked = deferred<void>()
    const releaseGate = deferred<void>()
    let count: Promise<Awaited<ReturnType<typeof closePhysicalInventoryCount>>> | undefined
    let firstProductProbe: Promise<unknown> | undefined
    const gateTransaction = gateClient.begin(async (gateTx) => {
      // Hold the second product in database order. The new single ordered
      // product query therefore owns the first row while it waits here. The
      // historical JS localeCompare loop instead waited on this row first and
      // never locked the first one, enabling an opposite-order cross-faena
      // deadlock with an EPP preflight.
      await gateTx`SELECT id FROM products WHERE id = ${dbOrderedUnderscoreProductId} FOR UPDATE`
      gateLocked.resolve()
      await releaseGate.promise
    })

    try {
      await gateLocked.promise
      count = closePhysicalInventoryCount(
        physicalInventorySession,
        {
          worksiteId: otherWorksiteId,
          notes: "Orden SQL de productos entre faenas",
          items: [
            { productId: dbOrderedHyphenProductId, countedQuantity: 0 },
            { productId: dbOrderedUnderscoreProductId, countedQuantity: 0 },
          ],
        },
        [otherWorksiteId],
      )
      await waitForDatabaseLockWait()

      // This second worksite is deliberately different: only the global
      // product lock can serialize this probe. It must wait because the count
      // already locked the first database-ordered product before blocking on
      // the second one above.
      firstProductProbe = getTestDb().transaction(async (tx) => {
        return await tx
          .select({ id: schema.products.id })
          .from(schema.products)
          .where(eq(schema.products.id, dbOrderedHyphenProductId))
          .for("share")
          .limit(1)
      })
      await waitForDatabaseLockWait(2)

      releaseGate.resolve()
      await gateTransaction

      if (!count || !firstProductProbe) throw new Error("La carrera de orden de productos no se inició")
      await expect(resolveWithin(count, "El conteo físico no liberó los productos ordenados")).resolves.toMatchObject({
        adjustmentCount: 0,
      })
      await expect(resolveWithin(firstProductProbe, "El probe del primer producto quedó bloqueado")).resolves.toHaveLength(1)
    } finally {
      releaseGate.resolve()
      await Promise.allSettled([
        count ?? Promise.resolve(),
        firstProductProbe ?? Promise.resolve(),
        gateTransaction,
      ])
      await gateClient.end()
    }
  })

  it("orders multi-product catalog writers before an EPP preflight-style shared lock", async () => {
    const gateClient = postgres(databaseUrl!, { max: 1 })
    const gateLocked = deferred<void>()
    const releaseGate = deferred<void>()
    let writer: Promise<Set<string>> | undefined
    let preflightProductProbe: Promise<unknown> | undefined
    const gateTransaction = gateClient.begin(async (gateTx) => {
      await gateTx`SELECT id FROM products WHERE id = ${dbOrderedUnderscoreProductId} FOR UPDATE`
      gateLocked.resolve()
      await releaseGate.promise
    })

    try {
      await gateLocked.promise
      // EPP import, catalog XLSX import and the bulk active toggle all use
      // this helper before updating their multi-product targets. Holding the
      // second database-ordered target exposes whether it locks the first one
      // before waiting, independently of the UI/import parser that invoked it.
      writer = getTestDb().transaction(async (tx) => {
        return await lockCatalogProductsForUpdateTx(tx, [
          dbOrderedHyphenProductId,
          dbOrderedUnderscoreProductId,
        ])
      })
      await waitForDatabaseLockWait()

      // This is the same shared catalog lock mode used by final EPP
      // preflight. A writer that followed JavaScript locale ordering would be
      // waiting on '_' first and this probe would pass; the PostgreSQL-ordered
      // helper holds '-' while it waits on '_'.
      preflightProductProbe = getTestDb().transaction(async (tx) => {
        return await tx
          .select({ id: schema.products.id })
          .from(schema.products)
          .where(eq(schema.products.id, dbOrderedHyphenProductId))
          .for("share")
          .limit(1)
      })
      await waitForDatabaseLockWait(2)

      releaseGate.resolve()
      await gateTransaction

      if (!writer || !preflightProductProbe) throw new Error("La carrera de importación y preflight no se inició")
      await expect(resolveWithin(writer, "El escritor de catálogo no liberó sus bloqueos ordenados")).resolves.toEqual(new Set([
        dbOrderedHyphenProductId,
        dbOrderedUnderscoreProductId,
      ]))
      await expect(resolveWithin(preflightProductProbe, "El preflight quedó bloqueado después del escritor")).resolves.toHaveLength(1)
    } finally {
      releaseGate.resolve()
      await Promise.allSettled([
        writer ?? Promise.resolve(),
        preflightProductProbe ?? Promise.resolve(),
        gateTransaction,
      ])
      await gateClient.end()
    }
  })
})

function getTestDb() {
  if (!testDb) throw new Error("Postgres test DB was not initialized")
  return testDb
}

async function seedFixture(db: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await db.insert(schema.users).values({
    id: userId,
    name: "EPP concurrency",
    email: "epp-concurrency@test.local",
    hashedPassword: "hash",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.worksites).values({
    id: worksiteId,
    name: "Faena concurrencia EPP",
    code: "EPP-CONC",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.worksites).values({
    id: otherWorksiteId,
    name: "Faena secundaria de concurrencia EPP",
    code: "EPP-CONC-2",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.productCategories).values({
    id: "cat-epp-request-concurrency",
    name: "EPP concurrencia",
    slug: "epp-request-concurrency",
    isEpp: true,
  })
  await db.insert(schema.products).values({
    id: productId,
    sku: "EPP-REQUEST-CONCURRENCY",
    name: "Casco concurrencia EPP",
    categoryId: "cat-epp-request-concurrency",
    unitOfMeasure: "unidad",
    isEpp: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.products).values({
    id: physicalCountAbsentStockProductId,
    sku: "EPP-REQUEST-PHYSICAL-COUNT-ABSENT",
    name: "Protector sin saldo para conteo",
    categoryId: "cat-epp-request-concurrency",
    unitOfMeasure: "unidad",
    isEpp: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.products).values({
    id: dbOrderedHyphenProductId,
    sku: "EPP-REQUEST-PRODUCT-LOCK-A-HYPHEN",
    name: "Producto con guion para orden SQL",
    categoryId: "cat-epp-request-concurrency",
    unitOfMeasure: "unidad",
    isEpp: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.products).values({
    id: dbOrderedUnderscoreProductId,
    sku: "EPP-REQUEST-PRODUCT-LOCK-A-UNDERSCORE",
    name: "Producto con guion bajo para orden SQL",
    categoryId: "cat-epp-request-concurrency",
    unitOfMeasure: "unidad",
    isEpp: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.products).values({
    id: zeroStockProductId,
    sku: "EPP-REQUEST-ZERO-STOCK",
    name: "Lente sin stock",
    categoryId: "cat-epp-request-concurrency",
    unitOfMeasure: "unidad",
    isEpp: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.products).values({
    id: absentStockProductId,
    sku: "EPP-REQUEST-ABSENT-STOCK",
    name: "Guante sin fila de stock",
    categoryId: "cat-epp-request-concurrency",
    unitOfMeasure: "unidad",
    isEpp: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.products).values({
    id: physicalCountProductId,
    sku: "EPP-REQUEST-PHYSICAL-COUNT",
    name: "Protector auditado en conteo",
    categoryId: "cat-epp-request-concurrency",
    unitOfMeasure: "unidad",
    isEpp: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.worksiteStock).values({
    id: "stock-epp-request-concurrency",
    worksiteId,
    productId,
    quantity: 8,
    minStock: 0,
    updatedAt: now,
  })
  await db.insert(schema.worksiteStock).values({
    id: "stock-epp-request-physical-count",
    worksiteId,
    productId: physicalCountProductId,
    quantity: 8,
    minStock: 0,
    updatedAt: now,
  })
}

async function resetPublicSchema(url: string) {
  const setupClient = postgres(url, { max: 1 })
  const setupDb = drizzle(setupClient)
  try {
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`)
    await setupDb.execute(sql`CREATE SCHEMA public`)
    await setupDb.execute(sql`CREATE SCHEMA drizzle`)
    await setupDb.execute(sql`GRANT ALL ON SCHEMA public TO PUBLIC`)
  } finally {
    await setupClient.end()
  }
}

async function ensureDatabaseExists(url: string) {
  const databaseName = getDatabaseNameFromUrl(url)
  const maintenanceClient = postgres(getMaintenanceDatabaseUrl(url), { max: 1 })
  try {
    const rows = await maintenanceClient<{ exists: number }[]>`
      select 1 as exists from pg_database where datname = ${databaseName} limit 1
    `
    if (rows.length === 0) {
      await maintenanceClient.unsafe(`CREATE DATABASE ${quotePostgresIdentifier(databaseName)}`)
    }
  } finally {
    await maintenanceClient.end()
  }
}

/**
 * The test database is isolated, so a PostgreSQL lock wait is a deterministic
 * signal that applyMovement reached its worksite FOR SHARE and is blocked by
 * the final request barrier. The deadline only guards a stalled test runner.
 */
async function waitForDatabaseLockWait(minimumWaiters = 1, timeoutMs = 2_000): Promise<void> {
  if (!client) throw new Error("Postgres test client was not initialized")
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const [row] = await client<{ waiting: string }[]>`
      SELECT count(*)::text AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
    `
    if (Number(row?.waiting ?? 0) >= minimumWaiters) return
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Nunca hubo ${minimumWaiters} espera(s) de bloqueo concurrente(s) en PostgreSQL`)
}

async function waitForWaitingWorksiteShareLock(timeoutMs = 2_000): Promise<void> {
  if (!client) throw new Error("Postgres test client was not initialized")
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const rows = await client<{ query: string }[]>`
      SELECT query
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
    `
    if (rows.some((row) => /from\s+"worksites"[\s\S]*for\s+share/i.test(row.query))) return
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
  }
  throw new Error("El ingreso no quedó esperando su SELECT FOR SHARE de la faena")
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((currentResolve) => { resolve = currentResolve })
  return { promise, resolve }
}

async function resolveWithin<T>(promise: Promise<T>, message: string, timeoutMs = 2_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function installPhysicalInventoryGate() {
  if (!client) throw new Error("Postgres test client was not initialized")
  await client.unsafe(`DROP TRIGGER IF EXISTS ${physicalInventoryGateTrigger} ON physical_inventory_count_items`)
  await client.unsafe(`
    CREATE OR REPLACE FUNCTION ${physicalInventoryGateFunction}()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock(${physicalInventoryGateKey});
      RETURN NEW;
    END;
    $$
  `)
  await client.unsafe(`
    CREATE TRIGGER ${physicalInventoryGateTrigger}
    BEFORE INSERT ON physical_inventory_count_items
    FOR EACH ROW
    EXECUTE FUNCTION ${physicalInventoryGateFunction}()
  `)
}

async function removePhysicalInventoryGate() {
  if (!client) return
  await client.unsafe(`DROP TRIGGER IF EXISTS ${physicalInventoryGateTrigger} ON physical_inventory_count_items`)
  await client.unsafe(`DROP FUNCTION IF EXISTS ${physicalInventoryGateFunction}()`)
}
