/**
 * lib/services/prevention-permits.ts
 * Permisos de trabajo y AST (Análisis de Seguridad del Trabajo).
 *
 *   - El catálogo de plantillas (`permitTemplates`) es único, no se particiona
 *     por faena. Se crea/actualiza con upsert idempotente sobre `code`.
 *   - Las solicitudes (`permitRequests`) están scopeadas por faena.
 */

import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { permitTemplates, permitRequests, permitSignoffs } from "@/db/schema"
import type { ReportData } from "@/lib/reports/export"
import { nanoid } from "@/lib/id"
import {
  permitTemplateCreateSchema,
  permitRequestSchema,
  permitSignoffSchema,
} from "@/lib/validation/prevention"

export type WorksiteScope = string[] | "all"

export function assertWorksiteAccess(worksiteId: string, scope: WorksiteScope): void {
  if (scope === "all") return
  if (!scope.includes(worksiteId)) {
    throw new Error("Permiso de trabajo no encontrado o sin acceso.")
  }
}

export async function createPermitTemplate(input: unknown) {
  const data = permitTemplateCreateSchema.parse(input)
  const now = new Date().toISOString()
  const [row] = await db.insert(permitTemplates).values({
    id: `ptpl-${nanoid()}`,
    code: data.code,
    title: data.title,
    riskType: data.riskType,
    astFields: data.astFields,
    validityHours: data.validityHours ?? null,
    requiresSignoff: data.requiresSignoff,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [permitTemplates.code],
    set: {
      title: data.title,
      riskType: data.riskType,
      astFields: data.astFields,
      validityHours: data.validityHours ?? null,
      requiresSignoff: data.requiresSignoff,
      updatedAt: now,
    },
  }).returning()
  if (!row) throw new Error("No se pudo crear la plantilla de permiso.")
  return row
}

export async function listPermitTemplates() {
  return db.select().from(permitTemplates).orderBy(permitTemplates.code)
}

export async function createPermitRequest(input: unknown, userId: string, scope: WorksiteScope) {
  const data = permitRequestSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)

  const now = new Date().toISOString()
  const id = `preq-${nanoid()}`
  await db.insert(permitRequests).values({
    id,
    templateId: data.templateId,
    worksiteId: data.worksiteId,
    requesterId: userId,
    task: data.task,
    location: data.location,
    plannedStart: data.plannedStart,
    plannedEnd: data.plannedEnd,
    ast: data.ast,
    status: "solicitado",
    approverId: null,
    executorId: null,
    createdAt: now,
    updatedAt: now,
  })

  const [row] = await db.select().from(permitRequests).where(eq(permitRequests.id, id)).limit(1)
  if (!row) throw new Error("No se pudo crear la solicitud de permiso.")
  return row
}

export async function listPermitRequests(scope: WorksiteScope) {
  if (scope !== "all" && scope.length === 0) return []
  const where = scope === "all" ? undefined : inArray(permitRequests.worksiteId, scope)
  return db.select().from(permitRequests).where(where).orderBy(desc(permitRequests.createdAt))
}

export async function approvePermitRequest(permitId: string, userId: string, scope: WorksiteScope) {
  const [permit] = await db.select().from(permitRequests).where(eq(permitRequests.id, permitId)).limit(1)
  if (!permit) throw new Error("Solicitud de permiso no encontrada.")
  assertWorksiteAccess(permit.worksiteId, scope)

  const now = new Date().toISOString()
  const [updated] = await db.update(permitRequests)
    .set({ status: "aprobado", approverId: userId, updatedAt: now })
    .where(and(eq(permitRequests.id, permitId), eq(permitRequests.status, "solicitado")))
    .returning()

  if (!updated) throw new Error("No se pudo aprobar el permiso (posiblemente ya fue procesado).")
  return updated
}

export async function signPermit(input: unknown, userId: string) {
  const data = permitSignoffSchema.parse(input)
  const [permit] = await db.select().from(permitRequests).where(eq(permitRequests.id, data.permitId)).limit(1)
  if (!permit) throw new Error("Solicitud de permiso no encontrada.")

  const now = new Date().toISOString()
  const [row] = await db.insert(permitSignoffs).values({
    id: `psig-${nanoid()}`,
    permitId: data.permitId,
    role: data.role,
    userId,
    signedAt: now,
    signature: data.signature,
  }).onConflictDoUpdate({
    target: [permitSignoffs.permitId, permitSignoffs.role],
    set: { userId, signedAt: now, signature: data.signature },
  }).returning()

  if (!row) throw new Error("No se pudo registrar la firma del permiso.")
  return row
}

export async function listSignoffsForPermits(permitIds: string[]) {
  if (permitIds.length === 0) return []
  return db.select().from(permitSignoffs).where(inArray(permitSignoffs.permitId, permitIds))
}

export async function buildPermitsExport(scope: WorksiteScope): Promise<ReportData> {
  const permits = await listPermitRequests(scope)
  const templates = await listPermitTemplates()
  const templateTitleById = new Map(templates.map((t) => [t.id, t.title]))
  return {
    filenameBase: "permisos-trabajo",
    worksheetName: "Permisos",
    headers: ["ID", "Faena", "Plantilla", "Tarea", "Ubicación", "Inicio", "Término", "Estado"],
    rows: permits.map((p) => [
      p.id, p.worksiteId, templateTitleById.get(p.templateId) ?? p.templateId,
      p.task, p.location, p.plannedStart, p.plannedEnd, p.status,
    ]),
  }
}
