import { and, asc, eq, inArray, ne, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { mantPartsAllocationSources, mantPartsAllocations, mantPartsNoteItems, mantPartsNotes } from "@/db/schema"
import { logger } from "@/lib/logger"
import { roundQty, toCents } from "@/lib/services/stock-reservations"
import { lockForStockTx } from "../parts/allocations"
import { returnReleasedLinesTx, type ReleasePlan, type ReturnedNoteLine } from "./line-release"

/**
 * Segundo paso de un ajuste de inventario que rebajó una reserva (ADR 0001 D21): devolver a pendiente las líneas de nota de
 * pedido «desde stock» que ya no tienen todo lo que pidieron reservado, y recalcular sus notas.
 *
 * Por qué es otro paso y no parte del ajuste: el ajuste ya tomó la fila de stock cuando descubre qué reservas rebajar, y las
 * líneas y la OT van ANTES en el orden global de bloqueo (equipo → OT → faena → stock → líneas → NP). Tomarlas después, en
 * la transacción del ajuste, deja abierto un cruce con quien cierra la OT (que tiene la OT y espera las reservas que el
 * ajuste ya modificó). Aquí, ya confirmado el ajuste, se toman en orden desde el principio y no hay con qué trabarse.
 *
 * Qué hace falta saber del ajuste: casi nada. Cada rebaja ya quedó escrita con la línea a la que se atribuyó
 * (`planAdjustmentCutTx`: su fila de origen lleva el `note_item_id`), y eso es lo que el resto lee como «lo que la reserva
 * retiene» de cada línea. Una línea «desde stock» debe retener al menos lo que pidió; la que retiene menos cedió lo que le
 * falta: lo retenido se queda resuelto y el saldo pasa a una línea pendiente nueva (o la línea entera vuelve a pendiente, o
 * se rechaza sola si su OT ya terminó), igual que al liberar a mano (D16 y D17). Como la condición sale de lo escrito y no
 * de un aviso en memoria, repetirlo no cambia nada: con la línea ya partida o devuelta, retiene lo que pide.
 */

export interface ReconcileLinesInput {
  worksiteId: string
  productIds: readonly string[]
  actor: { userId: string; email?: string | null }
  /** Qué ajuste fue (folio y motivo), para el rastro de cada línea. */
  reason: string
}

/**
 * Devuelve a pendiente (o parte, o rechaza) las líneas «desde stock» de esos repuestos en esa faena que retienen menos de lo
 * que piden. Corre en una transacción PROPIA del servicio: la toma en orden —OT → faena → fila de stock (`lockForStockTx`),
 * después las líneas `FOR NO KEY UPDATE` por id y al final la fila de cada NP— y no debe llamarse desde la transacción del
 * ajuste. Sin líneas por corregir no escribe nada.
 */
export async function reconcileDesdeStockLinesTx(tx: Tx, input: ReconcileLinesInput): Promise<ReturnedNoteLine[]> {
  const productIds = [...new Set(input.productIds)]
  if (productIds.length === 0) return []

  // Sin bloqueo: las líneas «desde stock» con aportes en las reservas de esos repuestos en esa faena, la OT de cada una y el
  // repuesto de la reserva (un conteo grande no debe tomar la fila de stock de cada producto que contó: sólo las que importan).
  const candidates = await tx
    .selectDistinct({ itemId: mantPartsNoteItems.id, workOrderId: mantPartsNotes.workOrderId, productId: mantPartsAllocations.productId })
    .from(mantPartsAllocationSources)
    .innerJoin(mantPartsAllocations, eq(mantPartsAllocations.id, mantPartsAllocationSources.allocationId))
    .innerJoin(mantPartsNoteItems, eq(mantPartsNoteItems.id, mantPartsAllocationSources.noteItemId))
    .innerJoin(mantPartsNotes, eq(mantPartsNotes.id, mantPartsNoteItems.noteId))
    .where(and(
      eq(mantPartsAllocations.worksiteId, input.worksiteId),
      inArray(mantPartsAllocations.productId, productIds),
      eq(mantPartsNoteItems.resolution, "desde_stock"),
      ne(mantPartsNotes.status, "anulada"),
    ))
  if (candidates.length === 0) return []

  // El orden global: OT (FOR SHARE, por id) → faena → filas de stock. Con eso, ninguna operación sobre estas reservas corre a la vez.
  await lockForStockTx(tx, {
    workOrderIds: candidates.map((row) => row.workOrderId),
    worksiteId: input.worksiteId,
    productIds: [...new Set(candidates.map((row) => row.productId))],
  })

  // Las líneas, por id y después del stock; se vuelve a mirar su resolución ya con ellas tomadas.
  const locked = await tx
    .select({
      itemId: mantPartsNoteItems.id,
      noteId: mantPartsNoteItems.noteId,
      code: mantPartsNotes.code,
      noteWorksiteId: mantPartsNotes.worksiteId,
      workOrderId: mantPartsNotes.workOrderId,
      description: mantPartsNoteItems.description,
      quantity: mantPartsNoteItems.quantity,
      productId: mantPartsNoteItems.productId,
    })
    .from(mantPartsNoteItems)
    .innerJoin(mantPartsNotes, eq(mantPartsNotes.id, mantPartsNoteItems.noteId))
    .where(and(
      inArray(mantPartsNoteItems.id, [...new Set(candidates.map((row) => row.itemId))]),
      eq(mantPartsNoteItems.resolution, "desde_stock"),
      ne(mantPartsNotes.status, "anulada"),
    ))
    .orderBy(asc(mantPartsNoteItems.id))
    .for("no key update", { of: mantPartsNoteItems })
  if (locked.length === 0) return []

  // Lo que cada línea retiene hoy: la suma de sus orígenes (aportes menos rebajas atribuidas a ella).
  const retained = await tx
    .select({ itemId: mantPartsAllocationSources.noteItemId, held: sql<number>`sum(${mantPartsAllocationSources.quantity})`.mapWith(Number) })
    .from(mantPartsAllocationSources)
    .where(inArray(mantPartsAllocationSources.noteItemId, locked.map((row) => row.itemId)))
    .groupBy(mantPartsAllocationSources.noteItemId)
  const heldOf = new Map(retained.flatMap((row) => (row.itemId ? [[row.itemId, roundQty(row.held)] as const] : [])))

  // Una línea por corregir cedió `quantity − retenido`. `held: quantity` hace que el resto del cálculo (cuánto conserva, si
  // vuelve entera) sea el de siempre: conserva lo que retiene, y si no retiene nada vuelve entera.
  const byOrder = new Map<string, ReleasePlan["lines"]>()
  for (const row of locked) {
    const quantity = roundQty(Number(row.quantity))
    const held = Math.max(0, heldOf.get(row.itemId) ?? 0)
    if (toCents(held) >= toCents(quantity)) continue
    const share = roundQty(quantity - held)
    const entry = {
      line: {
        itemId: row.itemId, noteId: row.noteId, code: row.code, noteWorksiteId: row.noteWorksiteId, workOrderId: row.workOrderId,
        description: row.description, quantity, productId: row.productId,
      },
      held: quantity,
      share,
    }
    byOrder.set(row.workOrderId, [...(byOrder.get(row.workOrderId) ?? []), entry])
  }

  const returned: ReturnedNoteLine[] = []
  for (const workOrderId of [...byOrder.keys()].sort()) {
    returned.push(...await returnReleasedLinesTx(tx, {
      plan: { lines: byOrder.get(workOrderId)!, sourceRows: [] },
      allocationId: null,
      reason: input.reason,
      actor: input.actor,
      cause: "ajuste",
    }))
  }
  return returned
}

/**
 * Lo que llaman, después del commit, los caminos que pueden bajar el stock de un repuesto con un ajuste (el documento de
 * ajuste, el ajuste desde Bodega y el cierre de un conteo físico): corre `reconcileDesdeStockLinesTx` en su propia
 * transacción.
 *
 * El ajuste ya está confirmado y es lo que el usuario pidió: si este paso falla no se le dice que el ajuste falló (lo
 * reintentaría y se duplicaría). Se deja en el registro de errores y las líneas se corrigen con la próxima operación sobre
 * ese repuesto en esa faena (cualquier ajuste que lo rebaje, o llamarlo de nuevo): lo que decide qué corregir es lo escrito,
 * no este aviso. Devuelve las líneas que volvieron, para quien quiera decirlo en pantalla.
 */
export async function reconcileNotesAfterStockAdjustment(input: ReconcileLinesInput): Promise<ReturnedNoteLine[]> {
  try {
    return await db.transaction((tx) => reconcileDesdeStockLinesTx(tx, input))
  } catch (error) {
    logger.error("[stock] el ajuste quedó registrado, pero no se pudieron actualizar las notas de pedido que dependían de la reserva", error)
    return []
  }
}
