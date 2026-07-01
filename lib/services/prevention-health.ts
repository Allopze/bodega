/**
 * lib/services/prevention-health.ts
 * Salud ocupacional y protocolos MINSAL (PDTP N° 44-50).
 *
 * Confidencialidad:
 *   `assertWorkerAccess` (línea siguiente) resuelve worker→worksite vía DB y
 *   rechaza el acceso si la faena no está en `scope`. Es el único gate de
 *   confidencialidad para datos médicos mientras las acciones de `salud/`
 *   no existan (Fase P3). **Las actions que se creen para este servicio
 *   DEBEN** usar `guardPermission("prevention:health:view")` (o equivalente)
 *   **y pasar el `scope` resuelto al servicio** — no basta con un `guardAuth()`
 *   plano. Cualquier action expuesta sin `assertWorkerAccess` reintroduce B3.
 */

import { and, desc, eq, inArray, lte } from "drizzle-orm"
import { db } from "@/db"
import {
  healthExams,
  healthAptitudes,
  healthRestrictions,
  minsalProtocols,
  protocolApplications,
  workers,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import {
  healthExamCreateSchema,
  healthAptitudeSchema,
  healthRestrictionCreateSchema,
} from "@/lib/validation/prevention"

type WorksiteScope = string[] | "all"

async function assertWorkerAccess(workerId: string, scope: WorksiteScope): Promise<void> {
  if (scope === "all") return
  const [worker] = await db.select({ worksiteId: workers.worksiteId }).from(workers).where(eq(workers.id, workerId)).limit(1)
  if (!worker) throw new Error("Trabajador no encontrado.")
  if (!scope.includes(worker.worksiteId)) throw new Error("Sin acceso a esta faena.")
}

/* ── Health exams ───────────────────────────────────────────────────────── */

export async function registerHealthExam(input: unknown, scope: WorksiteScope) {
  const data = healthExamCreateSchema.parse(input)
  await assertWorkerAccess(data.workerId, scope)

  const now = new Date().toISOString()
  const [row] = await db.insert(healthExams).values({
    id: `hexm-${nanoid()}`,
    workerId: data.workerId,
    type: data.type,
    protocolId: data.protocolId || null,
    performedAt: data.performedAt,
    result: data.result,
    expiresAt: data.expiresAt || null,
    evidenceUrl: data.evidenceUrl || null,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function getWorkerHealthExams(workerId: string, scope: WorksiteScope) {
  await assertWorkerAccess(workerId, scope)
  return db.select().from(healthExams)
    .where(eq(healthExams.workerId, workerId))
    .orderBy(desc(healthExams.performedAt))
}

/* ── Aptitudes ──────────────────────────────────────────────────────────── */

export async function setHealthAptitude(input: unknown, scope: WorksiteScope) {
  const data = healthAptitudeSchema.parse(input)
  await assertWorkerAccess(data.workerId, scope)

  const now = new Date().toISOString()
  const [row] = await db.insert(healthAptitudes).values({
    id: `hapt-${nanoid()}`,
    workerId: data.workerId,
    examId: data.examId || null,
    position: data.position,
    aptitude: data.aptitude,
    restrictions: data.restrictions,
    validUntil: data.validUntil || null,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function getActiveAptitude(workerId: string, position: string, scope: WorksiteScope) {
  await assertWorkerAccess(workerId, scope)
  const rows = await db.select().from(healthAptitudes)
    .where(and(
      eq(healthAptitudes.workerId, workerId),
      eq(healthAptitudes.position, position),
    ))
    .orderBy(desc(healthAptitudes.validUntil))
    .limit(1)
  return rows[0] ?? null
}

/* ── Restrictions ───────────────────────────────────────────────────────── */

export async function addHealthRestriction(input: unknown, scope: WorksiteScope) {
  const data = healthRestrictionCreateSchema.parse(input)
  await assertWorkerAccess(data.workerId, scope)

  const now = new Date().toISOString()
  const [row] = await db.insert(healthRestrictions).values({
    id: `hrest-${nanoid()}`,
    workerId: data.workerId,
    kind: data.kind,
    description: data.description,
    effectiveFrom: data.effectiveFrom,
    effectiveTo: data.effectiveTo || null,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function isRestricted(workerId: string, scope: WorksiteScope, today?: string) {
  await assertWorkerAccess(workerId, scope)
  const now = today ?? new Date().toISOString()
  const rows = await db.select().from(healthRestrictions)
    .where(and(
      eq(healthRestrictions.workerId, workerId),
      lte(healthRestrictions.effectiveFrom, now),
    ))
  return rows.filter((r) => !r.effectiveTo || r.effectiveTo >= now)
}

/**
 * Aviso de restricciones activas para otros módulos (P3.22): sin un mapeo
 * curso/tarea→kind de restricción no hay base para bloquear automáticamente,
 * así que esto solo hace visible la restricción (no rechaza) en capacitaciones,
 * equipos e incidentes.
 */
export async function describeActiveRestrictions(workerId: string, scope: WorksiteScope, today?: string): Promise<string | null> {
  const restrictions = await isRestricted(workerId, scope, today)
  if (restrictions.length === 0) return null
  return `Trabajador con restricción médica activa: ${restrictions.map((r) => r.kind).join(", ")}.`
}

/* ── MINSAL protocols ───────────────────────────────────────────────────── */

export async function seedMinsalProtocols() {
  const now = new Date().toISOString()
  const protocols = [
    { code: "prexor", name: "PREXOR", legalFramework: "DS N° 44/2025", appliesToPositions: ["Operador", "Conductor", "JT"], periodicityMonths: 12 },
    { code: "tmert", name: "TMERT", legalFramework: "Norma Técnica MINSAL", appliesToPositions: ["Administrativo", "Operador"], periodicityMonths: 24 },
    { code: "psicosocial", name: "Riesgo Psicosocial", legalFramework: "Protocolo MINSAL", appliesToPositions: ["Todos"], periodicityMonths: 24 },
    { code: "uv", name: "Radiación UV", legalFramework: "Ley 20.096", appliesToPositions: ["Operador", "JT", "Conductor"], periodicityMonths: 12 },
    { code: "silice", name: "Sílice", legalFramework: "Protocolo MINSAL", appliesToPositions: ["Operador"], periodicityMonths: 36 },
    { code: "hiperbaria", name: "Hiperbaria", legalFramework: "DS N° 594", appliesToPositions: [], periodicityMonths: 12 },
    { code: "estres_termico", name: "Estrés Térmico", legalFramework: "DS N° 594", appliesToPositions: ["Operador", "JT"], periodicityMonths: 12 },
  ]

  for (const p of protocols) {
    await db.insert(minsalProtocols).values({
      id: `mspr-${p.code}`,
      ...p,
      appliesToPositions: p.appliesToPositions,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing()
  }
}

export async function listMinsalProtocols() {
  return db.select().from(minsalProtocols).orderBy(minsalProtocols.code)
}

export async function getDueProtocols(workerId: string, scope: WorksiteScope, today?: string) {
  await assertWorkerAccess(workerId, scope)
  const now = today ?? new Date().toISOString()
  return db.select().from(protocolApplications)
    .where(and(
      eq(protocolApplications.workerId, workerId),
      lte(protocolApplications.nextDueAt, now),
      eq(protocolApplications.status, "vigente"),
    ))
}

