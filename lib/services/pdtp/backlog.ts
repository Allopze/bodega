import { and, count, desc, eq, inArray, like, sql } from "drizzle-orm"
import { db } from "@/db"
import { pdtpFulfillmentEvents, pdtpPrograms, pdtpProgramWorksites, worksites } from "@/db/schema"
import {
  computePdtpProgramContentDigestForStoredVersion,
  PdtpContentSchemaVersionMissingError,
  PdtpUnreconstructibleContentSchemaError,
} from "@/lib/services/pdtp/content-digest"
import { NO_ACTIVE_PROGRAM_LAST_ERROR_TAG } from "@/lib/services/pdtp/fulfillment"
import { chileDateParts, pluralize } from "@/lib/utils"

/**
 * Cómo se nombra el origen de un hecho en pantalla. `sourceType` es una clave
 * de cableado (`epp`, `miper`, `cgrd`): mostrarla cruda incumple PRODUCT.md y
 * además no le dice nada a quien opera el programa. Las etiquetas siguen el
 * nombre que el módulo ya tiene en la navegación, para que sean la misma
 * palabra en los dos lugares.
 */
export const PDTP_FULFILLMENT_SOURCE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  alcotest: "Alcotest",
  aprobacion_programa: "Aprobación de programa",
  campana: "Campaña de seguridad",
  capacitacion: "Capacitación",
  capacitacion_ocurrencia: "Capacitación",
  cgrd: "Gestión de riesgos de desastres",
  cphs: "Comités paritarios",
  documento: "Documentación SST",
  emergencia: "Emergencias",
  epp: "Entrega de EPP",
  evaluacion_sst: "Evaluación SST",
  higiene: "Higiene y vigilancia",
  incident: "Incidentes y accidentes",
  indicadores: "Indicadores SST",
  inspeccion: "Inspecciones",
  miper: "Matriz IPER",
  obligacion: "Obligación del programa",
  pdtp: "Programa de trabajo",
  pdtp_xlsx_cell: "Carga manual del RE-36",
  ppa: "Permisos de trabajo",
  toma_conocimiento: "Toma de conocimiento del programa",
  vigilancia: "Higiene y vigilancia",
})

/**
 * Un `sourceType` sin etiqueta declarada no debe romper la pantalla ni filtrar
 * la clave cruda: se muestra como "Otro origen" y el identificador queda fuera.
 * Perder precisión es preferible a mostrar `pdtp_xlsx_cell` en una pantalla que
 * mira jefatura.
 */
export function pdtpFulfillmentSourceLabel(sourceType: string): string {
  return PDTP_FULFILLMENT_SOURCE_LABELS[sourceType] ?? "Otro origen"
}

/**
 * `DD-MM-AAAA` en hora de Chile, o `null` si no hay fecha utilizable. Un
 * instante UTC adelanta el día entre las 20:00 y la medianoche chilena, y el
 * hecho aparecería fechado mañana en la faena donde ocurrió.
 */
function chileDay(value: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  const { year, month, day } = chileDateParts(parsed)
  return `${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}-${year}`
}

/**
 * Traduce el `lastError` del libro de cumplimiento a una frase legible.
 *
 * `pdtp_fulfillment_events.lastError` guarda el `message` de la excepción tal
 * cual, y el del caso más frecuente interpola identificadores internos
 * (`epp:MpRpdOL3wOdTmb2v0bAN4`, `faena mHyTTFyYZMStchMpBaSmo`). Ese texto es un
 * diagnóstico de motor, no copy: se conserva en `lastError` para quien depura,
 * y la pantalla muestra esto.
 *
 * Sólo se puede traducir lo que el motor marca. Para `[no-active-program]`
 * tenemos la causa y el contexto estructurado; para cualquier otra excepción no
 * hay forma de reescribir un mensaje arbitrario, así que se devuelve tal cual.
 */
export function describePdtpFulfillmentError(input: {
  lastError: string | null
  sourceType: string | null
  worksiteName: string | null
  occurredAt: string | null
}): string | null {
  if (!input.lastError) return null
  if (!input.lastError.startsWith(NO_ACTIVE_PROGRAM_LAST_ERROR_TAG)) return input.lastError

  const origen = input.sourceType ? pdtpFulfillmentSourceLabel(input.sourceType).toLowerCase() : "un hecho"
  const faena = input.worksiteName ? `la faena ${input.worksiteName}` : "esa faena"
  const dia = chileDay(input.occurredAt)
  const cuando = dia ? ` del ${dia}` : ""
  return (
    `Sin programa PDTP vigente que cubra ${faena} para ${origen}${cuando}. ` +
    "Los hechos quedan guardados y se acreditan solos en cuanto el programa del año esté activo y declare esa faena."
  )
}

/**
 * PDTP-002 (auditoría 2026-09-14) — Por qué la plataforma decidió no acreditar.
 *
 * Un evento `rejected` no es un fallo técnico: el motor resolvió y decidió que
 * no hay destino. Las tres razones son normales —el hecho ocurrió fuera del
 * año del programa (lo más probable, porque las entregas de EPP admiten fecha
 * retroactiva), la actividad está excluida de esa faena, o el número de
 * actividad no existe en el programa— y ninguna dejaba rastro visible: el
 * trabajo se hizo, no se acreditó y nadie se enteraba.
 *
 * El `resultJson` ya guardaba el detalle; sólo faltaba traducirlo.
 */
export function describePdtpRejection(resultJson: unknown): string {
  const result = (resultJson ?? {}) as {
    skippedOutOfPeriod?: { occurredYear?: number; programYear?: number }
    skippedExcluded?: number[]
    skippedNotFound?: number[]
  }
  if (result.skippedOutOfPeriod) {
    const { occurredYear, programYear } = result.skippedOutOfPeriod
    return `El hecho ocurrió en ${occurredYear ?? "otro año"} y el programa vigente cubre ${programYear ?? "otro año"}.`
  }
  if (result.skippedExcluded && result.skippedExcluded.length > 0) {
    const n = result.skippedExcluded.length
    return `${pluralize(n, "Actividad", "Actividades")} N°${result.skippedExcluded.join(", ")} ${n === 1 ? "excluida" : "excluidas"} de esta faena.`
  }
  if (result.skippedNotFound && result.skippedNotFound.length > 0) {
    const n = result.skippedNotFound.length
    return `${pluralize(n, "Actividad", "Actividades")} N°${result.skippedNotFound.join(", ")} no ${n === 1 ? "existe" : "existen"} en el programa vigente.`
  }
  return "El motor no encontró ninguna actividad del programa a la que acreditar el hecho."
}

/**
 * Lo que el libro de cumplimiento tiene sin resolver, y si el programa vivo
 * todavía coincide con lo que se firmó.
 *
 * Nada leía `pdtp_fulfillment_events`, así que un evento en `error` era
 * invisible hasta que alguien corría el script del deploy. La deriva de huella
 * se mide acá porque los overrides por faena son legales sobre un programa
 * activo y entran al digest: es el único lugar donde alguien notaría que lo
 * vigente ya no es lo firmado.
 *
 * Los conteos NO filtran sólo por `programId`: un evento en `error` no llegó
 * a resolver a qué programa acredita —`recordPdtpFulfillmentEvent` sólo
 * escribe `program_id` en la rama de éxito—, así que filtrar por programa
 * dejaría exactamente los eventos que este panel existe para mostrar fuera
 * del conteo. Cuando el programa declara membresía, sí se restringen a esas
 * faenas; para un programa corporativo explícito se consulta el universo
 * activo. Si el programa quedó sin alcance, el libro deja los eventos sin
 * filtrar para hacer visible el riesgo y permitir su reconciliación; eso no
 * convierte a la versión en ejecutable ni acredita hechos automáticamente.
 * La pantalla puede pasar además las faenas visibles de la sesión: en ese
 * caso el conteo se intersecta con ese alcance y nunca expone el libro de otra
 * faena a un usuario restringido. El preflight omite ese filtro para conservar
 * su diagnóstico global.
 * `digestDrift` compara la huella de ESTE programa contra lo firmado.
 */
export async function countPdtpFulfillmentBacklog(programId: string, options?: { worksiteIds?: string[] }): Promise<{
  pending: number
  errored: number
  /**
   * PDTP-002: eventos que el motor resolvió y decidió NO acreditar. Se cuentan
   * aparte de `errored` porque no son un fallo del cableado y el cron no los
   * va a reintentar: exigen que alguien mire el hecho y decida.
   */
  rejected: number
  /**
   * Los últimos rechazos, con su razón ya traducida, para que el panel diga
   * algo. `sourceType`/`sourceId` siguen expuestos porque el preflight los usa
   * para señalar la fila exacta; la pantalla muestra `sourceLabel`,
   * `worksiteName` y `occurredOn`, que es lo mismo dicho en castellano.
   */
  recentRejected: Array<{
    sourceType: string
    sourceId: string
    occurredAt: string
    reason: string
    sourceLabel: string
    worksiteName: string | null
    occurredOn: string | null
  }>
  /**
   * Subconjunto de `errored` cuya causa es `PdtpNoActiveProgramError` (el
   * programa todavía no está activo, o sigue en revisión): es el estado
   * normal entre firmar y activar, no una brecha de cableado. Se cuenta
   * aparte, nunca se resta de `errored`, para que quien mire el número
   * completo lo siga viendo — sólo cambia lo que decide si el preflight está
   * `ok`.
   */
  erroredWaitingOnActivation: number
  /**
   * El `message` crudo de la excepción, con identificadores internos incluidos.
   * Es diagnóstico: lo consume `preflight-pdtp-accreditation-wiring`. La
   * pantalla usa `lastErrorDescription`.
   */
  lastError: string | null
  /** El mismo error dicho para quien opera el programa. */
  lastErrorDescription: string | null
  digestDrift: boolean
  /** La firma existe, pero su esquema histórico no permite verificarla aún. */
  digestVerificationUnavailable: boolean
  digestVerificationMessage: string | null
}> {
  const [[programScope], programMembers, activeWorksites] = await Promise.all([
    db.select({ appliesToAllWorksites: pdtpPrograms.appliesToAllWorksites })
      .from(pdtpPrograms)
      .where(eq(pdtpPrograms.id, programId))
      .limit(1),
    db.select({ worksiteId: pdtpProgramWorksites.worksiteId })
      .from(pdtpProgramWorksites)
      .where(and(eq(pdtpProgramWorksites.programId, programId), eq(pdtpProgramWorksites.isActive, true))),
    db.select({ id: worksites.id })
      .from(worksites)
      .where(eq(worksites.isActive, true)),
  ])
  const visibleWorksiteIds = options?.worksiteIds
  const visibleWorksiteSet = visibleWorksiteIds ? new Set(visibleWorksiteIds) : null
  // Una versión corporativa explícita no tiene filas de membresía por diseño,
  // pero sí tiene un universo ejecutable: las faenas activas. Sin este límite,
  // el libro contaba eventos de faenas desactivadas (y podía mezclar datos de
  // otros alcances) porque `memberScope` quedaba indefinido.
  const memberIds = programMembers.length > 0
    ? programMembers.map((row) => row.worksiteId)
    : programScope?.appliesToAllWorksites
      ? activeWorksites.map((row) => row.id)
      : []
  const hasProgramScope = programMembers.length > 0 || Boolean(programScope?.appliesToAllWorksites)
  const scopedEventWorksiteIds = visibleWorksiteSet
    ? (hasProgramScope
      ? memberIds.filter((worksiteId) => visibleWorksiteSet.has(worksiteId))
      : [...visibleWorksiteSet])
    : memberIds
  const memberScope = (programMembers.length > 0 || programScope?.appliesToAllWorksites || visibleWorksiteIds)
    ? scopedEventWorksiteIds.length > 0
      ? inArray(pdtpFulfillmentEvents.worksiteId, scopedEventWorksiteIds)
      : sql`false`
    : undefined
  const [[pendingRow], [erroredRow], [erroredWaitingRow], [rejectedRow], rejectedRows, [lastErrorEvent], [programDigest]] = await Promise.all([
    db.select({ total: count() }).from(pdtpFulfillmentEvents)
      .where(and(eq(pdtpFulfillmentEvents.status, "pending"), memberScope)),
    db.select({ total: count() }).from(pdtpFulfillmentEvents)
      .where(and(eq(pdtpFulfillmentEvents.status, "error"), memberScope)),
    db.select({ total: count() }).from(pdtpFulfillmentEvents)
      .where(and(
        eq(pdtpFulfillmentEvents.status, "error"),
        like(pdtpFulfillmentEvents.lastError, `${NO_ACTIVE_PROGRAM_LAST_ERROR_TAG}%`),
        memberScope,
      )),
    db.select({ total: count() }).from(pdtpFulfillmentEvents)
      .where(and(eq(pdtpFulfillmentEvents.status, "rejected"), memberScope)),
    db.select({
      sourceType: pdtpFulfillmentEvents.sourceType,
      sourceId: pdtpFulfillmentEvents.sourceId,
      occurredAt: pdtpFulfillmentEvents.occurredAt,
      resultJson: pdtpFulfillmentEvents.resultJson,
      worksiteName: worksites.name,
    }).from(pdtpFulfillmentEvents)
      .leftJoin(worksites, eq(worksites.id, pdtpFulfillmentEvents.worksiteId))
      .where(and(eq(pdtpFulfillmentEvents.status, "rejected"), memberScope))
      .orderBy(desc(pdtpFulfillmentEvents.updatedAt))
      .limit(5),
    // El `leftJoin` es a propósito: una faena borrada no debe hacer desaparecer
    // el último error del libro, sólo deja el nombre en nulo y la frase cae en
    // su variante genérica.
    db.select({
      lastError: pdtpFulfillmentEvents.lastError,
      sourceType: pdtpFulfillmentEvents.sourceType,
      occurredAt: pdtpFulfillmentEvents.occurredAt,
      worksiteName: worksites.name,
    }).from(pdtpFulfillmentEvents)
      .leftJoin(worksites, eq(worksites.id, pdtpFulfillmentEvents.worksiteId))
      .where(and(eq(pdtpFulfillmentEvents.status, "error"), memberScope))
      .orderBy(desc(pdtpFulfillmentEvents.updatedAt))
      .limit(1),
    db.select({ contentDigest: pdtpPrograms.contentDigest }).from(pdtpPrograms)
      .where(eq(pdtpPrograms.id, programId))
      .limit(1),
  ])

  // Un programa sin huella firmada (todavía en borrador) no tiene contra qué
  // derivar: `contentDigest` nulo es "no hay firma", no "deriva sin medir".
  let digestDrift = false
  let digestVerificationUnavailable = false
  let digestVerificationMessage: string | null = null
  if (programDigest?.contentDigest) {
    try {
      const { digest } = await computePdtpProgramContentDigestForStoredVersion(programId)
      digestDrift = digest !== programDigest.contentDigest
    } catch (error) {
      if (error instanceof PdtpContentSchemaVersionMissingError || error instanceof PdtpUnreconstructibleContentSchemaError) {
        digestVerificationUnavailable = true
        digestVerificationMessage = error.message
      } else {
        throw error
      }
    }
  }

  return {
    pending: Number(pendingRow?.total ?? 0),
    errored: Number(erroredRow?.total ?? 0),
    rejected: Number(rejectedRow?.total ?? 0),
    recentRejected: rejectedRows.map((row) => ({
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      occurredAt: row.occurredAt,
      reason: describePdtpRejection(row.resultJson),
      sourceLabel: pdtpFulfillmentSourceLabel(row.sourceType),
      worksiteName: row.worksiteName ?? null,
      occurredOn: chileDay(row.occurredAt),
    })),
    erroredWaitingOnActivation: Number(erroredWaitingRow?.total ?? 0),
    lastError: lastErrorEvent?.lastError ?? null,
    lastErrorDescription: describePdtpFulfillmentError({
      lastError: lastErrorEvent?.lastError ?? null,
      sourceType: lastErrorEvent?.sourceType ?? null,
      worksiteName: lastErrorEvent?.worksiteName ?? null,
      occurredAt: lastErrorEvent?.occurredAt ?? null,
    }),
    digestDrift,
    digestVerificationUnavailable,
    digestVerificationMessage,
  }
}
