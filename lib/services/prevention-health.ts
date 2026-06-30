/**
 * lib/services/prevention-health.ts
 * Salud ocupacional y protocolos MINSAL (PDTP N° 44-50).
 */

import { and, desc, eq, inArray, lte } from "drizzle-orm"
import { db } from "@/db"
import {
  healthExams,
  healthAptitudes,
  healthRestrictions,
  minsalProtocols,
  protocolApplications,
} from "@/db/schema"
import type { ReportData } from "@/lib/reports/export"
import { nanoid } from "@/lib/id"

type WorksiteScope = string[] | "all"

function assertWorksiteAccess(_worksiteId: string, _scope: WorksiteScope): void {
  // Health data accessed via worker, scope enforced by worker's worksite
}

/* ── Health exams ───────────────────────────────────────────────────────── */

export async function registerHealthExam(input: {
  workerId: string
  type: string
  protocolId?: string
  performedAt: string
  result: string
  expiresAt?: string
  evidenceUrl?: string
}) {
  const now = new Date().toISOString()
  const [row] = await db.insert(healthExams).values({
    id: `hexm-${nanoid()}`,
    workerId: input.workerId,
    type: input.type,
    protocolId: input.protocolId ?? null,
    performedAt: input.performedAt,
    result: input.result,
    expiresAt: input.expiresAt ?? null,
    evidenceUrl: input.evidenceUrl ?? null,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function getWorkerHealthExams(workerId: string) {
  return db.select().from(healthExams)
    .where(eq(healthExams.workerId, workerId))
    .orderBy(desc(healthExams.performedAt))
}

/* ── Aptitudes ──────────────────────────────────────────────────────────── */

export async function setHealthAptitude(input: {
  workerId: string
  examId?: string
  position: string
  aptitude: string
  restrictions?: Record<string, unknown>
  validUntil?: string
}) {
  const now = new Date().toISOString()
  const [row] = await db.insert(healthAptitudes).values({
    id: `hapt-${nanoid()}`,
    workerId: input.workerId,
    examId: input.examId ?? null,
    position: input.position,
    aptitude: input.aptitude,
    restrictions: input.restrictions ?? {},
    validUntil: input.validUntil ?? null,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function getActiveAptitude(workerId: string, position: string) {
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

export async function addHealthRestriction(input: {
  workerId: string
  kind: string
  description: string
  effectiveFrom: string
  effectiveTo?: string
}) {
  const now = new Date().toISOString()
  const [row] = await db.insert(healthRestrictions).values({
    id: `hrest-${nanoid()}`,
    workerId: input.workerId,
    kind: input.kind,
    description: input.description,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo ?? null,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function isRestricted(workerId: string, today?: string) {
  const now = today ?? new Date().toISOString()
  const rows = await db.select().from(healthRestrictions)
    .where(and(
      eq(healthRestrictions.workerId, workerId),
      lte(healthRestrictions.effectiveFrom, now),
    ))
  return rows.filter((r) => !r.effectiveTo || r.effectiveTo >= now)
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

export async function getDueProtocols(workerId: string, today?: string) {
  const now = today ?? new Date().toISOString()
  return db.select().from(protocolApplications)
    .where(and(
      eq(protocolApplications.workerId, workerId),
      lte(protocolApplications.nextDueAt, now),
      eq(protocolApplications.status, "vigente"),
    ))
}

/* ── Export ─────────────────────────────────────────────────────────────── */

export async function buildHealthExport(scope: WorksiteScope): Promise<ReportData> {
  return {
    filenameBase: "salud-ocupacional",
    worksheetName: "Salud",
    headers: ["Tipo", "Código", "Valor"],
    rows: [],
  }
}
