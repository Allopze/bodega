import ExcelJS from "exceljs"
import { asc, eq, inArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { db } from "@/db"
import {
  preventionCapaActions,
  preventionCapaFollowups,
  preventionInspectionFindings,
  preventionInspectionRuns,
  preventionInspectionTemplates,
  users,
  worksites,
} from "@/db/schema"
import type { InspectionAccess } from "@/lib/services/prevention-inspections"
import { capaStatusLabel } from "@/lib/prevention/capa"
import { sanitizeCell } from "@/lib/reports/export-module/excel-builder"
import { formatDate, formatDateTime } from "@/lib/utils"

export interface InspectionFollowupRow {
  findingId: string
  kind: string
  date: string | null
  area: string
  deviation: string
  correctiveMeasure: string
  responsible: string
  targetDate: string | null
  status: string
  progress: number
  comments: string
}

export async function listInspectionFollowup(access: InspectionAccess): Promise<InspectionFollowupRow[]> {
  if (!access.permissions.includes("prevention:inspections:view")) throw new Error("Inspección no encontrada o fuera de alcance.")
  const responsible = alias(users, "inspection_followup_responsible")
  if (access.scope.mode === "none" || (access.scope.mode === "some" && access.scope.ids.length === 0)) return []
  const base = await db.select({
    findingId: preventionInspectionFindings.id,
    kind: preventionInspectionTemplates.kind,
    executedAt: preventionInspectionRuns.executedAt,
    scheduledFor: preventionInspectionRuns.scheduledFor,
    subjectLabel: preventionInspectionRuns.subjectLabel,
    worksiteId: preventionInspectionRuns.worksiteId,
    worksiteName: worksites.name,
    deviation: preventionInspectionFindings.description,
    actionId: preventionCapaActions.id,
    actionDescription: preventionCapaActions.actionDescription,
    responsibleName: responsible.name,
    responsibleSnapshot: preventionCapaActions.responsibleSnapshot,
    targetDate: preventionCapaActions.targetDate,
    status: preventionCapaActions.status,
  })
    .from(preventionInspectionFindings)
    .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionFindings.runId))
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionTemplates.id, preventionInspectionRuns.templateId))
    .innerJoin(worksites, eq(worksites.id, preventionInspectionRuns.worksiteId))
    .leftJoin(preventionCapaActions, eq(preventionCapaActions.id, preventionInspectionFindings.capaActionId))
    .leftJoin(responsible, eq(responsible.id, preventionCapaActions.responsibleUserId))
    .where(access.scope.mode === "all" ? undefined : inArray(preventionInspectionRuns.worksiteId, access.scope.ids))
    .orderBy(asc(preventionInspectionRuns.executedAt), asc(preventionInspectionFindings.createdAt))

  const scoped = base
  const actionIds = scoped.flatMap((row) => row.actionId ? [row.actionId] : [])
  const followups = actionIds.length === 0 ? [] : await db.select({
    actionId: preventionCapaFollowups.actionId,
    note: preventionCapaFollowups.note,
    progress: preventionCapaFollowups.progress,
    createdAt: preventionCapaFollowups.createdAt,
    author: users.name,
  }).from(preventionCapaFollowups)
    .innerJoin(users, eq(users.id, preventionCapaFollowups.createdByUserId))
    .where(inArray(preventionCapaFollowups.actionId, actionIds))
    .orderBy(asc(preventionCapaFollowups.createdAt))
  const byAction = new Map<string, typeof followups>()
  for (const followup of followups) {
    const rows = byAction.get(followup.actionId) ?? []
    rows.push(followup)
    byAction.set(followup.actionId, rows)
  }

  return scoped.map((row) => {
    const history = row.actionId ? byAction.get(row.actionId) ?? [] : []
    const explicitProgress = [...history].reverse().find((item) => item.progress !== null)?.progress
    const progress = explicitProgress ?? (["verified", "closed"].includes(row.status ?? "") ? 100 : 0)
    return {
      findingId: row.findingId,
      kind: row.kind,
      date: row.executedAt ?? row.scheduledFor,
      area: row.subjectLabel?.trim() || row.worksiteName,
      deviation: row.deviation,
      correctiveMeasure: row.actionDescription ?? "",
      responsible: row.responsibleName ?? row.responsibleSnapshot ?? "",
      targetDate: row.targetDate,
      status: row.status ? capaStatusLabel(row.status) : "Sin CAPA",
      progress,
      comments: history.map((item) => `${formatDateTime(item.createdAt)} · ${item.author}: ${item.note}`).join("\n"),
    }
  })
}

const HEADERS = ["Fecha", "Área", "Desviación", "Medidas correctivas", "Responsable", "Fecha Ejecución MC", "Status", "% Cumplimiento", "Comentarios"]

export async function buildInspectionFollowupWorkbook(access: InspectionAccess): Promise<ArrayBuffer> {
  if (!access.permissions.includes("prevention:inspections:export")) throw new Error("Sin permiso para exportar inspecciones.")
  const rows = await listInspectionFollowup(access)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Plataforma Chome"
  for (const spec of [
    { name: "SEGUIMENTO INSPECCIONES", rows: rows.filter((row) => row.kind !== "observation") },
    { name: "SEGUIMIENTO OBSERVACIONES", rows: rows.filter((row) => row.kind === "observation") },
  ]) {
    const worksheet = workbook.addWorksheet(spec.name)
    worksheet.addRow(HEADERS)
    for (const row of spec.rows) worksheet.addRow([
      row.date ? formatDate(row.date) : "",
      sanitizeCell(row.area), sanitizeCell(row.deviation), sanitizeCell(row.correctiveMeasure), sanitizeCell(row.responsible),
      row.targetDate ? formatDate(row.targetDate) : "", sanitizeCell(row.status), row.progress / 100, sanitizeCell(row.comments),
    ])
    worksheet.getRow(1).font = { bold: true }
    worksheet.getColumn(8).numFmt = "0%"
    worksheet.getColumn(9).alignment = { wrapText: true, vertical: "top" }
    worksheet.views = [{ state: "frozen", ySplit: 1 }]
    worksheet.autoFilter = { from: "A1", to: "I1" }
    worksheet.columns.forEach((column) => { column.width = 22 })
  }
  const buffer = await workbook.xlsx.writeBuffer()
  const bytes = new Uint8Array(buffer as ArrayBufferLike)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
