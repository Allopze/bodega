import { db } from "@/db"
import { physicalInventoryCountItems, physicalInventoryCounts, worksites, worksiteStock } from "@/db/schema"
import { and, desc, eq } from "drizzle-orm"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit } from "@/lib/audit"
import { applyMovementTx } from "@/lib/services/stock"
import { lockCatalogProductsForUpdateTx } from "@/lib/services/catalog-product-locks"
import type { Session } from "next-auth"

export interface PhysicalInventoryCountItemInput {
  productId: string
  countedQuantity: number
  notes?: string | null
}

export interface SavePhysicalInventoryDraftInput {
  worksiteId: string
  notes?: string | null
  items: PhysicalInventoryCountItemInput[]
}

export interface OpenPhysicalInventoryCount {
  id: string
  code: string
  items: Array<{ productId: string; countedQuantity: number }>
}

export interface ClosePhysicalInventoryCountInput {
  /** Borrador a cerrar. Sin el, el conteo nace y se cierra en un solo paso. */
  countId?: string | null
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
  let id = nanoid()
  let code = ""
  let adjustmentCount = 0

  await db.transaction(async (tx) => {
    // Use the same worksite → product → stock order as the EPP preflight and
    // stock movements. `NO KEY UPDATE` intentionally conflicts with the
    // movement worksite `FOR SHARE` before a movement can upsert a formerly
    // absent balance between this count's snapshot and its adjustment.
    const [worksite] = await tx
      .select({ id: worksites.id })
      .from(worksites)
      .where(eq(worksites.id, input.worksiteId))
      .for("no key update")
      .limit(1)
    if (!worksite) throw new Error("Faena no encontrada")

    // Do not rely on JavaScript collation for a row-lock order. The request
    // preflight locks catalog products in PostgreSQL `products.id` order, so
    // acquire all of this count's product locks through the same ordered query
    // before reading any balance. This also locks a missing stock row's parent
    // product before the later adjustment can create it.
    const productIds = [...seen]
    const lockedProductIds = await lockCatalogProductsForUpdateTx(tx, productIds)
    if (lockedProductIds.size !== productIds.length) throw new Error("Producto no encontrado")

    if (input.countId) {
      // Cierre de un borrador: conserva su folio (la hoja impresa en terreno ya
      // lo lleva) y descarta las cantidades guardadas para reescribirlas con los
      // saldos leidos bajo lock aca abajo.
      const [draft] = await tx
        .select({
          id: physicalInventoryCounts.id,
          code: physicalInventoryCounts.code,
          status: physicalInventoryCounts.status,
          worksiteId: physicalInventoryCounts.worksiteId,
        })
        .from(physicalInventoryCounts)
        .where(eq(physicalInventoryCounts.id, input.countId))
        .for("update")
        .limit(1)
      if (!draft) throw new Error("Conteo no encontrado")
      if (draft.worksiteId !== input.worksiteId) throw new Error("El conteo pertenece a otra faena")
      if (draft.status !== "draft") throw new Error("El conteo ya fue cerrado")

      id = draft.id
      code = draft.code
      await tx.delete(physicalInventoryCountItems).where(eq(physicalInventoryCountItems.countId, id))
      await tx.update(physicalInventoryCounts)
        .set({
          status: "closed",
          closedBy: session.user.id,
          closedAt: now,
          notes: input.notes?.trim() || null,
          updatedAt: now,
        })
        .where(and(eq(physicalInventoryCounts.id, id), eq(physicalInventoryCounts.status, "draft")))
    } else {
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
    }

    const canonicalItems: Array<typeof physicalInventoryCountItems.$inferInsert> = []
    for (const item of items) {
      // The worksite and every catalog product are already locked. Only the
      // actual selected-worksite balance remains to be locked per item.
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

/* ── Borradores ─────────────────────────────────────────────────────────── */

/**
 * Guarda un conteo sin cerrarlo. No mueve stock, asi que **no toma los locks de
 * faena y producto**: hacerlo abriria una ventana de deadlock contra las
 * recepciones por un guardado que no altera ningun saldo. Las existencias que
 * anota son informativas; el cierre las vuelve a leer bajo lock.
 *
 * El folio se asigna al crear el borrador y sobrevive hasta el cierre: la hoja
 * que se imprime para contar en terreno ya lo lleva impreso.
 */
export async function savePhysicalInventoryDraft(
  session: Session,
  input: SavePhysicalInventoryDraftInput,
  worksiteIds: string[] | "all",
): Promise<{ id: string; code: string; itemCount: number }> {
  if (!input.worksiteId) throw new Error("Faena requerida")
  assertCanAccessWorksite(input.worksiteId, worksiteIds)
  if (input.items.length === 0) throw new Error("Agrega al menos un producto al conteo")

  const seen = new Set<string>()
  for (const item of input.items) {
    if (!item.productId) throw new Error("Producto requerido")
    if (seen.has(item.productId)) throw new Error("El conteo no puede repetir productos")
    seen.add(item.productId)
    ensureQuantity(item.countedQuantity, "Stock contado")
  }

  const now = new Date().toISOString()

  return db.transaction(async (tx) => {
    // ponytail: dos guardados simultaneos de la misma faena podrian crear dos
    // borradores; el panel retoma el mas reciente. Indice unico parcial sobre
    // (worksite_id) WHERE status='draft' si llega a ocurrir de verdad.
    const [existing] = await tx
      .select({ id: physicalInventoryCounts.id, code: physicalInventoryCounts.code })
      .from(physicalInventoryCounts)
      .where(and(
        eq(physicalInventoryCounts.worksiteId, input.worksiteId),
        eq(physicalInventoryCounts.status, "draft"),
      ))
      .orderBy(desc(physicalInventoryCounts.createdAt))
      .for("update")
      .limit(1)

    let id = existing?.id ?? ""
    let code = existing?.code ?? ""

    if (!existing) {
      id = nanoid()
      code = await nextCodeTx(tx, "CON", new Date().getFullYear())
      await tx.insert(physicalInventoryCounts).values({
        id,
        code,
        worksiteId: input.worksiteId,
        status: "draft",
        countedBy: session.user.id,
        notes: input.notes?.trim() || null,
        createdAt: now,
        updatedAt: now,
      })
    } else {
      await tx.update(physicalInventoryCounts)
        .set({ notes: input.notes?.trim() || null, updatedAt: now })
        .where(eq(physicalInventoryCounts.id, id))
      await tx.delete(physicalInventoryCountItems).where(eq(physicalInventoryCountItems.countId, id))
    }

    const balances = await tx
      .select({ productId: worksiteStock.productId, quantity: worksiteStock.quantity })
      .from(worksiteStock)
      .where(eq(worksiteStock.worksiteId, input.worksiteId))
    const balanceByProduct = new Map(balances.map((row) => [row.productId, row.quantity]))

    await tx.insert(physicalInventoryCountItems).values(input.items.map((item) => {
      const expectedQuantity = balanceByProduct.get(item.productId) ?? 0
      return {
        id: nanoid(),
        countId: id,
        productId: item.productId,
        expectedQuantity,
        countedQuantity: item.countedQuantity,
        difference: item.countedQuantity - expectedQuantity,
        notes: item.notes?.trim() || null,
      }
    }))

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: existing ? "update" : "create",
      entityType: "physical_inventory_count",
      entityId: id,
      entityCode: code,
      newState: { worksiteId: input.worksiteId, status: "draft", itemCount: input.items.length },
    }, tx)

    return { id, code, itemCount: input.items.length }
  })
}

/** Borrador abierto de una faena, para retomarlo donde quedo. */
export async function getOpenPhysicalInventoryCount(
  worksiteId: string,
): Promise<OpenPhysicalInventoryCount | null> {
  const [count] = await db
    .select({ id: physicalInventoryCounts.id, code: physicalInventoryCounts.code })
    .from(physicalInventoryCounts)
    .where(and(
      eq(physicalInventoryCounts.worksiteId, worksiteId),
      eq(physicalInventoryCounts.status, "draft"),
    ))
    .orderBy(desc(physicalInventoryCounts.createdAt))
    .limit(1)
  if (!count) return null

  const items = await db
    .select({
      productId: physicalInventoryCountItems.productId,
      countedQuantity: physicalInventoryCountItems.countedQuantity,
    })
    .from(physicalInventoryCountItems)
    .where(eq(physicalInventoryCountItems.countId, count.id))

  return { id: count.id, code: count.code, items }
}
