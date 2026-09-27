import { and, eq, inArray, ne, sql } from "drizzle-orm"
import { z } from "zod"
import { db, type Tx } from "@/db"
import {
  preventionInspectionAnswerEvidence,
  preventionInspectionAnswers,
  preventionInspectionFindings,
  preventionInspectionPrograms,
  preventionInspectionRunParticipants,
  preventionInspectionRuns,
  preventionInspectionTemplates,
  preventionEmergencyResources,
  fuelVehicles,
  users,
} from "@/db/schema"
import {
  history,
  NOT_FOUND,
  nowIso,
  requireAccess,
  scopeAllows,
  type Client,
  type InspectionAccess,
} from "@/lib/services/prevention-inspections-access"
import { nanoid } from "@/lib/id"
import { recordOperationalActivity } from "@/lib/services/operational-activity"
import { getUserIdsWithPermissionForWorksite } from "@/lib/services/notification-targeting"
import { createNotifications } from "@/lib/services/notifications"
import { logger } from "@/lib/logger"
import {
  addDays,
  assessRunCompletion,
  capaPriorityForCriticality,
  closingActFromDefinition,
  deriveFindings,
  nextDueAfter,
  requiresCapa,
  requiresHumanConfirmation,
  summarizeCompliance,
  validateAnswerRow,
  TRANSITION_REASON_MIN_LENGTH,
  type InspectionAnswerInput,
} from "@/lib/prevention/inspections"
import { setVehicleOperationalStatus } from "@/lib/services/fleet"
import { createMaintenanceRecordWithClient } from "@/lib/services/maintenance"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import type { ChecklistDefinition } from "@/lib/sst/types"
import { onInspectionCompleted } from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"
import { resolvePdtpAccreditationTarget } from "@/lib/services/pdtp/accreditation-bindings"
import { codeYear, todayInChile } from "@/lib/utils"
import { enqueueGeneratedDocumentTx } from "@/lib/services/generated-documents/enqueue"
import { resolveSubject, assertContainerSubject } from "./programs"
import { itemsFromDefinition } from "./templates"
import { transitionInspectionRun } from "./transitions"

/* ── Ejecución ────────────────────────────────────────────────────────────── */

const runSchema = z.object({
  templateId: z.string().min(1),
  worksiteId: z.string().min(1),
  programId: z.string().min(1).nullable().optional(),
  subjectType: z.string().trim().max(120).nullable().optional(),
  subjectLabel: z.string().trim().max(300).nullable().optional(),
  /** Sujeto del inventario (función #11); `subjectLabel` sigue admitiendo texto libre. */
  subjectResourceId: z.string().min(1).nullable().optional(),
  /** Equipo de flota inspeccionado. Excluyente con `subjectResourceId`. */
  subjectVehicleId: z.string().min(1).nullable().optional(),
  /** Contenedor del catálogo; obligatorio en la plantilla de contenedores. */
  subjectContainerId: z.string().min(1).nullable().optional(),
  origin: z.enum(["prevencion", "cphs", "mandante"]).default("prevencion"),
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

  // A-13: sin esto, un `programId` cualquiera hacía que completar la ejecución
  // avanzara el `nextDueOn` de un programa ajeno. Era inalcanzable mientras
  // nada enviaba `programId`; el materializador de B-04 lo activa.
  if (data.programId) {
    const [program] = await db.select().from(preventionInspectionPrograms)
      .where(eq(preventionInspectionPrograms.id, data.programId)).limit(1)
    if (!program) throw new Error(NOT_FOUND)
    if (program.templateId !== data.templateId || program.worksiteId !== data.worksiteId) {
      throw new Error("La programación no corresponde a esta plantilla y faena.")
    }
  }

  // El sujeto debe existir y pertenecer a la faena: sin esto, un id de otra
  // faena entraría por la acción y filtraría el nombre del recurso ajeno.
  assertContainerSubject(template.sourceDefinitionCode, data.subjectContainerId)
  const subjectName = await resolveSubject(db, {
    worksiteId: data.worksiteId,
    subjectResourceId: data.subjectResourceId,
    subjectVehicleId: data.subjectVehicleId,
    subjectContainerId: data.subjectContainerId,
  }, true)

  // La sincronización offline reenvía: el identificador de envío hace la
  // creación idempotente en vez de duplicar la inspección.
  if (data.clientSubmissionId) {
    const [existing] = await db.select().from(preventionInspectionRuns)
      .where(eq(preventionInspectionRuns.clientSubmissionId, data.clientSubmissionId)).limit(1)
    if (existing) return { run: existing, idempotentReplay: true }
  }

  const [created] = await db.insert(preventionInspectionRuns).values({
    id: `insrun-${nanoid()}`,
    code: `INSP-${codeYear()}-${nanoid(8).toUpperCase()}`,
    templateId: data.templateId,
    programId: data.programId ?? null,
    worksiteId: data.worksiteId,
    subjectType: data.subjectType ?? (data.subjectContainerId ? "contenedor" : null),
    // El nombre del recurso se congela como etiqueta: renombrarlo después no
    // debe cambiar qué decía la inspección que se inspeccionó.
    subjectLabel: subjectName ?? data.subjectLabel ?? null,
    subjectResourceId: data.subjectResourceId ?? null,
    subjectVehicleId: data.subjectVehicleId ?? null,
    subjectContainerId: data.subjectContainerId ?? null,
    origin: data.origin,
    scheduledFor: data.scheduledFor ?? null,
    status: "planned",
    assignedToUserId: data.assignedToUserId ?? access.userId,
    clientSubmissionId: data.clientSubmissionId ?? null,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo crear la inspección.")
  await history(db, { entityType: "run", entityId: created.id, worksiteId: data.worksiteId, changeType: "created", reason: `Inspección ${template.name} planificada`, afterState: created, actorUserId: access.userId })

  // A-08: sin esto, a quien se le asignaba una inspección sólo se enteraba si
  // miraba la bandeja por su cuenta. Asignársela a uno mismo no notifica.
  if (created.assignedToUserId && created.assignedToUserId !== access.userId) {
    await notifySafely("asignación", () => createNotifications([created.assignedToUserId!], {
      type: "system_alert",
      title: "Inspección asignada",
      body: `${template.name}${created.scheduledFor ? ` · programada para el ${created.scheduledFor}` : ""}.`,
      entityType: "inspection_run",
      entityId: created.id,
      entityHref: `/prevencion/inspecciones/${created.id}`,
      dedupeKey: `inspection:assigned:${created.id}:${created.assignedToUserId}`,
    }))
  }
  return { run: created, idempotentReplay: false }
}

/**
 * Conjunto completo de respuestas del run, no un delta.
 *
 * `.min(1)` se quitó a propósito (B-02): un array vacío significa "ninguna
 * respuesta", y debe poder borrar la última que quedaba.
 */
const answerRowSchema = z.object({
  sectionId: z.string().min(1),
  itemId: z.string().min(1),
  /* `not_present` ("No tiene", Anexo 14) faltaba acá y estaba en todas las
   * demás capas: el CHECK de la base, `InspectionResult`, `EXCLUDED_RESULTS` y
   * `statusOptionsForKind` para la escala `bueno_regular_malo_na_nt_obs`. El
   * botón se renderizaba y el servidor rechazaba el lote completo. En terreno
   * era peor: el emisor de la cola offline marca toda respuesta no-ok como
   * `retriable: false`, así que la corrida encolada se quemaba sin vuelta. */
  result: z.enum(["conforming", "partial", "non_conforming", "not_applicable", "not_present", "recorded"]),
  value: z.string().trim().max(2000).nullable().optional(),
  comment: z.string().trim().max(2000).nullable().optional(),
  evidenceReference: z.string().trim().max(2000).nullable().optional(),
  /** La marca la ingesta al pre-llenar un ítem `fatal`; el cliente la apaga al responderlo. */
  needsConfirmation: z.boolean().optional(),
})

const answersSchema = z.object({
  runId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  answers: z.array(answerRowSchema),
  locationLatitude: z.string().trim().max(40).nullable().optional(),
  locationLongitude: z.string().trim().max(40).nullable().optional(),
})

type AnswerRowInput = z.infer<typeof answerRowSchema>

/**
 * Persiste el conjunto de respuestas dentro de una transacción existente y
 * devuelve la nueva versión del run.
 *
 * Extraída para que **guardar** y **declarar ejecutada** compartan exactamente
 * el mismo camino de escritura. Antes de B-01 el botón de completar no
 * persistía nada: el gate del cliente se evaluaba sobre el borrador en memoria
 * y el servidor calculaba cumplimiento y hallazgos sobre lo que hubiera en BD,
 * que podía ser más viejo. Ahora hay una sola transacción y una sola verdad.
 */
async function saveAnswersWithClient(tx: Tx, args: {
  runId: string
  expectedVersion: number
  answers: AnswerRowInput[]
  locationLatitude?: string | null
  locationLongitude?: string | null
  access: InspectionAccess
}) {
  const [run] = await tx.select().from(preventionInspectionRuns)
    .where(eq(preventionInspectionRuns.id, args.runId)).limit(1)
  if (!run) throw new Error(NOT_FOUND)
  requireAccess(args.access, "prevention:inspections:execute", run.worksiteId)
  if (["reviewed", "cancelled"].includes(run.status)) {
    throw new Error("No se pueden modificar respuestas de una inspección cerrada o cancelada.")
  }
  // C-02: antes no había control de concurrencia y dos inspectores con el
  // mismo run abierto se pisaban en silencio. El cliente recibe de vuelta la
  // versión nueva, que es lo que el comentario anterior temía perder.
  if (run.version !== args.expectedVersion) {
    throw new Error("La inspección cambió en otra sesión. Recarga y reintenta.")
  }

  const [template] = await tx.select().from(preventionInspectionTemplates)
    .where(eq(preventionInspectionTemplates.id, run.templateId)).limit(1)
  if (!template) throw new Error(NOT_FOUND)
  const items = itemsFromDefinition(template.definitionSnapshot as unknown as ChecklistDefinition)
  const itemBySpec = new Map(items.map((item) => [`${item.sectionId}::${item.itemId}`, item]))

  // B-03: validar TODO antes de escribir nada. El CHECK de Postgres queda como
  // red de seguridad del dato, no como mecanismo de UX.
  for (const answer of args.answers) {
    const item = itemBySpec.get(`${answer.sectionId}::${answer.itemId}`)
    if (!item) throw new Error("Una respuesta no corresponde a ningún ítem de la plantilla.")
    const problem = validateAnswerRow(item, answer)
    if (problem) throw new Error(problem)
  }

  const now = nowIso()

  /* INS-03: una respuesta que se borra se lleva su evidencia por cascada
   * (`prevention_inspection_answer_evidence.answer_id` es ON DELETE cascade).
   * Dejar un ítem en "Sin responder" —o vaciar el campo de uno que no puntúa,
   * que pone `result: ""` solo— destruía sus fotografías sin preguntar, en el
   * módulo cuyo propósito es que un hallazgo tenga foto.
   *
   * La guarda vive acá y no en el formulario porque este camino lo comparten
   * el guardado manual, el autoguardado y la sincronización offline: avisarlo
   * en el cliente serían tres avisos y uno de ellos se quedaría atrás. */
  const keepKeys = new Set(args.answers.map((answer) => `${answer.sectionId}::${answer.itemId}`))
  const droppedWithEvidence = await tx.select({
    itemLabel: preventionInspectionAnswers.itemLabel,
    sectionId: preventionInspectionAnswers.sectionId,
    itemId: preventionInspectionAnswers.itemId,
    photos: sql<number>`count(${preventionInspectionAnswerEvidence.id})::int`,
  })
    .from(preventionInspectionAnswers)
    .innerJoin(
      preventionInspectionAnswerEvidence,
      eq(preventionInspectionAnswerEvidence.answerId, preventionInspectionAnswers.id),
    )
    .where(eq(preventionInspectionAnswers.runId, run.id))
    .groupBy(
      preventionInspectionAnswers.itemLabel,
      preventionInspectionAnswers.sectionId,
      preventionInspectionAnswers.itemId,
    )
  const blocked = droppedWithEvidence.filter((row) => !keepKeys.has(`${row.sectionId}::${row.itemId}`))
  if (blocked.length > 0) {
    const detail = blocked
      .map((row) => `"${row.itemLabel}" (${row.photos} ${row.photos === 1 ? "fotografía" : "fotografías"})`)
      .join(", ")
    throw new Error(
      `No se puede dejar sin responder ${detail}: se perdería la evidencia adjunta. Quita las fotografías primero, o vuelve a responder el ítem.`,
    )
  }

  // B-02: el payload declara el conjunto completo, así que lo que no viene se
  // borra. Sin esto, devolver un ítem a "Sin responder" en el formulario no
  // producía ningún cambio y la fila anterior sobrevivía: el cliente contaba
  // 9 respuestas y el servidor 10.
  const keepPairs = args.answers.map((answer) => sql`(${answer.sectionId}, ${answer.itemId})`)
  const deleted = await tx.delete(preventionInspectionAnswers)
    .where(and(
      eq(preventionInspectionAnswers.runId, run.id),
      // Comparación por tupla, no por clave concatenada: un `sectionId` que
      // contuviera el separador produciría colisiones silenciosas.
      keepPairs.length > 0
        ? sql`(${preventionInspectionAnswers.sectionId}, ${preventionInspectionAnswers.itemId}) NOT IN (${sql.join(keepPairs, sql`, `)})`
        : undefined,
    ))
    .returning({ id: preventionInspectionAnswers.id })

  if (args.answers.length > 0) {
    await tx.insert(preventionInspectionAnswers).values(args.answers.map((answer) => {
      const item = itemBySpec.get(`${answer.sectionId}::${answer.itemId}`)!
      return {
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
        // Sólo los ítems que matan quedan pendientes de ratificar; marcar el
        // resto convertiría la puerta en un trámite de 28 clics que nadie lee.
        needsConfirmation: (answer.needsConfirmation ?? false) && requiresHumanConfirmation(item),
      }
    })).onConflictDoUpdate({
      target: [preventionInspectionAnswers.runId, preventionInspectionAnswers.sectionId, preventionInspectionAnswers.itemId],
      set: {
        result: sql`excluded.result`,
        value: sql`excluded.value`,
        comment: sql`excluded.comment`,
        evidenceReference: sql`excluded.evidence_reference`,
        needsConfirmation: sql`excluded.needs_confirmation`,
        updatedAt: now,
      },
    })
  }

  const [updated] = await tx.update(preventionInspectionRuns).set({
    status: run.status === "planned" ? "in_progress" : run.status,
    locationLatitude: args.locationLatitude ?? run.locationLatitude,
    locationLongitude: args.locationLongitude ?? run.locationLongitude,
    version: run.version + 1,
    updatedAt: now,
  }).where(and(
    eq(preventionInspectionRuns.id, run.id),
    eq(preventionInspectionRuns.version, args.expectedVersion),
  )).returning()
  if (!updated) throw new Error("La inspección cambió en otra sesión. Recarga y reintenta.")

  // La UI puede adjuntar una foto en el mismo gesto de responder: después del
  // autosave necesita el id persistido al que colgar la evidencia, sin recargar
  // ni obligar a recorrer el checklist por segunda vez.
  const answerRefs = args.answers.length === 0 ? [] : await tx.select({
    answerId: preventionInspectionAnswers.id,
    sectionId: preventionInspectionAnswers.sectionId,
    itemId: preventionInspectionAnswers.itemId,
  }).from(preventionInspectionAnswers)
    .where(eq(preventionInspectionAnswers.runId, run.id))

  return { run: updated, saved: args.answers.length, removed: deleted.length, answerRefs }
}

export async function saveInspectionAnswers(input: unknown, access: InspectionAccess) {
  const data = answersSchema.parse(input)
  return db.transaction(async (tx) => {
    const result = await saveAnswersWithClient(tx, { ...data, access })
    // C-01: guardar una respuesta es lo único que el inspector hace en terreno
    // y no dejaba rastro en la bitácora "inmutable". Se registran conteos, no
    // el array completo: 80 ítems guardados 10 veces son 800 filas JSON sin
    // valor probatorio adicional.
    await history(tx, {
      entityType: "run", entityId: result.run.id, worksiteId: result.run.worksiteId,
      changeType: "answers_saved",
      reason: `${result.saved} respuesta(s) guardada(s), ${result.removed} eliminada(s)`,
      beforeState: { version: data.expectedVersion },
      afterState: { version: result.run.version, saved: result.saved, removed: result.removed },
      actorUserId: access.userId,
    })
    return { saved: result.saved, removed: result.removed, version: result.run.version, answerRefs: result.answerRefs }
  })
}

/**
 * Declara la inspección ejecutada: valida obligatorios, calcula cumplimiento y
 * materializa un hallazgo por cada incumplimiento con su criticidad derivada.
 */
export async function completeInspectionRun(input: unknown, access: InspectionAccess) {
  const data = z.object({
    runId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    /**
     * Conjunto completo de respuestas al momento de declarar ejecutada.
     *
     * B-01: sin esto, el cliente evaluaba el gate de completitud sobre su
     * borrador en memoria y el servidor calculaba cumplimiento y hallazgos
     * sobre lo último persistido — que podía ser más viejo. Se persiste y se
     * completa en la MISMA transacción. Omitirlo conserva el comportamiento
     * anterior (evalúa lo ya guardado), que es lo que necesitan los llamadores
     * sin formulario.
     */
    answers: z.array(answerRowSchema).optional(),
    locationLatitude: z.string().trim().max(40).nullable().optional(),
    locationLongitude: z.string().trim().max(40).nullable().optional(),
    /** Acta de cierre (función #2). La plantilla declara qué exige. */
    closingAct: z.object({
      result: z.string().trim().min(1),
      restrictions: z.string().trim().max(3000).nullable().optional(),
      signatures: z.array(z.object({
        role: z.string().trim().min(1).max(120),
        name: z.string().trim().min(1).max(200),
        userId: z.string().min(1).nullable().optional(),
      })).max(20),
    }).optional(),
  }).parse(input)

  const result = await db.transaction(async (tx) => {
    // Función #9: el reintento de una cola offline vuelve a mandar el mismo
    // cierre. Si el run ya quedó ejecutado por ESTE mismo usuario, la primera
    // entrega sí llegó y la segunda es un eco — devolverlo como éxito
    // idempotente es lo que permite a la cola borrar la entrada. Va ANTES del
    // guardado: si no, el CAS de `saveAnswersWithClient` fallaría con la
    // versión que el cliente traía desde antes de la primera entrega, y el
    // reintento parecería un conflicto real y se repetiría para siempre.
    const [existing] = await tx.select().from(preventionInspectionRuns)
      .where(eq(preventionInspectionRuns.id, data.runId)).limit(1)
    if (!existing) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:inspections:execute", existing.worksiteId)
    if ((existing.status === "completed" || existing.status === "reviewed") && existing.executedByUserId === access.userId) {
      const [template] = await tx.select({ numbers: preventionInspectionTemplates.pdtpActivityNumbers })
        .from(preventionInspectionTemplates)
        .where(eq(preventionInspectionTemplates.id, existing.templateId)).limit(1)
      const activityNumbers = Array.isArray(template?.numbers) ? template.numbers : []
      const target = await resolvePdtpAccreditationTarget({ sourceType: "inspeccion", sourceId: existing.templateId, eventType: "execute", legacyActivityNumbers: activityNumbers }, tx)
      if ((target.catalogActivityIds?.length || target.activityNumbers?.length) && existing.executedAt) {
        await onInspectionCompleted({
          runId: existing.id,
          worksiteId: existing.worksiteId,
          completedAt: existing.executedAt,
          completedByUserId: existing.executedByUserId,
          ...target,
        }, tx)
      }
      return {
        run: existing,
        findings: 0,
        compliancePercent: existing.compliancePercent,
        officialCompliancePercent: existing.officialComplianceBasisPoints === null ? null : existing.officialComplianceBasisPoints / 100,
        normalizedCompliancePercent: existing.normalizedComplianceBasisPoints === null ? null : existing.normalizedComplianceBasisPoints / 100,
        alreadyCompleted: true as const,
      }
    }

    // El guardado ya valida alcance, estado editable y versión, y devuelve el
    // run con la versión avanzada — de ahí que el `expectedVersion` posterior
    // se tome de su resultado y no del input.
    let expectedVersion = data.expectedVersion
    if (data.answers) {
      const saved = await saveAnswersWithClient(tx, {
        runId: data.runId,
        expectedVersion: data.expectedVersion,
        answers: data.answers,
        locationLatitude: data.locationLatitude,
        locationLongitude: data.locationLongitude,
        access,
      })
      expectedVersion = saved.run.version
    }

    const [run] = await tx.select().from(preventionInspectionRuns)
      .where(eq(preventionInspectionRuns.id, data.runId)).limit(1)
    if (!run) throw new Error(NOT_FOUND)
    if (run.version !== expectedVersion) throw new Error("La inspección cambió mientras la editabas. Recarga y reintenta.")
    if (run.status === "completed" || run.status === "reviewed") throw new Error("La inspección ya fue ejecutada.")
    if (run.status === "cancelled") throw new Error("Una inspección cancelada no puede ejecutarse.")

    const [template] = await tx.select().from(preventionInspectionTemplates)
      .where(eq(preventionInspectionTemplates.id, run.templateId)).limit(1)
    if (!template) throw new Error(NOT_FOUND)
    const definition = template.definitionSnapshot as unknown as ChecklistDefinition
    const items = itemsFromDefinition(definition)
    if (template.sourceDefinitionCode === "inspeccion_no_planeada") {
      const participants = await tx.select({ id: preventionInspectionRunParticipants.id })
        .from(preventionInspectionRunParticipants)
        .where(eq(preventionInspectionRunParticipants.runId, run.id))
      if (participants.length === 0) throw new Error("El Anexo 08 exige registrar al menos una persona participante.")
    }

    const stored = await tx.select().from(preventionInspectionAnswers)
      .where(eq(preventionInspectionAnswers.runId, run.id))
    const answers: InspectionAnswerInput[] = stored.map((row) => ({
      sectionId: row.sectionId,
      itemId: row.itemId,
      result: row.result as InspectionAnswerInput["result"],
      comment: row.comment,
      // `assessRunCompletion` exige contenido en los ítems que no puntúan.
      value: row.value,
      // Sin esto la puerta `unconfirmed_critical` nunca ve la marca: el
      // servidor reconstruye las respuestas desde la BD y esta proyección la
      // descartaba, así que el bloqueo sólo existía en el cliente — que es
      // justo donde no vale.
      needsConfirmation: row.needsConfirmation,
    }))

    /*
     * INS-002: se resuelven los firmantes declarados en una sola consulta. Un
     * `userId` que no existe o está inactivo **no hace fallar el cierre** —el
     * acta puede venir de una cola offline con un id rancio, y perder el acta
     * entera por eso sería peor—: esa firma pasa a declarada, que es lo que de
     * verdad es.
     */
    const declaredSignerIds = [...new Set(
      (data.closingAct?.signatures ?? []).flatMap((item) => (item.userId ? [item.userId] : [])),
    )]
    const signerById = new Map(
      (declaredSignerIds.length === 0 ? [] : await tx.select({ id: users.id, name: users.name })
        .from(users)
        .where(and(inArray(users.id, declaredSignerIds), eq(users.isActive, true)))
      ).map((row) => [row.id, row] as const),
    )

    const closingSpec = closingActFromDefinition(template.definitionSnapshot as unknown as ChecklistDefinition)
    const completion = assessRunCompletion(items, answers, { spec: closingSpec, act: data.closingAct })
    if (!completion.allowed) {
      throw new Error(`No se puede declarar ejecutada: ${completion.blockers.map((item) => item.detail).join(", ")}`)
    }

    const summary = summarizeCompliance(items, answers, definition.scoringPolicy)
    const derived = deriveFindings(items, answers)
    const answerId = new Map(stored.map((row) => [`${row.sectionId}::${row.itemId}`, row.id]))
    const now = nowIso()

    /* Rehacer los hallazgos DERIVADOS mantiene la coherencia si se corrigió una
     * respuesta antes de cerrar; los que ya tienen CAPA no se tocan.
     *
     * El filtro por `origin` no es decorativo: sin él este borrado se llevaba
     * también las desviaciones que una persona registró a mano —abiertas y sin
     * CAPA, como cualquier hallazgo nuevo—, así que declarar ejecutada una
     * inspección de área borraba justamente lo que se había ido a buscar. */
    await tx.delete(preventionInspectionFindings).where(and(
      eq(preventionInspectionFindings.runId, run.id),
      eq(preventionInspectionFindings.origin, "derived"),
      eq(preventionInspectionFindings.status, "open"),
      sql`${preventionInspectionFindings.capaActionId} IS NULL`,
    ))
    if (derived.length > 0) {
      await tx.insert(preventionInspectionFindings).values(derived.map((finding) => ({
        id: `insfnd-${nanoid()}`,
        runId: run.id,
        answerId: answerId.get(`${finding.sectionId}::${finding.itemId}`) ?? null,
        description: finding.description,
        danoPotencial: finding.danoPotencial,
        criticality: finding.criticality,
        origin: "derived" as const,
        status: "open" as const,
      })))
    }

    /* Cierre al completar, para los instrumentos donde declarar ejecutada YA es
     * la revisión (`closesOnCompletion`). Sin esto, un reporte por equipo y por
     * turno quedaba "Esperando revisión" para siempre y ese indicador dejaba de
     * servir para lo que sí necesita atención.
     *
     * NO se salta la regla del hallazgo que exige acción correctiva: si la
     * ejecución levantó alguno sin CAPA, la inspección se queda en `completed` y
     * entra a la cola igual. Un reporte con los frenos en falla tiene que caer
     * en las manos de alguien, y a esta altura nadie tuvo ocasión de derivar la
     * CAPA todavía. Se miran TODOS los hallazgos abiertos del run, no sólo los
     * recién derivados: uno de una ejecución anterior que sobrevivió a un
     * reabrir también bloquea. */
    const openFindings = await tx.select({
      criticality: preventionInspectionFindings.criticality,
      capaActionId: preventionInspectionFindings.capaActionId,
    })
      .from(preventionInspectionFindings)
      .where(and(
        eq(preventionInspectionFindings.runId, run.id),
        ne(preventionInspectionFindings.status, "closed"),
      ))
    const blockedByFinding = openFindings.some((finding) => requiresCapa(finding.criticality) && !finding.capaActionId)
    const autoCloses = Boolean(
      (template.definitionSnapshot as unknown as ChecklistDefinition)?.closesOnCompletion,
    ) && !blockedByFinding

    const [updated] = await tx.update(preventionInspectionRuns).set({
      status: autoCloses ? "reviewed" : "completed",
      executedByUserId: access.userId,
      executedAt: now,
      /* Quien transcribió es quien revisó: es literalmente lo que hizo al
       * pasar el papel al sistema, y el CHECK de la tabla exige los dos campos
       * juntos. Queda dicho en el comentario para que la trazabilidad no
       * insinúe una segunda persona que no existió. */
      ...(autoCloses ? {
        reviewedByUserId: access.userId,
        reviewedAt: now,
        reviewComment: "Cerrada al declararse ejecutada: transcribir el reporte firmado es su revisión.",
      } : {}),
      conformingCount: summary.conforming,
      partialCount: summary.partial,
      nonConformingCount: summary.nonConforming,
      notApplicableCount: summary.notApplicable,
      compliancePercent: summary.compliancePercent,
      officialComplianceBasisPoints: summary.officialComplianceBasisPoints,
      normalizedComplianceBasisPoints: summary.normalizedComplianceBasisPoints,
      closingResult: data.closingAct?.result ?? null,
      closingRestrictions: data.closingAct?.restrictions ?? null,
      // `signedAt` lo estampa el servidor: la hora de firma no la declara el
      // cliente. Firma registrada (rol + nombre + momento), sin trazo.
      /*
       * INS-002 (auditoría 2026-09-14): un `userId` tecleado no se creía; ahora
       * se comprueba contra el registro de usuarios activos y, cuando existe, el
       * nombre lo pone la plataforma en vez del formulario. Una firma sin
       * `userId` —el representante del mandante, por ejemplo— sigue admitida,
       * pero queda marcada como declarada y no como verificada.
       */
      closingSignatures: data.closingAct
        ? data.closingAct.signatures.map((item) => {
            const verifiedUser = item.userId ? signerById.get(item.userId) : undefined
            return {
              role: item.role,
              name: verifiedUser?.name ?? item.name,
              userId: verifiedUser?.id ?? null,
              verified: Boolean(verifiedUser),
              capturedByUserId: access.userId,
              signedAt: now,
            }
          })
        : null,
      version: run.version + 1,
      updatedAt: now,
    }).where(and(eq(preventionInspectionRuns.id, run.id), eq(preventionInspectionRuns.version, expectedVersion))).returning()
    if (!updated) throw new Error("La inspección cambió mientras la editabas. Recarga y reintenta.")

    // `nextDueOn` NO se toca aquí (D-3, auditoría 2026-08-18). Lo mueve sólo
    // el materializador (`lib/services/prevention-inspection-scheduler.ts`) al
    // crear la ejecución del período. Avanzarlo también al completar contaba
    // dos veces el mismo ciclo, y hacerlo desde `hoy` en vez de desde el
    // vencimiento arrastraba el calendario legal (A-12).

    // Función #11: cerrar el círculo del inventario. `lastInspectedAt` y
    // `nextInspectionAt` existían con sus índices y sus alertas de vencimiento,
    // y nadie los escribía nunca desde una inspección real.
    if (run.subjectResourceId) {
      const today = todayInChile()
      let nextInspectionAt: string | null = null
      if (run.programId) {
        const [program] = await tx.select({ intervalDays: preventionInspectionPrograms.intervalDays })
          .from(preventionInspectionPrograms)
          .where(eq(preventionInspectionPrograms.id, run.programId)).limit(1)
        if (program) nextInspectionAt = nextDueAfter(today, program.intervalDays, today)
      }
      await tx.update(preventionEmergencyResources).set({
        lastInspectedAt: today,
        // Sólo se pisa si esta inspección define una cadencia; una ejecución
        // suelta no debe borrar la fecha que puso el módulo de emergencias.
        ...(nextInspectionAt ? { nextInspectionAt } : {}),
        updatedAt: now,
      }).where(eq(preventionEmergencyResources.id, run.subjectResourceId))
    }

    await history(tx, { entityType: "run", entityId: run.id, worksiteId: run.worksiteId, changeType: "completed", reason: `Ejecutada con ${summary.nonConforming} incumplimiento(s) y ${derived.length} hallazgo(s)`, beforeState: run, afterState: updated, actorUserId: access.userId })
    await recordOperationalActivity({
      eventType: "inspection.completed",
      module: "inspecciones",
      entityType: "inspection_run",
      entityId: updated.id,
      entityCode: updated.code,
      worksiteId: updated.worksiteId,
      actorUserId: access.userId,
      payload: { nonConforming: summary.nonConforming, findings: derived.length },
    }, tx)

    // Auto-acreditación PDTP: actividades declaradas en la plantilla. Comparte
    // la transacción con el cierre: nunca puede quedar el run completado sin su
    // cumplimiento ni una ejecución PDTP sin la inspección que la respalda.
    const pdtpActivityNumbers = Array.isArray((template as { pdtpActivityNumbers?: number[] }).pdtpActivityNumbers)
      ? (template as { pdtpActivityNumbers?: number[] }).pdtpActivityNumbers!
      : []
    const target = await resolvePdtpAccreditationTarget({ sourceType: "inspeccion", sourceId: run.templateId, eventType: "execute", legacyActivityNumbers: pdtpActivityNumbers }, tx)
    if (target.catalogActivityIds?.length || target.activityNumbers?.length) {
      await onInspectionCompleted({
        runId: run.id,
        worksiteId: run.worksiteId,
        completedAt: updated.executedAt ?? now,
        completedByUserId: access.userId,
        ...target,
      }, tx)
    }

    // El informe queda en Cloudreve con el estado que dejó este cierre. La
    // versión del run identifica la copia: reabrir y volver a cerrar es otra.
    await enqueueGeneratedDocumentTx(tx, {
      kind: "inspeccion",
      entityId: updated.id,
      milestone: updated.status === "reviewed" ? "revisada" : "completada",
      revision: updated.version,
      worksiteId: updated.worksiteId,
      occurredAt: now,
      actorUserId: access.userId,
    })

    return {
      run: updated,
      findings: derived.length,
      compliancePercent: summary.compliancePercent,
      officialCompliancePercent: summary.officialComplianceBasisPoints === null ? null : summary.officialComplianceBasisPoints / 100,
      normalizedCompliancePercent: summary.normalizedComplianceBasisPoints === null ? null : summary.normalizedComplianceBasisPoints / 100,
    }
  })

  // Un reintento offline no vuelve a notificar. El `dedupeKey` ya lo evitaría,
  // pero salir temprano ahorra la consulta de destinatarios.
  if ("alreadyCompleted" in result) return result

  // Cerrada al completar: no hay nada esperando a nadie.
  if (result.run.status === "reviewed") return result

  // A-08: quien puede revisar necesita enterarse de que hay algo esperándolo.
  // Post-commit y sin propagar el error, igual que la acreditación PDTP: una
  // notificación caída no puede revertir una inspección ya ejecutada.
  await notifySafely("pendiente de revisión", async () => {
    const reviewers = (await getUserIdsWithPermissionForWorksite("prevention:inspections:review", result.run.worksiteId))
      // Quien ejecutó no puede revisar (lo bloquea `assessRunReview`), así que
      // avisarle sería mandarlo a una acción que le va a ser negada.
      .filter((userId) => userId !== access.userId)
    if (reviewers.length === 0) return
    await createNotifications(reviewers, {
      type: "system_alert",
      title: "Inspección pendiente de revisión",
      body: `${result.run.code} fue declarada ejecutada${result.findings > 0 ? ` con ${result.findings} hallazgo(s)` : ""}.`,
      entityType: "inspection_run",
      entityId: result.run.id,
      entityHref: `/prevencion/inspecciones/${result.run.id}`,
      dedupeKey: `inspection:review:${result.run.id}`,
    })
  })

  return result
}

/**
 * Envía una notificación sin dejar que su fallo tumbe la operación de negocio
 * que ya se confirmó. Mismo criterio que `onInspectionCompleted`.
 */
async function notifySafely(label: string, send: () => Promise<void>) {
  try {
    await send()
  } catch (error) {
    logger.error({ err: error }, `[inspections] no se pudo notificar (${label})`)
  }
}

/**
 * Ítem del que se lee la lectura del medidor al derivar una mantención.
 *
 * Acopla el motor genérico a un `itemId` de una plantilla concreta, y eso es
 * deliberado: es el único checklist del catálogo que captura el horómetro, y
 * una plantilla que no lo declare simplemente deriva la mantención sin lectura
 * (`null`), no falla. La alternativa —declarar el rol del ítem en
 * `ChecklistItem`— es un campo nuevo en las 13 definiciones para un solo caso.
 * Si aparece un segundo checklist con medidor, ése es el momento de moverlo.
 */
const METER_ITEM_ID = "horometro_inicio"

/**
 * Lectura declarada en el run para el ítem de horómetro/odómetro, si la
 * plantilla lo pide. Viaja a la mantención derivada, que es lo que después
 * cruza `getUsageMaintenanceAlerts` contra los umbrales por uso.
 */
async function readMeterFromRun(client: Client, runId: string): Promise<number | null> {
  const [answer] = await client.select({ value: preventionInspectionAnswers.value })
    .from(preventionInspectionAnswers)
    .where(and(
      eq(preventionInspectionAnswers.runId, runId),
      eq(preventionInspectionAnswers.itemId, METER_ITEM_ID),
    )).limit(1)
  if (!answer?.value) return null
  const parsed = Number(answer.value.replace(",", "."))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/** Deriva un hallazgo a CAPA común con prioridad y plazo según su criticidad. */
export async function createFindingCapa(input: unknown, access: InspectionAccess) {
  const data = z.object({
    findingId: z.string().min(1),
    // I-24: alineado con el mínimo de los diálogos de motivo (ReasonDialog,
    // TRANSITION_REASON_MIN_LENGTH) — 3 caracteres no describe una acción correctiva.
    actionDescription: z.string().trim().min(10).max(3000),
    responsibleUserId: z.string().min(1),
    immediateMeasure: z.string().trim().max(3000).nullable().optional(),
  }).parse(input)

  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select({ finding: preventionInspectionFindings, run: preventionInspectionRuns })
      .from(preventionInspectionFindings)
      .innerJoin(preventionInspectionRuns, eq(preventionInspectionFindings.runId, preventionInspectionRuns.id))
      .where(eq(preventionInspectionFindings.id, data.findingId)).limit(1)
    if (!row) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:inspections:execute", row.run.worksiteId)
    if (row.finding.capaActionId) throw new Error("El hallazgo ya tiene una acción CAPA enlazada.")

    const { priority, dueInDays, requiresImmediateStop } = capaPriorityForCriticality(row.finding.criticality)
    const capa = await createCapaActionWithClient(tx, {
      sourceType: "inspection",
      sourceId: row.run.id,
      worksiteId: row.run.worksiteId,
      finding: row.finding.description,
      potentialDamageDescription: row.finding.potentialDamageDescription,
      immediateMeasure: data.immediateMeasure ?? row.finding.immediateMeasure ?? null,
      actionDescription: data.actionDescription,
      responsibleUserId: data.responsibleUserId,
      priority,
      targetDate: addDays(todayInChile(), dueInDays),
      evidenceRequired: true,
      requiresImmediateStop,
      danoPotencial: row.finding.danoPotencial as "leve" | "moderado" | "grave" | "fatal" | null,
      normativaLegal: row.finding.applicableLaw,
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

    // Mantención correctiva automática. Se engancha acá y no en `completeInspectionRun`
    // porque completar borra y recrea los hallazgos abiertos sin CAPA: colgarlo
    // de ahí dejaría órdenes huérfanas cada vez que alguien reabre y vuelve a
    // cerrar. Derivar, en cambio, es el acto deliberado que confirma el hallazgo
    // y, cuando el sujeto es un equipo, debe abrir siempre su trabajo correctivo.
    let maintenanceId: string | null = null
    if (row.run.subjectVehicleId) {
      const meter = await readMeterFromRun(tx, row.run.id)
      const [vehicle] = await tx.select({ meterType: fuelVehicles.meterType, worksiteId: fuelVehicles.worksiteId })
        .from(fuelVehicles).where(eq(fuelVehicles.id, row.run.subjectVehicleId)).limit(1)
      // El permiso se validó contra la faena de la inspección, pero la mantención
      // se escribe en la faena del equipo. Si el equipo ya fue trasladado, derivar
      // crearía una orden en una faena que este actor no autorizó.
      if (!vehicle) throw new Error("El equipo de la inspección ya no existe.")
      if (vehicle.worksiteId !== row.run.worksiteId) {
        throw new Error("El equipo pertenece a otra faena; actualiza la inspección antes de derivar la mantención.")
      }
      maintenanceId = await createMaintenanceRecordWithClient(tx, {
        vehicleId: row.run.subjectVehicleId,
        supplierId: "",
        costCenterId: "",
        // El plazo de la CAPA manda: la reparación y su acción correctiva
        // vencen el mismo día, o el taller y Prevención llevan dos calendarios.
        maintenanceDate: capa.targetDate,
        maintenanceType: "correctiva",
        status: "scheduled",
        odometerReading: vehicle.meterType === "odometer" ? meter : null,
        hourMeterReading: vehicle.meterType === "hour_meter" ? meter : null,
        netAmount: 0,
        taxAmount: 0,
        totalAmount: 0,
        documentNumber: "",
        documentName: "",
        notes: `Deriva de ${row.run.code} · ${row.finding.description}`,
        inspectionFindingId: data.findingId,
      }, { actorUserId: access.userId, vehicle })
    }

    return { finding: updated, capaId: capa.id, maintenanceId, run: row.run, criticality: row.finding.criticality }
  })

  // Propuesta de fuera de servicio: se avisa, no se escribe. Bloquear el equipo
  // solo pararía la faena por un error de digitación, y quien decide sacarlo de
  // circulación es quien administra la flota. La confirmación es un clic con
  // `combustibles:manage_vehicles` — ver `stopVehicleForFinding`.
  // Post-commit y sin propagar el error, igual que el resto de los avisos.
  if (result.run.subjectVehicleId && ["high", "critical"].includes(result.criticality)) {
    const vehicleId = result.run.subjectVehicleId
    await notifySafely("equipo con falla grave", async () => {
      const targets = await getUserIdsWithPermissionForWorksite("combustibles:manage_vehicles", result.run.worksiteId)
      if (targets.length === 0) return
      await createNotifications(targets, {
        type: "system_alert",
        title: result.criticality === "critical" ? "Equipo con falla crítica" : "Equipo con falla grave",
        body: `${result.run.subjectLabel ?? "Equipo"} · ${result.run.code}: ${result.finding.description}. Revisa si corresponde sacarlo de servicio.`,
        entityType: "fuel_vehicle",
        entityId: vehicleId,
        entityHref: `/flota/${vehicleId}`,
        // Una vez por hallazgo: el aviso es la propuesta, no un recordatorio.
        dedupeKey: `inspection:vehicle-stop:${result.finding.id}`,
      })
    })
  }

  return result
}

/**
 * Confirma sacar de servicio el equipo de un hallazgo. Puerta aparte y con
 * permiso de flota a propósito: quien ejecuta la inspección detecta la falla,
 * pero detener un equipo es una decisión de quien administra la flota.
 */
export async function stopVehicleForFinding(input: unknown, access: InspectionAccess) {
  const data = z.object({
    findingId: z.string().min(1),
    reason: z.string().trim().min(TRANSITION_REASON_MIN_LENGTH).max(3000),
  }).parse(input)

  return db.transaction(async (tx) => {
    const [row] = await tx.select({ finding: preventionInspectionFindings, run: preventionInspectionRuns })
      .from(preventionInspectionFindings)
      .innerJoin(preventionInspectionRuns, eq(preventionInspectionFindings.runId, preventionInspectionRuns.id))
      .where(eq(preventionInspectionFindings.id, data.findingId)).limit(1)
    if (!row) throw new Error(NOT_FOUND)
    // Alcance de faena del actor; el permiso de flota lo exige la server action.
    if (!scopeAllows(access.scope, row.run.worksiteId)) throw new Error(NOT_FOUND)
    if (!row.run.subjectVehicleId) throw new Error("La inspección no tiene un equipo como sujeto.")

    await setVehicleOperationalStatus(tx, {
      vehicleId: row.run.subjectVehicleId,
      status: "fuera_servicio",
      reason: `${row.run.code} · ${row.finding.description} — ${data.reason}`,
      actorUserId: access.userId,
    })
    await history(tx, {
      entityType: "finding", entityId: row.finding.id, worksiteId: row.run.worksiteId,
      changeType: "vehicle_stopped", reason: data.reason, actorUserId: access.userId,
    })
    return { vehicleId: row.run.subjectVehicleId }
  })
}

/** Revisión y cierre independientes de quien ejecutó. */
export async function reviewInspectionRun(input: unknown, access: InspectionAccess) {
  const data = z.object({
    runId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    reviewComment: z.string().trim().min(10).max(3000),
  }).parse(input)

  return transitionInspectionRun({
    runId: data.runId,
    expectedVersion: data.expectedVersion,
    toStatus: "reviewed",
    reason: data.reviewComment,
  }, access)
}

/**
 * Cierre manual de un hallazgo, para los que no derivaron en CAPA (típicamente
 * bajos y medios, que `assessRunReview` no obliga a derivar).
 *
 * Los que sí tienen CAPA se cierran solos cuando su acción se verifica o
 * cierra — ver la cascada en `transitionCapaActionWithClient`. Cerrar a mano
 * uno con CAPA abierta sería declarar resuelto lo que la acción aún no resolvió.
 */
export async function closeInspectionFinding(input: unknown, access: InspectionAccess) {
  const data = z.object({
    findingId: z.string().min(1),
    reason: z.string().trim().min(TRANSITION_REASON_MIN_LENGTH).max(3000),
  }).parse(input)

  return db.transaction(async (tx) => {
    const [row] = await tx.select({ finding: preventionInspectionFindings, run: preventionInspectionRuns })
      .from(preventionInspectionFindings)
      .innerJoin(preventionInspectionRuns, eq(preventionInspectionFindings.runId, preventionInspectionRuns.id))
      .where(eq(preventionInspectionFindings.id, data.findingId)).limit(1)
    if (!row) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:inspections:review", row.run.worksiteId)
    if (row.finding.status === "closed") throw new Error("El hallazgo ya está cerrado.")
    if (row.finding.capaActionId) {
      throw new Error("El hallazgo tiene una acción CAPA: se cierra al verificar o cerrar esa acción.")
    }

    const now = nowIso()
    const [updated] = await tx.update(preventionInspectionFindings).set({
      status: "closed",
      closedByUserId: access.userId,
      closedAt: now,
      updatedAt: now,
    }).where(and(
      eq(preventionInspectionFindings.id, data.findingId),
      eq(preventionInspectionFindings.status, row.finding.status),
    )).returning()
    if (!updated) throw new Error("El hallazgo cambió mientras lo cerrabas. Recarga y reintenta.")

    await history(tx, {
      entityType: "finding", entityId: data.findingId, worksiteId: row.run.worksiteId,
      changeType: "closed", reason: data.reason,
      beforeState: row.finding, afterState: updated, actorUserId: access.userId,
    })
    return updated
  })
}
