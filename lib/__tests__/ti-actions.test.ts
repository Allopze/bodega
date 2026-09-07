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
const mockGetUserIdsWithPermissionForWorksite = vi.hoisted(() => vi.fn())
const mockNotifyManyUser = vi.hoisted(() => vi.fn())
// Ejecuta el thunk de inmediato: sin esto las notificaciones (diferidas a
// `queueMicrotask`) no se podrían assertear sin manipular timers.
const mockNotifyAfterCommit = vi.hoisted(() => vi.fn((fn: () => void) => fn()))

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
const mockVoidMaintenance = vi.hoisted(() => vi.fn())
vi.mock("@/lib/services/ti/maintenance", () => ({
  createMaintenance: vi.fn(async () => "maintenance-1"),
  updateMaintenance: vi.fn(async () => {}),
  voidMaintenance: mockVoidMaintenance,
}))
vi.mock("@/lib/services/notifications", () => ({
  getUserIdsWithPermissionForWorksite: mockGetUserIdsWithPermissionForWorksite,
  notifyManyUser: mockNotifyManyUser,
  notifyAfterCommit: mockNotifyAfterCommit,
}))

import { createAssetAction, updateAssetAction } from "@/app/(app)/ti/activos/actions"
import { createTicketAction, transitionTicketAction } from "@/app/(app)/ti/tickets/actions"
import { voidMaintenanceAction } from "@/app/(app)/ti/mantenciones/actions"

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
      expect.anything(),
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
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_assets"], ["ws-ti-norte"], ["admin_contrato"]))
    const result = await updateAssetAction(
      { ok: false, message: "" },
      formOf({ id: "asset-1", code: "TI-NB-0042", assetTypeId: "t1", brand: "Lenovo" }),
    )

    expect(result.ok).toBe(true)
    expect(mockUpdateAsset).toHaveBeenCalledWith(
      expect.objectContaining({ id: "asset-1", code: "TI-NB-0042" }),
      expect.objectContaining({ userId: "user-ti-1" }),
      ["ws-ti-norte"],
    )
  })
})

const baseTicketCreated = {
  id: "ticket-1", code: "INC-2026-0001", subject: "Problema serio", priority: "normal",
  worksiteId: "ws-ti-norte", requesterUserId: "user-ti-1", assetId: null,
}

const baseTransitionResult = {
  id: "t1", code: "INC-2026-0001", subject: "Comienza diagnóstico", priority: "normal",
  worksiteId: "ws-ti-norte", requesterUserId: "user-requester", assetId: null,
  fromStatus: "nuevo", toStatus: "en_progreso", statusChanged: true,
  previousAssigneeUserId: null, assigneeUserId: null, assigneeChanged: false,
  resolution: null,
}

describe("ti:createTicketAction", () => {
  beforeEach(() => {
    mockAuthFn.mockReset()
    mockCreateTicket.mockReset()
    mockGetUserIdsWithPermissionForWorksite.mockReset()
    mockNotifyManyUser.mockReset()
    mockNotifyAfterCommit.mockClear()
    mockCreateTicket.mockResolvedValue(baseTicketCreated)
    mockGetUserIdsWithPermissionForWorksite.mockResolvedValue(["user-ti-1", "user-ti-2"])
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

  it("notifica a ti:manage_tickets de la faena, sin autonotificar al creador", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:create_ticket"], ["ws-ti-norte"], ["admin_contrato"]))
    // El creador (user-ti-1) figura entre los destinatarios porque también
    // tiene ti:manage_tickets (caso típico: un técnico abre su propio ticket).
    mockGetUserIdsWithPermissionForWorksite.mockResolvedValue(["user-ti-1", "user-ti-2"])

    const result = await createTicketAction(
      { ok: false, message: "" },
      formOf({ subject: "Problema serio", description: "Descripción larga del problema detectado", worksiteId: "ws-ti-norte" }),
    )

    expect(result.ok).toBe(true)
    expect(mockGetUserIdsWithPermissionForWorksite).toHaveBeenCalledWith("ti:manage_tickets", "ws-ti-norte")
    expect(mockNotifyManyUser).toHaveBeenCalledWith(
      ["user-ti-2"],
      expect.objectContaining({ type: "ti_ticket_created", entityId: "ticket-1" }),
    )
  })
})

describe("ti:transitionTicketAction", () => {
  beforeEach(() => {
    mockAuthFn.mockReset()
    mockTransitionTicket.mockReset()
    mockNotifyManyUser.mockReset()
    mockNotifyAfterCommit.mockClear()
    mockTransitionTicket.mockResolvedValue(baseTransitionResult)
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

  it("no reasigna silenciosamente el ticket al usuario que cambia el estado", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_tickets"], ["ws-ti-norte"], ["admin_contrato"]))
    const result = await transitionTicketAction(
      { ok: false, message: "" },
      formOf({ ticketId: "t1", status: "en_progreso", reason: "Comienza diagnóstico" }),
    )

    expect(result.ok).toBe(true)
    expect(mockTransitionTicket).toHaveBeenCalledWith(
      // `assigneeUserId: null` = "sin cambio": la transición no reasigna sola,
      // pero ya existe el campo para asignar explícitamente.
      { ticketId: "t1", status: "en_progreso", reason: "Comienza diagnóstico", resolution: null, assigneeUserId: null },
      expect.objectContaining({ userId: "user-ti-1" }),
      ["ws-ti-norte"],
    )
  })

  it("no notifica una asignación cuando el asignado no cambió (regresión del spam del <Select>)", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_tickets"], ["ws-ti-norte"], ["admin_contrato"]))
    // El asignado tiene que ser OTRO usuario, no el actor: si fuera el actor,
    // la aserción negativa también pasaría con una implementación que mirara
    // solo `assigneeUserId !== session.user.id` e ignorara `assigneeChanged`
    // — justo la regresión que este test existe para atrapar.
    mockTransitionTicket.mockResolvedValue({ ...baseTransitionResult, assigneeChanged: false, assigneeUserId: "user-ti-2", previousAssigneeUserId: "user-ti-2" })

    await transitionTicketAction(
      { ok: false, message: "" },
      formOf({ ticketId: "t1", status: "en_progreso", reason: "Sigue trabajando en esto" }),
    )

    expect(mockNotifyManyUser).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "ti_ticket_assigned" }),
    )
  })

  it("notifica al nuevo asignado cuando la asignación cambia a otro técnico", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_tickets"], ["ws-ti-norte"], ["admin_contrato"]))
    mockTransitionTicket.mockResolvedValue({
      ...baseTransitionResult, assigneeChanged: true, assigneeUserId: "user-ti-2", previousAssigneeUserId: null,
    })

    await transitionTicketAction(
      { ok: false, message: "" },
      formOf({ ticketId: "t1", status: "asignado", reason: "Lo toma otro técnico", assigneeUserId: "user-ti-2" }),
    )

    expect(mockNotifyManyUser).toHaveBeenCalledWith(
      ["user-ti-2"],
      expect.objectContaining({ type: "ti_ticket_assigned", entityId: "t1" }),
    )
  })

  it("no notifica la autoasignación", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_tickets"], ["ws-ti-norte"], ["admin_contrato"]))
    // El actor (user-ti-1) se autoasigna: assigneeChanged es true pero el
    // nuevo asignado es el mismo que ejecuta la transición.
    mockTransitionTicket.mockResolvedValue({
      ...baseTransitionResult, assigneeChanged: true, assigneeUserId: "user-ti-1", previousAssigneeUserId: null,
    })

    await transitionTicketAction(
      { ok: false, message: "" },
      formOf({ ticketId: "t1", status: "asignado", reason: "Lo tomo yo", assigneeUserId: "user-ti-1" }),
    )

    expect(mockNotifyManyUser).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "ti_ticket_assigned" }),
    )
  })

  it("notifica al solicitante cuando el ticket se resuelve, salvo que él mismo lo resuelva", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_tickets"], ["ws-ti-norte"], ["admin_contrato"]))
    mockTransitionTicket.mockResolvedValue({
      ...baseTransitionResult, toStatus: "resuelto", requesterUserId: "user-requester", resolution: "Se reemplazó el cargador",
    })

    await transitionTicketAction(
      { ok: false, message: "" },
      formOf({ ticketId: "t1", status: "resuelto", reason: "Listo", resolution: "Se reemplazó el cargador" }),
    )

    expect(mockNotifyManyUser).toHaveBeenCalledWith(
      ["user-requester"],
      expect.objectContaining({ type: "ti_ticket_resolved", entityId: "t1" }),
    )

    mockNotifyManyUser.mockClear()
    mockTransitionTicket.mockResolvedValue({
      ...baseTransitionResult, toStatus: "resuelto", requesterUserId: "user-ti-1", resolution: "Listo",
    })
    await transitionTicketAction(
      { ok: false, message: "" },
      formOf({ ticketId: "t1", status: "resuelto", reason: "Listo", resolution: "Listo" }),
    )
    expect(mockNotifyManyUser).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "ti_ticket_resolved" }),
    )
  })
})

describe("ti:voidMaintenanceAction", () => {
  beforeEach(() => {
    mockAuthFn.mockReset()
    mockVoidMaintenance.mockReset()
    mockVoidMaintenance.mockResolvedValue({ assetId: "asset-1" })
  })

  it("niega la anulación sin ti:manage_maintenance", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:view"]))
    const result = await voidMaintenanceAction(
      { ok: false, message: "" },
      formOf({ id: "maint-1", reason: "Motivo suficientemente largo" }),
    )
    expect(result.ok).toBe(false)
    expect(mockVoidMaintenance).not.toHaveBeenCalled()
  })

  it("exige un motivo de al menos 10 caracteres", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_maintenance"]))
    const result = await voidMaintenanceAction(
      { ok: false, message: "" },
      formOf({ id: "maint-1", reason: "corto" }),
    )
    expect(result.ok).toBe(false)
    expect(result.fieldErrors).toBeTruthy()
    expect(mockVoidMaintenance).not.toHaveBeenCalled()
  })

  it("anula con permiso y motivo válido", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_maintenance"], ["ws-ti-norte"], ["tecnico_ti"]))
    const result = await voidMaintenanceAction(
      { ok: false, message: "" },
      formOf({ id: "maint-1", reason: "Se registró en el equipo equivocado" }),
    )
    expect(result.ok).toBe(true)
    expect(mockVoidMaintenance).toHaveBeenCalledWith(
      "maint-1", "Se registró en el equipo equivocado",
      expect.objectContaining({ userId: "user-ti-1" }),
      "all", // tecnico_ti es un rol global: serviceWorksiteScope no acota
    )
  })
})
