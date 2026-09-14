/**
 * Patrón P9 (auditoría 2026-09-14): la segregación de funciones existe bien
 * construida en MIPER, CAPA, propuestas de venta y costos de mantención, y
 * faltaba justo en los dos puntos donde se mueve dinero.
 *
 *  - `COB-002`: `billing:confirm_payments` registraba, confirmaba, generaba
 *    sugerencias **y revertía**. Una persona podía imputar un pago inexistente
 *    y, si alguien lo notaba, deshacerlo ella misma.
 *  - `FAC-004`: `purchasing:send_order` adjuntaba la factura de compra,
 *    la desvinculaba, la borraba **y aceptaba su diferencia de monto**.
 *
 * Se prueban las acciones completas, no sólo la regla: lo que el hallazgo
 * describe es el cableado, y una regla correcta sin conectar no arregla nada.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"

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

const { revertPaymentAction } = await import("@/app/(app)/facturacion/cobranza/actions")
const { acceptInvoiceReconciliationAction } = await import("@/app/(app)/compras/actions/invoice-reconciliation")

const ANA = "user-seg-ana"
const BETO = "user-seg-beto"
const WS = "ws-seg-1"

function session(userId: string, permissions: string[]): Session {
  return {
    user: {
      id: userId, name: userId, email: `${userId}@seg.cl`,
      permissions, roles: ["administrador"], worksiteIds: [], isGlobal: true, isActive: true,
    },
    expires: new Date(Date.now() + 86_400_000).toISOString(),
  } as unknown as Session
}

beforeAll(async () => {
  await testDb.insert(schema.users).values([
    { id: ANA, name: "Ana", email: "ana@seg.cl", hashedPassword: "x", isActive: true },
    { id: BETO, name: "Beto", email: "beto@seg.cl", hashedPassword: "x", isActive: true },
  ])
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena Seg", code: "SEG", isActive: true })
})

/* ── COB-002 ─────────────────────────────────────────────────────────────── */

describe("COB-002 — revertir un pago confirmado", () => {
  let paymentId = ""

  beforeEach(async () => {
    await testDb.delete(schema.billingInvoicePayments)
    await testDb.delete(schema.billingInvoices)

    await testDb.insert(schema.billingInvoices).values({
      id: "inv-seg", direction: "sale", docType: "33", folio: 900,
      issuerTaxId: "78023530-6", issuerName: "CHOME",
      receiverTaxId: "76543210-K", receiverName: "Cliente",
      issueDate: "2026-07-15", currency: "CLP", totalAmount: 1000, paidAmount: 1000,
      documentStatus: "accepted", paymentStatus: "paid", source: "manual",
    })
    paymentId = nanoid()
    await testDb.insert(schema.billingInvoicePayments).values({
      id: paymentId, invoiceId: "inv-seg", amount: 1000, currency: "CLP",
      paymentDate: "2026-07-20", verificationStatus: "confirmed",
      matchedBy: "user", confirmedBy: ANA, confirmedAt: "2026-07-20T12:00:00.000Z", createdBy: ANA,
    })
  })

  const revert = (userId: string, permissions: string[]) => {
    mockAuthFn.mockResolvedValue(session(userId, permissions))
    return revertPaymentAction({ paymentId, reason: "Se imputó a la factura equivocada" })
  }

  it("confirmar ya no alcanza para revertir: son dos permisos", async () => {
    const result = await revert(BETO, ["billing:confirm_payments", "billing:view"])
    expect(result.ok).toBe(false)
  })

  it("quien confirmó el pago no puede revertirlo, aunque tenga el permiso", async () => {
    const result = await revert(ANA, ["billing:revert_payments", "billing:view"])
    expect(result.ok).toBe(false)
    expect(result.message).toContain("persona distinta")
  })

  it("otra persona con el permiso sí puede", async () => {
    const result = await revert(BETO, ["billing:revert_payments", "billing:view"])
    expect(result.ok).toBe(true)

    const [row] = await testDb.select({ status: schema.billingInvoicePayments.verificationStatus })
      .from(schema.billingInvoicePayments).where(eq(schema.billingInvoicePayments.id, paymentId))
    expect(row?.status).toBe("reverted")
  })

  it("un pago confirmado siempre tiene confirmante: la regla nunca queda sin sujeto", async () => {
    /*
     * La base lo garantiza —`billing_invoice_payments_confirmation_traced`
     * exige `confirmed_by` y `confirmed_at` en todo pago confirmado—, así que
     * la rama «acto del sistema» de `requireDifferentActor` no se alcanza por
     * aquí. Se deja escrito para que nadie relaje esa restricción creyendo que
     * la segregación seguiría en pie: sin confirmante, no bloquearía a nadie.
     */
    await expect(testDb.update(schema.billingInvoicePayments)
      .set({ confirmedBy: null })
      .where(eq(schema.billingInvoicePayments.id, paymentId))).rejects.toThrow()
  })
})

/* ── FAC-004 ─────────────────────────────────────────────────────────────── */

describe("FAC-004 — aceptar la diferencia de una factura de compra", () => {
  const ORDER = "oc-seg"

  beforeEach(async () => {
    await testDb.delete(schema.purchaseOrderInvoices)
    await testDb.delete(schema.purchaseOrders)
    await testDb.delete(schema.suppliers)

    await testDb.insert(schema.suppliers).values({ id: "sup-seg", name: "Proveedor Seg", isActive: true })
    await testDb.insert(schema.purchaseOrders).values({
      id: ORDER, code: "OC-SEG-1", supplierId: "sup-seg", worksiteId: WS,
      createdBy: ANA, status: "received", invoiceReconciliationStatus: "needs_review",
    })
    await testDb.insert(schema.purchaseOrderInvoices).values({
      id: nanoid(), purchaseOrderId: ORDER, invoiceNumber: "F-100",
      fileName: "f100.pdf", filePath: "storage/f100.pdf", uploadedBy: ANA,
    })
  })

  const accept = (userId: string, permissions: string[]) => {
    mockAuthFn.mockResolvedValue(session(userId, permissions))
    const fd = new FormData()
    fd.set("purchaseOrderId", ORDER)
    fd.set("fingerprint", "fp-1")
    fd.set("reason", "Diferencia de flete acordada con el proveedor")
    return acceptInvoiceReconciliationAction({ ok: false }, fd)
  }

  it("adjuntar ya no alcanza para aceptar la diferencia: son dos permisos", async () => {
    const result = await accept(BETO, ["purchasing:send_order", "purchasing:view"])
    expect(result.ok).toBe(false)
    expect(result.message).toContain("Sin permisos")
  })

  it("quien cargó la factura no acepta su propia diferencia", async () => {
    const result = await accept(ANA, ["purchasing:accept_invoice_exception", "purchasing:view"])
    expect(result.ok).toBe(false)
    expect(result.message).toContain("persona distinta")
  })

  it("basta con que una de las facturas vinculadas sea suya", async () => {
    // La aceptación resuelve el descuadre de la orden completa, no de un
    // documento: si cargó cualquiera de ellos, está decidiendo sobre lo suyo.
    await testDb.insert(schema.purchaseOrderInvoices).values({
      id: nanoid(), purchaseOrderId: ORDER, invoiceNumber: "F-101",
      fileName: "f101.pdf", filePath: "storage/f101.pdf", uploadedBy: BETO,
    })
    const result = await accept(ANA, ["purchasing:accept_invoice_exception", "purchasing:view"])
    expect(result.ok).toBe(false)
    expect(result.message).toContain("persona distinta")
  })

  it("otra persona con el permiso pasa la barrera de segregación", async () => {
    const result = await accept(BETO, ["purchasing:accept_invoice_exception", "purchasing:view"])
    // Puede fallar más adelante por la huella de evidencia, que es otro control
    // y no el que aquí se prueba: lo que importa es que no la detiene la
    // segregación.
    expect(result.message ?? "").not.toContain("persona distinta")
    expect(result.message ?? "").not.toContain("Sin permisos")
  })
})
