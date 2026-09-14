/**
 * Unit tests for registerWorkerDelivery / registerDelivery actions.
 *
 * Covers permission guard and scope enforcement for the deliveries flow.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"
import {
  addDaysToPlainDate,
  todayInChile,
} from "@/lib/utils"

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockRegisterWorkerStock = vi.hoisted(() => vi.fn())

// El guard de módulo consulta `system_settings` en cada verificación de permiso
// (CO-007). Sin este mock la consulta falla y `requirePermission` se lee como
// "sin permisos", dejando estas pruebas verdes-por-la-razón-equivocada.
vi.mock("@/lib/services/module-toggles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/module-toggles")>()),
  assertPermissionModuleEnabled: vi.fn(async () => {}),
  assertRouteModuleEnabled: vi.fn(async () => {}),
  getNavigationToggleState: vi.fn(async () => ({ enabledModuleIds: new Set<string>(), disabledSubmoduleHrefs: new Set<string>() })),
}))

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("@/lib/services/deliveries", () => ({
  registerWorkerStockDelivery: mockRegisterWorkerStock,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { registerWorkerDeliveryAction } from "@/app/(app)/entregas/actions"
import { earliestDeliveryDate, MAX_DELIVERY_BACKDATING_DAYS } from "@/lib/validation/operations"

function makeSession(overrides: Partial<Session["user"]> = {}): Session {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "op@test.cl",
      name: "Operador",
      roles: ["solicitante_faena"],
      permissions: ["deliveries:create"],
      worksiteIds: ["ws-1"],
      primaryWorksiteId: "ws-1",
      avatarColor: "#000",
      isActive: true,
      ...overrides,
    },
  }
}

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set("sourceWorksiteId", "ws-1")
  fd.set("workerId", "w-1")
  fd.set("itemsJson", JSON.stringify([{ productId: "prod-1", quantity: 2, requestItemId: "ri-1" }]))
  for (const [k, v] of Object.entries(overrides)) {
    if (v === "") fd.delete(k)
    else fd.set(k, v)
  }
  return fd
}

describe("registerWorkerDeliveryAction", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns error if user lacks permission", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession({ permissions: [] }))
    const res = await registerWorkerDeliveryAction({ ok: false, message: "" }, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/permisos/i)
    expect(mockRegisterWorkerStock).not.toHaveBeenCalled()
  })

  it("returns error if workerId is missing", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    const fd = makeFormData({ workerId: "" })
    const res = await registerWorkerDeliveryAction({ ok: false, message: "" }, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Revisa los datos")
    expect(res.fieldErrors?.workerId).toBeDefined()
    expect(mockRegisterWorkerStock).not.toHaveBeenCalled()
  })

  it("returns error if a product quantity is invalid", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    const fd = makeFormData({ itemsJson: JSON.stringify([{ productId: "prod-1", quantity: 0 }]) })
    const res = await registerWorkerDeliveryAction({ ok: false, message: "" }, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Revisa los datos")
    expect(res.fieldErrors?.items).toBeDefined()
    expect(mockRegisterWorkerStock).not.toHaveBeenCalled()
  })

  it("propagates service error", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    mockRegisterWorkerStock.mockRejectedValueOnce(new Error("Stock insuficiente"))
    const res = await registerWorkerDeliveryAction({ ok: false, message: "" }, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Stock insuficiente")
  })

  it("registers delivery successfully", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    mockRegisterWorkerStock.mockResolvedValueOnce("del-1")
    const res = await registerWorkerDeliveryAction({ ok: false, message: "" }, makeFormData())
    expect(res.ok).toBe(true)
    expect(mockRegisterWorkerStock).toHaveBeenCalledOnce()
  })

  it("rejects worksite outside user scope", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession({ worksiteIds: ["ws-other"] }))
    const res = await registerWorkerDeliveryAction({ ok: false, message: "" }, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/acceso|faena/i)
    expect(mockRegisterWorkerStock).not.toHaveBeenCalled()
  })

  /*
   * ENT-003 (auditoría 2026-09-14): esta prueba afirmaba lo contrario —usaba
   * −365 días y consagraba que *cualquier* fecha pasada llegaba al servicio—.
   * La retroactividad sigue existiendo, porque un comprobante en papel llega
   * tarde, pero ahora está acotada; la fecha de este caso queda dentro del
   * plazo, y el rechazo del año entero está en la prueba siguiente.
   */
  it("deja pasar al servicio una fecha retroactiva dentro del plazo", async () => {
    const backdate = addDaysToPlainDate(todayInChile(), -30)
    mockAuthFn.mockResolvedValueOnce(makeSession())
    mockRegisterWorkerStock.mockResolvedValueOnce("del-1")
    const res = await registerWorkerDeliveryAction(
      { ok: false, message: "" },
      makeFormData({ deliveredAt: backdate }),
    )
    expect(res.ok).toBe(true)
    expect(mockRegisterWorkerStock).toHaveBeenCalledWith(
      expect.objectContaining({ deliveredAt: backdate }),
      expect.anything(),
      // GDI-002: tercer argumento — el colector del aviso de stock en tránsito.
      expect.objectContaining({ onInTransitWarning: expect.any(Function) }),
    )
  })

  /*
   * ENT-003: antes esto entraba sin más y quedaba fechado en un período ya
   * informado, acreditando allí la actividad N°62 del PDTP —que cuelga de esta
   * misma fecha—.
   */
  it("rechaza una fecha de entrega más antigua que el plazo de retroactividad", async () => {
    const tooOld = addDaysToPlainDate(todayInChile(), -(MAX_DELIVERY_BACKDATING_DAYS + 1))
    mockAuthFn.mockResolvedValueOnce(makeSession())
    const res = await registerWorkerDeliveryAction({ ok: false, message: "" }, makeFormData({ deliveredAt: tooOld }))
    expect(res.ok).toBe(false)
    // Accionable: dice desde qué fecha se admite y qué hacer si es más vieja.
    expect(res.fieldErrors?.deliveredAt?.[0]).toContain(earliestDeliveryDate())
    expect(res.fieldErrors?.deliveredAt?.[0]).toContain("explica el desfase en las notas")
    expect(mockRegisterWorkerStock).not.toHaveBeenCalled()
  })

  /** El límite es inclusivo: el día exacto del borde sigue siendo válido. */
  it("acepta la fecha exacta del borde de retroactividad", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    mockRegisterWorkerStock.mockResolvedValueOnce("del-borde")
    const res = await registerWorkerDeliveryAction(
      { ok: false, message: "" },
      makeFormData({ deliveredAt: earliestDeliveryDate() }),
    )
    expect(res.ok).toBe(true)
  })

  // El `max` del selector es sólo UX: el rechazo real vive acá.
  it("rejects a future delivery date", async () => {
    const today = todayInChile()
    const deliveredAt = addDaysToPlainDate(today, 1)
    mockAuthFn.mockResolvedValueOnce(makeSession())
    const res = await registerWorkerDeliveryAction({ ok: false, message: "" }, makeFormData({ deliveredAt }))
    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.deliveredAt).toBeDefined()
    expect(mockRegisterWorkerStock).not.toHaveBeenCalled()
  })
})
