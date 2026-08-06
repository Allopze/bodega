/**
 * Detección y fusión de duplicados contra Postgres real (PGlite).
 *
 * La fusión toca cinco tablas y tiene que cumplir dos promesas incómodas de
 * sostener a la vez: **consolidar** (referencias, vínculos y pagos terminan en
 * una sola factura) y **no perder nada** (la descartada conserva su fila y su
 * historia). Eso no se puede demostrar con mocks.
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

const { detectDuplicateCandidates, listOpenDuplicates, mergeDuplicate, dismissDuplicate, DuplicateMergeError } =
  await import("../duplicates")

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const ACTOR = "u-admin"

/** Sesión de rol global: estas pruebas ejercitan la mecánica, no el alcance
 *  (el alcance por faena lo cubre queries-scope.test.ts). */
const GLOBAL_SESSION = {
  user: { id: ACTOR, name: "Administración", email: "admin@test", permissions: [], roles: [], worksiteIds: [], isGlobal: true },
} as unknown as import("next-auth").Session

/** Dos facturas del mismo cliente, mismo monto y misma fecha: distinto folio. */
async function seedSuspiciousPair() {
  await inMemoryDb.insert(schema.billingInvoices).values([
    {
      id: "inv-original", direction: "sale", docType: "33", folio: 1001,
      issuerTaxId: "78023530-6", issuerName: "CHOME",
      receiverTaxId: "76543210-K", receiverName: "MINERA EJEMPLO SPA",
      issueDate: "2026-07-15", currency: "CLP", totalAmount: 1000000,
      documentStatus: "accepted", paymentStatus: "unpaid", source: "manual",
    },
    {
      id: "inv-reemitida", direction: "sale", docType: "33", folio: 1055,
      issuerTaxId: "78023530-6", issuerName: "CHOME",
      receiverTaxId: "76543210-K", receiverName: "MINERA EJEMPLO SPA",
      issueDate: "2026-07-15", currency: "CLP", totalAmount: 1000000,
      documentStatus: "accepted", paymentStatus: "unpaid", source: "factura_en_linea",
    },
  ])
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.billingDuplicateCandidates)
  await inMemoryDb.delete(schema.billingInvoicePayments)
  await inMemoryDb.delete(schema.billingInvoiceItems)
  await inMemoryDb.delete(schema.billingInvoiceLinks)
  await inMemoryDb.delete(schema.billingExternalRefs)
  await inMemoryDb.delete(schema.billingInvoiceEvents)
  await inMemoryDb.delete(schema.billingInvoices)
  await inMemoryDb.delete(schema.clients)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: ACTOR, name: "Administración", email: "admin@test", hashedPassword: "x", isActive: true,
  })
})

describe("detección", () => {
  it("marca el par sospechoso y lo deja abierto para revisión", async () => {
    await seedSuspiciousPair()
    const result = await detectDuplicateCandidates({ direction: "sale" })

    expect(result.scanned).toBe(2)
    expect(result.created).toBe(1)

    const open = await listOpenDuplicates(GLOBAL_SESSION)
    expect(open).toHaveLength(1)
    expect(open[0]!.classification).toBe("probable")
    // La pantalla necesita los dos documentos completos para poder decidir.
    expect([open[0]!.folioA, open[0]!.folioB].sort()).toEqual([1001, 1055])
    expect(open[0]!.currency).toBe("CLP")
  })

  it("es idempotente: correrla dos veces no duplica el caso", async () => {
    await seedSuspiciousPair()
    await detectDuplicateCandidates({ direction: "sale" })
    const second = await detectDuplicateCandidates({ direction: "sale" })

    expect(second.created).toBe(0)
    expect(second.alreadyKnown).toBe(1)
    expect(await listOpenDuplicates(GLOBAL_SESSION)).toHaveLength(1)
  })

  it("no marca facturas de clientes distintos", async () => {
    await inMemoryDb.insert(schema.billingInvoices).values([
      {
        id: "inv-a", direction: "sale", docType: "33", folio: 2001,
        issuerTaxId: "78023530-6", issuerName: "CHOME",
        receiverTaxId: "76111111-1", receiverName: "Cliente A",
        issueDate: "2026-07-15", currency: "CLP", totalAmount: 1000000,
        documentStatus: "accepted", paymentStatus: "unpaid", source: "manual",
      },
      {
        id: "inv-b", direction: "sale", docType: "33", folio: 2002,
        issuerTaxId: "78023530-6", issuerName: "CHOME",
        receiverTaxId: "76222222-2", receiverName: "Cliente B",
        issueDate: "2026-07-15", currency: "CLP", totalAmount: 1000000,
        documentStatus: "accepted", paymentStatus: "unpaid", source: "manual",
      },
    ])
    expect((await detectDuplicateCandidates({ direction: "sale" })).created).toBe(0)
  })

  it("un caso descartado no vuelve a abrirse", async () => {
    await seedSuspiciousPair()
    await detectDuplicateCandidates({ direction: "sale" })
    const [candidate] = await listOpenDuplicates(GLOBAL_SESSION)

    await dismissDuplicate(candidate!.id, ACTOR)
    expect(await listOpenDuplicates(GLOBAL_SESSION)).toHaveLength(0)

    const rerun = await detectDuplicateCandidates({ direction: "sale" })
    expect(rerun.created).toBe(0)
    expect(await listOpenDuplicates(GLOBAL_SESSION)).toHaveLength(0)
  })
})

describe("fusión", () => {
  it("consolida referencias, vínculos y pagos en la superviviente", async () => {
    await seedSuspiciousPair()
    await inMemoryDb.insert(schema.clients).values({ id: "cli-1", rut: "76543210-K", name: "MINERA EJEMPLO SPA" })

    await inMemoryDb.insert(schema.billingExternalRefs).values([
      { id: "ref-1", invoiceId: "inv-original", provider: "manual", externalId: "manual:1", payloadHash: "h1" },
      { id: "ref-2", invoiceId: "inv-reemitida", provider: "factura_en_linea", externalId: "fel:1", payloadHash: "h2" },
    ])
    await inMemoryDb.insert(schema.billingInvoiceLinks).values({
      id: "lnk-1", invoiceId: "inv-original", clientId: "cli-1",
      status: "confirmed", matchedBy: "user", confirmedBy: ACTOR, confirmedAt: new Date().toISOString(),
    })
    await inMemoryDb.insert(schema.billingInvoicePayments).values({
      id: "pay-1", invoiceId: "inv-original", paymentDate: "2026-08-01",
      amount: 400000, currency: "CLP", verificationStatus: "suggested",
    })

    await detectDuplicateCandidates({ direction: "sale" })
    const [candidate] = await listOpenDuplicates(GLOBAL_SESSION)

    await mergeDuplicate({
      candidateId: candidate!.id,
      keepId: "inv-reemitida",
      dropId: "inv-original",
      actorUserId: ACTOR,
    })

    const refs = await inMemoryDb.select().from(schema.billingExternalRefs)
    expect(refs.every((ref) => ref.invoiceId === "inv-reemitida")).toBe(true)
    expect(refs).toHaveLength(2)

    const [link] = await inMemoryDb.select().from(schema.billingInvoiceLinks)
    expect(link!.invoiceId).toBe("inv-reemitida")

    const [payment] = await inMemoryDb.select().from(schema.billingInvoicePayments)
    expect(payment!.invoiceId).toBe("inv-reemitida")
  })

  it("recalcula el saldo de ambas facturas al mover un pago confirmado (H-02)", async () => {
    await seedSuspiciousPair()
    // El pago confirmado vive hoy en "inv-original" (dropId); su caché de
    // saldo ya lo refleja, como lo dejaría recomputeInvoicePaymentStatus en
    // producción. La superviviente ("inv-reemitida") sigue sin pagos.
    await inMemoryDb.insert(schema.billingInvoicePayments).values({
      id: "pay-confirmed", invoiceId: "inv-original", paymentDate: "2026-08-01",
      amount: 1000000, currency: "CLP", verificationStatus: "confirmed",
      confirmedBy: ACTOR, confirmedAt: new Date().toISOString(),
    })
    await inMemoryDb.update(schema.billingInvoices)
      .set({ paidAmount: 1000000, paymentStatus: "paid" })
      .where(eq(schema.billingInvoices.id, "inv-original"))

    await detectDuplicateCandidates({ direction: "sale" })
    const [candidate] = await listOpenDuplicates(GLOBAL_SESSION)

    await mergeDuplicate({
      candidateId: candidate!.id, keepId: "inv-reemitida", dropId: "inv-original", actorUserId: ACTOR,
    })

    const invoices = await inMemoryDb.select().from(schema.billingInvoices)
    const keep = invoices.find((invoice) => invoice.id === "inv-reemitida")!
    const drop = invoices.find((invoice) => invoice.id === "inv-original")!

    // Antes de H-02, mergeDuplicate movía el pago pero no llamaba a
    // recomputeInvoicePaymentStatus: la superviviente quedaba "unpaid" pese a
    // ser ahora dueña de un pago confirmado.
    expect(keep.paidAmount).toBe(1000000)
    expect(keep.paymentStatus).toBe("paid")
    // La descartada ya no es dueña de ningún pago: su caché debe reflejarlo,
    // no seguir describiendo un pago que ya se fue a la otra factura.
    expect(drop.paidAmount).toBe(0)
    expect(drop.paymentStatus).toBe("unpaid")

    const [payment] = await inMemoryDb.select().from(schema.billingInvoicePayments)
    expect(payment!.invoiceId).toBe("inv-reemitida")
  })

  it("no borra la descartada: la anula y deja rastro en ambas", async () => {
    await seedSuspiciousPair()
    await detectDuplicateCandidates({ direction: "sale" })
    const [candidate] = await listOpenDuplicates(GLOBAL_SESSION)

    await mergeDuplicate({
      candidateId: candidate!.id, keepId: "inv-reemitida", dropId: "inv-original", actorUserId: ACTOR,
    })

    const invoices = await inMemoryDb.select().from(schema.billingInvoices)
    expect(invoices).toHaveLength(2)   // ninguna se borró

    const dropped = invoices.find((invoice) => invoice.id === "inv-original")!
    expect(dropped.documentStatus).toBe("void")
    expect(dropped.notes).toMatch(/Fusionada con el documento 33\/1055/)

    const events = await inMemoryDb.select().from(schema.billingInvoiceEvents)
    expect(events.map((event) => event.eventType).sort()).toEqual([
      "invoice.merged_from", "invoice.merged_into",
    ])
    expect(events.every((event) => event.actorUserId === ACTOR)).toBe(true)

    const [resolved] = await inMemoryDb.select().from(schema.billingDuplicateCandidates)
    expect(resolved!.status).toBe("merged")
    expect(resolved!.mergedIntoId).toBe("inv-reemitida")
    expect(resolved!.resolvedBy).toBe(ACTOR)
  })

  it("se niega a fusionar cuando ambas tienen pagos confirmados", async () => {
    await seedSuspiciousPair()
    await inMemoryDb.update(schema.billingInvoices)
      .set({ paidAmount: 500000, paymentStatus: "partial" })
    await detectDuplicateCandidates({ direction: "sale" })
    const [candidate] = await listOpenDuplicates(GLOBAL_SESSION)

    await expect(mergeDuplicate({
      candidateId: candidate!.id, keepId: "inv-reemitida", dropId: "inv-original", actorUserId: ACTOR,
    })).rejects.toThrow(DuplicateMergeError)

    // Nada cambió: la fusión es atómica.
    const invoices = await inMemoryDb.select().from(schema.billingInvoices)
    expect(invoices.every((invoice) => invoice.documentStatus === "accepted")).toBe(true)
  })

  it("no mueve una referencia de un proveedor que la superviviente ya tiene", async () => {
    await seedSuspiciousPair()
    await inMemoryDb.insert(schema.billingExternalRefs).values([
      { id: "ref-1", invoiceId: "inv-original", provider: "manual", externalId: "manual:1", payloadHash: "h1" },
      { id: "ref-2", invoiceId: "inv-reemitida", provider: "manual", externalId: "manual:2", payloadHash: "h2" },
    ])
    await detectDuplicateCandidates({ direction: "sale" })
    const [candidate] = await listOpenDuplicates(GLOBAL_SESSION)

    await mergeDuplicate({
      candidateId: candidate!.id, keepId: "inv-reemitida", dropId: "inv-original", actorUserId: ACTOR,
    })

    // La referencia conflictiva se queda donde estaba en vez de romper el índice
    // único: la información no se pierde, pero tampoco se fuerza.
    const refs = await inMemoryDb.select().from(schema.billingExternalRefs)
    expect(refs.find((ref) => ref.id === "ref-1")!.invoiceId).toBe("inv-original")
    expect(refs.find((ref) => ref.id === "ref-2")!.invoiceId).toBe("inv-reemitida")
  })

  it("rechaza fusionar una factura consigo misma", async () => {
    await seedSuspiciousPair()
    await expect(mergeDuplicate({
      candidateId: "x", keepId: "inv-original", dropId: "inv-original", actorUserId: ACTOR,
    })).rejects.toThrow(DuplicateMergeError)
  })

  it("la fusionada sale de las agregaciones por quedar anulada", async () => {
    await seedSuspiciousPair()
    await detectDuplicateCandidates({ direction: "sale" })
    const [candidate] = await listOpenDuplicates(GLOBAL_SESSION)
    await mergeDuplicate({
      candidateId: candidate!.id, keepId: "inv-reemitida", dropId: "inv-original", actorUserId: ACTOR,
    })

    const vigentes = await inMemoryDb.select().from(schema.billingInvoices)
      .where(eq(schema.billingInvoices.documentStatus, "accepted"))
    expect(vigentes).toHaveLength(1)
    expect(vigentes[0]!.id).toBe("inv-reemitida")
  })
})
