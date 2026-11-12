import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * El Excel de la lista comparte filtros con la URL. `exportFiltersSchema` descarta en silencio lo que
 * no declara: sin `partsPending` el botón exportaba TODAS las OT aunque la lista mostrara sólo las que
 * esperan repuesto.
 */

const guard = vi.hoisted(() => vi.fn())
const exportWorkOrders = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({ db: {} }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/auth/can", () => ({ guardAnyPermission: guard }))
vi.mock("@/lib/services/mantencion/work-orders/export", () => ({ exportWorkOrders }))
vi.mock("@/lib/services/mantencion/work-orders/create", () => ({ createWorkOrder: vi.fn() }))

const { exportWorkOrdersAction } = await import("./actions")

const SESSION = { user: { id: "u-jefe" } }

describe("exportWorkOrdersAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guard.mockResolvedValue({ session: SESSION })
    exportWorkOrders.mockResolvedValue({ ok: true, data: { base64: "", filename: "ordenes.xlsx", truncated: false, rowLimit: 5000 } })
  })

  it("pasa el filtro de repuestos pendientes al servicio de exportación", async () => {
    await exportWorkOrdersAction({ tab: "abiertas", partsPending: true })
    expect(exportWorkOrders).toHaveBeenCalledWith({ session: SESSION, filters: { tab: "abiertas", partsPending: true } })
  })

  it("sin el filtro exporta como siempre", async () => {
    await exportWorkOrdersAction({ tab: "abiertas" })
    expect(exportWorkOrders).toHaveBeenCalledWith({ session: SESSION, filters: { tab: "abiertas" } })
  })

  it("rechaza un valor que no es booleano en vez de ignorarlo", async () => {
    const result = await exportWorkOrdersAction({ tab: "abiertas", partsPending: "pendientes" as unknown as boolean })
    expect(result).toEqual({ ok: false, message: "Los filtros de la exportación no son válidos." })
    expect(exportWorkOrders).not.toHaveBeenCalled()
  })

  it("no exporta sin permiso", async () => {
    guard.mockResolvedValue({ error: { ok: false, message: "Sin permiso" } })
    expect(await exportWorkOrdersAction({ tab: "abiertas" })).toEqual({ ok: false, message: "Sin permiso" })
    expect(exportWorkOrders).not.toHaveBeenCalled()
  })

  it("rechaza una fecha que no existe (2026-02-31) en vez de dejar que reviente el SQL del Excel", async () => {
    const result = await exportWorkOrdersAction({ tab: "abiertas", from: "2026-02-31" })
    expect(result).toMatchObject({ ok: false })
    expect(exportWorkOrders).not.toHaveBeenCalled()
  })

  it("acepta un rango de fechas reales", async () => {
    await exportWorkOrdersAction({ tab: "abiertas", from: "2026-02-01", to: "2026-02-28" })
    expect(exportWorkOrders).toHaveBeenCalledWith({ session: SESSION, filters: { tab: "abiertas", from: "2026-02-01", to: "2026-02-28" } })
  })
})
