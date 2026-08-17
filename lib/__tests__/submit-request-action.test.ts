/**
 * Unit tests for submitRequest (solicitudes/actions.ts).
 *
 * Desde la simplificación del flujo (2026-08-07) la acción tiene dos caminos:
 *  A. Sin `requestId` — EPP/otro se crean y envían en un solo acto.
 *  B. Con `requestId` — sólo repuestos/servicios, que envían un borrador ya
 *     guardado con sus cotizaciones adjuntas.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { redirect } from "next/navigation"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT") }),
}))

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockFindFirst = vi.hoisted(() => vi.fn())
const mockCreateSubmitted = vi.hoisted(() => vi.fn())
const mockSubmitRepuesto = vi.hoisted(() => vi.fn())
const mockSubmitService = vi.hoisted(() => vi.fn())
const mockPersistRepuestoDraft = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("@/db", () => ({
  db: {
    query: { purchaseRequests: { findFirst: mockFindFirst } },
    // Sólo lo usa la comprobación de productos inactivos; los ítems de estas
    // pruebas son de texto libre, así que nunca llega a resolverse.
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/services/notifications", () => ({
  notifyManyUser: vi.fn(),
  getUserIdsWithPermission: vi.fn().mockResolvedValue([]),
  notifyAfterCommit: vi.fn((fn: () => Promise<unknown>) => fn()),
  notifySafe: vi.fn(),
}))
vi.mock("@/lib/services/requests-draft", () => ({ createSubmittedRequest: mockCreateSubmitted }))
vi.mock("@/lib/services/repuestos", () => ({
  submitRepuestoRequest: mockSubmitRepuesto,
  persistRepuestoDraft: mockPersistRepuestoDraft,
  addQuotation: vi.fn(),
}))
vi.mock("@/lib/services/servicios", () => ({
  submitServiceRequest: mockSubmitService,
  persistServiceDraft: vi.fn(),
  addServiceQuotation: vi.fn(),
}))
vi.mock("@/lib/services/system-settings", () => ({ getPdfMaxSizeMb: vi.fn().mockResolvedValue(10) }))

import { submitRequest } from "@/app/(app)/solicitudes/actions"
import type { ActionState } from "@/lib/validation/operations"

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "user@test.cl",
      name: "User",
      roles: ["solicitante_faena"],
      permissions: ["requests:create"],
      worksiteIds: ["ws-1"],
      primaryWorksiteId: "ws-1",
      avatarColor: "#000",
      isActive: true,
      ...overrides,
    },
  }
}

/** Formulario de creación directa (sin `requestId`). */
/**
 * `requestSchema` rechaza una fecha requerida en el pasado contra el día civil de
 * Chile, así que esta fecha **no puede estar quemada**: cuando lo estuvo
 * (`2026-08-15`) la suite entera se puso roja sola al día siguiente, sin que
 * cambiara una línea de código. Se calcula relativa a hoy por esa razón.
 */
const REQUIRED_DATE = addDaysToPlainDate(todayInChile(), 30)

function makeCreateFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set("worksiteId", "ws-1")
  fd.set("requestType", "epp")
  fd.set("urgency", "normal")
  fd.set("requiredDate", REQUIRED_DATE)
  fd.set("notes", "")
  fd.set("itemsJson", JSON.stringify([{
    productId: null, productNameFree: "Guantes de cabritilla", quantity: 2,
    unitOfMeasure: "par", urgency: "normal", attributes: [],
  }]))
  for (const [k, v] of Object.entries(overrides)) {
    if (v === "") fd.delete(k)
    else fd.set(k, v)
  }
  return fd
}

const prevState: ActionState = { ok: false, message: "" }

describe("submitRequest — creación directa (EPP/otro)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(redirect).mockImplementation(() => { throw new Error("NEXT_REDIRECT") })
    mockCreateSubmitted.mockResolvedValue({ requestId: "req-nueva", code: "SOL-2026-0007" })
  })

  it("crea la solicitud ya enviada y redirige a su detalle", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    await expect(submitRequest(prevState, makeCreateFormData())).rejects.toThrow("NEXT_REDIRECT")
    expect(mockCreateSubmitted).toHaveBeenCalledWith("user-1", "user@test.cl", expect.objectContaining({
      worksiteId: "ws-1",
      requestType: "epp",
      requiredDate: REQUIRED_DATE,
    }))
    expect(redirect).toHaveBeenCalledWith("/solicitudes/req-nueva")
  })

  it("rechaza a quien no puede crear ese tipo de solicitud", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession({ permissions: [] }))
    const res = await submitRequest(prevState, makeCreateFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/permisos/i)
    expect(mockCreateSubmitted).not.toHaveBeenCalled()
  })

  it("rechaza sin fecha requerida", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    const res = await submitRequest(prevState, makeCreateFormData({ requiredDate: "" }))
    expect(res.ok).toBe(false)
    expect(mockCreateSubmitted).not.toHaveBeenCalled()
  })

  it("rechaza sin ítems", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    const res = await submitRequest(prevState, makeCreateFormData({ itemsJson: "[]" }))
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/ítems|items/i)
    expect(mockCreateSubmitted).not.toHaveBeenCalled()
  })

  it("rechaza una faena fuera del alcance del usuario", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    const res = await submitRequest(prevState, makeCreateFormData({ worksiteId: "ws-ajena" }))
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/faena/i)
    expect(mockCreateSubmitted).not.toHaveBeenCalled()
  })

  // Repuestos/servicios no se crean enviados: el formulario completo persiste
  // su borrador (por si el usuario pulsó enviar con cambios sin guardar) y sólo
  // después entra al envío por cotización.
  it("con repuestos guarda el borrador en vez de crear una solicitud enviada", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession({ permissions: ["repuestos:create", "repuestos:submit"] }))
    mockPersistRepuestoDraft.mockResolvedValueOnce("req-repuesto")
    mockFindFirst.mockResolvedValueOnce({
      id: "req-repuesto", status: "draft", worksiteId: "ws-1", requesterId: "user-1",
      requestType: "repuestos", code: "SOL-2026-0009", requiredDate: REQUIRED_DATE,
      items: [{ id: "item-1", status: "draft", productId: null }],
    })
    mockSubmitRepuesto.mockResolvedValueOnce(undefined)

    await expect(submitRequest(prevState, makeCreateFormData({ requestType: "repuestos" })))
      .rejects.toThrow("NEXT_REDIRECT")
    expect(mockCreateSubmitted).not.toHaveBeenCalled()
    expect(mockPersistRepuestoDraft).toHaveBeenCalled()
    expect(mockSubmitRepuesto).toHaveBeenCalledWith(expect.objectContaining({ requestId: "req-repuesto" }))
  })

  // UX-5: antes de este fix, cualquier tipo notificaba a "approvals:approve"
  // (el permiso de EPP/otro); una solicitud de repuestos nunca llegaba a
  // quien de verdad tiene "repuestos:approve".
  it("notifica a approvals:approve para EPP/otro", async () => {
    const { getUserIdsWithPermission } = await import("@/lib/services/notifications")
    mockAuthFn.mockResolvedValueOnce(makeSession())
    await expect(submitRequest(prevState, makeCreateFormData())).rejects.toThrow("NEXT_REDIRECT")
    expect(getUserIdsWithPermission).toHaveBeenCalledWith("approvals:approve")
  })

  it("notifica a repuestos:approve (no approvals:approve) al enviar un borrador de repuestos", async () => {
    const { getUserIdsWithPermission } = await import("@/lib/services/notifications")
    mockAuthFn.mockResolvedValueOnce(makeSession({ permissions: ["repuestos:create", "repuestos:submit"] }))
    mockPersistRepuestoDraft.mockResolvedValueOnce("req-repuesto")
    mockFindFirst.mockResolvedValueOnce({
      id: "req-repuesto", status: "draft", worksiteId: "ws-1", requesterId: "user-1",
      requestType: "repuestos", code: "SOL-2026-0009", requiredDate: REQUIRED_DATE,
      items: [{ id: "item-1", status: "draft", productId: null }],
    })
    mockSubmitRepuesto.mockResolvedValueOnce(undefined)

    await expect(submitRequest(prevState, makeCreateFormData({ requestType: "repuestos" })))
      .rejects.toThrow("NEXT_REDIRECT")
    expect(getUserIdsWithPermission).toHaveBeenCalledWith("repuestos:approve")
    expect(getUserIdsWithPermission).not.toHaveBeenCalledWith("approvals:approve")
  })
})

describe("submitRequest — envío de un borrador (repuestos/servicios)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(redirect).mockImplementation(() => { throw new Error("NEXT_REDIRECT") })
    mockFindFirst.mockResolvedValue({
      id: "req-1",
      status: "draft",
      worksiteId: "ws-1",
      requesterId: "user-1",
      requestType: "repuestos",
      code: "SOL-2026-0001",
      requiredDate: REQUIRED_DATE,
      items: [{ id: "item-1", status: "draft", productId: null }],
    })
    mockSubmitRepuesto.mockResolvedValue(undefined)
  })

  function draftFormData() {
    const fd = new FormData()
    fd.set("requestId", "req-1")
    return fd
  }

  it("envía el borrador y redirige a su detalle", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession({ permissions: ["repuestos:create", "repuestos:submit"] }))
    await expect(submitRequest(prevState, draftFormData())).rejects.toThrow("NEXT_REDIRECT")
    expect(mockSubmitRepuesto).toHaveBeenCalledWith(expect.objectContaining({ requestId: "req-1", userId: "user-1" }))
    expect(redirect).toHaveBeenCalledWith("/solicitudes/req-1")
  })

  it("devuelve error si la solicitud no existe", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession({ permissions: ["repuestos:submit"] }))
    mockFindFirst.mockResolvedValueOnce(null)
    const res = await submitRequest(prevState, draftFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("no encontrada")
  })

  it("rechaza un tipo de solicitud desconocido", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession({ permissions: ["repuestos:submit"] }))
    mockFindFirst.mockResolvedValueOnce({
      id: "req-1", status: "draft", worksiteId: "ws-1", requesterId: "user-1",
      requestType: "invalid_type", code: "SOL-2026-0001", items: [{ id: "item-1", status: "draft" }],
    })
    const res = await submitRequest(prevState, draftFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("no soportado")
  })

  it("redirige a EPP/otro al creador: por esta vía ya no se envían", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    mockFindFirst.mockResolvedValueOnce({
      id: "req-1", status: "draft", worksiteId: "ws-1", requesterId: "user-1",
      requestType: "epp", code: "SOL-2026-0001", items: [{ id: "item-1", status: "draft" }],
    })
    const res = await submitRequest(prevState, draftFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/un solo paso/i)
  })

  it("devuelve error si no es su solicitud y no puede ver todas", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession({ permissions: ["repuestos:submit"] }))
    mockFindFirst.mockResolvedValueOnce({
      id: "req-1", status: "draft", worksiteId: "ws-1", requesterId: "otro-user",
      requestType: "repuestos", code: "SOL-2026-0001", requiredDate: REQUIRED_DATE,
      items: [{ id: "item-1", status: "draft", productId: null }],
    })
    const res = await submitRequest(prevState, draftFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/propia/i)
  })

  it("devuelve error si no hay fecha requerida ni en la solicitud ni en los ítems", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession({ permissions: ["repuestos:submit"] }))
    mockFindFirst.mockResolvedValueOnce({
      id: "req-1", status: "draft", worksiteId: "ws-1", requesterId: "user-1",
      requestType: "repuestos", code: "SOL-2026-0001", requiredDate: null,
      items: [{ id: "item-1", status: "draft", requiredDate: null, productId: null }],
    })
    const res = await submitRequest(prevState, draftFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/fecha requerida/i)
  })
})
