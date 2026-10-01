import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  auditLog, preventionRiskControls, preventionRiskEntries, preventionRiskFactors, preventionRiskMatrices, preventionRiskMatrixVersions,
  preventionRiskObservations, preventionRiskProgramActionControls, preventionRiskProgramActions, preventionRiskPrograms,
  preventionRiskReviewRounds, users, worksites, worksiteUsers,
} from "@/db/schema"
import { checkMiperCompleteness, type CompletenessIssue } from "@/lib/prevention/miper/completeness"
import { RISK_CLASSIFICATIONS, type RiskClassification } from "@/lib/prevention/miper/methodology"
import { diffSnapshots, type MiperSnapshot, type SnapshotDiff } from "@/lib/prevention/miper/snapshot"
import { miperStatusLabel } from "@/lib/prevention/miper/states"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { listDictionaryNames, listFreeTextSuggestions } from "./dictionaries"
import { buildMiperHeaderPrefill, type MiperHeaderPrefill } from "./prefill"
import { getProgramHeader, type ProgramHeaderView } from "./program-queries"
import { buildMiperSnapshot, openRound as findOpenRound } from "./snapshots"
import { type MiperAccess, requireAccess, scopeAllows, scopeCondition, userNames } from "./shared"

const VIEW = "prevention:risk:view"
const emptyCounts = (): Record<RiskClassification, number> => ({ tolerable: 0, moderate: 0, important: 0, intolerable: 0 })

export type MiperListRow = {
  id: string; worksiteId: string; worksiteName: string; period: number | null; status: string; reviewState: string; isLegacy: boolean
  versionNumber: number | null; label: string; updatedAt: string; submittedAt: string | null; submittedByName: string | null
  entryCount: number; classificationCounts: Record<RiskClassification, number>; hasUnsentChanges: boolean; inboxReason?: string
}
export type MiperObservationView = typeof preventionRiskObservations.$inferSelect & { authorName: string; responderName: string | null }

export type MiperWorkspace = {
  matrix: typeof preventionRiskMatrices.$inferSelect & { worksiteName: string }
  label: string
  snapshot: MiperSnapshot
  entryVersions: Record<string, number>
  controlVersions: Record<string, number>
  versions: Array<{ id: string; versionNumber: number; approvedAt: string; changeSummary: string; approverName: string; technicalReviewerName: string; elaboratedByName: string }>
  lastVersionSnapshot: MiperSnapshot | null
  openRound: { id: string; stage: "technical" | "legal_rrhh"; roundNumber: number; openedAt: string | null; submittedByUserId: string; submittedAt: string; snapshot: MiperSnapshot } | null
  reviewDiff: SnapshotDiff | null
  /** Contra qué foto se calculó `reviewDiff`: da los valores "antes" del diff campo por campo. */
  reviewBaselineSnapshot: MiperSnapshot | null
  pendingDiff: SnapshotDiff
  observations: MiperObservationView[]
  completeness: CompletenessIssue[]
  prefill: MiperHeaderPrefill
  riskFactors: Array<{ id: string; name: string; isActive: boolean }>
  dictionaries: { activities: string[]; tasks: string[]; positions: string[]; locations: string[]; hazards: string[]; risks: string[]; damages: string[]; measures: string[] }
  responsibleOptions: Array<{ id: string; name: string }>
  /**
   * Cadena de MIPER de la faena (§8.5): los otros períodos de la misma faena,
   * para que el Historial enlace cada uno con su estado. Excluye esta MIPER.
   */
  siblingMatrices: Array<{ id: string; period: number | null; status: string; reviewState: string; isLegacy: boolean; versionNumber: number | null; label: string }>
  /**
   * Encabezado del Programa de Trabajo RE-04.1 de esta MIPER, o `null` si aún no
   * tiene programa. El detalle del panel (actividades, ocurrencias, avance) se
   * lee aparte con `getProgramWorkspace`.
   */
  program: ProgramHeaderView | null
  /* Qué actividades del Programa de Trabajo ejecutan cada medida de este MIPER.
   * La trazabilidad del §7.3 va en los dos sentidos: de la actividad a su fila y
   * de la fila a sus actividades. */
  controlActionLinks: Array<{ controlId: string; actionId: string; actionNumber: number; description: string }>
}

function hasUnsentChanges(matrix: { status: string; reviewState: string; updatedAt: string; publishedAt: string | null }) {
  return matrix.status === "published" && matrix.reviewState === "none" && Boolean(matrix.publishedAt) && matrix.updatedAt > matrix.publishedAt!
}

export async function getMiperWorkspace(matrixId: string, access: MiperAccess): Promise<MiperWorkspace> {
  requireAccess(access, VIEW)
  const [row] = await db.select({ matrix: preventionRiskMatrices, worksiteName: worksites.name }).from(preventionRiskMatrices)
    .innerJoin(worksites, eq(worksites.id, preventionRiskMatrices.worksiteId)).where(eq(preventionRiskMatrices.id, matrixId)).limit(1)
  if (!row || !scopeAllows(access.scope, row.matrix.worksiteId)) throw new RiskLegalDomainError("MIPER no encontrada o fuera de alcance.")
  const matrix = row.matrix

  const [snapshot, versionRows, round, observationRows, prefill, factorRows, dictionaryNames, suggestions, responsibleRows, entryVersionRows, allRounds, program] = await Promise.all([
    buildMiperSnapshot(db, matrix.id),
    db.select().from(preventionRiskMatrixVersions).where(eq(preventionRiskMatrixVersions.matrixId, matrix.id)).orderBy(desc(preventionRiskMatrixVersions.versionNumber)),
    findOpenRound(db, matrix.id),
    db.select().from(preventionRiskObservations).where(eq(preventionRiskObservations.matrixId, matrix.id)).orderBy(asc(preventionRiskObservations.createdAt)),
    buildMiperHeaderPrefill(db, matrix.worksiteId),
    db.select({ id: preventionRiskFactors.id, name: preventionRiskFactors.name, isActive: preventionRiskFactors.isActive }).from(preventionRiskFactors).orderBy(asc(preventionRiskFactors.sortOrder), asc(preventionRiskFactors.name)),
    listDictionaryNames(db, matrix.worksiteId),
    listFreeTextSuggestions(db, matrix.worksiteId),
    db.select({ id: users.id, name: users.name }).from(worksiteUsers).innerJoin(users, eq(users.id, worksiteUsers.userId))
      .where(and(eq(worksiteUsers.worksiteId, matrix.worksiteId), eq(users.isActive, true))).orderBy(asc(users.name)),
    db.select({ id: preventionRiskEntries.id, version: preventionRiskEntries.version }).from(preventionRiskEntries).where(eq(preventionRiskEntries.matrixId, matrix.id)),
    db.select().from(preventionRiskReviewRounds).where(eq(preventionRiskReviewRounds.matrixId, matrix.id)).orderBy(desc(preventionRiskReviewRounds.roundNumber)),
    getProgramHeader(matrix.id),
  ])
  const controlVersionRows = entryVersionRows.length === 0 ? [] : await db.select({ id: preventionRiskControls.id, version: preventionRiskControls.version })
    .from(preventionRiskControls).where(inArray(preventionRiskControls.riskEntryId, entryVersionRows.map((entry) => entry.id)))

  /* §7.3: qué actividad del programa ejecuta cada medida, para que desde la ficha
   * de un riesgo se llegue a sus actividades (el otro sentido ya vive en el panel
   * del programa). */
  const controlActionLinks = await db.select({
    controlId: preventionRiskProgramActionControls.controlId,
    actionId: preventionRiskProgramActions.id,
    actionNumber: preventionRiskProgramActions.actionNumber,
    description: preventionRiskProgramActions.description,
  }).from(preventionRiskProgramActionControls)
    .innerJoin(preventionRiskProgramActions, eq(preventionRiskProgramActions.id, preventionRiskProgramActionControls.actionId))
    .innerJoin(preventionRiskPrograms, eq(preventionRiskPrograms.id, preventionRiskProgramActions.programId))
    /* Sólo actividades vivas: es el mismo criterio que `programLinkedControlIds`
     * aplica al validar el envío, para que la UI no anuncie un pendiente que el
     * servidor ya no aplica (ni al revés). */
    .where(and(eq(preventionRiskPrograms.matrixId, matrix.id), eq(preventionRiskProgramActions.status, "active")))
    .orderBy(asc(preventionRiskProgramActions.actionNumber))

  // §8.5: la cadena de MIPER de la faena por período. Se reusa `buildRows` para
  // que el rótulo sea el mismo que ve la portada (incluye cambios sin enviar).
  const siblingRows = await db.select({ matrix: preventionRiskMatrices, worksiteName: worksites.name }).from(preventionRiskMatrices)
    .innerJoin(worksites, eq(worksites.id, preventionRiskMatrices.worksiteId))
    .where(and(eq(preventionRiskMatrices.worksiteId, matrix.worksiteId), ne(preventionRiskMatrices.id, matrix.id)))
    .orderBy(desc(preventionRiskMatrices.period), desc(preventionRiskMatrices.createdAt))
  const siblingMatrices = (await buildRows(siblingRows)).map((row) => ({
    id: row.id, period: row.period, status: row.status, reviewState: row.reviewState, isLegacy: row.isLegacy, versionNumber: row.versionNumber, label: row.label,
  }))

  const lastVersionSnapshot = (versionRows[0]?.snapshot as MiperSnapshot | undefined) ?? null
  let reviewDiff: SnapshotDiff | null = null
  let reviewBaselineSnapshot: MiperSnapshot | null = null
  if (round) {
    // "Modificados desde la revisión anterior": contra la última ronda técnica
    // previa; si es la primera, contra la versión vigente (o todo es nuevo).
    const previousTechnical = allRounds.find((candidate) => candidate.id !== round.id && candidate.stage === "technical" && candidate.roundNumber < round.roundNumber)
    const baseline = (previousTechnical?.snapshot as MiperSnapshot | undefined) ?? lastVersionSnapshot
    reviewDiff = diffSnapshots(baseline, round.snapshot as MiperSnapshot)
    reviewBaselineSnapshot = baseline
  }
  const names = await userNames(db, observationRows.flatMap((observation) => [observation.authorUserId, observation.respondedByUserId]))
  const responsibleOptions = [...responsibleRows]
  if (!responsibleOptions.some((option) => option.id === access.userId)) {
    const self = await userNames(db, [access.userId])
    const selfName = self.get(access.userId)
    if (selfName) responsibleOptions.push({ id: access.userId, name: selfName })
  }

  return {
    matrix: { ...matrix, worksiteName: row.worksiteName },
    label: miperStatusLabel({ status: matrix.status, reviewState: matrix.reviewState, versionNumber: versionRows[0]?.versionNumber ?? null, hasUnsentChanges: hasUnsentChanges(matrix), roundOpened: Boolean(round?.openedAt), isLegacy: matrix.isLegacy }),
    snapshot,
    entryVersions: Object.fromEntries(entryVersionRows.map((entry) => [entry.id, entry.version])),
    controlVersions: Object.fromEntries(controlVersionRows.map((control) => [control.id, control.version])),
    versions: versionRows.map((version) => ({ id: version.id, versionNumber: version.versionNumber, approvedAt: version.approvedAt, changeSummary: version.changeSummary, approverName: version.approverName, technicalReviewerName: version.technicalReviewerName, elaboratedByName: version.elaboratedByName })),
    lastVersionSnapshot,
    openRound: round ? { id: round.id, stage: round.stage as "technical" | "legal_rrhh", roundNumber: round.roundNumber, openedAt: round.openedAt, submittedByUserId: round.submittedByUserId, submittedAt: round.submittedAt, snapshot: round.snapshot as MiperSnapshot } : null,
    reviewDiff,
    reviewBaselineSnapshot,
    pendingDiff: diffSnapshots(lastVersionSnapshot, snapshot),
    observations: observationRows.map((observation) => ({ ...observation, authorName: names.get(observation.authorUserId) ?? "—", responderName: observation.respondedByUserId ? names.get(observation.respondedByUserId) ?? null : null })),
    completeness: checkMiperCompleteness(snapshot),
    prefill,
    riskFactors: factorRows,
    dictionaries: { ...dictionaryNames, ...suggestions },
    responsibleOptions,
    siblingMatrices,
    program,
    controlActionLinks,
  }
}

async function buildRows(matrixRows: Array<{ matrix: typeof preventionRiskMatrices.$inferSelect; worksiteName: string }>): Promise<MiperListRow[]> {
  if (matrixRows.length === 0) return []
  const ids = matrixRows.map((row) => row.matrix.id)
  const [counts, versions, rounds] = await Promise.all([
    db.select({ matrixId: preventionRiskEntries.matrixId, classification: preventionRiskEntries.classification, count: sql<number>`count(*)::int` })
      .from(preventionRiskEntries).where(inArray(preventionRiskEntries.matrixId, ids)).groupBy(preventionRiskEntries.matrixId, preventionRiskEntries.classification),
    db.select({ matrixId: preventionRiskMatrixVersions.matrixId, max: sql<number>`max(${preventionRiskMatrixVersions.versionNumber})::int` })
      .from(preventionRiskMatrixVersions).where(inArray(preventionRiskMatrixVersions.matrixId, ids)).groupBy(preventionRiskMatrixVersions.matrixId),
    db.select().from(preventionRiskReviewRounds).where(and(inArray(preventionRiskReviewRounds.matrixId, ids), isNull(preventionRiskReviewRounds.decision))),
  ])
  const submitters = await userNames(db, rounds.map((round) => round.submittedByUserId))
  const versionBy = new Map(versions.map((row) => [row.matrixId, row.max]))
  const roundBy = new Map(rounds.map((round) => [round.matrixId, round]))
  return matrixRows.map(({ matrix, worksiteName }) => {
    const classificationCounts = emptyCounts()
    let entryCount = 0
    for (const item of counts.filter((candidate) => candidate.matrixId === matrix.id)) {
      entryCount += item.count
      if (item.classification && (RISK_CLASSIFICATIONS as readonly string[]).includes(item.classification)) classificationCounts[item.classification as RiskClassification] += item.count
    }
    const round = roundBy.get(matrix.id)
    const unsent = hasUnsentChanges(matrix)
    const versionNumber = versionBy.get(matrix.id) ?? null
    return {
      id: matrix.id, worksiteId: matrix.worksiteId, worksiteName, period: matrix.period, status: matrix.status, reviewState: matrix.reviewState, isLegacy: matrix.isLegacy,
      versionNumber,
      label: miperStatusLabel({ status: matrix.status, reviewState: matrix.reviewState, versionNumber, hasUnsentChanges: unsent, roundOpened: Boolean(round?.openedAt), isLegacy: matrix.isLegacy }),
      updatedAt: matrix.updatedAt, submittedAt: round?.submittedAt ?? null, submittedByName: round ? submitters.get(round.submittedByUserId) ?? null : null,
      entryCount, classificationCounts, hasUnsentChanges: unsent,
    }
  })
}

export async function listMipers(access: MiperAccess, filters: { worksiteId?: string; period?: number; state?: string } = {}) {
  requireAccess(access, VIEW)
  const stateCondition = !filters.state ? undefined
    : ["draft", "published", "superseded"].includes(filters.state) ? eq(preventionRiskMatrices.status, filters.state)
    : eq(preventionRiskMatrices.reviewState, filters.state)
  const rows = await db.select({ matrix: preventionRiskMatrices, worksiteName: worksites.name }).from(preventionRiskMatrices)
    .innerJoin(worksites, eq(worksites.id, preventionRiskMatrices.worksiteId))
    .where(and(
      scopeCondition(access.scope, preventionRiskMatrices.worksiteId),
      filters.worksiteId ? eq(preventionRiskMatrices.worksiteId, filters.worksiteId) : undefined,
      filters.period ? eq(preventionRiskMatrices.period, filters.period) : undefined,
      stateCondition,
    ))
    .orderBy(asc(worksites.name), desc(preventionRiskMatrices.period), desc(preventionRiskMatrices.createdAt))
  return buildRows(rows)
}

export async function listMiperInbox(access: MiperAccess) {
  requireAccess(access, VIEW)
  const can = (permission: string) => access.permissions.includes(permission)
  const conditions = []
  if (can("prevention:risk:edit")) {
    conditions.push(and(eq(preventionRiskMatrices.isLegacy, false), or(
      and(eq(preventionRiskMatrices.status, "draft"), inArray(preventionRiskMatrices.reviewState, ["none", "observed"])),
      and(eq(preventionRiskMatrices.status, "published"), eq(preventionRiskMatrices.reviewState, "observed")),
      and(eq(preventionRiskMatrices.status, "published"), eq(preventionRiskMatrices.reviewState, "none"), gt(preventionRiskMatrices.updatedAt, preventionRiskMatrices.publishedAt)),
    )))
  }
  if (can("prevention:risk:review")) conditions.push(eq(preventionRiskMatrices.reviewState, "in_review"))
  if (can("prevention:risk:approve_legal")) conditions.push(eq(preventionRiskMatrices.reviewState, "pending_approval"))
  if (conditions.length === 0) return []
  const rows = await db.select({ matrix: preventionRiskMatrices, worksiteName: worksites.name }).from(preventionRiskMatrices)
    .innerJoin(worksites, eq(worksites.id, preventionRiskMatrices.worksiteId))
    .where(and(scopeCondition(access.scope, preventionRiskMatrices.worksiteId), ne(preventionRiskMatrices.status, "superseded"), or(...conditions)))
    .orderBy(asc(preventionRiskMatrices.updatedAt))
  const built = await buildRows(rows)
  return built.flatMap((item) => {
    let inboxReason: string | undefined
    if (item.reviewState === "in_review" && can("prevention:risk:review")) inboxReason = "Pendiente de tu revisión"
    else if (item.reviewState === "pending_approval" && can("prevention:risk:approve_legal")) inboxReason = "Pendiente de tu firma"
    else if (can("prevention:risk:edit") && !item.isLegacy) {
      inboxReason = item.reviewState === "observed" ? "Con observaciones" : item.hasUnsentChanges ? "Cambios sin enviar" : item.status === "draft" && item.reviewState === "none" ? "Borrador" : undefined
    }
    return inboxReason ? [{ ...item, inboxReason }] : []
  })
}

export type MiperHistoryEvent = { id: string; at: string; actorName: string | null; actingAs: string | null; changeType: string; object: string | null; reason: string | null }

export async function getMiperHistory(matrixId: string, access: MiperAccess): Promise<MiperHistoryEvent[]> {
  requireAccess(access, VIEW)
  const [matrix] = await db.select({ worksiteId: preventionRiskMatrices.worksiteId }).from(preventionRiskMatrices).where(eq(preventionRiskMatrices.id, matrixId)).limit(1)
  if (!matrix || !scopeAllows(access.scope, matrix.worksiteId)) throw new RiskLegalDomainError("MIPER no encontrada o fuera de alcance.")
  const rows = await db.select({ log: auditLog, actorName: users.name }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(inArray(auditLog.entityType, ["risk_legal:risk:miper", "risk_legal:risk:matrix"]), eq(auditLog.entityId, matrixId)))
    .orderBy(desc(auditLog.createdAt)).limit(500)
  return rows.map(({ log, actorName }) => {
    let state: Record<string, unknown> = {}
    try { state = JSON.parse(log.newState ?? "{}") as Record<string, unknown> } catch { state = {} }
    // La clave persistida es `roleContext` (§4.9). La vista la expone como
    // `actingAs` para no forzar cambios en la UI que ya la consume.
    return { id: log.id, at: log.createdAt, actorName, actingAs: typeof state.roleContext === "string" ? state.roleContext : null, changeType: String(state.changeType ?? log.action), object: typeof state.object === "string" ? state.object : null, reason: log.reason }
  })
}

export async function getMiperVersion(versionId: string, access: MiperAccess) {
  requireAccess(access, VIEW)
  const [row] = await db.select({ version: preventionRiskMatrixVersions, worksiteId: preventionRiskMatrices.worksiteId, worksiteName: worksites.name, worksiteCode: worksites.code, methodologySnapshot: preventionRiskMatrices.methodologySnapshot })
    .from(preventionRiskMatrixVersions)
    .innerJoin(preventionRiskMatrices, eq(preventionRiskMatrices.id, preventionRiskMatrixVersions.matrixId))
    .innerJoin(worksites, eq(worksites.id, preventionRiskMatrices.worksiteId))
    .where(eq(preventionRiskMatrixVersions.id, versionId)).limit(1)
  if (!row || !scopeAllows(access.scope, row.worksiteId)) throw new RiskLegalDomainError("Versión MIPER no encontrada o fuera de alcance.")
  const versions = await db.select({ versionNumber: preventionRiskMatrixVersions.versionNumber, approvedAt: preventionRiskMatrixVersions.approvedAt, changeSummary: preventionRiskMatrixVersions.changeSummary, approverName: preventionRiskMatrixVersions.approverName, elaboratedByName: preventionRiskMatrixVersions.elaboratedByName })
    .from(preventionRiskMatrixVersions)
    .where(and(eq(preventionRiskMatrixVersions.matrixId, row.version.matrixId), sql`${preventionRiskMatrixVersions.versionNumber} <= ${row.version.versionNumber}`))
    .orderBy(asc(preventionRiskMatrixVersions.versionNumber))
  return { ...row, versions }
}

/** Para el archivado (cron, sin sesión): sólo lee una versión ya sellada. */
export async function getMiperVersionForArchive(versionId: string) {
  return getMiperVersion(versionId, { userId: "system:generated-documents", scope: { mode: "all", ids: [] }, permissions: [VIEW] })
}

export async function listMiperCreationOptions(access: MiperAccess) {
  requireAccess(access, "prevention:risk:edit")
  const rows = await db.select({ id: worksites.id, name: worksites.name }).from(worksites)
    .where(and(eq(worksites.isActive, true), scopeCondition(access.scope, worksites.id))).orderBy(asc(worksites.name))
  const vigentes = rows.length === 0 ? [] : await db.select({
    id: preventionRiskMatrices.id, worksiteId: preventionRiskMatrices.worksiteId, period: preventionRiskMatrices.period,
    isLegacy: preventionRiskMatrices.isLegacy, status: preventionRiskMatrices.status, reviewState: preventionRiskMatrices.reviewState,
    updatedAt: preventionRiskMatrices.updatedAt, publishedAt: preventionRiskMatrices.publishedAt,
  }).from(preventionRiskMatrices).where(and(inArray(preventionRiskMatrices.worksiteId, rows.map((row) => row.id)), eq(preventionRiskMatrices.status, "published")))
  const byWorksite = new Map(vigentes.map((vigente) => [vigente.worksiteId, vigente]))
  return {
    worksites: rows.map((row) => {
      const vigente = byWorksite.get(row.id)
      return {
        id: row.id, name: row.name,
        vigenteId: vigente?.id ?? null, vigentePeriod: vigente?.period ?? null, vigenteIsLegacy: vigente?.isLegacy ?? false,
        /* Una MIPER vigente puede tener cambios sin enviar a revisión. Al sellar
         * el período siguiente deja de ser el documento vigente y esos cambios no
         * quedan en ninguna versión sellada: el diálogo lo advierte antes. */
        vigenteHasUnsentChanges: vigente ? hasUnsentChanges(vigente) : false,
      }
    }),
  }
}
