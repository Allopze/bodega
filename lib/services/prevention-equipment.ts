/**
 * lib/services/prevention-equipment.ts
 * Reportes diarios de equipos, revisiones, checklists y sanitización (PDTP N° 25-34).
 */

import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  equipmentDailyReports,
  equipmentReportReviews,
  equipmentChecklists,
  sanitizationControls,
} from "@/db/schema"
import type { ReportData } from "@/lib/reports/export"
import { nanoid } from "@/lib/id"
import {
  equipmentDailyReportSchema,
  equipmentReportReviewSchema,
  equipmentChecklistSchema,
} from "@/lib/validation/prevention"

type WorksiteScope = string[] | "all"

function assertWorksiteAccess(worksiteId: string, scope: WorksiteScope): void {
  if (scope === "all") return
  if (!scope.includes(worksiteId)) throw new Error("Sin acceso a esta faena.")
}

/* ── Daily reports ──────────────────────────────────────────────────────── */

export async function createEquipmentReport(input: unknown, userId: string, scope: WorksiteScope) {
  const data = equipmentDailyReportSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)

  const now = new Date().toISOString()
  const [row] = await db.insert(equipmentDailyReports).values({
    id: `edr-${nanoid()}`,
    worksiteId: data.worksiteId,
    equipmentId: data.equipmentId,
    operatorWorkerId: data.operatorWorkerId,
    reportedAt: now,
    shift: data.shift,
    status: data.status,
    odometer: data.odometer ?? null,
    hourmeter: data.hourmeter ?? null,
    checklist: data.checklist,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function listEquipmentReports(scope: WorksiteScope, worksiteId?: string, limit = 200) {
  const conditions: ReturnType<typeof eq>[] = []
  if (worksiteId) {
    assertWorksiteAccess(worksiteId, scope)
    conditions.push(eq(equipmentDailyReports.worksiteId, worksiteId))
  } else if (scope !== "all") {
    conditions.push(inArray(equipmentDailyReports.worksiteId, scope))
  }
  return db.select().from(equipmentDailyReports)
    .where(and(...conditions))
    .orderBy(desc(equipmentDailyReports.reportedAt))
    .limit(limit)
}

export async function signEquipmentReport(reportId: string, workerId: string, scope: WorksiteScope) {
  const [report] = await db.select().from(equipmentDailyReports)
    .where(eq(equipmentDailyReports.id, reportId)).limit(1)
  if (!report) throw new Error("Reporte no encontrado.")
  assertWorksiteAccess(report.worksiteId, scope)

  const now = new Date().toISOString()
  const [updated] = await db.update(equipmentDailyReports)
    .set({ signedByWorkerId: workerId, updatedAt: now })
    .where(eq(equipmentDailyReports.id, reportId))
    .returning()
  return updated
}

/* ── Reviews ────────────────────────────────────────────────────────────── */

export async function reviewEquipmentReport(input: unknown, userId: string, scope: WorksiteScope) {
  const data = equipmentReportReviewSchema.parse(input)

  const [report] = await db.select().from(equipmentDailyReports)
    .where(eq(equipmentDailyReports.id, data.reportId)).limit(1)
  if (!report) throw new Error("Reporte no encontrado.")
  assertWorksiteAccess(report.worksiteId, scope)

  const now = new Date().toISOString()
  const id = `err-${nanoid()}`
  const [row] = await db.insert(equipmentReportReviews).values({
    id,
    reportId: data.reportId,
    reviewedByUserId: userId,
    reviewedAt: now,
    status: data.status,
    findings: data.findings,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: equipmentReportReviews.reportId,
    set: {
      status: data.status,
      findings: data.findings,
      reviewedByUserId: userId,
      reviewedAt: now,
      updatedAt: now,
    },
  }).returning()
  return row
}

/* ── Checklists ─────────────────────────────────────────────────────────── */

export async function createEquipmentChecklist(input: unknown, userId: string, scope: WorksiteScope) {
  const data = equipmentChecklistSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)

  const now = new Date().toISOString()
  const [row] = await db.insert(equipmentChecklists).values({
    id: `echk-${nanoid()}`,
    worksiteId: data.worksiteId,
    kind: data.kind,
    assetCode: data.assetCode,
    performedByUserId: userId,
    performedAt: now,
    items: data.items,
    status: data.status,
    closeRequired: data.closeRequired,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function listEquipmentChecklists(scope: WorksiteScope, kind?: string, limit = 200) {
  const conditions: ReturnType<typeof eq>[] = []
  if (kind) conditions.push(eq(equipmentChecklists.kind, kind))
  if (scope !== "all") conditions.push(inArray(equipmentChecklists.worksiteId, scope))
  return db.select().from(equipmentChecklists)
    .where(and(...conditions))
    .orderBy(desc(equipmentChecklists.performedAt))
    .limit(limit)
}

export async function closeEquipmentChecklist(checklistId: string, scope: WorksiteScope) {
  const [row] = await db.select().from(equipmentChecklists)
    .where(eq(equipmentChecklists.id, checklistId)).limit(1)
  if (!row) throw new Error("Checklist no encontrado.")
  assertWorksiteAccess(row.worksiteId, scope)

  const now = new Date().toISOString()
  const [updated] = await db.update(equipmentChecklists)
    .set({ closedAt: now, updatedAt: now })
    .where(eq(equipmentChecklists.id, checklistId))
    .returning()
  return updated
}

/* ── Sanitization ───────────────────────────────────────────────────────── */

export async function createSanitizationControl(input: {
  worksiteId: string
  providerName: string
  serviceDate: string
  reportUrl?: string
  expiresAt?: string
}, userId: string, scope: WorksiteScope) {
  assertWorksiteAccess(input.worksiteId, scope)
  const now = new Date().toISOString()
  const [row] = await db.insert(sanitizationControls).values({
    id: `sc-${nanoid()}`,
    worksiteId: input.worksiteId,
    providerName: input.providerName,
    serviceDate: input.serviceDate,
    reportUrl: input.reportUrl ?? null,
    status: "pendiente",
    expiresAt: input.expiresAt ?? null,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function listSanitizationControls(scope: WorksiteScope, limit = 100) {
  const where = scope === "all" ? undefined : inArray(sanitizationControls.worksiteId, scope)
  return db.select().from(sanitizationControls).where(where)
    .orderBy(desc(sanitizationControls.serviceDate)).limit(limit)
}

/* ── Export XLSX ────────────────────────────────────────────────────────── */

export async function buildEquipmentReportsExport(scope: WorksiteScope): Promise<ReportData> {
  const rows = await listEquipmentReports(scope)
  return {
    filenameBase: "reportes-equipos",
    worksheetName: "Reportes diarios",
    headers: ["ID", "Faena", "Equipo", "Operador", "Turno", "Estado", "Odómetro", "Horómetro", "Fecha"],
    rows: rows.map((r) => [r.id, r.worksiteId, r.equipmentId, r.operatorWorkerId, r.shift, r.status, r.odometer, r.hourmeter, r.reportedAt]),
  }
}

export async function buildEquipmentChecklistsExport(scope: WorksiteScope): Promise<ReportData> {
  const rows = await listEquipmentChecklists(scope)
  return {
    filenameBase: "checklists-equipos",
    worksheetName: "Checklists",
    headers: ["ID", "Faena", "Tipo", "Activo", "Estado", "Requiere cierre", "Cerrado", "Fecha"],
    rows: rows.map((r) => [r.id, r.worksiteId, r.kind, r.assetCode, r.status, r.closeRequired ? "Sí" : "No", r.closedAt ?? "", r.performedAt]),
  }
}
