/**
 * lib/services/feedback.ts
 * Módulo Soporte — lógica de negocio sobre feedback_reports.
 * Sin "use server", sin imports de UI.
 */

import { z } from "zod"
import { eq, and, desc } from "drizzle-orm"
import { db } from "@/db"
import { feedbackReports, type FeedbackReport } from "@/db/schema/feedback"
import { users } from "@/db/schema/users"
import { nanoid } from "@/lib/id"
import { feedbackCreateSchema, feedbackUpdateStatusSchema } from "@/lib/validation/feedback"

// ── Tipos de resultado ─────────────────────────────────────────────────────────

export type FeedbackRow = FeedbackReport & {
  authorName:  string
  authorEmail: string
}

// ── createReport ──────────────────────────────────────────────────────────────

export async function createReport(
  input: z.infer<typeof feedbackCreateSchema>,
  userId: string
): Promise<FeedbackReport> {
  const data = feedbackCreateSchema.parse(input)

  const id  = nanoid()
  const now = new Date().toISOString()

  const [report] = await db.insert(feedbackReports).values({
    id,
    tipo:        data.tipo,
    titulo:      data.titulo,
    descripcion: data.descripcion,
    pagina:      data.pagina || null,
    estado:      "abierto",
    notaInterna: null,
    createdBy:   userId,
    resolvedBy:  null,
    resolvedAt:  null,
    createdAt:   now,
    updatedAt:   now,
  }).returning()

  if (!report) throw new Error("Error al crear el reporte")
  return report
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

// ── listReports ───────────────────────────────────────────────────────────────

export async function listReports(
  filters: { mode: "own" | "all"; userId: string },
  limit  = 50,
  offset = 0
): Promise<FeedbackRow[]> {
  const conditions = filters.mode === "own"
    ? [eq(feedbackReports.createdBy, filters.userId)]
    : []

  const rows = await db
    .select({
      id:          feedbackReports.id,
      tipo:        feedbackReports.tipo,
      titulo:      feedbackReports.titulo,
      descripcion: feedbackReports.descripcion,
      pagina:      feedbackReports.pagina,
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
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(feedbackReports.createdAt))
    .limit(limit)
    .offset(offset)

  return rows as FeedbackRow[]
}

// ── updateReportStatus ────────────────────────────────────────────────────────

export async function updateReportStatus(
  id: string,
  input: z.infer<typeof feedbackUpdateStatusSchema>,
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
