"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  approveInspectionTemplate,
  assertProgramInScope,
  closeInspectionFinding,
  completeInspectionRun,
  createFindingCapa,
  createInspectionProgram,
  createInspectionRun,
  importInspectionTemplate,
  retireInspectionTemplate,
  reviewInspectionRun,
  saveInspectionAnswers,
  setInspectionTemplatePdtpActivities,
  stopVehicleForFinding,
  transitionInspectionRun,
  updateInspectionProgram,
  type InspectionAccess,
} from "@/lib/services/prevention-inspections"
import { materializeProgramRuns } from "@/lib/services/prevention-inspection-scheduler"
import type { ActionState } from "@/lib/validation/prevention"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"

const BASE = "/prevencion/inspecciones"
// /prevencion/auditorias comparte el mismo motor (InspectionsScreen con
// kind='audit'); sin revalidarla, cerrar una auditoría deja esa pantalla con
// datos rancios (A-01, auditoría 2026-08-18).
const AUDITORIAS_BASE = "/prevencion/auditorias"

function accessFromSession(session: Awaited<ReturnType<typeof guardPermission>>["session"]): InspectionAccess {
  if (!session) throw new Error("Sesión no disponible.")
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

// La autorización se resuelve en cada acción, no dentro de este helper.
async function run(
  access: InspectionAccess,
  operation: (access: InspectionAccess) => Promise<unknown>,
  /**
   * Datos que el cliente necesita de vuelta. Se usa para devolver la nueva
   * `version` del run tras guardar respuestas: el detalle mantiene su
   * `expectedVersion` en estado local y sin esto quedaría obsoleto en cuanto
   * el guardado sube la versión (C-02).
   */
  extract?: (result: unknown) => ActionState["data"],
): Promise<ActionState> {
  try {
    const result = await operation(access)
    revalidateOperationalViews([BASE, `${BASE}/catalogo`, AUDITORIAS_BASE, `${AUDITORIAS_BASE}/catalogo`])
    // Sin esto una respuesta, un cierre o una revisión recién guardada sigue
    // mostrando el valor anterior al volver al detalle, porque la ruta
    // dinámica no la cubre `BASE`.
    // La ruta dinámica conserva su propia invalidación explícita; los
    // detalles no comparten un identificador estable en este helper.
    revalidatePath(`${BASE}/[runId]`, "page")
    return { ok: true, data: extract?.(result) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo completar la operación." }
  }
}

/** Versión del run devuelta por el servicio, para refrescar el CAS del cliente. */
function versionOf(result: unknown): ActionState["data"] {
  const version = (result as { version?: number; run?: { version?: number } } | null)?.version
    ?? (result as { run?: { version?: number } } | null)?.run?.version
  return typeof version === "number" ? { version } : undefined
}

export async function importInspectionTemplateAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => importInspectionTemplate(input, access))
}

export async function setInspectionTemplatePdtpActivitiesAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => setInspectionTemplatePdtpActivities(input, access))
}

export async function approveInspectionTemplateAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:approve")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => approveInspectionTemplate(input, access))
}

/**
 * Retira una plantilla. Mismo permiso que aprobarla: quien habilita un
 * instrumento es quien puede sacarlo de circulación.
 */
export async function retireInspectionTemplateAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:approve")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => retireInspectionTemplate(input, access))
}

export async function createInspectionProgramAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createInspectionProgram(input, access))
}

export async function updateInspectionProgramAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => updateInspectionProgram(input, access))
}

/**
 * "Ejecutar ahora": materializa la inspección del programa bajo demanda, por el
 * mismo camino que usa el cron diario. Sin dos rutas de creación no hay dos
 * comportamientos que diverjan.
 */
export async function runProgramNowAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:manage")
  if (guard.error) return guard.error
  const { programId } = z.object({ programId: z.string().min(1) }).parse(input)
  return run(accessFromSession(guard.session), async (access) => {
    // El materializador no recibe `InspectionAccess` (el cron no tiene sesión),
    // así que el alcance de faena se comprueba aquí antes de invocarlo.
    await assertProgramInScope(programId, access)
    const result = await materializeProgramRuns({ programId })
    if (result.created === 0 && result.skippedTemplate > 0) {
      throw new Error("La plantilla del programa ya no está aprobada.")
    }
    if (result.created === 0) {
      throw new Error("La inspección de este período ya existe.")
    }
    return result
  })
}

export async function createInspectionRunAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:execute")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createInspectionRun(input, access))
}

export async function saveInspectionAnswersAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:execute")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => saveInspectionAnswers(input, access), versionOf)
}

export async function completeInspectionRunAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:execute")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => completeInspectionRun(input, access), versionOf)
}

export async function createFindingCapaAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:execute")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createFindingCapa(input, access))
}

/**
 * Confirma la propuesta de sacar el equipo de servicio.
 *
 * Guardada por `combustibles:manage_vehicles` y no por un permiso de
 * inspecciones: quien digita el reporte detecta la falla, pero detener un
 * equipo para la faena y esa decisión es de quien administra la flota.
 */
export async function stopVehicleForFindingAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("combustibles:manage_vehicles")
  if (guard.error) return guard.error
  const state = await run(accessFromSession(guard.session), (access) => stopVehicleForFinding(input, access))
  if (state.ok) revalidateOperationalViews(["/flota", "/combustibles/vehiculos"])
  return state
}

export async function reviewInspectionRunAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:review")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => reviewInspectionRun(input, access))
}

/**
 * Cancelar una inspección que ya no corresponde. El esquema soportaba el estado
 * `cancelled` con sus tres campos y su CHECK desde el principio, y nada podía
 * escribirlo: una planificada obsoleta quedaba viva para siempre en la cola de
 * pendientes (A-04).
 */
export async function cancelInspectionRunAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:manage")
  if (guard.error) return guard.error
  return run(
    accessFromSession(guard.session),
    (access) => transitionInspectionRun({ ...(input as object), toStatus: "cancelled" }, access),
    versionOf,
  )
}

/**
 * Reabrir para rectificar. Sin esto, un error de tipeo en una inspección ya
 * declarada quedaba firmado para siempre (A-05).
 */
export async function reopenInspectionRunAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:review")
  if (guard.error) return guard.error
  return run(
    accessFromSession(guard.session),
    (access) => transitionInspectionRun({ ...(input as object), toStatus: "in_progress" }, access),
    versionOf,
  )
}

/** Cierre manual de un hallazgo sin CAPA; los que la tienen se cierran con ella. */
export async function closeInspectionFindingAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:inspections:review")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => closeInspectionFinding(input, access))
}
