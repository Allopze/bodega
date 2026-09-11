"use server"

import { revalidatePath } from "next/cache"
import { recordAudit } from "@/lib/audit"
import { safeActionMessage } from "@/lib/action-error"
import { requirePermission } from "@/lib/auth/can"
import {
  addWorkerPositionAlias,
  createWorkerCapability,
  createWorkerPosition,
  mergeWorkerPositions,
  removeWorkerPositionAlias,
  replaceWorkerPositionCapabilities,
  updateWorkerCapability,
  updateWorkerPosition,
  WorkerPositionDomainError,
} from "@/lib/services/worker-positions"
import type { ActionState } from "@/lib/form-state"

const CATALOG_PATH = "/admin/cargos"
const WORKERS_PATH = "/admin/trabajadores"

type CatalogSession = Awaited<ReturnType<typeof requirePermission>>

function stringField(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === "string" ? value.trim() : ""
}

function checked(formData: FormData, key: string, defaultValue = false): boolean {
  const value = formData.get(key)
  if (value === null) return defaultValue
  return value === "on" || value === "true" || value === "1"
}

function capabilityIds(formData: FormData): string[] {
  return [...new Set(formData.getAll("capabilityIds")
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean))]
}

/**
 * Envoltura común de toda mutación del catálogo: exige el permiso, traduce los
 * errores de dominio a un mensaje accionable y revalida sólo cuando algo
 * cambió de verdad. Antes cada acción repetía estas tres piezas a mano.
 *
 * Un `ActionState` con `ok: false` devuelto por `run` —errores de campo, por
 * ejemplo— sale tal cual y no revalida: no hubo escritura.
 */
async function catalogMutation(
  fallback: string,
  run: (session: CatalogSession) => Promise<ActionState>,
): Promise<ActionState> {
  let session: CatalogSession
  try {
    session = await requirePermission("admin:worker_positions")
  } catch {
    return { ok: false, message: "Sin permisos para administrar cargos." }
  }

  try {
    const result = await run(session)
    if (result.ok) {
      revalidatePath(CATALOG_PATH)
      revalidatePath(WORKERS_PATH)
    }
    return result
  } catch (error) {
    if (error instanceof WorkerPositionDomainError) return { ok: false, message: error.message }
    return { ok: false, message: safeActionMessage(error, fallback) }
  }
}

/** Datos de auditoría comunes a toda acción del catálogo. */
function auditActor(session: CatalogSession) {
  return { userId: session.user.id, userEmail: session.user.email ?? undefined }
}

export async function createWorkerPositionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return catalogMutation("No se pudo crear el cargo.", async (session): Promise<ActionState> => {
    const input = {
      code: stringField(formData, "code"),
      name: stringField(formData, "name"),
      isActive: checked(formData, "isActive", true),
      needsReview: checked(formData, "needsReview"),
    }
    if (!input.code) return { ok: false, fieldErrors: { code: ["Ingresa un código."] } }
    if (!input.name) return { ok: false, fieldErrors: { name: ["Ingresa un nombre."] } }

    const position = await createWorkerPosition(input)
    const selectedCapabilities = capabilityIds(formData)
    await replaceWorkerPositionCapabilities({
      positionId: position.id,
      capabilityIds: selectedCapabilities,
      actorUserId: session.user.id,
    })
    await recordAudit({
      ...auditActor(session),
      action: "create",
      entityType: "worker_position",
      entityId: position.id,
      entityCode: position.code,
      newState: { name: position.name, isActive: position.isActive, needsReview: position.needsReview, capabilityIds: selectedCapabilities },
    })
    return { ok: true, message: `Cargo ${position.name} creado.` }
  })
}

export async function updateWorkerPositionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return catalogMutation("No se pudo actualizar el cargo.", async (session): Promise<ActionState> => {
    const id = stringField(formData, "id")
    const input = {
      code: stringField(formData, "code"),
      name: stringField(formData, "name"),
      isActive: checked(formData, "isActive"),
      needsReview: checked(formData, "needsReview"),
    }
    if (!id) return { ok: false, message: "Cargo no identificado." }
    if (!input.code) return { ok: false, fieldErrors: { code: ["Ingresa un código."] } }
    if (!input.name) return { ok: false, fieldErrors: { name: ["Ingresa un nombre."] } }

    const position = await updateWorkerPosition(id, input)
    const selectedCapabilities = capabilityIds(formData)
    await replaceWorkerPositionCapabilities({
      positionId: position.id,
      capabilityIds: selectedCapabilities,
      actorUserId: session.user.id,
    })
    await recordAudit({
      ...auditActor(session),
      action: "update",
      entityType: "worker_position",
      entityId: position.id,
      entityCode: position.code,
      newState: { name: position.name, isActive: position.isActive, needsReview: position.needsReview, capabilityIds: selectedCapabilities },
    })
    return { ok: true, message: `Cargo ${position.name} actualizado.` }
  })
}

export async function reviewWorkerPositionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return catalogMutation("No se pudo revisar el cargo.", async (session): Promise<ActionState> => {
    const id = stringField(formData, "id")
    if (!id) return { ok: false, message: "Cargo no identificado." }

    const position = await updateWorkerPosition(id, {
      code: stringField(formData, "code"),
      name: stringField(formData, "name"),
      isActive: checked(formData, "isActive", true),
      needsReview: false,
    })
    await recordAudit({
      ...auditActor(session),
      action: "update",
      entityType: "worker_position",
      entityId: position.id,
      entityCode: position.code,
      oldState: { needsReview: true },
      newState: { needsReview: false },
      reason: "Cargo revisado desde el catálogo administrativo",
    })
    return { ok: true, message: `Cargo ${position.name} marcado como revisado.` }
  })
}

export async function toggleWorkerPositionActiveAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return catalogMutation("No se pudo cambiar el estado del cargo.", async (session): Promise<ActionState> => {
    const id = stringField(formData, "id")
    const activate = checked(formData, "activate")
    if (!id) return { ok: false, message: "Cargo no identificado." }

    const position = await updateWorkerPosition(id, {
      code: stringField(formData, "code"),
      name: stringField(formData, "name"),
      isActive: activate,
      needsReview: checked(formData, "needsReview"),
    })
    await recordAudit({
      ...auditActor(session),
      action: "update",
      entityType: "worker_position",
      entityId: position.id,
      entityCode: position.code,
      newState: { isActive: position.isActive },
    })
    return { ok: true, message: `Cargo ${position.name} ${activate ? "activado" : "desactivado"}.` }
  })
}

export async function addWorkerPositionAliasAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return catalogMutation("No se pudo agregar el alias.", async (session): Promise<ActionState> => {
    const positionId = stringField(formData, "positionId")
    const alias = stringField(formData, "alias")
    if (!positionId) return { ok: false, message: "Cargo no identificado." }
    if (!alias) return { ok: false, fieldErrors: { alias: ["Ingresa el alias."] } }

    const created = await addWorkerPositionAlias({ positionId, alias, source: "manual", actorUserId: session.user.id })
    await recordAudit({
      ...auditActor(session),
      action: "create",
      entityType: "worker_position_alias",
      entityId: created.id,
      newState: { positionId, alias: created.alias },
    })
    return { ok: true, message: `Alias ${created.alias} agregado.` }
  })
}

export async function removeWorkerPositionAliasAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return catalogMutation("No se pudo eliminar el alias.", async (session): Promise<ActionState> => {
    const id = stringField(formData, "id")
    if (!id) return { ok: false, message: "Alias no identificado." }

    await removeWorkerPositionAlias(id)
    await recordAudit({ ...auditActor(session), action: "delete", entityType: "worker_position_alias", entityId: id })
    return { ok: true, message: "Alias eliminado." }
  })
}

export async function createWorkerCapabilityAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return catalogMutation("No se pudo crear la capacidad.", async (session): Promise<ActionState> => {
    const capability = await createWorkerCapability({
      code: stringField(formData, "code"),
      name: stringField(formData, "name"),
      description: stringField(formData, "description") || null,
      isActive: checked(formData, "isActive", true),
    })
    await recordAudit({
      ...auditActor(session),
      action: "create",
      entityType: "worker_capability",
      entityId: capability.id,
      entityCode: capability.code,
      newState: { name: capability.name, description: capability.description, isActive: capability.isActive },
    })
    return { ok: true, message: `Capacidad ${capability.name} creada.` }
  })
}

export async function updateWorkerCapabilityAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return catalogMutation("No se pudo actualizar la capacidad.", async (session): Promise<ActionState> => {
    const id = stringField(formData, "id")
    if (!id) return { ok: false, message: "Capacidad no identificada." }

    const capability = await updateWorkerCapability(id, {
      code: stringField(formData, "code"),
      name: stringField(formData, "name"),
      description: stringField(formData, "description") || null,
      isActive: checked(formData, "isActive"),
    })
    await recordAudit({
      ...auditActor(session),
      action: "update",
      entityType: "worker_capability",
      entityId: capability.id,
      entityCode: capability.code,
      newState: { name: capability.name, description: capability.description, isActive: capability.isActive },
    })
    return { ok: true, message: `Capacidad ${capability.name} actualizada.` }
  })
}

export async function toggleWorkerCapabilityActiveAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return catalogMutation("No se pudo cambiar el estado de la capacidad.", async (session): Promise<ActionState> => {
    const id = stringField(formData, "id")
    const activate = checked(formData, "activate")
    if (!id) return { ok: false, message: "Capacidad no identificada." }

    const capability = await updateWorkerCapability(id, {
      code: stringField(formData, "code"),
      name: stringField(formData, "name"),
      description: stringField(formData, "description") || null,
      isActive: activate,
    })
    await recordAudit({
      ...auditActor(session),
      action: "update",
      entityType: "worker_capability",
      entityId: capability.id,
      entityCode: capability.code,
      newState: { isActive: capability.isActive },
    })
    return { ok: true, message: `Capacidad ${capability.name} ${activate ? "activada" : "desactivada"}.` }
  })
}

export async function mergeWorkerPositionsAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return catalogMutation("No se pudo fusionar el cargo.", async (session): Promise<ActionState> => {
    const sourceId = stringField(formData, "sourceId")
    const targetId = stringField(formData, "targetId")
    if (!sourceId) return { ok: false, message: "Cargo de origen no identificado." }
    if (!targetId) return { ok: false, fieldErrors: { targetId: ["Elige el cargo que se conserva."] } }

    const { target, movedWorkers, movedAliases } = await mergeWorkerPositions({
      sourceId, targetId, actorUserId: session.user.id,
    })
    await recordAudit({
      ...auditActor(session),
      action: "update",
      entityType: "worker_position",
      entityId: sourceId,
      entityCode: target.code,
      newState: { mergedInto: target.id, movedWorkers, movedAliases },
      reason: `Fusionado en "${target.name}" desde el catálogo administrativo`,
    })
    return {
      ok: true,
      message: `Cargo fusionado en ${target.name}: ${movedWorkers} trabajador(es) movidos.`,
    }
  })
}
