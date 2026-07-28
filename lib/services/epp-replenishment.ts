/**
 * EPP Replenishment Service (M-4).
 * Generates draft purchase requests based on prevention coverage gaps (expired / missing EPP).
 */
import { db } from "@/db"
import { eq } from "drizzle-orm"
import { eppReplenishmentLinks, purchaseRequests, purchaseRequestItems } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { listEppCoverageGaps, type EppAccess } from "./prevention-epp"

function gapVersion(gap: { gapType: "missing" | "expired"; lastDeliveredAt: string | null }) {
  return `${gap.gapType}:${gap.lastDeliveredAt ?? "none"}`
}

export async function generateReplenishmentDrafts(
  access: EppAccess,
): Promise<{ createdCount: number; requestCodes: string[] }> {
  const gaps = await listEppCoverageGaps(access)
  if (gaps.length === 0) {
    return { createdCount: 0, requestCodes: [] }
  }

  // Group gaps by worksiteId.
  const gapsByWorksite = new Map<string, typeof gaps>()
  for (const gap of gaps) {
    const list = gapsByWorksite.get(gap.worksiteId) ?? []
    list.push(gap)
    gapsByWorksite.set(gap.worksiteId, list)
  }

  const now = new Date().toISOString()
  const year = new Date().getFullYear()
  const createdCodes: string[] = []

  await db.transaction(async (tx) => {
    for (const [worksiteId, worksiteGaps] of gapsByWorksite.entries()) {
      const reservedGaps: Array<{ gap: (typeof gaps)[number]; linkId: string }> = []
      for (const gap of worksiteGaps) {
        // Reserve each live gap before creating any request data. The partial
        // unique index makes the reservation idempotent even under concurrent
        // executions; a conflict means another open replenishment already owns it.
        const [reserved] = await tx.insert(eppReplenishmentLinks).values({
          id:            nanoid(),
          worksiteId:    gap.worksiteId,
          workerId:      gap.workerId,
          eppTypeId:     gap.eppTypeId,
          requirementId: gap.requirementId,
          gapVersion:    gapVersion(gap),
          createdAt:     now,
        }).onConflictDoNothing().returning({ id: eppReplenishmentLinks.id })
        if (reserved) reservedGaps.push({ gap, linkId: reserved.id })
      }

      if (reservedGaps.length === 0) continue

      const requestId = nanoid()
      const code = await nextCodeTx(tx, "SOL", year)

      await tx.insert(purchaseRequests).values({
        id: requestId,
        code,
        worksiteId,
        requesterId: access.userId,
        requestType: "epp",
        urgency: reservedGaps.some(({ gap }) => gap.enforcement === "blocking") ? "high" : "normal",
        requiredDate: now.slice(0, 10),
        status: "draft",
        notes: `Solicitud de reposición automática generada por Prevención (${reservedGaps.length} brechas detectadas).`,
        createdAt: now,
        updatedAt: now,
      })

      for (let i = 0; i < reservedGaps.length; i++) {
        const reservation = reservedGaps[i]
        if (!reservation) continue
        const { gap } = reservation

        // Try to match product by eppTypeId or label
        const matchedProduct = await tx.query.products.findFirst({
          where: (p, { eq }) => eq(p.name, gap.eppTypeLabel),
        })

        const [requestItem] = await tx.insert(purchaseRequestItems).values({
          id: nanoid(),
          requestId,
          productId: matchedProduct?.id ?? null,
          productNameFree: matchedProduct ? null : gap.eppTypeLabel,
          quantity: 1,
          unitOfMeasure: matchedProduct?.unitOfMeasure ?? "unidad",
          urgency: gap.enforcement === "blocking" ? "high" : "normal",
          workerId: gap.workerId,
          sortOrder: i,
          status: "draft",
          notes: `Reposición por EPP ${gap.gapType === "expired" ? "vencido" : "no entregado"}.`,
          createdAt: now,
          updatedAt: now,
        }).returning({ id: purchaseRequestItems.id })

        if (!requestItem) throw new Error("No se pudo vincular la reposición EPP creada")
        await tx.update(eppReplenishmentLinks)
          .set({ requestItemId: requestItem.id })
          .where(eq(eppReplenishmentLinks.id, reservation.linkId))
      }

      createdCodes.push(code)
    }
  })

  return {
    createdCount: createdCodes.length,
    requestCodes: createdCodes,
  }
}
