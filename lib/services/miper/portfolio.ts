/**
 * Portada de la MIPER por faena (spec §7, Fase B). Una fila por faena en
 * alcance —las activas y las cerradas que todavía tienen una MIPER no
 * reemplazada—, con su MIPER de mayor período y, aparte, la vigente si es otra.
 * Las reglas que no tocan la base están en `lib/prevention/miper/portfolio.ts`.
 *
 * Es una lectura de página: se llama desde `page.tsx`, nunca dentro de una
 * transacción, y usa la conexión global como `buildRows`. El número de
 * consultas no crece con el de MIPER (sin N+1): las fotos van en lote
 * (`buildMiperSnapshots`) y el resto son conteos agrupados.
 */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionPdtpSourceLinks, preventionRiskControls, preventionRiskEntries, preventionRiskMatrices,
  preventionRiskProgramActionControls, preventionRiskProgramActions, preventionRiskProgramOccurrenceRecords,
  preventionRiskProgramOccurrences, preventionRiskPrograms, workers, worksites,
} from "@/db/schema"
import { checkMiperCompleteness } from "@/lib/prevention/miper/completeness"
import { isCriticalRisk, isCriticalWithoutControl } from "@/lib/prevention/miper/critical-control"
import { miperInboxReason } from "@/lib/prevention/miper/inbox"
import {
  pickCurrentMatrices, portfolioActionOrder, PORTFOLIO_STATUS_LABEL, portfolioStatusOf,
  type MiperPortfolioAction, type MiperPortfolioMatrix, type MiperPortfolioRow, type MiperWorksiteTarget,
} from "@/lib/prevention/miper/portfolio"
import { programProgress, type OccurrenceOutcome } from "@/lib/prevention/miper/progress"
import type { MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import { todayInChile } from "@/lib/utils"
import { buildRows, type MiperListRow } from "./queries"
import { buildMiperSnapshots } from "./snapshots"
import { type MiperAccess, requireAccess, scopeCondition } from "./shared"

const VIEW = "prevention:risk:view"
type MatrixRow = typeof preventionRiskMatrices.$inferSelect
type PortfolioOccurrence = { outcome: OccurrenceOutcome; dueOn: string; late: boolean }

/** Las faenas del alcance que van en la portada y sus MIPER no reemplazadas. */
async function loadPortfolioBase(access: MiperAccess) {
  const [sites, matrixRows] = await Promise.all([
    db.select({ id: worksites.id, name: worksites.name, isActive: worksites.isActive }).from(worksites)
      .where(scopeCondition(access.scope, worksites.id)).orderBy(asc(worksites.name)),
    db.select({ matrix: preventionRiskMatrices, worksiteName: worksites.name }).from(preventionRiskMatrices)
      .innerJoin(worksites, eq(worksites.id, preventionRiskMatrices.worksiteId))
      .where(and(scopeCondition(access.scope, preventionRiskMatrices.worksiteId), ne(preventionRiskMatrices.status, "superseded"))),
  ])
  // Una faena cerrada sigue en la portada mientras tenga una MIPER no reemplazada (lo que `listMipers` ya mostraba).
  const withMiper = new Set(matrixRows.map((row) => row.matrix.worksiteId))
  return { sites: sites.filter((site) => site.isActive || withMiper.has(site.id)), matrixRows }
}

export async function listMiperPortfolio(access: MiperAccess): Promise<{ rows: MiperPortfolioRow[] }> {
  requireAccess(access, VIEW)
  const { sites, matrixRows } = await loadPortfolioBase(access)
  const matrixById = new Map(matrixRows.map(({ matrix }) => [matrix.id, matrix]))
  const listRows = await buildRows(matrixRows)
  const picks = pickCurrentMatrices(listRows)

  const primaries = [...picks.values()].map((pick) => pick.primary)
  const re04Ids = primaries.filter((row) => !row.isLegacy).map((row) => row.id)
  const publishedIds = [...picks.values()].flatMap((pick) => (pick.published ? [pick.published.id] : []))
  // El programa que se ejecuta es el de la vigente; sin vigente, el de la MIPER de la fila.
  const progressMatrixOf = (worksiteId: string) => { const pick = picks.get(worksiteId)!; return (pick.published ?? pick.primary).id }

  const [snapshots, linked, critical, occurrences, activeWorkers] = await Promise.all([
    buildMiperSnapshots(db, re04Ids),
    programLinkedControlIdsByMatrix(re04Ids),
    criticalWithoutControlByMatrix(publishedIds),
    occurrencesByMatrix([...picks.keys()].map(progressMatrixOf)),
    activeWorkersByWorksite(sites.map((site) => site.id)),
  ])
  const today = todayInChile()

  const rows = sites.map((site): MiperPortfolioRow => {
    const pick = picks.get(site.id)
    if (!pick) {
      return {
        id: site.id, worksiteId: site.id, worksiteName: site.name, worksiteActive: site.isActive,
        matrix: null, vigente: null, status: "sin_miper", stateLabel: PORTFOLIO_STATUS_LABEL.sin_miper,
        headcount: activeWorkers.get(site.id) ?? 0, headcountSource: "trabajadores", updatedAt: null, completeness: null,
        importantCount: 0, intolerableCount: 0, criticalWithoutControl: 0, requiresMyAction: false, myActions: [],
        submittedByName: null, programProgress: null,
      }
    }
    const primary = pick.primary
    const matrix = matrixById.get(primary.id)!
    const snapshot = snapshots.get(primary.id)
    const vigente = pick.published && pick.published.id !== primary.id ? pick.published : null
    const myActions = portfolioActionOrder(pick).flatMap((candidate): MiperPortfolioAction[] => {
      const reason = miperInboxReason(candidate, access)
      return reason ? [{ matrixId: candidate.id, period: candidate.period, reason }] : []
    })
    return {
      id: site.id, worksiteId: site.id, worksiteName: site.name, worksiteActive: site.isActive,
      matrix: matrixRef(primary, matrix),
      vigente: vigente ? matrixRef(vigente, matrixById.get(vigente.id)!) : null,
      status: portfolioStatusOf(primary),
      stateLabel: primary.label,
      headcount: matrix.headcountTotal ?? activeWorkers.get(site.id) ?? 0,
      headcountSource: matrix.headcountTotal === null ? "trabajadores" : "ficha",
      updatedAt: primary.updatedAt,
      completeness: snapshot ? completenessOf(snapshot, linked.get(primary.id)) : null,
      importantCount: primary.classificationCounts.important,
      intolerableCount: primary.classificationCounts.intolerable,
      criticalWithoutControl: pick.published ? critical.get(pick.published.id) ?? 0 : 0,
      requiresMyAction: myActions.length > 0,
      myActions,
      submittedByName: primary.submittedByName,
      programProgress: programProgress(occurrences.get(progressMatrixOf(site.id)) ?? [], today),
    }
  })
  return { rows }
}

/** Lista del selector «Cambiar de faena»: el mismo alcance y la misma MIPER principal, sin fotos ni conteos. */
export async function listMiperWorksiteTargets(access: MiperAccess): Promise<MiperWorksiteTarget[]> {
  requireAccess(access, VIEW)
  const { sites, matrixRows } = await loadPortfolioBase(access)
  const picks = pickCurrentMatrices(matrixRows.map(({ matrix }) => matrix))
  return sites.map((site) => {
    const primary = picks.get(site.id)?.primary ?? null
    return { worksiteId: site.id, worksiteName: site.name, matrixId: primary?.id ?? null, period: primary?.period ?? null }
  })
}

function matrixRef(row: MiperListRow, matrix: MatrixRow): MiperPortfolioMatrix {
  return { id: row.id, period: row.period, versionNumber: row.versionNumber, label: row.label, isLegacy: matrix.isLegacy }
}

/** «Completos x de y» del espacio de trabajo: riesgos sin errores, con la regla del Intolerable dentro del programa. */
function completenessOf(snapshot: MiperSnapshot, linkedControlIds: ReadonlySet<string> | undefined) {
  const incomplete = new Set(checkMiperCompleteness(snapshot, { linkedControlIds: linkedControlIds ?? new Set<string>(), requireProgramLink: true })
    .flatMap((issue) => (issue.severity === "error" && issue.entryId ? [issue.entryId] : [])))
  return { complete: snapshot.entries.length - incomplete.size, total: snapshot.entries.length }
}

/** Medidas vinculadas a una actividad viva del programa, por MIPER: el criterio de `programLinkedControlIds`. */
async function programLinkedControlIdsByMatrix(matrixIds: string[]): Promise<Map<string, Set<string>>> {
  const byMatrix = new Map<string, Set<string>>()
  if (matrixIds.length === 0) return byMatrix
  const rows = await db.select({ matrixId: preventionRiskPrograms.matrixId, controlId: preventionRiskProgramActionControls.controlId })
    .from(preventionRiskProgramActionControls)
    .innerJoin(preventionRiskProgramActions, eq(preventionRiskProgramActions.id, preventionRiskProgramActionControls.actionId))
    .innerJoin(preventionRiskPrograms, eq(preventionRiskPrograms.id, preventionRiskProgramActions.programId))
    .where(and(inArray(preventionRiskPrograms.matrixId, matrixIds), eq(preventionRiskProgramActions.status, "active")))
  for (const row of rows) {
    const set = byMatrix.get(row.matrixId) ?? new Set<string>()
    set.add(row.controlId)
    byMatrix.set(row.matrixId, set)
  }
  return byMatrix
}

/** «Riesgos críticos sin control» de cada MIPER vigente, con el predicado compartido con el tablero. */
async function criticalWithoutControlByMatrix(matrixIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (matrixIds.length === 0) return counts
  const entries = await db.select({
    id: preventionRiskEntries.id, matrixId: preventionRiskEntries.matrixId,
    classification: preventionRiskEntries.classification, isCritical: preventionRiskEntries.isCritical,
  }).from(preventionRiskEntries).where(inArray(preventionRiskEntries.matrixId, matrixIds))
  const critical = entries.filter((entry) => isCriticalRisk(entry))
  if (critical.length === 0) return counts
  const controls = await db.select({ id: preventionRiskControls.id, riskEntryId: preventionRiskControls.riskEntryId, status: preventionRiskControls.status })
    .from(preventionRiskControls).where(inArray(preventionRiskControls.riskEntryId, critical.map((entry) => entry.id)))
  const links = controls.length === 0 ? [] : await db.select({ sourceId: preventionPdtpSourceLinks.sourceId }).from(preventionPdtpSourceLinks)
    .where(and(eq(preventionPdtpSourceLinks.sourceType, "risk_control"), inArray(preventionPdtpSourceLinks.sourceId, controls.map((control) => control.id)), eq(preventionPdtpSourceLinks.isActive, true)))
  const linkedControlIds = new Set(links.map((link) => link.sourceId))
  const controlsByEntry = new Map<string, typeof controls>()
  for (const control of controls) {
    const list = controlsByEntry.get(control.riskEntryId)
    if (list) list.push(control)
    else controlsByEntry.set(control.riskEntryId, [control])
  }
  for (const entry of critical) {
    if (isCriticalWithoutControl(entry, controlsByEntry.get(entry.id) ?? [], linkedControlIds)) counts.set(entry.matrixId, (counts.get(entry.matrixId) ?? 0) + 1)
  }
  return counts
}

/**
 * Ocurrencias del programa de cada MIPER, en la forma que consume
 * `programProgress`. El resultado vigente es el del registro actual; sin
 * registro, el de la ocurrencia: el mismo criterio que `getProgramWorkspace`.
 * (Antes vivía en `dashboard.ts`, que la Task 7 retira.)
 */
async function occurrencesByMatrix(matrixIds: string[]): Promise<Map<string, PortfolioOccurrence[]>> {
  const byMatrix = new Map<string, PortfolioOccurrence[]>()
  if (matrixIds.length === 0) return byMatrix
  const rows = await db.select({
    matrixId: preventionRiskPrograms.matrixId,
    occurrenceOutcome: preventionRiskProgramOccurrences.outcome,
    dueOn: preventionRiskProgramOccurrences.dueOn,
    recordId: preventionRiskProgramOccurrenceRecords.id,
    recordOutcome: preventionRiskProgramOccurrenceRecords.outcome,
    late: preventionRiskProgramOccurrenceRecords.late,
  }).from(preventionRiskProgramOccurrences)
    .innerJoin(preventionRiskProgramActions, eq(preventionRiskProgramActions.id, preventionRiskProgramOccurrences.actionId))
    .innerJoin(preventionRiskPrograms, eq(preventionRiskPrograms.id, preventionRiskProgramActions.programId))
    .leftJoin(preventionRiskProgramOccurrenceRecords, eq(preventionRiskProgramOccurrenceRecords.id, preventionRiskProgramOccurrences.currentRecordId))
    .where(inArray(preventionRiskPrograms.matrixId, matrixIds))
  for (const row of rows) {
    const list = byMatrix.get(row.matrixId) ?? []
    list.push({
      outcome: (row.recordId ? row.recordOutcome : row.occurrenceOutcome) as OccurrenceOutcome,
      dueOn: row.dueOn,
      late: row.recordId ? row.late ?? false : false,
    })
    byMatrix.set(row.matrixId, list)
  }
  return byMatrix
}

/** Dotación de respaldo: trabajadores activos por faena (cuando la ficha no la trae). */
async function activeWorkersByWorksite(worksiteIds: string[]): Promise<Map<string, number>> {
  if (worksiteIds.length === 0) return new Map()
  const rows = await db.select({ worksiteId: workers.worksiteId, count: sql<number>`count(*)::int` }).from(workers)
    .where(and(inArray(workers.worksiteId, worksiteIds), eq(workers.isActive, true))).groupBy(workers.worksiteId)
  return new Map(rows.map((row) => [row.worksiteId, row.count]))
}
