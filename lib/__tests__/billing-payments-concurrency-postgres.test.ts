/**
 * Concurrencia de confirmación de pagos contra Postgres real.
 *
 * H-01 (AUDITORIA_BUGS_2026-08-05.md): `resolvePaymentSuggestionAction` leía
 * el movimiento bancario sin `FOR UPDATE` antes de validar el saldo
 * disponible — dos confirmaciones concurrentes sobre el mismo movimiento
 * podían pasar ambas la validación y una pisaba el `allocated_amount` de la
 * otra. Este test prueba `confirmPaymentSuggestion` directo (no la Server
 * Action, que exige sesión/`guardPermission`) con el mismo patrón que
 * `receiving-concurrency-postgres.test.ts`: dos transacciones simultáneas de
 * verdad, no secuenciales.
 *
 * Requiere Postgres real.
 * Gate: BILLING_PAYMENTS_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET=true
 */
import path from "node:path"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq, sql } from "drizzle-orm"
import * as schema from "@/db/schema"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"

const databaseUrl = process.env.BILLING_PAYMENTS_CONCURRENCY_DATABASE_URL ?? process.env.DATABASE_URL
const canResetDatabase = process.env.BILLING_PAYMENTS_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip

let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

describeIf("billing payment confirmation concurrency on real Postgres", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "BILLING_PAYMENTS_CONCURRENCY",
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

    const globalWithDb = globalThis as typeof globalThis & {
      __db?: ReturnType<typeof drizzle<typeof schema>>
    }
    globalWithDb.__db = undefined
    process.env.DATABASE_URL = databaseUrl
    vi.resetModules()
  })

  afterAll(async () => {
    const globalWithDb = globalThis as typeof globalThis & { __db?: unknown }
    globalWithDb.__db = undefined
    await client?.end()
  })

  it("allows only one concurrent confirmation when combined amount exceeds the bank transaction balance", async () => {
    const db = getTestDb()
    const f = await seedBillingPaymentsConcurrencyFixture(db, "a")

    const { confirmPaymentSuggestion } = await import("@/lib/services/billing/reconciliation")

    const confirm = (paymentId: string) =>
      db.transaction((tx) =>
        confirmPaymentSuggestion(tx, {
          paymentId,
          bankTransactionId: f.bankTransactionId,
          finalAmount: 1000000,
          actorUserId: f.userId,
          now: new Date().toISOString(),
        }),
      )

    const results = await Promise.allSettled([confirm(f.paymentId1), confirm(f.paymentId2)])

    const fulfilled = results.filter((result) => result.status === "fulfilled")
    const rejected = results.filter((result) => result.status === "rejected")
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    // El movimiento nunca queda sobregirado: exactamente el monto de la
    // confirmación que ganó la carrera, nunca la suma de las dos.
    const [transaction] = await db
      .select({
        amount: schema.billingBankTransactions.amount,
        allocatedAmount: schema.billingBankTransactions.allocatedAmount,
      })
      .from(schema.billingBankTransactions)
      .where(eq(schema.billingBankTransactions.id, f.bankTransactionId))
    expect(transaction!.allocatedAmount).toBe(1000000)
    expect(transaction!.allocatedAmount).toBeLessThanOrEqual(transaction!.amount)

    const payments = await db.select().from(schema.billingInvoicePayments)
      .where(eq(schema.billingInvoicePayments.bankTransactionId, f.bankTransactionId))
    expect(payments.filter((payment) => payment.verificationStatus === "confirmed")).toHaveLength(1)
    expect(payments.filter((payment) => payment.verificationStatus === "suggested")).toHaveLength(1)
  })

  it("serializes confirm and revert on the same bank transaction lock", async () => {
    const db = getTestDb()
    const f = await seedBillingPaymentsConcurrencyFixture(db, "b")

    const { confirmPaymentSuggestion, revertConfirmedPayment } = await import("@/lib/services/billing/reconciliation")

    // pay-1 ya está confirmado antes de la carrera: la carrera es entre
    // revertirlo y confirmar pay-2 sobre el mismo movimiento.
    await db.transaction((tx) =>
      confirmPaymentSuggestion(tx, {
        paymentId: f.paymentId1,
        bankTransactionId: f.bankTransactionId,
        finalAmount: 1000000,
        actorUserId: f.userId,
        now: new Date().toISOString(),
      }),
    )

    const results = await Promise.allSettled([
      db.transaction((tx) =>
        revertConfirmedPayment(tx, {
          paymentId: f.paymentId1,
          bankTransactionId: f.bankTransactionId,
          reason: "Prueba de concurrencia",
          actorUserId: f.userId,
          now: new Date().toISOString(),
        }),
      ),
      db.transaction((tx) =>
        confirmPaymentSuggestion(tx, {
          paymentId: f.paymentId2,
          bankTransactionId: f.bankTransactionId,
          finalAmount: 1000000,
          actorUserId: f.userId,
          now: new Date().toISOString(),
        }),
      ),
    ])

    // Ambas son válidas individualmente (revertir libera saldo, confirmar lo
    // toma), pero cuál sobrevive depende de quién gane el lock de fila:
    //
    //   revertir primero → libera el saldo y el confirm entra: las dos cumplen.
    //   confirmar primero → el segundo pago de 1M excedería el saldo del
    //                       movimiento y se rechaza, que es exactamente lo que
    //                       debe pasar.
    //
    // Exigir que NINGUNA rechace convertía una serialización correcta en un
    // rojo que salía cara o sello (verde en local, rojo en CI). Lo que este
    // test defiende —el punto que H-01 dejaba roto— es la invariante de abajo:
    // el saldo imputado refleja exactamente la suma de lo confirmado, gane
    // quien gane.
    expect(results.some((result) => result.status === "fulfilled")).toBe(true)

    const [transaction] = await db
      .select({ allocatedAmount: schema.billingBankTransactions.allocatedAmount })
      .from(schema.billingBankTransactions)
      .where(eq(schema.billingBankTransactions.id, f.bankTransactionId))
    const payments = await db.select().from(schema.billingInvoicePayments)
      .where(eq(schema.billingInvoicePayments.bankTransactionId, f.bankTransactionId))
    const confirmedTotal = payments
      .filter((payment) => payment.verificationStatus === "confirmed")
      .reduce((sum, payment) => sum + payment.amount, 0)
    expect(transaction!.allocatedAmount).toBe(confirmedTotal)
  })
})

function getTestDb() {
  if (!testDb) throw new Error("Postgres test DB was not initialized")
  return testDb
}

/**
 * Fixture con IDs sufijados por `tag` para que cada `it` corra sobre datos
 * propios sin necesitar limpieza entre tests (no hay `beforeEach`: cada test
 * de este archivo corre una sola vez y su fixture nunca se reutiliza).
 */
async function seedBillingPaymentsConcurrencyFixture(db: ReturnType<typeof drizzle<typeof schema>>, tag: string) {
  const now = new Date().toISOString()
  const userId = "user-billing-conc-test"
  const bankTransactionId = `btx-conc-test-${tag}`
  const invoiceId1 = `inv-conc-${tag}-1`
  const invoiceId2 = `inv-conc-${tag}-2`
  const paymentId1 = `pay-conc-${tag}-1`
  const paymentId2 = `pay-conc-${tag}-2`

  // El usuario técnico se comparte entre los `it` de este archivo.
  await db.insert(schema.users).values({
    id: userId,
    name: "Billing Payments Concurrency",
    email: "billing-payments-concurrency@test.local",
    hashedPassword: "hash",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing()

  await db.insert(schema.billingBankTransactions).values({
    id: bankTransactionId,
    provider: "manual",
    externalId: `${bankTransactionId}-ext`,
    transactionDate: "2026-08-01",
    amount: 1000000,
    currency: "CLP",
    allocatedAmount: 0,
    payloadHash: `hash-conc-test-${tag}`,
    syncedAt: now,
    createdAt: now,
  })

  await db.insert(schema.billingInvoices).values([
    {
      id: invoiceId1, direction: "sale", docType: "33", folio: tag === "a" ? 9001 : 9003,
      issuerTaxId: "78023530-6", issuerName: "CHOME",
      receiverTaxId: "76543210-K", receiverName: "Cliente concurrencia 1",
      issueDate: "2026-07-01", currency: "CLP", totalAmount: 1000000,
      documentStatus: "accepted", paymentStatus: "unpaid", source: "manual",
      createdAt: now, updatedAt: now,
    },
    {
      id: invoiceId2, direction: "sale", docType: "33", folio: tag === "a" ? 9002 : 9004,
      issuerTaxId: "78023530-6", issuerName: "CHOME",
      receiverTaxId: "76111111-1", receiverName: "Cliente concurrencia 2",
      issueDate: "2026-07-01", currency: "CLP", totalAmount: 1000000,
      documentStatus: "accepted", paymentStatus: "unpaid", source: "manual",
      createdAt: now, updatedAt: now,
    },
  ])

  await db.insert(schema.billingInvoicePayments).values([
    {
      id: paymentId1, invoiceId: invoiceId1, bankTransactionId,
      paymentDate: "2026-08-01", amount: 1000000, currency: "CLP",
      source: "manual", verificationStatus: "suggested", matchedBy: "auto",
      createdAt: now, updatedAt: now,
    },
    {
      id: paymentId2, invoiceId: invoiceId2, bankTransactionId,
      paymentDate: "2026-08-01", amount: 1000000, currency: "CLP",
      source: "manual", verificationStatus: "suggested", matchedBy: "auto",
      createdAt: now, updatedAt: now,
    },
  ])

  return { userId, bankTransactionId, invoiceId1, invoiceId2, paymentId1, paymentId2 }
}

async function resetPublicSchema(url: string) {
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
