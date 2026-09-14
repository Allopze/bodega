/**
 * COB-003 — La defensa contra el pago manual duplicado duraba dos minutos.
 *
 * El índice único `(invoice_id, bank_transaction_id)` no cubre los pagos
 * manuales, cuyo `bank_transaction_id` es NULL. La acción compensaba con un
 * bloqueo de fila y una búsqueda de "gemelo reciente" —mismo importe, misma
 * fecha, misma factura, confirmado y creado hace menos de dos minutos—.
 * Pasada esa ventana, el mismo pago volvía a registrarse sin ninguna
 * advertencia, y el caso frecuente es justo ése: la misma persona que
 * reintenta media hora después porque no vio el primero.
 *
 * Se prueba la acción completa contra Postgres real: lo que el hallazgo
 * describe es el cableado (clave de idempotencia persistida + advertencia),
 * y una regla correcta sin conectar no arregla nada.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq, sql } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

const mockAuthFn = vi.hoisted(() => vi.fn())
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }))
vi.mock("@/lib/services/module-toggles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/module-toggles")>()),
  assertPermissionModuleEnabled: vi.fn(async () => {}),
  assertRouteModuleEnabled: vi.fn(async () => {}),
  getNavigationToggleState: vi.fn(async () => ({ enabledModuleIds: new Set<string>(), disabledSubmoduleHrefs: new Set<string>() })),
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { registerManualPaymentAction } = await import("@/app/(app)/facturacion/cobranza/actions")

const CAJA = "user-cob003-caja"
const INVOICE = "inv-cob003"

function session(userId: string): Session {
  return {
    user: {
      id: userId, name: userId, email: `${userId}@cob.cl`,
      permissions: ["billing:confirm_payments", "billing:view"],
      roles: ["administrador"], worksiteIds: [], isGlobal: true, isActive: true,
    },
    expires: new Date(Date.now() + 86_400_000).toISOString(),
  } as unknown as Session
}

beforeAll(async () => {
  await testDb.insert(schema.users).values({
    id: CAJA, name: "Caja", email: "caja@cob.cl", hashedPassword: "x", isActive: true,
  })
})

beforeEach(async () => {
  mockAuthFn.mockResolvedValue(session(CAJA))
  await testDb.delete(schema.billingInvoicePayments)
  await testDb.delete(schema.billingInvoiceEvents)
  await testDb.delete(schema.billingInvoices)
  await testDb.insert(schema.billingInvoices).values({
    id: INVOICE, direction: "sale", docType: "33", folio: 4321,
    issuerTaxId: "78023530-6", issuerName: "CHOME",
    receiverTaxId: "76543210-K", receiverName: "MINERA EJEMPLO SPA",
    issueDate: "2026-07-15", currency: "CLP", totalAmount: 1000000, paidAmount: 0,
    documentStatus: "accepted", paymentStatus: "unpaid", source: "manual",
  })
})

const pay = (overrides: Record<string, unknown> = {}) => registerManualPaymentAction({
  invoiceId: INVOICE,
  paymentDate: "2026-07-20",
  amount: 300000,
  currency: "CLP",
  ...overrides,
})

async function countPayments(): Promise<number> {
  const rows = await testDb.select({ id: schema.billingInvoicePayments.id })
    .from(schema.billingInvoicePayments)
  return rows.length
}

/** Envejece los pagos para salir de cualquier ventana temporal. */
async function ageAllPayments(): Promise<void> {
  await testDb.update(schema.billingInvoicePayments)
    .set({ createdAt: sql`now() - interval '30 minutes'` })
}

describe("COB-003 — clave de idempotencia persistida", () => {
  it("reenviar el MISMO envío no cobra dos veces, ni siquiera media hora después", async () => {
    const key = "req-cob003-aaaaaaaa"
    expect((await pay({ clientRequestId: key })).ok).toBe(true)
    expect(await countPayments()).toBe(1)

    // Aquí estaba el agujero: fuera de la ventana de dos minutos, el mismo
    // envío entraba de nuevo y la factura quedaba cobrada dos veces.
    await ageAllPayments()

    const retry = await pay({ clientRequestId: key })
    expect(retry.ok).toBe(true)
    expect(retry.message).toContain("reintento")
    expect(await countPayments()).toBe(1)

    const [invoice] = await testDb.select({ paid: schema.billingInvoices.paidAmount })
      .from(schema.billingInvoices).where(eq(schema.billingInvoices.id, INVOICE))
    expect(Number(invoice?.paid)).toBe(300000)
  })

  it("la base rechaza dos pagos con la misma clave aunque la acción no los filtre", async () => {
    await pay({ clientRequestId: "req-cob003-bbbbbbbb" })
    await expect(testDb.insert(schema.billingInvoicePayments).values({
      id: "pago-colado", invoiceId: INVOICE, amount: 300000, currency: "CLP",
      paymentDate: "2026-07-20", verificationStatus: "confirmed", matchedBy: "user",
      confirmedBy: CAJA, confirmedAt: new Date().toISOString(), createdBy: CAJA,
      clientRequestId: "req-cob003-bbbbbbbb",
    })).rejects.toThrow()
  })

  it("dos claves distintas sí registran dos pagos: la clave no bloquea el caso legítimo", async () => {
    expect((await pay({ clientRequestId: "req-cob003-cccccccc", amount: 100000 })).ok).toBe(true)
    expect((await pay({ clientRequestId: "req-cob003-dddddddd", amount: 200000, acknowledgeDuplicate: true })).ok).toBe(true)
    expect(await countPayments()).toBe(2)
  })
})

describe("COB-003 — advertencia de pago idéntico sin caducidad", () => {
  it("advierte del pago idéntico aunque hayan pasado más de dos minutos", async () => {
    expect((await pay({ clientRequestId: "req-cob003-eeeeeeee" })).ok).toBe(true)
    await ageAllPayments()

    // Envío nuevo (otra clave), pero idéntico en factura, monto y fecha: antes
    // pasaba en silencio por estar fuera de la ventana de dos minutos.
    const second = await pay({ clientRequestId: "req-cob003-ffffffff" })
    expect(second.ok).toBe(false)
    expect(second.needsDuplicateAck).toBe(true)
    expect(second.message).toContain("Ya existe un pago idéntico")
    expect(await countPayments()).toBe(1)
  })

  it("la advertencia no bloquea: reconocerla registra el segundo pago real", async () => {
    await pay({ clientRequestId: "req-cob003-11111111" })
    await ageAllPayments()

    const acknowledged = await pay({ clientRequestId: "req-cob003-22222222", acknowledgeDuplicate: true })
    expect(acknowledged.ok).toBe(true)
    expect(await countPayments()).toBe(2)
  })

  it("un pago de otro monto o de otra fecha no dispara la advertencia", async () => {
    await pay({ clientRequestId: "req-cob003-33333333" })
    expect((await pay({ clientRequestId: "req-cob003-44444444", amount: 400000 })).ok).toBe(true)
    expect((await pay({ clientRequestId: "req-cob003-55555555", paymentDate: "2026-07-21" })).ok).toBe(true)
    expect(await countPayments()).toBe(3)
  })
})
