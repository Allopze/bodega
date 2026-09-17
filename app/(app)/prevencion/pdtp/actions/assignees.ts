"use server"

/**
 * Asignación nominal de actividades del PDTP a personas, por faena.
 *
 * Permiso propio (`prevention:pdtp:assignee:manage`), no `prevention:pdtp:execute`:
 * asignar no es ejecutar. Quien hace el trabajo no decide a quién le toca, y el
 * efecto de decidirlo es fuerte — con un asignado vigente los demás usuarios del
 * mismo rol dejan de ver esa fila en `/pendientes`.
 *
 * La lista de candidatos también pasa por el permiso: son nombres de personas
 * con su rol, y no hay por qué exponerlos a quien no puede asignar.
 */

import { ZodError } from "zod"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { safeActionMessage } from "@/lib/action-error"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import {
  listPdtpAssigneeCandidates,
  setPdtpActivityAssignees,
  type PdtpAssigneeCandidate,
} from "@/lib/services/prevention-pdtp"
import type { ActionState } from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/pdtp"
const PERMISSION = "prevention:pdtp:assignee:manage"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export async function listPdtpAssigneeCandidatesAction(
  activityId: string,
  worksiteId: string,
): Promise<{ ok: true; candidates: PdtpAssigneeCandidate[] } | { ok: false; message: string }> {
  const guard = await guardPermission(PERMISSION)
  if (guard.error) return { ok: false, message: guard.error.message }

  // El alcance de faenas se comprueba igual que al escribir: si no, la lista de
  // personas de una faena ajena quedaría disponible con sólo cambiar el id.
  const scope = scopeToIds(resolveWorksiteScope(guard.session))
  if (scope !== "all" && !scope.includes(worksiteId)) {
    return { ok: false, message: "Sin acceso a la faena solicitada." }
  }

  try {
    return { ok: true, candidates: await listPdtpAssigneeCandidates(activityId, worksiteId) }
  } catch (e) {
    return { ok: false, message: safeActionMessage(e, "No se pudo cargar la lista de personas.") }
  }
}

export async function setPdtpActivityAssigneesAction(formData: FormData): Promise<ActionState> {
  const guard = await guardPermission(PERMISSION)
  if (guard.error) return guard.error
  const session = guard.session

  const activityId = String(formData.get("activityId") ?? "").trim()
  const worksiteId = String(formData.get("worksiteId") ?? "").trim()
  if (!activityId || !worksiteId) {
    return { ok: false, message: "Falta la actividad o la faena." }
  }
  // Multi-select: `getAll` porque una actividad puede tener dos responsables a
  // la vez (turnos). Una lista vacía es una instrucción válida —"que vuelva a
  // verse por rol"—, no un formulario incompleto.
  const userIds = formData.getAll("userIds").map((value) => String(value).trim()).filter(Boolean)
  const validFrom = String(formData.get("validFrom") ?? "").trim() || undefined
  const note = String(formData.get("note") ?? "").trim() || undefined

  try {
    await setPdtpActivityAssignees(
      { activityId, worksiteId, userIds, validFrom, note },
      session.user.id,
      scopeToIds(resolveWorksiteScope(session)),
    )
    revalidateOperationalViews([REVALIDATE], { worksiteId })
    return { ok: true }
  } catch (e) {
    if (e instanceof ZodError) {
      return {
        ok: false,
        message: "Revisa los campos marcados.",
        fieldErrors: e.flatten().fieldErrors as Record<string, string[]>,
      }
    }
    // Los motivos del servicio ("Fulano no puede recibir esta actividad en esta
    // faena…") son la única pista que tiene quien asigna de por qué no avanza.
    return { ok: false, message: safeActionMessage(e, "No se pudo guardar la asignación. Intenta nuevamente.") }
  }
}
