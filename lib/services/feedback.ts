/**
 * lib/services/feedback.ts
 * Módulo Soporte — lógica de negocio sobre feedback_reports.
 * Sin "use server", sin imports de UI.
 */

import { z } from "zod"
import { eq, and, desc, ilike, or, count, gte, lt, lte, sql } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  feedbackReportEvents,
  feedbackReports,
  type FeedbackReport,
  type FeedbackReportEvent,
} from "@/db/schema/feedback"
import { attachments } from "@/db/schema/audit"
import { users } from "@/db/schema/users"
import { nanoid } from "@/lib/id"
import {
  feedbackCreateSchema,
  feedbackUpdateStatusSchema,
  type FeedbackEstado,
  type FeedbackPrioridad,
  type FeedbackTipo,
} from "@/lib/validation/feedback"

// ── Tipos de resultado ─────────────────────────────────────────────────────────

export type FeedbackRow = FeedbackReport & {
  authorName:  string
  authorEmail: string
}

/** Deliberately narrow shape sent to the client-side support inbox. */
export type FeedbackListRow = Pick<FeedbackReport,
  "id" | "tipo" | "titulo" | "priority" | "dueAt" | "estado" | "createdBy" | "createdAt"
> & {
  authorName: string
}

export interface FeedbackListFilters {
  mode: "own" | "all"
  userId: string
  q?: string
  estado?: FeedbackEstado
  tipo?: FeedbackTipo
  priority?: FeedbackPrioridad
  sla?: "due_soon" | "overdue"
}

export type FeedbackEventRow = FeedbackReportEvent & { actorName: string | null }
export type FeedbackStatusUpdate = FeedbackReport & {
  stateChanged: boolean
  noteAdded: boolean
}

export interface FeedbackAttachmentInput {
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
}

export interface FeedbackAttachmentRow {
  id: string
  fileName: string
  fileSize: number | null
  mimeType: string | null
  uploadedAt: string
}

// ── createReport ──────────────────────────────────────────────────────────────

export async function createReport(
  input: z.input<typeof feedbackCreateSchema>,
  userId: string,
  proofAttachment?: FeedbackAttachmentInput | null,
  client: DB | Tx = db,
): Promise<FeedbackReport> {
  const data = feedbackCreateSchema.parse(input)

  const id  = nanoid()
  const now = new Date().toISOString()

  const work = async (tx: Tx): Promise<FeedbackReport> => {
    const [report] = await tx.insert(feedbackReports).values({
      id,
      tipo:        data.tipo,
      titulo:      data.titulo,
      descripcion: data.descripcion,
      pagina:      data.pagina || null,
      priority:    data.priority,
      dueAt:       computeDueAt(data.priority, now),
      estado:      "abierto",
    notaInterna: null,
    createdBy:   userId,
    resolvedBy:  null,
    resolvedAt:  null,
    createdAt:   now,
    updatedAt:   now,
    }).returning()

    if (!report) throw new Error("Error al crear el reporte")

    await tx.insert(feedbackReportEvents).values({
      id: nanoid(),
      reportId: id,
      eventType: "created",
      fromEstado: null,
      toEstado: "abierto",
      note: null,
      actorId: userId,
      createdAt: now,
    })

    if (proofAttachment) {
      await tx.insert(attachments).values({
        id: nanoid(),
        entityType: "feedback_report",
        entityId: id,
        fileName: proofAttachment.fileName,
        filePath: proofAttachment.filePath,
        fileSize: proofAttachment.fileSize,
        mimeType: proofAttachment.mimeType,
        uploadedBy: userId,
      })
    }

    return report
  }

  return client === db ? db.transaction(work) : work(client as Tx)
}

// ── getReport ─────────────────────────────────────────────────────────────────

export async function getReport(id: string): Promise<FeedbackRow | null> {
  const rows = await db
    .select({
      id:          feedbackReports.id,
      tipo:        feedbackReports.tipo,
      titulo:      feedbackReports.titulo,
      descripcion: feedbackReports.descripcion,
      pagina:      feedbackReports.pagina,
      priority:    feedbackReports.priority,
      dueAt:       feedbackReports.dueAt,
      estado:      feedbackReports.estado,
      notaInterna: feedbackReports.notaInterna,
      createdBy:   feedbackReports.createdBy,
      resolvedBy:  feedbackReports.resolvedBy,
      resolvedAt:  feedbackReports.resolvedAt,
      createdAt:   feedbackReports.createdAt,
      updatedAt:   feedbackReports.updatedAt,
      authorName:  users.name,
      authorEmail: users.email,
    })
    .from(feedbackReports)
    .leftJoin(users, eq(feedbackReports.createdBy, users.id))
    .where(eq(feedbackReports.id, id))
    .limit(1)

  if (!rows[0]) return null
  return rows[0] as FeedbackRow
}

export async function getReportAttachments(reportId: string): Promise<FeedbackAttachmentRow[]> {
  return db
    .select({
      id: attachments.id,
      fileName: attachments.fileName,
      fileSize: attachments.fileSize,
      mimeType: attachments.mimeType,
      uploadedAt: attachments.uploadedAt,
    })
    .from(attachments)
    .where(and(
      eq(attachments.entityType, "feedback_report"),
      eq(attachments.entityId, reportId),
    ))
    .orderBy(desc(attachments.uploadedAt))
}

export async function getReportEvents(reportId: string): Promise<FeedbackEventRow[]> {
  const rows = await db
    .select({
      id: feedbackReportEvents.id,
      reportId: feedbackReportEvents.reportId,
      eventType: feedbackReportEvents.eventType,
      fromEstado: feedbackReportEvents.fromEstado,
      toEstado: feedbackReportEvents.toEstado,
      note: feedbackReportEvents.note,
      actorId: feedbackReportEvents.actorId,
      createdAt: feedbackReportEvents.createdAt,
      actorName: users.name,
    })
    .from(feedbackReportEvents)
    .leftJoin(users, eq(feedbackReportEvents.actorId, users.id))
    .where(eq(feedbackReportEvents.reportId, reportId))
    .orderBy(desc(feedbackReportEvents.createdAt))

  return rows as FeedbackEventRow[]
}

// ── listReports ───────────────────────────────────────────────────────────────

function reportListConditions(filters: FeedbackListFilters) {
  const conditions = filters.mode === "own"
    ? [eq(feedbackReports.createdBy, filters.userId)]
    : []

  if (filters.q) {
    const search = `%${filters.q}%`
    conditions.push(or(
      ilike(feedbackReports.titulo, search),
      ilike(feedbackReports.descripcion, search),
    )!)
  }
  if (filters.estado) conditions.push(eq(feedbackReports.estado, filters.estado))
  if (filters.tipo) conditions.push(eq(feedbackReports.tipo, filters.tipo))
  if (filters.priority) conditions.push(eq(feedbackReports.priority, filters.priority))
  if (filters.sla) {
    const now = new Date()
    const nowIso = now.toISOString()
    const warningAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
    conditions.push(filters.sla === "overdue"
      ? and(sql`${feedbackReports.dueAt} IS NOT NULL`, lt(feedbackReports.dueAt, nowIso))!
      : and(
        sql`${feedbackReports.dueAt} IS NOT NULL`,
        gte(feedbackReports.dueAt, nowIso),
        lte(feedbackReports.dueAt, warningAt),
      )!)
  }
  return conditions
}

export async function countReports(filters: FeedbackListFilters): Promise<number> {
  const conditions = reportListConditions(filters)
  const [result] = await db
    .select({ count: count() })
    .from(feedbackReports)
    .where(conditions.length > 0 ? and(...conditions) : undefined)

  return result?.count ?? 0
}

export async function listReports(
  filters: FeedbackListFilters,
  limit  = 50,
  offset = 0
): Promise<FeedbackListRow[]> {
  const conditions = reportListConditions(filters)

  const rows = await db
    .select({
      id:          feedbackReports.id,
      tipo:        feedbackReports.tipo,
      titulo:      feedbackReports.titulo,
      priority:    feedbackReports.priority,
      dueAt:       feedbackReports.dueAt,
      estado:      feedbackReports.estado,
      createdBy:   feedbackReports.createdBy,
      createdAt:   feedbackReports.createdAt,
      authorName:  users.name,
    })
    .from(feedbackReports)
    .leftJoin(users, eq(feedbackReports.createdBy, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(feedbackReports.createdAt))
    .limit(limit)
    .offset(offset)

  return rows as FeedbackListRow[]
}

// ── updateReportStatus ────────────────────────────────────────────────────────

export async function updateReportStatus(
  id: string,
  input: Omit<z.infer<typeof feedbackUpdateStatusSchema>, "id">,
  userId: string
): Promise<FeedbackStatusUpdate> {
  const data = feedbackUpdateStatusSchema.parse({ ...input, id })
  const now = new Date().toISOString()

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(feedbackReports)
      .where(eq(feedbackReports.id, id))
      .limit(1)
    if (!existing) throw new Error("Reporte no encontrado")

    const note = data.notaInterna?.trim() || null
    const stateChanged = existing.estado !== data.estado
    if (!stateChanged && !note) {
      return { ...existing, stateChanged: false, noteAdded: false }
    }

    const changes: {
      updatedAt: string
      estado?: string
      notaInterna?: string
      resolvedBy?: string | null
      resolvedAt?: string | null
    } = { updatedAt: now }
    if (stateChanged) {
      changes.estado = data.estado
      const isTerminal = data.estado === "resuelto" || data.estado === "descartado"
      if (isTerminal) {
        changes.resolvedBy = userId
        changes.resolvedAt = now
      } else {
        changes.resolvedBy = null
        changes.resolvedAt = null
      }
    }
    if (note) changes.notaInterna = note

    const [updated] = await tx
      .update(feedbackReports)
      .set(changes)
      .where(eq(feedbackReports.id, id))
      .returning()
    if (!updated) throw new Error("Reporte no encontrado")

    await tx.insert(feedbackReportEvents).values({
      id: nanoid(),
      reportId: id,
      eventType: stateChanged ? "status_changed" : "note_added",
      fromEstado: stateChanged ? existing.estado : null,
      toEstado: stateChanged ? data.estado : null,
      note,
      actorId: userId,
      createdAt: now,
    })

    return { ...updated, stateChanged, noteAdded: Boolean(note) }
  })
}

function computeDueAt(priority: "baja" | "normal" | "alta" | "critica", fromIso: string) {
  const hoursByPriority = {
    baja: 10 * 24,
    normal: 5 * 24,
    alta: 48,
    critica: 24,
  } satisfies Record<typeof priority, number>
  const due = new Date(fromIso)
  due.setHours(due.getHours() + hoursByPriority[priority])
  return due.toISOString()
}
