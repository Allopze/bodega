"use server"

import { revalidatePath } from "next/cache"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { safeActionMessage } from "@/lib/action-error"
import { createMasterDeviation, updateMasterDeviation } from "@/lib/services/prevention-deviations"
import type { ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/admin/desviaciones"
/* La pantalla de plantillas pinta el maestro para elegir qué ofrece cada
 * instrumento: si no se revalida, una desviación recién creada no aparece ahí
 * hasta la siguiente recarga completa. */
const REVALIDATE_TEMPLATES = "/prevencion/inspecciones/plantillas"

const DANO_VALUES = ["leve", "moderado", "grave", "fatal"]

function errorState(message: string): ActionState {
  return { ok: false, message }
}

async function accessFor() {
  const session = await requirePermission("admin:deviation_catalog")
  return {
    session,
    access: {
      userId: session.user.id,
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
    },
  }
}

export async function saveDeviationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let auth
  try { auth = await accessFor() }
  catch { return errorState("Sin permisos") }

  const id = (formData.get("id") as string | null)?.trim() ?? ""
  const label = (formData.get("label") as string | null)?.trim() ?? ""
  const danoPotencial = (formData.get("danoPotencial") as string | null)?.trim() ?? ""

  if (label.length < 3) return { ok: false, fieldErrors: { label: ["Describe la desviación con al menos 3 caracteres"] } }
  if (!DANO_VALUES.includes(danoPotencial)) return { ok: false, fieldErrors: { danoPotencial: ["Elige la gravedad"] } }

  try {
    if (id) {
      const { before, after } = await updateMasterDeviation({ id, label, danoPotencial }, auth.access)
      await recordAudit({
        userId: auth.session.user.id,
        userEmail: auth.session.user.email ?? undefined,
        action: "update",
        entityType: "prevention_deviation",
        entityId: after.id,
        oldState: { label: before.label, danoPotencial: before.danoPotencial },
        newState: { label: after.label, danoPotencial: after.danoPotencial },
      })
    } else {
      const created = await createMasterDeviation({ label, danoPotencial }, auth.access)
      await recordAudit({
        userId: auth.session.user.id,
        userEmail: auth.session.user.email ?? undefined,
        action: "create",
        entityType: "prevention_deviation",
        entityId: created.id,
        newState: { label: created.label, danoPotencial: created.danoPotencial },
      })
    }
    revalidatePath(REVALIDATE)
    revalidatePath(REVALIDATE_TEMPLATES)
    return { ok: true, message: `Desviación «${label}» guardada` }
  } catch (err) {
    return errorState(safeActionMessage(err, "La desviación no se pudo guardar"))
  }
}

/**
 * Retira o reactiva una desviación del maestro.
 *
 * Retirar la apaga en TODOS los instrumentos que la ofrecían: es el punto de
 * tener un maestro. No borra la fila —los hallazgos ya levantados la
 * referencian y su gravedad explica el plazo que tuvo su acción correctiva—,
 * sólo deja de ofrecerse.
 */
export async function setDeviationStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let auth
  try { auth = await accessFor() }
  catch { return errorState("Sin permisos") }

  const id = (formData.get("id") as string | null)?.trim() ?? ""
  if (!id) return errorState("Falta la desviación")
  const isActive = formData.get("isActive") === "true"

  try {
    const { after } = await updateMasterDeviation({ id, isActive }, auth.access)
    await recordAudit({
      userId: auth.session.user.id,
      userEmail: auth.session.user.email ?? undefined,
      action: "update",
      entityType: "prevention_deviation",
      entityId: after.id,
      newState: { isActive: after.isActive },
      reason: isActive ? "Reactivada en el catálogo maestro" : "Retirada del catálogo maestro",
    })
    revalidatePath(REVALIDATE)
    revalidatePath(REVALIDATE_TEMPLATES)
    return { ok: true, message: `«${after.label}» ${isActive ? "reactivada" : "retirada"}` }
  } catch (err) {
    return errorState(safeActionMessage(err, "El estado no se pudo cambiar"))
  }
}
