import { and, count, desc, eq, inArray, like } from "drizzle-orm"
import { db } from "@/db"
import { pdtpFulfillmentEvents, pdtpPrograms, pdtpProgramWorksites } from "@/db/schema"
import { computePdtpProgramContentDigestForStoredVersion } from "@/lib/services/pdtp/content-digest"
import { NO_ACTIVE_PROGRAM_LAST_ERROR_TAG } from "@/lib/services/pdtp/fulfillment"

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
    return `Actividad(es) N°${result.skippedExcluded.join(", ")} excluidas de esta faena.`
  }
  if (result.skippedNotFound && result.skippedNotFound.length > 0) {
    return `Actividad(es) N°${result.skippedNotFound.join(", ")} no existen en el programa vigente.`
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
 * faenas; de lo contrario se conserva el comportamiento histórico global.
 * `digestDrift` compara la huella de ESTE programa contra lo firmado.
 */
export async function countPdtpFulfillmentBacklog(programId: string): Promise<{
  pending: number
  errored: number
  /**
   * PDTP-002: eventos que el motor resolvió y decidió NO acreditar. Se cuentan
   * aparte de `errored` porque no son un fallo del cableado y el cron no los
   * va a reintentar: exigen que alguien mire el hecho y decida.
   */
  rejected: number
  /** Los últimos rechazos, con su razón ya traducida, para que el panel diga algo. */
  recentRejected: Array<{ sourceType: string; sourceId: string; occurredAt: string; reason: string }>
  /**
   * Subconjunto de `errored` cuya causa es `PdtpNoActiveProgramError` (el
   * programa todavía no está activo, o sigue en revisión): es el estado
   * normal entre firmar y activar, no una brecha de cableado. Se cuenta
   * aparte, nunca se resta de `errored`, para que quien mire el número
   * completo lo siga viendo — sólo cambia lo que decide si el preflight está
   * `ok`.
   */
  erroredWaitingOnActivation: number
  lastError: string | null
  digestDrift: boolean
}> {
  const programMembers = await db.select({ worksiteId: pdtpProgramWorksites.worksiteId })
    .from(pdtpProgramWorksites)
    .where(and(eq(pdtpProgramWorksites.programId, programId), eq(pdtpProgramWorksites.isActive, true)))
  const memberScope = programMembers.length > 0
    ? inArray(pdtpFulfillmentEvents.worksiteId, programMembers.map((row) => row.worksiteId))
    : undefined
  const [[pendingRow], [erroredRow], [erroredWaitingRow], [rejectedRow], rejectedRows, [lastErrorEvent], [program]] = await Promise.all([
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
    }).from(pdtpFulfillmentEvents)
      .where(and(eq(pdtpFulfillmentEvents.status, "rejected"), memberScope))
      .orderBy(desc(pdtpFulfillmentEvents.updatedAt))
      .limit(5),
    db.select({ lastError: pdtpFulfillmentEvents.lastError }).from(pdtpFulfillmentEvents)
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
  if (program?.contentDigest) {
    const { digest } = await computePdtpProgramContentDigestForStoredVersion(programId)
    digestDrift = digest !== program.contentDigest
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
    })),
    erroredWaitingOnActivation: Number(erroredWaitingRow?.total ?? 0),
    lastError: lastErrorEvent?.lastError ?? null,
    digestDrift,
  }
}
