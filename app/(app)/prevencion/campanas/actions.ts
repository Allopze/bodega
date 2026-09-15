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
  createCampaign,
  setCampaignPdtpActivities,
  type CampaignAccess,
} from "@/lib/services/prevention-campaigns"

const createCampaignSchema = z.object({
  worksiteId: z.string().min(1, "Selecciona una faena"),
  title: z.string().trim().min(3, "El título debe tener al menos 3 caracteres"),
  description: z.string().trim().optional(),
  // Sin default: el diálogo ofrece las cinco del programa y quien crea la
  // campaña elige. Fijarlo acá era lo que dejaba las N°86 a N°89 inalcanzables.
  pdtpActivityNumbers: z.array(z.number().int().positive()).min(1, "Selecciona la actividad que acredita"),
})

const closeCampaignSchema = z.object({
  campaignId: z.string().min(1),
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

export async function createCampaignAction(formData: unknown): Promise<ActionState> {
  try {
    const access = await getAccess()
    const parsed = createCampaignSchema.parse(formData)
    await createCampaign(parsed, access)
    revalidatePath("/prevencion/campanas")
    return { ok: true }
  } catch (err: unknown) {
    return campaignFailure(err, "createCampaign")
  }
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
