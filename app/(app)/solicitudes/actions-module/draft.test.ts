/**
 * Borrador de solicitud → servicio: qué ítem le llega a `persistRepuestoDraft`
 * cuando el formulario manda un repuesto del catálogo (`productId`) y qué le llega
 * a servicios, que no ofrece catálogo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

const persistRepuestoDraft = vi.fn(async () => "req-rep")
const persistServiceDraft = vi.fn(async () => "req-srv")

vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth/can", () => ({
  requireAuth: vi.fn(),
  can: () => true,
  canAccessWorksite: () => true,
}))
vi.mock("@/lib/services/repuestos", () => ({ persistRepuestoDraft, addQuotation: vi.fn() }))
vi.mock("@/lib/services/servicios", () => ({ persistServiceDraft, addServiceQuotation: vi.fn() }))
vi.mock("@/lib/services/system-settings", () => ({ getPdfMaxSizeMb: vi.fn(async () => 10) }))
vi.mock("@/lib/services/operational-cache", () => ({ revalidateOperationalViews: vi.fn() }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

const { persistDraft } = await import("./draft")

const session = { user: { id: "u-1", email: "u@chome.test", permissions: [], roles: [], worksiteIds: ["ws-1"] } } as unknown as Session

function form(requestType: string, items: Record<string, unknown>[]) {
  const data = new FormData()
  data.set("worksiteId", "ws-1")
  data.set("requestType", requestType)
  data.set("urgency", "normal")
  data.set("deliveryMode", "directo_faena")
  data.set("requiredDate", "2099-12-01")
  data.set("notes", "")
  data.set("itemsJson", JSON.stringify(items))
  return data
}

const ITEM = { quantity: 2, unitOfMeasure: "unidad", urgency: "normal", attributes: [] }

type DraftCall = { items: { productId?: string | null; description: string }[] }
const lastInput = (mock: typeof persistRepuestoDraft) => (mock.mock.calls.at(-1) as unknown as [Session, DraftCall])[1]

describe("persistDraft (acción de borrador)", () => {
  beforeEach(() => {
    persistRepuestoDraft.mockClear()
    persistServiceDraft.mockClear()
  })

  it("repuestos: un repuesto de catálogo viaja como producto y sin descripción", async () => {
    const result = await persistDraft(session, form("repuestos", [{ ...ITEM, productId: "rpt-1", productNameFree: null }]))

    expect(result).toMatchObject({ ok: true, requestId: "req-rep" })
    expect(lastInput(persistRepuestoDraft).items[0]).toMatchObject({ productId: "rpt-1", description: "" })
  })

  it("repuestos: el texto libre sigue siendo la descripción, sin producto", async () => {
    await persistDraft(session, form("repuestos", [{ ...ITEM, productId: null, productNameFree: "  Manguera hidráulica " }]))

    expect(lastInput(persistRepuestoDraft).items[0]).toMatchObject({ productId: null, description: "Manguera hidráulica" })
  })

  it("repuestos: un ítem sin producto ni descripción lo rechaza el esquema, no el servicio", async () => {
    const result = await persistDraft(session, form("repuestos", [{ ...ITEM, productId: null, productNameFree: "" }]))

    expect(result.ok).toBe(false)
    expect(persistRepuestoDraft).not.toHaveBeenCalled()
  })

  it("servicios no ofrece catálogo: nunca manda producto", async () => {
    await persistDraft(session, form("servicios", [{ ...ITEM, productId: "rpt-1", productNameFree: "Cambio de filtros", location: "Taller" }]))

    expect(lastInput(persistServiceDraft).items[0]).toMatchObject({ productId: null, description: "Cambio de filtros" })
  })
})
