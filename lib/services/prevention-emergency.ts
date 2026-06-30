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

type WorksiteScope = string[] | "all"

function assertWorksiteAccess(worksiteId: string, scope: WorksiteScope): void {
  if (scope === "all") return
  if (!scope.includes(worksiteId)) throw new Error("Sin acceso a esta faena.")
}

/* ── Plans ──────────────────────────────────────────────────────────────── */

export async function createEmergencyPlan(input: {
  worksiteId: string
  threats: Record<string, unknown>
  roles: Record<string, unknown>
  routes: Record<string, unknown>
}, userId: string, scope: WorksiteScope) {
  assertWorksiteAccess(input.worksiteId, scope)
  const now = new Date().toISOString()
  const [row] = await db.insert(emergencyPlans).values({
    id: `empl-${nanoid()}`,
    worksiteId: input.worksiteId,
    version: 1,
    threats: input.threats,
    roles: input.roles,
    routes: input.routes,
    approvedBy: userId,
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
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

export async function scheduleDrill(input: {
  planId: string
  type: string
  scheduledAt: string
}, scope: WorksiteScope) {
  const [plan] = await db.select().from(emergencyPlans).where(eq(emergencyPlans.id, input.planId)).limit(1)
  if (!plan) throw new Error("Plan no encontrado.")
  assertWorksiteAccess(plan.worksiteId, scope)

  const now = new Date().toISOString()
  const [row] = await db.insert(emergencyDrills).values({
    id: `edrl-${nanoid()}`,
    planId: input.planId,
    type: input.type,
    scheduledAt: input.scheduledAt,
    findings: {},
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function recordDrillExecution(drillId: string, input: {
  attendees?: number
  findings?: Record<string, unknown>
  effectiveness?: string
}, scope: WorksiteScope) {
  const [drill] = await db.select().from(emergencyDrills).where(eq(emergencyDrills.id, drillId)).limit(1)
  if (!drill) throw new Error("Simulacro no encontrado.")
  const [plan] = await db.select().from(emergencyPlans).where(eq(emergencyPlans.id, drill.planId)).limit(1)
  if (!plan) throw new Error("Plan no encontrado.")
  assertWorksiteAccess(plan.worksiteId, scope)

  const now = new Date().toISOString()
  const [updated] = await db.update(emergencyDrills).set({
    executedAt: now,
    attendees: input.attendees ?? null,
    findings: input.findings ?? {},
    effectiveness: input.effectiveness ?? null,
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

export async function registerEmergencyEquipment(input: {
  worksiteId: string
  kind: string
  code: string
  location: string
  nextInspectionAt?: string
}, scope: WorksiteScope) {
  assertWorksiteAccess(input.worksiteId, scope)
  const now = new Date().toISOString()
  const [row] = await db.insert(emergencyEquipment).values({
    id: `eeqp-${nanoid()}`,
    worksiteId: input.worksiteId,
    kind: input.kind,
    code: input.code,
    location: input.location,
    nextInspectionAt: input.nextInspectionAt ?? null,
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

export async function recordEquipmentInspection(input: {
  equipmentId: string
  status: string
  findings: Record<string, unknown>
}, userId: string, scope: WorksiteScope) {
  const [eqp] = await db.select().from(emergencyEquipment).where(eq(emergencyEquipment.id, input.equipmentId)).limit(1)
  if (!eqp) throw new Error("Equipo no encontrado.")
  assertWorksiteAccess(eqp.worksiteId, scope)

  const now = new Date().toISOString()
  const [row] = await db.insert(equipmentInspections).values({
    id: `eins-${nanoid()}`,
    equipmentId: input.equipmentId,
    performedAt: now,
    performedBy: userId,
    status: input.status,
    findings: input.findings,
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
