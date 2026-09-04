/**
 * lib/services/pdtp/fulfillment.ts
 *
 * Plataforma de cumplimiento (Fase 2 del plan de código del PDTP,
 * 2026-09-02). Dos problemas que el motor de acreditación por sí solo no
 * resuelve:
 *
 * 1. **Pérdida silenciosa.** `accreditPdtpFromEvent` lanza si el programa no
 *    está activo, si la faena no pertenece al programa o si el evento cae
 *    fuera de su año — y cada conector (`pdtp-accreditation-connectors.ts`,
 *    `hygiene-accreditation-connector.ts`, `incident-accreditation-
 *    connector.ts`, `worker-onboarding-connector.ts`) se lo traga con
 *    `logger.error` y sigue. Mientras el programa está en `draft`, todo hecho
 *    operacional que ocurre desaparece sin dejar rastro recuperable.
 *    `recordPdtpFulfillmentEvent` es el reemplazo de ese `try/catch`: escribe
 *    primero un evento durable, intenta acreditar, y dEja el evento en
 *    `pending` o `error` en vez de perder el intento.
 *
 * 2. **Destino disperso.** El `CASE` que decide a dónde manda `/pendientes`
 *    una actividad vive incrustado en el SQL de
 *    `lib/services/operational-work-queue.ts` y produce hoy un 404 real
 *    (`/prevencion/constancias` no existe). `resolvePdtpFulfillmentTarget` es
 *    el único lugar que debe decidir eso, para que `/pendientes`, el tablero y
 *    la planilla consuman la misma respuesta.
 *
 * No duplica el motor: `accreditPdtpFromEvent` y `revokePdtpAccreditation`
 * siguen siendo la única escritura en `pdtp_executions`. Esta capa es el
 * libro de intentos alrededor de esas dos funciones.
 */

import { and, eq, inArray } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpFulfillmentEvents,
  pdtpResponsibleCatalog,
  permissions,
  preventionCampaigns,
  preventionEmergencyPlans,
  preventionInspectionTemplates,
  pdtpProgramWorksites,
  preventionTrainingCourses,
  rolePermissions,
  roles,
  sstDocumentTypes,
  worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import {
  accreditPdtpFromEvent,
  revokePdtpAccreditationWithClient,
  type AccreditationInput,
  type AccreditationResult,
  type RevocationInput,
} from "./accreditation"
import { engancheDestinationFor } from "@/lib/services/pdtp-adapters/fulfillment-contract-2026"

type QueryClient = DB | Tx

function fulfillmentIdempotencyKey(sourceType: string, sourceId: string, eventType: "completed" | "revoked"): string {
  return `pdtp-fulfillment:${eventType}:${sourceType}:${sourceId}`
}

async function upsertPendingEvent(input: {
  sourceType: string
  sourceId: string
  eventType: "completed" | "revoked"
  worksiteId: string
  occurredAt: string
  quantity: number
  evidenceRef: string | null
  activityNumbers: number[]
  sourceVersion: string | null
  returnHref: string | null
}) {
  const idempotencyKey = fulfillmentIdempotencyKey(input.sourceType, input.sourceId, input.eventType)
  const now = new Date().toISOString()

  const [existing] = await db.select().from(pdtpFulfillmentEvents)
    .where(eq(pdtpFulfillmentEvents.idempotencyKey, idempotencyKey)).limit(1)
  if (existing) {
    await db.update(pdtpFulfillmentEvents)
      .set({ attempts: existing.attempts + 1, updatedAt: now })
      .where(eq(pdtpFulfillmentEvents.id, existing.id))
    return existing.id
  }

  const id = `pdtp-fulfillment-${nanoid()}`
  const [inserted] = await db.insert(pdtpFulfillmentEvents).values({
    id,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    eventType: input.eventType,
    sourceVersion: input.sourceVersion,
    worksiteId: input.worksiteId,
    occurredAt: input.occurredAt,
    quantity: input.quantity,
    evidenceRef: input.evidenceRef,
    returnHref: input.returnHref,
    idempotencyKey,
    status: "pending",
    activityNumbers: input.activityNumbers,
    resultJson: {},
    attempts: 1,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing({ target: pdtpFulfillmentEvents.idempotencyKey }).returning({ id: pdtpFulfillmentEvents.id })
  if (inserted) return inserted.id

  // Carrera: otra llamada concurrente insertó primero. Se suma el intento a
  // esa fila en vez de fallar.
  const [concurrent] = await db.select({ id: pdtpFulfillmentEvents.id, attempts: pdtpFulfillmentEvents.attempts })
    .from(pdtpFulfillmentEvents).where(eq(pdtpFulfillmentEvents.idempotencyKey, idempotencyKey)).limit(1)
  if (!concurrent) throw new Error("No se pudo crear ni recuperar el evento de cumplimiento.")
  await db.update(pdtpFulfillmentEvents).set({ attempts: concurrent.attempts + 1, updatedAt: now }).where(eq(pdtpFulfillmentEvents.id, concurrent.id))
  return concurrent.id
}

/**
 * Registra un intento de acreditación de forma durable y lo ejecuta.
 *
 * Reemplaza el patrón `try { accreditPdtpFromEvent(input) } catch { log }` que
 * usan hoy los cuatro adaptadores: la diferencia es que un fallo —programa en
 * borrador, faena fuera del programa, actividad retirada— queda en la base
 * como un evento `pending`/`error` reprocesable, no sólo en un log.
 *
 * Nunca lanza: un fallo al escribir el evento durable tampoco debe tumbar la
 * transacción del módulo fuente, que es la misma garantía que ya ofrecía
 * `safeAccredit`.
 */
export async function recordPdtpFulfillmentEvent(input: AccreditationInput & {
  sourceVersion?: string
  returnHref?: string
}): Promise<AccreditationResult | null> {
  let eventId: string
  try {
    eventId = await upsertPendingEvent({
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      eventType: "completed",
      worksiteId: input.worksiteId,
      occurredAt: input.occurredAt,
      quantity: input.executedQuantity ?? 1,
      evidenceRef: input.evidenceRef ?? null,
      activityNumbers: input.activityNumbers,
      sourceVersion: input.sourceVersion ?? null,
      returnHref: input.returnHref ?? null,
    })
  } catch (err) {
    // No se pudo ni dejar constancia del intento. Mismo criterio que antes:
    // el hecho fuente ya está confirmado en su propia transacción y esto no
    // debe tumbarlo.
    logger.error({ err, sourceType: input.sourceType, sourceId: input.sourceId }, "[pdtp-fulfillment] No se pudo registrar el evento durable.")
    return null
  }

  try {
    const result = await accreditPdtpFromEvent(input)
    const now = new Date().toISOString()
    await db.update(pdtpFulfillmentEvents).set({
      status: result.accredited.length > 0 ? "accredited" : "rejected",
      resultJson: result as unknown as Record<string, unknown>,
      programId: input.programId ?? null,
      updatedAt: now,
    }).where(eq(pdtpFulfillmentEvents.id, eventId))
    if (result.skippedNotFound.length > 0) {
      logger.warn(
        { sourceType: input.sourceType, sourceId: input.sourceId, skippedNotFound: result.skippedNotFound },
        "[pdtp-fulfillment] Actividades no encontradas en el programa activo.",
      )
    }
    return result
  } catch (err) {
    const now = new Date().toISOString()
    const message = err instanceof Error ? err.message : String(err)
    await db.update(pdtpFulfillmentEvents).set({ status: "error", lastError: message, updatedAt: now })
      .where(eq(pdtpFulfillmentEvents.id, eventId))
    logger.error(
      { err, sourceType: input.sourceType, sourceId: input.sourceId, worksiteId: input.worksiteId },
      "[pdtp-fulfillment] Error en auto-acreditación PDTP; el evento queda pendiente de reconciliar.",
    )
    return null
  }
}

/** Igual que `recordPdtpFulfillmentEvent`, para el sentido inverso. */
export async function recordPdtpFulfillmentRevocation(input: RevocationInput): Promise<void> {
  let eventId: string
  try {
    eventId = await upsertPendingEvent({
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      eventType: "revoked",
      worksiteId: input.worksiteId,
      occurredAt: new Date().toISOString(),
      quantity: 0,
      evidenceRef: input.reason ?? null,
      activityNumbers: [],
      sourceVersion: null,
      returnHref: null,
    })
  } catch (err) {
    logger.error({ err, sourceType: input.sourceType, sourceId: input.sourceId }, "[pdtp-fulfillment] No se pudo registrar la revocación durable.")
    return
  }

  try {
    const result = await db.transaction((tx) => revokePdtpAccreditationWithClient(input, tx))
    const now = new Date().toISOString()
    await db.update(pdtpFulfillmentEvents).set({
      status: "revoked", resultJson: result as unknown as Record<string, unknown>, updatedAt: now,
    }).where(eq(pdtpFulfillmentEvents.id, eventId))
  } catch (err) {
    const now = new Date().toISOString()
    const message = err instanceof Error ? err.message : String(err)
    await db.update(pdtpFulfillmentEvents).set({ status: "error", lastError: message, updatedAt: now })
      .where(eq(pdtpFulfillmentEvents.id, eventId))
    logger.error({ err, sourceType: input.sourceType, sourceId: input.sourceId, worksiteId: input.worksiteId }, "[pdtp-fulfillment] Error al revertir la acreditación PDTP.")
  }
}

/**
 * Reprocesa los eventos que quedaron `pending` o `error` — al activar un
 * programa, al corregir un mapeo, o por reintento manual. Idempotente por
 * `idempotency_key`: `accreditPdtpFromEvent` no duplica una ejecución ya
 * creada, así que reintentar un evento que en el fondo ya se resolvió no
 * tiene efecto.
 *
 * No procesa hechos anteriores a `activatedAt` de ningún programa por su
 * cuenta: sólo reintenta eventos que YA están en el libro porque el propio
 * hecho operacional los escribió. Una carga histórica retroactiva es una
 * decisión aparte, con motivo y aprobación explícitos.
 */
export async function reconcilePdtpFulfillmentEvents(input: { limit?: number } = {}): Promise<{
  processed: number
  accredited: number
  stillPending: number
  errored: number
}> {
  const limit = input.limit ?? 200
  const pending = await db.select().from(pdtpFulfillmentEvents)
    .where(inArray(pdtpFulfillmentEvents.status, ["pending", "error"]))
    .orderBy(pdtpFulfillmentEvents.createdAt)
    .limit(limit)

  let accredited = 0
  let stillPending = 0
  let errored = 0

  for (const event of pending) {
    if (event.eventType === "completed") {
      const result = await recordPdtpFulfillmentEvent({
        sourceType: event.sourceType as AccreditationInput["sourceType"],
        sourceId: event.sourceId,
        worksiteId: event.worksiteId,
        activityNumbers: (event.activityNumbers as number[]) ?? [],
        occurredAt: event.occurredAt,
        executedQuantity: Number(event.quantity),
        evidenceRef: event.evidenceRef ?? undefined,
      })
      if (result && result.accredited.length > 0) accredited++
      else if (result) stillPending++
      else errored++
    } else {
      await recordPdtpFulfillmentRevocation({
        sourceType: event.sourceType as RevocationInput["sourceType"],
        sourceId: event.sourceId,
        worksiteId: event.worksiteId,
      })
      const [refreshed] = await db.select({ status: pdtpFulfillmentEvents.status }).from(pdtpFulfillmentEvents).where(eq(pdtpFulfillmentEvents.id, event.id)).limit(1)
      if (refreshed?.status === "revoked") accredited++
      else if (refreshed?.status === "error") errored++
      else stillPending++
    }
  }

  return { processed: pending.length, accredited, stillPending, errored }
}

// ── Destino externo (`resolvePdtpFulfillmentTarget`) ───────────────────────

export type PdtpFulfillmentTarget = {
  module: string
  href: string
  ctaLabel: string
  event: string
}

/**
 * El destino externo por mecanismo, sin depender del `worksiteId` — es el
 * mismo `CASE` que hoy vive incrustado en `operational-work-queue.ts:778-791`
 * y produce el 404 de `/prevencion/constancias`. Único lugar que debe decidir
 * esto; `/pendientes`, el tablero y la planilla consumen esta respuesta.
 */
export function resolvePdtpFulfillmentTarget(activity: { mechanism: string; n?: number }, worksiteId: string): PdtpFulfillmentTarget {
  if (activity.mechanism === "constancia") {
    return {
      module: "constancias",
      href: `/prevencion/constancias?faena=${worksiteId}`,
      ctaLabel: "Dejar constancia",
      event: "constancia enviada con evidencia",
    }
  }
  if (activity.mechanism === "enganche") {
    // Con el contrato de cumplimiento se manda al módulo donde el trabajo se
    // hace de verdad, en vez de devolver a todo el mundo a la planilla.
    const destination = activity.n === undefined ? null : engancheDestinationFor(activity.n)
    if (destination && destination.module !== "pdtp") {
      return {
        module: destination.module,
        href: destination.href(worksiteId),
        ctaLabel: "Ir a cumplirla",
        event: "registro del módulo de origen",
      }
    }
    return {
      module: "pdtp",
      href: `/prevencion/pdtp/actividades?faena=${worksiteId}&vista=semana`,
      ctaLabel: "Ver cómo se cumple",
      event: "registro del módulo de origen",
    }
  }
  return {
    module: "pdtp",
    href: `/prevencion/pdtp/actividades?faena=${worksiteId}&vista=semana`,
    ctaLabel: "Registrar cumplimiento",
    event: "registro manual en la planilla",
  }
}

// ── Compuerta 81/81 ──────────────────────────────────────────────────────

export type PdtpFulfillmentCoverageStatus =
  | "ready"
  | "config_required"
  | "code_gap"
  | "permission_gap"
  | "decision_required"
  /**
   * El destino de una actividad de enganche declara un permiso que ninguno de
   * sus responsables tiene. **No bloquea**, y no es un descuido: buena parte de
   * estos casos son segregación de deberes, no errores de RBAC —quien redacta
   * el plan de emergencia no es quien lo firma—. Se reporta para que una
   * persona revise la lista y decida cuáles son grants faltantes y cuáles son
   * la norma funcionando. Promoverlo a bloqueante antes de esa revisión es
   * repetir el episodio de la N°84.
   */
  | "destination_review"

export type PdtpFulfillmentCoverageIssue = {
  n: number
  activity: string
  status: PdtpFulfillmentCoverageStatus
  reason: string
}

/**
 * Actividades cuyo número está **fijo en el código de un conector**, y que por
 * eso no aparecen —ni tienen por qué aparecer— en ninguna tabla de
 * configuración.
 *
 * El criterio es literal y no admite parientes: el número es una constante en
 * el conector. Que un conector *reciba* el número no basta. La N°36, la N°43 y
 * la N°84 estuvieron acá por esa confusión —sus números vienen de
 * `sst_document_types` y de `prevention_emergency_plans`— y estar en la lista
 * las eximía justo de la verificación que les correspondía: la compuerta las
 * daba por listas con las dos tablas vacías. La N°83 sí pertenece:
 * `PDTP_EMERGENCY_PLAN_ACTIVITY_NUMBER` es una constante del conector.
 *
 * Se mantiene a mano porque no hay un registro único de "qué número acredita
 * cada conector" — es la misma razón por la que el diagnóstico de agosto tuvo
 * que auditarse actividad por actividad. Actualizarla es el costo de agregar un
 * conector nuevo.
 */
const STRUCTURALLY_WIRED_ACTIVITY_NUMBERS = new Set([
  1, 9, 11,           // programa, revisión por la dirección, CPHS
  7,                  // indicadores de faena (Fase 4.1)
  15, 18, 19, 23, 52, 63, // acta de trabajador nuevo (la N°19 es la carpeta, T47)
  17,                 // RE-28 de personas sensibles (worker-sensitivity-connector)
  35,                 // MIPER
  45, 46, 47, 48, 49, 50, // higiene y vigilancia
  62,                 // entrega de EPP
  66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, // incidentes RE-20
  83,                 // plan de emergencia aprobado (la N°84 la declara el plan)
  30, 31, 32,         // alcotest (G14, prevention-alcotest.ts)
  79, 80, 81,         // CGRD del DS 44 (G15, prevention-cgrd.ts)
])

/**
 * Permisos vigentes por rol, leídos de la base y no del manifest: el manifest
 * es la semilla por defecto, y lo que decide si alguien entra son los grants
 * que estén realmente cargados.
 */
async function permissionsByRoleName(client: QueryClient): Promise<Map<string, Set<string>>> {
  const rows = await client.select({ role: roles.name, permission: permissions.name })
    .from(rolePermissions)
    .innerJoin(roles, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
  const byRole = new Map<string, Set<string>>()
  for (const row of rows) {
    const set = byRole.get(row.role) ?? new Set<string>()
    set.add(row.permission)
    byRole.set(row.role, set)
  }
  return byRole
}

/**
 * Permiso que exige el módulo donde se registra el cumplimiento, según el
 * mecanismo.
 *
 * Sólo se verifican los dos mecanismos cuyo destino se conoce:
 *
 * - `constancia` se marca en Constancias.
 * - `formulario` se registra dentro del propio PDTP.
 *
 * `enganche` devuelve `null` a propósito: su destino real depende de la
 * actividad —una se cierra en Inspecciones, otra en Capacitación, otra en
 * EPP— y hoy no existe un mapa actividad → módulo. Ese mapa es justamente el
 * contrato anual que el plan pedía en `fulfillment-contract-2026.ts` y que
 * todavía no se escribió: mientras no exista, la compuerta no puede afirmar
 * nada sobre el permiso de destino de las actividades de enganche, y prefiere
 * no verificar antes que verificar contra el módulo equivocado.
 *
 * `compuesta` tampoco se verifica, y por una razón distinta: **nadie la
 * ejecuta**. Se cumple cuando sus componentes están completos —la N°52 cierra
 * con el acta de trabajador nuevo—, así que exigirle a su responsable el
 * permiso de la planilla comprobaba algo que no hace falta para cumplirla, y
 * podía bloquear el envío del programa por una configuración legítima.
 */
function destinationPermissionFor(mechanism: string): string | null {
  if (mechanism === "constancia") return "prevention:constancias:execute"
  if (mechanism === "formulario") return "prevention:pdtp:execute"
  return null
}

/**
 * El permiso del acto que acredita una actividad de enganche, según el contrato
 * de cumplimiento 2026. `null` cuando no hay módulo de destino, cuando la
 * actividad no está en el mapa, o cuando su cumplimiento está segregado a
 * propósito del responsable declarado.
 */
function engancheDestinationPermissionFor(n: number): { permission: string; module: string } | null {
  const destination = engancheDestinationFor(n)
  if (!destination || !destination.permission || destination.segregated) return null
  return { permission: destination.permission, module: destination.module }
}

/**
 * Números declarados en catálogos **globales**: una plantilla, un curso o un
 * tipo de documento vale para todo el programa.
 *
 * Los dos arreglos de `sst_document_types` se unen a propósito: uno acredita al
 * publicar y el otro por acuse de recibo, pero para "¿tiene destino declarado?"
 * cualquiera de los dos sirve.
 */
async function activityNumbersDeclaredGlobally(client: QueryClient): Promise<Set<number>> {
  const [templates, courses, docTypes] = await Promise.all([
    client.select({ n: preventionInspectionTemplates.pdtpActivityNumbers }).from(preventionInspectionTemplates),
    client.select({ n: preventionTrainingCourses.pdtpActivityNumbers }).from(preventionTrainingCourses),
    client.select({
      n: sstDocumentTypes.pdtpActivityNumbers,
      ack: sstDocumentTypes.pdtpAcknowledgmentActivityNumbers,
    }).from(sstDocumentTypes),
  ])
  const set = new Set<number>()
  for (const row of templates) for (const n of (row.n as number[] | null) ?? []) set.add(n)
  for (const row of courses) for (const n of (row.n as number[] | null) ?? []) set.add(n)
  for (const row of docTypes) {
    for (const n of (row.n as number[] | null) ?? []) set.add(n)
    for (const n of (row.ack as number[] | null) ?? []) set.add(n)
  }
  return set
}

/**
 * Números declarados en registros que existen **por faena**: los planes de
 * emergencia y las campañas.
 *
 * Se cuentan aparte porque un solo plan en una faena no acredita nada en las
 * otras seis. Antes las cinco tablas se leían juntas y globalmente, así que un
 * plan en cualquier parte daba la N°84 por resuelta en todo el programa —
 * exactamente la respuesta que impedía que el informe dijera "no hay plan en la
 * faena X", que es lo único accionable.
 */
async function activityNumbersDeclaredPerWorksite(client: QueryClient): Promise<Map<number, Set<string>>> {
  const [campaigns, plans] = await Promise.all([
    client.select({ n: preventionCampaigns.pdtpActivityNumbers, worksiteId: preventionCampaigns.worksiteId }).from(preventionCampaigns),
    client.select({ n: preventionEmergencyPlans.pdtpActivityNumbers, worksiteId: preventionEmergencyPlans.worksiteId }).from(preventionEmergencyPlans),
  ])
  const byNumber = new Map<number, Set<string>>()
  for (const rows of [campaigns, plans]) {
    for (const row of rows) {
      for (const n of (row.n as number[] | null) ?? []) {
        const set = byNumber.get(n) ?? new Set<string>()
        set.add(row.worksiteId)
        byNumber.set(n, set)
      }
    }
  }
  return byNumber
}

/**
 * Faenas contra las que se exige la declaración por faena: las miembros del
 * programa, o todas las activas cuando el programa no declara membresía —que es
 * el mismo criterio con que el motor decide si una faena puede operarlo.
 */
async function programWorksiteIds(client: QueryClient, programId: string): Promise<string[]> {
  const members = await client.select({ worksiteId: pdtpProgramWorksites.worksiteId })
    .from(pdtpProgramWorksites)
    .where(and(eq(pdtpProgramWorksites.programId, programId), eq(pdtpProgramWorksites.isActive, true)))
  if (members.length > 0) return members.map((row) => row.worksiteId)
  const active = await client.select({ id: worksites.id }).from(worksites).where(eq(worksites.isActive, true))
  return active.map((row) => row.id)
}

/**
 * Por qué una actividad de enganche o compuesta no tiene destino declarado, si
 * es que no lo tiene.
 *
 * Un número respaldado sólo por una tabla **por faena** está cableado si y sólo
 * si **todas** las faenas del programa lo declaran: prometer simulacros en siete
 * faenas y tener el plan en una es tener seis faenas sin dónde cumplir.
 */
function wiringIssueFor(
  activity: { n: number; activity: string },
  ctx: {
    declaredGlobally: Set<number>
    declaredPerWorksite: Map<number, Set<string>>
    worksiteIds: string[]
    worksiteNameById: Map<string, string>
  },
): PdtpFulfillmentCoverageIssue | null {
  if (STRUCTURALLY_WIRED_ACTIVITY_NUMBERS.has(activity.n)) return null
  if (ctx.declaredGlobally.has(activity.n)) return null

  const declaringWorksites = ctx.declaredPerWorksite.get(activity.n)
  if (declaringWorksites) {
    const missing = ctx.worksiteIds.filter((id) => !declaringWorksites.has(id))
    if (missing.length === 0) return null
    const names = missing.map((id) => ctx.worksiteNameById.get(id) ?? id)
    return {
      n: activity.n, activity: activity.activity, status: "config_required",
      reason: `Su número no está declarado en ${missing.length} de las ${ctx.worksiteIds.length} faenas del programa: ${names.join(", ")}.`,
    }
  }

  return {
    n: activity.n, activity: activity.activity, status: "config_required",
    reason: "Su número no está declarado en ninguna plantilla, curso, campaña, plan o tipo de documento.",
  }
}

/**
 * Compuerta que exige, por actividad activa del programa, un destino externo
 * declarado y verificable. Se llama desde `pdtpSubmitReviewBlockers` y desde
 * `activatePdtpProgram`: no debe volver a ser posible activar un programa que
 * promete trabajo sin ofrecer dónde realizarlo.
 *
 * Devuelve la lista de problemas encontrados (vacía = compuerta pasada). No
 * lanza: el llamador decide si un problema bloquea o sólo se muestra.
 */
export async function assertPdtpFulfillmentCoverage(programId: string, client: QueryClient = db): Promise<PdtpFulfillmentCoverageIssue[]> {
  const activities = await client.select().from(pdtpActivities)
    .where(and(eq(pdtpActivities.programId, programId), eq(pdtpActivities.status, "active")))
  if (activities.length === 0) return []

  const declaredGlobally = await activityNumbersDeclaredGlobally(client)
  const declaredPerWorksite = await activityNumbersDeclaredPerWorksite(client)
  const worksiteIds = await programWorksiteIds(client, programId)
  const worksiteNameById = new Map(
    (await client.select({ id: worksites.id, name: worksites.name }).from(worksites)).map((row) => [row.id, row.name]),
  )
  const responsibleRows = await client.select().from(pdtpResponsibleCatalog)
  const roleBySlug = new Map(responsibleRows.map((row) => [row.slug, row.roleName ?? row.operatedByRoleName]))
  const permissionsByRole = await permissionsByRoleName(client)

  const issues: PdtpFulfillmentCoverageIssue[] = []
  for (const activity of activities) {
    const slugs = (activity.responsibleSlugs as string[] | null) ?? []
    const roles = slugs.map((slug) => roleBySlug.get(slug)).filter((role): role is string => Boolean(role))
    if (roles.length === 0) {
      issues.push({
        n: activity.n, activity: activity.activity, status: "permission_gap",
        reason: "Ninguno de sus responsables declarados mapea a un rol RBAC real ni a un operador de plataforma.",
      })
      continue
    }

    if (activity.mechanism === "sin_definir") {
      issues.push({ n: activity.n, activity: activity.activity, status: "code_gap", reason: "Sin mecanismo de acreditación clasificado." })
      continue
    }

    // Que el responsable exista como rol no basta: ese rol tiene que poder
    // entrar a donde el trabajo se registra. Antes la compuerta se quedaba en
    // el mapeo, así que una actividad pasaba con un responsable que abría la
    // tarjeta en /pendientes y se encontraba con un 403.
    const requiredPermission = destinationPermissionFor(activity.mechanism)
    if (requiredPermission && !roles.some((role) => permissionsByRole.get(role)?.has(requiredPermission))) {
      issues.push({
        n: activity.n, activity: activity.activity, status: "permission_gap",
        reason: `Ninguno de sus responsables (${roles.join(", ")}) tiene ${requiredPermission}, el permiso del módulo donde se registra.`,
      })
      continue
    }

    if (activity.mechanism === "constancia" && !activity.evidenceRequirement?.trim()) {
      issues.push({ n: activity.n, activity: activity.activity, status: "config_required", reason: "Es constancia y no declara evidencia mínima." })
      continue
    }

    // `compuesta` entra en la verificación de cableado igual que `enganche`.
    // La exención que tenía estaba razonada para el chequeo de PERMISO —nadie
    // la ejecuta, se cumple cuando sus componentes cierran— y se arrastró hasta
    // acá, donde no aplica: una compuesta sin ningún componente que la acredite
    // no se cumple sola, no se cumple nunca. Es lo que dejaba pasar a la N°16 y
    // la N°17.
    if (activity.mechanism === "enganche" || activity.mechanism === "compuesta") {
      const issue = wiringIssueFor(activity, {
        declaredGlobally, declaredPerWorksite, worksiteIds, worksiteNameById,
      })
      if (issue) {
        issues.push(issue)
        continue
      }
    }

    // Enganche con destino conocido: se **reporta**, no se bloquea. El mapa es
    // nuevo y buena parte de lo que encuentra es segregación de deberes —quien
    // redacta el plan de emergencia no es quien lo firma—, no grants que
    // falten. Va después de la verificación de cableado: una actividad sin
    // destino declarado ya salió como `config_required` y repetirlo sería ruido.
    if (activity.mechanism === "enganche") {
      const destination = engancheDestinationPermissionFor(activity.n)
      if (destination && !roles.some((role) => permissionsByRole.get(role)?.has(destination.permission))) {
        issues.push({
          n: activity.n, activity: activity.activity, status: "destination_review",
          reason: `Se cumple en ${destination.module} y ninguno de sus responsables (${roles.join(", ")}) tiene ${destination.permission}.`,
        })
        continue
      }
    }

    // El padrón derivado cae a la cantidad planificada cuando no hay fuente
    // declarada (H11): no es un bloqueo, pero merece señalarse para que no
    // quede leído como un olvido.
    if (activity.indicatorMode === "coverage" && !activity.subjectSource) {
      issues.push({
        n: activity.n, activity: activity.activity, status: "decision_required",
        reason: "Se mide por cobertura sin fuente de padrón declarada: cae a la cantidad planificada.",
      })
    }
  }

  return issues
}
