/**
 * Unit tests for approval actions (aprobaciones/actions.ts).
 *
 * Covers:
 *  1. Permission denied for all actions
 *  2. Missing itemId
 *  3. Item not found
 *  4. Scope denied
 *  5. Missing reason for reject/return
 *  6. Happy path for approve, reject, return
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockCanAccessWorksite = vi.hoisted(() => vi.fn((_session?: unknown, _worksiteId?: string) => true))
const mockApproveItem = vi.hoisted(() => vi.fn())
const mockRejectItem = vi.hoisted(() => vi.fn())
const mockBulkApproveItems = vi.hoisted(() => vi.fn())
const mockFindFirstItem = vi.hoisted(() => vi.fn())
const mockFindManyItems = vi.hoisted(() => vi.fn())
const mockFindFirstRequest = vi.hoisted(() => vi.fn())
const mockDbUpdate = vi.hoisted(() => vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })))
const mockNotifyAfterCommit = vi.hoisted(() => vi.fn((fn: () => Promise<unknown>) => fn()))
const mockNotifySafe = vi.hoisted(() => vi.fn())

/**
 * `updateDeliveryModeAction` corre dentro de `db.transaction` con
 * `SELECT … FOR UPDATE`. Cada `tx.select()` consume el siguiente lote de esta
 * cola: primero la solicitud, después sus ítems. La cadena es un thenable, así
 * que sirve tanto para `.where().for("update")` como para `.where()` a secas.
 */
const mockTxSelectQueue = vi.hoisted(() => [] as unknown[][])
const mockTransaction = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
  canAccessWorksite: mockCanAccessWorksite,
}))
vi.mock("@/db", () => ({
  db: {
    query: {
      purchaseRequestItems: { findFirst: mockFindFirstItem, findMany: mockFindManyItems },
      purchaseRequests: { findFirst: mockFindFirstRequest },
    },
    update: mockDbUpdate,
    transaction: mockTransaction,
  },
}))
vi.mock("@/lib/services/item-state", () => ({
  approveItem: mockApproveItem,
  rejectItem: mockRejectItem,
  bulkApproveItems: mockBulkApproveItems,
}))
vi.mock("@/lib/services/notifications", () => ({
  notifySafe: mockNotifySafe,
  notifyAfterCommit: mockNotifyAfterCommit,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { approveItemAction, rejectItemAction, bulkApproveRequestAction, updateDeliveryModeAction } from "@/app/(app)/aprobaciones/actions"
import type { ActionState } from "@/lib/validation/operations"

function txSelectChain(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    for: () => Promise.resolve(rows),
    then: (onOk: (value: unknown) => unknown, onErr?: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(onOk, onErr),
  }
  return chain
}

mockTransaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) =>
  run({
    select: () => txSelectChain(mockTxSelectQueue.shift() ?? []),
    update: mockDbUpdate,
  }),
)

const prevState: ActionState = { ok: false, message: "" }

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "admin@test.cl",
      name: "Admin",
      roles: ["administrador"],
      permissions: ["approvals:approve"],
      worksiteIds: ["ws-1"],
      primaryWorksiteId: "ws-1",
      avatarColor: "#000",
      isActive: true,
      ...overrides,
    },
  }
}

function makeItemBefore() {
  return {
    id: "item-1",
    status: "requested",
    request: { id: "req-1", code: "SOL-001", requesterId: "user-2", worksiteId: "ws-1" },
  }
}

function makeFormData(fields: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set("itemId", "item-1")
  for (const [k, v] of Object.entries(fields)) {
    fd.set(k, v)
  }
  return fd
}

describe("approveItemAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindFirstItem.mockReset()
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if itemId missing", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const fd = new FormData()
    const res = await approveItemAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("no especificado")
  })

  it("returns error if item not found", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstItem.mockResolvedValueOnce(null)
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("no encontrado")
  })

  it("returns error if scope denied", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockCanAccessWorksite.mockReturnValueOnce(false)
    mockFindFirstItem.mockResolvedValueOnce(makeItemBefore())
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("acceso")
  })

  it("returns error for invalid modifiedQty", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const res = await approveItemAction(prevState, makeFormData({ modifiedQty: "-5" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("positivo")
  })

  it("approves item successfully", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstItem.mockResolvedValueOnce(makeItemBefore())
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(true)
    expect(mockApproveItem).toHaveBeenCalledWith("item-1", "user-1", expect.objectContaining({
      userEmail: "admin@test.cl",
      roleContext: "administrador",
    }))
  })

  it("propagates service error", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstItem.mockResolvedValueOnce(makeItemBefore())
    mockApproveItem.mockRejectedValueOnce(new Error("Cannot approve"))
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Cannot approve")
  })
})

describe("rejectItemAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindFirstItem.mockReset()
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const res = await rejectItemAction(prevState, makeFormData({ reason: "Bad" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if reason missing", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const fd = makeFormData()
    fd.delete("reason")
    const res = await rejectItemAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("motivo")
  })

  it("rejects item successfully", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstItem.mockResolvedValueOnce(makeItemBefore())
    const res = await rejectItemAction(prevState, makeFormData({ reason: "No cumple" }))
    expect(res.ok).toBe(true)
    expect(mockRejectItem).toHaveBeenCalledWith("item-1", "user-1", "No cumple", expect.any(Object))
  })
})

// ── EPP approval gating ───────────────────────────────────────────────────────
// Business rule: jefatura / secretaría / administrador / prevencionista can
// approve or reject EPP requests. "Devolver" se retiró del flujo (2026-08-07).

function makeEppItemBefore() {
  return {
    id: "item-epp-1",
    status: "requested",
    request: { id: "req-epp", code: "SOL-EPP", requesterId: "user-prev", worksiteId: "ws-1", requestType: "epp" },
  }
}

describe("EPP approval gating (MISS-04)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset findFirst mock to avoid leftover resolved values from other blocks
    mockFindFirstItem.mockReset()
  })

  // ── approveItemAction ──────────────────────────────────────────────────────

  it("approveItemAction: allows EPP approval by prevencionista", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession({ roles: ["prevencionista"] }))
    mockFindFirstItem.mockResolvedValueOnce(makeEppItemBefore())
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(true)
    expect(mockApproveItem).toHaveBeenCalledWith("item-1", "user-1", expect.objectContaining({
      roleContext: "prevencionista",
    }))
  })

  it("approveItemAction: allows EPP approval by jefa_chome", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession({ roles: ["jefa_chome"] }))
    mockFindFirstItem.mockResolvedValueOnce(makeEppItemBefore())
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(true)
    // approveItem receives itemId from formData ("item-1"), not from findFirst result
    expect(mockApproveItem).toHaveBeenCalledWith("item-1", "user-1", expect.objectContaining({
      roleContext: "jefa_chome",
    }))
  })

  it("approveItemAction: allows EPP approval by secretaria", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession({ roles: ["secretaria"] }))
    mockFindFirstItem.mockResolvedValueOnce(makeEppItemBefore())
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(true)
    expect(mockApproveItem).toHaveBeenCalled()
  })

  it("approveItemAction: allows EPP approval by administrador", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession({ roles: ["administrador"] }))
    mockFindFirstItem.mockResolvedValueOnce(makeEppItemBefore())
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(true)
    expect(mockApproveItem).toHaveBeenCalled()
  })

  it("approveItemAction: allows non-EPP approval by any role with permission", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession({ roles: ["prevencionista"] }))
    // makeItemBefore() returns a request without requestType (no "epp")
    mockFindFirstItem.mockResolvedValueOnce(makeItemBefore())
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(true)
    expect(mockApproveItem).toHaveBeenCalled()
  })

  // ── rejectItemAction ───────────────────────────────────────────────────────

  it("rejectItemAction: allows EPP rejection by prevencionista", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession({ roles: ["prevencionista"] }))
    mockFindFirstItem.mockResolvedValueOnce(makeEppItemBefore())
    const res = await rejectItemAction(prevState, makeFormData({ reason: "No cumple norma" }))
    expect(res.ok).toBe(true)
    expect(mockRejectItem).toHaveBeenCalled()
  })

  it("rejectItemAction: allows EPP rejection by jefa_chome", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession({ roles: ["jefa_chome"] }))
    mockFindFirstItem.mockResolvedValueOnce(makeEppItemBefore())
    const res = await rejectItemAction(prevState, makeFormData({ reason: "No cumple" }))
    expect(res.ok).toBe(true)
    expect(mockRejectItem).toHaveBeenCalled()
  })

  // ── Multi-role: user with both authorized and unauthorized roles ────────────

  it("approveItemAction: allows EPP when user has at least one authorized role", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession({ roles: ["prevencionista", "secretaria"] }))
    mockFindFirstItem.mockResolvedValueOnce(makeEppItemBefore())
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(true)
    expect(mockApproveItem).toHaveBeenCalled()
  })
})

// ── Repuestos/servicios bypass (F1-1b / LOG-2b) ──────────────────────────────
// La aprobación por ítem es solo para EPP/otro; repuestos/servicios se
// aprueban seleccionando la cotización ganadora (selectQuotation), que además
// exige la regla de ≥3 cotizaciones. Sin este gate, approveItemAction podía
// aprobar un ítem de repuestos directamente, saltándose esa regla entera.

function makeRepuestosItemBefore() {
  return {
    id: "item-rep-1",
    status: "requested",
    quantity: 5,
    request: { id: "req-rep", code: "SOL-REP", requesterId: "user-2", worksiteId: "ws-1", requestType: "repuestos" },
  }
}

describe("requestType gating for repuestos/servicios", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindFirstItem.mockReset()
  })

  it("approveItemAction: rejects a repuestos item", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstItem.mockResolvedValueOnce(makeRepuestosItemBefore())
    const res = await approveItemAction(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("cotización ganadora")
    expect(mockApproveItem).not.toHaveBeenCalled()
  })

  it("rejectItemAction: rejects a servicios item", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstItem.mockResolvedValueOnce({
      ...makeRepuestosItemBefore(),
      request: { ...makeRepuestosItemBefore().request, requestType: "servicios" },
    })
    const res = await rejectItemAction(prevState, makeFormData({ reason: "No corresponde" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("cotización ganadora")
    expect(mockRejectItem).not.toHaveBeenCalled()
  })
})

// ── modifiedQty no puede superar lo solicitado (LOG-10) ──────────────────────

describe("approveItemAction: modifiedQty cap", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindFirstItem.mockReset()
  })

  it("rejects a modifiedQty greater than the requested quantity", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstItem.mockResolvedValueOnce({ ...makeItemBefore(), quantity: 5 })
    const res = await approveItemAction(prevState, makeFormData({ modifiedQty: "500", reason: "motivo" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("no puede superar")
    expect(mockApproveItem).not.toHaveBeenCalled()
  })

  it("allows a modifiedQty within the requested quantity", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstItem.mockResolvedValueOnce({ ...makeItemBefore(), quantity: 5 })
    const res = await approveItemAction(prevState, makeFormData({ modifiedQty: "3", reason: "motivo" }))
    expect(res.ok).toBe(true)
    expect(mockApproveItem).toHaveBeenCalled()
  })
})

// ── bulkApproveRequestAction (TST-4) ─────────────────────────────────────────

function makeBulkFormData(itemIds: string[]): FormData {
  const fd = new FormData()
  fd.set("itemIds", itemIds.join(","))
  return fd
}

function makeScopedItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    request: { worksiteId: "ws-1", requestType: "epp", ...((overrides.request as object) ?? {}) },
    ...overrides,
  }
}

describe("bulkApproveRequestAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindManyItems.mockReset()
    mockBulkApproveItems.mockResolvedValue({ approved: 2 })
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const res = await bulkApproveRequestAction(prevState, makeBulkFormData(["item-1", "item-2"]))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if itemIds is empty", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const res = await bulkApproveRequestAction(prevState, new FormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("No hay ítems")
  })

  it("rejects a selection with duplicated item ids", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const res = await bulkApproveRequestAction(prevState, makeBulkFormData(["item-1", "item-1"]))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("duplicados")
    expect(mockBulkApproveItems).not.toHaveBeenCalled()
  })

  it("returns error if one or more items are no longer available", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    // Selección de 2 ids, pero la query sólo encuentra 1 (el otro ya cambió de estado o fue borrado).
    mockFindManyItems.mockResolvedValueOnce([makeScopedItem({ id: "item-1" })])
    const res = await bulkApproveRequestAction(prevState, makeBulkFormData(["item-1", "item-2"]))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("ya no están disponibles")
    expect(mockBulkApproveItems).not.toHaveBeenCalled()
  })

  it("rejects the batch if any item is outside the user's worksite scope", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockCanAccessWorksite.mockImplementation((_session?: unknown, worksiteId?: string) => worksiteId === "ws-1")
    mockFindManyItems.mockResolvedValueOnce([
      makeScopedItem({ id: "item-1" }),
      makeScopedItem({ id: "item-2", request: { worksiteId: "ws-otra", requestType: "epp" } }),
    ])
    const res = await bulkApproveRequestAction(prevState, makeBulkFormData(["item-1", "item-2"]))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("No tienes permiso")
    expect(mockBulkApproveItems).not.toHaveBeenCalled()
  })

  it("rejects the batch if an EPP item is included without EPP approval permission", async () => {
    // "jefe_mantencion" tiene approvals:approve pero no está en EPP_APPROVER_ROLES.
    mockRequirePermission.mockResolvedValueOnce(makeSession({ roles: ["jefe_mantencion"] }))
    mockFindManyItems.mockResolvedValueOnce([makeScopedItem({ id: "item-1" })])
    const res = await bulkApproveRequestAction(prevState, makeBulkFormData(["item-1"]))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("No tienes permiso")
    expect(mockBulkApproveItems).not.toHaveBeenCalled()
  })

  it("rejects the batch if it includes a repuestos/servicios item (LOG-2b bypass)", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindManyItems.mockResolvedValueOnce([
      makeScopedItem({ id: "item-1" }),
      makeScopedItem({ id: "item-2", request: { worksiteId: "ws-1", requestType: "repuestos" } }),
    ])
    const res = await bulkApproveRequestAction(prevState, makeBulkFormData(["item-1", "item-2"]))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("No tienes permiso")
    expect(mockBulkApproveItems).not.toHaveBeenCalled()
  })

  it("approves the deduplicated batch and reports the approved count", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindManyItems.mockResolvedValueOnce([
      makeScopedItem({ id: "item-1" }),
      makeScopedItem({ id: "item-2" }),
    ])
    mockBulkApproveItems.mockResolvedValueOnce({ approved: 2 })
    const res = await bulkApproveRequestAction(prevState, makeBulkFormData(["item-1", "item-2"]))
    expect(res.ok).toBe(true)
    expect(res.message).toContain("2")
    expect(mockBulkApproveItems).toHaveBeenCalledWith(
      ["item-1", "item-2"],
      "user-1",
      expect.objectContaining({ userEmail: "admin@test.cl", roleContext: "administrador" }),
    )
  })

  it("propagates a service error from bulkApproveItems", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindManyItems.mockResolvedValueOnce([makeScopedItem({ id: "item-1" })])
    mockBulkApproveItems.mockRejectedValueOnce(new Error("No se pudo aprobar"))
    const res = await bulkApproveRequestAction(prevState, makeBulkFormData(["item-1"]))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("No se pudo aprobar")
  })
})

// ── Delivery mode (dispatch route) gating ────────────────────────────────────

describe("updateDeliveryModeAction", () => {
  beforeEach(() => {
    mockRequirePermission.mockResolvedValue(makeSession())
    mockCanAccessWorksite.mockReturnValue(true)
    mockFindFirstRequest.mockResolvedValue({ id: "req-1", worksiteId: "ws-1" })
    mockDbUpdate.mockClear()
    // La solicitud primero, sus ítems después: el orden en que la acción llama a
    // `tx.select()`. Ningún ítem está en OC, así que el cambio de modo procede.
    mockTxSelectQueue.length = 0
    mockTxSelectQueue.push([{ id: "req-1", worksiteId: "ws-1" }], [{ status: "pending" }])
  })

  it("persists directo_faena for an approver role", async () => {
    const fd = new FormData()
    fd.set("requestId", "req-1")
    fd.set("mode", "directo_faena")
    const res = await updateDeliveryModeAction(prevState, fd)
    expect(res.ok).toBe(true)
    expect(mockDbUpdate).toHaveBeenCalled()
  })

  it("rejects an invalid mode", async () => {
    const fd = new FormData()
    fd.set("requestId", "req-1")
    fd.set("mode", "bogus")
    const res = await updateDeliveryModeAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it("rejects a non-dispatch role (e.g. prevencionista only)", async () => {
    mockRequirePermission.mockResolvedValue(makeSession({ roles: ["prevencionista"] }))
    const fd = new FormData()
    fd.set("requestId", "req-1")
    fd.set("mode", "directo_faena")
    const res = await updateDeliveryModeAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  // Es la regla por la que la acción pasó a correr en transacción con
  // SELECT … FOR UPDATE: cambiar el modo de despacho cuando la compra ya salió
  // dejaría la OC apuntando a un destino distinto del comprometido.
  it("rejects the change when an item is already in a purchase order", async () => {
    mockTxSelectQueue.length = 0
    mockTxSelectQueue.push([{ id: "req-1", worksiteId: "ws-1" }], [{ status: "in_purchase_order" }])
    const fd = new FormData()
    fd.set("requestId", "req-1")
    fd.set("mode", "directo_faena")
    const res = await updateDeliveryModeAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/Orden de Compra/i)
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it("rejects the change when an item is already partially delivered (LOG-11)", async () => {
    mockTxSelectQueue.length = 0
    mockTxSelectQueue.push([{ id: "req-1", worksiteId: "ws-1" }], [{ status: "partially_delivered" }])
    const fd = new FormData()
    fd.set("requestId", "req-1")
    fd.set("mode", "directo_faena")
    const res = await updateDeliveryModeAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/Orden de Compra/i)
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it("rejects the change when an item is already delivered (LOG-11)", async () => {
    mockTxSelectQueue.length = 0
    mockTxSelectQueue.push([{ id: "req-1", worksiteId: "ws-1" }], [{ status: "delivered" }])
    const fd = new FormData()
    fd.set("requestId", "req-1")
    fd.set("mode", "directo_faena")
    const res = await updateDeliveryModeAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it("rejects the change when the request is outside the user's worksite scope", async () => {
    mockCanAccessWorksite.mockReturnValue(false)
    const fd = new FormData()
    fd.set("requestId", "req-1")
    fd.set("mode", "via_oficina")
    const res = await updateDeliveryModeAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })
})
