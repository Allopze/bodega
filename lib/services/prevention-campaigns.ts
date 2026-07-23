import { desc, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import {
  preventionCampaignAttendance,
  preventionCampaigns,
  users,
  workers,
  worksites,
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

const NOT_FOUND = "Campaña preventiva no encontrada o fuera de alcance."

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function requireAccess(access: CampaignAccess, permission: string, worksiteId?: string) {
  if (!access.permissions.includes(permission) || (worksiteId && !scopeAllows(access.scope, worksiteId))) {
    throw new Error(NOT_FOUND)
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
  requireAccess(access, "prevention:pdtp:program:manage", data.worksiteId)

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
  if (!campaign) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:pdtp:program:manage", campaign.worksiteId)

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
  if (!campaign) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:pdtp:program:manage", campaign.worksiteId)

  if (campaign.status === "completed") throw new Error("La campaña ya fue completada.")
  if (campaign.status === "cancelled") throw new Error("Una campaña cancelada no puede cerrarse.")

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
    } catch (err) {
      logger.error({ err, campaignId: campaign.id }, "[closeCampaign] Error en auto-acreditación PDTP de campaña")
    }
  }

  return { campaign: updated, reachedWorkers: attendance.length }
}

export async function listCampaigns(access: CampaignAccess, worksiteId?: string) {
  requireAccess(access, "prevention:pdtp:view")
  const targetWorksiteId = worksiteId ?? (access.scope.mode === "some" ? access.scope.ids[0] : undefined)

  const query = db.select({
    campaign: preventionCampaigns,
    worksiteName: worksites.name,
    createdByName: users.name,
    attendanceCount: sql<number>`(SELECT COUNT(*)::int FROM prevention_campaign_attendance a WHERE a.campaign_id = ${preventionCampaigns.id})`,
  })
    .from(preventionCampaigns)
    .innerJoin(worksites, eq(preventionCampaigns.worksiteId, worksites.id))
    .innerJoin(users, eq(preventionCampaigns.createdByUserId, users.id))
    .orderBy(desc(preventionCampaigns.createdAt))

  if (targetWorksiteId) {
    return query.where(eq(preventionCampaigns.worksiteId, targetWorksiteId))
  }
  return query
}

export async function getCampaignDetail(campaignId: string, access: CampaignAccess) {
  requireAccess(access, "prevention:pdtp:view")
  const [campaign] = await db.select({
    campaign: preventionCampaigns,
    worksiteName: worksites.name,
    createdByName: users.name,
  })
    .from(preventionCampaigns)
    .innerJoin(worksites, eq(preventionCampaigns.worksiteId, worksites.id))
    .innerJoin(users, eq(preventionCampaigns.createdByUserId, users.id))
    .where(eq(preventionCampaigns.id, campaignId))
    .limit(1)

  if (!campaign) throw new Error(NOT_FOUND)

  const attendance = await db.select({
    record: preventionCampaignAttendance,
    workerName: sql<string>`${workers.firstName} || ' ' || ${workers.lastName}`,
    workerRut: workers.rut,
  })
    .from(preventionCampaignAttendance)
    .innerJoin(workers, eq(preventionCampaignAttendance.workerId, workers.id))
    .where(eq(preventionCampaignAttendance.campaignId, campaignId))

  return { ...campaign, attendance }
}
