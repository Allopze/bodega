import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import { z } from "zod"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { db, type DB, type Tx } from "@/db"
import {
  preventionExposureAgents,
  preventionExposureGroupMembers,
  preventionExposureGroups,
  preventionExposureMeasurements,
  preventionHygieneMeasurementEvidence,
  preventionHygieneMeasurementSlots,
  preventionProtocolApplicabilities,
  preventionSurveillanceEnrollments,
  preventionSurveillancePrograms,
  workers,
  worksites,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import { recordModuleHistory } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { inferEvidenceContentType } from "@/lib/services/prevention-evidence-upload"
import { resolveHygieneEvidenceFile } from "@/lib/storage/config"
import { findMinsalProtocol, summarizeProtocolCoverage } from "@/lib/prevention/minsal-protocols"
import {
  onExposureMeasurementRecorded,
  onProtocolApplicabilityAssessed,
  onSurveillanceControlAttended,
  onSurveillanceControlReverted,
} from "@/lib/services/pdtp-adapters/hygiene-accreditation-connector"
import { propagateSlotStatusToPdtp, slotPdtpDeclaration } from "@/lib/services/pdtp-adapters/slot-deviation-connector"
import { HYGIENE_MEASUREMENT_PDTP_ACTIVITY_NUMBER } from "@/lib/prevention/program-slots-2026"
import { REASON_MAX_LENGTH, isValidReason, reasonRequiredMessage } from "@/lib/validation/reason-thresholds"
import { exposureMeasurementSchema, protocolApplicabilitySchema } from "@/lib/validation/prevention-module/hygiene"
import {
  assessMeasurement,
  deriveSurveillanceObligation,
  nextSurveillanceDate,
  summarizeExposureAnonymized,
} from "@/lib/prevention/hygiene"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"

type Client = DB | Tx

export interface HygieneAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

const NOT_FOUND = "Registro de higiene no encontrado o fuera de alcance."

function nowIso() {
  return new Date().toISOString()
}

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function requireAccess(access: HygieneAccess, permission: string, worksiteId?: string) {
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
  await recordModuleHistory(client, {
    module: "hygiene",
    entityType: args.entityType,
    entityId: args.entityId,
    worksiteId: args.worksiteId ?? null,
    changeType: args.changeType,
    reason: args.reason,
    beforeState: "beforeState" in args ? (args as { beforeState?: unknown }).beforeState : undefined,
    afterState: args.afterState,
    actorUserId: args.actorUserId ?? null,
  })
}

/* ── Agentes ──────────────────────────────────────────────────────────────── */

const agentSchema = z.object({
  code: z.string().trim().min(2).max(60),
  name: z.string().trim().min(3).max(200),
  agentType: z.enum(["chemical", "physical", "biological", "ergonomic", "psychosocial"]),
  unit: z.string().trim().min(1).max(40),
  permissibleLimit: z.number().positive().nullable().optional(),
  actionLevelFactor: z.number().positive().max(1).default(0.5),
  limitBasis: z.string().trim().min(5).max(2000),
  surveillanceProtocol: z.string().trim().max(200).nullable().optional(),
})

export async function createExposureAgent(input: unknown, access: HygieneAccess) {
  requireAccess(access, "prevention:hygiene:manage")
  const data = agentSchema.parse(input)
  const [created] = await db.insert(preventionExposureAgents).values({
    id: `expag-${nanoid()}`,
    code: data.code,
    name: data.name,
    agentType: data.agentType,
    unit: data.unit,
    permissibleLimit: data.permissibleLimit == null ? null : String(data.permissibleLimit),
    actionLevelFactor: String(data.actionLevelFactor),
    limitBasis: data.limitBasis,
    surveillanceProtocol: data.surveillanceProtocol ?? null,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo registrar el agente.")
  await history(db, { entityType: "agent", entityId: created.id, changeType: "created", reason: data.limitBasis, afterState: created, actorUserId: access.userId })
  return created
}

/* ── Grupos de exposición similar ─────────────────────────────────────────── */

const groupSchema = z.object({
  code: z.string().trim().min(2).max(60),
  name: z.string().trim().min(3).max(200),
  worksiteId: z.string().min(1),
  agentId: z.string().min(1),
  processDescription: z.string().trim().min(10).max(3000),
  riskEntryId: z.string().min(1).nullable().optional(),
})

export async function createExposureGroup(input: unknown, access: HygieneAccess) {
  const data = groupSchema.parse(input)
  requireAccess(access, "prevention:hygiene:assess", data.worksiteId)

  const [agent] = await db.select().from(preventionExposureAgents)
    .where(eq(preventionExposureAgents.id, data.agentId)).limit(1)
  if (!agent || !agent.isActive) throw new Error("El agente de exposición no existe o está inactivo.")

  const [created] = await db.insert(preventionExposureGroups).values({
    id: `expgr-${nanoid()}`,
    code: data.code,
    name: data.name,
    worksiteId: data.worksiteId,
    agentId: data.agentId,
    processDescription: data.processDescription,
    riskEntryId: data.riskEntryId ?? null,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo crear el grupo de exposición.")
  await history(db, { entityType: "group", entityId: created.id, worksiteId: data.worksiteId, changeType: "created", reason: `GES para ${agent.name}`, afterState: created, actorUserId: access.userId })
  return created
}

export async function addExposureGroupMember(input: unknown, access: HygieneAccess) {
  const data = z.object({
    groupId: z.string().min(1),
    workerId: z.string().min(1),
    joinedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).parse(input)

  return db.transaction(async (tx) => {
    const [group] = await tx.select().from(preventionExposureGroups)
      .where(eq(preventionExposureGroups.id, data.groupId)).limit(1)
    if (!group) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:hygiene:assess", group.worksiteId)

    const [worker] = await tx.select().from(workers).where(eq(workers.id, data.workerId)).limit(1)
    if (!worker || !worker.isActive) throw new Error("La persona no existe o está inactiva.")
    if (worker.worksiteId !== group.worksiteId) {
      throw new Error("El grupo de exposición pertenece a una faena: no admite personas de otra.")
    }

    const [created] = await tx.insert(preventionExposureGroupMembers).values({
      id: `expgm-${nanoid()}`,
      groupId: data.groupId,
      workerId: data.workerId,
      joinedOn: data.joinedOn,
    }).returning()
    if (!created) throw new Error("No se pudo incorporar a la persona al grupo.")
    return created
  })
}

/* ── Mediciones ───────────────────────────────────────────────────────────── */

/**
 * Registra una medición y recalcula la obligación de vigilancia del grupo.
 *
 * El límite y el nivel de acción se congelan en la fila: si el agente cambia
 * su límite después, la evidencia de esta medición sigue diciendo contra qué
 * se comparó.
 */
/**
 * Metadatos del informe ya escrito en disco.
 *
 * Se recalculan acá y no se reciben del formulario: el sha256 que devolvió la
 * subida pasa por el navegador antes de volver, así que no prueba nada sobre lo
 * que quedó almacenado. La ruta es lo único que viaja, y
 * `resolveHygieneEvidenceFile` la valida contra el traversal antes de tocar el
 * sistema de archivos.
 */
async function readHygieneEvidenceFromDisk(storagePath: string) {
  const absolutePath = resolveHygieneEvidenceFile(storagePath)
  if (!absolutePath) {
    throw new Error("La ruta del informe de laboratorio no es válida. Vuelve a subir el archivo.")
  }
  let buffer: Buffer
  try {
    buffer = await fs.readFile(absolutePath)
  } catch {
    throw new Error("No se encontró el informe de laboratorio subido. Vuelve a adjuntarlo.")
  }
  if (buffer.byteLength === 0) {
    throw new Error("El informe de laboratorio está vacío.")
  }
  /* El nombre almacenado se toma de la ruta relativa, no del absoluto: armar
   * rutas de almacenamiento con `node:path` está prohibido en el repo porque sin
   * el `turbopackIgnore` de `@/lib/storage/config` el build empaqueta el
   * repositorio entero, archivos subidos incluidos. */
  const storageName = storagePath.slice(storagePath.lastIndexOf("/") + 1)
  return {
    fileName: storageName,
    mimeType: inferEvidenceContentType(storageName),
    fileSizeBytes: buffer.byteLength,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  }
}

/* ── Casilla del programa: N°45 ───────────────────────────────────────────── */

/**
 * Cumple con esta medición la casilla N°45 del año de la faena, si queda una
 * sin cumplir. Devuelve la casilla cumplida, o `null` si no había ninguna.
 *
 * **Cuál medición la cumple: la primera del año.** El programa pide una
 * evaluación cuantitativa por faena y año; no hay un selector de casilla como
 * en simulacros porque no hay entre qué elegir. Las mediciones siguientes
 * existen sin casilla, igual que un simulacro extraordinario.
 *
 * **La evidencia gana.** También cumple una casilla declarada «no hecha» o «no
 * aplica»: la medición prueba que se hizo. Es el mismo criterio del motor de
 * acreditación, que al acreditar la celda retira el desvío que la casilla había
 * propagado (`accreditation.ts`, `withdrawDeviationForAccreditedCell`); dejar
 * la casilla en «no aplica» mientras el PDTP ya la cuenta ejecutada haría que
 * los dos lados dijeran cosas distintas.
 *
 * `FOR UPDATE` porque dos mediciones de GES distintos de la misma faena no se
 * serializan por el candado del grupo: sin él las dos podrían tomar la casilla.
 */
async function fulfillHygieneMeasurementSlotTx(tx: Tx, args: {
  worksiteId: string
  year: number
  measurementId: string
  userId: string
}) {
  const [open] = await tx.select().from(preventionHygieneMeasurementSlots)
    .where(and(
      eq(preventionHygieneMeasurementSlots.worksiteId, args.worksiteId),
      eq(preventionHygieneMeasurementSlots.year, args.year),
      ne(preventionHygieneMeasurementSlots.status, "completed"),
    ))
    .orderBy(asc(preventionHygieneMeasurementSlots.scheduledMonth), asc(preventionHygieneMeasurementSlots.scheduledWeek))
    .for("update")
    .limit(1)
  if (!open) return null

  const now = nowIso()
  const [filled] = await tx.update(preventionHygieneMeasurementSlots).set({
    status: "completed",
    measurementId: args.measurementId,
    completedAt: now,
    completedByUserId: args.userId,
    notApplicableAt: null,
    notApplicableByUserId: null,
    notApplicableReason: null,
    version: open.version + 1,
    updatedAt: now,
  }).where(and(
    eq(preventionHygieneMeasurementSlots.id, open.id),
    eq(preventionHygieneMeasurementSlots.version, open.version),
  )).returning()
  if (!filled) return null

  await history(tx, {
    entityType: "measurement_slot",
    entityId: open.id,
    worksiteId: open.worksiteId,
    changeType: "completed",
    reason: `Casilla ${open.slotKey} cumplida por la medición ${args.measurementId}.`,
    beforeState: open,
    afterState: filled,
    actorUserId: args.userId,
  })
  return filled
}

const measurementSlotStatusSchema = z.object({
  slotId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  status: z.enum(["not_completed", "not_applicable"]),
  observation: z.string().trim().max(3000).nullable().optional(),
  notApplicableReason: z.string().trim().max(REASON_MAX_LENGTH).nullable().optional(),
})

/**
 * Declara la casilla N°45 de una faena como no hecha o no aplicable, y lo
 * refleja en la celda de la N°45 del PDTP en la misma transacción
 * (`slot-deviation-connector.ts`).
 *
 * El permiso es el del hecho —`prevention:hygiene:measure`, el mismo que
 * registra la medición—, como en las demás familias de casillas: quien puede
 * cumplirla es quien puede decir por qué no se cumplió.
 */
export async function recordHygieneMeasurementSlotStatus(input: unknown, access: HygieneAccess) {
  const data = measurementSlotStatusSchema.parse(input)
  const notApplicableReason = data.status === "not_applicable" ? (data.notApplicableReason?.trim() || null) : null
  // Error plano y no un refinamiento de zod: el mensaje de un `ZodError` no
  // llega a la pantalla (`safeActionMessage`), y éste es el que el usuario
  // necesita leer.
  if (data.status === "not_applicable" && !isValidReason(notApplicableReason)) {
    throw new Error(`${reasonRequiredMessage("por qué la evaluación cuantitativa no aplica en esta faena")}.`)
  }

  return db.transaction(async (tx) => {
    const [slot] = await tx.select().from(preventionHygieneMeasurementSlots)
      .where(eq(preventionHygieneMeasurementSlots.id, data.slotId))
      .for("update")
      .limit(1)
    if (!slot) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:hygiene:measure", slot.worksiteId)
    if (slot.version !== data.expectedVersion) {
      throw new Error("La casilla cambió mientras la editabas. Recarga y vuelve a intentarlo.")
    }
    if (slot.status === data.status) throw new Error("La casilla ya tiene ese estado.")
    /* Una casilla cumplida no se corrige acá: el hecho es la medición, y esta
     * vía permitiría apagar el cumplimiento sin tocar el hecho. */
    if (slot.status === "completed") {
      throw new Error("La casilla está cumplida por una medición: no se puede declarar no hecha ni no aplicable.")
    }

    const now = nowIso()
    const [updated] = await tx.update(preventionHygieneMeasurementSlots).set({
      status: data.status,
      notApplicableAt: data.status === "not_applicable" ? now : null,
      notApplicableByUserId: data.status === "not_applicable" ? access.userId : null,
      notApplicableReason,
      observation: data.observation?.trim() || null,
      version: slot.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionHygieneMeasurementSlots.id, slot.id),
      eq(preventionHygieneMeasurementSlots.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La casilla cambió mientras la editabas. Recarga y vuelve a intentarlo.")

    await history(tx, {
      entityType: "measurement_slot",
      entityId: slot.id,
      worksiteId: slot.worksiteId,
      changeType: "status_changed",
      reason: data.status === "not_applicable"
        ? `Casilla declarada no aplicable: ${notApplicableReason}`
        : "Casilla marcada como no hecha.",
      beforeState: slot,
      afterState: updated,
      actorUserId: access.userId,
    })

    const label = `de evaluación cuantitativa ${slot.slotKey}`
    await propagateSlotStatusToPdtp(tx, {
      source: { module: "higiene", slotId: slot.id, label },
      worksiteId: slot.worksiteId,
      cell: { year: slot.year, month: slot.scheduledMonth, week: slot.scheduledWeek },
      activities: { activityNumbers: [HYGIENE_MEASUREMENT_PDTP_ACTIVITY_NUMBER] },
      next: slotPdtpDeclaration(updated, label),
      previous: slotPdtpDeclaration(slot, label),
      userId: access.userId,
    })
    return updated
  })
}

/**
 * Las casillas N°45 del año de las faenas visibles, con el GES y la fecha de la
 * medición que las cumplió, para la pantalla.
 */
export async function listHygieneMeasurementSlots(access: HygieneAccess, year: number) {
  requireAccess(access, "prevention:hygiene:view")
  return db.select({
    slot: preventionHygieneMeasurementSlots,
    measuredOn: preventionExposureMeasurements.measuredOn,
    groupCode: preventionExposureGroups.code,
  })
    .from(preventionHygieneMeasurementSlots)
    .leftJoin(preventionExposureMeasurements, eq(preventionExposureMeasurements.id, preventionHygieneMeasurementSlots.measurementId))
    .leftJoin(preventionExposureGroups, eq(preventionExposureGroups.id, preventionExposureMeasurements.groupId))
    .where(and(
      eq(preventionHygieneMeasurementSlots.year, year),
      scopeCondition(access.scope, preventionHygieneMeasurementSlots.worksiteId),
    ))
    .orderBy(asc(preventionHygieneMeasurementSlots.scheduledMonth), asc(preventionHygieneMeasurementSlots.scheduledWeek))
}

export async function recordExposureMeasurement(input: unknown, access: HygieneAccess) {
  const data = exposureMeasurementSchema.parse(input)

  /* El informe se lee del disco y se le calcula el sha256 acá: lo único que
   * viaja desde el cliente es la ruta, y esa la valida `resolveHygieneEvidenceFile`
   * contra el traversal. Confiar en un checksum que dio la vuelta por el
   * navegador sería firmar por un archivo que nadie volvió a mirar. */
  const evidence = await readHygieneEvidenceFromDisk(data.evidencePath)

  let accreditation: Parameters<typeof onExposureMeasurementRecorded>[0] | null = null
  const result = await db.transaction(async (tx) => {
    // `FOR UPDATE` sobre el GES: la obligación de vigilancia se deriva del
    // historial COMPLETO de mediciones, así que dos registros concurrentes
    // recalculaban cada uno sin ver la medición del otro. Con una medición
    // sobre el límite y otra bajo el nivel de acción, el que commiteaba
    // segundo dejaba el grupo con `surveillanceRequired = false` pese a estar
    // sobre el LPP. Serializar por grupo es lo único que cierra esa ventana;
    // mover el `version` a SQL arreglaría el contador, no el recálculo.
    const [row] = await tx.select({ group: preventionExposureGroups, agent: preventionExposureAgents })
      .from(preventionExposureGroups)
      .innerJoin(preventionExposureAgents, eq(preventionExposureGroups.agentId, preventionExposureAgents.id))
      .where(eq(preventionExposureGroups.id, data.groupId))
      .for("update", { of: preventionExposureGroups })
      .limit(1)
    if (!row) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:hygiene:measure", row.group.worksiteId)

    const permissibleLimit = row.agent.permissibleLimit === null ? null : Number(row.agent.permissibleLimit)
    const assessment = assessMeasurement(data.value, {
      permissibleLimit,
      actionLevelFactor: Number(row.agent.actionLevelFactor),
    })

    const [created] = await tx.insert(preventionExposureMeasurements).values({
      id: `expms-${nanoid()}`,
      groupId: data.groupId,
      measuredOn: data.measuredOn,
      value: String(data.value),
      unit: row.agent.unit,
      permissibleLimitSnapshot: permissibleLimit === null ? null : String(permissibleLimit),
      actionLevelSnapshot: assessment.actionLevel === null ? null : String(assessment.actionLevel),
      outcome: assessment.outcome,
      method: data.method,
      laboratoryName: data.laboratoryName ?? null,
      equipmentTag: data.equipmentTag,
      calibrationDate: data.calibrationDate ?? null,
      sampleDurationMinutes: data.sampleDurationMinutes ?? null,
      reportReference: data.reportReference ?? null,
      recordedByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo registrar la medición.")

    await tx.insert(preventionHygieneMeasurementEvidence).values({
      id: `hmev-${nanoid()}`,
      measurementId: created.id,
      fileName: evidence.fileName,
      storagePath: data.evidencePath,
      mimeType: evidence.mimeType,
      fileSizeBytes: evidence.fileSizeBytes,
      sha256: evidence.sha256,
      state: "active",
      uploadedByUserId: access.userId,
    })

    /* La casilla de la N°45 se cumple en la misma transacción que la medición:
     * si el registro se revierte, la casilla no puede quedar en verde sin hecho.
     * El informe ya se exigió arriba como archivo real, así que no hay casilla
     * cumplida sin documento. */
    const slot = await fulfillHygieneMeasurementSlotTx(tx, {
      worksiteId: row.group.worksiteId,
      year: Number(data.measuredOn.slice(0, 4)),
      measurementId: created.id,
      userId: access.userId,
    })

    // La obligación de vigilancia se recalcula con todo el historial, no sólo
    // con la medición recién ingresada.
    const measurements = await tx.select({ measuredOn: preventionExposureMeasurements.measuredOn, outcome: preventionExposureMeasurements.outcome })
      .from(preventionExposureMeasurements)
      .where(eq(preventionExposureMeasurements.groupId, data.groupId))
    const obligation = deriveSurveillanceObligation(measurements)

    const now = nowIso()
    await tx.update(preventionExposureGroups).set({
      surveillanceRequired: obligation.required,
      surveillanceReason: obligation.required ? obligation.basis : null,
      version: row.group.version + 1,
      updatedAt: now,
    }).where(eq(preventionExposureGroups.id, data.groupId))

    await history(tx, {
      entityType: "measurement", entityId: created.id, worksiteId: row.group.worksiteId,
      changeType: assessment.outcome,
      reason: `${data.value} ${row.agent.unit} · ${obligation.basis}`,
      afterState: created, actorUserId: access.userId,
    })

    // N°45 del PDTP ("Evaluación cuantitativas por mutual"). Se prepara aquí y
    // se dispara DESPUÉS del commit: el motor escribe con su propia conexión,
    // así que llamarlo dentro dejaría una ejecución PDTP huérfana si la
    // transacción revierte.
    accreditation = {
      measurementId: created.id,
      worksiteId: row.group.worksiteId,
      groupCode: row.group.code,
      agentCode: row.agent.code,
      outcome: assessment.outcome,
      measuredOn: data.measuredOn,
      reportReference: created.reportReference,
      evidencePath: data.evidencePath,
      /* La celda que se acredita es la que la casilla ya tenía planificada, no
       * la del mes en que llegó el informe: una evaluación hecha en junio no
       * debe pagar un junio que el programa no planificó mientras febrero
       * sigue en cero. Sin casilla —la segunda medición del año— se acredita
       * por su fecha, como antes. */
      ...(slot ? { plannedPeriod: { year: slot.year, month: slot.scheduledMonth, week: slot.scheduledWeek } } : {}),
    }

    return { measurement: created, assessment, surveillanceRequired: obligation.required, basis: obligation.basis }
  })

  // `safeAccredit` absorbe los errores (programa inactivo, actividad excluida)
  // sin afectar la medición ya registrada.
  if (accreditation) await onExposureMeasurementRecorded(accreditation)
  return result
}

/* ── Vigilancia ───────────────────────────────────────────────────────────── */

const programSchema = z.object({
  code: z.string().trim().min(2).max(60),
  name: z.string().trim().min(3).max(200),
  protocol: z.string().trim().min(2).max(120),
  agentId: z.string().min(1).nullable().optional(),
  worksiteId: z.string().min(1),
  periodicityMonths: z.number().int().positive().max(120),
  legalBasis: z.string().trim().min(5).max(2000),
})

export async function createSurveillanceProgram(input: unknown, access: HygieneAccess) {
  const data = programSchema.parse(input)
  requireAccess(access, "prevention:hygiene:assess", data.worksiteId)

  const [created] = await db.insert(preventionSurveillancePrograms).values({
    id: `survpr-${nanoid()}`,
    code: data.code,
    name: data.name,
    protocol: data.protocol,
    agentId: data.agentId ?? null,
    worksiteId: data.worksiteId,
    periodicityMonths: data.periodicityMonths,
    legalBasis: data.legalBasis,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo crear el programa de vigilancia.")
  await history(db, { entityType: "program", entityId: created.id, worksiteId: data.worksiteId, changeType: "created", reason: data.legalBasis, afterState: created, actorUserId: access.userId })
  return created
}

/**
 * Matricula al grupo completo en el programa. La nómina se deriva de la
 * pertenencia al GES y no se arma a mano: eso es lo que impide que alguien
 * expuesto quede fuera de la vigilancia por olvido.
 */
export async function enrollGroupInSurveillance(input: unknown, access: HygieneAccess) {
  const data = z.object({
    programId: z.string().min(1),
    groupId: z.string().min(1),
    startingOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).parse(input)

  return db.transaction(async (tx) => {
    const [program] = await tx.select().from(preventionSurveillancePrograms)
      .where(eq(preventionSurveillancePrograms.id, data.programId)).limit(1)
    if (!program) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:hygiene:assess", program.worksiteId)
    if (program.status !== "active") throw new Error("Sólo un programa vigente admite matrículas.")

    const [group] = await tx.select().from(preventionExposureGroups)
      .where(eq(preventionExposureGroups.id, data.groupId)).limit(1)
    if (!group) throw new Error(NOT_FOUND)
    if (group.worksiteId !== program.worksiteId) {
      throw new Error("El grupo y el programa pertenecen a faenas distintas.")
    }

    const members = await tx.select().from(preventionExposureGroupMembers)
      .where(and(
        eq(preventionExposureGroupMembers.groupId, data.groupId),
        isNull(preventionExposureGroupMembers.leftOn),
      ))
    if (members.length === 0) throw new Error("El grupo no tiene personas activas que matricular.")

    /* Quien ya tiene un ciclo abierto en el programa no se vuelve a matricular.
     * Desde que registrar la asistencia abre el ciclo siguiente solo
     * (`recordSurveillanceOutcome`), matricular el grupo otra vez —que era la
     * única forma de hacerlo— le abriría a esa persona un segundo ciclo con otro
     * vencimiento. Sí entra quien está eximido o ausente: su ciclo ya se cerró,
     * y matricular es justamente cómo vuelve al programa. */
    const openCycles = await tx.select({ workerId: preventionSurveillanceEnrollments.workerId })
      .from(preventionSurveillanceEnrollments)
      .where(and(
        eq(preventionSurveillanceEnrollments.programId, data.programId),
        inArray(preventionSurveillanceEnrollments.workerId, members.map((member) => member.workerId)),
        inArray(preventionSurveillanceEnrollments.status, ["pending", "summoned"]),
      ))
    const withOpenCycle = new Set(openCycles.map((row) => row.workerId))
    const toEnroll = members.filter((member) => !withOpenCycle.has(member.workerId))

    const enrolledOn = data.startingOn ?? todayInChile()
    const dueOn = nextSurveillanceDate(enrolledOn, program.periodicityMonths)
    const result = toEnroll.length === 0 ? [] : await tx.insert(preventionSurveillanceEnrollments).values(toEnroll.map((member) => ({
      id: `surven-${nanoid()}`,
      programId: data.programId,
      workerId: member.workerId,
      groupId: data.groupId,
      enrolledOn,
      dueOn,
    }))).onConflictDoNothing().returning()
    const created = result.length

    await history(tx, { entityType: "program", entityId: data.programId, worksiteId: program.worksiteId, changeType: "enrolled", reason: `${created} persona(s) matriculadas desde el GES ${group.code}`, actorUserId: access.userId })
    return { enrolled: created, total: members.length, dueOn }
  })
}

/**
 * Mantiene el ciclo siguiente de una matrícula en línea con su estado recién
 * registrado. Devuelve lo que retiró y lo que abrió, para el historial.
 *
 * **Por qué existe.** `nextSurveillanceDate` sólo se calculaba al matricular el
 * grupo: una vez que el control quedaba `attended`, nadie abría el ciclo
 * siguiente hasta que alguien volviera a matricular a mano, y mientras tanto la
 * persona desaparecía de los vencimientos. Ahora el cierre del ciclo abre el
 * siguiente con el mismo INSERT que hace `enrollGroupInSurveillance` —mismo
 * índice único `(programa, persona, vencimiento)`, mismo `onConflictDoNothing`—,
 * con el vencimiento contado desde el control y no desde la matrícula.
 *
 * **Qué retira.** Lo que esta matrícula abrió y ya no corresponde: si dejó de
 * estar asistida (se corrigió a ausente, exento o citado), o si se corrigió la
 * fecha del control y el vencimiento cambió. Sólo lo intacto —`pending`, sin
 * citación, sin control y sin registro de salud—: un ciclo siguiente en el que
 * alguien ya trabajó es un hecho propio, y borrarlo por corregir el anterior
 * perdería esa gestión. Se reconoce por `renewedFromEnrollmentId`, no por fecha,
 * para no llevarse una matrícula que alguien creó a mano con el mismo
 * vencimiento.
 *
 * **Cuándo no abre nada.** Programa no vigente (tampoco admite matrículas),
 * persona inactiva o que ya salió del GES de origen (ya no está expuesta por
 * él), o persona que ya tiene otro ciclo en curso: un ciclo siguiente que ya
 * avanzó o uno abierto en el programa por otra vía. Nunca dos ciclos abiertos a
 * la vez para la misma persona y programa.
 */
/**
 * Vencimiento del ciclo que abre un control asistido: una periodicidad después
 * del control, o `null` si la matrícula no está asistida.
 *
 * Un caso se corre un día. Si el control se registra el mismo día de la
 * matrícula, el ciclo siguiente vencería exactamente cuando vencía éste —ambos
 * cuentan una periodicidad desde el mismo día—, y el índice único (programa,
 * persona, vencimiento) descartaría la renovación en silencio: la persona
 * quedaría sin ciclo abierto, justo lo que la renovación existe para evitar. Un
 * día sobre una periodicidad de meses no cambia la exigencia.
 */
function nextCycleDueOn(enrollment: typeof preventionSurveillanceEnrollments.$inferSelect, periodicityMonths: number) {
  if (enrollment.status !== "attended" || !enrollment.attendedOn) return null
  const dueOn = nextSurveillanceDate(enrollment.attendedOn, periodicityMonths)
  return dueOn === enrollment.dueOn ? addDaysToPlainDate(dueOn, 1) : dueOn
}

async function syncSurveillanceRenewalTx(tx: Tx, args: {
  enrollment: typeof preventionSurveillanceEnrollments.$inferSelect
  program: typeof preventionSurveillancePrograms.$inferSelect
}) {
  const { enrollment, program } = args
  const nextDueOn = nextCycleDueOn(enrollment, program.periodicityMonths)

  const retired = await tx.delete(preventionSurveillanceEnrollments).where(and(
    eq(preventionSurveillanceEnrollments.renewedFromEnrollmentId, enrollment.id),
    eq(preventionSurveillanceEnrollments.status, "pending"),
    isNull(preventionSurveillanceEnrollments.summonedAt),
    isNull(preventionSurveillanceEnrollments.attendedOn),
    isNull(preventionSurveillanceEnrollments.healthRecordId),
    nextDueOn ? ne(preventionSurveillanceEnrollments.dueOn, nextDueOn) : undefined,
  )).returning()

  if (!nextDueOn || program.status !== "active" || !enrollment.groupId) return { retired, created: null }

  const [exposure] = await tx.select({ memberId: preventionExposureGroupMembers.id })
    .from(preventionExposureGroupMembers)
    .innerJoin(workers, eq(workers.id, preventionExposureGroupMembers.workerId))
    .where(and(
      eq(preventionExposureGroupMembers.groupId, enrollment.groupId),
      eq(preventionExposureGroupMembers.workerId, enrollment.workerId),
      isNull(preventionExposureGroupMembers.leftOn),
      eq(workers.isActive, true),
    ))
    .limit(1)
  if (!exposure) return { retired, created: null }

  const [cycleUnderway] = await tx.select({ id: preventionSurveillanceEnrollments.id })
    .from(preventionSurveillanceEnrollments)
    .where(and(
      eq(preventionSurveillanceEnrollments.programId, enrollment.programId),
      eq(preventionSurveillanceEnrollments.workerId, enrollment.workerId),
      ne(preventionSurveillanceEnrollments.id, enrollment.id),
      ne(preventionSurveillanceEnrollments.dueOn, nextDueOn),
      sql`(${preventionSurveillanceEnrollments.renewedFromEnrollmentId} = ${enrollment.id} OR ${preventionSurveillanceEnrollments.status} IN ('pending', 'summoned'))`,
    ))
    .limit(1)
  if (cycleUnderway) return { retired, created: null }

  const [created] = await tx.insert(preventionSurveillanceEnrollments).values({
    id: `surven-${nanoid()}`,
    programId: enrollment.programId,
    workerId: enrollment.workerId,
    groupId: enrollment.groupId,
    enrolledOn: enrollment.attendedOn!,
    dueOn: nextDueOn,
    renewedFromEnrollmentId: enrollment.id,
  }).onConflictDoNothing().returning()
  return { retired, created: created ?? null }
}

/**
 * Registra el resultado del control. El dato clínico no se guarda aquí: se
 * enlaza al registro de salud cifrado que ya existe en el dominio sensible.
 *
 * Asistir abre el ciclo siguiente; corregir una asistencia retira el ciclo que
 * había abierto si nadie lo tocó (`syncSurveillanceRenewalTx`).
 */
export async function recordSurveillanceOutcome(input: unknown, access: HygieneAccess) {
  const data = z.object({
    enrollmentId: z.string().min(1),
    status: z.enum(["summoned", "attended", "absent", "exempt"]),
    attendedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    healthRecordId: z.string().min(1).nullable().optional(),
    absenceReason: z.string().trim().max(REASON_MAX_LENGTH).nullable().optional(),
  }).parse(input)

  let accreditation: Parameters<typeof onSurveillanceControlAttended>[0] | null = null
  let revocation: Parameters<typeof onSurveillanceControlReverted>[0] | null = null
  const result = await db.transaction(async (tx) => {
    // `FOR UPDATE` sobre la matrícula: el ciclo siguiente se abre y se retira
    // mirando su estado, y dos registros concurrentes de la misma persona no
    // pueden decidirlo cada uno sobre una foto distinta.
    const [row] = await tx.select({ enrollment: preventionSurveillanceEnrollments, program: preventionSurveillancePrograms })
      .from(preventionSurveillanceEnrollments)
      .innerJoin(preventionSurveillancePrograms, eq(preventionSurveillanceEnrollments.programId, preventionSurveillancePrograms.id))
      .where(eq(preventionSurveillanceEnrollments.id, data.enrollmentId))
      .for("update", { of: preventionSurveillanceEnrollments })
      .limit(1)
    if (!row) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:hygiene:assess", row.program.worksiteId)

    if (data.status === "attended" && !data.attendedOn) {
      throw new Error("Registrar asistencia exige la fecha del control.")
    }
    if (data.status === "absent" && (data.absenceReason?.trim().length ?? 0) < 5) {
      throw new Error("Registrar una ausencia exige indicar el motivo.")
    }
    /* Eximir saca a la persona del padrón de expuestos de la N°50
     * (`subject-registry.ts`): sin motivo, la cobertura se podría subir
     * eximiendo. Diez caracteres y no los cinco de la ausencia: una exención se
     * parece más a un «no aplica» que a un «no vino». */
    if (data.status === "exempt" && !isValidReason(data.absenceReason)) {
      throw new Error(`${reasonRequiredMessage("por qué se exime a la persona de este control")}.`)
    }

    const now = nowIso()
    const [updated] = await tx.update(preventionSurveillanceEnrollments).set({
      status: data.status,
      summonedAt: data.status === "summoned" ? now : row.enrollment.summonedAt,
      attendedOn: data.attendedOn ?? row.enrollment.attendedOn,
      healthRecordId: data.healthRecordId ?? row.enrollment.healthRecordId,
      absenceReason: data.status === "absent" || data.status === "exempt" ? data.absenceReason?.trim() || null : null,
      updatedAt: now,
    }).where(eq(preventionSurveillanceEnrollments.id, data.enrollmentId)).returning()
    if (!updated) throw new Error("No se pudo registrar el resultado.")
    await history(tx, { entityType: "enrollment", entityId: data.enrollmentId, worksiteId: row.program.worksiteId, changeType: data.status, reason: data.absenceReason ?? `Control ${data.status}`, actorUserId: access.userId })

    const renewal = await syncSurveillanceRenewalTx(tx, { enrollment: updated, program: row.program })
    for (const withdrawn of renewal.retired) {
      await history(tx, {
        entityType: "enrollment", entityId: withdrawn.id, worksiteId: row.program.worksiteId,
        changeType: "renewal_withdrawn",
        reason: `Ciclo con vencimiento ${withdrawn.dueOn} retirado: el control que lo abrió ahora es ${data.status}${updated.attendedOn && data.status === "attended" ? ` del ${updated.attendedOn}` : ""}.`,
        beforeState: withdrawn, actorUserId: access.userId,
      })
    }
    if (renewal.created) {
      await history(tx, {
        entityType: "enrollment", entityId: renewal.created.id, worksiteId: row.program.worksiteId,
        changeType: "renewed",
        reason: `Ciclo siguiente abierto por el control del ${updated.attendedOn}: vence ${renewal.created.dueOn}.`,
        afterState: renewal.created, actorUserId: access.userId,
      })
    }

    // N°50 del PDTP, una ejecución por persona controlada. El evento es
    // bidireccional: corregir un `attended` a `absent` retira el control que
    // sostenía la cobertura, así que hay que devolver la ejecución al programa.
    if (data.status === "attended" && updated.attendedOn) {
      accreditation = {
        enrollmentId: updated.id,
        worksiteId: row.program.worksiteId,
        surveillanceProgramId: row.program.id,
        protocol: row.program.protocol,
        workerId: row.enrollment.workerId,
        groupId: row.enrollment.groupId,
        attendedOn: updated.attendedOn,
      }
    } else if (row.enrollment.status === "attended") {
      revocation = {
        enrollmentId: updated.id,
        worksiteId: row.program.worksiteId,
        revokedBy: access.userId,
        reason: `El control de vigilancia dejó de estar asistido: ahora es ${data.status}.`,
      }
    }

    return updated
  })

  if (accreditation) await onSurveillanceControlAttended(accreditation)
  if (revocation) await onSurveillanceControlReverted(revocation)
  return result
}

/* ── Consultas ────────────────────────────────────────────────────────────── */

export async function listExposureGroups(access: HygieneAccess) {
  requireAccess(access, "prevention:hygiene:view")
  return db.select({
    group: preventionExposureGroups,
    agentName: preventionExposureAgents.name,
    agentType: preventionExposureAgents.agentType,
    agentUnit: preventionExposureAgents.unit,
    worksiteName: worksites.name,
    memberCount: sql<number>`(SELECT COUNT(*)::int FROM prevention_exposure_group_members m WHERE m.group_id = ${preventionExposureGroups.id} AND m.left_on IS NULL)`,
    measurementCount: sql<number>`(SELECT COUNT(*)::int FROM prevention_exposure_measurements x WHERE x.group_id = ${preventionExposureGroups.id})`,
    latestOutcome: sql<string | null>`(SELECT x.outcome FROM prevention_exposure_measurements x WHERE x.group_id = ${preventionExposureGroups.id} ORDER BY x.measured_on DESC LIMIT 1)`,
  })
    .from(preventionExposureGroups)
    .innerJoin(preventionExposureAgents, eq(preventionExposureGroups.agentId, preventionExposureAgents.id))
    .innerJoin(worksites, eq(preventionExposureGroups.worksiteId, worksites.id))
    .where(scopeCondition(access.scope, preventionExposureGroups.worksiteId))
    .orderBy(asc(preventionExposureGroups.code))
}

/**
 * Panel anonimizado de exposición y cobertura de vigilancia. Nunca devuelve
 * personas: es la vista que puede compartirse con jefatura y con el CPHS.
 */
export async function getAnonymizedExposureSummary(access: HygieneAccess) {
  requireAccess(access, "prevention:hygiene:view")
  const rows = await db.select({
    groupId: preventionExposureGroups.id,
    groupName: preventionExposureGroups.name,
    agentName: preventionExposureAgents.name,
    exposedCount: sql<number>`(SELECT COUNT(*)::int FROM prevention_exposure_group_members m WHERE m.group_id = ${preventionExposureGroups.id} AND m.left_on IS NULL)`,
    // Personas y no matrículas: con el ciclo siguiente abierto al asistir, una
    // persona controlada dos años seguidos no puede contar dos veces contra un
    // solo expuesto.
    attendedCount: sql<number>`(SELECT COUNT(DISTINCT e.worker_id)::int FROM prevention_surveillance_enrollments e WHERE e.group_id = ${preventionExposureGroups.id} AND e.status = 'attended')`,
    latestOutcome: sql<string | null>`(SELECT x.outcome FROM prevention_exposure_measurements x WHERE x.group_id = ${preventionExposureGroups.id} ORDER BY x.measured_on DESC LIMIT 1)`,
  })
    .from(preventionExposureGroups)
    .innerJoin(preventionExposureAgents, eq(preventionExposureGroups.agentId, preventionExposureAgents.id))
    .where(and(
      eq(preventionExposureGroups.isActive, true),
      scopeCondition(access.scope, preventionExposureGroups.worksiteId),
    ))
  return summarizeExposureAnonymized(rows)
}

/**
 * Programas de vigilancia con su cobertura.
 *
 * `enrolled` y `attended` cuentan **personas**, no matrículas: cada control
 * asistido abre el ciclo siguiente (`recordSurveillanceOutcome`), así que contar
 * filas haría caer la cobertura a la mitad en cuanto todos se controlan. El
 * vencido sí cuenta ciclos, porque cada uno es un control que falta.
 */
export async function listSurveillancePrograms(access: HygieneAccess) {
  requireAccess(access, "prevention:hygiene:view")
  return db.select({
    program: preventionSurveillancePrograms,
    worksiteName: worksites.name,
    agentName: preventionExposureAgents.name,
    enrolled: sql<number>`(SELECT COUNT(DISTINCT e.worker_id)::int FROM prevention_surveillance_enrollments e WHERE e.program_id = ${preventionSurveillancePrograms.id})`,
    attended: sql<number>`(SELECT COUNT(DISTINCT e.worker_id)::int FROM prevention_surveillance_enrollments e WHERE e.program_id = ${preventionSurveillancePrograms.id} AND e.status = 'attended')`,
    overdue: sql<number>`(SELECT COUNT(*)::int FROM prevention_surveillance_enrollments e WHERE e.program_id = ${preventionSurveillancePrograms.id} AND e.status IN ('pending','summoned') AND e.due_on < ${todayInChile()})`,
  })
    .from(preventionSurveillancePrograms)
    .innerJoin(worksites, eq(preventionSurveillancePrograms.worksiteId, worksites.id))
    .leftJoin(preventionExposureAgents, eq(preventionSurveillancePrograms.agentId, preventionExposureAgents.id))
    .where(scopeCondition(access.scope, preventionSurveillancePrograms.worksiteId))
    .orderBy(asc(preventionSurveillancePrograms.code))
}

export async function listExposureAgents(access: HygieneAccess) {
  requireAccess(access, "prevention:hygiene:view")
  return db.select().from(preventionExposureAgents).orderBy(asc(preventionExposureAgents.code))
}

export async function listGroupMeasurements(groupId: string, access: HygieneAccess) {
  requireAccess(access, "prevention:hygiene:view")
  const [row] = await db.select({ group: preventionExposureGroups, agent: preventionExposureAgents, worksiteName: worksites.name })
    .from(preventionExposureGroups)
    .innerJoin(preventionExposureAgents, eq(preventionExposureGroups.agentId, preventionExposureAgents.id))
    .innerJoin(worksites, eq(preventionExposureGroups.worksiteId, worksites.id))
    .where(eq(preventionExposureGroups.id, groupId)).limit(1)
  if (!row || !scopeAllows(access.scope, row.group.worksiteId)) return null

  const [measurements, memberRows] = await Promise.all([
    db.select().from(preventionExposureMeasurements)
      .where(eq(preventionExposureMeasurements.groupId, groupId))
      .orderBy(desc(preventionExposureMeasurements.measuredOn)),
    db.select({
      member: preventionExposureGroupMembers,
      workerFirstName: workers.firstName,
      workerLastName: workers.lastName,
      workerPosition: workers.position,
    })
      .from(preventionExposureGroupMembers)
      .innerJoin(workers, eq(preventionExposureGroupMembers.workerId, workers.id))
      .where(eq(preventionExposureGroupMembers.groupId, groupId))
      .orderBy(asc(workers.lastName)),
  ])

  const members = memberRows.map((item) => ({
    ...item.member,
    workerName: `${item.workerLastName}, ${item.workerFirstName}`,
    workerPosition: item.workerPosition,
  }))

  return { group: row.group, agent: row.agent, worksiteName: row.worksiteName, measurements, members }
}

/** Faenas visibles para el alcance, para poblar la creación de GES y programas. */
export async function listHygieneWorksites(access: HygieneAccess) {
  requireAccess(access, "prevention:hygiene:view")
  if (access.scope.mode === "none") return []
  return db.select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(and(
      eq(worksites.isActive, true),
      access.scope.mode === "some" ? inArray(worksites.id, access.scope.ids) : undefined,
    ))
    .orderBy(asc(worksites.name))
}

/**
 * Dotación activa dentro del alcance, para incorporar integrantes a un GES.
 *
 * Devuelve `worksiteId` porque el servicio rechaza personas de otra faena: el
 * formulario filtra por la faena del grupo y así el rechazo no aparece recién
 * al enviar.
 */
export async function listHygieneWorkers(access: HygieneAccess) {
  requireAccess(access, "prevention:hygiene:view")
  if (access.scope.mode === "none") return []
  return db.select({
    id: workers.id,
    firstName: workers.firstName,
    lastName: workers.lastName,
    position: workers.position,
    worksiteId: workers.worksiteId,
  })
    .from(workers)
    .where(and(
      eq(workers.isActive, true),
      access.scope.mode === "some" ? inArray(workers.worksiteId, access.scope.ids) : undefined,
    ))
    .orderBy(asc(workers.lastName), asc(workers.firstName))
    .limit(2000)
}

/** Matrículas de un programa, con la persona y el GES de origen. */
export async function listProgramEnrollments(programId: string, access: HygieneAccess) {
  requireAccess(access, "prevention:hygiene:view")
  const [program] = await db.select().from(preventionSurveillancePrograms)
    .where(eq(preventionSurveillancePrograms.id, programId)).limit(1)
  if (!program || !scopeAllows(access.scope, program.worksiteId)) return null

  const enrollments = await db.select({
    enrollment: preventionSurveillanceEnrollments,
    workerFirstName: workers.firstName,
    workerLastName: workers.lastName,
    groupName: preventionExposureGroups.name,
  })
    .from(preventionSurveillanceEnrollments)
    .innerJoin(workers, eq(preventionSurveillanceEnrollments.workerId, workers.id))
    .leftJoin(preventionExposureGroups, eq(preventionSurveillanceEnrollments.groupId, preventionExposureGroups.id))
    .where(eq(preventionSurveillanceEnrollments.programId, programId))
    .orderBy(asc(preventionSurveillanceEnrollments.dueOn))

  return {
    program,
    enrollments: enrollments.map((item) => ({
      ...item.enrollment,
      workerName: `${item.workerLastName}, ${item.workerFirstName}`,
      groupName: item.groupName,
    })),
  }
}


/* ── Protocolos MINSAL ────────────────────────────────────────────────────── */

function addMonthsIso(iso: string, months: number) {
  const [year, month, day] = iso.split("-").map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  date.setUTCMonth(date.getUTCMonth() + months)
  return date.toISOString().slice(0, 10)
}

/**
 * Estado de los ocho protocolos del catálogo para una faena.
 *
 * Devuelve siempre las ocho filas: un protocolo sin pronunciamiento aparece
 * como "por evaluar", que es distinto de "no aplica" y es lo que un fiscalizador
 * cuenta.
 */
export async function getProtocolCoverage(worksiteId: string, access: HygieneAccess) {
  requireAccess(access, "prevention:hygiene:view", worksiteId)
  const rows = await db.select().from(preventionProtocolApplicabilities)
    .where(eq(preventionProtocolApplicabilities.worksiteId, worksiteId))
  return summarizeProtocolCoverage(rows, todayInChile())
}

/** Cobertura de protocolos de todas las faenas visibles, para el dashboard. */
export async function listProtocolApplicabilities(access: HygieneAccess) {
  requireAccess(access, "prevention:hygiene:view")
  return db.select({
    applicability: preventionProtocolApplicabilities,
    worksiteName: worksites.name,
  })
    .from(preventionProtocolApplicabilities)
    .innerJoin(worksites, eq(worksites.id, preventionProtocolApplicabilities.worksiteId))
    .where(scopeCondition(access.scope, preventionProtocolApplicabilities.worksiteId))
    .orderBy(asc(worksites.name), asc(preventionProtocolApplicabilities.protocolCode))
}

/**
 * Declara si un protocolo aplica a una faena. Upsert: el pronunciamiento es uno
 * por faena y protocolo (índice único), y se reevalúa periódicamente.
 */
export async function setProtocolApplicability(input: unknown, access: HygieneAccess) {
  const data = protocolApplicabilitySchema.parse(input)
  requireAccess(access, "prevention:hygiene:assess", data.worksiteId)

  const protocol = findMinsalProtocol(data.protocolCode)
  if (!protocol) throw new Error("Protocolo MINSAL desconocido.")

  let accreditation: Parameters<typeof onProtocolApplicabilityAssessed>[0] | null = null
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(preventionProtocolApplicabilities)
      .where(and(
        eq(preventionProtocolApplicabilities.worksiteId, data.worksiteId),
        eq(preventionProtocolApplicabilities.protocolCode, data.protocolCode),
      )).limit(1)

    if (existing && data.expectedVersion !== undefined && existing.version !== data.expectedVersion) {
      throw new Error("El pronunciamiento cambió mientras lo editabas. Recarga y vuelve a intentarlo.")
    }

    const lastAssessedOn = data.lastAssessedOn ?? todayInChile()
    const periodicityMonths = data.periodicityMonths ?? protocol.defaultPeriodicityMonths
    // Un protocolo descartado no lleva reloj: reevaluarlo es una decisión, no
    // un vencimiento.
    const nextAssessmentOn = data.status === "applicable" ? addMonthsIso(lastAssessedOn, periodicityMonths) : null

    const values = {
      status: data.status,
      justification: data.justification?.trim() || null,
      periodicityMonths,
      lastAssessedOn,
      nextAssessmentOn,
      assessedByUserId: access.userId,
      updatedAt: new Date().toISOString(),
    }

    // El `version` va en el WHERE, no sólo en la comparación en memoria de más
    // arriba: entre aquel SELECT y este UPDATE otra transacción puede haber
    // cambiado la fila, y perder un pronunciamiento es perder la justificación
    // de por qué se descartó un protocolo MINSAL obligatorio.
    /* Sigue siendo upsert aunque los ocho protocolos ahora se materialicen al
     * activar la faena: una faena anterior a esa pre-generación no tiene fila, y
     * quitarle el camino de inserción convertiría su primer pronunciamiento en
     * un error sin ganar nada a cambio. La fila sembrada es la norma; el insert
     * es la red. */
    const [saved] = existing
      ? await tx.update(preventionProtocolApplicabilities)
          .set({ ...values, version: sql`${preventionProtocolApplicabilities.version} + 1` })
          .where(and(
            eq(preventionProtocolApplicabilities.id, existing.id),
            eq(preventionProtocolApplicabilities.version, existing.version),
          )).returning()
      : await tx.insert(preventionProtocolApplicabilities)
          .values({ id: `pprot-${nanoid()}`, protocolCode: data.protocolCode, worksiteId: data.worksiteId, ...values })
          .returning()
    if (existing && !saved) {
      throw new Error("El pronunciamiento cambió mientras lo editabas. Recarga y vuelve a intentarlo.")
    }

    await history(tx, {
      entityType: "protocol_applicability",
      entityId: saved!.id,
      worksiteId: data.worksiteId,
      changeType: existing ? "updated" : "created",
      reason: data.justification?.trim() || `Protocolo ${protocol.shortName}: ${data.status}`,
      beforeState: existing ?? null,
      afterState: saved,
      actorUserId: access.userId,
    })

    // N°46 a N°49 del PDTP, según el protocolo. Se dispara después del commit
    // por la misma razón que la medición. El `version` que viaja es el ya
    // incrementado por el UPDATE de arriba: es lo que distingue el seguimiento
    // de este trimestre del anterior, porque la clave idempotente del motor no
    // lleva mes y el pronunciamiento vive en una sola fila por faena.
    accreditation = {
      applicabilityId: saved!.id,
      worksiteId: data.worksiteId,
      protocolCode: data.protocolCode,
      protocolShortName: protocol.shortName,
      status: saved!.status as "applicable" | "not_applicable" | "pending_assessment",
      version: saved!.version,
      assessedOn: lastAssessedOn,
      nextAssessmentOn: saved!.nextAssessmentOn,
    }

    return saved
  })

  if (accreditation) await onProtocolApplicabilityAssessed(accreditation)
  return result
}
