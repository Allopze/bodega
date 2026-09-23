/**
 * lib/services/pdtp-adapters/external-engagement-accreditation-connector.ts
 *
 * Conector entre "Visitas y coordinación" (`prevention_external_engagements`)
 * y el motor de auto-acreditación PDTP — Task 12 (M2.5).
 *
 * Hasta esta tarea la N°20 ("coordinar programas preventivos con la empresa
 * mandante", DS 44 art. 20) se declaraba a mano en Constancias, mientras el
 * módulo de Visitas y coordinación ya registraba la misma reunión sin tocar el
 * PDTP para nada: el mismo hecho, cargado dos veces por dos caminos distintos.
 * Este conector retira el doble registro — la N°20 se acredita al **cerrar**
 * la interacción, no al declararla aparte.
 *
 * Sólo una combinación de las tres que cubre la tabla acredita: `kind:
 * 'coordinacion'` (DS 44 art. 20 — el resto son fiscalizaciones o visitas del
 * organismo administrador, que no son esta obligación) con `counterpartyType:
 * 'mandante'` (una coordinación con otra empresa de la faena o un
 * contratista no es la reunión que la N°20 exige). Cerrar cualquier otra
 * interacción no acredita nada.
 *
 * La evidencia sale de `sst_document_links` (`entityType: 'external_engagement'`,
 * ya un valor válido del check desde antes de esta tarea): si hay un acta o
 * correo subido y vinculado a la interacción, su ruta de storage es evidencia
 * real y la acreditación puede auto-aprobar. Si no hay documento vinculado, se
 * cae al `officialReference` de la interacción como texto — que
 * `accreditPdtpFromEvent` (`isRealEvidence`) trata como no-real, así que la
 * ejecución queda `submitted` para revisión manual. Es el comportamiento
 * correcto: no auto-aprobar sin evidencia real, no inventar una tercera fuente
 * de evidencia.
 *
 * Fire-and-forget, como el resto de los conectores de este plan: la
 * interacción ya quedó cerrada y confirmada en su propia transacción
 * (`closeExternalEngagement`), y un fallo acá no debe deshacerla.
 */

import { and, desc, eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import { sstDocumentLinks, sstDocuments, sstDocumentVersions } from "@/db/schema"
import { logger } from "@/lib/logger"
import { recordPdtpFulfillmentEvent } from "@/lib/services/pdtp/fulfillment"
import { pdtpCatalogActivityIdForLegacyNumber } from "./catalog-activities-2026"

/** N°20: "Coordinar programas preventivos con la empresa mandante" (DS 44 art. 20). */
const PDTP_MANDANTE_COORDINATION_ACTIVITY_NUMBER = 20

/**
 * Mediodía de Chile en UTC, mismo criterio que el resto de los conectores de
 * este plan (higiene, RE-28, trabajador nuevo): `occurredOn` es una fecha
 * civil `YYYY-MM-DD`, y sellarla a medianoche UTC la correría al día/mes
 * anterior en Chile.
 */
function occurredAtFromChileDate(plainDate: string): string {
  return `${plainDate}T12:00:00.000Z`
}

/**
 * La ruta de storage del documento vigente más reciente vinculado a la
 * interacción, si hay alguno. `removedAt IS NULL` descarta vínculos
 * retirados; el `INNER JOIN` con la versión descarta un documento sin versión
 * publicada (`currentVersionId` nulo): ahí no hay archivo real que ofrecer
 * todavía, y cae al siguiente nivel del fallback igual que si no hubiera
 * vínculo.
 *
 * La interacción ya quedó cerrada y confirmada en su propia transacción antes
 * de llegar acá (ver el docblock del archivo): un hipo transitorio de esta
 * consulta no debe propagarse como si el cierre hubiera fallado. Se degrada a
 * "sin documento vinculado" y deja rastro en el log, igual que el resto de
 * los conectores de este plan.
 */
async function linkedEvidencePath(engagementId: string): Promise<string | null> {
  try {
    const [linked] = await db
      .select({ filePath: sstDocumentVersions.filePath })
      .from(sstDocumentLinks)
      .innerJoin(sstDocuments, eq(sstDocuments.id, sstDocumentLinks.documentId))
      .innerJoin(sstDocumentVersions, eq(sstDocumentVersions.id, sstDocuments.currentVersionId))
      .where(and(
        eq(sstDocumentLinks.entityType, "external_engagement"),
        eq(sstDocumentLinks.entityId, engagementId),
        isNull(sstDocumentLinks.removedAt),
      ))
      .orderBy(desc(sstDocumentLinks.createdAt))
      .limit(1)
    return linked?.filePath ?? null
  } catch (err) {
    logger.error(
      { err, engagementId },
      "[external-engagement-pdtp-connector] No se pudo resolver el documento vinculado; se usa el fallback de evidencia.",
    )
    return null
  }
}

/**
 * Llama desde `closeExternalEngagement`, después de confirmado el cierre.
 *
 * `officialReference` no es obligatorio en una coordinación (el check
 * `prevention_external_engagement_reference_required` sólo lo exige para
 * fiscalización/organismo administrador), así que el fallback final es un
 * rótulo descriptivo — nunca texto vacío.
 */
export async function onExternalEngagementClosed(input: {
  engagementId: string
  worksiteId: string
  kind: string
  counterpartyType: string
  /** Fecha civil (`YYYY-MM-DD`) de la reunión, no de su cierre en el sistema. */
  occurredOn: string
  officialReference: string | null
  closedByUserId: string
}): Promise<void> {
  if (input.kind !== "coordinacion" || input.counterpartyType !== "mandante") return

  const linkedPath = await linkedEvidencePath(input.engagementId)
  const reference = input.officialReference?.trim() || null
  const evidenceRef = linkedPath
    ?? reference
    ?? `Reunión de coordinación (DS 44 art. 20) con la empresa mandante: ${input.engagementId}`

  await recordPdtpFulfillmentEvent({
    sourceType: "engagement",
    sourceId: `coordinacion-mandante:${input.engagementId}`,
    worksiteId: input.worksiteId,
    catalogActivityIds: [pdtpCatalogActivityIdForLegacyNumber(PDTP_MANDANTE_COORDINATION_ACTIVITY_NUMBER)],
    occurredAt: occurredAtFromChileDate(input.occurredOn),
    executedQuantity: 1,
    evidenceRef,
    autoApproveByUserId: input.closedByUserId,
    metadata: { kind: input.kind, counterpartyType: input.counterpartyType },
  })
}
