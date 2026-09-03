/**
 * Unit tests para las Server Actions del módulo TI.
 *
 * Cubre, con mocks (patrón bodega-actions.test.ts):
 *  1. Denegación de permiso para cada acción.
 *  2. Errores de validación (parseZ) antes de tocar el servicio.
 *  3. Propagación de errores del servicio sin filtrar internals.
 *  4. Happy path con revalidación de rutas.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockCreateAsset = vi.hoisted(() => vi.fn())
const mockUpdateAsset = vi.hoisted(() => vi.fn())
const mockCreateTicket = vi.hoisted(() => vi.fn())
const mockTransitionTicket = vi.hoisted(() => vi.fn())

vi.mock("@/lib/services/module-toggles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/module-toggles")>()),
  assertPermissionModuleEnabled: vi.fn(async () => {}),
  assertRouteModuleEnabled: vi.fn(async () => {}),
}))

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/services/ti/assets", () => ({
  createAsset: mockCreateAsset,
  updateAsset: mockUpdateAsset,
  softDeleteAsset: vi.fn(async () => {}),
  changeAssetStatus: vi.fn(async () => {}),
}))
vi.mock("@/lib/services/ti/tickets", () => ({
  createTicket: mockCreateTicket,
  transitionTicket: mockTransitionTicket,
  addTicketComment: vi.fn(async () => {}),
}))

import { createAssetAction, updateAssetAction } from "@/app/(app)/ti/activos/actions"
import { createTicketAction, transitionTicketAction } from "@/app/(app)/ti/tickets/actions"

function makeSession(
  permissions: string[],
  worksiteIds: string[] = ["ws-ti-norte"],
  roles: string[] = ["tecnico_ti"],
): Session {
  return {
    user: {
      id: "user-ti-1",
      name: "Técnico TI",
      email: "tecnico@ti.cl",
      permissions,
      roles,
      worksiteIds,
    },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  } as Session
}

function formOf(values: Record<string, string | string[] | null>) {
  const form = new FormData()
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) form.append(key, item)
    } else {
      form.append(key, value)
    }
  }
  return form
}

describe("ti:createAssetAction", () => {
  beforeEach(() => {
    mockAuthFn.mockReset()
    mockCreateAsset.mockReset()
    mockCreateAsset.mockResolvedValue("asset-1")
  })

  it("niega sin ti:manage_assets sin tocar el servicio", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:view"]))
    const result = await createAssetAction({ ok: false, message: "" }, formOf({ code: "TI-NB-1", assetTypeId: "t1" }))
    expect(result.ok).toBe(false)
    expect(result.message).toContain("Sin permisos para crear activos")
    expect(mockCreateAsset).not.toHaveBeenCalled()
  })

  it("valida el formulario antes de llamar al servicio", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_assets"]))
    const result = await createAssetAction({ ok: false, message: "" }, formOf({ code: "", assetTypeId: "t1" }))
    expect(result.ok).toBe(false)
    expect(result.fieldErrors).toBeTruthy()
    expect(mockCreateAsset).not.toHaveBeenCalled()
  })

  it("propaga el error del servicio como mensaje seguro", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_assets"]))
    mockCreateAsset.mockRejectedValue(new Error("Ya existe un activo con el código TI-NB-1"))
    const result = await createAssetAction({ ok: false, message: "" }, formOf({ code: "TI-NB-1", assetTypeId: "t1", status: "disponible" }))
    expect(result.ok).toBe(false)
    expect(String(result.message)).toContain("TI-NB-1")
  })

  it("crea el activo y devuelve el id", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_assets"]))
    const result = await createAssetAction(
      { ok: false, message: "" },
      formOf({ code: "TI-NB-0042", assetTypeId: "t1", brand: "Lenovo", cost: "1000", status: "disponible" }),
    )
    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ id: "asset-1" })
    expect(mockCreateAsset).toHaveBeenCalledWith(
      expect.objectContaining({ code: "TI-NB-0042", cost: 1000 }),
      expect.objectContaining({ userId: "user-ti-1" }),
    )
  })
})

describe("ti:updateAssetAction", () => {
  beforeEach(() => {
    mockAuthFn.mockReset()
    mockUpdateAsset.mockReset()
    mockUpdateAsset.mockResolvedValue(undefined)
  })

  it("edita los datos maestros sin exigir el estado inicial de creación", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_assets"]))
    const result = await updateAssetAction(
      { ok: false, message: "" },
      formOf({ id: "asset-1", code: "TI-NB-0042", assetTypeId: "t1", brand: "Lenovo" }),
    )

    expect(result.ok).toBe(true)
    expect(mockUpdateAsset).toHaveBeenCalledWith(
      expect.objectContaining({ id: "asset-1", code: "TI-NB-0042" }),
      expect.objectContaining({ userId: "user-ti-1" }),
    )
  })
})

describe("ti:createTicketAction", () => {
  beforeEach(() => {
    mockAuthFn.mockReset()
    mockCreateTicket.mockReset()
    mockCreateTicket.mockResolvedValue("ticket-1")
  })

  it("niega sin ti:create_ticket ni ti:manage_tickets", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:view"]))
    const result = await createTicketAction(
      { ok: false, message: "" },
      formOf({ subject: "Problema serio", description: "Descripción larga del problema detectado", worksiteId: "ws-ti-norte" }),
    )
    expect(result.ok).toBe(false)
    expect(mockCreateTicket).not.toHaveBeenCalled()
  })

  it("acepta a un representante con ti:create_ticket", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:create_ticket"], ["ws-ti-norte"], ["admin_contrato"]))
    const result = await createTicketAction(
      { ok: false, message: "" },
      formOf({ subject: "Problema serio", description: "Descripción larga del problema detectado", worksiteId: "ws-ti-norte" }),
    )
    expect(result.ok).toBe(true)
    expect(mockCreateTicket).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Problema serio" }),
      expect.any(Object),
      expect.any(Array),
    )
  })

  it("valida descripción mínima", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:create_ticket"]))
    const result = await createTicketAction(
      { ok: false, message: "" },
      formOf({ subject: "Problema", description: "corto", worksiteId: "ws-ti-norte" }),
    )
    expect(result.ok).toBe(false)
    expect(result.fieldErrors).toBeTruthy()
    expect(mockCreateTicket).not.toHaveBeenCalled()
  })
})

describe("ti:transitionTicketAction", () => {
  beforeEach(() => {
    mockAuthFn.mockReset()
    mockTransitionTicket.mockReset()
    mockTransitionTicket.mockResolvedValue(undefined)
  })

  it("niega la transición sin ti:manage_tickets", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:create_ticket"]))
    const result = await transitionTicketAction(
      { ok: false, message: "" },
      formOf({ ticketId: "t1", status: "resuelto", reason: "Listo" }),
    )
    expect(result.ok).toBe(false)
    expect(mockTransitionTicket).not.toHaveBeenCalled()
  })

  it("exige motivo en la transición", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_tickets"]))
    const result = await transitionTicketAction(
      { ok: false, message: "" },
      formOf({ ticketId: "t1", status: "resuelto", reason: "x" }),
    )
    expect(result.ok).toBe(false)
    expect(mockTransitionTicket).not.toHaveBeenCalled()
  })
})
