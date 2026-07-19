import { createHash } from "node:crypto"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { db, type DB, type Tx } from "@/db"
import {
  preventionInspectionAnswers,
  preventionInspectionFindings,
  preventionInspectionHistory,
  preventionInspectionPrograms,
  preventionInspectionRuns,
  preventionInspectionTemplates,
  users,
  worksites,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import {
  addDays,
  assessEnrichmentCoverage,
  assessRunCompletion,
  assessRunReview,
  capaPriorityForCriticality,
  deriveFindings,
  summarizeCompliance,
  FREQUENCY_INTERVAL_DAYS,
  type InspectionAnswerInput,
  type InspectionItemSpec,
} from "@/lib/prevention/inspections"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import { CHECKLIST_DEFINITIONS, isPersonEvaluationDefinition } from "@/lib/sst/definitions"
import type { ChecklistDefinition } from "@/lib/sst/types"

type Client = DB | Tx

export interface InspectionAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

const NOT_FOUND = "Inspección no encontrada o fuera de alcance."

const CHILE_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" })

function todayInChile() {
  return CHILE_DATE_FORMAT.format(new Date())
}

function nowIso() {
  return new Date().toISOString()
}

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function requireAccess(access: InspectionAccess, permission: string, worksiteId?: string) {
  if (!access.permissions.includes(permission) || (worksiteId && !scopeAllows(access.scope, worksiteId))) {
    throw new Error(NOT_FOUND)
  }
}

function scopeCondition(scope: WorksiteScope, column: AnyPgColumn) {
  if (scope.mode === "all") return undefined
  if (scope.mode === "none" || scope.ids.length === 0) return sql`false`
  return inArray(column, scope.ids)
}

async function history(client: Client, args: {
  entityType: string
  entityId: string
  worksiteId?: string | null
  changeType: string
  reason: string
  beforeState?: unknown
  afterState?: unknown
  actorUserId?: string | null
}) {
  await client.insert(preventionInspectionHistory).values({
    id: `pinsh-${nanoid()}`,
    entityType: args.entityType,
    entityId: args.entityId,
    worksiteId: args.worksiteId ?? null,
    changeType: args.changeType,
    reason: args.reason,
    beforeState: args.beforeState ?? null,
    afterState: args.afterState ?? null,
    actorUserId: args.actorUserId ?? null,
  })
}

/* ── Plantillas ───────────────────────────────────────────────────────────── */

const importTemplateSchema = z.object({
  definitionCode: z.string().min(1),
  kind: z.enum(["inspection", "observation", "audit"]).default("inspection"),
  versionLabel: z.string().trim().min(1).max(80).optional(),
})

/**
 * Aplana la definición de checklist a la especificación que consume el motor.
 * `countsForCompliance` respeta la sección, igual que el cálculo del PDTP.
 */
export function itemsFromDefinition(definition: ChecklistDefinition): InspectionItemSpec[] {
  const items: InspectionItemSpec[] = []
  for (const section of definition.sections) {
    for (const item of section.items) {
      items.push({
        sectionId: section.id,
        itemId: item.id,
        label: item.label,
        required: item.required ?? false,
        countsForCompliance: section.countsForCompliance ?? true,
        danoPotencial: item.danoPotencial ?? null,
      })
    }
  }
  return items
}

/**
 * Incorpora una definición SST existente como plantilla del motor transversal.
 * Las evaluaciones de personas quedan fuera a propósito: la auditoría pide no
 * mezclar inspecciones de activos con evaluación de trabajadores.
 */
export async function importInspectionTemplate(input: unknown, access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:manage")
  const data = importTemplateSchema.parse(input)

  if (isPersonEvaluationDefinition(data.definitionCode)) {
    throw new Error("Las evaluaciones de personas no se incorporan al motor de inspecciones.")
  }
  const definition = CHECKLIST_DEFINITIONS[data.definitionCode]
  if (!definition) throw new Error("La definición de checklist no existe en el catálogo.")

  const versionLabel = data.versionLabel ?? definition.version
  const snapshot = definition as unknown as Record<string, unknown>
  const contentHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")

  const [created] = await db.insert(preventionInspectionTemplates).values({
    id: `instpl-${nanoid()}`,
    code: definition.code,
    versionLabel,
    name: definition.title,
    kind: data.kind,
    sourceDefinitionCode: data.definitionCode,
    definitionSnapshot: snapshot,
    contentHash,
    status: "draft",
    legalFramework: definition.legalFramework?.join(" · ") ?? null,
    authorUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo incorporar la plantilla.")
  await history(db, { entityType: "template", entityId: created.id, changeType: "imported", reason: `Definición ${data.definitionCode} incorporada como plantilla ${versionLabel}`, afterState: created, actorUserId: access.userId })
  return created
}

/**
 * Aprobar es segregado del autor y congela el contenido: desde aquí la
 * plantilla puede programarse y ejecutarse, y su snapshot ya no cambia.
 */
export async function approveInspectionTemplate(input: unknown, access: InspectionAccess) {
  const data = z.object({ templateId: z.string().min(1), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(10).max(2000) }).parse(input)
  requireAccess(access, "prevention:inspections:approve")

  return db.transaction(async (tx) => {
    const [template] = await tx.select().from(preventionInspectionTemplates)
      .where(eq(preventionInspectionTemplates.id, data.templateId)).limit(1)
    if (!template) throw new Error(NOT_FOUND)
    if (template.version !== data.expectedVersion) throw new Error("La plantilla cambió mientras la revisabas. Recarga y reintenta.")
    if (template.status !== "draft") throw new Error("Sólo una plantilla en borrador puede aprobarse.")
    if (template.authorUserId === access.userId) {
      throw new Error("Quien incorporó la plantilla no puede aprobarla.")
    }

    const now = nowIso()
    // Aprobar una versión reemplaza a la anterior vigente del mismo código.
    const previous = await tx.select().from(preventionInspectionTemplates)
      .where(and(
        eq(preventionInspectionTemplates.code, template.code),
        eq(preventionInspectionTemplates.status, "approved"),
      ))
    for (const item of previous) {
      await tx.update(preventionInspectionTemplates)
        .set({ status: "superseded", supersededAt: now, supersededByTemplateId: template.id, version: item.version + 1, updatedAt: now })
        .where(eq(preventionInspectionTemplates.id, item.id))
    }

    const [updated] = await tx.update(preventionInspectionTemplates).set({
      status: "approved",
      approvedByUserId: access.userId,
      approvedAt: now,
      version: template.version + 1,
      updatedAt: now,
    }).where(and(eq(preventionInspectionTemplates.id, template.id), eq(preventionInspectionTemplates.version, data.expectedVersion))).returning()
    if (!updated) throw new Error("La plantilla cambió mientras la revisabas. Recarga y reintenta.")
    await history(tx, { entityType: "template", entityId: template.id, changeType: "approved", reason: data.reason, beforeState: template, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

/* ── Programación ─────────────────────────────────────────────────────────── */

const programSchema = z.object({
  templateId: z.string().min(1),
  worksiteId: z.string().min(1),
  frequency: z.enum(["daily", "weekly", "biweekly", "monthly", "quarterly", "biannual", "annual", "on_demand"]),
  intervalDays: z.number().int().positive().max(3650).optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  assignedToUserId: z.string().min(1).nullable().optional(),
  riskEntryId: z.string().min(1).nullable().optional(),
  subjectType: z.string().trim().max(120).nullable().optional(),
})

export async function createInspectionProgram(input: unknown, access: InspectionAccess) {
  const data = programSchema.parse(input)
  requireAccess(access, "prevention:inspections:manage", data.worksiteId)

  const [template] = await db.select().from(preventionInspectionTemplates)
    .where(eq(preventionInspectionTemplates.id, data.templateId)).limit(1)
  if (!template) throw new Error(NOT_FOUND)
  if (template.status !== "approved") throw new Error("Sólo puede programarse una plantilla aprobada.")

  const [created] = await db.insert(preventionInspectionPrograms).values({
    id: `insprog-${nanoid()}`,
    templateId: data.templateId,
    worksiteId: data.worksiteId,
    frequency: data.frequency,
    intervalDays: data.intervalDays ?? FREQUENCY_INTERVAL_DAYS[data.frequency] ?? 30,
    nextDueOn: data.startsOn,
    assignedToUserId: data.assignedToUserId ?? null,
    riskEntryId: data.riskEntryId ?? null,
    subjectType: data.subjectType ?? null,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo crear la programación.")
  await history(db, { entityType: "program", entityId: created.id, worksiteId: data.worksiteId, changeType: "created", reason: `Programación ${data.frequency} desde ${data.startsOn}`, afterState: created, actorUserId: access.userId })
  return created
}

/* ── Ejecución ────────────────────────────────────────────────────────────── */

const runSchema = z.object({
  templateId: z.string().min(1),
  worksiteId: z.string().min(1),
  programId: z.string().min(1).nullable().optional(),
  subjectType: z.string().trim().max(120).nullable().optional(),
  subjectLabel: z.string().trim().max(300).nullable().optional(),
  scheduledFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  assignedToUserId: z.string().min(1).nullable().optional(),
  clientSubmissionId: z.string().trim().min(1).max(200).nullable().optional(),
})

export async function createInspectionRun(input: unknown, access: InspectionAccess) {
  const data = runSchema.parse(input)
  requireAccess(access, "prevention:inspections:execute", data.worksiteId)

  const [template] = await db.select().from(preventionInspectionTemplates)
    .where(eq(preventionInspectionTemplates.id, data.templateId)).limit(1)
  if (!template) throw new Error(NOT_FOUND)
  if (template.status !== "approved") throw new Error("Sólo puede ejecutarse una plantilla aprobada.")

  // La sincronización offline reenvía: el identificador de envío hace la
  // creación idempotente en vez de duplicar la inspección.
  if (data.clientSubmissionId) {
    const [existing] = await db.select().from(preventionInspectionRuns)
      .where(eq(preventionInspectionRuns.clientSubmissionId, data.clientSubmissionId)).limit(1)
    if (existing) return { run: existing, idempotentReplay: true }
  }

  const [created] = await db.insert(preventionInspectionRuns).values({
    id: `insrun-${nanoid()}`,
    code: `INSP-${new Date().getUTCFullYear()}-${nanoid(8).toUpperCase()}`,
    templateId: data.templateId,
    programId: data.programId ?? null,
    worksiteId: data.worksiteId,
    subjectType: data.subjectType ?? null,
    subjectLabel: data.subjectLabel ?? null,
    scheduledFor: data.scheduledFor ?? null,
    status: "planned",
    assignedToUserId: data.assignedToUserId ?? access.userId,
    clientSubmissionId: data.clientSubmissionId ?? null,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo crear la inspección.")
  await history(db, { entityType: "run", entityId: created.id, worksiteId: data.worksiteId, changeType: "created", reason: `Inspección ${template.name} planificada`, afterState: created, actorUserId: access.userId })
  return { run: created, idempotentReplay: false }
}

const answersSchema = z.object({
  runId: z.string().min(1),
  answers: z.array(z.object({
    sectionId: z.string().min(1),
    itemId: z.string().min(1),
    result: z.enum(["conforming", "non_conforming", "not_applicable"]),
    value: z.string().trim().max(2000).nullable().optional(),
    comment: z.string().trim().max(2000).nullable().optional(),
    evidenceReference: z.string().trim().max(2000).nullable().optional(),
  })).min(1),
  locationLatitude: z.string().trim().max(40).nullable().optional(),
  locationLongitude: z.string().trim().max(40).nullable().optional(),
})

export async function saveInspectionAnswers(input: unknown, access: InspectionAccess) {
  const data = answersSchema.parse(input)
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(preventionInspectionRuns)
      .where(eq(preventionInspectionRuns.id, data.runId)).limit(1)
    if (!run) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:inspections:execute", run.worksiteId)
    if (["reviewed", "cancelled"].includes(run.status)) {
      throw new Error("No se pueden modificar respuestas de una inspección cerrada o cancelada.")
    }

    const [template] = await tx.select().from(preventionInspectionTemplates)
      .where(eq(preventionInspectionTemplates.id, run.templateId)).limit(1)
    if (!template) throw new Error(NOT_FOUND)
    const items = itemsFromDefinition(template.definitionSnapshot as unknown as ChecklistDefinition)
    const known = new Set(items.map((item) => `${item.sectionId}::${item.itemId}`))
    for (const answer of data.answers) {
      if (!known.has(`${answer.sectionId}::${answer.itemId}`)) {
        throw new Error("Una respuesta no corresponde a ningún ítem de la plantilla.")
      }
    }

    const now = nowIso()
    for (const answer of data.answers) {
      const item = items.find((candidate) => candidate.sectionId === answer.sectionId && candidate.itemId === answer.itemId)!
      await tx.insert(preventionInspectionAnswers).values({
        id: `insans-${nanoid()}`,
        runId: run.id,
        sectionId: answer.sectionId,
        itemId: answer.itemId,
        itemLabel: item.label,
        result: answer.result,
        value: answer.value ?? null,
        comment: answer.comment ?? null,
        evidenceReference: answer.evidenceReference ?? null,
        danoPotencial: item.danoPotencial ?? null,
      }).onConflictDoUpdate({
        target: [preventionInspectionAnswers.runId, preventionInspectionAnswers.sectionId, preventionInspectionAnswers.itemId],
        set: {
          result: answer.result,
          value: answer.value ?? null,
          comment: answer.comment ?? null,
          evidenceReference: answer.evidenceReference ?? null,
          updatedAt: now,
        },
      })
    }

    await tx.update(preventionInspectionRuns).set({
      status: run.status === "planned" ? "in_progress" : run.status,
      locationLatitude: data.locationLatitude ?? run.locationLatitude,
      locationLongitude: data.locationLongitude ?? run.locationLongitude,
      updatedAt: now,
    }).where(eq(preventionInspectionRuns.id, run.id))
    return { saved: data.answers.length }
  })
}

/**
 * Declara la inspección ejecutada: valida obligatorios, calcula cumplimiento y
 * materializa un hallazgo por cada incumplimiento con su criticidad derivada.
 */
export async function completeInspectionRun(input: unknown, access: InspectionAccess) {
  const data = z.object({ runId: z.string().min(1), expectedVersion: z.number().int().positive() }).parse(input)

  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(preventionInspectionRuns)
      .where(eq(preventionInspectionRuns.id, data.runId)).limit(1)
    if (!run) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:inspections:execute", run.worksiteId)
    if (run.version !== data.expectedVersion) throw new Error("La inspección cambió mientras la editabas. Recarga y reintenta.")
    if (run.status === "completed" || run.status === "reviewed") throw new Error("La inspección ya fue ejecutada.")
    if (run.status === "cancelled") throw new Error("Una inspección cancelada no puede ejecutarse.")

    const [template] = await tx.select().from(preventionInspectionTemplates)
      .where(eq(preventionInspectionTemplates.id, run.templateId)).limit(1)
    if (!template) throw new Error(NOT_FOUND)
    const items = itemsFromDefinition(template.definitionSnapshot as unknown as ChecklistDefinition)

    const stored = await tx.select().from(preventionInspectionAnswers)
      .where(eq(preventionInspectionAnswers.runId, run.id))
    const answers: InspectionAnswerInput[] = stored.map((row) => ({
      sectionId: row.sectionId,
      itemId: row.itemId,
      result: row.result as InspectionAnswerInput["result"],
      comment: row.comment,
    }))

    const completion = assessRunCompletion(items, answers)
    if (!completion.allowed) {
      throw new Error(`No se puede declarar ejecutada: ${completion.blockers.map((item) => item.detail).join(", ")}`)
    }

    const summary = summarizeCompliance(items, answers)
    const derived = deriveFindings(items, answers)
    const answerId = new Map(stored.map((row) => [`${row.sectionId}::${row.itemId}`, row.id]))
    const now = nowIso()

    // Rehacer los hallazgos abiertos mantiene la coherencia si se corrigió una
    // respuesta antes de cerrar; los que ya tienen CAPA no se tocan.
    await tx.delete(preventionInspectionFindings).where(and(
      eq(preventionInspectionFindings.runId, run.id),
      eq(preventionInspectionFindings.status, "open"),
      sql`${preventionInspectionFindings.capaActionId} IS NULL`,
    ))
    if (derived.length > 0) {
      await tx.insert(preventionInspectionFindings).values(derived.map((finding) => ({
        id: `insfnd-${nanoid()}`,
        runId: run.id,
        answerId: answerId.get(`${finding.sectionId}::${finding.itemId}`) ?? null,
        description: finding.description,
        criticality: finding.criticality,
        status: "open" as const,
      })))
    }

    const [updated] = await tx.update(preventionInspectionRuns).set({
      status: "completed",
      executedByUserId: access.userId,
      executedAt: now,
      conformingCount: summary.conforming,
      nonConformingCount: summary.nonConforming,
      notApplicableCount: summary.notApplicable,
      compliancePercent: summary.compliancePercent,
      version: run.version + 1,
      updatedAt: now,
    }).where(and(eq(preventionInspectionRuns.id, run.id), eq(preventionInspectionRuns.version, data.expectedVersion))).returning()
    if (!updated) throw new Error("La inspección cambió mientras la editabas. Recarga y reintenta.")

    // La siguiente ejecución del programa se agenda desde la fecha real.
    if (run.programId) {
      const [program] = await tx.select().from(preventionInspectionPrograms)
        .where(eq(preventionInspectionPrograms.id, run.programId)).limit(1)
      if (program?.isActive) {
        await tx.update(preventionInspectionPrograms)
          .set({ nextDueOn: addDays(todayInChile(), program.intervalDays), updatedAt: now })
          .where(eq(preventionInspectionPrograms.id, program.id))
      }
    }

    await history(tx, { entityType: "run", entityId: run.id, worksiteId: run.worksiteId, changeType: "completed", reason: `Ejecutada con ${summary.nonConforming} incumplimiento(s) y ${derived.length} hallazgo(s)`, beforeState: run, afterState: updated, actorUserId: access.userId })
    return { run: updated, findings: derived.length, compliancePercent: summary.compliancePercent }
  })
}

/** Deriva un hallazgo a CAPA común con prioridad y plazo según su criticidad. */
export async function createFindingCapa(input: unknown, access: InspectionAccess) {
  const data = z.object({
    findingId: z.string().min(1),
    actionDescription: z.string().trim().min(3).max(3000),
    responsibleUserId: z.string().min(1).nullable().optional(),
    immediateMeasure: z.string().trim().max(3000).nullable().optional(),
  }).parse(input)

  return db.transaction(async (tx) => {
    const [row] = await tx.select({ finding: preventionInspectionFindings, run: preventionInspectionRuns })
      .from(preventionInspectionFindings)
      .innerJoin(preventionInspectionRuns, eq(preventionInspectionFindings.runId, preventionInspectionRuns.id))
      .where(eq(preventionInspectionFindings.id, data.findingId)).limit(1)
    if (!row) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:inspections:execute", row.run.worksiteId)
    if (row.finding.capaActionId) throw new Error("El hallazgo ya tiene una acción CAPA enlazada.")

    const { priority, dueInDays } = capaPriorityForCriticality(row.finding.criticality)
    const capa = await createCapaActionWithClient(tx, {
      sourceType: "inspection",
      sourceId: row.run.id,
      worksiteId: row.run.worksiteId,
      finding: row.finding.description,
      immediateMeasure: data.immediateMeasure ?? row.finding.immediateMeasure ?? null,
      actionDescription: data.actionDescription,
      responsibleUserId: data.responsibleUserId ?? null,
      priority,
      targetDate: addDays(todayInChile(), dueInDays),
      evidenceRequired: true,
    }, access.userId)

    const now = nowIso()
    const [updated] = await tx.update(preventionInspectionFindings).set({
      capaActionId: capa.id,
      immediateMeasure: data.immediateMeasure ?? row.finding.immediateMeasure,
      status: "capa_linked",
      updatedAt: now,
    }).where(eq(preventionInspectionFindings.id, data.findingId)).returning()
    if (!updated) throw new Error("No se pudo enlazar la acción CAPA.")
    await history(tx, { entityType: "finding", entityId: data.findingId, worksiteId: row.run.worksiteId, changeType: "capa_linked", reason: data.actionDescription, actorUserId: access.userId })
    return updated
  })
}

/** Revisión y cierre independientes de quien ejecutó. */
export async function reviewInspectionRun(input: unknown, access: InspectionAccess) {
  const data = z.object({
    runId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    reviewComment: z.string().trim().min(10).max(3000),
  }).parse(input)

  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(preventionInspectionRuns)
      .where(eq(preventionInspectionRuns.id, data.runId)).limit(1)
    if (!run) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:inspections:review", run.worksiteId)
    if (run.version !== data.expectedVersion) throw new Error("La inspección cambió mientras la revisabas. Recarga y reintenta.")
    if (run.status !== "completed") throw new Error("Sólo una inspección ejecutada puede revisarse.")

    const findings = await tx.select().from(preventionInspectionFindings)
      .where(eq(preventionInspectionFindings.runId, run.id))
    const review = assessRunReview({
      executedByUserId: run.executedByUserId,
      reviewerUserId: access.userId,
      findings: findings.map((finding) => ({
        id: finding.id,
        description: finding.description,
        criticality: finding.criticality,
        capaActionId: finding.capaActionId,
      })),
    })
    if (!review.allowed) {
      throw new Error(`No se puede cerrar la inspección: ${review.blockers.map((item) => item.detail).join(" ")}`)
    }

    const now = nowIso()
    const [updated] = await tx.update(preventionInspectionRuns).set({
      status: "reviewed",
      reviewedByUserId: access.userId,
      reviewedAt: now,
      reviewComment: data.reviewComment,
      version: run.version + 1,
      updatedAt: now,
    }).where(and(eq(preventionInspectionRuns.id, run.id), eq(preventionInspectionRuns.version, data.expectedVersion))).returning()
    if (!updated) throw new Error("La inspección cambió mientras la revisabas. Recarga y reintenta.")
    await history(tx, { entityType: "run", entityId: run.id, worksiteId: run.worksiteId, changeType: "reviewed", reason: data.reviewComment, beforeState: run, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

/* ── Consultas ────────────────────────────────────────────────────────────── */

export async function listInspectionRuns(access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:view")
  return db.select({
    run: preventionInspectionRuns,
    templateName: preventionInspectionTemplates.name,
    templateKind: preventionInspectionTemplates.kind,
    worksiteName: worksites.name,
    openFindings: sql<number>`(SELECT COUNT(*)::int FROM prevention_inspection_findings f WHERE f.run_id = ${preventionInspectionRuns.id} AND f.status <> 'closed')`,
    criticalFindings: sql<number>`(SELECT COUNT(*)::int FROM prevention_inspection_findings f WHERE f.run_id = ${preventionInspectionRuns.id} AND f.criticality IN ('high','critical'))`,
  })
    .from(preventionInspectionRuns)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionRuns.templateId, preventionInspectionTemplates.id))
    .innerJoin(worksites, eq(preventionInspectionRuns.worksiteId, worksites.id))
    .where(scopeCondition(access.scope, preventionInspectionRuns.worksiteId))
    .orderBy(desc(preventionInspectionRuns.createdAt))
    .limit(500)
}

export async function getInspectionRunDetail(runId: string, access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:view")
  const [run] = await db.select({
    run: preventionInspectionRuns,
    templateName: preventionInspectionTemplates.name,
    templateKind: preventionInspectionTemplates.kind,
    definitionSnapshot: preventionInspectionTemplates.definitionSnapshot,
    worksiteName: worksites.name,
  })
    .from(preventionInspectionRuns)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionRuns.templateId, preventionInspectionTemplates.id))
    .innerJoin(worksites, eq(preventionInspectionRuns.worksiteId, worksites.id))
    .where(eq(preventionInspectionRuns.id, runId)).limit(1)
  if (!run || !scopeAllows(access.scope, run.run.worksiteId)) return null

  const [answers, findings] = await Promise.all([
    db.select().from(preventionInspectionAnswers).where(eq(preventionInspectionAnswers.runId, runId)),
    db.select().from(preventionInspectionFindings).where(eq(preventionInspectionFindings.runId, runId)),
  ])
  return { ...run, answers, findings }
}

export async function listInspectionTemplates(access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:view")
  const templates = await db.select().from(preventionInspectionTemplates)
    .orderBy(asc(preventionInspectionTemplates.code), desc(preventionInspectionTemplates.createdAt))
  // Se expone la calibración real de cada plantilla: una sin daño potencial
  // declarado produce hallazgos siempre medios y no bloquea ningún cierre.
  return templates.map((template) => ({
    ...template,
    coverage: assessEnrichmentCoverage(itemsFromDefinition(template.definitionSnapshot as unknown as ChecklistDefinition)),
  }))
}

export async function listInspectionPrograms(access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:view")
  return db.select({
    program: preventionInspectionPrograms,
    templateName: preventionInspectionTemplates.name,
    worksiteName: worksites.name,
    assigneeName: users.name,
  })
    .from(preventionInspectionPrograms)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionPrograms.templateId, preventionInspectionTemplates.id))
    .innerJoin(worksites, eq(preventionInspectionPrograms.worksiteId, worksites.id))
    .leftJoin(users, eq(preventionInspectionPrograms.assignedToUserId, users.id))
    .where(scopeCondition(access.scope, preventionInspectionPrograms.worksiteId))
    .orderBy(asc(preventionInspectionPrograms.nextDueOn))
}

/** Catálogo de definiciones SST disponibles para incorporar como plantilla. */
export function listImportableDefinitions() {
  return Object.entries(CHECKLIST_DEFINITIONS)
    .filter(([code]) => !isPersonEvaluationDefinition(code))
    .map(([code, definition]) => ({
      code,
      title: definition.title,
      version: definition.version,
      sections: definition.sections.length,
      items: definition.sections.reduce((total, section) => total + section.items.length, 0),
      coverage: assessEnrichmentCoverage(itemsFromDefinition(definition)),
    }))
}
