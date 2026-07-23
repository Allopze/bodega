"use me"
"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  closeCampaign,
  createCampaign,
  recordCampaignAttendance,
  type CampaignAccess,
} from "@/lib/services/prevention-campaigns"

const createCampaignSchema = z.object({
  worksiteId: z.string().min(1, "Selecciona una faena"),
  title: z.string().trim().min(3, "El título debe tener al menos 3 caracteres"),
  description: z.string().trim().optional(),
  pdtpActivityNumbers: z.array(z.number().int()).default([85]),
})

const attendanceSchema = z.object({
  campaignId: z.string().min(1),
  workerIds: z.array(z.string().min(1)).min(1, "Selecciona al menos un trabajador"),
})

const closeCampaignSchema = z.object({
  campaignId: z.string().min(1),
  evidenceUrl: z.string().trim().optional(),
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

export async function createCampaignAction(formData: unknown) {
  try {
    const access = await getAccess()
    const parsed = createCampaignSchema.parse(formData)
    const created = await createCampaign(parsed, access)
    revalidatePath("/prevencion/campanas")
    return { success: true, campaign: created }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error al crear la campaña."
    return { success: false, error: message }
  }
}

export async function recordCampaignAttendanceAction(formData: unknown) {
  try {
    const access = await getAccess()
    const parsed = attendanceSchema.parse(formData)
    const result = await recordCampaignAttendance(parsed, access)
    revalidatePath("/prevencion/campanas")
    return { success: true, count: result.recordedCount }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error al registrar la asistencia."
    return { success: false, error: message }
  }
}

export async function closeCampaignAction(formData: unknown) {
  try {
    const access = await getAccess()
    const parsed = closeCampaignSchema.parse(formData)
    const result = await closeCampaign(parsed, access)
    revalidatePath("/prevencion/campanas")
    return { success: true, result }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error al cerrar la campaña."
    return { success: false, error: message }
  }
}
