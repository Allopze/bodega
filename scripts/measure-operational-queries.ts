import path from "node:path"
import { performance } from "node:perf_hooks"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { and, asc, count, desc, eq, inArray, sql, sum } from "drizzle-orm"
import { loadEnvConfig } from "@next/env"
import * as schema from "../db/schema"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "../lib/testing/destructive-database-guard"

loadEnvConfig(process.cwd())

const databaseUrl = process.env.PERF_DATABASE_URL ?? "postgres:///bodega_perf_test"
const migrationsFolder = path.resolve(process.cwd(), "db/migrations")
const now = new Date("2026-06-14T12:00:00.000Z").toISOString()
const DEFAULT_SLO_MS = 1_000

async function main() {
  assertSafeDestructiveDatabase({
    databaseUrl,
    allowDestructiveReset: process.env.PERF_ALLOW_DESTRUCTIVE_RESET === "true",
    context: "PERF",
  })
  await ensureDatabaseExists(databaseUrl)
  await resetDatabase(databaseUrl)

  const migrationClient = postgres(databaseUrl, { max: 1 })
  await migrate(drizzle(migrationClient), { migrationsFolder })
  await migrationClient.end()

  const client = postgres(databaseUrl, { max: 10 })
  const db = drizzle(client, { schema })

  try {
    const fixtures = await seedMediumDataset(db)
    const scopedWorksiteIds = fixtures.worksiteIds.slice(0, 6)

    console.log(`Dataset: ${fixtures.requestCount} solicitudes, ${fixtures.itemCount} items, ${fixtures.orderCount} OC, ${fixtures.stockCount} stock rows.`)
    console.log("")
    console.log("| Consulta | Filas/valor | ms |")
    console.log("| --- | ---: | ---: |")

    await measure("compras: total OC scoped", async () => {
      const [row] = await db
        .select({ total: count() })
        .from(schema.purchaseOrders)
        .where(inArray(schema.purchaseOrders.worksiteId, scopedWorksiteIds))
      return row?.total ?? 0
    })

    await measure("compras: pagina OC scoped", async () => {
      const rows = await db
        .select({
          id: schema.purchaseOrders.id,
          code: schema.purchaseOrders.code,
          worksiteId: schema.purchaseOrders.worksiteId,
          supplierId: schema.purchaseOrders.supplierId,
          status: schema.purchaseOrders.status,
          totalAmount: schema.purchaseOrders.totalAmount,
          createdAt: schema.purchaseOrders.createdAt,
        })
        .from(schema.purchaseOrders)
        .where(inArray(schema.purchaseOrders.worksiteId, scopedWorksiteIds))
        .orderBy(desc(schema.purchaseOrders.createdAt))
        .limit(25)
        .offset(25)
      return rows.length
    })

    await measure("aprobaciones: solicitudes con pendientes", async () => {
      const [row] = await db
        .select({ total: count() })
        .from(schema.purchaseRequests)
        .where(and(
          inArray(schema.purchaseRequests.worksiteId, scopedWorksiteIds),
          inArray(schema.purchaseRequests.status, ["submitted", "in_review", "partially_approved"]),
          sql`exists (
            select 1
            from purchase_request_items pending_items
            where pending_items.request_id = ${schema.purchaseRequests.id}
              and pending_items.status = 'requested'
          )`,
        ))
      return row?.total ?? 0
    })

    await measure("aprobaciones: pagina + items", async () => {
      const requests = await db
        .select({ id: schema.purchaseRequests.id, submittedAt: schema.purchaseRequests.submittedAt })
        .from(schema.purchaseRequests)
        .where(and(
          inArray(schema.purchaseRequests.worksiteId, scopedWorksiteIds),
          inArray(schema.purchaseRequests.status, ["submitted", "in_review", "partially_approved"]),
          sql`exists (
            select 1
            from purchase_request_items pending_items
            where pending_items.request_id = ${schema.purchaseRequests.id}
              and pending_items.status = 'requested'
          )`,
        ))
        .orderBy(asc(schema.purchaseRequests.submittedAt))
        .limit(20)
      const requestIds = requests.map((request) => request.id)
      if (requestIds.length === 0) return 0
      const items = await db
        .select({ id: schema.purchaseRequestItems.id })
        .from(schema.purchaseRequestItems)
        .where(and(
          inArray(schema.purchaseRequestItems.requestId, requestIds),
          eq(schema.purchaseRequestItems.status, "requested"),
        ))
      return items.length
    })

    await measure("bodega: stock scoped", async () => {
      const rows = await db.query.worksiteStock.findMany({
        where: (stock, { inArray }) => inArray(stock.worksiteId, scopedWorksiteIds),
        with: { product: true, worksite: true },
        orderBy: (stock, { asc }) => [asc(stock.worksiteId)],
      })
      return rows.length
    })

    await measure("bodega: movimientos recientes scoped", async () => {
      const rows = await db.query.inventoryMovements.findMany({
        where: (movement, { inArray }) => inArray(movement.worksiteId, scopedWorksiteIds),
        with: { product: true, worksite: true },
        orderBy: (movement, { desc }) => [desc(movement.performedAt)],
        limit: 50,
      })
      return rows.length
    })

    await measure("reportes: agregados scoped", async () => {
      const [requests, items, orders] = await Promise.all([
        db.select({ total: count() }).from(schema.purchaseRequests).where(inArray(schema.purchaseRequests.worksiteId, scopedWorksiteIds)),
        db
          .select({ total: count() })
          .from(schema.purchaseRequestItems)
          .innerJoin(schema.purchaseRequests, eq(schema.purchaseRequestItems.requestId, schema.purchaseRequests.id))
          .where(inArray(schema.purchaseRequests.worksiteId, scopedWorksiteIds)),
        db
          .select({ total: count(), totalAmount: sql<number>`coalesce(${sum(schema.purchaseOrders.totalAmount)}, 0)` })
          .from(schema.purchaseOrders)
          .where(inArray(schema.purchaseOrders.worksiteId, scopedWorksiteIds)),
      ])
      return Number(requests[0]?.total ?? 0) + Number(items[0]?.total ?? 0) + Number(orders[0]?.total ?? 0)
    })

    await measure("dashboard: resumen operacional", async () => {
      const [requests, orders, stock, movements] = await Promise.all([
        db.select({ total: count() }).from(schema.purchaseRequests).where(inArray(schema.purchaseRequests.worksiteId, scopedWorksiteIds)),
        db.select({ total: count() }).from(schema.purchaseOrders).where(inArray(schema.purchaseOrders.worksiteId, scopedWorksiteIds)),
        db.select({ total: count() }).from(schema.worksiteStock).where(inArray(schema.worksiteStock.worksiteId, scopedWorksiteIds)),
        db.select({ total: count() }).from(schema.inventoryMovements).where(inArray(schema.inventoryMovements.worksiteId, scopedWorksiteIds)),
      ])
      return Number(requests[0]?.total ?? 0) + Number(orders[0]?.total ?? 0) + Number(stock[0]?.total ?? 0) + Number(movements[0]?.total ?? 0)
    })

    await measure("trazabilidad: matriz scoped", async () => {
      const rows = await db
        .select({
          requestItemId: schema.purchaseRequestItems.id,
          requestCode: schema.purchaseRequests.code,
          productId: schema.purchaseRequestItems.productId,
          worksiteId: schema.purchaseRequests.worksiteId,
          orderedQty: sql<number>`coalesce(sum(${schema.purchaseOrderItems.quantity}), 0)`,
        })
        .from(schema.purchaseRequestItems)
        .innerJoin(schema.purchaseRequests, eq(schema.purchaseRequestItems.requestId, schema.purchaseRequests.id))
        .leftJoin(schema.purchaseOrderItems, eq(schema.purchaseOrderItems.requestItemId, schema.purchaseRequestItems.id))
        .where(inArray(schema.purchaseRequests.worksiteId, scopedWorksiteIds))
        .groupBy(
          schema.purchaseRequestItems.id,
          schema.purchaseRequests.code,
          schema.purchaseRequestItems.productId,
          schema.purchaseRequests.worksiteId,
        )
        .limit(10_000)
      return rows.length
    })

    await measure("analitica: gasto por faena", async () => {
      const rows = await db
        .select({
          worksiteId: schema.purchaseOrders.worksiteId,
          totalAmount: sql<number>`coalesce(${sum(schema.purchaseOrders.totalAmount)}, 0)`,
        })
        .from(schema.purchaseOrders)
        .where(inArray(schema.purchaseOrders.worksiteId, scopedWorksiteIds))
        .groupBy(schema.purchaseOrders.worksiteId)
        .orderBy(desc(sql`coalesce(${sum(schema.purchaseOrders.totalAmount)}, 0)`))
      return rows.length
    })

    await measure("combustibles: cargas por mes", async () => {
      const rows = await db
        .select({
          month: schema.fuelLoads.month,
          liters: sql<number>`coalesce(sum(${schema.fuelLoads.liters}), 0)`,
          totalAmount: sql<number>`coalesce(sum(${schema.fuelLoads.totalAmount}), 0)`,
        })
        .from(schema.fuelLoads)
        .where(inArray(schema.fuelLoads.worksiteId, scopedWorksiteIds))
        .groupBy(schema.fuelLoads.month)
        .orderBy(desc(schema.fuelLoads.month))
      return rows.length
    })
  } finally {
    await client.end()
  }
}

async function seedMediumDataset(db: ReturnType<typeof drizzle<typeof schema>>) {
  const worksiteIds = Array.from({ length: 12 }, (_, index) => `perf-ws-${index + 1}`)
  const productIds = Array.from({ length: 80 }, (_, index) => `perf-prod-${index + 1}`)
  const supplierIds = Array.from({ length: 8 }, (_, index) => `perf-sup-${index + 1}`)
  const requestCount = 1_200
  const itemsPerRequest = 3
  const orderCount = 500

  await db.insert(schema.users).values({
    id: "perf-user",
    name: "Performance User",
    email: "perf@test.local",
    hashedPassword: "hash",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })

  await db.insert(schema.worksites).values(worksiteIds.map((id, index) => ({
    id,
    name: `Faena performance ${index + 1}`,
    code: `PERF-WS-${index + 1}`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })))

  await db.insert(schema.suppliers).values(supplierIds.map((id, index) => ({
    id,
    name: `Proveedor performance ${index + 1}`,
    rut: `PERF-SUP-${index + 1}`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })))

  await db.insert(schema.productCategories).values({
    id: "perf-cat",
    name: "Categoría performance",
    slug: "perf-cat",
  })

  await db.insert(schema.products).values(productIds.map((id, index) => ({
    id,
    sku: `PERF-PROD-${index + 1}`,
    name: `Producto performance ${index + 1}`,
    categoryId: "perf-cat",
    unitOfMeasure: "unidad",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })))

  const requestStatuses = ["submitted", "in_review", "partially_approved", "approved", "closed"]
  await insertChunks(db, schema.purchaseRequests, Array.from({ length: requestCount }, (_, index) => ({
    id: `perf-req-${index + 1}`,
    code: `PERF-SOL-${index + 1}`,
    worksiteId: worksiteIds[index % worksiteIds.length],
    requesterId: "perf-user",
    requestType: "epp",
    urgency: index % 11 === 0 ? "critical" : index % 5 === 0 ? "high" : "normal",
    status: requestStatuses[index % requestStatuses.length],
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
  })))

  const itemStatuses = ["requested", "approved", "pending_purchase", "in_purchase_order", "received"]
  const requestItems = Array.from({ length: requestCount * itemsPerRequest }, (_, index) => {
    const requestIndex = Math.floor(index / itemsPerRequest)
    return {
      id: `perf-item-${index + 1}`,
      requestId: `perf-req-${requestIndex + 1}`,
      productId: productIds[index % productIds.length],
      quantity: (index % 5) + 1,
      unitOfMeasure: "unidad",
      status: itemStatuses[index % itemStatuses.length],
      urgency: index % 7 === 0 ? "high" : "normal",
      suggestedSupplierId: supplierIds[index % supplierIds.length],
      sortOrder: index % itemsPerRequest,
      createdAt: now,
      updatedAt: now,
    }
  })
  await insertChunks(db, schema.purchaseRequestItems, requestItems)

  const orderStatuses = ["draft", "issued", "sent", "partially_office_received", "office_received", "partially_received", "received", "closed"]
  await insertChunks(db, schema.purchaseOrders, Array.from({ length: orderCount }, (_, index) => ({
    id: `perf-order-${index + 1}`,
    code: `PERF-OC-${index + 1}`,
    worksiteId: worksiteIds[index % worksiteIds.length],
    supplierId: supplierIds[index % supplierIds.length],
    createdBy: "perf-user",
    status: orderStatuses[index % orderStatuses.length],
    issuedAt: now,
    sentAt: now,
    netAmount: 10_000 + index,
    taxAmount: 1_900,
    totalAmount: 11_900 + index,
    createdAt: now,
    updatedAt: now,
  })))

  await insertChunks(db, schema.purchaseOrderItems, Array.from({ length: orderCount * 2 }, (_, index) => {
    const quantityReceived = index % 6 === 0 ? 3 : 0
    const quantityOfficeReceived = quantityReceived > 0 ? 5 : index % 4 === 0 ? 5 : 0
    return {
      id: `perf-order-item-${index + 1}`,
      purchaseOrderId: `perf-order-${Math.floor(index / 2) + 1}`,
      requestItemId: requestItems[index % requestItems.length]!.id,
      productId: productIds[index % productIds.length],
      quantity: 5,
      unitOfMeasure: "unidad",
      unitPrice: 2_000,
      discount: 0,
      subtotal: 10_000,
      quantityOfficeReceived,
      quantityReceived,
      status: quantityReceived > 0 ? "partially_received" : "issued",
      sortOrder: index % 2,
    }
  }))

  const stockRows = worksiteIds.flatMap((worksiteId) =>
    productIds.slice(0, 50).map((productId, index) => ({
      id: `perf-stock-${worksiteId}-${productId}`,
      worksiteId,
      productId,
      quantity: (index % 20) + 1,
      minStock: index % 9 === 0 ? 8 : 0,
      updatedAt: now,
    })),
  )
  await insertChunks(db, schema.worksiteStock, stockRows)

  await insertChunks(db, schema.inventoryMovements, Array.from({ length: 1_500 }, (_, index) => ({
    id: `perf-movement-${index + 1}`,
    worksiteId: worksiteIds[index % worksiteIds.length],
    productId: productIds[index % productIds.length],
    type: index % 3 === 0 ? "egreso_entrega" : "ingreso_oc",
    quantity: index % 3 === 0 ? -1 : 2,
    stockBefore: 10,
    stockAfter: index % 3 === 0 ? 9 : 12,
    performedBy: "perf-user",
    performedAt: now,
  })))

  await insertChunks(db, schema.fuelSuppliers, supplierIds.map((id, index) => ({
    id: `fuel-${id}`,
    name: `Proveedor combustible ${index + 1}`,
    rut: `PERF-FUEL-${index + 1}`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })))

  await insertChunks(db, schema.fuelVehicles, Array.from({ length: 60 }, (_, index) => ({
    id: `perf-vehicle-${index + 1}`,
    plate: `PERF-${index + 1}`,
    type: index % 3 === 0 ? "camion" : "camioneta",
    brand: "Marca",
    model: `Modelo ${index + 1}`,
    year: 2020 + (index % 5),
    worksiteId: worksiteIds[index % worksiteIds.length],
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })))

  await insertChunks(db, schema.fuelLoads, Array.from({ length: 2_000 }, (_, index) => ({
    id: `perf-fuel-load-${index + 1}`,
    loadDate: `2026-${String((index % 12) + 1).padStart(2, "0")}-15`,
    month: `2026-${String((index % 12) + 1).padStart(2, "0")}`,
    serviceType: index % 2 === 0 ? "TCT" : "TAE",
    vehicleId: `perf-vehicle-${(index % 60) + 1}`,
    fuelSupplierId: `fuel-${supplierIds[index % supplierIds.length]}`,
    worksiteId: worksiteIds[index % worksiteIds.length],
    product: "PETROLEO DIESEL",
    receiptNumber: `PERF-FUEL-${index + 1}`,
    liters: (index % 100) + 10,
    iecFixed: 0,
    iecVariable: 0,
    baseAmount: 10_000 + index,
    iecTotal: 0,
    ivaAmount: 1_900,
    totalAmount: 11_900 + index,
    status: "registered",
    createdBy: "perf-user",
    createdAt: now,
    updatedAt: now,
  })))

  return {
    worksiteIds,
    requestCount,
    itemCount: requestItems.length,
    orderCount,
    stockCount: stockRows.length,
  }
}

async function insertChunks<TTable, TValue>(
  db: ReturnType<typeof drizzle<typeof schema>>,
  table: TTable,
  values: TValue[],
) {
  for (let index = 0; index < values.length; index += 500) {
    await db.insert(table as never).values(values.slice(index, index + 500) as never)
  }
}

async function measure(label: string, fn: () => Promise<number>) {
  const start = performance.now()
  const value = await fn()
  const elapsedMs = performance.now() - start
  console.log(`| ${label} | ${value.toLocaleString("es-CL")} | ${elapsedMs.toFixed(1)} |`)
  if (elapsedMs > DEFAULT_SLO_MS) {
    throw new Error(`PERF SLO exceeded for "${label}": ${elapsedMs.toFixed(1)}ms > ${DEFAULT_SLO_MS}ms`)
  }
}

async function resetDatabase(url: string) {
  const setupClient = postgres(url, { max: 1 })
  const setupDb = drizzle(setupClient)
  try {
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`)
    await setupDb.execute(sql`CREATE SCHEMA public`)
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
      SELECT 1 AS exists FROM pg_database WHERE datname = ${databaseName} LIMIT 1
    `
    if (rows.length === 0) {
      await maintenanceClient.unsafe(`CREATE DATABASE ${quotePostgresIdentifier(databaseName)}`)
    }
  } finally {
    await maintenanceClient.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
