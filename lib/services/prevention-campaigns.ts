import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import {
  preventionCampaignAttendance,
  preventionCampaigns,
  workers,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { accreditPdtpFromEvent } from "@/lib/services/pdtp/accreditation"
import { logger } from "@/lib/logger"

export interface CampaignAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

/**
 * Error de dominio con mensaje pensado para el usuario. Existe para que la capa
 * de acciones pueda distinguirlo de un fallo inesperado (driver, SQL) y no
 * devolver detalles de infraestructura al navegador.
 */
export class CampaignDomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CampaignDomainError"
  }
}

const NOT_FOUND = "Campaña preventiva no encontrada o fuera de alcance."

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function requireAccess(access: CampaignAccess, permission: string, worksiteId?: string) {
  if (!access.permissions.includes(permission) || (worksiteId && !scopeAllows(access.scope, worksiteId))) {
    throw new CampaignDomainError(NOT_FOUND)
  }
}

const campaignCreateSchema = z.object({
  worksiteId: z.string().min(1),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().optional(),
  pdtpActivityNumbers: z.array(z.number().int()).default([85]),
})

export async function createCampaign(input: unknown, access: CampaignAccess) {
  const data = campaignCreateSchema.parse(input)
  requireAccess(access, "prevention:campaign:manage", data.worksiteId)

  const code = `CMP-${nanoid(6).toUpperCase()}`
  const now = new Date().toISOString()

  const [created] = await db.insert(preventionCampaigns).values({
    id: `cmp-${nanoid()}`,
    worksiteId: data.worksiteId,
    code,
    title: data.title,
    description: data.description ?? null,
    pdtpActivityNumbers: data.pdtpActivityNumbers,
    status: "active",
    startedAt: now,
    createdByUserId: access.userId,
    createdAt: now,
    updatedAt: now,
  }).returning()

  return created
}

const attendanceRecordSchema = z.object({
  campaignId: z.string().min(1),
  workerIds: z.array(z.string().min(1)),
  evidenceRef: z.string().optional(),
})

export async function recordCampaignAttendance(input: unknown, access: CampaignAccess) {
  const data = attendanceRecordSchema.parse(input)
  const [campaign] = await db.select().from(preventionCampaigns).where(eq(preventionCampaigns.id, data.campaignId)).limit(1)
  if (!campaign) throw new CampaignDomainError(NOT_FOUND)
  requireAccess(access, "prevention:campaign:manage", campaign.worksiteId)

  if (data.workerIds.length > 0) {
    const valid = await db.select({ id: workers.id }).from(workers).where(and(
      inArray(workers.id, data.workerIds),
      eq(workers.worksiteId, campaign.worksiteId),
      eq(workers.isActive, true),
    ))
    const ok = new Set(valid.map((w) => w.id))
    const rejected = data.workerIds.filter((id) => !ok.has(id))
    if (rejected.length > 0) {
      throw new CampaignDomainError(`${rejected.length} persona(s) no pertenecen a la faena de la campaña o están inactivas.`)
    }
  }

  const now = new Date().toISOString()
  const rows = data.workerIds.map((workerId) => ({
    id: `cmpatt-${nanoid()}`,
    campaignId: campaign.id,
    workerId,
    evidenceRef: data.evidenceRef ?? null,
    attendedAt: now,
    createdAt: now,
  }))

  if (rows.length > 0) {
    await db.insert(preventionCampaignAttendance)
      .values(rows)
      .onConflictDoNothing()
  }

  return { campaignId: campaign.id, recordedCount: rows.length }
}

const campaignCloseSchema = z.object({
  campaignId: z.string().min(1),
  evidenceUrl: z.string().optional(),
})

/**
 * Cierra una campaña preventiva (R9) y dispara la auto-acreditación PDTP
 * para sus actividades (ej. 85-89) con el total de trabajadores alcanzados.
 */
export async function closeCampaign(input: unknown, access: CampaignAccess) {
  const data = campaignCloseSchema.parse(input)
  const [campaign] = await db.select().from(preventionCampaigns).where(eq(preventionCampaigns.id, data.campaignId)).limit(1)
  if (!campaign) throw new CampaignDomainError(NOT_FOUND)
  requireAccess(access, "prevention:campaign:manage", campaign.worksiteId)

  if (campaign.status === "completed") throw new CampaignDomainError("La campaña ya fue completada.")
  if (campaign.status === "cancelled") throw new CampaignDomainError("Una campaña cancelada no puede cerrarse.")

  const attendance = await db.select().from(preventionCampaignAttendance)
    .where(eq(preventionCampaignAttendance.campaignId, campaign.id))

  const now = new Date().toISOString()
  const [updated] = await db.update(preventionCampaigns)
    .set({
      status: "completed",
      completedAt: now,
      evidenceUrl: data.evidenceUrl ?? campaign.evidenceUrl,
      updatedAt: now,
    })
    .where(eq(preventionCampaigns.id, campaign.id))
    .returning()

  if (!updated) throw new Error("No se pudo completar la campaña.")

  // Auto-acreditación PDTP (safe). Sin actividades declaradas en la campaña es
  // no-op: no inventamos un número por defecto para no acreditar una actividad
  // ajena a la campaña.
  let pdtpAccredited = false
  const activityNumbers = Array.isArray(campaign.pdtpActivityNumbers) ? campaign.pdtpActivityNumbers : []
  if (activityNumbers.length > 0) {
    try {
      await accreditPdtpFromEvent({
        sourceType: "campana",
        sourceId: campaign.id,
        worksiteId: campaign.worksiteId,
        activityNumbers,
        occurredAt: now,
        executedQuantity: Math.max(1, attendance.length),
        evidenceRef: data.evidenceUrl ?? `Campaña preventiva: ${campaign.code}`,
      })
      pdtpAccredited = true
    } catch (err) {
      logger.error({ err, campaignId: campaign.id }, "[closeCampaign] Error en auto-acreditación PDTP de campaña")
    }
  }

  return { campaign: updated, reachedWorkers: attendance.length, pdtpAccredited }
}
