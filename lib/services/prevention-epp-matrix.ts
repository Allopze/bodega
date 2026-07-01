/**
 * lib/services/prevention-epp-matrix.ts
 * Matriz EPP por cargo/riesgo, ciclo de vida, recambio, stock crítico (PDTP N° 61-65).
 */

import { and, desc, eq, inArray, isNull, lte } from "drizzle-orm"
import { db } from "@/db"
import {
  eppPositionMatrix,
  eppLifecyclePolicies,
  eppRecambioLog,
  eppStockThresholds,
  workers,
} from "@/db/schema"
import type { ReportData } from "@/lib/reports/export"
import { nanoid } from "@/lib/id"
import {
  eppPositionEntrySchema,
  eppLifecyclePolicySchema,
  eppStockThresholdSchema,
  eppDeliveryLogSchema,
} from "@/lib/validation/prevention"

type WorksiteScope = string[] | "all"

function assertWorksiteAccess(worksiteId: string, scope: WorksiteScope): void {
  if (scope === "all") return
  if (!scope.includes(worksiteId)) throw new Error("Sin acceso a esta faena.")
}

async function assertWorkerAccess(workerId: string, scope: WorksiteScope): Promise<void> {
  if (scope === "all") return
  const [worker] = await db.select({ worksiteId: workers.worksiteId }).from(workers).where(eq(workers.id, workerId)).limit(1)
  if (!worker) throw new Error("Trabajador no encontrado.")
  if (!scope.includes(worker.worksiteId)) throw new Error("Sin acceso a esta faena.")
}

/* ── Position matrix ────────────────────────────────────────────────────── */

export async function setEppPositionEntry(input: unknown, userId: string, scope: WorksiteScope) {
  const data = eppPositionEntrySchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)

  const now = new Date().toISOString()
  const [row] = await db.insert(eppPositionMatrix).values({
    id: `epm-${nanoid()}`,
    worksiteId: data.worksiteId,
    position: data.position,
    eppProductId: data.eppProductId,
    riskId: data.riskId || null,
    requiredSince: data.requiredSince,
    notes: data.notes ?? null,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [eppPositionMatrix.worksiteId, eppPositionMatrix.position, eppPositionMatrix.eppProductId],
    set: {
      riskId: data.riskId || null,
      requiredSince: data.requiredSince,
      notes: data.notes ?? null,
      updatedAt: now,
    },
  }).returning()
  return row
}

export async function getEppMatrix(worksiteId: string, scope: WorksiteScope) {
  assertWorksiteAccess(worksiteId, scope)
  return db.select().from(eppPositionMatrix)
    .where(eq(eppPositionMatrix.worksiteId, worksiteId))
    .orderBy(eppPositionMatrix.position)
}

export async function getEppByPosition(worksiteId: string, position: string, scope: WorksiteScope) {
  assertWorksiteAccess(worksiteId, scope)
  return db.select().from(eppPositionMatrix)
    .where(and(
      eq(eppPositionMatrix.worksiteId, worksiteId),
      eq(eppPositionMatrix.position, position),
    ))
}

/* ── Lifecycle policies ─────────────────────────────────────────────────── */

export async function setEppLifecyclePolicy(input: unknown) {
  const data = eppLifecyclePolicySchema.parse(input)
  const now = new Date().toISOString()
  const [row] = await db.insert(eppLifecyclePolicies).values({
    eppProductId: data.eppProductId,
    lifespanDays: data.lifespanDays,
    maxReuses: data.maxReuses ?? null,
    inspectionChecklist: data.inspectionChecklist,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: eppLifecyclePolicies.eppProductId,
    set: {
      lifespanDays: data.lifespanDays,
      maxReuses: data.maxReuses ?? null,
      inspectionChecklist: data.inspectionChecklist,
      updatedAt: now,
    },
  }).returning()
  return row
}

export async function getEppLifecyclePolicy(eppProductId: string) {
  const [row] = await db.select().from(eppLifecyclePolicies)
    .where(eq(eppLifecyclePolicies.eppProductId, eppProductId))
    .limit(1)
  return row ?? null
}

/* ── Recambio log ───────────────────────────────────────────────────────── */

export async function logEppDelivery(input: unknown, scope: WorksiteScope = "all") {
  const data = eppDeliveryLogSchema.parse(input)
  await assertWorkerAccess(data.workerId, scope)
  const policy = await getEppLifecyclePolicy(data.eppProductId)
  const now = new Date().toISOString()
  const deliveredAt = data.deliveredAt || now

  let expiresAt: string | null = null
  if (policy) {
    const delivDate = new Date(deliveredAt)
    delivDate.setDate(delivDate.getDate() + policy.lifespanDays)
    expiresAt = delivDate.toISOString()
  }

  const [row] = await db.insert(eppRecambioLog).values({
    id: `ercl-${nanoid()}`,
    workerId: data.workerId,
    eppProductId: data.eppProductId,
    deliveredAt,
    expiresAt,
    evidenceUrl: data.evidenceUrl,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function acknowledgeEppDelivery(recambioLogId: string, scope: WorksiteScope = "all") {
  const [existing] = await db.select().from(eppRecambioLog).where(eq(eppRecambioLog.id, recambioLogId)).limit(1)
  if (!existing) throw new Error("Entrega de EPP no encontrada.")
  await assertWorkerAccess(existing.workerId, scope)

  const now = new Date().toISOString()
  const [row] = await db.update(eppRecambioLog)
    .set({ acknowledgedAt: now, updatedAt: now })
    .where(eq(eppRecambioLog.id, recambioLogId))
    .returning()
  if (!row) throw new Error("Entrega de EPP no encontrada.")
  return row
}

export async function listEppDeliveries(worksiteId: string, scope: WorksiteScope, limit = 50) {
  assertWorksiteAccess(worksiteId, scope)
  const worksiteWorkers = await db.select({ id: workers.id }).from(workers).where(eq(workers.worksiteId, worksiteId))
  const workerIds = worksiteWorkers.map((w) => w.id)
  if (workerIds.length === 0) return []
  return db.select().from(eppRecambioLog)
    .where(inArray(eppRecambioLog.workerId, workerIds))
    .orderBy(desc(eppRecambioLog.deliveredAt))
    .limit(limit)
}

export async function getWorkerActiveEpp(workerId: string) {
  const now = new Date().toISOString()
  return db.select().from(eppRecambioLog)
    .where(and(
      eq(eppRecambioLog.workerId, workerId),
      isNull(eppRecambioLog.returnedAt),
    ))
    .orderBy(eppRecambioLog.deliveredAt)
}

export async function getExpiredEpp(worksiteId: string, scope: WorksiteScope, today?: string) {
  assertWorksiteAccess(worksiteId, scope)
  const now = today ?? new Date().toISOString()
  // eppRecambioLog no tiene worksiteId propio; se resuelve via la faena del trabajador.
  const worksiteWorkers = await db.select({ id: workers.id }).from(workers).where(eq(workers.worksiteId, worksiteId))
  const workerIds = worksiteWorkers.map((w) => w.id)
  if (workerIds.length === 0) return []
  return db.select().from(eppRecambioLog)
    .where(and(
      inArray(eppRecambioLog.workerId, workerIds),
      isNull(eppRecambioLog.returnedAt),
      lte(eppRecambioLog.expiresAt, now),
    ))
}

/* ── Stock thresholds ───────────────────────────────────────────────────── */

export async function setEppStockThreshold(input: unknown, scope: WorksiteScope) {
  const data = eppStockThresholdSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)

  const now = new Date().toISOString()
  const [row] = await db.insert(eppStockThresholds).values({
    id: `est-${nanoid()}`,
    worksiteId: data.worksiteId,
    eppProductId: data.eppProductId,
    minStock: data.minStock,
    criticalStock: data.criticalStock,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [eppStockThresholds.worksiteId, eppStockThresholds.eppProductId],
    set: {
      minStock: data.minStock,
      criticalStock: data.criticalStock,
      updatedAt: now,
    },
  }).returning()
  return row
}

export async function getStockThresholds(worksiteId: string, scope: WorksiteScope) {
  assertWorksiteAccess(worksiteId, scope)
  return db.select().from(eppStockThresholds)
    .where(eq(eppStockThresholds.worksiteId, worksiteId))
}

export async function getCriticalStock(worksiteId: string, scope: WorksiteScope) {
  assertWorksiteAccess(worksiteId, scope)
  return db.select().from(eppStockThresholds)
    .where(and(
      eq(eppStockThresholds.worksiteId, worksiteId),
      eq(eppStockThresholds.criticalStock, 0),
    ))
}

/* ── Export XLSX ────────────────────────────────────────────────────────── */

export async function buildEppMatrixExport(worksiteId: string, scope: WorksiteScope): Promise<ReportData> {
  const rows = await getEppMatrix(worksiteId, scope)
  return {
    filenameBase: `matriz-epp-${worksiteId}`,
    worksheetName: "Matriz EPP",
    headers: ["ID", "Faena", "Cargo", "EPP ProductId", "RiskId", "Vigencia desde", "Notas"],
    rows: rows.map((r) => [r.id, r.worksiteId, r.position, r.eppProductId, r.riskId ?? "", r.requiredSince, r.notes ?? ""]),
  }
}
