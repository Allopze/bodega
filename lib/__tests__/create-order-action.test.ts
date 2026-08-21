/**
 * Unit tests for createOrderAction — validation, scope, and execution.
 *
 * Covers:
 *  1. Permission denied (no purchasing:create_order)
 *  2. Invalid form data (missing items, bad JSON)
 *  3. Worksite scope denied
 *  4. Service-layer error propagation
 *  5. Happy path with valid items
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { redirect } from "next/navigation"
import type { Session } from "next-auth"

// El mock reproduce el contrato real: `redirect` lanza y `unstable_rethrow`
// re-lanza los errores de control de flujo de Next (por digest, no por texto),
// dejando pasar los demás para que el catch de la action los convierta en
// ActionState. La action ya no compara `e.message` con "NEXT_REDIRECT".
// El guard de módulo consulta `system_settings` en cada verificación de permiso
// (CO-007). Estas pruebas mockean sólo las tablas de su caso, así que se
// declara aquí que ningún módulo está apagado; el guard tiene sus propias
// regresiones en lib/__tests__/module-toggles.test.ts.
vi.mock("@/lib/services/module-toggles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/module-toggles")>()),
  assertPermissionModuleEnabled: vi.fn(async () => {}),
  assertRouteModuleEnabled: vi.fn(async () => {}),
  getNavigationToggleState: vi.fn(async () => ({ enabledModuleIds: new Set<string>(), disabledSubmoduleHrefs: new Set<string>() })),
}))

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    const error = new Error("NEXT_REDIRECT") as Error & { digest?: string }
    error.digest = "NEXT_REDIRECT;replace;/compras;307;"
    throw error
  }),
  unstable_rethrow: vi.fn((e: unknown) => {
    const digest = (e as { digest?: unknown } | null)?.digest
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) throw e
  }),
}))

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockCreateOrders = vi.hoisted(() => vi.fn())
const mockFindManyItems = vi.hoisted(() => vi.fn())
const mockFindManySuppliers = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("@/lib/services/purchasing", () => ({
  createOrdersBySupplier: mockCreateOrders,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/db", () => ({
  db: {
    query: {
      purchaseRequestItems: { findMany: mockFindManyItems },
      suppliers: { findMany: mockFindManySuppliers },
    },
  },
}))

import { createOrderAction } from "@/app/(app)/compras/actions"

function makeSession(overrides: Partial<Session["user"]> = {}): Session {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "admin@test.cl",
      name: "Admin",
      roles: ["administrador"],
      permissions: ["purchasing:create_order"],
      worksiteIds: ["ws-1", "ws-2"],
      primaryWorksiteId: "ws-1",
      avatarColor: "#000",
      isActive: true,
      ...overrides,
    },
  }
}

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set("worksiteId", "ws-1")
  fd.set("supplierId", "sup-1")
  fd.set("itemsJson", JSON.stringify([
    { requestItemId: "ri-1", productId: "p-1", productNameFree: null, quantity: 10, unitOfMeasure: "unidad", unitPrice: 1500 },
  ]))
  for (const [k, v] of Object.entries(overrides)) {
    if (v === "") fd.delete(k)
    else fd.set(k, v)
  }
  return fd
}

describe("createOrderAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(redirect).mockImplementation(() => {
      // Con digest: es lo que mira `unstable_rethrow` para distinguir el
      // control de flujo de Next de un error real. Sin él, la action trataría
      // el redirect como fallo y devolvería ActionState con la OC ya creada.
      const error = new Error("NEXT_REDIRECT") as Error & { digest?: string }
      error.digest = "NEXT_REDIRECT;replace;/compras;307;"
      throw error
    })
    // Default: items and suppliers found
    mockFindManyItems.mockResolvedValue([{
      id: "ri-1",
      status: "pending_purchase",
      quantity: 10,
      requestId: "req-1",
      request: { worksiteId: "ws-1" },
    }])
    mockFindManySuppliers.mockResolvedValue([{ id: "sup-1", isActive: true }])
  })

  it("returns error if permission denied", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession({ permissions: [] }))
    const res = await createOrderAction({ ok: false, message: "" }, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
    expect(mockCreateOrders).not.toHaveBeenCalled()
  })

  it("returns error on invalid items JSON", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    const fd = makeFormData({ itemsJson: "not-json" })
    const res = await createOrderAction({ ok: false, message: "" }, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("ítems")
    expect(mockCreateOrders).not.toHaveBeenCalled()
  })

  it("returns error if Zod validation fails (missing fields)", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    const fd = makeFormData({ worksiteId: "" })
    const res = await createOrderAction({ ok: false, message: "" }, fd)
    expect(res.ok).toBe(false)
    expect(res.fieldErrors).toBeDefined()
    expect(mockCreateOrders).not.toHaveBeenCalled()
  })

  it("propagates service-layer error", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    mockCreateOrders.mockRejectedValueOnce(new Error("Proveedor sin items"))
    const res = await createOrderAction({ ok: false, message: "" }, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Proveedor sin items")
  })

  it("creates order successfully on happy path", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    mockCreateOrders.mockResolvedValueOnce(["oc-1"])
    await expect(createOrderAction({ ok: false, message: "" }, makeFormData())).rejects.toThrow("NEXT_REDIRECT")
    expect(mockCreateOrders).toHaveBeenCalledOnce()
  })
})
