/**
 * lib/services/prevention-emergency.ts
 * Planes de emergencia, simulacros, brigadas, equipos (PDTP N° 79-84).
 */

import { and, desc, eq, inArray, lt } from "drizzle-orm"
import { db } from "@/db"
import {
  emergencyPlans,
  emergencyDrills,
  emergencyTeams,
  emergencyEquipment,
  equipmentInspections,
} from "@/db/schema"
import type { ReportData } from "@/lib/reports/export"
import { nanoid } from "@/lib/id"
import {
  emergencyPlanCreateSchema,
  emergencyDrillScheduleSchema,
  emergencyDrillExecutionSchema,
  emergencyEquipmentCreateSchema,
  equipmentInspectionCreateSchema,
} from "@/lib/validation/prevention"

type WorksiteScope = string[] | "all"

function assertWorksiteAccess(worksiteId: string, scope: WorksiteScope): void {
  if (scope === "all") return
  if (!scope.includes(worksiteId)) throw new Error("Sin acceso a esta faena.")
}

/* ── Plans ──────────────────────────────────────────────────────────────── */

export async function createEmergencyPlan(input: unknown, _userId: string, scope: WorksiteScope) {
  const data = emergencyPlanCreateSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)
  const now = new Date().toISOString()
  // FIX P3.13 (audit §2.3): un plan nace en `borrador` con approvedBy/At nulos.
  // Antes se auto-aprobaba al crear, lo cual volvía decorativas las columnas
  // de aprobación. La aprobación ahora es una acción separada (ver
  // `approveEmergencyPlan`) que exige un permiso dedicado.
  const [row] = await db.insert(emergencyPlans).values({
    id: `empl-${nanoid()}`,
    worksiteId: data.worksiteId,
    version: 1,
    threats: data.threats,
    roles: data.roles,
    routes: data.routes,
    approvedBy: null,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
  }).returning()
  if (!row) throw new Error("No se pudo crear el plan de emergencia.")
  return row
}

export async function approveEmergencyPlan(planId: string, userId: string, scope: WorksiteScope) {
  const [plan] = await db.select().from(emergencyPlans).where(eq(emergencyPlans.id, planId)).limit(1)
  if (!plan) throw new Error("Plan de emergencia no encontrado.")
  assertWorksiteAccess(plan.worksiteId, scope)
  if (plan.approvedAt) throw new Error("El plan ya está aprobado.")

  const now = new Date().toISOString()
  const [updated] = await db.update(emergencyPlans)
    .set({ approvedBy: userId, approvedAt: now, updatedAt: now })
    .where(eq(emergencyPlans.id, planId))
    .returning()
  if (!updated) throw new Error("No se pudo aprobar el plan.")
  return updated
}

export async function getActiveEmergencyPlan(worksiteId: string, scope: WorksiteScope) {
  assertWorksiteAccess(worksiteId, scope)
  const rows = await db.select().from(emergencyPlans)
    .where(eq(emergencyPlans.worksiteId, worksiteId))
    .orderBy(desc(emergencyPlans.version))
    .limit(1)
  return rows[0] ?? null
}

/* ── Drills ─────────────────────────────────────────────────────────────── */

export async function scheduleDrill(input: unknown, scope: WorksiteScope) {
  const data = emergencyDrillScheduleSchema.parse(input)
  const [plan] = await db.select().from(emergencyPlans).where(eq(emergencyPlans.id, data.planId)).limit(1)
  if (!plan) throw new Error("Plan no encontrado.")
  assertWorksiteAccess(plan.worksiteId, scope)

  const now = new Date().toISOString()
  const [row] = await db.insert(emergencyDrills).values({
    id: `edrl-${nanoid()}`,
    planId: data.planId,
    type: data.type,
    scheduledAt: data.scheduledAt,
    findings: {},
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function recordDrillExecution(drillId: string, input: unknown, scope: WorksiteScope) {
  const data = emergencyDrillExecutionSchema.parse(input)
  const [drill] = await db.select().from(emergencyDrills).where(eq(emergencyDrills.id, drillId)).limit(1)
  if (!drill) throw new Error("Simulacro no encontrado.")
  const [plan] = await db.select().from(emergencyPlans).where(eq(emergencyPlans.id, drill.planId)).limit(1)
  if (!plan) throw new Error("Plan no encontrado.")
  assertWorksiteAccess(plan.worksiteId, scope)

  const now = new Date().toISOString()
  const [updated] = await db.update(emergencyDrills).set({
    executedAt: now,
    attendees: data.attendees ?? null,
    findings: data.findings,
    effectiveness: data.effectiveness || null,
    updatedAt: now,
  }).where(eq(emergencyDrills.id, drillId)).returning()
  return updated
}

export async function listDrills(scope: WorksiteScope) {
  const plans = scope === "all"
    ? await db.select({ id: emergencyPlans.id }).from(emergencyPlans)
    : await db.select({ id: emergencyPlans.id }).from(emergencyPlans).where(inArray(emergencyPlans.worksiteId, scope))
  const planIds = plans.map((p) => p.id)
  if (planIds.length === 0) return []
  return db.select().from(emergencyDrills)
    .where(inArray(emergencyDrills.planId, planIds))
    .orderBy(desc(emergencyDrills.scheduledAt))
}

/* ── Equipment ──────────────────────────────────────────────────────────── */

export async function registerEmergencyEquipment(input: unknown, scope: WorksiteScope) {
  const data = emergencyEquipmentCreateSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)
  const now = new Date().toISOString()
  const [row] = await db.insert(emergencyEquipment).values({
    id: `eeqp-${nanoid()}`,
    worksiteId: data.worksiteId,
    kind: data.kind,
    code: data.code,
    location: data.location,
    nextInspectionAt: data.nextInspectionAt || null,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function getOverdueEquipmentInspections(worksiteId: string, scope: WorksiteScope) {
  assertWorksiteAccess(worksiteId, scope)
  const now = new Date().toISOString()
  return db.select().from(emergencyEquipment)
    .where(and(
      eq(emergencyEquipment.worksiteId, worksiteId),
      lt(emergencyEquipment.nextInspectionAt, now),
    ))
}

export async function recordEquipmentInspection(input: unknown, userId: string, scope: WorksiteScope) {
  const data = equipmentInspectionCreateSchema.parse(input)
  const [eqp] = await db.select().from(emergencyEquipment).where(eq(emergencyEquipment.id, data.equipmentId)).limit(1)
  if (!eqp) throw new Error("Equipo no encontrado.")
  assertWorksiteAccess(eqp.worksiteId, scope)

  const now = new Date().toISOString()
  const [row] = await db.insert(equipmentInspections).values({
    id: `eins-${nanoid()}`,
    equipmentId: data.equipmentId,
    performedAt: now,
    performedBy: userId,
    status: data.status,
    findings: data.findings,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

/* ── Export ─────────────────────────────────────────────────────────────── */

export async function buildEmergencyExport(scope: WorksiteScope): Promise<ReportData> {
  const drills = await listDrills(scope)
  return {
    filenameBase: "emergencias",
    worksheetName: "Emergencias",
    headers: ["Tipo", "Fecha", "Asistentes", "Efectividad"],
    rows: drills.map((d) => [d.type, d.scheduledAt, d.attendees ?? "-", d.effectiveness ?? "-"]),
  }
}
