/**
 * Stock service — applyMovement is the ONLY place stock is mutated.
 * Every ingress and egress goes through this function atomically.
 */

import { eq, and, sql, inArray } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { worksites, worksiteStock, inventoryMovements, products, users } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import { buildXlsxBuffer, type ReportData } from "@/lib/reports/export"
import type { Session } from "next-auth"

/* ── Movement types ─────────────────────────────────────────────────────────── */
export type MovementType =
  | "ingreso_oc"           // + : received from purchase order
  | "egreso_entrega"       // - : delivered to worker
  | "ingreso_devolucion"   // + : returned from worker/faena
  | "egreso_desecho"       // 0 : discarded/retired EPP (record only, no stock change)
  | "ajuste"               // +/-: manual inventory adjustment with mandatory reason

/* ── Apply movement ─────────────────────────────────────────────────────────── */

export interface ApplyMovementInput {
  worksiteId:    string
  productId:     string
  type:          MovementType
  quantity:      number          // positive = in, negative = out
  referenceType?: string          // 'purchase_order' | 'delivery'
  referenceId?:   string
  performedBy:    string
  userEmail?:     string
  reason?:        string
  notes?:         string
}

/**
 * Atomically apply an inventory movement at worksite level.
 *
 * - Validates the worksite exists and is active.
 * - Blocks outbound movements that would drive stock negative.
 * - Upserts worksiteStock.
 * - Writes an inventoryMovements record.
 * - Calls recordAudit.
 *
 * Returns the new stock level after the movement.
 */
export async function applyMovement(input: ApplyMovementInput): Promise<number> {
  return await db.transaction(async (tx) => {
    return await applyMovementTx(tx, input)
  })
}

export async function applyMovementTx(tx: Tx, input: ApplyMovementInput): Promise<number> {
  const ws = await tx.query.worksites.findFirst({
    where: eq(worksites.id, input.worksiteId),
  })
  if (!ws) {
    throw new Error(`Worksite ${input.worksiteId} not found`)
  }
  if (!ws.isActive) {
    throw new Error(`Worksite '${ws.name}' is not active`)
  }

  const now = new Date().toISOString()

  // ajuste requires a reason; quantity may be positive (ingreso) or negative (egreso)
  if (input.type === "ajuste") {
    if (!input.reason?.trim()) {
      throw new Error("El ajuste de inventario requiere un motivo")
    }
    if (input.quantity === 0) {
      throw new Error("La cantidad de ajuste no puede ser cero")
    }
  }

  // egreso_desecho is record-only — no stock delta, just trail the retirement
  if (input.type === "egreso_desecho") {
    // S-17: record-only movements must carry a positive count. The DB CHECK
    // only guards stock_before/after >= 0, not the movement quantity itself,
    // so a negative quantity would silently land in the kardex.
    if (!(input.quantity > 0)) {
      throw new Error("La cantidad de un movimiento de desecho debe ser mayor que cero")
    }
    const existing = await tx.query.worksiteStock.findFirst({
      where: and(
        eq(worksiteStock.worksiteId, input.worksiteId),
        eq(worksiteStock.productId, input.productId),
      ),
    })
    const currentQty = existing?.quantity ?? 0

    await tx.insert(inventoryMovements).values({
      id: nanoid(),
      worksiteId: input.worksiteId,
      productId: input.productId,
      type: input.type,
      quantity: input.quantity,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      stockBefore: currentQty,
      stockAfter: currentQty,
      performedBy: input.performedBy,
      reason: input.reason ?? null,
      notes: input.notes ?? null,
    })

    await recordAudit({
      userId: input.performedBy,
      userEmail: input.userEmail,
      action: "create",
      entityType: "inventory_movement",
      entityId: input.worksiteId,
      newState: {
        type: input.type,
        productId: input.productId,
        quantity: input.quantity,
        stockBefore: currentQty,
        stockAfter: currentQty,
      },
    }, tx)

    return currentQty
  }

  const { currentQty, newQty } = await applyStockDelta(tx, input, now)

  await tx.insert(inventoryMovements).values({
    id: nanoid(),
    worksiteId: input.worksiteId,
    productId: input.productId,
    type: input.type,
    quantity: input.quantity,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    stockBefore: currentQty,
    stockAfter: newQty,
    performedBy: input.performedBy,
    reason: input.reason ?? null,
    notes: input.notes ?? null,
  })

  await recordAudit({
    userId: input.performedBy,
    userEmail: input.userEmail,
    action: "create",
    entityType: "inventory_movement",
    entityId: input.worksiteId,
    newState: {
      type: input.type,
      productId: input.productId,
      quantity: input.quantity,
      stockBefore: currentQty,
      stockAfter: newQty,
    },
  }, tx)

  return newQty
}

async function applyStockDelta(tx: Tx, input: ApplyMovementInput, now: string) {
  if (input.quantity >= 0) {
    const [row] = await tx
      .insert(worksiteStock)
      .values({
        id: nanoid(),
        worksiteId: input.worksiteId,
        productId: input.productId,
        quantity: input.quantity,
        minStock: 0,
        lastMovementAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [worksiteStock.worksiteId, worksiteStock.productId],
        set: {
          quantity: sql`${worksiteStock.quantity} + ${input.quantity}`,
          lastMovementAt: now,
          updatedAt: now,
        },
      })
      .returning({
        stockBefore: sql<number>`${worksiteStock.quantity} - ${input.quantity}`,
        stockAfter: worksiteStock.quantity,
      })

    // The upsert always returns exactly one row.
    if (!row) throw new Error("No se pudo aplicar el movimiento de stock")
    return {
      currentQty: Number(row.stockBefore),
      newQty: Number(row.stockAfter),
    }
  }

  const [row] = await tx
    .update(worksiteStock)
    .set({
      quantity: sql`${worksiteStock.quantity} + ${input.quantity}`,
      lastMovementAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(worksiteStock.worksiteId, input.worksiteId),
        eq(worksiteStock.productId, input.productId),
        sql`${worksiteStock.quantity} + ${input.quantity} >= 0`,
      ),
    )
    .returning({
      stockBefore: sql<number>`${worksiteStock.quantity} - ${input.quantity}`,
      stockAfter: worksiteStock.quantity,
    })

  if (row) {
    return {
      currentQty: Number(row.stockBefore),
      newQty: Number(row.stockAfter),
    }
  }

  const existing = await tx.query.worksiteStock.findFirst({
    where: and(
      eq(worksiteStock.worksiteId, input.worksiteId),
      eq(worksiteStock.productId, input.productId),
    ),
  })
  const currentQty = existing?.quantity ?? 0
  throw new Error(
    `Stock insuficiente: disponible ${currentQty}, solicitado ${Math.abs(input.quantity)}`,
  )
}

/* ── Stock Export ──────────────────────────────────────────────────────────── */

export interface StockExportFilters {
  worksiteId?: string
}

/**
 * Build an XLSX buffer with the current stock for the given session's scope.
 * Respects RBAC worksite visibility.
 */
export async function getStockExport(
  session: Session | null,
  filters: StockExportFilters = {},
  maxRows = 10_000,
): Promise<{ buffer: ArrayBuffer; filename: string; truncated: boolean }> {
  const wsScope = isGlobalRole(session)
    ? undefined
    : (() => {
        const ids = visibleWorksiteIds(session)
        return ids.length > 0 ? inArray(worksiteStock.worksiteId, ids) : sql<boolean>`false`
      })()

  const wsFilter = filters.worksiteId
    ? eq(worksiteStock.worksiteId, filters.worksiteId)
    : undefined

  const rows = await db
    .select({
      id:             worksiteStock.id,
      worksiteId:     worksiteStock.worksiteId,
      worksiteName:   worksites.name,
      productId:      worksiteStock.productId,
      productName:    products.name,
      productSku:     products.sku,
      unitOfMeasure:  products.unitOfMeasure,
      quantity:       worksiteStock.quantity,
      minStock:       worksiteStock.minStock,
      lastMovementAt: worksiteStock.lastMovementAt,
    })
    .from(worksiteStock)
    .innerJoin(worksites, eq(worksiteStock.worksiteId, worksites.id))
    .innerJoin(products, eq(worksiteStock.productId, products.id))
    .where(and(wsScope, wsFilter))
    .orderBy(worksites.name, products.name)
    .limit(maxRows + 1)

  const truncated = rows.length > maxRows
  const limited = truncated ? rows.slice(0, maxRows) : rows

  const report: ReportData = {
    filenameBase: "stock-por-faena",
    worksheetName: "Stock",
    headers: [
      "Faena",
      "Producto",
      "SKU",
      "U/M",
      "Cantidad",
      "Stock mínimo",
      "Último movimiento",
    ],
    rows: limited.map((r) => [
      r.worksiteName,
      r.productName,
      r.productSku ?? "",
      r.unitOfMeasure,
      r.quantity,
      r.minStock,
      r.lastMovementAt ?? "",
    ]),
    rowLimitApplied: truncated,
  }

  const buffer = await buildXlsxBuffer(report)
  const now = new Date().toISOString().slice(0, 10)
  const filename = `${report.filenameBase}-${now}.xlsx`

  return { buffer, filename, truncated }
}

/* ── Kardex Export ────────────────────────────────────────────────────────── */

export interface KardexExportFilters {
  worksiteId?: string
  productId?:  string
}

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  ingreso_oc:         "Ingreso OC",
  egreso_entrega:     "Entrega",
  ingreso_devolucion: "Devolución",
  egreso_desecho:     "Retiro",
  ajuste:             "Ajuste",
}

/**
 * Build an XLSX buffer with the inventory movement history (kardex)
 * for the given session's scope. Respects RBAC worksite visibility.
 */
export async function getKardexExport(
  session: Session | null,
  filters: KardexExportFilters = {},
  maxRows = 10_000,
): Promise<{ buffer: ArrayBuffer; filename: string; truncated: boolean }> {
  const wsScope = isGlobalRole(session)
    ? undefined
    : (() => {
        const ids = visibleWorksiteIds(session)
        return ids.length > 0 ? inArray(inventoryMovements.worksiteId, ids) : sql<boolean>`false`
      })()

  const wsFilter = filters.worksiteId
    ? eq(inventoryMovements.worksiteId, filters.worksiteId)
    : undefined

  const prodFilter = filters.productId
    ? eq(inventoryMovements.productId, filters.productId)
    : undefined

  const rows = await db
    .select({
      id:             inventoryMovements.id,
      worksiteId:     inventoryMovements.worksiteId,
      worksiteName:   worksites.name,
      productId:      inventoryMovements.productId,
      productName:    products.name,
      productSku:     products.sku,
      type:           inventoryMovements.type,
      quantity:       inventoryMovements.quantity,
      stockBefore:    inventoryMovements.stockBefore,
      stockAfter:     inventoryMovements.stockAfter,
      performedAt:    inventoryMovements.performedAt,
      performedByName: users.name,
      reason:         inventoryMovements.reason,
      notes:          inventoryMovements.notes,
    })
    .from(inventoryMovements)
    .innerJoin(worksites, eq(inventoryMovements.worksiteId, worksites.id))
    .innerJoin(products, eq(inventoryMovements.productId, products.id))
    .innerJoin(users, eq(inventoryMovements.performedBy, users.id))
    .where(and(wsScope, wsFilter, prodFilter))
    .orderBy(sql`${inventoryMovements.performedAt} DESC`)
    .limit(maxRows + 1)

  const truncated = rows.length > maxRows
  const limited = truncated ? rows.slice(0, maxRows) : rows

  const report: ReportData = {
    filenameBase: "kardex-movimientos",
    worksheetName: "Kardex",
    headers: [
      "Fecha",
      "Faena",
      "Producto",
      "SKU",
      "Tipo de movimiento",
      "Cantidad",
      "Stock anterior",
      "Stock posterior",
      "Responsable",
      "Motivo",
      "Observaciones",
    ],
    rows: limited.map((r) => [
      r.performedAt ?? "",
      r.worksiteName,
      r.productName,
      r.productSku ?? "",
      MOVEMENT_TYPE_LABELS[r.type] ?? r.type,
      r.quantity,
      r.stockBefore,
      r.stockAfter,
      r.performedByName,
      r.reason ?? "",
      r.notes ?? "",
    ]),
    rowLimitApplied: truncated,
  }

  const buffer = await buildXlsxBuffer(report)
  const now = new Date().toISOString().slice(0, 10)
  const filename = `${report.filenameBase}-${now}.xlsx`

  return { buffer, filename, truncated }
}
