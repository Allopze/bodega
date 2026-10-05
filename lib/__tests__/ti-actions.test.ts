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
const mockAssignTicket = vi.hoisted(() => vi.fn())
const mockAddTicketComment = vi.hoisted(() => vi.fn())
const mockGetUserIdsWithPermission = vi.hoisted(() => vi.fn())
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
  assignTicket: mockAssignTicket,
  addTicketComment: mockAddTicketComment,
}))
vi.mock("@/lib/services/notification-targeting", () => ({
  getUserIdsWithPermission: mockGetUserIdsWithPermission,
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
import {
  createTicketAction, transitionTicketAction, assignTicketAction, commentTicketAction,
} from "@/app/(app)/ti/tickets/actions"
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
      formOf({ subject: "Problema serio", description: "Descripción larga del problema detectado", category: "hardware", worksiteId: "ws-ti-norte" }),
    )
    expect(result.ok).toBe(false)
    expect(mockCreateTicket).not.toHaveBeenCalled()
  })

  it("acepta a un representante con ti:create_ticket", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:create_ticket"], ["ws-ti-norte"], ["admin_contrato"]))
    const result = await createTicketAction(
      { ok: false, message: "" },
      formOf({ subject: "Problema serio", description: "Descripción larga del problema detectado", category: "hardware", worksiteId: "ws-ti-norte" }),
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
      formOf({ subject: "Problema", description: "corto", category: "hardware", worksiteId: "ws-ti-norte" }),
    )
    expect(result.ok).toBe(false)
    expect(result.fieldErrors).toBeTruthy()
    expect(mockCreateTicket).not.toHaveBeenCalled()
  })

  it("exige elegir una categoría y la reporta bajo su propio campo", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:create_ticket"]))
    const result = await createTicketAction(
      { ok: false, message: "" },
      formOf({ subject: "Problema serio", description: "Descripción larga del problema detectado", worksiteId: "ws-ti-norte" }),
    )
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.category?.[0]).toBe("Selecciona una categoría")
    expect(mockCreateTicket).not.toHaveBeenCalled()
  })

  it("TIUX-05: tras un envío fallido devuelve lo escrito para no vaciar el formulario", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:create_ticket"]))
    const result = await createTicketAction(
      { ok: false, message: "" },
      formOf({ subject: "Problema", description: "corto", category: "software", worksiteId: "ws-ti-norte" }),
    )
    expect(result.ok).toBe(false)
    expect(result.data?.values).toEqual(expect.objectContaining({
      subject: "Problema", description: "corto", category: "software", worksiteId: "ws-ti-norte",
    }))
  })

  it("devuelve el código y la prioridad para el aviso de creación", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:create_ticket"], ["ws-ti-norte"], ["admin_contrato"]))
    const result = await createTicketAction(
      { ok: false, message: "" },
      formOf({ subject: "Problema serio", description: "Descripción larga del problema detectado", category: "hardware", worksiteId: "ws-ti-norte" }),
    )
    expect(result.message).toBe("INC-2026-0001 creado")
    expect(result.data).toEqual({ ticketId: "ticket-1", code: "INC-2026-0001", priority: "normal" })
  })

  it("notifica a ti:manage_tickets de la faena, sin autonotificar al creador", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:create_ticket"], ["ws-ti-norte"], ["admin_contrato"]))
    // El creador (user-ti-1) figura entre los destinatarios porque también
    // tiene ti:manage_tickets (caso típico: un técnico abre su propio ticket).
    mockGetUserIdsWithPermissionForWorksite.mockResolvedValue(["user-ti-1", "user-ti-2"])

    const result = await createTicketAction(
      { ok: false, message: "" },
      formOf({ subject: "Problema serio", description: "Descripción larga del problema detectado", category: "hardware", worksiteId: "ws-ti-norte" }),
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
      ...baseTransitionResult, toStatus: "resuelto", requesterUserId: "user-ti-1", resolution: "Se reemplazó el cargador",
    })
    await transitionTicketAction(
      { ok: false, message: "" },
      formOf({ ticketId: "t1", status: "resuelto", reason: "Listo", resolution: "Se reemplazó el cargador" }),
    )
    expect(mockTransitionTicket).toHaveBeenCalledTimes(2)
    expect(mockNotifyManyUser).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "ti_ticket_resolved" }),
    )
  })
  it("TIUX-04: la resolución mínima del cliente es la del servidor (10 caracteres) y el error va en su campo", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_tickets"]))
    const result = await transitionTicketAction(
      { ok: false, message: "" },
      formOf({ ticketId: "t1", status: "resuelto", reason: "Listo", resolution: "Arreglado" }),
    )
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.resolution?.[0]).toMatch(/al menos 10 caracteres/)
    expect(result.fieldErrors?.reason).toBeUndefined()
    expect(mockTransitionTicket).not.toHaveBeenCalled()
  })

  it("TIUX-04: cerrar sin resolución previa devuelve el error del servicio bajo Resolución", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_tickets"]))
    mockTransitionTicket.mockRejectedValue(new Error("Explica cómo se resolvió el ticket en al menos 10 caracteres"))
    const result = await transitionTicketAction(
      { ok: false, message: "" },
      formOf({ ticketId: "t1", status: "cerrado", reason: "Sin respuesta del usuario" }),
    )
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.resolution?.[0]).toMatch(/cómo se resolvió/)
    // Y conserva lo escrito.
    expect(result.data?.values).toEqual(expect.objectContaining({ reason: "Sin respuesta del usuario", status: "cerrado" }))
  })

  it("elegir un estado es obligatorio y el mensaje no muestra el enum", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_tickets"]))
    const result = await transitionTicketAction(
      { ok: false, message: "" },
      formOf({ ticketId: "t1", status: "", reason: "Motivo suficiente" }),
    )
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.status?.[0]).toBe("Elige el siguiente estado")
  })

  it("TIUX-31: avisa al solicitante cuando el ticket queda esperando al usuario, no si él mismo lo cambia", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_tickets"], ["ws-ti-norte"], ["admin_contrato"]))
    mockTransitionTicket.mockResolvedValue({ ...baseTransitionResult, toStatus: "esperando_usuario", requesterUserId: "user-requester" })
    await transitionTicketAction(
      { ok: false, message: "" },
      formOf({ ticketId: "t1", status: "esperando_usuario", reason: "Falta el número de serie" }),
    )
    expect(mockNotifyManyUser).toHaveBeenCalledTimes(1)
    expect(mockNotifyManyUser).toHaveBeenCalledWith(
      ["user-requester"],
      expect.objectContaining({ type: "ti_ticket_waiting_user", entityId: "t1" }),
    )
    // El motivo es una nota de TI: no viaja en el aviso.
    expect(JSON.stringify(mockNotifyManyUser.mock.calls[0])).not.toContain("número de serie")

    mockNotifyManyUser.mockClear()
    mockTransitionTicket.mockResolvedValue({ ...baseTransitionResult, toStatus: "esperando_usuario", requesterUserId: "user-ti-1" })
    await transitionTicketAction(
      { ok: false, message: "" },
      formOf({ ticketId: "t1", status: "esperando_usuario", reason: "Falta el número de serie" }),
    )
    expect(mockNotifyManyUser).not.toHaveBeenCalled()
  })
})

describe("ti:assignTicketAction", () => {
  beforeEach(() => {
    mockAuthFn.mockReset()
    mockAssignTicket.mockReset()
    mockNotifyManyUser.mockReset()
    mockNotifyAfterCommit.mockClear()
    mockGetUserIdsWithPermission.mockReset()
    mockGetUserIdsWithPermission.mockResolvedValue(["user-ti-1", "user-ti-2"])
    mockAssignTicket.mockResolvedValue({
      ...baseTransitionResult, fromStatus: "nuevo", toStatus: "asignado", assigneeChanged: true, assigneeUserId: "user-ti-2",
    })
  })

  it("niega sin ti:manage_tickets", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:create_ticket"]))
    const result = await assignTicketAction({ ok: false, message: "" }, formOf({ ticketId: "t1", assigneeUserId: "user-ti-2" }))
    expect(result.ok).toBe(false)
    expect(mockAssignTicket).not.toHaveBeenCalled()
  })

  it("asigna y avisa al técnico asignado", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_tickets"], ["ws-ti-norte"], ["admin_contrato"]))
    const result = await assignTicketAction({ ok: false, message: "" }, formOf({ ticketId: "t1", assigneeUserId: "user-ti-2" }))
    expect(result.ok).toBe(true)
    expect(mockAssignTicket).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: "t1", assigneeUserId: "user-ti-2" }),
      expect.objectContaining({ userId: "user-ti-1" }),
      ["ws-ti-norte"],
    )
    expect(mockNotifyManyUser).toHaveBeenCalledWith(["user-ti-2"], expect.objectContaining({ type: "ti_ticket_assigned" }))
  })

  it("«Asignarme» toma el responsable de la sesión, no del formulario, y no se autonotifica", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_tickets"], ["ws-ti-norte"], ["admin_contrato"]))
    mockAssignTicket.mockResolvedValue({
      ...baseTransitionResult, toStatus: "asignado", assigneeChanged: true, assigneeUserId: "user-ti-1",
    })
    const result = await assignTicketAction(
      { ok: false, message: "" },
      formOf({ ticketId: "t1", self: "1", assigneeUserId: "user-ti-2" }),
    )
    expect(result.ok).toBe(true)
    expect(mockAssignTicket).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeUserId: "user-ti-1" }),
      expect.anything(),
      expect.anything(),
    )
    expect(mockNotifyManyUser).not.toHaveBeenCalled()
  })

  it("no asigna a quien no gestiona tickets", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_tickets"]))
    const result = await assignTicketAction({ ok: false, message: "" }, formOf({ ticketId: "t1", assigneeUserId: "user-cualquiera" }))
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.assigneeUserId?.[0]).toMatch(/no gestiona tickets/)
    expect(mockAssignTicket).not.toHaveBeenCalled()
  })

  it("el motivo exigido al cambiar de responsable aparece bajo su campo y conserva lo escrito", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_tickets"]))
    mockAssignTicket.mockRejectedValue(new Error("Indica el motivo del cambio de responsable (mínimo 3 caracteres)"))
    const result = await assignTicketAction({ ok: false, message: "" }, formOf({ ticketId: "t1", assigneeUserId: "user-ti-2" }))
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.reason?.[0]).toMatch(/motivo del cambio de responsable/)
    expect(result.data?.values).toEqual(expect.objectContaining({ assigneeUserId: "user-ti-2" }))
  })
})

describe("ti:commentTicketAction", () => {
  const comment = { id: "c1", ticketId: "t1", code: "INC-2026-0001", subject: "Problema serio", requesterUserId: "user-requester" }
  beforeEach(() => {
    mockAuthFn.mockReset()
    mockAddTicketComment.mockReset()
    mockNotifyManyUser.mockReset()
    mockNotifyAfterCommit.mockClear()
    mockAddTicketComment.mockResolvedValue(comment)
  })

  it("TIUX-31: un comentario público de TI avisa al solicitante, una vez y con clave de deduplicación", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_tickets"], ["ws-ti-norte"], ["admin_contrato"]))
    const result = await commentTicketAction({ ok: false, message: "" }, formOf({ ticketId: "t1", body: "¿Puedes reiniciar el equipo?" }))
    expect(result.ok).toBe(true)
    expect(mockNotifyManyUser).toHaveBeenCalledTimes(1)
    expect(mockNotifyManyUser).toHaveBeenCalledWith(
      ["user-requester"],
      expect.objectContaining({ type: "ti_ticket_comment", dedupeKey: "ti_ticket_comment:c1" }),
    )
  })

  it("una nota interna no avisa a nadie", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_tickets", "ti:comment_internal"], ["ws-ti-norte"], ["admin_contrato"]))
    await commentTicketAction({ ok: false, message: "" }, formOf({ ticketId: "t1", body: "Ojo con este usuario", isInternal: "on" }))
    expect(mockNotifyManyUser).not.toHaveBeenCalled()
  })

  it("quien comenta no se avisa a sí mismo", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_tickets"], ["ws-ti-norte"], ["admin_contrato"]))
    mockAddTicketComment.mockResolvedValue({ ...comment, requesterUserId: "user-ti-1" })
    await commentTicketAction({ ok: false, message: "" }, formOf({ ticketId: "t1", body: "Comentario propio" }))
    expect(mockNotifyManyUser).not.toHaveBeenCalled()
  })

  it("el solicitante que responde no dispara el aviso de TI (solo ti:manage_tickets)", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:create_ticket"], ["ws-ti-norte"], ["admin_contrato"]))
    await commentTicketAction({ ok: false, message: "" }, formOf({ ticketId: "t1", body: "Ya reinicié el equipo" }))
    expect(mockNotifyManyUser).not.toHaveBeenCalled()
  })

  it("un comentario vacío conserva lo escrito y reporta el error en su campo", async () => {
    mockAuthFn.mockResolvedValue(makeSession(["ti:manage_tickets", "ti:comment_internal"]))
    const result = await commentTicketAction({ ok: false, message: "" }, formOf({ ticketId: "t1", body: "   ", isInternal: "on" }))
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.body?.[0]).toBe("Escribe un comentario")
    expect(result.data?.values).toEqual(expect.objectContaining({ isInternal: "on" }))
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
