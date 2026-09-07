import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const db = drizzle(pg, { schema })
await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
afterAll(async () => { await pg.close() })

async function expectViolation(promise: Promise<unknown>): Promise<void> {
  let thrown: unknown = null
  try { await promise } catch (e) { thrown = e }
  expect(thrown).toBeTruthy()
  const cause = (thrown as { cause?: { message?: string } }).cause
  expect(`${(thrown as Error).message}\n${cause?.message ?? ""}`).toMatch(/check|constraint|violates|Failing row|duplicate/i)
}

const base = {
  purchaseOrderId: "oc1", fileName: "f.pdf", filePath: "storage/purchase-orders/f.pdf", uploadedBy: "u1",
}

beforeEach(async () => {
  await db.delete(schema.purchaseOrderInvoices)
  await db.delete(schema.purchaseOrders)
  await db.delete(schema.suppliers)
  await db.delete(schema.worksites)
  await db.delete(schema.users)
  await db.insert(schema.users).values({ id: "u1", name: "U", email: "u@t", hashedPassword: "x", isActive: true })
  await db.insert(schema.worksites).values({ id: "w1", name: "W", code: "W", isActive: true })
  await db.insert(schema.suppliers).values({ id: "s1", name: "S", rut: "76000000-0" })
  await db.insert(schema.purchaseOrders).values({
    id: "oc1", code: "OC-2026-9001", worksiteId: "w1", supplierId: "s1", createdBy: "u1", status: "sent",
  })
})

describe("notas de crédito de compra · invariantes de esquema", () => {
  it("acepta una nota de crédito con monto negativo", async () => {
    await db.insert(schema.purchaseOrderInvoices).values({
      ...base, id: "nc1", invoiceNumber: "5", amount: -20_000, documentKind: "credit_note",
    })
    const row = await db.query.purchaseOrderInvoices.findFirst()
    expect(row?.amount).toBe(-20_000)
    expect(row?.documentKind).toBe("credit_note")
  })

  it("sigue rechazando una factura con monto negativo", async () => {
    // Relajar el CHECK para las NC no puede abrir la puerta a facturas negativas.
    await expectViolation(db.insert(schema.purchaseOrderInvoices).values({
      ...base, id: "f1", invoiceNumber: "1", amount: -1, documentKind: "invoice",
    }))
  })

  it("rechaza una nota de crédito con monto positivo", async () => {
    // Una NC que suma volvería a inflar el total facturado en vez de bajarlo.
    await expectViolation(db.insert(schema.purchaseOrderInvoices).values({
      ...base, id: "nc2", invoiceNumber: "6", amount: 20_000, documentKind: "credit_note",
    }))
  })

  it("permite que una NC comparta folio con una factura de la misma OC", async () => {
    // Son series correlativas distintas del SII: la 33 N° 100 y la 61 N° 100
    // coexisten y la unicidad no puede confundirlas.
    await db.insert(schema.purchaseOrderInvoices).values({ ...base, id: "f2", invoiceNumber: "100", amount: 1000, documentKind: "invoice" })
    await db.insert(schema.purchaseOrderInvoices).values({ ...base, id: "nc3", invoiceNumber: "100", amount: -500, documentKind: "credit_note" })
    expect(await db.query.purchaseOrderInvoices.findMany()).toHaveLength(2)
  })

  it("sigue rechazando dos facturas con el mismo folio en la misma OC", async () => {
    await db.insert(schema.purchaseOrderInvoices).values({ ...base, id: "f3", invoiceNumber: "200", amount: 1000, documentKind: "invoice" })
    await expectViolation(db.insert(schema.purchaseOrderInvoices).values({
      ...base, id: "f4", invoiceNumber: "200", amount: 1000, documentKind: "invoice",
    }))
  })
})
