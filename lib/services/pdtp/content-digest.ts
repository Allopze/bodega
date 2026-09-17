import { createHash } from "node:crypto"
import { and, asc, eq, inArray } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpActivityExecutorAssignments,
  pdtpActivityScheduleOverrides,
  pdtpActivityWorksiteExclusions,
  pdtpActivityWorksiteParams,
  pdtpApprovalSteps,
  pdtpActivityChecklists,
  pdtpActivitySchedule,
  pdtpDocumentHistory,
  pdtpImportBatches,
  pdtpObjectives,
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

/** Forma del snapshot, independiente del número de revisión del programa. */
export const CURRENT_PDTP_CONTENT_SCHEMA_VERSION = 15

/**
 * Versión de esquema más antigua que este builder sabe reconstruir con
 * exactitud a partir de las columnas actuales.
 *
 * Sólo tres cambios de forma están efectivamente deshechos por versión más
 * abajo: `executorAssignments` (≥13), `mechanism` (≥14) y `objectives` /
 * `activities[].objectiveCode` (≥15). Los cambios de las
 * versiones 9 a 12 (`expected_subject_count` fuera de la huella, `subject_source`,
 * `dueHours`, las capacidades del padrón) están para siempre incorporados sin
 * condición — no hay forma de "apagarlos" para reproducir cómo se veía la
 * huella antes de esos cambios. Eso significa que la única versión anterior a
 * 13 cuya forma original coincide con lo que este código produce hoy es la 12
 * (la última antes de que empezara a haber ramas por versión); 9, 10 y 11 no
 * son reconstruibles. Ver `computePdtpProgramContentDigestForStoredVersion`.
 */
export const MIN_RECONSTRUCTIBLE_PDTP_CONTENT_SCHEMA_VERSION = 12

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
  options: { schemaVersion?: number } = {},
): Promise<PdtpProgramContentSnapshot> {
  const schemaVersion = options.schemaVersion ?? CURRENT_PDTP_CONTENT_SCHEMA_VERSION
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
    catalogActivityId: pdtpActivities.catalogActivityId,
    catalogRevision: pdtpActivities.catalogRevision,
    objectiveId: pdtpActivities.objectiveId,
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
    dueHours: pdtpActivities.dueHours,
    evidenceRequirement: pdtpActivities.evidenceRequirement,
    mechanism: pdtpActivities.mechanism,
    indicatorMode: pdtpActivities.indicatorMode,
    // El método se firma —de qué población se mide— aunque el conteo no:
    // ver la nota de `activityWorksiteAdjustments` más abajo.
    subjectSource: pdtpActivities.subjectSource,
    subjectCapabilityCodes: pdtpActivities.subjectCapabilityCodes,
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

  // Los ejecutores son una decisión de contenido: la firma debe probar no
  // sólo qué se prometió, sino qué roles podían acreditar ese hecho.
  const executorAssignments = activityIds.length > 0
    ? await client.select({
        activityId: pdtpActivityExecutorAssignments.activityId,
        roleId: pdtpActivityExecutorAssignments.roleId,
      }).from(pdtpActivityExecutorAssignments)
        .where(inArray(pdtpActivityExecutorAssignments.activityId, activityIds))
        .orderBy(asc(pdtpActivityExecutorAssignments.activityId), asc(pdtpActivityExecutorAssignments.roleId))
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

  // Los objetivos del programa (RE-36) son un compromiso de contenido: a qué
  // objetivo estratégico responde cada actividad. Sólo se consultan cuando la
  // huella pedida ya los incluye, para no gastar una consulta al reconstruir
  // una versión anterior que nunca los tuvo.
  const objectives = schemaVersion >= 15
    ? await client.select({
        id: pdtpObjectives.id,
        code: pdtpObjectives.code,
        name: pdtpObjectives.name,
        displayOrder: pdtpObjectives.displayOrder,
      }).from(pdtpObjectives)
        .where(eq(pdtpObjectives.programId, programId))
        .orderBy(asc(pdtpObjectives.displayOrder), asc(pdtpObjectives.code))
    : []
  const objectiveCodeById = new Map(objectives.map((objective) => [objective.id, objective.code]))

  return stableJson({
    // 12: las capacidades que definen `trabajadores_capacidad` entran al
    // snapshot. Cambiarlas altera quién forma el padrón y requiere otra firma.
    // 11: `dueHours` entra al snapshot junto a `dueDays`: es el mismo
    // compromiso de plazo partido en dos unidades (Fase 1, 2026-09-02).
    // 10: `subject_source` entra al snapshot. Declarar contra qué población se
    // mide una actividad es un compromiso del programa, a diferencia de cuántos
    // sujetos hay hoy, que es un hecho del mundo.
    // 9: `expected_subject_count` salió de `activityWorksiteAdjustments`. Un
    // snapshot con otra forma tiene que declarar otra versión, o dos
    // definiciones distintas comparten número y la huella deja de ser
    // interpretable.
    //
    // Los cuatro cambios de arriba (9 a 12) están incorporados sin condición:
    // no hay una rama `schemaVersion >= N` que los deshaga, así que este
    // builder reproduce la forma exacta de una huella firmada en la versión
    // 12 (que ya los tenía todos), pero NO la de una firmada en 9, 10 u 11.
    // `computePdtpProgramContentDigestForStoredVersion` rechaza explícitamente
    // esas versiones más viejas en vez de devolver un digest que no va a
    // coincidir con nada — ver `MIN_RECONSTRUCTIBLE_PDTP_CONTENT_SCHEMA_VERSION`.
    // 14: `mechanism` se incorpora al compromiso de destino operativo; antes
    // se omitía del snapshot aunque ya existiera en la actividad.
    // 15: el objetivo del programa (RE-36) entra al compromiso firmado —
    // tanto el catálogo de objetivos (`objectives`) como a cuál responde cada
    // actividad (`activities[].objectiveCode`, resuelto por código en vez del
    // id interno para que la huella no dependa de un identificador accidental
    // de persistencia).
    schemaVersion,
    program,
    approvalSteps,
    activities: activities.map(({ id: _id, mechanism, objectiveId, ...activity }) => ({
      ...activity,
      ...(schemaVersion >= 14 ? { mechanism } : {}),
      ...(schemaVersion >= 15 ? { objectiveCode: objectiveId ? objectiveCodeById.get(objectiveId) ?? null : null } : {}),
    })),
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
    ...(schemaVersion >= 13 ? {
      executorAssignments: executorAssignments.map(({ activityId, roleId }) => ({
        activityNumber: activityNumberById.get(activityId),
        roleId,
      })),
    } : {}),
    ...(schemaVersion >= 15 ? {
      objectives: objectives.map(({ id: _id, ...objective }) => objective),
    } : {}),
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
  options: { schemaVersion?: number } = {},
): Promise<{ digest: string; snapshot: PdtpProgramContentSnapshot }> {
  const snapshot = await buildPdtpProgramContentSnapshot(programId, client, options)
  const digest = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")
  return { digest, snapshot }
}

function storedContentSchemaVersion(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const candidate = (value as { schemaVersion?: unknown }).schemaVersion
  return typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 1
    ? candidate
    : undefined
}

/**
 * Un programa firmado en un esquema que este builder ya no sabe reconstruir
 * (ver `MIN_RECONSTRUCTIBLE_PDTP_CONTENT_SCHEMA_VERSION`). No es un drift de
 * contenido: es que el código actual no puede reproducir la forma exacta con
 * la que se firmó, así que cualquier comparación de digest sería ruido, no
 * una señal real de que el programa cambió.
 */
export class PdtpUnreconstructibleContentSchemaError extends Error {
  constructor(
    public readonly programId: string,
    public readonly storedSchemaVersion: number,
  ) {
    super(
      `El programa ${programId} tiene una huella firmada en el esquema ${storedSchemaVersion}, `
      + `anterior al mínimo que este código sabe reconstruir (${MIN_RECONSTRUCTIBLE_PDTP_CONTENT_SCHEMA_VERSION}). `
      + "No se puede verificar ni recomponer esa firma con las columnas actuales.",
    )
    this.name = "PdtpUnreconstructibleContentSchemaError"
  }
}

/**
 * Verifica una huella reconstruyendo la forma con la que fue firmada
 * originalmente, según la versión de esquema declarada en `reviewSnapshotJson`.
 *
 * Sólo funciona para `schemaVersion >= MIN_RECONSTRUCTIBLE_PDTP_CONTENT_SCHEMA_VERSION`:
 * por debajo de eso, el builder no tiene cómo deshacer los cambios de forma
 * de las versiones 9 a 11 (ver el comentario en `buildPdtpProgramContentSnapshot`)
 * y devolvería un digest que no coincide con nada, indistinguible de un drift
 * real de contenido. En ese caso se lanza `PdtpUnreconstructibleContentSchemaError`
 * en vez de comparar huellas que no se pueden comparar.
 */
export async function computePdtpProgramContentDigestForStoredVersion(
  programId: string,
  client: QueryClient = db,
): Promise<{ digest: string; snapshot: PdtpProgramContentSnapshot; schemaVersion: number }> {
  const [program] = await client.select({ reviewSnapshotJson: pdtpPrograms.reviewSnapshotJson })
    .from(pdtpPrograms)
    .where(eq(pdtpPrograms.id, programId))
    .limit(1)
  const schemaVersion = storedContentSchemaVersion(program?.reviewSnapshotJson)
    ?? CURRENT_PDTP_CONTENT_SCHEMA_VERSION
  if (schemaVersion < MIN_RECONSTRUCTIBLE_PDTP_CONTENT_SCHEMA_VERSION) {
    throw new PdtpUnreconstructibleContentSchemaError(programId, schemaVersion)
  }
  const result = await computePdtpProgramContentDigest(programId, client, { schemaVersion })
  return { ...result, schemaVersion }
}
