"use server"

import { revalidatePath } from "next/cache"
import { z, ZodError } from "zod"
import { requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import type { ActionState } from "@/lib/validation/prevention"
import {
  CampaignDomainError,
  closeCampaign,
  setCampaignPdtpActivities,
  type CampaignAccess,
} from "@/lib/services/prevention-campaigns"

const closeCampaignSchema = z.object({
  campaignId: z.string().min(1),
  // Task 13 (2026-09-23): faltaba en este schema aunque `closeCampaign`
  // (lib/services/prevention-campaigns.ts) lo exige y el cliente siempre lo
  // envía (campanas-client.tsx). Sin declararlo acá, zod lo descartaba en
  // silencio antes de llegar al servicio, que entonces rechazaba con "Indica
  // la fecha en que se hizo la campaña" — "Marcar como hecha" nunca
  // funcionaba desde la UI, para ninguna campaña. Se corrige acá porque el
  // requisito explícito de esta tarea es que las campañas `pending` que ya
  // existían sigan siendo cerrables.
  heldOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indica la fecha en que se hizo la campaña (YYYY-MM-DD)."),
  evidenceUrl: z.string().trim().min(1, "Adjunta la evidencia de difusión de la campaña."),
})

async function getAccess(): Promise<CampaignAccess> {
  const session = await requireAuth()
  const scope = resolveWorksiteScope(session)
  return {
    userId: session.user.id,
    scope,
    permissions: session.user.permissions,
  }
}

/**
 * Los errores de dominio llevan mensaje pensado para el usuario y se devuelven
 * tal cual; cualquier otro pasa por `unexpectedActionError`, que loguea y
 * responde genérico para no filtrar detalles de driver o SQL al navegador.
 */
function campaignFailure(error: unknown, action: string): ActionState {
  if (error instanceof ZodError) {
    return {
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
    }
  }
  if (error instanceof CampaignDomainError) {
    return { ok: false, message: error.message }
  }
  return unexpectedActionError(error, `prevencion/campanas/${action}`)
}

/**
 * Task 13 (2026-09-23): esta acción ya no crea campañas.
 *
 * Las N°85 a N°89 del programa 2026 nacen ahora como ítems `CAM-*` del
 * catálogo de capacitación (`lib/prevention/training-occurrences-catalog.ts`)
 * y se acreditan desde `/prevencion/capacitacion`. Dejar esta ruta de alta
 * viva — aunque `campanas-client.tsx` ya no ofrezca el diálogo — habría sido
 * el mismo defecto que dejó la N°88 sólo alcanzable desde acá (ver el
 * comentario de `modules/prevention/manifest.ts`): quitar el botón de la UI
 * no es una barrera si el endpoint sigue aceptando la misma llamada. Se
 * conserva la función (no la ruta) para no romper el tipo `ActionState` que
 * el cliente todavía podría invocar desde una pestaña vieja, y para que quien
 * la llame directamente reciba un mensaje accionable en vez de un 404 o un
 * error genérico.
 *
 * `closeCampaignAction` y `setCampaignPdtpActivitiesAction` SÍ se conservan
 * intactas: hay campañas `pending` creadas antes de este cambio (35 en la
 * base de datos de desarrollo al momento de esta tarea) que deben poder
 * cerrarse sin quedar huérfanas.
 */
export async function createCampaignAction(_formData: unknown): Promise<ActionState> {
  try {
    await getAccess()
  } catch (err: unknown) {
    return campaignFailure(err, "createCampaign")
  }
  return campaignFailure(
    new CampaignDomainError(
      "Las campañas del programa 2026 (N°85 a N°89) ya no se crean acá. Regístralas y ciérralas desde Capacitación (/prevencion/capacitacion), la única vía que acredita el PDTP para esas actividades.",
    ),
    "createCampaign",
  )
}

export async function setCampaignPdtpActivitiesAction(formData: unknown): Promise<ActionState> {
  try {
    const access = await getAccess()
    await setCampaignPdtpActivities(formData, access)
    revalidatePath("/prevencion/campanas")
    return { ok: true }
  } catch (err: unknown) {
    return campaignFailure(err, "setCampaignPdtpActivities")
  }
}

export async function closeCampaignAction(formData: unknown): Promise<ActionState> {
  try {
    const access = await getAccess()
    const parsed = closeCampaignSchema.parse(formData)
    const result = await closeCampaign(parsed, access)
    revalidatePath("/prevencion/campanas")
    return {
      ok: true,
      message: result.pdtpPending
        ? "Campaña marcada como hecha. El cumplimiento del PDTP quedó registrado y se acreditará solo cuando el programa lo admita; no la marques a mano."
        : "Campaña marcada como hecha.",
      data: { pdtpAccredited: result.pdtpAccredited, pdtpPending: result.pdtpPending },
    }
  } catch (err: unknown) {
    return campaignFailure(err, "closeCampaign")
  }
}
