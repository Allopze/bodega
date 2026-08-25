/**
 * lib/services/feedback.ts
 * Módulo Soporte — lógica de negocio sobre feedback_reports.
 * Sin "use server", sin imports de UI.
 */

import { z } from "zod"
import { eq, and, desc, ilike, or, count } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import { feedbackReports, type FeedbackReport } from "@/db/schema/feedback"
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
): Promise<FeedbackReport> {
  const data = feedbackUpdateStatusSchema.parse({ ...input, id })

  const isTerminal = data.estado === "resuelto" || data.estado === "descartado"
  const now = new Date().toISOString()

  const [updated] = await db
    .update(feedbackReports)
    .set({
      estado:      data.estado,
      notaInterna: data.notaInterna || null,
      resolvedBy:  isTerminal ? userId : null,
      resolvedAt:  isTerminal ? now : null,
      updatedAt:   now,
    })
    .where(eq(feedbackReports.id, id))
    .returning()

  if (!updated) throw new Error("Reporte no encontrado")
  return updated
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
