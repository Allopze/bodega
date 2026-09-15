import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpActivityChecklists,
  pdtpActivitySchedule,
  pdtpApprovalSteps,
  pdtpExecutions,
  pdtpImportBatches,
  pdtpProgramTemplates,
  pdtpProgramTemplateVersions,
  pdtpPrograms,
  pdtpSheetActivities,
  pdtpSheets,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { pdtpActivityChecklistId } from "./checklist-domain"
import { computePdtpProgramContentDigest } from "./content-digest"
import { addPdtpChangeLogEntry, pdtpActivityId, pdtpScheduleId, pdtpSheetActivityId } from "./helpers"
import { PDTP_2026_INVARIANTS, PDTP_2026_REMOVED_ACTIVITIES, PDTP_2026_PROGRAM_SOURCE } from "@/lib/services/pdtp-adapters/contract-2026"
import { remapPdtpDateToYear } from "./retirement"

type QueryClient = Tx | typeof db
type SnapshotRecord = Record<string, unknown>
export const PDTP_BASE_2026_TEMPLATE_CODE = "base_preventiva_2026"

function slugify(value: string) {
  return value.trim().toLocaleLowerCase("es-CL").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80)
}

function records(value: unknown): SnapshotRecord[] {
  return Array.isArray(value) ? value.filter((item): item is SnapshotRecord => typeof item === "object" && item !== null) : []
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback
}

export async function createPdtpTemplateVersion(input: {
  sourceProgramId: string
  name: string
  description?: string
  userId: string
  skipIfUnchanged?: boolean
  /** Solo para publicar la Base 2026 normalizada sin inventar calendario para actividades sin P. */
  allowUnclassifiedBaseActivities?: boolean
}) {
  const name = input.name.trim()
  if (name.length < 3 || name.length > 200) throw new Error("El nombre de la plantilla debe tener entre 3 y 200 caracteres.")
  const code = slugify(name)
  if (!code) throw new Error("No se pudo generar un código válido para la plantilla.")

  return db.transaction(async (tx) => {
    const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, input.sourceProgramId)).limit(1)
    if (!program) throw new Error("Programa de origen no encontrado.")
    const [unclassified] = await tx.select({ id: pdtpActivities.id }).from(pdtpActivities)
      .where(and(
        eq(pdtpActivities.programId, program.id),
        eq(pdtpActivities.scheduleClassificationStatus, "needs_review"),
      )).limit(1)
    if (unclassified && !input.allowUnclassifiedBaseActivities) {
      throw new Error("No se puede publicar la plantilla mientras existan actividades sin modalidad confirmada.")
    }
    const { digest, snapshot } = await computePdtpProgramContentDigest(program.id, tx)
    const now = new Date().toISOString()
    let [template] = await tx.select().from(pdtpProgramTemplates).where(eq(pdtpProgramTemplates.code, code)).limit(1)
    if (!template) {
      [template] = await tx.insert(pdtpProgramTemplates).values({
        id: `pdtp-template-${code}-${nanoid(6)}`,
        code,
        name,
        description: input.description?.trim() || null,
        createdByUserId: input.userId,
        createdAt: now,
        updatedAt: now,
      }).returning()
    } else {
      [template] = await tx.update(pdtpProgramTemplates).set({
        name,
        description: input.description?.trim() || template.description,
        isActive: true,
        updatedAt: now,
      }).where(eq(pdtpProgramTemplates.id, template.id)).returning()
    }
    if (!template) throw new Error("No se pudo guardar la plantilla.")

    const [latest] = await tx.select()
      .from(pdtpProgramTemplateVersions)
      .where(eq(pdtpProgramTemplateVersions.templateId, template.id))
      .orderBy(desc(pdtpProgramTemplateVersions.version))
      .limit(1)
    if (input.skipIfUnchanged && latest?.contentDigest === digest) {
      return { template, version: latest, unchanged: true }
    }
    const version = (latest?.version ?? 0) + 1
    const [created] = await tx.insert(pdtpProgramTemplateVersions).values({
      id: `${template.id}-v${version}`,
      templateId: template.id,
      version,
      sourceProgramId: program.id,
      sourceContentVersion: program.contentVersion,
      contentDigest: digest,
      snapshotJson: snapshot,
      publishedByUserId: input.userId,
      publishedAt: now,
      createdAt: now,
    }).returning()
    if (!created) throw new Error("No se pudo publicar la versión de la plantilla.")
    await addPdtpChangeLogEntry(
      program.id,
      program.version,
      input.userId,
      "template:publish",
      null,
      { templateId: template.id, templateVersionId: created.id, digest },
      `Plantilla ${template.name} v${version} publicada desde este programa.`,
      tx,
    )
    return { template, version: created, unchanged: false }
  })
}

/**
 * Única puerta de publicación de la Base preventiva 2026. La revisión queda
 * vinculada a un lote XLSX aplicado y se rechaza si la normalización difiere
 * del contrato autoritativo.
 */
export async function publishPdtpBase2026Revision(input: {
  sourceProgramId: string
  sourceChecksumSha256: string
  userId: string
  allowNonOfficialRevision?: boolean
}) {
  const checksum = input.sourceChecksumSha256.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error("El checksum SHA-256 de la Base 2026 no es válido.")
  if (!input.allowNonOfficialRevision && checksum !== PDTP_2026_PROGRAM_SOURCE.sha256) {
    throw new Error("El checksum no corresponde a la fuente oficial congelada de la Base 2026.")
  }

  const [program] = await db.select({ id: pdtpPrograms.id, year: pdtpPrograms.year })
    .from(pdtpPrograms).where(eq(pdtpPrograms.id, input.sourceProgramId)).limit(1)
  if (!program || program.year !== 2026) throw new Error("La Base preventiva debe publicarse desde el programa 2026.")

  const activities = await db.select({ id: pdtpActivities.id, n: pdtpActivities.n, status: pdtpActivities.status })
    .from(pdtpActivities).where(eq(pdtpActivities.programId, program.id))
  const activityIds = activities.map((activity) => activity.id)
  const [scheduleCount, viewCount, executionCount, appliedBatch] = await Promise.all([
    activityIds.length > 0
      ? db.select({
          cells: sql<number>`count(*)::int`,
          quantity: sql<number>`COALESCE(sum(${pdtpActivitySchedule.plannedQuantity}), 0)::float`,
        }).from(pdtpActivitySchedule).where(inArray(pdtpActivitySchedule.activityId, activityIds))
      : Promise.resolve([{ cells: 0, quantity: 0 }]),
    db.select({ count: sql<number>`count(*)::int` }).from(pdtpSheets).where(eq(pdtpSheets.programId, program.id)),
    activityIds.length > 0
      ? db.select({ count: sql<number>`count(*)::int` }).from(pdtpExecutions).where(inArray(pdtpExecutions.activityId, activityIds))
      : Promise.resolve([{ count: 0 }]),
    db.select({ id: pdtpImportBatches.id }).from(pdtpImportBatches).where(and(
      eq(pdtpImportBatches.programId, program.id),
      eq(pdtpImportBatches.sourceChecksumSha256, checksum),
      eq(pdtpImportBatches.status, "applied"),
    )).limit(1),
  ])
  const expectedNumbers = Array.from({ length: 89 }, (_, index) => index + 1)
    .filter((n) => !PDTP_2026_REMOVED_ACTIVITIES.includes(n as 4 | 8))
  const actualNumbers = activities.map((activity) => activity.n).sort((a, b) => a - b)
  const actual = {
    activities: activities.length,
    activeActivities: activities.filter((activity) => activity.status === "active").length,
    activityNumbers: actualNumbers,
    views: viewCount[0]?.count ?? 0,
    plannedCells: scheduleCount[0]?.cells ?? 0,
    plannedQuantity: scheduleCount[0]?.quantity ?? 0,
    executions: executionCount[0]?.count ?? 0,
  }
  if (
    actual.activities !== PDTP_2026_INVARIANTS.activityCount
    || actual.activeActivities !== PDTP_2026_INVARIANTS.activityCount
    || JSON.stringify(actual.activityNumbers) !== JSON.stringify(expectedNumbers)
    || actual.views !== PDTP_2026_INVARIANTS.viewCount
    || actual.plannedCells !== PDTP_2026_INVARIANTS.plannedCellCount
    || actual.plannedQuantity !== PDTP_2026_INVARIANTS.plannedQuantityTotal
    || actual.executions !== 0
  ) {
    throw new Error(`La revisión no cumple el contrato de Base 2026: ${JSON.stringify(actual)}.`)
  }
  if (!appliedBatch[0]) {
    throw new Error("No existe un lote XLSX aplicado que respalde el checksum indicado.")
  }

  return createPdtpTemplateVersion({
    sourceProgramId: program.id,
    name: "Base preventiva 2026",
    description: `Revisión inmutable normalizada desde PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx. SHA-256: ${checksum}. Contiene solo planificación P y cero ejecuciones.`,
    userId: input.userId,
    skipIfUnchanged: true,
    allowUnclassifiedBaseActivities: true,
  })
}

export async function listActivePdtpTemplates() {
  const templates = await db.select().from(pdtpProgramTemplates)
    .where(eq(pdtpProgramTemplates.isActive, true))
    .orderBy(asc(pdtpProgramTemplates.name))
  const result = []
  for (const template of templates) {
    const [version] = await db.select().from(pdtpProgramTemplateVersions)
      .where(eq(pdtpProgramTemplateVersions.templateId, template.id))
      .orderBy(desc(pdtpProgramTemplateVersions.version))
      .limit(1)
    if (version) result.push({ ...template, currentVersion: version })
  }
  return result
}

export async function getCurrentPdtpBase2026Version(client: QueryClient = db) {
  const [template] = await client.select().from(pdtpProgramTemplates)
    .where(and(
      eq(pdtpProgramTemplates.code, PDTP_BASE_2026_TEMPLATE_CODE),
      eq(pdtpProgramTemplates.isActive, true),
    ))
    .limit(1)
  if (!template) return null
  const [version] = await client.select().from(pdtpProgramTemplateVersions)
    .where(eq(pdtpProgramTemplateVersions.templateId, template.id))
    .orderBy(desc(pdtpProgramTemplateVersions.version))
    .limit(1)
  return version ? { template, version } : null
}

/** Inventario auditable: todas las versiones publicadas y los programas que
 * fijaron cada una. Una versión nunca se actualiza en sitio. */
export async function listPdtpTemplatesWithVersions() {
  const [templates, versions, programs] = await Promise.all([
    db.select().from(pdtpProgramTemplates).orderBy(asc(pdtpProgramTemplates.name)),
    db.select().from(pdtpProgramTemplateVersions)
      .orderBy(asc(pdtpProgramTemplateVersions.templateId), desc(pdtpProgramTemplateVersions.version)),
    db.select({
      id: pdtpPrograms.id,
      title: pdtpPrograms.title,
      year: pdtpPrograms.year,
      version: pdtpPrograms.version,
      status: pdtpPrograms.status,
      sourceTemplateVersionId: pdtpPrograms.sourceTemplateVersionId,
    }).from(pdtpPrograms).where(isNotNull(pdtpPrograms.sourceTemplateVersionId)),
  ])

  return templates.map((template) => ({
    ...template,
    versions: versions
      .filter((version) => version.templateId === template.id)
      .map((version) => ({
        ...version,
        programs: programs.filter((program) => program.sourceTemplateVersionId === version.id),
      })),
  }))
}

export async function getPdtpTemplateVersion(versionId: string, client: QueryClient = db) {
  const [version] = await client.select().from(pdtpProgramTemplateVersions)
    .where(eq(pdtpProgramTemplateVersions.id, versionId)).limit(1)
  return version ?? null
}

/** Materializa una foto publicada; nunca consulta el programa fuente vivo. */
export async function instantiatePdtpTemplateVersion(input: {
  templateVersionId: string
  targetProgramId: string
  targetYear: number
  client: QueryClient
}) {
  const version = await getPdtpTemplateVersion(input.templateVersionId, input.client)
  if (!version) throw new Error("La versión de plantilla seleccionada no existe.")
  const snapshot = version.snapshotJson as SnapshotRecord
  const activities = records(snapshot.activities)
  const activityIdByNumber = new Map<number, string>()
  const now = new Date().toISOString()

  const approvalSteps = records(snapshot.approvalSteps)
  if (approvalSteps.length > 0) {
    await input.client.insert(pdtpApprovalSteps).values(approvalSteps.map((step, index) => {
      const code = stringValue(step.code, `paso_${index + 1}`)
      return {
        id: `${input.targetProgramId}-approval-${code}`,
        programId: input.targetProgramId,
        stepOrder: numberValue(step.stepOrder, index + 1),
        code,
        label: stringValue(step.label, `Paso ${index + 1}`),
        requiredPermission: stringValue(step.requiredPermission, "prevention:pdtp:approve"),
        isRequired: step.isRequired !== false,
        segregationRules: strings(step.segregationRules),
        createdAt: now,
        updatedAt: now,
      }
    }))
  }

  const views = records(snapshot.views)
  if (views.length > 0) {
    await input.client.insert(pdtpSheets).values(views.map((view) => {
      const code = stringValue(view.code)
      return {
        id: `${input.targetProgramId}-${code}`,
        code,
        programId: input.targetProgramId,
        label: stringValue(view.label, code),
        area: stringValue(view.area, "prevencion"),
        defaultScopeRoles: strings(view.defaultScopeRoles),
        isActive: view.isActive !== false,
      }
    }))
  }

  if (activities.length > 0) {
    await input.client.insert(pdtpActivities).values(activities.map((activity, index) => {
      const n = numberValue(activity.n, index + 1)
      const id = pdtpActivityId(input.targetProgramId, n)
      activityIdByNumber.set(n, id)
      return {
        id,
        programId: input.targetProgramId,
        n,
        catalogActivityId: typeof activity.catalogActivityId === "string" ? activity.catalogActivityId : null,
        catalogRevision: typeof activity.catalogRevision === "number" ? activity.catalogRevision : null,
        displayOrder: numberValue(activity.displayOrder, n),
        status: stringValue(activity.status, "active"),
        retiredReason: typeof activity.retiredReason === "string" ? activity.retiredReason : null,
        retiredEffectiveFrom: typeof activity.retiredEffectiveFrom === "string"
          ? remapPdtpDateToYear(activity.retiredEffectiveFrom, input.targetYear)
          : null,
        retiredByUserId: typeof activity.retiredByUserId === "string" ? activity.retiredByUserId : null,
        retiredAt: typeof activity.retiredAt === "string" ? activity.retiredAt : null,
        activity: stringValue(activity.activity, "Actividad"),
        program: stringValue(activity.program, "Gestión preventiva"),
        responsibleSlugs: strings(activity.responsibleSlugs),
        responsibleDisplay: stringValue(activity.responsibleDisplay, "Equipo de Prevención"),
        audienceRoles: strings(activity.audienceRoles),
        scheduleMode: stringValue(activity.scheduleMode, "scheduled"),
        scheduleClassificationStatus: stringValue(activity.scheduleClassificationStatus, "confirmed"),
        recurrenceRule: activity.recurrenceRule ?? null,
        triggerType: typeof activity.triggerType === "string" ? activity.triggerType : null,
        triggerDescription: typeof activity.triggerDescription === "string" ? activity.triggerDescription : null,
        dueDays: typeof activity.dueDays === "number" ? activity.dueDays : null,
        evidenceRequirement: typeof activity.evidenceRequirement === "string" ? activity.evidenceRequirement : null,
        indicatorMode: stringValue(activity.indicatorMode, "planned_vs_completed"),
        targetValue: typeof activity.targetValue === "number" ? activity.targetValue : null,
        targetUnit: typeof activity.targetUnit === "string" ? activity.targetUnit : null,
        sourceSheetRow: 0,
        notes: typeof activity.notes === "string" ? activity.notes : null,
        createdAt: now,
        updatedAt: now,
      }
    }))
  }

  const schedules = records(snapshot.schedules)
  if (schedules.length > 0) {
    await input.client.insert(pdtpActivitySchedule).values(schedules.flatMap((cell) => {
      const activityId = activityIdByNumber.get(numberValue(cell.activityNumber))
      if (!activityId) return []
      const month = numberValue(cell.month)
      const week = numberValue(cell.week)
      return [{
        id: pdtpScheduleId(activityId, input.targetYear, month, week),
        activityId,
        year: input.targetYear,
        month,
        week,
        plannedQuantity: numberValue(cell.plannedQuantity),
        sourceColumn: "template",
      }]
    }))
  }

  const memberships = records(snapshot.memberships)
  if (memberships.length > 0) {
    await input.client.insert(pdtpSheetActivities).values(memberships.flatMap((membership, index) => {
      const activityNumber = numberValue(membership.activityNumber)
      const activityId = activityIdByNumber.get(activityNumber)
      const viewCode = stringValue(membership.viewCode)
      if (!activityId || !viewCode) return []
      return [{
        id: pdtpSheetActivityId(input.targetProgramId, viewCode, activityNumber),
        sheetId: `${input.targetProgramId}-${viewCode}`,
        sheetCode: viewCode,
        activityId,
        sheetRow: numberValue(membership.sheetRow, index + 1),
        displayOrder: numberValue(membership.displayOrder, index + 1),
      }]
    }))
  }

  const checklists = records(snapshot.checklists)
  if (checklists.length > 0) {
    await input.client.insert(pdtpActivityChecklists).values(checklists.flatMap((checklist) => {
      const activityId = activityIdByNumber.get(numberValue(checklist.activityNumber))
      if (!activityId) return []
      const checklistVersion = stringValue(checklist.version, "01")
      return [{
        id: pdtpActivityChecklistId(activityId, checklistVersion),
        activityId,
        programId: input.targetProgramId,
        version: checklistVersion,
        label: stringValue(checklist.label, "Checklist"),
        definitionJson: checklist.definitionJson ?? {},
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }]
    }))
  }
  return version
}
