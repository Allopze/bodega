import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core"
import { db } from "@/db"
import {
  preventionCapaActions,
  preventionInspectionAnswerEvidence,
  preventionInspectionAnswers,
  preventionInspectionFindings,
  preventionInspectionFindingEvidence,
  preventionInspectionRunDocuments,
  preventionInspectionRunParticipants,
  preventionInspectionRuns,
  preventionInspectionTemplates,
  users,
  worksites,
} from "@/db/schema"
import { requireAccess, scopeAllows, scopeCondition, type InspectionAccess } from "@/lib/services/prevention-inspections-access"
import { summarizeTimelyClosure } from "@/lib/prevention/inspections"
import { listOfferedDeviations } from "@/lib/services/prevention-deviations"
import type { ChecklistDefinition } from "@/lib/sst/types"
import { todayInChile } from "@/lib/utils"

/* ── Consultas ────────────────────────────────────────────────────────────── */

/**
 * Las auditorías del Sistema de Gestión (`kind: 'audit'`) viven en su propia
 * pantalla, así que cada listado declara qué tipos muestra. Sin el filtro, una
 * auditoría aparecería a la vez en Inspecciones y en Auditorías.
 */
export type InspectionKindFilter = { kinds?: readonly string[] }

export function kindCondition({ kinds }: InspectionKindFilter = {}) {
  return kinds?.length ? inArray(preventionInspectionTemplates.kind, [...kinds]) : undefined
}

/**
 * C-09: el listado traía 500 filas y la pantalla calculaba filtros y KPIs sobre
 * ellas. Pasadas las 500 ejecuciones los contadores mentían en silencio y el
 * export truncaba sin avisar.
 *
 * Tres piezas separadas a propósito:
 *   - `listInspectionRuns`: una página de datos.
 *   - `summarizeInspectionRuns`: los KPIs sobre el universo completo.
 *   - `listAllInspectionRunsForExport`: sin paginar, porque exportar la primera
 *     página sería un fallo silencioso de integridad.
 */
export interface InspectionListFilters extends InspectionKindFilter {
  status?: string
  worksiteId?: string
  /** Texto libre sobre código, plantilla, sujeto y faena. */
  search?: string
  /** Vista rápida de la pantalla: pendientes de revisión, con hallazgos, graves. */
  view?: "pending_review" | "open_findings" | "critical" | "overdue"
  /** I-10: "¿qué le debe cada prevencionista?" — sin esto la jefa no podía gestionar por responsable. */
  assignedToUserId?: string
  /**
   * I-10: rango sobre la fecha de EJECUCIÓN (no la programada) — responde
   * "cómo cerró [mes]", que es la pregunta real de cierre de período. Los
   * nombres llevan `executed` y no `scheduled` para que no mientan sobre qué
   * comparan. `executedAt` es `timestamptz`; se castea a día de Chile con el
   * mismo patrón que `prevention-incidents.ts` y `operational-trend-history.ts`.
   */
  executedFrom?: string
  executedTo?: string
}

const OPEN_FINDINGS_SQL = sql<number>`(SELECT COUNT(*)::int FROM prevention_inspection_findings f WHERE f.run_id = ${preventionInspectionRuns.id} AND f.status <> 'closed')`
const CRITICAL_FINDINGS_SQL = sql<number>`(SELECT COUNT(*)::int FROM prevention_inspection_findings f WHERE f.run_id = ${preventionInspectionRuns.id} AND f.criticality IN ('high','critical') AND f.status <> 'closed')`

function listFilterConditions(access: InspectionAccess, filter: InspectionListFilters) {
  const conditions = [
    scopeCondition(access.scope, preventionInspectionRuns.worksiteId),
    kindCondition(filter),
  ]
  if (filter.status) conditions.push(eq(preventionInspectionRuns.status, filter.status))
  if (filter.worksiteId) conditions.push(eq(preventionInspectionRuns.worksiteId, filter.worksiteId))
  if (filter.assignedToUserId) conditions.push(eq(preventionInspectionRuns.assignedToUserId, filter.assignedToUserId))
  if (filter.executedFrom) conditions.push(sql`(${preventionInspectionRuns.executedAt} AT TIME ZONE 'America/Santiago')::date >= ${filter.executedFrom}`)
  if (filter.executedTo) conditions.push(sql`(${preventionInspectionRuns.executedAt} AT TIME ZONE 'America/Santiago')::date <= ${filter.executedTo}`)
  if (filter.view === "pending_review") conditions.push(eq(preventionInspectionRuns.status, "completed"))
  if (filter.view === "open_findings") conditions.push(sql`${OPEN_FINDINGS_SQL} > 0`)
  if (filter.view === "critical") conditions.push(sql`${CRITICAL_FINDINGS_SQL} > 0`)
  // I-31: mismo predicado que ya usa el `ORDER BY` para priorizar vencidas.
  if (filter.view === "overdue") {
    conditions.push(sql`${preventionInspectionRuns.status} IN ('planned', 'in_progress')
      AND ${preventionInspectionRuns.scheduledFor} IS NOT NULL
      AND ${preventionInspectionRuns.scheduledFor} < ${todayInChile()}`)
  }
  if (filter.search?.trim()) {
    // `unaccent` no está garantizado en la base; `ILIKE` cubre el caso real
    // (buscar por código o por nombre de plantilla) sin depender de extensiones.
    const pattern = `%${filter.search.trim().replace(/[%_]/g, (match) => `\\${match}`)}%`
    conditions.push(sql`(
      ${preventionInspectionRuns.code} ILIKE ${pattern}
      OR ${preventionInspectionTemplates.name} ILIKE ${pattern}
      OR COALESCE(${preventionInspectionRuns.subjectLabel}, '') ILIKE ${pattern}
      OR ${worksites.name} ILIKE ${pattern}
    )`)
  }
  return and(...conditions)
}

/**
 * I-10/I-18: `assigneeName` sustituye a la columna "Origen" de la bandeja, que
 * decía "Departamento de Prevención" en prácticamente todas las filas.
 * Función, no objeto: el alias de `users` se crea una vez por llamada (mismo
 * patrón que `executor`/`reviewer` más abajo), así que cada consumidor pasa
 * el suyo.
 */
function runListSelection(assignee: { name: AnyPgColumn }) {
  return {
    run: preventionInspectionRuns,
    templateName: preventionInspectionTemplates.name,
    templateKind: preventionInspectionTemplates.kind,
    worksiteName: worksites.name,
    assigneeName: assignee.name,
    openFindings: OPEN_FINDINGS_SQL,
    criticalFindings: CRITICAL_FINDINGS_SQL,
  }
}

export const INSPECTION_PAGE_SIZE = 50

export async function listInspectionRuns(
  access: InspectionAccess,
  filter: InspectionListFilters = {},
  page: { limit?: number; offset?: number } = {},
) {
  requireAccess(access, "prevention:inspections:view")
  const assignee = alias(users, "inspection_list_assignee")
  return db.select(runListSelection(assignee))
    .from(preventionInspectionRuns)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionRuns.templateId, preventionInspectionTemplates.id))
    .innerJoin(worksites, eq(preventionInspectionRuns.worksiteId, worksites.id))
    .leftJoin(assignee, eq(preventionInspectionRuns.assignedToUserId, assignee.id))
    .where(listFilterConditions(access, filter))
    // Bandeja orientada a la tarea: primero lo vencido, luego lo que espera
    // revisión y después el resto. La fecha y el id mantienen el orden estable
    // entre ejecuciones creadas por un mismo barrido.
    .orderBy(
      sql`CASE
        WHEN ${preventionInspectionRuns.status} IN ('planned', 'in_progress')
          AND ${preventionInspectionRuns.scheduledFor} IS NOT NULL
          AND ${preventionInspectionRuns.scheduledFor} < ${todayInChile()} THEN 0
        WHEN ${preventionInspectionRuns.status} = 'completed' THEN 1
        WHEN ${preventionInspectionRuns.status} = 'in_progress' THEN 2
        WHEN ${preventionInspectionRuns.status} = 'planned' THEN 3
        ELSE 4
      END`,
      asc(preventionInspectionRuns.scheduledFor),
      desc(preventionInspectionRuns.createdAt),
      desc(preventionInspectionRuns.id),
    )
    .limit(page.limit ?? INSPECTION_PAGE_SIZE)
    .offset(page.offset ?? 0)
}

/** KPIs sobre el universo completo, no sobre la página visible (C-09). */
export async function summarizeInspectionRuns(access: InspectionAccess, filter: InspectionListFilters = {}) {
  requireAccess(access, "prevention:inspections:view")
  const [row] = await db.select({
    total: sql<number>`COUNT(*)::int`,
    // I-30: sin la exclusión, contaba también lo que el propio usuario
    // ejecutó — que no puede revisar (assessRunReview) — sobrestimando la
    // cola accionable de quien también ejecuta.
    pendingReview: sql<number>`COUNT(*) FILTER (WHERE ${preventionInspectionRuns.status} = 'completed' AND ${preventionInspectionRuns.executedByUserId} IS DISTINCT FROM ${access.userId})::int`,
    withOpenFindings: sql<number>`COUNT(*) FILTER (WHERE ${OPEN_FINDINGS_SQL} > 0)::int`,
    withCriticalFindings: sql<number>`COUNT(*) FILTER (WHERE ${CRITICAL_FINDINGS_SQL} > 0)::int`,
    // I-31: mismo predicado que la vista rápida "Vencidas" y que el ORDER BY.
    overdueRuns: sql<number>`COUNT(*) FILTER (WHERE ${preventionInspectionRuns.status} IN ('planned', 'in_progress') AND ${preventionInspectionRuns.scheduledFor} IS NOT NULL AND ${preventionInspectionRuns.scheduledFor} < ${todayInChile()})::int`,
  })
    .from(preventionInspectionRuns)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionRuns.templateId, preventionInspectionTemplates.id))
    .innerJoin(worksites, eq(preventionInspectionRuns.worksiteId, worksites.id))
    .where(listFilterConditions(access, filter))
  return row ?? { total: 0, pendingReview: 0, withOpenFindings: 0, withCriticalFindings: 0, overdueRuns: 0 }
}

/**
 * Universo completo para el export. NO comparte función con la vista paginada
 * a propósito: si alguien las unifica más adelante, el Excel vuelve a truncarse
 * en silencio, que es el defecto que C-09 corrige.
 */
export async function listAllInspectionRunsForExport(access: InspectionAccess, filter: InspectionListFilters = {}) {
  requireAccess(access, "prevention:inspections:view")
  // Los alias se crean UNA vez: `alias()` devuelve un objeto nuevo en cada
  // llamada, así que repetirlo en el select y en el join produciría dos tablas
  // distintas con el mismo nombre.
  const assignee = alias(users, "inspection_export_assignee")
  const executor = alias(users, "inspection_export_executor")
  const reviewer = alias(users, "inspection_export_reviewer")
  return db.select({
    ...runListSelection(assignee),
    // A-07: el Excel volcaba los IDs crudos de usuario.
    executorName: executor.name,
    reviewerName: reviewer.name,
    // El cuestionario congelado, para que la hoja de respuestas pueda nombrar
    // la sección y traducir el resultado con la escala del instrumento
    // (INS-07/INS-13). No va en `runListSelection`: la bandeja paginada no lo
    // usa y arrastraría el JSON completo en cada página.
    templateSnapshot: preventionInspectionTemplates.definitionSnapshot,
    templateProvenanceKind: preventionInspectionTemplates.provenanceKind,
    templateSourceSnapshot: preventionInspectionTemplates.sourceSnapshot,
    templateContentHash: preventionInspectionTemplates.contentHash,
    templateParityReport: preventionInspectionTemplates.parityReport,
  })
    .from(preventionInspectionRuns)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionRuns.templateId, preventionInspectionTemplates.id))
    .innerJoin(worksites, eq(preventionInspectionRuns.worksiteId, worksites.id))
    .leftJoin(assignee, eq(preventionInspectionRuns.assignedToUserId, assignee.id))
    .leftJoin(executor, eq(preventionInspectionRuns.executedByUserId, executor.id))
    .leftJoin(reviewer, eq(preventionInspectionRuns.reviewedByUserId, reviewer.id))
    .where(listFilterConditions(access, filter))
    .orderBy(
      sql`CASE
        WHEN ${preventionInspectionRuns.status} IN ('planned', 'in_progress')
          AND ${preventionInspectionRuns.scheduledFor} IS NOT NULL
          AND ${preventionInspectionRuns.scheduledFor} < ${todayInChile()} THEN 0
        WHEN ${preventionInspectionRuns.status} = 'completed' THEN 1
        WHEN ${preventionInspectionRuns.status} = 'in_progress' THEN 2
        WHEN ${preventionInspectionRuns.status} = 'planned' THEN 3
        ELSE 4
      END`,
      asc(preventionInspectionRuns.scheduledFor),
      desc(preventionInspectionRuns.createdAt),
      desc(preventionInspectionRuns.id),
    )
}

export async function getInspectionRunDetail(runId: string, access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:view")
  const assignee = alias(users, "inspection_assignee")
  const executor = alias(users, "inspection_executor")
  const reviewer = alias(users, "inspection_reviewer")
  const [run] = await db.select({
    run: preventionInspectionRuns,
    templateName: preventionInspectionTemplates.name,
    templateKind: preventionInspectionTemplates.kind,
    sourceDefinitionCode: preventionInspectionTemplates.sourceDefinitionCode,
    definitionSnapshot: preventionInspectionTemplates.definitionSnapshot,
    executorOfRecord: preventionInspectionTemplates.executorOfRecord,
    // Enlace fuente → PDTP: hasta ahora sólo existía el inverso
    // (`findInspectionTemplateForPdtpActivity`), así que quien abría una
    // inspección no podía saber si alimentaba el programa anual ni con qué.
    pdtpActivityNumbers: preventionInspectionTemplates.pdtpActivityNumbers,
    pdtpReviewActivityNumbers: preventionInspectionTemplates.pdtpReviewActivityNumbers,
    templateId: preventionInspectionTemplates.id,
    templateCode: preventionInspectionTemplates.code,
    worksiteName: worksites.name,
    assigneeName: assignee.name,
    executorName: executor.name,
    reviewerName: reviewer.name,
  })
    .from(preventionInspectionRuns)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionRuns.templateId, preventionInspectionTemplates.id))
    .innerJoin(worksites, eq(preventionInspectionRuns.worksiteId, worksites.id))
    .leftJoin(assignee, eq(preventionInspectionRuns.assignedToUserId, assignee.id))
    .leftJoin(executor, eq(preventionInspectionRuns.executedByUserId, executor.id))
    .leftJoin(reviewer, eq(preventionInspectionRuns.reviewedByUserId, reviewer.id))
    .where(eq(preventionInspectionRuns.id, runId)).limit(1)
  if (!run || !scopeAllows(access.scope, run.run.worksiteId)) return null

  const [answers, findings, documents, participants] = await Promise.all([
    db.select().from(preventionInspectionAnswers).where(eq(preventionInspectionAnswers.runId, runId)),
    db.select().from(preventionInspectionFindings).where(eq(preventionInspectionFindings.runId, runId)),
    db.select().from(preventionInspectionRunDocuments)
      .where(eq(preventionInspectionRunDocuments.runId, runId))
      .orderBy(asc(preventionInspectionRunDocuments.createdAt)),
    db.select().from(preventionInspectionRunParticipants)
      .where(eq(preventionInspectionRunParticipants.runId, runId))
      .orderBy(asc(preventionInspectionRunParticipants.sortOrder)),
  ])
  // Evidencia por respuesta (función #1). Se consulta aparte y se agrupa en
  // memoria: son pocas filas por inspección y evita un join que duplicaría
  // cada respuesta por cada foto.
  const evidence = answers.length === 0 ? [] : await db.select()
    .from(preventionInspectionAnswerEvidence)
    .where(inArray(preventionInspectionAnswerEvidence.answerId, answers.map((row) => row.id)))
  const evidenceByAnswer = new Map<string, typeof evidence>()
  for (const item of evidence) {
    const list = evidenceByAnswer.get(item.answerId) ?? []
    list.push(item)
    evidenceByAnswer.set(item.answerId, list)
  }
  const findingEvidence = findings.length === 0 ? [] : await db.select()
    .from(preventionInspectionFindingEvidence)
    .where(inArray(preventionInspectionFindingEvidence.findingId, findings.map((row) => row.id)))
  const evidenceByFinding = new Map<string, typeof findingEvidence>()
  for (const item of findingEvidence) {
    const list = evidenceByFinding.get(item.findingId) ?? []
    list.push(item)
    evidenceByFinding.set(item.findingId, list)
  }
  /* Lo que este instrumento ofrece, sólo si registra desviaciones. Una
   * plantilla de checklist no lo necesita: ahí la gravedad la declara el ítem.
   * Por CÓDIGO y no por id de fila: la selección pertenece al instrumento, no a
   * la versión, y así sobrevive a un versionado. */
  const definition = run.definitionSnapshot as unknown as ChecklistDefinition
  const deviationCatalog = definition?.recordsDeviations
    ? await listOfferedDeviations(run.templateCode)
    : []

  return {
    ...run,
    answers: answers.map((row) => ({ ...row, evidence: evidenceByAnswer.get(row.id) ?? [] })),
    findings: findings.map((row) => ({ ...row, evidence: evidenceByFinding.get(row.id) ?? [] })),
    documents,
    participants,
    /** El instrumento registra desviaciones en vez de puntuar ítems. */
    recordsDeviations: Boolean(definition?.recordsDeviations),
    recordsPreventiveActions: Boolean(definition?.recordsPreventiveActions),
    /* Ya vienen con la gravedad efectiva y su criticidad resueltas. */
    deviationCatalog,
  }
}

/**
 * Cierre oportuno de hallazgos (B-07) y serie mensual (función #10).
 *
 * `summarizeTimelyClosure` estaba escrita, documentada y probada, y no tenía un
 * solo caller fuera de su test: el indicador que la certificación Mutual pide
 * demostrar —seguimiento de las medidas, no cuántos hallazgos hubo— no existía
 * en ninguna pantalla. Su insumo es `targetDate` de la CAPA y `closedAt` del
 * hallazgo, que sólo empezó a escribirse con la cascada de cierre.
 */
export async function summarizeInspectionTimelyClosure(access: InspectionAccess, filter: InspectionListFilters = {}) {
  requireAccess(access, "prevention:inspections:view")
  const rows = await db.select({
    targetDate: preventionCapaActions.targetDate,
    closedAt: preventionInspectionFindings.closedAt,
  })
    .from(preventionInspectionFindings)
    .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionFindings.runId))
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionTemplates.id, preventionInspectionRuns.templateId))
    .innerJoin(worksites, eq(worksites.id, preventionInspectionRuns.worksiteId))
    .leftJoin(preventionCapaActions, eq(preventionCapaActions.id, preventionInspectionFindings.capaActionId))
    .where(listFilterConditions(access, filter))
  return summarizeTimelyClosure(
    rows.map((row) => ({
      targetDate: row.targetDate ?? null,
      // `closedAt` es timestamp y el indicador compara días civiles.
      closedOn: row.closedAt ? row.closedAt.slice(0, 10) : null,
    })),
    todayInChile(),
  )
}

/** Serie mensual de cumplimiento y hallazgos (función #10). */
export async function summarizeInspectionTrends(access: InspectionAccess, filter: InspectionListFilters = {}) {
  requireAccess(access, "prevention:inspections:view")
  return db.select({
    // I-08/INS-08: sin `AT TIME ZONE`, una inspección cerrada a las 21:30 del
    // 31 de agosto caía en septiembre acá y en agosto en el filtro
    // `executedFrom` de este mismo archivo. Mismo patrón que
    // `operational-trend-history.ts`.
    month: sql<string>`to_char(${preventionInspectionRuns.executedAt} AT TIME ZONE 'America/Santiago', 'YYYY-MM')`,
    executed: sql<number>`COUNT(*)::int`,
    avgCompliance: sql<number | null>`ROUND(AVG(${preventionInspectionRuns.compliancePercent}))::int`,
    nonConforming: sql<number>`COALESCE(SUM(${preventionInspectionRuns.nonConformingCount}), 0)::int`,
    openFindings: sql<number>`COALESCE(SUM(${OPEN_FINDINGS_SQL}), 0)::int`,
  })
    .from(preventionInspectionRuns)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionTemplates.id, preventionInspectionRuns.templateId))
    .innerJoin(worksites, eq(worksites.id, preventionInspectionRuns.worksiteId))
    .where(and(
      listFilterConditions(access, filter),
      isNotNull(preventionInspectionRuns.executedAt),
    ))
    .groupBy(sql`to_char(${preventionInspectionRuns.executedAt} AT TIME ZONE 'America/Santiago', 'YYYY-MM')`)
    .orderBy(sql`to_char(${preventionInspectionRuns.executedAt} AT TIME ZONE 'America/Santiago', 'YYYY-MM')`)
}
