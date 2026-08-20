import { createHash } from "node:crypto"
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm"
import { z } from "zod"
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core"
import { db, type DB, type Tx } from "@/db"
import {
  preventionCapaActions,
  preventionInspectionAnswerEvidence,
  preventionInspectionAnswers,
  preventionInspectionFindings,
  preventionInspectionHistory,
  preventionInspectionPrograms,
  preventionInspectionRunDocuments,
  preventionInspectionRuns,
  preventionInspectionTemplates,
  preventionEmergencyResources,
  fuelVehicles,
  preventionRiskEntries,
  preventionRiskMatrices,
  users,
  worksites,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { recordOperationalActivity } from "@/lib/services/operational-activity"
import { getUserIdsWithPermission, getUserIdsWithPermissionForWorksite } from "@/lib/services/notification-targeting"
import { createNotifications } from "@/lib/services/notifications"
import { logger } from "@/lib/logger"
import {
  addDays,
  assertInspectionRunTransition,
  assessEnrichmentCoverage,
  assessRunCompletion,
  capaPriorityForCriticality,
  closingActFromDefinition,
  deriveFindings,
  nextDueAfter,
  requiresHumanConfirmation,
  summarizeCompliance,
  summarizeTimelyClosure,
  validateAnswerRow,
  FREQUENCY_INTERVAL_DAYS,
  TRANSITION_REASON_MIN_LENGTH,
  type InspectionRunStatus,
  type InspectionAnswerInput,
  type InspectionItemSpec,
} from "@/lib/prevention/inspections"
import { listWorksiteVehicles, setVehicleOperationalStatus, vehicleLabel } from "@/lib/services/fleet"
import { createMaintenanceRecordWithClient } from "@/lib/services/maintenance"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import { CHECKLIST_DEFINITIONS, isNonInspectionDefinition, isPersonEvaluationDefinition } from "@/lib/sst/definitions"
import type { ChecklistDefinition } from "@/lib/sst/types"
import { onInspectionCompleted } from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"
import { codeYear, todayInChile } from "@/lib/utils"

type Client = DB | Tx

export interface InspectionAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

const NOT_FOUND = "Inspección no encontrada o fuera de alcance."

function nowIso() {
  return new Date().toISOString()
}

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function requireAccess(access: InspectionAccess, permission: string, worksiteId?: string) {
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
  await client.insert(preventionInspectionHistory).values({
    id: `pinsh-${nanoid()}`,
    entityType: args.entityType,
    entityId: args.entityId,
    worksiteId: args.worksiteId ?? null,
    changeType: args.changeType,
    reason: args.reason,
    beforeState: args.beforeState ?? null,
    afterState: args.afterState ?? null,
    actorUserId: args.actorUserId ?? null,
  })
}

/* ── Plantillas ───────────────────────────────────────────────────────────── */

const importTemplateSchema = z.object({
  definitionCode: z.string().min(1),
  kind: z.enum(["inspection", "observation", "audit"]).default("inspection"),
  versionLabel: z.string().trim().min(1).max(80).optional(),
  /**
   * Actividades del PDTP (campo `n`) que esta plantilla acredita al completar
   * un run. Sin esto el conector `onInspectionCompleted` es un no-op y la
   * inspección nunca llega al programa anual — que era el estado de todas las
   * plantillas hasta 2026-08-04.
   */
  pdtpActivityNumbers: z.array(z.number().int().positive()).max(20).optional(),
})

/**
 * Aplana la definición de checklist a la especificación que consume el motor.
 * `countsForCompliance` respeta la sección, igual que el cálculo del PDTP.
 */
export function itemsFromDefinition(definition: ChecklistDefinition): InspectionItemSpec[] {
  const items: InspectionItemSpec[] = []
  // Piso de seguridad: un `definitionSnapshot` sin `sections` (fixture de
  // prueba insertado a mano, o un futuro snapshot legado incompleto) no debe
  // reventar el listado entero de plantillas — sólo esa plantilla queda sin
  // ítems calculables. `importInspectionTemplate` siempre guarda una
  // definición real, así que esto es defensa, no el camino esperado.
  if (!Array.isArray(definition.sections)) return items
  for (const section of definition.sections) {
    for (const item of section.items) {
      items.push({
        sectionId: section.id,
        itemId: item.id,
        label: item.label,
        required: item.required ?? false,
        countsForCompliance: section.countsForCompliance ?? true,
        danoPotencial: item.danoPotencial ?? null,
        // H-04 (AUDITORIA_BUGS_2026-08-05.md): antes se descartaba acá, y el
        // motor perdía la escala B/R/M del ítem sin poder ofrecer 'partial'.
        kind: item.kind,
        // B-08: sin estos, la UI no puede pintar un `select` ni orientar un
        // campo de texto — y esos ítems quedaban sin forma de responderse.
        options: item.options,
        placeholder: item.placeholder,
      })
    }
  }
  return items
}

/**
 * Hash del contenido del cuestionario. Fuente única: `importInspectionTemplate`
 * lo calcula al congelar el snapshot y `listInspectionTemplates` lo recalcula
 * para detectar deriva. Si las dos expresiones divergieran, toda plantilla
 * aparecería derivada (A-03, auditoría 2026-08-18).
 */
export function contentHashOf(definition: ChecklistDefinition | Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(definition)).digest("hex")
}

/**
 * Violación de índice único en Postgres (23505) sobre la constraint indicada.
 *
 * Recorre la cadena de `cause`: drizzle envuelve el error del driver en un
 * `DrizzleQueryError`, así que `code` y `constraint_name` no están en el objeto
 * de primer nivel — mirar sólo ahí hacía que el mensaje legible nunca saltara.
 */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth++) {
    const candidate = current as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown }
    if (candidate.code === "23505" && (candidate.constraint_name === constraint || candidate.constraint === constraint)) {
      return true
    }
    current = candidate.cause
  }
  return false
}

/**
 * Retira la versión vigente anterior del mismo código. La usan las dos puertas
 * que publican: incorporar (el camino normal) y aprobar un borrador heredado.
 */
async function supersedePreviousApproved(tx: Tx, args: { code: string; keepTemplateId: string; now: string }) {
  await tx.update(preventionInspectionTemplates).set({
    status: "superseded",
    supersededAt: args.now,
    supersededByTemplateId: args.keepTemplateId,
    version: sql`${preventionInspectionTemplates.version} + 1`,
    updatedAt: args.now,
  }).where(and(
    eq(preventionInspectionTemplates.code, args.code),
    eq(preventionInspectionTemplates.status, "approved"),
    ne(preventionInspectionTemplates.id, args.keepTemplateId),
  ))
}

/**
 * Incorpora una definición SST existente como plantilla del motor transversal.
 * Las evaluaciones de personas quedan fuera a propósito: la auditoría pide no
 * mezclar inspecciones de activos con evaluación de trabajadores.
 *
 * Nace **vigente** (`approved`). El contenido no lo redacta nadie aquí: viene
 * de `lib/sst/definitions/`, ya versionado y revisado en el repositorio — el
 * mismo criterio con el que `ensurePdtp2026InspectionTemplates` instala las
 * plantillas del programa 2026 aprobadas. Pedir un segundo par de ojos sobre
 * una copia literal del catálogo dejaba la plantilla inservible en toda
 * instalación con un solo prevencionista, porque quien la incorpora no puede
 * aprobarla.
 *
 * Reimportar un código ya incorporado sigue siendo el camino para versionar, y
 * ahora reemplaza (`superseded`) a la vigente en el acto. Lo único que no se
 * admite es repetir la misma `versionLabel` (A-02/C-10).
 */
export async function importInspectionTemplate(input: unknown, access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:manage")
  const data = importTemplateSchema.parse(input)

  if (isPersonEvaluationDefinition(data.definitionCode)) {
    throw new Error("Las evaluaciones de personas no se incorporan al motor de inspecciones.")
  }
  // Se comprueba acá y no sólo al listar: el código de la definición llega por
  // la acción, así que filtrar únicamente el catálogo dejaría la puerta abierta.
  if (isNonInspectionDefinition(data.definitionCode)) {
    throw new Error("Este formulario no es un instrumento del motor de inspecciones.")
  }
  const definition = CHECKLIST_DEFINITIONS[data.definitionCode]
  if (!definition) throw new Error("La definición de checklist no existe en el catálogo.")

  // C-05: el motor aplana las secciones e ignora `appliesWhen` (visibilidad por
  // cargo) y `requiresPermission` (gate de acceso). Aceptar en silencio una
  // definición que los declare exigiría responder secciones que no aplican y
  // expondría las restringidas. Ninguna de las definiciones importables los usa
  // hoy, así que esto es preventivo: sólo salta si alguien agrega una.
  const gated = (definition.sections ?? []).find((section) => section.appliesWhen?.length || section.requiresPermission)
  if (gated) {
    throw new Error(`La sección "${gated.title}" declara visibilidad condicional, que el motor de inspecciones no aplica. No puede incorporarse.`)
  }

  const versionLabel = data.versionLabel ?? definition.version
  const snapshot = definition as unknown as Record<string, unknown>
  const contentHash = contentHashOf(snapshot)

  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(preventionInspectionTemplates).values({
        id: `instpl-${nanoid()}`,
        code: definition.code,
        versionLabel,
        name: definition.title,
        kind: data.kind,
        sourceDefinitionCode: data.definitionCode,
        definitionSnapshot: snapshot,
        contentHash,
        // Nace en borrador: incorporar y habilitar son dos actos distintos, y
        // el segundo deja constancia de quién puso el instrumento en uso.
        status: "draft",
        legalFramework: definition.legalFramework?.join(" · ") ?? null,
        pdtpActivityNumbers: data.pdtpActivityNumbers?.length ? data.pdtpActivityNumbers : null,
        authorUserId: access.userId,
      }).returning()
      if (!created) throw new Error("No se pudo incorporar la plantilla.")

      // El reemplazo de la versión vigente lo hace ahora `approveInspectionTemplate`,
      // no esto: desde que incorporar deja un borrador, jubilar acá a la que
      // está en uso la sacaría de circulación por un borrador que quizás nadie
      // apruebe, y la faena se quedaría sin instrumento.
      await history(tx, { entityType: "template", entityId: created.id, changeType: "imported", reason: `Definición ${data.definitionCode} incorporada como borrador ${versionLabel}`, afterState: created, actorUserId: access.userId })
      return created
    })
  } catch (error) {
    // C-10: sin esto el usuario veía el texto crudo de Postgres
    // ("duplicate key value violates unique constraint …").
    if (isUniqueViolation(error, "prevention_inspection_template_version_unique")) {
      throw new Error(`Ya existe la versión "${versionLabel}" de la plantilla ${definition.code}. Usa otra etiqueta de versión.`)
    }
    throw error
  }
}

/**
 * Declara qué actividades del PDTP acredita la plantilla. Editable mientras la
 * plantilla esté vigente; una reemplazada ya no acredita nada.
 *
 * No toca `contentHash` a propósito — el hash cubre el cuestionario
 * (`definitionSnapshot`), no el cableado al programa anual. Cambiar a qué
 * actividad acredita no altera la evidencia de lo que se preguntó, y por eso
 * no hace falta el borrador: restringirlo ahí no dejaba ninguna ventana para
 * declararlo, ahora que incorporar publica.
 */
export async function setInspectionTemplatePdtpActivities(input: unknown, access: InspectionAccess) {
  const data = z.object({
    templateId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    pdtpActivityNumbers: z.array(z.number().int().positive()).max(20),
  }).parse(input)
  requireAccess(access, "prevention:inspections:manage")

  return db.transaction(async (tx) => {
    const [template] = await tx.select().from(preventionInspectionTemplates)
      .where(eq(preventionInspectionTemplates.id, data.templateId)).limit(1)
    if (!template) throw new Error(NOT_FOUND)
    if (template.version !== data.expectedVersion) throw new Error("La plantilla cambió mientras la editabas. Recarga y reintenta.")
    if (template.status === "superseded") throw new Error("Una plantilla reemplazada ya no puede cambiar sus actividades PDTP.")

    const now = nowIso()
    const numbers = data.pdtpActivityNumbers.length > 0 ? [...new Set(data.pdtpActivityNumbers)].sort((a, b) => a - b) : null
    const [updated] = await tx.update(preventionInspectionTemplates).set({
      pdtpActivityNumbers: numbers,
      version: template.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionInspectionTemplates.id, template.id),
      eq(preventionInspectionTemplates.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La plantilla cambió mientras la editabas. Recarga y reintenta.")
    await history(tx, {
      entityType: "template", entityId: template.id, changeType: "pdtp_activities_set",
      reason: numbers ? `Acredita actividades PDTP ${numbers.join(", ")}` : "Sin acreditación PDTP",
      beforeState: template, afterState: updated, actorUserId: access.userId,
    })
    return updated
  })
}

/**
 * Publica un borrador heredado. Desde que incorporar deja la plantilla vigente
 * ya no nacen borradores nuevos, pero los que quedaron de antes necesitan esta
 * puerta para poder usarse. Sigue exigiendo un aprobador distinto del autor.
 */
export async function approveInspectionTemplate(input: unknown, access: InspectionAccess) {
  const data = z.object({ templateId: z.string().min(1), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(10).max(2000) }).parse(input)
  requireAccess(access, "prevention:inspections:approve")

  return db.transaction(async (tx) => {
    const [template] = await tx.select().from(preventionInspectionTemplates)
      .where(eq(preventionInspectionTemplates.id, data.templateId)).limit(1)
    if (!template) throw new Error(NOT_FOUND)
    if (template.version !== data.expectedVersion) throw new Error("La plantilla cambió mientras la revisabas. Recarga y reintenta.")
    if (template.status !== "draft") throw new Error("Sólo una plantilla en borrador puede aprobarse.")
    // Sin segregación en plantillas, a diferencia de las ejecuciones. El
    // contenido no lo redacta nadie acá: viene del catálogo versionado en el
    // repositorio, ya revisado, y quien "incorpora" sólo elige cuál instalar.
    // Exigir un segundo par de ojos sobre una copia literal no revisaba nada y
    // dejaba el instrumento inservible cuando el Jefe de Prevención era quien
    // lo instalaba. La segregación que sí importa —que el revisor de una
    // inspección no sea quien la ejecutó— sigue intacta en `assessRunReview`.

    const now = nowIso()
    // Aprobar una versión reemplaza a la anterior vigente del mismo código.
    await supersedePreviousApproved(tx, { code: template.code, keepTemplateId: template.id, now })

    const [updated] = await tx.update(preventionInspectionTemplates).set({
      status: "approved",
      approvedByUserId: access.userId,
      approvedAt: now,
      version: template.version + 1,
      updatedAt: now,
    }).where(and(eq(preventionInspectionTemplates.id, template.id), eq(preventionInspectionTemplates.version, data.expectedVersion))).returning()
    if (!updated) throw new Error("La plantilla cambió mientras la revisabas. Recarga y reintenta.")
    await history(tx, { entityType: "template", entityId: template.id, changeType: "approved", reason: data.reason, beforeState: template, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

/**
 * Retira una plantilla del uso.
 *
 * Borra la fila si nunca se usó; si tiene ejecuciones o programaciones, la
 * marca `superseded`. Esa asimetría no es una comodidad: las ejecuciones son
 * evidencia legal y su plantilla guarda el cuestionario congelado con el que se
 * firmaron. Borrarla dejaría inspecciones sin las preguntas que respondieron
 * —la FK es `ON DELETE restrict` y lo impediría igual, pero con un error de
 * Postgres en vez de una explicación.
 *
 * Hasta ahora no existía ninguna forma de retirar una plantilla desde la
 * plataforma: había que hacerlo por SQL.
 */
export async function retireInspectionTemplate(input: unknown, access: InspectionAccess) {
  const data = z.object({
    templateId: z.string().min(1),
    reason: z.string().trim().min(TRANSITION_REASON_MIN_LENGTH).max(3000),
  }).parse(input)
  requireAccess(access, "prevention:inspections:approve")

  return db.transaction(async (tx) => {
    const [template] = await tx.select().from(preventionInspectionTemplates)
      .where(eq(preventionInspectionTemplates.id, data.templateId)).limit(1)
    if (!template) throw new Error(NOT_FOUND)
    if (template.status === "superseded") throw new Error("La plantilla ya está retirada.")

    const [runRow] = await tx.select({ total: sql<number>`count(*)::int` })
      .from(preventionInspectionRuns)
      .where(eq(preventionInspectionRuns.templateId, template.id))
    const [programRow] = await tx.select({ total: sql<number>`count(*)::int` })
      .from(preventionInspectionPrograms)
      .where(eq(preventionInspectionPrograms.templateId, template.id))
    const runs = runRow?.total ?? 0
    const programs = programRow?.total ?? 0

    const now = nowIso()
    if (runs === 0 && programs === 0) {
      await history(tx, {
        entityType: "template", entityId: template.id, changeType: "deleted",
        reason: data.reason, beforeState: template, actorUserId: access.userId,
      })
      await tx.delete(preventionInspectionTemplates)
        .where(eq(preventionInspectionTemplates.id, template.id))
      return { outcome: "deleted" as const, runs, programs }
    }

    const [updated] = await tx.update(preventionInspectionTemplates).set({
      status: "superseded",
      supersededAt: now,
      version: template.version + 1,
      updatedAt: now,
    }).where(eq(preventionInspectionTemplates.id, template.id)).returning()
    if (!updated) throw new Error("No se pudo retirar la plantilla.")
    await history(tx, {
      entityType: "template", entityId: template.id, changeType: "superseded",
      reason: data.reason, beforeState: template, afterState: updated, actorUserId: access.userId,
    })
    return { outcome: "superseded" as const, runs, programs }
  })
}

/* ── Programación ─────────────────────────────────────────────────────────── */

const programSchema = z.object({
  templateId: z.string().min(1),
  worksiteId: z.string().min(1),
  frequency: z.enum(["daily", "weekly", "biweekly", "monthly", "quarterly", "biannual", "annual", "on_demand"]),
  intervalDays: z.number().int().positive().max(3650).optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  assignedToUserId: z.string().min(1).nullable().optional(),
  riskEntryId: z.string().min(1).nullable().optional(),
  subjectType: z.string().trim().max(120).nullable().optional(),
  /* El sujeto del programa existía como columna desde 0190 y ningún servicio
   * lo escribía ni lo propagaba al run: programar "el extintor del pañol" era
   * imposible. Se activa acá junto con el equipo de flota. */
  subjectResourceId: z.string().min(1).nullable().optional(),
  subjectVehicleId: z.string().min(1).nullable().optional(),
})

export async function createInspectionProgram(input: unknown, access: InspectionAccess) {
  const data = programSchema.parse(input)
  requireAccess(access, "prevention:inspections:manage", data.worksiteId)

  const [template] = await db.select().from(preventionInspectionTemplates)
    .where(eq(preventionInspectionTemplates.id, data.templateId)).limit(1)
  if (!template) throw new Error(NOT_FOUND)
  if (template.status !== "approved") throw new Error("Sólo puede programarse una plantilla aprobada.")
  if (data.riskEntryId) await assertRiskEntryInWorksite(db, data.riskEntryId, data.worksiteId)
  await resolveSubject(db, {
    worksiteId: data.worksiteId,
    subjectResourceId: data.subjectResourceId,
    subjectVehicleId: data.subjectVehicleId,
  })

  const [created] = await db.insert(preventionInspectionPrograms).values({
    id: `insprog-${nanoid()}`,
    templateId: data.templateId,
    worksiteId: data.worksiteId,
    frequency: data.frequency,
    intervalDays: data.intervalDays ?? FREQUENCY_INTERVAL_DAYS[data.frequency] ?? 30,
    nextDueOn: data.startsOn,
    assignedToUserId: data.assignedToUserId ?? null,
    riskEntryId: data.riskEntryId ?? null,
    subjectType: data.subjectType ?? null,
    subjectResourceId: data.subjectResourceId ?? null,
    subjectVehicleId: data.subjectVehicleId ?? null,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo crear la programación.")
  await history(db, { entityType: "program", entityId: created.id, worksiteId: data.worksiteId, changeType: "created", reason: `Programación ${data.frequency} desde ${data.startsOn}`, afterState: created, actorUserId: access.userId })
  return created
}

/**
 * Editar y activar/desactivar una programación (A-10, A-11).
 *
 * No hay borrado físico: `isActive=false` es el borrado. Las ejecuciones ya
 * creadas apuntan al programa con `onDelete: set null`, y borrarlo les quitaría
 * el origen — que es justamente lo que explica por qué existen.
 */
export async function updateInspectionProgram(input: unknown, access: InspectionAccess) {
  const data = z.object({
    programId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    frequency: z.enum(["daily", "weekly", "biweekly", "monthly", "quarterly", "biannual", "annual", "on_demand"]).optional(),
    intervalDays: z.number().int().positive().max(3650).optional(),
    nextDueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    assignedToUserId: z.string().min(1).nullable().optional(),
    riskEntryId: z.string().min(1).nullable().optional(),
    subjectType: z.string().trim().max(120).nullable().optional(),
    subjectResourceId: z.string().min(1).nullable().optional(),
    subjectVehicleId: z.string().min(1).nullable().optional(),
    isActive: z.boolean().optional(),
  }).parse(input)

  return db.transaction(async (tx) => {
    const [program] = await tx.select().from(preventionInspectionPrograms)
      .where(eq(preventionInspectionPrograms.id, data.programId)).limit(1)
    if (!program) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:inspections:manage", program.worksiteId)
    if (program.version !== data.expectedVersion) {
      throw new Error("La programación cambió mientras la editabas. Recarga y reintenta.")
    }
    if (data.riskEntryId) await assertRiskEntryInWorksite(tx, data.riskEntryId, program.worksiteId)
    // `undefined` = no se toca; para validar hay que mirar el valor resultante,
    // no el enviado, o cambiar sólo uno de los dos dejaría pasar el par.
    const nextResourceId = data.subjectResourceId === undefined ? program.subjectResourceId : data.subjectResourceId
    const nextVehicleId = data.subjectVehicleId === undefined ? program.subjectVehicleId : data.subjectVehicleId
    await resolveSubject(tx, {
      worksiteId: program.worksiteId,
      subjectResourceId: nextResourceId,
      subjectVehicleId: nextVehicleId,
    })

    const now = nowIso()
    const [updated] = await tx.update(preventionInspectionPrograms).set({
      frequency: data.frequency ?? program.frequency,
      // Cambiar la frecuencia sin tocar el intervalo dejaría "Mensual" con el
      // intervalo de la frecuencia anterior; el default sigue a la frecuencia
      // salvo que el usuario declare uno propio.
      intervalDays: data.intervalDays
        ?? (data.frequency ? FREQUENCY_INTERVAL_DAYS[data.frequency] ?? program.intervalDays : program.intervalDays),
      nextDueOn: data.nextDueOn ?? program.nextDueOn,
      assignedToUserId: data.assignedToUserId === undefined ? program.assignedToUserId : data.assignedToUserId,
      riskEntryId: data.riskEntryId === undefined ? program.riskEntryId : data.riskEntryId,
      subjectType: data.subjectType === undefined ? program.subjectType : data.subjectType,
      subjectResourceId: nextResourceId,
      subjectVehicleId: nextVehicleId,
      isActive: data.isActive ?? program.isActive,
      version: program.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionInspectionPrograms.id, program.id),
      eq(preventionInspectionPrograms.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La programación cambió mientras la editabas. Recarga y reintenta.")

    await history(tx, {
      entityType: "program", entityId: program.id, worksiteId: program.worksiteId,
      changeType: updated.isActive === program.isActive ? "updated" : (updated.isActive ? "reactivated" : "deactivated"),
      reason: `Programación ${updated.frequency} cada ${updated.intervalDays} día(s), próxima ${updated.nextDueOn}`,
      beforeState: program, afterState: updated, actorUserId: access.userId,
    })
    return updated
  })
}

/**
 * A-09: el diálogo pedía escribir el ID de la MIPER a mano en un campo de
 * texto libre, sin validar existencia ni pertenencia a la faena. Un ID mal
 * tipeado daba una violación de FK cruda.
 */
async function assertRiskEntryInWorksite(client: Client, riskEntryId: string, worksiteId: string) {
  const [entry] = await client.select({ id: preventionRiskEntries.id })
    .from(preventionRiskEntries)
    .innerJoin(preventionRiskMatrices, eq(preventionRiskMatrices.id, preventionRiskEntries.matrixId))
    .where(and(
      eq(preventionRiskEntries.id, riskEntryId),
      eq(preventionRiskMatrices.worksiteId, worksiteId),
    )).limit(1)
  if (!entry) throw new Error("El peligro MIPER no existe o pertenece a otra faena.")
}

/**
 * Comprueba que el programa esté dentro del alcance de faena del usuario.
 *
 * `materializeProgramRuns` corre también desde el cron, que no tiene sesión, y
 * por eso no recibe `InspectionAccess`: cuando lo dispara una persona, el
 * alcance se valida aquí antes de invocarlo.
 */
export async function assertProgramInScope(programId: string, access: InspectionAccess) {
  const [program] = await db.select({ worksiteId: preventionInspectionPrograms.worksiteId })
    .from(preventionInspectionPrograms)
    .where(eq(preventionInspectionPrograms.id, programId)).limit(1)
  if (!program) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:inspections:manage", program.worksiteId)
}

/**
 * Resuelve el sujeto declarado y devuelve la etiqueta a congelar.
 *
 * Puerta única para programa y ejecución: el sujeto debe existir Y pertenecer
 * a la faena. Sin esto, un id de otra faena entra por la acción y filtra el
 * nombre del recurso o la patente ajena. El CHECK
 * `prevention_inspection_run_single_subject` cubre la exclusión mutua en la
 * base; acá se rechaza antes, con un mensaje que se entiende.
 */
async function resolveSubject(
  client: Client,
  args: { worksiteId: string; subjectResourceId?: string | null; subjectVehicleId?: string | null },
): Promise<string | null> {
  if (args.subjectResourceId && args.subjectVehicleId) {
    throw new Error("Una inspección tiene un solo sujeto: recurso de emergencia o equipo, no ambos.")
  }
  if (args.subjectResourceId) {
    const [found] = await client.select({ name: preventionEmergencyResources.name })
      .from(preventionEmergencyResources)
      .where(and(
        eq(preventionEmergencyResources.id, args.subjectResourceId),
        eq(preventionEmergencyResources.worksiteId, args.worksiteId),
      )).limit(1)
    if (!found) throw new Error("El sujeto no existe o pertenece a otra faena.")
    return found.name
  }
  if (args.subjectVehicleId) {
    const [found] = await client.select({ plate: fuelVehicles.plate, code: fuelVehicles.code })
      .from(fuelVehicles)
      .where(and(
        eq(fuelVehicles.id, args.subjectVehicleId),
        eq(fuelVehicles.worksiteId, args.worksiteId),
      )).limit(1)
    if (!found) throw new Error("El equipo no existe o pertenece a otra faena.")
    return vehicleLabel(found)
  }
  return null
}

/**
 * Sujetos inspeccionables de la faena (función #11).
 *
 * Reusa `preventionEmergencyResources`, que ya es el inventario por faena
 * —nombre, tipo, ubicación, serie— con su CRUD y sus alertas de vencimiento.
 * Se lista bajo el alcance de faena de inspecciones, sin exigir permisos del
 * módulo de emergencias: mismo criterio que ya aplica la certificación CPHS
 * para sus lecturas directas de tablas de otros módulos.
 */
export async function listInspectionSubjects(worksiteId: string, access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:view", worksiteId)
  const [resources, vehicles] = await Promise.all([
    db.select({
      id: preventionEmergencyResources.id,
      name: preventionEmergencyResources.name,
      kind: preventionEmergencyResources.kind,
      location: preventionEmergencyResources.location,
      serialNumber: preventionEmergencyResources.serialNumber,
    })
      .from(preventionEmergencyResources)
      .where(eq(preventionEmergencyResources.worksiteId, worksiteId))
      .orderBy(asc(preventionEmergencyResources.name))
      .limit(500),
    // El inventario de emergencias no modela camiones ni maquinaria; el padrón
    // de equipos vive en flota y hasta ahora sólo llegaba como texto libre.
    listWorksiteVehicles({ worksiteId }),
  ])
  return [
    ...resources.map((item) => ({
      source: "resource" as const,
      id: item.id,
      name: item.name,
      kind: item.kind,
      location: item.location,
      serialNumber: item.serialNumber,
    })),
    ...vehicles.map((item) => ({
      source: "vehicle" as const,
      id: item.id,
      name: vehicleLabel(item),
      kind: item.type,
      location: "",
      serialNumber: item.plate,
    })),
  ]
}

/** Peligros de la MIPER de la faena, para el picker de la programación (A-09). */
export async function listRiskEntriesForWorksite(worksiteId: string, access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:view", worksiteId)
  return db.select({
    id: preventionRiskEntries.id,
    hazardCode: preventionRiskEntries.hazardCode,
    hazard: preventionRiskEntries.hazard,
  })
    .from(preventionRiskEntries)
    .innerJoin(preventionRiskMatrices, eq(preventionRiskMatrices.id, preventionRiskEntries.matrixId))
    .where(eq(preventionRiskMatrices.worksiteId, worksiteId))
    .orderBy(asc(preventionRiskEntries.hazardCode))
    .limit(500)
}

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
  const subjectName = await resolveSubject(db, {
    worksiteId: data.worksiteId,
    subjectResourceId: data.subjectResourceId,
    subjectVehicleId: data.subjectVehicleId,
  })

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
    subjectType: data.subjectType ?? null,
    // El nombre del recurso se congela como etiqueta: renombrarlo después no
    // debe cambiar qué decía la inspección que se inspeccionó.
    subjectLabel: subjectName ?? data.subjectLabel ?? null,
    subjectResourceId: data.subjectResourceId ?? null,
    subjectVehicleId: data.subjectVehicleId ?? null,
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
  result: z.enum(["conforming", "partial", "non_conforming", "not_applicable", "recorded"]),
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

  return { run: updated, saved: args.answers.length, removed: deleted.length }
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
    return { saved: result.saved, removed: result.removed, version: result.run.version }
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

  let accreditation: Parameters<typeof onInspectionCompleted>[0] | null = null
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
      return { run: existing, findings: 0, compliancePercent: existing.compliancePercent, alreadyCompleted: true as const }
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
    const items = itemsFromDefinition(template.definitionSnapshot as unknown as ChecklistDefinition)

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

    const closingSpec = closingActFromDefinition(template.definitionSnapshot as unknown as ChecklistDefinition)
    const completion = assessRunCompletion(items, answers, { spec: closingSpec, act: data.closingAct })
    if (!completion.allowed) {
      throw new Error(`No se puede declarar ejecutada: ${completion.blockers.map((item) => item.detail).join(", ")}`)
    }

    const summary = summarizeCompliance(items, answers)
    const derived = deriveFindings(items, answers)
    const answerId = new Map(stored.map((row) => [`${row.sectionId}::${row.itemId}`, row.id]))
    const now = nowIso()

    // Rehacer los hallazgos abiertos mantiene la coherencia si se corrigió una
    // respuesta antes de cerrar; los que ya tienen CAPA no se tocan.
    await tx.delete(preventionInspectionFindings).where(and(
      eq(preventionInspectionFindings.runId, run.id),
      eq(preventionInspectionFindings.status, "open"),
      sql`${preventionInspectionFindings.capaActionId} IS NULL`,
    ))
    if (derived.length > 0) {
      await tx.insert(preventionInspectionFindings).values(derived.map((finding) => ({
        id: `insfnd-${nanoid()}`,
        runId: run.id,
        answerId: answerId.get(`${finding.sectionId}::${finding.itemId}`) ?? null,
        description: finding.description,
        criticality: finding.criticality,
        status: "open" as const,
      })))
    }

    const [updated] = await tx.update(preventionInspectionRuns).set({
      status: "completed",
      executedByUserId: access.userId,
      executedAt: now,
      conformingCount: summary.conforming,
      partialCount: summary.partial,
      nonConformingCount: summary.nonConforming,
      notApplicableCount: summary.notApplicable,
      compliancePercent: summary.compliancePercent,
      closingResult: data.closingAct?.result ?? null,
      closingRestrictions: data.closingAct?.restrictions ?? null,
      // `signedAt` lo estampa el servidor: la hora de firma no la declara el
      // cliente. Firma registrada (rol + nombre + momento), sin trazo.
      closingSignatures: data.closingAct
        ? data.closingAct.signatures.map((item) => ({
            role: item.role,
            name: item.name,
            userId: item.userId ?? null,
            signedAt: now,
          }))
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

    // Auto-acreditación PDTP: actividades declaradas en la plantilla. Se dispara
    // DESPUÉS del commit (ver abajo) para no dejar ejecuciones huérfanas si la
    // transacción se revierte.
    const pdtpActivityNumbers = Array.isArray((template as { pdtpActivityNumbers?: number[] }).pdtpActivityNumbers)
      ? (template as { pdtpActivityNumbers?: number[] }).pdtpActivityNumbers!
      : []
    if (pdtpActivityNumbers.length > 0) {
      accreditation = {
        runId: run.id,
        worksiteId: run.worksiteId,
        completedAt: updated.executedAt ?? now,
        activityNumbers: pdtpActivityNumbers,
      }
    }

    return { run: updated, findings: derived.length, compliancePercent: summary.compliancePercent }
  })

  if (accreditation) await onInspectionCompleted(accreditation)

  // Un reintento offline no vuelve a notificar. El `dedupeKey` ya lo evitaría,
  // pero salir temprano ahorra la consulta de destinatarios.
  if ("alreadyCompleted" in result) return result

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
    actionDescription: z.string().trim().min(3).max(3000),
    responsibleUserId: z.string().min(1).nullable().optional(),
    immediateMeasure: z.string().trim().max(3000).nullable().optional(),
    /** Abre además la mantención correctiva del equipo (sólo con sujeto de flota). */
    createMaintenance: z.boolean().optional(),
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
      immediateMeasure: data.immediateMeasure ?? row.finding.immediateMeasure ?? null,
      actionDescription: data.actionDescription,
      responsibleUserId: data.responsibleUserId ?? null,
      priority,
      targetDate: addDays(todayInChile(), dueInDays),
      evidenceRequired: true,
      requiresImmediateStop,
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

    // Mantención propuesta. Se engancha acá y no en `completeInspectionRun`
    // porque completar borra y recrea los hallazgos abiertos sin CAPA: colgarlo
    // de ahí dejaría órdenes huérfanas cada vez que alguien reabre y vuelve a
    // cerrar. Derivar, en cambio, es un acto deliberado de una persona.
    let maintenanceId: string | null = null
    if (data.createMaintenance) {
      if (!row.run.subjectVehicleId) {
        throw new Error("Sólo puede programarse una mantención si la inspección tiene un equipo como sujeto.")
      }
      const meter = await readMeterFromRun(tx, row.run.id)
      const [vehicle] = await tx.select({ meterType: fuelVehicles.meterType })
        .from(fuelVehicles).where(eq(fuelVehicles.id, row.run.subjectVehicleId)).limit(1)
      maintenanceId = await createMaintenanceRecordWithClient(tx, {
        vehicleId: row.run.subjectVehicleId,
        supplierId: "",
        worksiteId: row.run.worksiteId,
        costCenterId: "",
        // El plazo de la CAPA manda: la reparación y su acción correctiva
        // vencen el mismo día, o el taller y Prevención llevan dos calendarios.
        maintenanceDate: capa.targetDate,
        maintenanceType: "correctiva",
        status: "scheduled",
        odometerReading: vehicle?.meterType === "odometer" ? meter : null,
        hourMeterReading: vehicle?.meterType === "hour_meter" ? meter : null,
        netAmount: 0,
        taxAmount: 0,
        totalAmount: 0,
        documentNumber: "",
        documentName: "",
        notes: `Deriva de ${row.run.code} · ${row.finding.description}`,
        inspectionFindingId: data.findingId,
      }, { worksiteId: row.run.worksiteId, actorUserId: access.userId })
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

/* ── Motor de transiciones ────────────────────────────────────────────────
 * Puerta única para revisar, cancelar y reabrir. Copia la estructura de
 * `transitionCapaActionWithClient` (lib/services/prevention-capa.ts): guarda
 * pura + doble CAS (chequeo previo y UPDATE condicionado por estado y versión)
 * + historial + actividad operacional.
 */

const runTransitionSchema = z.object({
  runId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  toStatus: z.enum(["in_progress", "reviewed", "cancelled"]),
  reason: z.string().trim().max(3000).optional(),
})

/** Campos que cada destino escribe, más allá del estado y la versión. */
function transitionChangeSet(toStatus: string, actorUserId: string, reason: string | undefined, now: string) {
  if (toStatus === "reviewed") {
    return { reviewedByUserId: actorUserId, reviewedAt: now, reviewComment: reason ?? null }
  }
  if (toStatus === "cancelled") {
    // El CHECK `prevention_inspection_run_cancel_consistent` exige los tres juntos.
    return { cancelledByUserId: actorUserId, cancelledAt: now, cancellationReason: reason ?? null }
  }
  // Reabrir: la ejecución deja de existir, así que se limpia todo lo que la
  // declaraba. Conservar `compliancePercent` afirmaría un resultado que ya no
  // corresponde a ninguna respuesta cerrada.
  return {
    executedByUserId: null, executedAt: null,
    reviewedByUserId: null, reviewedAt: null, reviewComment: null,
    compliancePercent: null,
    conformingCount: 0, partialCount: 0, nonConformingCount: 0, notApplicableCount: 0,
  }
}

export async function transitionInspectionRun(input: unknown, access: InspectionAccess) {
  const data = runTransitionSchema.parse(input)

  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(preventionInspectionRuns)
      .where(eq(preventionInspectionRuns.id, data.runId)).limit(1)
    if (!run) throw new Error(NOT_FOUND)
    // El alcance de faena se comprueba siempre; el permiso concreto lo decide
    // la guarda según el destino.
    if (!scopeAllows(access.scope, run.worksiteId)) throw new Error(NOT_FOUND)
    if (run.version !== data.expectedVersion) throw new Error("La inspección cambió mientras la editabas. Recarga y reintenta.")

    const findings = await tx.select().from(preventionInspectionFindings)
      .where(eq(preventionInspectionFindings.runId, run.id))

    assertInspectionRunTransition({
      fromStatus: run.status as InspectionRunStatus,
      toStatus: data.toStatus,
      permissions: access.permissions,
      actorUserId: access.userId,
      executedByUserId: run.executedByUserId,
      reason: data.reason,
      findings: findings.map((finding) => ({
        id: finding.id,
        description: finding.description,
        criticality: finding.criticality,
        capaActionId: finding.capaActionId,
      })),
    })

    const now = nowIso()

    if (data.toStatus === "in_progress") {
      // Los hallazgos con CAPA sobreviven: la acción correctiva ya vive en otro
      // módulo y borrarla en cascada destruiría evidencia. Es la misma
      // sentencia que usa `completeInspectionRun` al rehacerlos.
      await tx.delete(preventionInspectionFindings).where(and(
        eq(preventionInspectionFindings.runId, run.id),
        sql`${preventionInspectionFindings.capaActionId} IS NULL`,
      ))
    }

    const [updated] = await tx.update(preventionInspectionRuns).set({
      status: data.toStatus,
      ...transitionChangeSet(data.toStatus, access.userId, data.reason, now),
      version: run.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionInspectionRuns.id, run.id),
      eq(preventionInspectionRuns.status, run.status),
      eq(preventionInspectionRuns.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La inspección cambió mientras la editabas. Recarga y reintenta.")

    await history(tx, {
      entityType: "run", entityId: run.id, worksiteId: run.worksiteId,
      changeType: data.toStatus === "in_progress" ? "reopened" : data.toStatus,
      reason: data.reason ?? "",
      beforeState: run, afterState: updated, actorUserId: access.userId,
    })
    await recordOperationalActivity({
      // La reapertura anula un `compliancePercent` ya publicado: sin su propio
      // evento, la serie temporal no puede explicar la discontinuidad.
      eventType: data.toStatus === "in_progress" ? "inspection.reopened" : `inspection.${data.toStatus}`,
      module: "inspecciones",
      entityType: "inspection_run",
      entityId: updated.id,
      entityCode: updated.code,
      worksiteId: updated.worksiteId,
      actorUserId: access.userId,
      payload: { status: updated.status },
    }, tx)
    return updated
  })
}

/* ── Evidencia fotográfica (función #1) ───────────────────────────────────
 * `evidenceReference` existía en el esquema y en el export desde el principio,
 * y ninguna pantalla adjuntaba nada: una inspección sin foto del hallazgo no
 * sirve como evidencia. Se modela 1-a-N porque un incumplimiento suele
 * necesitar más de un ángulo.
 */

/** Resuelve la respuesta y comprueba que su inspección siga siendo editable. */
async function requireEditableAnswer(client: Client, answerId: string, access: InspectionAccess) {
  const [row] = await client.select({ answer: preventionInspectionAnswers, run: preventionInspectionRuns })
    .from(preventionInspectionAnswers)
    .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionAnswers.runId))
    .where(eq(preventionInspectionAnswers.id, answerId)).limit(1)
  if (!row) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:inspections:execute", row.run.worksiteId)
  // Mismo criterio que `saveAnswersWithClient`: sin esto se podría adjuntar o
  // borrar evidencia de una inspección ya revisada.
  if (!["planned", "in_progress"].includes(row.run.status)) {
    throw new Error("No se puede modificar la evidencia de una inspección ya ejecutada.")
  }
  return row
}

/* ── Documento origen: la foto de la planilla ─────────────────────────────── */

/**
 * Adjunta la foto de la planilla física al run.
 *
 * El alcance y la editabilidad se comprueban contra el run real, no contra un
 * `worksiteId` que venga en el formulario — mismo criterio que
 * `addAnswerEvidence`.
 */
export async function addRunDocument(input: {
  runId: string
  path: string
  caption?: string | null
  kind?: "source_form" | "attachment"
  /**
   * Lo que leyó el detector de marcas. **Modo sombra**: se guarda para poder
   * medirlo contra lo que teclee la persona, y NO pre-llena respuestas. El
   * pre-llenado se enciende cuando la medición lo respalde.
   */
  extraction?: {
    layoutVersion: string
    cells: { sectionId: string; itemId: string; result: string; confidence: number }[]
  } | null
}, access: InspectionAccess) {
  const [run] = await db.select().from(preventionInspectionRuns)
    .where(eq(preventionInspectionRuns.id, input.runId)).limit(1)
  if (!run) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:inspections:ingest", run.worksiteId)
  if (["reviewed", "cancelled"].includes(run.status)) {
    throw new Error("No se pueden adjuntar documentos a una inspección cerrada o cancelada.")
  }
  const [created] = await db.insert(preventionInspectionRunDocuments).values({
    id: `insdoc-${nanoid()}`,
    runId: input.runId,
    path: input.path,
    kind: input.kind ?? "source_form",
    caption: input.caption ?? null,
    extraction: input.extraction ?? null,
    uploadedByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo adjuntar el documento.")
  await history(db, {
    entityType: "run", entityId: run.id, worksiteId: run.worksiteId,
    changeType: "document_attached", reason: input.caption ?? "Planilla adjunta",
    actorUserId: access.userId,
  })
  return created
}

export async function deleteRunDocument(input: { documentId: string }, access: InspectionAccess) {
  const [row] = await db.select({ document: preventionInspectionRunDocuments, run: preventionInspectionRuns })
    .from(preventionInspectionRunDocuments)
    .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionRunDocuments.runId))
    .where(eq(preventionInspectionRunDocuments.id, input.documentId)).limit(1)
  if (!row) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:inspections:ingest", row.run.worksiteId)
  if (["reviewed", "cancelled"].includes(row.run.status)) {
    throw new Error("No se pueden quitar documentos de una inspección cerrada o cancelada.")
  }
  await db.delete(preventionInspectionRunDocuments)
    .where(eq(preventionInspectionRunDocuments.id, input.documentId))
  // El archivo físico lo recoge el GC de evidencias, igual que las fotos de respuesta.
  return { id: input.documentId }
}

export async function addAnswerEvidence(input: {
  answerId: string
  path: string
  caption?: string | null
}, access: InspectionAccess) {
  const data = z.object({
    answerId: z.string().min(1),
    // El path lo produce la ruta de subida, nunca el usuario: se valida el
    // prefijo igual que hace PDTP para que nadie inyecte una ruta arbitraria.
    path: z.string().regex(/^storage\/inspection-evidence\/[A-Za-z0-9._-]+$/, "Ruta de evidencia inválida."),
    caption: z.string().trim().max(300).nullable().optional(),
  }).parse(input)

  const row = await requireEditableAnswer(db, data.answerId, access)
  const [created] = await db.insert(preventionInspectionAnswerEvidence).values({
    id: `insev-${nanoid()}`,
    answerId: data.answerId,
    path: data.path,
    caption: data.caption ?? null,
    uploadedByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo adjuntar la evidencia.")
  await history(db, {
    entityType: "answer", entityId: data.answerId, worksiteId: row.run.worksiteId,
    changeType: "evidence_added", reason: `Evidencia adjuntada a "${row.answer.itemLabel}"`,
    actorUserId: access.userId,
  })
  return created
}

export async function deleteAnswerEvidence(input: { evidenceId: string }, access: InspectionAccess) {
  const data = z.object({ evidenceId: z.string().min(1) }).parse(input)
  const [evidence] = await db.select().from(preventionInspectionAnswerEvidence)
    .where(eq(preventionInspectionAnswerEvidence.id, data.evidenceId)).limit(1)
  if (!evidence) throw new Error(NOT_FOUND)
  const row = await requireEditableAnswer(db, evidence.answerId, access)

  await db.delete(preventionInspectionAnswerEvidence)
    .where(eq(preventionInspectionAnswerEvidence.id, data.evidenceId))
  // El archivo físico no se borra aquí: lo recoge el GC de evidencias, que ya
  // recorre el directorio comparándolo contra las referencias en BD.
  await history(db, {
    entityType: "answer", entityId: evidence.answerId, worksiteId: row.run.worksiteId,
    changeType: "evidence_removed", reason: `Evidencia eliminada de "${row.answer.itemLabel}"`,
    actorUserId: access.userId,
  })
  return { deleted: 1 }
}

/**
 * Reasignar el ejecutante de una inspección aún no ejecutada (función #12).
 *
 * Función hermana del motor de transiciones, no un destino más: no cambia de
 * estado. Meter cambios de campo arbitrarios en `transitionInspectionRun` lo
 * convertiría en un `update` genérico y le haría perder su valor como guarda.
 */
export async function reassignInspectionRun(input: unknown, access: InspectionAccess) {
  const data = z.object({
    runId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    assignedToUserId: z.string().min(1).nullable(),
    reason: z.string().trim().min(TRANSITION_REASON_MIN_LENGTH).max(3000),
  }).parse(input)

  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(preventionInspectionRuns)
      .where(eq(preventionInspectionRuns.id, data.runId)).limit(1)
    if (!run) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:inspections:manage", run.worksiteId)
    if (run.version !== data.expectedVersion) throw new Error("La inspección cambió mientras la editabas. Recarga y reintenta.")
    if (!["planned", "in_progress"].includes(run.status)) {
      throw new Error("Sólo puede reasignarse una inspección que aún no fue ejecutada.")
    }

    const now = nowIso()
    const [updated] = await tx.update(preventionInspectionRuns).set({
      assignedToUserId: data.assignedToUserId,
      version: run.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionInspectionRuns.id, run.id),
      eq(preventionInspectionRuns.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La inspección cambió mientras la editabas. Recarga y reintenta.")

    await history(tx, {
      entityType: "run", entityId: run.id, worksiteId: run.worksiteId,
      changeType: "reassigned", reason: data.reason,
      beforeState: run, afterState: updated, actorUserId: access.userId,
    })
    return updated
  })
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

/* ── Consultas ────────────────────────────────────────────────────────────── */

/**
 * Las auditorías del Sistema de Gestión (`kind: 'audit'`) viven en su propia
 * pantalla, así que cada listado declara qué tipos muestra. Sin el filtro, una
 * auditoría aparecería a la vez en Inspecciones y en Auditorías.
 */
export type InspectionKindFilter = { kinds?: readonly string[] }

function kindCondition({ kinds }: InspectionKindFilter = {}) {
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
  view?: "pending_review" | "open_findings" | "critical"
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
  if (filter.view === "pending_review") conditions.push(eq(preventionInspectionRuns.status, "completed"))
  if (filter.view === "open_findings") conditions.push(sql`${OPEN_FINDINGS_SQL} > 0`)
  if (filter.view === "critical") conditions.push(sql`${CRITICAL_FINDINGS_SQL} > 0`)
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

const RUN_LIST_SELECTION = {
  run: preventionInspectionRuns,
  templateName: preventionInspectionTemplates.name,
  templateKind: preventionInspectionTemplates.kind,
  worksiteName: worksites.name,
  openFindings: OPEN_FINDINGS_SQL,
  criticalFindings: CRITICAL_FINDINGS_SQL,
}

export const INSPECTION_PAGE_SIZE = 50

export async function listInspectionRuns(
  access: InspectionAccess,
  filter: InspectionListFilters = {},
  page: { limit?: number; offset?: number } = {},
) {
  requireAccess(access, "prevention:inspections:view")
  return db.select(RUN_LIST_SELECTION)
    .from(preventionInspectionRuns)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionRuns.templateId, preventionInspectionTemplates.id))
    .innerJoin(worksites, eq(preventionInspectionRuns.worksiteId, worksites.id))
    .where(listFilterConditions(access, filter))
    // Orden estable: `createdAt` sola empata entre ejecuciones creadas por el
    // mismo barrido del cron y la paginación repetiría o saltaría filas.
    .orderBy(desc(preventionInspectionRuns.createdAt), desc(preventionInspectionRuns.id))
    .limit(page.limit ?? INSPECTION_PAGE_SIZE)
    .offset(page.offset ?? 0)
}

/** KPIs sobre el universo completo, no sobre la página visible (C-09). */
export async function summarizeInspectionRuns(access: InspectionAccess, filter: InspectionKindFilter = {}) {
  requireAccess(access, "prevention:inspections:view")
  const [row] = await db.select({
    total: sql<number>`COUNT(*)::int`,
    pendingReview: sql<number>`COUNT(*) FILTER (WHERE ${preventionInspectionRuns.status} = 'completed')::int`,
    withOpenFindings: sql<number>`COUNT(*) FILTER (WHERE ${OPEN_FINDINGS_SQL} > 0)::int`,
    withCriticalFindings: sql<number>`COUNT(*) FILTER (WHERE ${CRITICAL_FINDINGS_SQL} > 0)::int`,
  })
    .from(preventionInspectionRuns)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionRuns.templateId, preventionInspectionTemplates.id))
    .innerJoin(worksites, eq(preventionInspectionRuns.worksiteId, worksites.id))
    .where(listFilterConditions(access, filter))
  return row ?? { total: 0, pendingReview: 0, withOpenFindings: 0, withCriticalFindings: 0 }
}

/**
 * Universo completo para el export. NO comparte función con la vista paginada
 * a propósito: si alguien las unifica más adelante, el Excel vuelve a truncarse
 * en silencio, que es el defecto que C-09 corrige.
 */
export async function listAllInspectionRunsForExport(access: InspectionAccess, filter: InspectionKindFilter = {}) {
  requireAccess(access, "prevention:inspections:view")
  // Los alias se crean UNA vez: `alias()` devuelve un objeto nuevo en cada
  // llamada, así que repetirlo en el select y en el join produciría dos tablas
  // distintas con el mismo nombre.
  const executor = alias(users, "inspection_export_executor")
  const reviewer = alias(users, "inspection_export_reviewer")
  return db.select({
    ...RUN_LIST_SELECTION,
    // A-07: el Excel volcaba los IDs crudos de usuario.
    executorName: executor.name,
    reviewerName: reviewer.name,
  })
    .from(preventionInspectionRuns)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionRuns.templateId, preventionInspectionTemplates.id))
    .innerJoin(worksites, eq(preventionInspectionRuns.worksiteId, worksites.id))
    .leftJoin(executor, eq(preventionInspectionRuns.executedByUserId, executor.id))
    .leftJoin(reviewer, eq(preventionInspectionRuns.reviewedByUserId, reviewer.id))
    .where(listFilterConditions(access, filter))
    .orderBy(desc(preventionInspectionRuns.createdAt), desc(preventionInspectionRuns.id))
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
    definitionSnapshot: preventionInspectionTemplates.definitionSnapshot,
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

  const [answers, findings, documents] = await Promise.all([
    db.select().from(preventionInspectionAnswers).where(eq(preventionInspectionAnswers.runId, runId)),
    db.select().from(preventionInspectionFindings).where(eq(preventionInspectionFindings.runId, runId)),
    db.select().from(preventionInspectionRunDocuments)
      .where(eq(preventionInspectionRunDocuments.runId, runId))
      .orderBy(asc(preventionInspectionRunDocuments.createdAt)),
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
  return {
    ...run,
    answers: answers.map((row) => ({ ...row, evidence: evidenceByAnswer.get(row.id) ?? [] })),
    findings,
    documents,
  }
}

export async function listInspectionTemplates(access: InspectionAccess, filter: InspectionKindFilter = {}) {
  requireAccess(access, "prevention:inspections:view")
  const templates = await db.select().from(preventionInspectionTemplates)
    .where(kindCondition(filter))
    .orderBy(asc(preventionInspectionTemplates.code), desc(preventionInspectionTemplates.createdAt))
  // Se expone la calibración real de cada plantilla: una sin daño potencial
  // declarado produce hallazgos siempre medios y no bloquea ningún cierre.
  //
  // A-03: además se compara el snapshot congelado contra la definición que hoy
  // vive en `lib/sst/definitions`. El `contentHash` se calculaba al importar y
  // nunca se leía, así que nada avisaba cuándo el catálogo en código se había
  // adelantado a la plantilla aprobada — que es justo la señal que dice cuándo
  // toca publicar una versión nueva.
  return templates.map((template) => {
    const source = template.sourceDefinitionCode ? CHECKLIST_DEFINITIONS[template.sourceDefinitionCode] : undefined
    return {
      ...template,
      coverage: assessEnrichmentCoverage(itemsFromDefinition(template.definitionSnapshot as unknown as ChecklistDefinition)),
      /** La definición de origen ya no existe en el catálogo en código. */
      definitionMissing: Boolean(template.sourceDefinitionCode) && !source,
      /** El contenido en código difiere del snapshot aprobado. No implica que el checklist cambie de fondo: reordenar propiedades también deriva. */
      definitionDrifted: Boolean(source) && contentHashOf(source!) !== template.contentHash,
    }
  })
}

export async function listInspectionPrograms(access: InspectionAccess, filter: InspectionKindFilter = {}) {
  requireAccess(access, "prevention:inspections:view")
  return db.select({
    program: preventionInspectionPrograms,
    templateName: preventionInspectionTemplates.name,
    worksiteName: worksites.name,
    assigneeName: users.name,
  })
    .from(preventionInspectionPrograms)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionPrograms.templateId, preventionInspectionTemplates.id))
    .innerJoin(worksites, eq(preventionInspectionPrograms.worksiteId, worksites.id))
    .leftJoin(users, eq(preventionInspectionPrograms.assignedToUserId, users.id))
    .where(and(scopeCondition(access.scope, preventionInspectionPrograms.worksiteId), kindCondition(filter)))
    .orderBy(asc(preventionInspectionPrograms.nextDueOn))
}

/** Faenas visibles para el alcance, para poblar la programación y la alta de ejecución. */
export async function listInspectionWorksites(access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:view")
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
 * Quien puede ejecutar una inspección: población de `assignedToUserId` en
 * programa/ejecución y de `responsibleUserId` al derivar un hallazgo a CAPA,
 * porque quien ejecuta en terreno es quien razonablemente corrige.
 */
export async function listInspectionAssignees(access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:view")
  const ids = await getUserIdsWithPermission("prevention:inspections:execute")
  if (ids.length === 0) return []
  return db.select({ id: users.id, name: users.name })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.isActive, true)))
    .orderBy(asc(users.name))
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
export async function summarizeInspectionTimelyClosure(access: InspectionAccess, filter: InspectionKindFilter = {}) {
  requireAccess(access, "prevention:inspections:view")
  const rows = await db.select({
    targetDate: preventionCapaActions.targetDate,
    closedAt: preventionInspectionFindings.closedAt,
  })
    .from(preventionInspectionFindings)
    .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionFindings.runId))
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionTemplates.id, preventionInspectionRuns.templateId))
    .leftJoin(preventionCapaActions, eq(preventionCapaActions.id, preventionInspectionFindings.capaActionId))
    .where(and(scopeCondition(access.scope, preventionInspectionRuns.worksiteId), kindCondition(filter)))
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
export async function summarizeInspectionTrends(access: InspectionAccess, filter: InspectionKindFilter = {}) {
  requireAccess(access, "prevention:inspections:view")
  return db.select({
    month: sql<string>`to_char(${preventionInspectionRuns.executedAt}, 'YYYY-MM')`,
    executed: sql<number>`COUNT(*)::int`,
    avgCompliance: sql<number | null>`ROUND(AVG(${preventionInspectionRuns.compliancePercent}))::int`,
    nonConforming: sql<number>`COALESCE(SUM(${preventionInspectionRuns.nonConformingCount}), 0)::int`,
    openFindings: sql<number>`COALESCE(SUM(${OPEN_FINDINGS_SQL}), 0)::int`,
  })
    .from(preventionInspectionRuns)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionTemplates.id, preventionInspectionRuns.templateId))
    .where(and(
      scopeCondition(access.scope, preventionInspectionRuns.worksiteId),
      kindCondition(filter),
      isNotNull(preventionInspectionRuns.executedAt),
    ))
    .groupBy(sql`to_char(${preventionInspectionRuns.executedAt}, 'YYYY-MM')`)
    .orderBy(sql`to_char(${preventionInspectionRuns.executedAt}, 'YYYY-MM')`)
}

/** Catálogo de definiciones SST disponibles para incorporar como plantilla. */
export function listImportableDefinitions() {
  return Object.entries(CHECKLIST_DEFINITIONS)
    .flatMap(([code, definition]) => isPersonEvaluationDefinition(code) || isNonInspectionDefinition(code)
      ? []
      : [{
          code,
          title: definition.title,
          version: definition.version,
          sections: definition.sections.length,
          items: definition.sections.reduce((total, section) => total + section.items.length, 0),
          coverage: assessEnrichmentCoverage(itemsFromDefinition(definition)),
        }])
}
