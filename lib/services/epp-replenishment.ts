/**
 * EPP Replenishment Service (M-4).
 * Generates draft purchase requests based on prevention coverage gaps (expired / missing EPP).
 */
import { db } from "@/db"
import { purchaseRequests, purchaseRequestItems, products } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { listEppCoverageGaps, type EppAccess } from "./prevention-epp"

export async function generateReplenishmentDrafts(
  access: EppAccess,
): Promise<{ createdCount: number; requestCodes: string[] }> {
  const gaps = await listEppCoverageGaps(access)
  if (gaps.length === 0) {
    return { createdCount: 0, requestCodes: [] }
  }

  // Group gaps by worksiteId
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
      const requestId = nanoid()
      const code = await nextCodeTx(tx, "SOL", year)

      await tx.insert(purchaseRequests).values({
        id: requestId,
        code,
        worksiteId,
        requesterId: access.userId,
        requestType: "epp",
        urgency: worksiteGaps.some((g) => g.enforcement === "blocking") ? "high" : "normal",
        requiredDate: now.slice(0, 10),
        status: "draft",
        notes: `Solicitud de reposición automática generada por Prevención (${worksiteGaps.length} brechas detectadas).`,
        createdAt: now,
        updatedAt: now,
      })

      for (let i = 0; i < worksiteGaps.length; i++) {
        const gap = worksiteGaps[i]
        if (!gap) continue

        // Try to match product by eppTypeId or label
        const matchedProduct = await tx.query.products.findFirst({
          where: (p, { eq }) => eq(p.name, gap.eppTypeLabel),
        })

        await tx.insert(purchaseRequestItems).values({
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
        })
      }

      createdCodes.push(code)
    }
  })

  return {
    createdCount: createdCodes.length,
    requestCodes: createdCodes,
  }
}
