import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { preventionInspectionRuns, preventionInspectionTemplates, users } from "@/db/schema"
import { NOT_FOUND, requireAccess, type InspectionAccess } from "@/lib/services/prevention-inspections-access"
import { getUserIdsWithPermission } from "@/lib/services/notification-targeting"
import { createNotifications } from "@/lib/services/notifications"
import { formatDate, todayInChile } from "@/lib/utils"
import { listInspectionReviewers } from "./catalogs"

/**
 * Recordatorio manual de que una inspección espera revisión. No es
 * destructivo: cualquiera con `view` sobre la faena puede empujarla — el tope
 * de un recordatorio por día lo da la deduplicación de `createNotifications`,
 * no el permiso.
 */
export async function remindInspectionReview(input: unknown, access: InspectionAccess) {
  const data = z.object({ runId: z.string().min(1) }).parse(input)
  const [run] = await db.select().from(preventionInspectionRuns)
    .where(eq(preventionInspectionRuns.id, data.runId)).limit(1)
  if (!run) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:inspections:view", run.worksiteId)
  if (run.status !== "completed") throw new Error("Sólo una inspección ejecutada espera revisión.")

  const reviewers = await listInspectionReviewers(access, run.worksiteId)
  if (reviewers.length === 0) throw new Error("Nadie tiene permiso de revisión en esta faena. Avisa a Prevención.")

  await createNotifications(reviewers.map((reviewer) => reviewer.id), {
    type: "system_alert",
    title: "Recordatorio: inspección pendiente de revisión",
    body: `${run.code} espera revisión desde ${run.executedAt ? formatDate(run.executedAt) : run.scheduledFor ?? "hace un tiempo"}.`,
    entityType: "inspection_run",
    entityId: run.id,
    entityHref: `/prevencion/inspecciones/${run.id}`,
    // Distinto del que usa `completeInspectionRun` (`inspection:review:${id}`):
    // con ése el recordatorio sería un no-op para siempre. Con fecha: como
    // máximo uno por día.
    dedupeKey: `inspection:review-reminder:${run.id}:${todayInChile()}`,
  })
  return { notified: reviewers.map((reviewer) => reviewer.name) }
}

/**
 * I-15 (auditoría UI/UX 2026-08-25): quien incorpora un borrador (`manage`)
 * puede no tener `approve` — las plantillas no son por faena, así que a
 * diferencia de I-08 el permiso se resuelve global, no por faena.
 */
export async function remindTemplateApproval(input: unknown, access: InspectionAccess) {
  const data = z.object({ templateId: z.string().min(1) }).parse(input)
  requireAccess(access, "prevention:inspections:manage")
  const [template] = await db.select().from(preventionInspectionTemplates)
    .where(eq(preventionInspectionTemplates.id, data.templateId)).limit(1)
  if (!template) throw new Error(NOT_FOUND)
  if (template.status !== "draft") throw new Error("Sólo un borrador espera aprobación.")

  const approverIds = await getUserIdsWithPermission("prevention:inspections:approve")
  const approvers = approverIds.length === 0 ? [] : await db.select({ id: users.id, name: users.name }).from(users)
    .where(and(inArray(users.id, approverIds), eq(users.isActive, true)))
  if (approvers.length === 0) throw new Error("Nadie tiene permiso de aprobación. Avisa a un administrador.")

  await createNotifications(approvers.map((approver) => approver.id), {
    type: "system_alert",
    title: "Solicitud de aprobación de plantilla",
    body: `${template.name} (${template.versionLabel}) espera aprobación para habilitarse.`,
    entityType: "inspection_template",
    entityId: template.id,
    entityHref: "/prevencion/inspecciones/plantillas",
    // Con fecha: como máximo una solicitud por día para el mismo borrador.
    dedupeKey: `inspection:template-approval:${template.id}:${todayInChile()}`,
  })
  return { notified: approvers.map((approver) => approver.name) }
}
