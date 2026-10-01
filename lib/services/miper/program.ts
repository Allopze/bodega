/**
 * Programa de Trabajo Preventivo RE-04.1 (F2, §7.1–§7.3).
 *
 * El programa cuelga 1:1 del MIPER (`prevention_risk_programs.matrix_id` es
 * único) y se reemplaza con el período, igual que la matriz. Acá viven el
 * encabezado, las actividades, el vínculo N:M con las medidas y la generación
 * desde el MIPER con la decisión de la persona.
 *
 * Mismo patrón que `entries.ts`: `db.transaction` + `lockMatrix` +
 * `requireAccess(EDIT, faena)` + `assertEditable` + `miperHistory`. Nada de lo
 * de adentro resuelve la conexión global `db`, ni siquiera el prellenado del
 * encabezado: el perfil de empresa se lee con el cliente recibido.
 */

import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionRiskControls, preventionRiskEntries, preventionRiskMatrices,
  preventionRiskProgramActionControls, preventionRiskProgramActions, preventionRiskProgramOccurrences,
  preventionRiskPrograms,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { MEASURE_GROUP_THRESHOLD, groupMeasures } from "@/lib/prevention/miper/dedup"
import type { RiskClassification } from "@/lib/prevention/miper/methodology"
import { cleanMiperName } from "@/lib/prevention/miper/names"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import type { ProgramScheduleKind } from "@/lib/prevention/miper/schedule"
import { todayInChile } from "@/lib/utils"
import {
  programActionRetireSchema, programActionSchema, programGenerationSchema, programHeaderSchema,
  programLinkSchema, programProposeSchema, programUnlinkSchema,
} from "@/lib/validation/prevention-module/miper"
import { syncOccurrences } from "./program-execution"
import { buildMiperHeaderPrefill } from "./prefill"
import {
  assertActiveUsers, assertEditable, type Client, lockMatrix, type MiperAccess, miperHistory, nowIso, OUT_OF_SCOPE,
  requireAccess, userNames,
} from "./shared"

const EDIT = "prevention:risk:edit"
const STALE_PROGRAM = "El Programa de Trabajo cambió mientras lo editabas. Recarga antes de continuar."
const STALE_ACTION = "La actividad cambió mientras la editabas. Recarga el programa."

type Matrix = typeof preventionRiskMatrices.$inferSelect
type Program = typeof preventionRiskPrograms.$inferSelect
type ProgramAction = typeof preventionRiskProgramActions.$inferSelect

/* ── Encabezado RE-04.1 (§7.1) ──────────────────────────────────────────── */

/**
 * Programa del MIPER, creándolo la primera vez. Idempotente: el índice único
 * por `matrix_id` más `onConflictDoNothing` cubren la carrera de dos pestañas.
 *
 * El encabezado se prellena desde la misma fuente que el de la matriz —el
 * perfil de empresa y la faena, §4.8— y el encargado del programa queda en el
 * responsable de la faena (el Administrador de contrato) si existe.
 */
export async function ensureProgram(client: Client, matrix: Matrix): Promise<Program> {
  const [existing] = await client.select().from(preventionRiskPrograms)
    .where(eq(preventionRiskPrograms.matrixId, matrix.id)).limit(1)
  if (existing) return existing

  const prefill = await buildMiperHeaderPrefill(client, matrix.worksiteId)
  /* `period` es nullable en la matriz por las filas antiguas; el programa del
   * RE-04 sólo existe en el modelo nuevo, que siempre tiene período. */
  const period = matrix.period ?? Number(todayInChile().slice(0, 4))
  const now = nowIso()
  const [created] = await client.insert(preventionRiskPrograms).values({
    id: `riskprogram-${nanoid()}`,
    matrixId: matrix.id,
    worksiteId: matrix.worksiteId,
    period,
    /* Lo que la matriz ya sabe manda: el programa es su cara ejecutable y no se
     * completan los antecedentes dos veces. */
    companyName: matrix.companyName ?? prefill.companyName,
    companyRut: matrix.companyRut ?? prefill.companyRut,
    companyAddress: matrix.companyAddress ?? prefill.companyAddress,
    companyCommune: matrix.companyCommune ?? prefill.companyCommune,
    economicActivity: matrix.economicActivity ?? prefill.economicActivity,
    adherentNumber: matrix.adherentNumber ?? (prefill.adherentNumber || null),
    worksiteName: matrix.worksiteName ?? prefill.worksiteName,
    siteRepresentativeUserId: matrix.siteRepresentativeUserId ?? prefill.siteRepresentativeUserId,
    siteRepresentativeName: matrix.siteRepresentativeName ?? prefill.siteRepresentativeName,
    headcountTotal: matrix.headcountTotal ?? prefill.headcount.total,
    headcountMale: matrix.headcountMale ?? prefill.headcount.male,
    headcountFemale: matrix.headcountFemale ?? prefill.headcount.female,
    headcountOther: matrix.headcountOther ?? prefill.headcount.other,
    programManagerUserId: prefill.siteRepresentativeUserId ?? matrix.siteRepresentativeUserId,
    elaboratedOn: matrix.elaboratedOn ?? todayInChile(),
    createdByUserId: matrix.createdByUserId,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing().returning()

  if (created) return created
  const [raced] = await client.select().from(preventionRiskPrograms).where(eq(preventionRiskPrograms.matrixId, matrix.id)).limit(1)
  if (!raced) throw new RiskLegalDomainError("No se pudo preparar el Programa de Trabajo. Recarga la MIPER.")
  return raced
}

/** Edición del encabezado: mismo contrato de versión que `updateMiperHeader`. */
export async function updateProgramHeader(input: unknown, access: MiperAccess): Promise<{ version: number }> {
  const data = programHeaderSchema.parse(input)
  return db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    const program = await ensureProgram(tx, matrix)
    if (program.version !== data.expectedVersion) throw new RiskLegalDomainError(STALE_PROGRAM)
    await assertActiveUsers(tx, [data.siteRepresentativeUserId, data.programManagerUserId])
    const { matrixId: _matrixId, expectedVersion: _expectedVersion, ...fields } = data
    const changed = Object.fromEntries(Object.entries(fields).filter(([key, value]) => program[key as keyof Program] !== value))
    const [updated] = await tx.update(preventionRiskPrograms)
      .set({ ...fields, version: program.version + 1, updatedAt: nowIso() })
      .where(and(eq(preventionRiskPrograms.id, program.id), eq(preventionRiskPrograms.version, data.expectedVersion)))
      .returning({ version: preventionRiskPrograms.version })
    if (!updated) throw new RiskLegalDomainError(STALE_PROGRAM)
    if (Object.keys(changed).length > 0) {
      await miperHistory(tx, {
        matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "program", objectId: program.id,
        changeType: "program_header_updated",
        before: Object.fromEntries(Object.keys(changed).map((key) => [key, program[key as keyof Program]])),
        after: changed, actorUserId: access.userId, actingAs: EDIT,
      })
    }
    return { version: updated.version }
  })
}

/* ── Actividades (§7.2) ─────────────────────────────────────────────────── */

/** Resuelve el programa, la matriz y la faena de una actividad; sin permiso ninguno se distingue de inexistente. */
async function actionContext(client: Client, actionId: string) {
  const [row] = await client.select({ action: preventionRiskProgramActions, program: preventionRiskPrograms })
    .from(preventionRiskProgramActions)
    .innerJoin(preventionRiskPrograms, eq(preventionRiskPrograms.id, preventionRiskProgramActions.programId))
    .where(eq(preventionRiskProgramActions.id, actionId))
    .limit(1)
  if (!row) throw new RiskLegalDomainError(OUT_OF_SCOPE)
  return row
}

type ActionValues = {
  processId: string | null
  description: string
  responsibleUserId: string | null
  responsibleSnapshot: string | null
  locationLabel: string | null
  scheduleKind: ProgramScheduleKind
  startsOn: string
}

/**
 * Alta de una actividad con el correlativo al final (`max + 1`). El número no se
 * recicla: retirar una actividad no libera su N° del RE-04.1 impreso.
 */
async function createAction(client: Client, program: Program, actorUserId: string, values: ActionValues): Promise<ProgramAction> {
  const [row] = await client.select({ max: sql<number>`coalesce(max(${preventionRiskProgramActions.actionNumber}), 0)::int` })
    .from(preventionRiskProgramActions).where(eq(preventionRiskProgramActions.programId, program.id))
  const now = nowIso()
  const [created] = await client.insert(preventionRiskProgramActions).values({
    id: `riskprogramaction-${nanoid()}`,
    programId: program.id,
    actionNumber: (row?.max ?? 0) + 1,
    ...values,
    status: "active",
    createdAt: now,
    updatedAt: now,
    createdByUserId: actorUserId,
  }).returning()
  return created!
}

/**
 * Alta o edición de una actividad. La fecha programada es obligatoria y tras
 * guardar se re-sincronizan las ocurrencias: en un MIPER vigente la actividad
 * nueva genera las suyas al crearse, y en un borrador no genera ninguna (§7.4).
 */
export async function saveProgramAction(input: unknown, access: MiperAccess): Promise<{ id: string; version: number; actionNumber: number }> {
  const data = programActionSchema.parse(input)
  return db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    const program = await ensureProgram(tx, matrix)
    await assertActiveUsers(tx, [data.responsibleUserId])
    const responsibleUserId = data.responsibleUserId ?? null
    const responsibleSnapshot = responsibleUserId
      ? (await userNames(tx, [responsibleUserId])).get(responsibleUserId) ?? cleanMiperName(data.responsibleName)
      : cleanMiperName(data.responsibleName)
    const values: ActionValues = {
      processId: data.processId ?? null,
      description: data.description,
      responsibleUserId,
      responsibleSnapshot,
      locationLabel: data.locationLabel ?? null,
      scheduleKind: data.scheduleKind,
      startsOn: data.startsOn,
    }

    if (!data.actionId) {
      const created = await createAction(tx, program, access.userId, values)
      await syncOccurrences(tx, created, program.period)
      await miperHistory(tx, {
        matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "program_action", objectId: created.id,
        changeType: "action_created", after: { actionNumber: created.actionNumber, ...values },
        actorUserId: access.userId, actingAs: EDIT,
      })
      return { id: created.id, version: created.version, actionNumber: created.actionNumber }
    }

    const [current] = await tx.select().from(preventionRiskProgramActions)
      .where(and(eq(preventionRiskProgramActions.id, data.actionId), eq(preventionRiskProgramActions.programId, program.id)))
      .for("update").limit(1)
    if (!current) throw new RiskLegalDomainError("La actividad no existe en este programa; recarga el programa.")
    if (current.status === "retired") throw new RiskLegalDomainError("La actividad está retirada y no se edita: crea una nueva.")
    if (current.version !== data.expectedVersion) throw new RiskLegalDomainError(STALE_ACTION)
    const [updated] = await tx.update(preventionRiskProgramActions)
      .set({ ...values, version: current.version + 1, updatedAt: nowIso() })
      .where(and(eq(preventionRiskProgramActions.id, current.id), eq(preventionRiskProgramActions.version, current.version)))
      .returning()
    if (!updated) throw new RiskLegalDomainError(STALE_ACTION)
    await syncOccurrences(tx, updated, program.period)
    await miperHistory(tx, {
      matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "program_action", objectId: current.id,
      changeType: "action_updated",
      before: { description: current.description, responsibleUserId: current.responsibleUserId, scheduleKind: current.scheduleKind, startsOn: current.startsOn, locationLabel: current.locationLabel, processId: current.processId },
      after: values, actorUserId: access.userId, actingAs: EDIT,
    })
    return { id: updated.id, version: updated.version, actionNumber: updated.actionNumber }
  })
}

/**
 * Retira una actividad: exige motivo, deja de generar ocurrencias futuras y sus
 * pendientes pasan a `superseded` (dejan de contar). Lo ya registrado —y su
 * evidencia— se conserva intacto.
 */
export async function retireProgramAction(input: unknown, access: MiperAccess): Promise<void> {
  const data = programActionRetireSchema.parse(input)
  await db.transaction(async (tx) => {
    const { action, program } = await actionContext(tx, data.actionId)
    const matrix = await lockMatrix(tx, program.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    if (action.status === "retired") throw new RiskLegalDomainError("La actividad ya está retirada.")
    if (action.version !== data.expectedVersion) throw new RiskLegalDomainError(STALE_ACTION)
    const now = nowIso()
    await tx.update(preventionRiskProgramActions)
      .set({ status: "retired", retiredAt: now, retiredReason: data.reason, version: action.version + 1, updatedAt: now })
      .where(and(eq(preventionRiskProgramActions.id, action.id), eq(preventionRiskProgramActions.version, action.version)))
    /* Retirar detiene las ocurrencias futuras: las pendientes pasan a
     * `superseded` y dejan de contar. Lo ya registrado —con su evidencia— no se
     * toca y sigue en el historial (§7.4). */
    await tx.update(preventionRiskProgramOccurrences)
      .set({ outcome: "superseded", updatedAt: now })
      .where(and(
        eq(preventionRiskProgramOccurrences.actionId, action.id),
        eq(preventionRiskProgramOccurrences.outcome, "pending"),
      ))
    await miperHistory(tx, {
      matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "program_action", objectId: action.id,
      changeType: "action_retired", reason: data.reason,
      before: { status: action.status, description: action.description }, after: { status: "retired" },
      actorUserId: access.userId, actingAs: EDIT,
    })
  })
}

/* ── Vínculo N:M actividad ↔ medida (§7.3) ──────────────────────────────── */

/** Verifica que las medidas pertenezcan al MIPER del programa, en una sola lectura. */
async function assertControlsInMatrix(client: Client, matrixId: string, controlIds: readonly string[]) {
  const rows = await client.select({ controlId: preventionRiskControls.id, rowNumber: preventionRiskEntries.rowNumber })
    .from(preventionRiskControls)
    .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId))
    .where(and(eq(preventionRiskEntries.matrixId, matrixId), inArray(preventionRiskControls.id, [...controlIds])))
  const found = new Set(rows.map((row) => row.controlId))
  const missing = controlIds.filter((controlId) => !found.has(controlId))
  if (missing.length > 0) throw new RiskLegalDomainError("Una de las medidas ya no existe en el MIPER; recarga el programa.")
}

export async function linkActionControls(input: unknown, access: MiperAccess): Promise<{ linked: number }> {
  const data = programLinkSchema.parse(input)
  return db.transaction(async (tx) => {
    const [program] = await tx.select().from(preventionRiskPrograms).where(eq(preventionRiskPrograms.id, data.programId)).limit(1)
    if (!program) throw new RiskLegalDomainError(OUT_OF_SCOPE)
    const matrix = await lockMatrix(tx, program.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    const [action] = await tx.select().from(preventionRiskProgramActions)
      .where(and(eq(preventionRiskProgramActions.id, data.actionId), eq(preventionRiskProgramActions.programId, program.id))).limit(1)
    if (!action) throw new RiskLegalDomainError("La actividad no existe en este programa; recarga el programa.")
    await assertControlsInMatrix(tx, matrix.id, data.controlIds)
    const now = nowIso()
    if (data.link) {
      /* `onConflictDoNothing` sobre el único (action_id, control_id): aplicar
       * dos veces la misma decisión no duplica el vínculo. */
      await tx.insert(preventionRiskProgramActionControls).values(data.controlIds.map((controlId) => ({
        id: `riskprogramlink-${nanoid()}`, actionId: action.id, controlId, linkedByUserId: access.userId, linkedAt: now,
      }))).onConflictDoNothing()
    } else {
      await tx.delete(preventionRiskProgramActionControls).where(and(
        eq(preventionRiskProgramActionControls.actionId, action.id),
        inArray(preventionRiskProgramActionControls.controlId, data.controlIds),
      ))
    }
    await miperHistory(tx, {
      matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "program_action", objectId: action.id,
      changeType: data.link ? "controls_linked" : "controls_unlinked", after: { controlIds: data.controlIds },
      actorUserId: access.userId, actingAs: EDIT,
    })
    return { linked: data.controlIds.length }
  })
}

export async function unlinkActionControl(input: unknown, access: MiperAccess): Promise<void> {
  const data = programUnlinkSchema.parse(input)
  await db.transaction(async (tx) => {
    const { action, program } = await actionContext(tx, data.actionId)
    const matrix = await lockMatrix(tx, program.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    await tx.delete(preventionRiskProgramActionControls).where(and(
      eq(preventionRiskProgramActionControls.actionId, action.id),
      eq(preventionRiskProgramActionControls.controlId, data.controlId),
    ))
    await miperHistory(tx, {
      matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "program_action", objectId: action.id,
      changeType: "controls_unlinked", after: { controlIds: [data.controlId] },
      actorUserId: access.userId, actingAs: EDIT,
    })
  })
}

/* ── Generación desde el MIPER con decisión de la persona (§7.3) ────────── */

export type ProposedMeasure = {
  controlId: string
  entryId: string
  rowNumber: number
  description: string
  classification: RiskClassification | null
  /** Grupo propuesto; `null` cuando la medida no se parece a ninguna otra. */
  suggestedGroupKey: string | null
  /** Actividad que ya la cubre; `null` porque sólo se proponen las sin actividad. */
  linkedActionId: string | null
}

/**
 * Medidas del MIPER **sin actividad vinculada**, con las agrupaciones que el
 * sistema propone. No decide nada: la persona elige crear, asociar o dejar sin
 * actividad —esto último sólo si su fila es Tolerable o Moderado—.
 *
 * Es de sólo lectura salvo el `ensureProgram` idempotente.
 */
export async function proposeProgramActions(
  input: unknown,
  access: MiperAccess,
): Promise<{ measures: ProposedMeasure[]; groups: Array<{ key: string; description: string; measures: string[] }> }> {
  const data = programProposeSchema.parse(input)
  return db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    /* El programa existe desde la primera propuesta: es el encabezado que la
     * persona ve junto a las medidas. */
    await ensureProgram(tx, matrix)

    const rows = await tx.select({
      controlId: preventionRiskControls.id,
      description: preventionRiskControls.description,
      entryId: preventionRiskEntries.id,
      rowNumber: preventionRiskEntries.rowNumber,
      classification: preventionRiskEntries.classification,
      linkedActionId: preventionRiskProgramActionControls.actionId,
    }).from(preventionRiskControls)
      .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId))
      .leftJoin(preventionRiskProgramActionControls, eq(preventionRiskProgramActionControls.controlId, preventionRiskControls.id))
      .where(eq(preventionRiskEntries.matrixId, matrix.id))
      .orderBy(asc(preventionRiskEntries.rowNumber), asc(preventionRiskControls.createdAt))

    const pending = rows.filter((row) => !row.linkedActionId)
    const grouped = groupMeasures(pending.map((row) => ({ id: row.controlId, description: row.description })), MEASURE_GROUP_THRESHOLD)
    const keyByControl = new Map<string, string>()
    for (const group of grouped) for (const controlId of group.measures) keyByControl.set(controlId, group.key)
    /* El grupo se describe con la medida representante (la que abrió el grupo). */
    const descriptionByControl = new Map(pending.map((row) => [row.controlId, row.description]))

    return {
      measures: pending.map((row) => ({
        controlId: row.controlId,
        entryId: row.entryId,
        rowNumber: row.rowNumber ?? 0,
        description: row.description,
        classification: (row.classification ?? null) as RiskClassification | null,
        suggestedGroupKey: keyByControl.get(row.controlId) ?? null,
        linkedActionId: null,
      })),
      groups: grouped.map((group) => ({
        key: group.key,
        description: descriptionByControl.get(group.key) ?? "",
        measures: group.measures,
      })),
    }
  })
}

/**
 * Aplica las decisiones de la persona en una sola transacción.
 *
 * - `create`: crea la actividad (correlativo al final) y vincula sus medidas.
 * - `link`: reutiliza una actividad existente (N:M, sin duplicar).
 * - `leave`: deja la medida sin actividad; **sólo** si su fila es Tolerable o
 *   Moderado. Una fila Intolerable o Importante no puede quedar sin programa.
 *
 * Idempotente frente al doble envío: las medidas que ya tienen actividad no se
 * vuelven a vincular ni crean una segunda actividad.
 */
export async function applyProgramGeneration(
  input: unknown,
  access: MiperAccess,
): Promise<{ created: number; linked: number; left: number }> {
  const data = programGenerationSchema.parse(input)
  return db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    const program = await ensureProgram(tx, matrix)

    const controlIds = [...new Set(data.decisions.flatMap((decision) => decision.controlIds))]
    const measures = await tx.select({
      controlId: preventionRiskControls.id,
      description: preventionRiskControls.description,
      entryId: preventionRiskEntries.id,
      rowNumber: preventionRiskEntries.rowNumber,
      classification: preventionRiskEntries.classification,
    }).from(preventionRiskControls)
      .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId))
      .where(and(eq(preventionRiskEntries.matrixId, matrix.id), inArray(preventionRiskControls.id, controlIds)))
    const byId = new Map(measures.map((measure) => [measure.controlId, measure]))
    if (byId.size !== controlIds.length) throw new RiskLegalDomainError("Una de las medidas ya no existe en el MIPER; recarga la generación.")

    const alreadyLinked = new Set((await tx.select({ controlId: preventionRiskProgramActionControls.controlId })
      .from(preventionRiskProgramActionControls)
      .innerJoin(preventionRiskProgramActions, eq(preventionRiskProgramActions.id, preventionRiskProgramActionControls.actionId))
      .where(and(eq(preventionRiskProgramActions.programId, program.id), inArray(preventionRiskProgramActionControls.controlId, controlIds))))
      .map((row) => row.controlId))

    const now = nowIso()
    let created = 0
    let linked = 0
    let left = 0

    const linkControls = async (actionId: string, ids: string[]) => {
      if (ids.length === 0) return
      await tx.insert(preventionRiskProgramActionControls).values(ids.map((controlId) => ({
        id: `riskprogramlink-${nanoid()}`, actionId, controlId, linkedByUserId: access.userId, linkedAt: now,
      }))).onConflictDoNothing()
    }
    const history = async (objectId: string, changeType: string, after: unknown) => {
      await miperHistory(tx, {
        matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "program_action", objectId, changeType, after,
        actorUserId: access.userId, actingAs: EDIT,
      })
    }

    for (const decision of data.decisions) {
      const involved = decision.controlIds.map((controlId) => byId.get(controlId)!)
      /* Una sola lectura de las filas incluidas en las decisiones: la banda de
       * cada medida decide si puede quedar sin actividad (§7.3). */
      const blocked = involved.filter((measure) => measure.classification === "intolerable" || measure.classification === "important")
      if (decision.decision === "leave" && blocked.length > 0) {
        const row = blocked[0]!
        const band = row.classification === "intolerable" ? "Intolerable" : "Importante"
        throw new RiskLegalDomainError(`La fila ${row.rowNumber} tiene un riesgo ${band}: «${row.description}» no puede quedar sin una actividad del Programa de Trabajo. Crea o asocia una actividad.`)
      }

      if (decision.decision === "leave") {
        for (const measure of involved) await history(measure.controlId, "left_without_action", { entryId: measure.entryId, rowNumber: measure.rowNumber })
        left += involved.length
        continue
      }

      const toLink = involved.filter((measure) => !alreadyLinked.has(measure.controlId))

      if (decision.decision === "link") {
        if (!decision.actionId) throw new RiskLegalDomainError("Indica a qué actividad existente se asocian las medidas.")
        const [action] = await tx.select().from(preventionRiskProgramActions)
          .where(and(eq(preventionRiskProgramActions.id, decision.actionId), eq(preventionRiskProgramActions.programId, program.id))).limit(1)
        if (!action) throw new RiskLegalDomainError("La actividad elegida no existe en este programa; recarga la generación.")
        await assertActiveUsers(tx, [action.responsibleUserId])
        await linkControls(action.id, toLink.map((measure) => measure.controlId))
        for (const measure of toLink) {
          await history(measure.controlId, "linked", { actionId: action.id, entryId: measure.entryId, rowNumber: measure.rowNumber })
          linked += 1
        }
        continue
      }

      /* `create`: sin medidas nuevas que vincular no se crea una segunda
       * actividad —el doble envío de la misma decisión no duplica nada—. */
      if (toLink.length === 0) continue
      await assertActiveUsers(tx, [decision.responsibleUserId])
      const action = await createAction(tx, program, access.userId, {
        processId: null,
        description: decision.description?.trim() || involved[0]!.description,
        responsibleUserId: decision.responsibleUserId ?? null,
        responsibleSnapshot: decision.responsibleUserId
          ? (await userNames(tx, [decision.responsibleUserId])).get(decision.responsibleUserId) ?? cleanMiperName(decision.responsibleName)
          : cleanMiperName(decision.responsibleName),
        locationLabel: decision.locationLabel ?? null,
        scheduleKind: decision.scheduleKind ?? "once",
        startsOn: decision.startsOn ?? todayInChile(),
      })
      await linkControls(action.id, toLink.map((measure) => measure.controlId))
      await syncOccurrences(tx, action, program.period)
      for (const measure of toLink) {
        await history(measure.controlId, "generated", { actionId: action.id, actionNumber: action.actionNumber, entryId: measure.entryId, rowNumber: measure.rowNumber })
        created += 1
      }
    }

    return { created, linked, left }
  })
}
