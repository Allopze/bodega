/**
 * Ciclo de vida de un pago contra Postgres real (PGlite).
 *
 * Lo que se prueba acá es la regla central del módulo: **una sugerencia no es un
 * cobro**. Solo la confirmación humana mueve el saldo, la reversión lo devuelve,
 * y un movimiento bancario no se puede sobregirar entre varias facturas.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en runtime
testGlobal.__db = inMemoryDb

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const serviceDb = inMemoryDb as unknown as typeof import("@/db").db

const { recomputeInvoicePaymentStatus } = await import("../invoices")
const { generatePaymentSuggestions, recomputeTransactionAllocation, assertAllocationFits } =
  await import("../reconciliation")
const { getCollectionsView } = await import("../collections")

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const CONFIRMER = "u-finanzas"

beforeEach(async () => {
  await inMemoryDb.delete(schema.billingInvoicePayments)
  await inMemoryDb.delete(schema.billingBankTransactions)
  await inMemoryDb.delete(schema.billingInvoiceLinks)
  await inMemoryDb.delete(schema.billingInvoiceEvents)
  await inMemoryDb.delete(schema.billingInvoices)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: CONFIRMER, name: "Finanzas", email: "fin@test", hashedPassword: "x", isActive: true,
  })
  await inMemoryDb.insert(schema.billingInvoices).values([
    {
      id: "inv-1", direction: "sale", docType: "33", folio: 1234,
      issuerTaxId: "78023530-6", issuerName: "CHOME",
      receiverTaxId: "76543210-K", receiverName: "MINERA EJEMPLO SPA",
      issueDate: "2026-07-15", dueDate: "2026-08-14",
      currency: "CLP", totalAmount: 1000000, paidAmount: 0,
      documentStatus: "accepted", paymentStatus: "unpaid", source: "factura_en_linea",
    },
    {
      id: "inv-2", direction: "sale", docType: "33", folio: 1235,
      issuerTaxId: "78023530-6", issuerName: "CHOME",
      receiverTaxId: "76543210-K", receiverName: "MINERA EJEMPLO SPA",
      issueDate: "2026-07-16", dueDate: "2026-08-15",
      currency: "CLP", totalAmount: 500000, paidAmount: 0,
      documentStatus: "accepted", paymentStatus: "unpaid", source: "factura_en_linea",
    },
  ])
})

async function insertTransaction(overrides: Partial<typeof schema.billingBankTransactions.$inferInsert> = {}) {
  const values = {
    id: "tx-1",
    provider: "manual" as const,
    externalId: "manual:tx-1",
    transactionDate: "2026-08-14",
    amount: 1000000,
    currency: "CLP",
    description: "TRANSFERENCIA MINERA EJEMPLO",
    counterpartyName: "MINERA EJEMPLO SPA",
    counterpartyTaxId: "76543210-K",
    accountRef: "****4321",
    allocatedAmount: 0,
    payloadHash: "hash-1",
    ...overrides,
  }
  await inMemoryDb.insert(schema.billingBankTransactions).values(values)
  return values
}

describe("generación de sugerencias", () => {
  it("crea sugerencias que NO mueven el saldo de la factura", async () => {
    await insertTransaction()
    const result = await generatePaymentSuggestions({ direction: "sale" })

    expect(result.suggestionsCreated).toBeGreaterThan(0)

    const payments = await inMemoryDb.select().from(schema.billingInvoicePayments)
    expect(payments.every((payment) => payment.verificationStatus === "suggested")).toBe(true)

    const [invoice] = await inMemoryDb.select().from(schema.billingInvoices)
      .where(eq(schema.billingInvoices.id, "inv-1"))
    expect(invoice!.paidAmount).toBe(0)
    expect(invoice!.paymentStatus).toBe("unpaid")
  })

  it("es idempotente: correrla dos veces no duplica sugerencias", async () => {
    await insertTransaction()
    const first = await generatePaymentSuggestions({ direction: "sale" })
    const second = await generatePaymentSuggestions({ direction: "sale" })

    expect(second.suggestionsCreated).toBe(0)
    expect(second.suggestionsSkipped).toBeGreaterThanOrEqual(first.suggestionsCreated)

    const payments = await inMemoryDb.select().from(schema.billingInvoicePayments)
    expect(payments).toHaveLength(first.suggestionsCreated)
  })

  it("una sugerencia descartada no vuelve a proponerse", async () => {
    await insertTransaction()
    await generatePaymentSuggestions({ direction: "sale" })

    await inMemoryDb.update(schema.billingInvoicePayments)
      .set({ verificationStatus: "rejected", rejectedBy: CONFIRMER, rejectedAt: new Date().toISOString() })

    const rerun = await generatePaymentSuggestions({ direction: "sale" })
    expect(rerun.suggestionsCreated).toBe(0)
  })

  it("registra el evento de sugerencia con su evidencia", async () => {
    await insertTransaction()
    await generatePaymentSuggestions({ direction: "sale" })

    const events = await inMemoryDb.select().from(schema.billingInvoiceEvents)
    const suggested = events.filter((event) => event.eventType === "payment.suggested")
    expect(suggested.length).toBeGreaterThan(0)
    expect(suggested[0]!.actorKind).toBe("system")
    expect((suggested[0]!.detail as { evidence: string[] }).evidence.length).toBeGreaterThan(0)
  })

  it("sin movimientos bancarios no propone nada y lo informa", async () => {
    const result = await generatePaymentSuggestions({ direction: "sale" })
    expect(result.transactionsConsidered).toBe(0)
    expect(result.suggestionsCreated).toBe(0)
  })
})

describe("confirmación y reversión", () => {
  async function confirmPayment(paymentId: string, amount?: number) {
    const now = new Date().toISOString()
    await inMemoryDb.update(schema.billingInvoicePayments).set({
      verificationStatus: "confirmed",
      confirmedBy: CONFIRMER,
      confirmedAt: now,
      ...(amount !== undefined ? { amount } : {}),
    }).where(eq(schema.billingInvoicePayments.id, paymentId))
  }

  it("confirmar mueve el saldo; revertir lo devuelve", async () => {
    await inMemoryDb.insert(schema.billingInvoicePayments).values({
      id: "pay-1", invoiceId: "inv-1", paymentDate: "2026-08-14",
      amount: 1000000, currency: "CLP", verificationStatus: "suggested",
    })

    expect((await recomputeInvoicePaymentStatus(serviceDb, "inv-1")).paymentStatus).toBe("unpaid")

    await confirmPayment("pay-1")
    const afterConfirm = await recomputeInvoicePaymentStatus(serviceDb, "inv-1")
    expect(afterConfirm.paymentStatus).toBe("paid")
    expect(afterConfirm.outstandingAmount).toBe(0)

    await inMemoryDb.update(schema.billingInvoicePayments)
      .set({ verificationStatus: "rejected", confirmedBy: null, confirmedAt: null })
      .where(eq(schema.billingInvoicePayments.id, "pay-1"))
    const afterRevert = await recomputeInvoicePaymentStatus(serviceDb, "inv-1")
    expect(afterRevert.paymentStatus).toBe("unpaid")
    expect(afterRevert.paidAmount).toBe(0)
  })

  it("dos pagos parciales confirmados cierran la factura", async () => {
    await inMemoryDb.insert(schema.billingInvoicePayments).values([
      { id: "pay-a", invoiceId: "inv-1", paymentDate: "2026-08-10", amount: 400000, currency: "CLP", verificationStatus: "suggested" },
      { id: "pay-b", invoiceId: "inv-1", paymentDate: "2026-08-20", amount: 600000, currency: "CLP", verificationStatus: "suggested" },
    ])

    await confirmPayment("pay-a")
    expect((await recomputeInvoicePaymentStatus(serviceDb, "inv-1")).paymentStatus).toBe("partial")

    await confirmPayment("pay-b")
    expect((await recomputeInvoicePaymentStatus(serviceDb, "inv-1")).paymentStatus).toBe("paid")
  })

  it("la base rechaza un pago confirmado sin autor", async () => {
    await expect(
      inMemoryDb.insert(schema.billingInvoicePayments).values({
        id: "pay-x", invoiceId: "inv-1", paymentDate: "2026-08-14",
        amount: 1000, currency: "CLP", verificationStatus: "confirmed",
      }),
    ).rejects.toThrow()
  })

  it("la base impide imputar dos veces el mismo movimiento a la misma factura", async () => {
    await insertTransaction()
    await inMemoryDb.insert(schema.billingInvoicePayments).values({
      id: "pay-1", invoiceId: "inv-1", bankTransactionId: "tx-1",
      paymentDate: "2026-08-14", amount: 500000, currency: "CLP", verificationStatus: "suggested",
    })

    await expect(
      inMemoryDb.insert(schema.billingInvoicePayments).values({
        id: "pay-2", invoiceId: "inv-1", bankTransactionId: "tx-1",
        paymentDate: "2026-08-14", amount: 500000, currency: "CLP", verificationStatus: "suggested",
      }),
    ).rejects.toThrow()
  })
})

describe("un movimiento repartido entre varias facturas", () => {
  it("se imputa a dos facturas sin sobregirarse", async () => {
    await insertTransaction({ amount: 1200000 })

    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.billingInvoicePayments).values([
      {
        id: "pay-1", invoiceId: "inv-1", bankTransactionId: "tx-1", paymentDate: "2026-08-14",
        amount: 1000000, currency: "CLP", verificationStatus: "confirmed", confirmedBy: CONFIRMER, confirmedAt: now,
      },
      {
        id: "pay-2", invoiceId: "inv-2", bankTransactionId: "tx-1", paymentDate: "2026-08-14",
        amount: 200000, currency: "CLP", verificationStatus: "confirmed", confirmedBy: CONFIRMER, confirmedAt: now,
      },
    ])

    const allocated = await recomputeTransactionAllocation(serviceDb, "tx-1")
    expect(allocated).toBe(1200000)

    expect((await recomputeInvoicePaymentStatus(serviceDb, "inv-1")).paymentStatus).toBe("paid")
    expect((await recomputeInvoicePaymentStatus(serviceDb, "inv-2")).paymentStatus).toBe("partial")
  })

  it("la guarda impide imputar más de lo disponible", async () => {
    const transaction = await insertTransaction({ amount: 1000000, allocatedAmount: 800000 })
    expect(() => assertAllocationFits(transaction.amount, transaction.allocatedAmount, 300000))
      .toThrow(/disponibles/i)
    expect(() => assertAllocationFits(transaction.amount, transaction.allocatedAmount, 200000))
      .not.toThrow()
  })

  it("revertir una imputación libera el movimiento", async () => {
    await insertTransaction({ amount: 1000000 })
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.billingInvoicePayments).values({
      id: "pay-1", invoiceId: "inv-1", bankTransactionId: "tx-1", paymentDate: "2026-08-14",
      amount: 1000000, currency: "CLP", verificationStatus: "confirmed", confirmedBy: CONFIRMER, confirmedAt: now,
    })
    expect(await recomputeTransactionAllocation(serviceDb, "tx-1")).toBe(1000000)

    await inMemoryDb.update(schema.billingInvoicePayments)
      .set({ verificationStatus: "rejected", confirmedBy: null, confirmedAt: null })
      .where(eq(schema.billingInvoicePayments.id, "pay-1"))

    expect(await recomputeTransactionAllocation(serviceDb, "tx-1")).toBe(0)
  })
})

describe("vista de cobranza", () => {
  function globalSession() {
    return {
      user: { id: CONFIRMER, name: "Finanzas", email: "fin@test", permissions: [], roles: [], worksiteIds: [], isGlobal: true },
      expires: "2099-01-01",
    } as unknown as Parameters<typeof getCollectionsView>[0]
  }

  it("agrupa las facturas por situación y suma el saldo por moneda", async () => {
    const view = await getCollectionsView(globalSession())
    expect(view.rows).toHaveLength(2)
    expect(view.totalOutstanding).toEqual([{ currency: "CLP", amount: 1500000 }])

    const totalInBuckets = view.buckets.reduce((sum, bucket) => sum + bucket.count, 0)
    expect(totalInBuckets).toBe(view.rows.length)
  })

  it("cuenta las sugerencias pendientes por factura sin contarlas como cobro", async () => {
    await insertTransaction()
    await generatePaymentSuggestions({ direction: "sale" })

    const view = await getCollectionsView(globalSession())
    const withSuggestions = view.rows.filter((row) => row.suggestedPayments > 0)
    expect(withSuggestions.length).toBeGreaterThan(0)
    expect(withSuggestions.every((row) => row.paidAmount === 0)).toBe(true)
  })

  it("excluye las anuladas del saldo por cobrar", async () => {
    await inMemoryDb.update(schema.billingInvoices)
      .set({ documentStatus: "void" })
      .where(eq(schema.billingInvoices.id, "inv-2"))

    const view = await getCollectionsView(globalSession())
    expect(view.rows).toHaveLength(1)
    expect(view.totalOutstanding).toEqual([{ currency: "CLP", amount: 1000000 }])
  })
})
