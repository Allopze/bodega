/**
 * EPP Replenishment (M-4).
 *
 * Antes generaba solicitudes en borrador automáticamente. Desde la
 * simplificación del flujo (2026-08-07) las solicitudes nacen enviadas y las
 * crea siempre una persona, así que este servicio solo *sugiere*: entrega las
 * brechas de cobertura como ítems precargables para el creador de solicitudes.
 * La reserva del cupo (idempotencia) ocurre al crear la solicitud, dentro de su
 * misma transacción — ver `reserveReplenishmentGapsTx`.
 */
import { db, type Tx } from "@/db"
import { and, inArray, isNull } from "drizzle-orm"
import { eppReplenishmentLinks } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { listEppCoverageGaps, type EppAccess } from "./prevention-epp"

const KEY_SEPARATOR = "|"

function gapVersion(gap: { gapType: "missing" | "expired"; lastDeliveredAt: string | null }) {
  return `${gap.gapType}:${gap.lastDeliveredAt ?? "none"}`
}

/** Clave opaca que viaja con el ítem precargado hasta la creación de la solicitud. */
function gapKey(gap: {
  worksiteId: string; workerId: string; eppTypeId: string
  requirementId: string; gapType: "missing" | "expired"; lastDeliveredAt: string | null
}) {
  return [gap.worksiteId, gap.workerId, gap.eppTypeId, gap.requirementId, gapVersion(gap)].join(KEY_SEPARATOR)
}

function parseGapKey(key: string) {
  const [worksiteId, workerId, eppTypeId, requirementId, version] = key.split(KEY_SEPARATOR)
  if (!worksiteId || !workerId || !eppTypeId || !requirementId || !version) return null
  return { worksiteId, workerId, eppTypeId, requirementId, gapVersion: version }
}

export type ReplenishmentSuggestion = {
  gapKey:          string
  worksiteId:      string
  workerId:        string
  workerName:      string
  productId:       string | null
  productName:     string
  unitOfMeasure:   string
  urgency:         "normal" | "high"
  notes:           string
  /** Texto corto de procedencia para mostrar en el ítem precargado. */
  origin:          string
}

/**
 * Brechas de EPP que todavía no tienen una reposición en curso, listas para
 * precargarse como ítems del creador de solicitudes.
 */
export async function listReplenishmentSuggestions(
  access: EppAccess,
  worksiteId?: string,
): Promise<ReplenishmentSuggestion[]> {
  const gaps = await listEppCoverageGaps(access)
  const scoped = worksiteId ? gaps.filter((gap) => gap.worksiteId === worksiteId) : gaps
  if (scoped.length === 0) return []

  const openLinks = await db
    .select({
      worksiteId:    eppReplenishmentLinks.worksiteId,
      workerId:      eppReplenishmentLinks.workerId,
      eppTypeId:     eppReplenishmentLinks.eppTypeId,
      requirementId: eppReplenishmentLinks.requirementId,
      gapVersion:    eppReplenishmentLinks.gapVersion,
    })
    .from(eppReplenishmentLinks)
    .where(isNull(eppReplenishmentLinks.resolvedAt))
  const reserved = new Set(openLinks.map((link) => [
    link.worksiteId, link.workerId, link.eppTypeId, link.requirementId, link.gapVersion,
  ].join(KEY_SEPARATOR)))

  const pending = scoped.filter((gap) => !reserved.has(gapKey(gap)))
  if (pending.length === 0) return []

  // Un solo lookup del catálogo para todas las etiquetas de EPP pendientes.
  const labels = [...new Set(pending.map((gap) => gap.eppTypeLabel))]
  const catalog = await db.query.products.findMany({
    where: (p, { inArray }) => inArray(p.name, labels),
    columns: { id: true, name: true, unitOfMeasure: true },
  })
  const byName = new Map(catalog.map((product) => [product.name, product]))

  return pending.map((gap) => {
    const product = byName.get(gap.eppTypeLabel)
    return {
      gapKey:        gapKey(gap),
      worksiteId:    gap.worksiteId,
      workerId:      gap.workerId,
      workerName:    gap.workerName,
      productId:     product?.id ?? null,
      productName:   product?.name ?? gap.eppTypeLabel,
      unitOfMeasure: product?.unitOfMeasure ?? "unidad",
      urgency:       gap.enforcement === "blocking" ? "high" : "normal",
      notes:         `Reposición por EPP ${gap.gapType === "expired" ? "vencido" : "no entregado"}.`,
      origin:        `EPP ${gap.gapType === "expired" ? "vencido" : "no entregado"} · ${gap.workerName}`,
    }
  })
}

/**
 * Reserva los cupos de las brechas que originaron ítems de la solicitud recién
 * creada. El índice único parcial es la frontera de concurrencia: si otra
 * solicitud ya tomó la brecha, el insert no hace nada.
 *
 * ponytail: un conflicto se ignora en silencio (el ítem ya existe y lo pidió
 * una persona a la vista de la sugerencia). Si dos personas piden la misma
 * brecha a la vez se verá el duplicado en aprobaciones; endurecerlo exigiría
 * abortar la creación completa, que es peor.
 */
export async function reserveReplenishmentGapsTx(
  tx: Tx,
  entries: Array<{ gapKey: string; requestItemId: string }>,
): Promise<void> {
  for (const entry of entries) {
    const parsed = parseGapKey(entry.gapKey)
    if (!parsed) continue
    await tx.insert(eppReplenishmentLinks).values({
      id:            nanoid(),
      ...parsed,
      requestItemId: entry.requestItemId,
    }).onConflictDoNothing()
  }
}

/**
 * Libera la reserva de las brechas cuyo ítem murió (rechazado o cancelado)
 * sin llegar a entregarse. Sin esto, `listReplenishmentSuggestions` suprime la
 * brecha para siempre: `gapVersion` sólo cambia con una entrega que ya no va
 * a ocurrir (LOG-1/DAT-7).
 */
export async function resolveReplenishmentLinksTx(tx: Tx, requestItemIds: string[]): Promise<void> {
  if (requestItemIds.length === 0) return
  await tx
    .update(eppReplenishmentLinks)
    .set({ resolvedAt: new Date().toISOString() })
    .where(and(
      inArray(eppReplenishmentLinks.requestItemId, requestItemIds),
      isNull(eppReplenishmentLinks.resolvedAt),
    ))
}
