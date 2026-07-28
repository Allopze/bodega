import { db } from "@/db"
import { physicalInventoryCountItems, physicalInventoryCounts, products, worksiteStock } from "@/db/schema"
import { and, eq } from "drizzle-orm"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit } from "@/lib/audit"
import { applyMovementTx } from "@/lib/services/stock"
import type { Session } from "next-auth"

export interface PhysicalInventoryCountItemInput {
  productId: string
  countedQuantity: number
  notes?: string | null
}

export interface ClosePhysicalInventoryCountInput {
  worksiteId: string
  notes?: string | null
  items: PhysicalInventoryCountItemInput[]
}

export interface ClosedPhysicalInventoryCount {
  id: string
  code: string
  adjustmentCount: number
}

function ensureQuantity(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} debe ser un numero no negativo`)
  }
}

function assertCanAccessWorksite(worksiteId: string, worksiteIds: string[] | "all") {
  if (worksiteIds !== "all" && !worksiteIds.includes(worksiteId)) {
    throw new Error("No tienes acceso a esta faena")
  }
}

export async function closePhysicalInventoryCount(
  session: Session,
  input: ClosePhysicalInventoryCountInput,
  worksiteIds: string[] | "all",
): Promise<ClosedPhysicalInventoryCount> {
  if (!input.worksiteId) throw new Error("Faena requerida")
  assertCanAccessWorksite(input.worksiteId, worksiteIds)
  if (input.items.length === 0) throw new Error("Agrega al menos un producto al conteo")

  const seen = new Set<string>()
  const items = [...input.items].sort((a, b) => a.productId.localeCompare(b.productId))
  for (const item of items) {
    if (!item.productId) throw new Error("Producto requerido")
    if (seen.has(item.productId)) throw new Error("El conteo no puede repetir productos")
    seen.add(item.productId)
    ensureQuantity(item.countedQuantity, "Stock contado")
  }

  const now = new Date().toISOString()
  const id = nanoid()
  let code = ""
  let adjustmentCount = 0

  await db.transaction(async (tx) => {
    code = await nextCodeTx(tx, "CON", new Date().getFullYear())

    await tx.insert(physicalInventoryCounts).values({
      id,
      code,
      worksiteId: input.worksiteId,
      status: "closed",
      countedBy: session.user.id,
      closedBy: session.user.id,
      closedAt: now,
      notes: input.notes?.trim() || null,
      createdAt: now,
      updatedAt: now,
    })

    const canonicalItems: Array<typeof physicalInventoryCountItems.$inferInsert> = []
    for (const item of items) {
      // Lock the product first so a zero/no-row balance also has a stable
      // serialization point. Then lock its actual worksite balance.
      const [product] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.id, item.productId))
        .for("update")
      if (!product) throw new Error("Producto no encontrado")

      const [stock] = await tx
        .select({ quantity: worksiteStock.quantity })
        .from(worksiteStock)
        .where(and(
          eq(worksiteStock.worksiteId, input.worksiteId),
          eq(worksiteStock.productId, item.productId),
        ))
        .for("update")
      const expectedQuantity = stock?.quantity ?? 0
      canonicalItems.push({
        id: nanoid(),
        countId: id,
        productId: item.productId,
        expectedQuantity,
        countedQuantity: item.countedQuantity,
        difference: item.countedQuantity - expectedQuantity,
        notes: item.notes?.trim() || null,
      })
    }

    await tx.insert(physicalInventoryCountItems).values(canonicalItems)

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "create",
      entityType: "physical_inventory_count",
      entityId: id,
      entityCode: code,
      newState: {
        worksiteId: input.worksiteId,
        status: "closed",
        itemCount: items.length,
      },
    }, tx)

    for (const item of canonicalItems) {
      const difference = item.difference ?? 0
      if (difference === 0) continue
      adjustmentCount += 1
      await applyMovementTx(tx, {
        worksiteId: input.worksiteId,
        productId: item.productId,
        type: "ajuste",
        quantity: difference,
        referenceType: "physical_inventory_count",
        referenceId: id,
        performedBy: session.user.id,
        userEmail: session.user.email ?? undefined,
        reason: `Conteo fisico ${code}`,
        notes: item.notes ?? input.notes ?? undefined,
      })
    }
  })

  return { id, code, adjustmentCount }
}
