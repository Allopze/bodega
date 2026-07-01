/**
 * lib/services/prevention-inspections.ts
 * Inspecciones planificadas y observaciones conductuales (PDTP N° 39-41).
 */

import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  inspectionTemplates,
  inspectionRuns,
  inspectionItems,
  behavioralObservations,
} from "@/db/schema"
import type { ReportData } from "@/lib/reports/export"
import { nanoid } from "@/lib/id"
import {
  inspectionTemplateCreateSchema,
  inspectionRunCreateSchema,
  inspectionItemUpdateSchema,
  inspectionRunCloseSchema,
  behavioralObservationCreateSchema,
} from "@/lib/validation/prevention"

type WorksiteScope = string[] | "all"

export function assertWorksiteAccess(worksiteId: string, scope: WorksiteScope): void {
  if (scope === "all") return
  if (!scope.includes(worksiteId)) {
    throw new Error("Sin acceso a esta faena.")
  }
}

/* ── Templates ──────────────────────────────────────────────────────────── */

export async function createInspectionTemplate(input: unknown) {
  const data = inspectionTemplateCreateSchema.parse(input)
  const now = new Date().toISOString()
  const [row] = await db.insert(inspectionTemplates).values({
    id: `itpl-${nanoid()}`,
    code: data.code,
    title: data.title,
    scope: data.scope,
    items: data.items,
    frequency: data.frequency,
    requiresPhoto: data.requiresPhoto,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function listInspectionTemplates() {
  return db.select().from(inspectionTemplates).orderBy(inspectionTemplates.code)
}

/* ── Runs ────────────────────────────────────────────────────────────────── */

export async function createInspectionRun(input: unknown, userId: string, scope: WorksiteScope) {
  const data = inspectionRunCreateSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)

  const [template] = await db.select().from(inspectionTemplates)
    .where(eq(inspectionTemplates.id, data.templateId))
    .limit(1)
  if (!template) throw new Error("Plantilla de inspección no encontrada.")

  const now = new Date().toISOString()
  const runId = `irun-${nanoid()}`

  const [run] = await db.insert(inspectionRuns).values({
    id: runId,
    templateId: data.templateId,
    worksiteId: data.worksiteId,
    inspectorId: userId,
    startedAt: now,
    status: "open",
    createdAt: now,
    updatedAt: now,
  }).returning()
  if (!run) throw new Error("No se pudo iniciar la inspección.")

  const items = (template.items as Array<{ key: string; label: string; expected: string }>)
  for (const item of items) {
    await db.insert(inspectionItems).values({
      id: `iitem-${nanoid()}`,
      runId,
      itemKey: item.key,
      expected: item.expected,
      status: "pendiente",
      createdAt: now,
      updatedAt: now,
    })
  }

  return run
}

export async function listInspectionRuns(scope: WorksiteScope) {
  const where = scope === "all"
    ? undefined
    : inArray(inspectionRuns.worksiteId, scope)

  return db.select().from(inspectionRuns)
    .where(where)
    .orderBy(desc(inspectionRuns.startedAt))
}

export async function getInspectionRun(runId: string, scope: WorksiteScope) {
  const [run] = await db.select().from(inspectionRuns).where(eq(inspectionRuns.id, runId)).limit(1)
  if (!run) return null
  assertWorksiteAccess(run.worksiteId, scope)

  const [template] = await db.select().from(inspectionTemplates)
    .where(eq(inspectionTemplates.id, run.templateId))
    .limit(1)

  const items = await db.select().from(inspectionItems)
    .where(eq(inspectionItems.runId, runId))
    .orderBy(inspectionItems.itemKey)

  const observations = await db.select().from(behavioralObservations)
    .where(eq(behavioralObservations.runId, runId))

  return { run, template: template ?? null, items, observations }
}

/* ── Items ──────────────────────────────────────────────────────────────── */

export async function updateInspectionItem(input: unknown, scope: WorksiteScope) {
  const data = inspectionItemUpdateSchema.parse(input)

  const [item] = await db.select().from(inspectionItems)
    .where(eq(inspectionItems.id, data.itemId))
    .limit(1)
  if (!item) throw new Error("Ítem de inspección no encontrado.")

  const [run] = await db.select().from(inspectionRuns)
    .where(eq(inspectionRuns.id, item.runId))
    .limit(1)
  if (!run) throw new Error("Inspección no encontrada.")
  if (run.status === "closed") throw new Error("La inspección ya está cerrada.")
  assertWorksiteAccess(run.worksiteId, scope)

  const now = new Date().toISOString()
  const [updated] = await db.update(inspectionItems)
    .set({
      observed: data.observed ?? null,
      status: data.status,
      note: data.note ?? null,
      photoUrl: data.photoUrl ?? null,
      updatedAt: now,
    })
    .where(eq(inspectionItems.id, data.itemId))
    .returning()
  return updated
}

/* ── Close run ──────────────────────────────────────────────────────────── */

export async function closeInspectionRun(input: unknown, userId: string, scope: WorksiteScope) {
  const data = inspectionRunCloseSchema.parse(input)

  const [run] = await db.select().from(inspectionRuns)
    .where(eq(inspectionRuns.id, data.runId))
    .limit(1)
  if (!run) throw new Error("Inspección no encontrada.")
  if (run.status === "closed") throw new Error("La inspección ya está cerrada.")
  assertWorksiteAccess(run.worksiteId, scope)

  const unevaluated = await db.select({ id: inspectionItems.id }).from(inspectionItems)
    .where(and(eq(inspectionItems.runId, data.runId), eq(inspectionItems.status, "pendiente")))
  if (unevaluated.length > 0) {
    throw new Error("Hay ítems sin evaluar. Todos los ítems deben tener estado ok, no_conforme, critico o na.")
  }

  const now = new Date().toISOString()
  await db.update(inspectionItems)
    .set({ closedAt: now, updatedAt: now })
    .where(eq(inspectionItems.runId, data.runId))

  const [closed] = await db.update(inspectionRuns)
    .set({
      status: "closed",
      completedAt: now,
      signature: data.signature ?? null,
      updatedAt: now,
    })
    .where(eq(inspectionRuns.id, data.runId))
    .returning()
  return closed
}

/* ── Observations ────────────────────────────────────────────────────────── */

export async function addBehavioralObservation(input: unknown, userId: string, scope: WorksiteScope) {
  const data = behavioralObservationCreateSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)

  const now = new Date().toISOString()
  const [row] = await db.insert(behavioralObservations).values({
    id: `bobs-${nanoid()}`,
    worksiteId: data.worksiteId,
    observerId: userId,
    workerId: data.workerId || null,
    antecedent: data.antecedent,
    behavior: data.behavior,
    consequence: data.consequence,
    severity: data.severity,
    runId: data.runId || null,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function listBehavioralObservations(scope: WorksiteScope) {
  const where = scope === "all"
    ? undefined
    : inArray(behavioralObservations.worksiteId, scope)
  return db.select().from(behavioralObservations).where(where).orderBy(desc(behavioralObservations.createdAt))
}

/* ── Export XLSX ────────────────────────────────────────────────────────── */

export async function buildInspectionsExport(scope: WorksiteScope): Promise<ReportData> {
  const runs = await listInspectionRuns(scope)
  const obs = await listBehavioralObservations(scope)

  return {
    filenameBase: "inspecciones",
    worksheetName: "Inspecciones",
    headers: ["ID", "Faena", "Inspector", "Inicio", "Cierre", "Estado"],
    rows: runs.map((r) => [r.id, r.worksiteId, r.inspectorId, r.startedAt, r.completedAt ?? "", r.status]),
    sheets: [
      {
        worksheetName: "Inspecciones",
        headers: ["ID", "Faena", "Inspector", "Inicio", "Cierre", "Estado"],
        rows: runs.map((r) => [r.id, r.worksiteId, r.inspectorId, r.startedAt, r.completedAt ?? "", r.status]),
      },
      {
        worksheetName: "Observaciones conductuales",
        headers: ["ID", "Faena", "Observador", "Trabajador", "Antecedente", "Conducta", "Consecuencia", "Severidad"],
        rows: obs.map((o) => [o.id, o.worksiteId, o.observerId, o.workerId ?? "", o.antecedent, o.behavior, o.consequence, o.severity]),
      },
    ],
  }
}
