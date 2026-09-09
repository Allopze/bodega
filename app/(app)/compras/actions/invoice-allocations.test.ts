import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ permission: vi.fn(), replace: vi.fn(), revalidate: vi.fn(), persist: vi.fn() }))
vi.mock("@/lib/auth/can", () => ({ requirePermission: mocks.permission }))
vi.mock("@/lib/auth/scope", () => ({ serviceWorksiteScope: () => ["allowed-worksite"] }))
vi.mock("@/db", () => ({ db: { transaction: async (fn: (tx: unknown) => unknown) => fn({}) } }))
vi.mock("@/lib/services/operational-cache", () => ({ revalidateOperationalViews: mocks.revalidate }))
vi.mock("@/lib/services/purchasing-module/invoice-reconciliation-service", () => ({ persistPurchaseOrderInvoiceReconciliationTx: mocks.persist }))
vi.mock("@/lib/services/purchasing-module/invoice-line-allocations", async (original) => ({ ...await original<object>(), replaceInvoiceLineAllocationsTx: mocks.replace }))

import { InvoiceLineAllocationError } from "@/lib/services/purchasing-module/invoice-line-allocations"
import { saveInvoiceLineAllocationsAction } from "./invoice-allocations"

const payload = { purchaseOrderId: "order", invoiceItemId: "line", fingerprint: "alloc-v1:current", coverage: "complete", allocations: [{ purchaseOrderItemId: "a", quantity: 6, subtotal: 60000 }, { purchaseOrderItemId: "b", quantity: 4, subtotal: 40000 }] }

describe("saveInvoiceLineAllocationsAction", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.permission.mockResolvedValue({ user: { id: "operator", email: "operator@example.test" } }); mocks.replace.mockResolvedValue({ fingerprint: "new", allocations: [], legacyPurchaseOrderItemId: null }) })
  it.each(["{", "null", "[]", JSON.stringify({ ...payload, allocations: [{ purchaseOrderItemId: "a", quantity: "6", subtotal: 10 }] }), JSON.stringify({ ...payload, purchaseOrderId: "../other" }), JSON.stringify({ ...payload, allocations: [] })])("rejects invalid JSON, IDs and numeric values before writes: %s", async input => {
    expect(await saveInvoiceLineAllocationsAction(input)).toMatchObject({ ok: false, code: "INVALID_INPUT" })
    expect(mocks.replace).not.toHaveBeenCalled()
  })
  it("enforces permission before accessing allocations", async () => {
    mocks.permission.mockRejectedValue(new Error("forbidden"))
    expect(await saveInvoiceLineAllocationsAction(JSON.stringify(payload))).toMatchObject({ ok: false, code: "FORBIDDEN" })
    expect(mocks.replace).not.toHaveBeenCalled()
  })
  it("takes actor and scope exclusively from session and refreshes operational views", async () => {
    expect(await saveInvoiceLineAllocationsAction(JSON.stringify({ ...payload, worksiteScope: "all", actor: { userId: "intruder" } }))).toMatchObject({ ok: true })
    expect(mocks.permission).toHaveBeenCalledWith("purchasing:send_order")
    expect(mocks.replace).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ expectedFingerprint: payload.fingerprint, allocations: payload.allocations, actor: { userId: "operator", userEmail: "operator@example.test" }, worksiteScope: ["allowed-worksite"], source: "operator" }))
    expect(mocks.persist).toHaveBeenCalledWith(expect.anything(), "order")
    expect(mocks.revalidate).toHaveBeenCalledWith(["/compras/order", "/compras", "/bodega/trazabilidad"])
  })
  it("returns actionable stale feedback without leaking database errors", async () => {
    mocks.replace.mockRejectedValue(new InvoiceLineAllocationError("STALE_EVIDENCE"))
    expect(await saveInvoiceLineAllocationsAction(JSON.stringify(payload))).toMatchObject({ ok: false, code: "STALE_EVIDENCE", message: expect.stringMatching(/recarga/i) })
    expect(mocks.revalidate).not.toHaveBeenCalled()
    mocks.replace.mockRejectedValue(new Error("SELECT private_secret"))
    expect((await saveInvoiceLineAllocationsAction(JSON.stringify(payload))).message).not.toContain("private_secret")
  })
})
