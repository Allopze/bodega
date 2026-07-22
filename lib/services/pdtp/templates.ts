import { and, asc, desc, eq, isNotNull } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpActivityChecklists,
  pdtpActivitySchedule,
  pdtpApprovalSteps,
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

type QueryClient = Tx | typeof db
type SnapshotRecord = Record<string, unknown>

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
    if (unclassified) throw new Error("No se puede publicar la plantilla mientras existan actividades sin modalidad confirmada.")
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
        objectiveOrder: numberValue(activity.objectiveOrder, 1),
        objective: stringValue(activity.objective, "Objetivo"),
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
