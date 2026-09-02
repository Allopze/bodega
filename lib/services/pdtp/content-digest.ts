import { createHash } from "node:crypto"
import { and, asc, eq, inArray } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpActivityScheduleOverrides,
  pdtpActivityWorksiteExclusions,
  pdtpActivityWorksiteParams,
  pdtpApprovalSteps,
  pdtpActivityChecklists,
  pdtpActivitySchedule,
  pdtpDocumentHistory,
  pdtpImportBatches,
  pdtpPrograms,
  pdtpProgramWorksites,
  pdtpRoleLegendEntries,
  pdtpSheetActivities,
  pdtpSheets,
  preventionPdtpSourceLinks,
} from "@/db/schema"

type QueryClient = Tx | typeof db
type JsonPrimitive = string | number | boolean | null
type StableJson = JsonPrimitive | StableJson[] | { [key: string]: StableJson }

function stableJson(value: unknown): StableJson {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value
  }
  if (Array.isArray(value)) return value.map(stableJson)
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableJson(item)]),
    )
  }
  return String(value)
}

export type PdtpProgramContentSnapshot = ReturnType<typeof stableJson>

/**
 * Construye la version canonica que firman los aprobadores del programa.
 * Excluye timestamps e IDs de bitacora: una firma representa el contenido
 * preventivo, no detalles accidentales de persistencia.
 */
export async function buildPdtpProgramContentSnapshot(
  programId: string,
  client: QueryClient = db,
): Promise<PdtpProgramContentSnapshot> {
  const [program] = await client.select({
    id: pdtpPrograms.id,
    year: pdtpPrograms.year,
    version: pdtpPrograms.version,
    contentVersion: pdtpPrograms.contentVersion,
    title: pdtpPrograms.title,
    periodStart: pdtpPrograms.periodStart,
    periodEnd: pdtpPrograms.periodEnd,
    documentCode: pdtpPrograms.documentCode,
    documentRevision: pdtpPrograms.documentRevision,
    validFrom: pdtpPrograms.validFrom,
    validUntil: pdtpPrograms.validUntil,
    indicatorName: pdtpPrograms.indicatorName,
    indicatorType: pdtpPrograms.indicatorType,
    indicatorFormula: pdtpPrograms.indicatorFormula,
    indicatorPeriodicity: pdtpPrograms.indicatorPeriodicity,
    measurementOwner: pdtpPrograms.measurementOwner,
    sourceMetadataJson: pdtpPrograms.sourceMetadataJson,
    creationMode: pdtpPrograms.creationMode,
    sourceProgramId: pdtpPrograms.sourceProgramId,
    sourceContentVersion: pdtpPrograms.sourceContentVersion,
    sourceTemplateVersionId: pdtpPrograms.sourceTemplateVersionId,
    elaboratedByUserId: pdtpPrograms.elaboratedByUserId,
    elaboratedByName: pdtpPrograms.elaboratedByName,
    elaboratedByTitle: pdtpPrograms.elaboratedByTitle,
    complianceTarget: pdtpPrograms.complianceTarget,
    pesoEjecucion: pdtpPrograms.pesoEjecucion,
    pesoVerificacion: pdtpPrograms.pesoVerificacion,
    pesoCierre: pdtpPrograms.pesoCierre,
  }).from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")

  const activities = await client.select({
    id: pdtpActivities.id,
    n: pdtpActivities.n,
    displayOrder: pdtpActivities.displayOrder,
    status: pdtpActivities.status,
    retiredReason: pdtpActivities.retiredReason,
    retiredEffectiveFrom: pdtpActivities.retiredEffectiveFrom,
    retiredByUserId: pdtpActivities.retiredByUserId,
    retiredAt: pdtpActivities.retiredAt,
    activity: pdtpActivities.activity,
    program: pdtpActivities.program,
    responsibleSlugs: pdtpActivities.responsibleSlugs,
    responsibleDisplay: pdtpActivities.responsibleDisplay,
    audienceRoles: pdtpActivities.audienceRoles,
    scheduleMode: pdtpActivities.scheduleMode,
    scheduleClassificationStatus: pdtpActivities.scheduleClassificationStatus,
    recurrenceRule: pdtpActivities.recurrenceRule,
    triggerType: pdtpActivities.triggerType,
    triggerDescription: pdtpActivities.triggerDescription,
    dueDays: pdtpActivities.dueDays,
    evidenceRequirement: pdtpActivities.evidenceRequirement,
    indicatorMode: pdtpActivities.indicatorMode,
    // El método se firma —de qué población se mide— aunque el conteo no:
    // ver la nota de `activityWorksiteAdjustments` más abajo.
    subjectSource: pdtpActivities.subjectSource,
    targetValue: pdtpActivities.targetValue,
    targetUnit: pdtpActivities.targetUnit,
    notes: pdtpActivities.notes,
  }).from(pdtpActivities)
    .where(eq(pdtpActivities.programId, programId))
    .orderBy(asc(pdtpActivities.n))

  const approvalSteps = await client.select({
    stepOrder: pdtpApprovalSteps.stepOrder,
    code: pdtpApprovalSteps.code,
    label: pdtpApprovalSteps.label,
    requiredPermission: pdtpApprovalSteps.requiredPermission,
    isRequired: pdtpApprovalSteps.isRequired,
    segregationRules: pdtpApprovalSteps.segregationRules,
  }).from(pdtpApprovalSteps)
    .where(eq(pdtpApprovalSteps.programId, programId))
    .orderBy(asc(pdtpApprovalSteps.stepOrder))

  const activityIds = activities.map((activity) => activity.id)
  const activityNumberById = new Map(activities.map((activity) => [activity.id, activity.n]))
  const schedules = activityIds.length > 0
    ? await client.select({
        activityId: pdtpActivitySchedule.activityId,
        year: pdtpActivitySchedule.year,
        month: pdtpActivitySchedule.month,
        week: pdtpActivitySchedule.week,
        plannedQuantity: pdtpActivitySchedule.plannedQuantity,
      }).from(pdtpActivitySchedule)
        .where(inArray(pdtpActivitySchedule.activityId, activityIds))
        .orderBy(asc(pdtpActivitySchedule.activityId), asc(pdtpActivitySchedule.year), asc(pdtpActivitySchedule.month), asc(pdtpActivitySchedule.week))
    : []

  const sheets = await client.select({
    id: pdtpSheets.id,
    code: pdtpSheets.code,
    label: pdtpSheets.label,
    area: pdtpSheets.area,
    defaultScopeRoles: pdtpSheets.defaultScopeRoles,
    isActive: pdtpSheets.isActive,
  }).from(pdtpSheets)
    .where(eq(pdtpSheets.programId, programId))
    .orderBy(asc(pdtpSheets.code))
  const sheetIds = sheets.map((sheet) => sheet.id)
  const sheetCodeById = new Map(sheets.map((sheet) => [sheet.id, sheet.code]))
  const memberships = sheetIds.length > 0
    ? await client.select({
        sheetId: pdtpSheetActivities.sheetId,
        activityId: pdtpSheetActivities.activityId,
        sheetRow: pdtpSheetActivities.sheetRow,
        displayOrder: pdtpSheetActivities.displayOrder,
      }).from(pdtpSheetActivities)
        .where(inArray(pdtpSheetActivities.sheetId, sheetIds))
        .orderBy(asc(pdtpSheetActivities.sheetId), asc(pdtpSheetActivities.displayOrder))
    : []

  const checklists = activityIds.length > 0
    ? await client.select({
        activityId: pdtpActivityChecklists.activityId,
        version: pdtpActivityChecklists.version,
        label: pdtpActivityChecklists.label,
        definitionJson: pdtpActivityChecklists.definitionJson,
      }).from(pdtpActivityChecklists)
        .where(inArray(pdtpActivityChecklists.activityId, activityIds))
        .orderBy(asc(pdtpActivityChecklists.activityId), asc(pdtpActivityChecklists.version))
    : []

  const sourceLinks = activityIds.length > 0
    ? await client.select({
        activityId: preventionPdtpSourceLinks.activityId,
        worksiteId: preventionPdtpSourceLinks.worksiteId,
        sourceType: preventionPdtpSourceLinks.sourceType,
        sourceId: preventionPdtpSourceLinks.sourceId,
        sourceVersionSnapshot: preventionPdtpSourceLinks.sourceVersionSnapshot,
        justification: preventionPdtpSourceLinks.justification,
        isActive: preventionPdtpSourceLinks.isActive,
      }).from(preventionPdtpSourceLinks)
        .where(inArray(preventionPdtpSourceLinks.activityId, activityIds))
        .orderBy(
          asc(preventionPdtpSourceLinks.activityId),
          asc(preventionPdtpSourceLinks.worksiteId),
          asc(preventionPdtpSourceLinks.sourceType),
          asc(preventionPdtpSourceLinks.sourceId),
        )
    : []

  const documentHistory = await client.select({
    entryKind: pdtpDocumentHistory.entryKind,
    stableKey: pdtpDocumentHistory.stableKey,
    sequence: pdtpDocumentHistory.sequence,
    declaredActorName: pdtpDocumentHistory.declaredActorName,
    declaredActorTitle: pdtpDocumentHistory.declaredActorTitle,
    declaredAtText: pdtpDocumentHistory.declaredAtText,
    description: pdtpDocumentHistory.description,
    linkedUserId: pdtpDocumentHistory.linkedUserId,
    reconciliationReason: pdtpDocumentHistory.reconciliationReason,
    sourceMetadataJson: pdtpDocumentHistory.sourceMetadataJson,
    adapterCode: pdtpImportBatches.adapterCode,
    sourceChecksumSha256: pdtpImportBatches.sourceChecksumSha256,
  }).from(pdtpDocumentHistory)
    .leftJoin(pdtpImportBatches, eq(pdtpDocumentHistory.sourceImportBatchId, pdtpImportBatches.id))
    .where(eq(pdtpDocumentHistory.programId, programId))
    .orderBy(asc(pdtpDocumentHistory.entryKind), asc(pdtpDocumentHistory.sequence), asc(pdtpDocumentHistory.stableKey))

  // Membresía de faenas y exclusiones puntuales: contenido de autoría (define
  // qué faena ve el programa y qué actividad excluye), no un ajuste
  // operacional como los overrides de meta — por eso firma, a diferencia de
  // `pdtpActivityScheduleOverrides`.
  const programWorksites = await client.select({
    worksiteId: pdtpProgramWorksites.worksiteId,
    isActive: pdtpProgramWorksites.isActive,
  }).from(pdtpProgramWorksites)
    .where(and(eq(pdtpProgramWorksites.programId, programId), eq(pdtpProgramWorksites.isActive, true)))
    .orderBy(asc(pdtpProgramWorksites.worksiteId))

  const activityWorksiteExclusions = activityIds.length > 0
    ? await client.select({
        activityId: pdtpActivityWorksiteExclusions.activityId,
        worksiteId: pdtpActivityWorksiteExclusions.worksiteId,
        reason: pdtpActivityWorksiteExclusions.reason,
      }).from(pdtpActivityWorksiteExclusions)
        .where(inArray(pdtpActivityWorksiteExclusions.activityId, activityIds))
        .orderBy(asc(pdtpActivityWorksiteExclusions.activityId), asc(pdtpActivityWorksiteExclusions.worksiteId))
    : []

  /**
   * `expected_subject_count` NO entra en la huella, a diferencia del resto de la
   * fila.
   *
   * El programa firmado es un compromiso: a quién se le exige cada actividad
   * (`responsible*`), con qué meta (`target_coverage_percent`) y en qué faenas
   * aplica. El padrón es otra cosa: es cuántos sujetos existen hoy —expuestos en
   * un GES, equipos en la faena—, un hecho del mundo que cambia cuando entra o
   * sale gente mientras el compromiso sigue igual. Firmarlo obligaba a abrir una
   * revisión nueva del programa para corregir un conteo, y el propio motivo para
   * firmarlo no se sostiene: los indicadores no se persisten, se recalculan en
   * vivo, así que el porcentaje ya se mueve con cada aprobación o revocación.
   * Congelar sólo el padrón daba una reproducibilidad aparente.
   *
   * Por eso además se descartan las filas que quedan sin contenido firmado: si
   * no se filtraran, cargar un padrón por primera vez seguiría alterando la
   * huella por la simple aparición de la fila en el arreglo.
   */
  const activityWorksiteAdjustments = activityIds.length > 0
    ? (await client.select({
        activityId: pdtpActivityWorksiteParams.activityId,
        worksiteId: pdtpActivityWorksiteParams.worksiteId,
        targetCoveragePercent: pdtpActivityWorksiteParams.targetCoveragePercent,
        responsibleSlugs: pdtpActivityWorksiteParams.responsibleSlugs,
        responsibleDisplay: pdtpActivityWorksiteParams.responsibleDisplay,
        responsibleReason: pdtpActivityWorksiteParams.responsibleReason,
      }).from(pdtpActivityWorksiteParams)
        .where(inArray(pdtpActivityWorksiteParams.activityId, activityIds))
        .orderBy(asc(pdtpActivityWorksiteParams.activityId), asc(pdtpActivityWorksiteParams.worksiteId)))
        .filter((row) => row.targetCoveragePercent !== null
          || row.responsibleSlugs !== null
          || row.responsibleDisplay !== null
          || row.responsibleReason !== null)
    : []

  const activityScheduleOverrides = activityIds.length > 0
    ? await client.select({
        activityId: pdtpActivityScheduleOverrides.activityId,
        worksiteId: pdtpActivityScheduleOverrides.worksiteId,
        year: pdtpActivityScheduleOverrides.year,
        month: pdtpActivityScheduleOverrides.month,
        week: pdtpActivityScheduleOverrides.week,
        plannedQuantity: pdtpActivityScheduleOverrides.plannedQuantity,
      }).from(pdtpActivityScheduleOverrides)
        .where(inArray(pdtpActivityScheduleOverrides.activityId, activityIds))
        .orderBy(
          asc(pdtpActivityScheduleOverrides.activityId),
          asc(pdtpActivityScheduleOverrides.worksiteId),
          asc(pdtpActivityScheduleOverrides.year),
          asc(pdtpActivityScheduleOverrides.month),
          asc(pdtpActivityScheduleOverrides.week),
        )
    : []

  const roleLegend = await client.select({
    code: pdtpRoleLegendEntries.code,
    label: pdtpRoleLegendEntries.label,
    adapterCode: pdtpImportBatches.adapterCode,
    sourceChecksumSha256: pdtpImportBatches.sourceChecksumSha256,
  }).from(pdtpRoleLegendEntries)
    .innerJoin(pdtpImportBatches, eq(pdtpRoleLegendEntries.sourceImportBatchId, pdtpImportBatches.id))
    .where(eq(pdtpRoleLegendEntries.programId, programId))
    .orderBy(asc(pdtpRoleLegendEntries.code))

  return stableJson({
    // 10: `subject_source` entra al snapshot. Declarar contra qué población se
    // mide una actividad es un compromiso del programa, a diferencia de cuántos
    // sujetos hay hoy, que es un hecho del mundo.
    // 9: `expected_subject_count` salió de `activityWorksiteAdjustments`. Un
    // snapshot con otra forma tiene que declarar otra versión, o dos
    // definiciones distintas comparten número y la huella deja de ser
    // interpretable. Ninguna firma existente se invalida: no hay programas
    // firmados (confirmado el 2026-09-02).
    schemaVersion: 10,
    program,
    approvalSteps,
    activities: activities.map(({ id: _id, ...activity }) => activity),
    schedules: schedules.map(({ activityId, ...schedule }) => ({ activityNumber: activityNumberById.get(activityId), ...schedule })),
    views: sheets.map(({ id: _id, ...sheet }) => sheet),
    memberships: memberships.map(({ sheetId, activityId, ...membership }) => ({
      viewCode: sheetCodeById.get(sheetId),
      activityNumber: activityNumberById.get(activityId),
      ...membership,
    })),
    checklists: checklists.map(({ activityId, ...checklist }) => ({
      activityNumber: activityNumberById.get(activityId),
      ...checklist,
    })),
    sourceLinks: sourceLinks.map(({ activityId, ...link }) => ({
      activityNumber: activityNumberById.get(activityId),
      ...link,
    })),
    documentHistory,
    roleLegend,
    programWorksites,
    activityWorksiteExclusions: activityWorksiteExclusions.map(({ activityId, ...exclusion }) => ({
      activityNumber: activityNumberById.get(activityId),
      ...exclusion,
    })),
    activityWorksiteAdjustments: activityWorksiteAdjustments.map(({ activityId, ...adjustment }) => ({
      activityNumber: activityNumberById.get(activityId),
      ...adjustment,
    })),
    activityScheduleOverrides: activityScheduleOverrides.map(({ activityId, ...override }) => ({
      activityNumber: activityNumberById.get(activityId),
      ...override,
    })),
  })
}

export async function computePdtpProgramContentDigest(
  programId: string,
  client: QueryClient = db,
): Promise<{ digest: string; snapshot: PdtpProgramContentSnapshot }> {
  const snapshot = await buildPdtpProgramContentSnapshot(programId, client)
  const digest = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")
  return { digest, snapshot }
}
