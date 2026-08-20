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

const { recomputeInvoicePaymentStatus, upsertProviderInvoice, BillingExternalReferenceConflict } =
  await import("../invoices")
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

  // H-15 (AUDITORIA_BUGS_2026-08-05.md): descartar y revertir se trataban
  // igual, así que un pago revertido por error de dedo dejaba ese movimiento
  // inimputable contra esa factura para siempre.
  it("un pago revertido SÍ vuelve a proponerse, a diferencia de uno descartado", async () => {
    await insertTransaction()
    await generatePaymentSuggestions({ direction: "sale" })

    const [suggestion] = await inMemoryDb.select().from(schema.billingInvoicePayments)
    await inMemoryDb.update(schema.billingInvoicePayments)
      .set({
        verificationStatus: "reverted",
        rejectedBy: CONFIRMER,
        rejectedAt: new Date().toISOString(),
        rejectionReason: "Confirmé la fila equivocada.",
      })
      .where(eq(schema.billingInvoicePayments.id, suggestion!.id))

    const rerun = await generatePaymentSuggestions({ direction: "sale" })
    expect(rerun.suggestionsCreated).toBeGreaterThan(0)

    // Se reactiva la misma fila (el índice único (factura, movimiento) no
    // admite otra) y conserva la traza de quién revirtió y por qué.
    const payments = await inMemoryDb.select().from(schema.billingInvoicePayments)
      .where(eq(schema.billingInvoicePayments.id, suggestion!.id))
    expect(payments[0]!.verificationStatus).toBe("suggested")
    expect(payments[0]!.rejectionReason).toBe("Confirmé la fila equivocada.")

    const events = await inMemoryDb.select().from(schema.billingInvoiceEvents)
    const reactivado = events.filter((event) =>
      (event.detail as { reactivatedFrom?: string }).reactivatedFrom === "reverted")
    expect(reactivado).toHaveLength(1)
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
      .set({ verificationStatus: "reverted", confirmedBy: null, confirmedAt: null })
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

/* ── Escritura desde un proveedor ────────────────────────────────────────── */

type ProviderInvoiceInput = Parameters<typeof upsertProviderInvoice>[1]

function providerInvoice(overrides: Partial<ProviderInvoiceInput> = {}): ProviderInvoiceInput {
  return {
    externalId: "chipax:5001",
    direction: "sale",
    docType: "33",
    folio: 4321,
    issuerTaxId: "78023530-6",
    issuerName: "CHOME",
    receiverTaxId: "76543210-K",
    receiverName: "MINERA EJEMPLO SPA",
    issueDate: "2026-07-20",
    dueDate: "2026-08-19",
    currency: "CLP",
    netAmount: 1000000,
    taxAmount: 190000,
    exemptAmount: null,
    totalAmount: 1190000,
    documentStatus: "accepted",
    externalStatus: "Aceptado",
    documentUrl: null,
    xmlUrl: null,
    accountRef: null,
    items: [],
    ...overrides,
  }
}

async function upsert(invoice: ProviderInvoiceInput, provider: "chipax" | "factura_en_linea" = "chipax") {
  return inMemoryDb.transaction(async (tx) =>
    // @ts-expect-error PGlite es compatible en runtime
    upsertProviderInvoice(tx, invoice, provider),
  )
}

async function readInvoice(id: string) {
  const [row] = await inMemoryDb.select().from(schema.billingInvoices)
    .where(eq(schema.billingInvoices.id, id))
  return row!
}

describe("signo de las notas de crédito", () => {
  // La convención («total negativo en una NC») vivía sólo en el lector de XML,
  // así que una NC de venta que llegaba por Chipax o por el libro del portal se
  // guardaba positiva y SUMABA a la cuenta por cobrar en vez de restar.
  it("una NC que el proveedor entrega en magnitud se guarda negativa", async () => {
    const result = await upsert(providerInvoice({ docType: "61", externalId: "chipax:5002" }))
    const invoice = await readInvoice(result.invoiceId)

    expect(invoice.totalAmount).toBe(-1190000)
    expect(invoice.netAmount).toBe(-1000000)
    expect(invoice.taxAmount).toBe(-190000)
  })

  it("es idempotente: la fuente que ya la entrega negativa no la vuelve positiva", async () => {
    const first = await upsert(providerInvoice({ docType: "61", externalId: "chipax:5002" }))
    // El XML del SII y el libro de ventas del portal la entregan ya negativa.
    const second = await upsert(
      providerInvoice({
        docType: "61", externalId: "fel:sale:433:61:4321:78023530-6",
        netAmount: -1000000, taxAmount: -190000, totalAmount: -1190000,
      }),
      "factura_en_linea",
    )

    expect(second.invoiceId).toBe(first.invoiceId)
    expect(second.changedFields).toEqual([])
    expect((await readInvoice(first.invoiceId)).totalAmount).toBe(-1190000)
  })
})

describe("corrección de monto desde el proveedor", () => {
  // `paymentStatus` es caché derivada del total: si el proveedor corrige el
  // monto y nadie recalcula, la factura queda "pagada" con saldo real vivo.
  it("recalcula el estado de pago cuando cambia el total", async () => {
    const { invoiceId } = await upsert(providerInvoice({ totalAmount: 1000000, netAmount: 840336, taxAmount: 159664 }))
    await inMemoryDb.insert(schema.billingInvoicePayments).values({
      id: "pay-prov", invoiceId, paymentDate: "2026-08-01",
      amount: 1000000, currency: "CLP", verificationStatus: "confirmed",
      confirmedBy: CONFIRMER, confirmedAt: new Date().toISOString(),
    })
    expect((await recomputeInvoicePaymentStatus(serviceDb, invoiceId)).paymentStatus).toBe("paid")

    await upsert(providerInvoice({ totalAmount: 1500000, netAmount: 1260504, taxAmount: 239496 }))

    const invoice = await readInvoice(invoiceId)
    expect(invoice.totalAmount).toBe(1500000)
    expect(invoice.paymentStatus).toBe("partial")
    expect(invoice.paidAmount).toBe(1000000)
  })
})

describe("referencia externa reasignable", () => {
  // El externalId no es inmutable: la bandeja del portal lo recalcula según lo
  // que logre decodificar de cada fila. Chocaba contra el índice único
  // (invoice_id, provider) —el que `ON CONFLICT` no nombra— y el 23505 crudo
  // dejaba el documento fallado en cada corrida.
  it("acepta que el proveedor cambie el id externo de un documento ya importado", async () => {
    const first = await upsert(providerInvoice({ externalId: "fel:bandeja:433:99887" }), "factura_en_linea")
    const second = await upsert(providerInvoice({ externalId: "fel:sale:500:33:4321:78023530-6" }), "factura_en_linea")

    expect(second.invoiceId).toBe(first.invoiceId)

    const refs = await inMemoryDb.select().from(schema.billingExternalRefs)
      .where(eq(schema.billingExternalRefs.invoiceId, first.invoiceId))
    expect(refs).toHaveLength(1)
    expect(refs[0]!.externalId).toBe("fel:sale:500:33:4321:78023530-6")
  })

  it("sigue rechazando que un id externo se mueva a otra factura interna", async () => {
    await upsert(providerInvoice({ externalId: "chipax:5001" }))
    await expect(upsert(providerInvoice({ externalId: "chipax:5001", folio: 9999 })))
      .rejects.toBeInstanceOf(BillingExternalReferenceConflict)
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

  // Una sobrepagada tiene saldo NEGATIVO: contarla neteaba lo que sí hay por
  // cobrar y la mostraba como deuda vencida del cliente cuando lo que
  // corresponde es devolverle plata.
  it("excluye las sobrepagadas del saldo por cobrar", async () => {
    await inMemoryDb.update(schema.billingInvoices)
      .set({ paidAmount: 1010000, paymentStatus: "overpaid" })
      .where(eq(schema.billingInvoices.id, "inv-1"))

    const view = await getCollectionsView(globalSession())
    expect(view.totalOutstanding).toEqual([{ currency: "CLP", amount: 500000 }])
    expect(view.rows.find((row) => row.invoiceId === "inv-1")!.bucket).toBe("paid")
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
