import { count, desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { pdtpFulfillmentEvents, pdtpPrograms } from "@/db/schema"
import { computePdtpProgramContentDigest } from "@/lib/services/pdtp/content-digest"

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
 * Los dos `count()` NO filtran por `programId`: un evento en `error` no llegó
 * a resolver a qué programa acredita —`recordPdtpFulfillmentEvent` sólo
 * escribe `program_id` en la rama de éxito—, así que filtrar por programa
 * dejaría exactamente los eventos que este panel existe para mostrar fuera
 * del conteo. En la práctica sólo hay un programa vivo (`active`/`draft`/
 * `in_review`) a la vez, que es el que importa. `digestDrift` sí es por
 * programa: compara la huella de ESTE programa contra lo que tiene firmado.
 */
export async function countPdtpFulfillmentBacklog(programId: string): Promise<{
  pending: number
  errored: number
  lastError: string | null
  digestDrift: boolean
}> {
  const [[pendingRow], [erroredRow], [lastErrorEvent], [program]] = await Promise.all([
    db.select({ total: count() }).from(pdtpFulfillmentEvents)
      .where(eq(pdtpFulfillmentEvents.status, "pending")),
    db.select({ total: count() }).from(pdtpFulfillmentEvents)
      .where(eq(pdtpFulfillmentEvents.status, "error")),
    db.select({ lastError: pdtpFulfillmentEvents.lastError }).from(pdtpFulfillmentEvents)
      .where(eq(pdtpFulfillmentEvents.status, "error"))
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
    const { digest } = await computePdtpProgramContentDigest(programId)
    digestDrift = digest !== program.contentDigest
  }

  return {
    pending: Number(pendingRow?.total ?? 0),
    errored: Number(erroredRow?.total ?? 0),
    lastError: lastErrorEvent?.lastError ?? null,
    digestDrift,
  }
}
