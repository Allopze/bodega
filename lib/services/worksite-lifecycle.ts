import { and, eq, gt, inArray, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  pdtpObligations,
  pdtpProgramWorksites,
  preventionCapaActions,
  workers,
  worksiteStock,
  worksites,
} from "@/db/schema"
import { ensurePreventionProgramSlotsForWorksiteTx } from "@/lib/services/prevention-program-slots"
import { recordAudit } from "@/lib/audit"
import type { WorksiteScope } from "@/lib/auth/scope"
import { transitionCapaActionWithClient } from "@/lib/services/prevention-capa"
import { resolveOfficeWorksite } from "@/lib/services/dispatch-guides"
import { applyMovementTx } from "@/lib/services/stock-movement"

const OPEN_CAPA_STATUSES = ["pending", "in_progress", "pending_verification", "reopened"] as const
const OPEN_OBLIGATION_STATUSES = ["pending", "overdue"] as const

/** Referencia de kardex de los traslados que genera el cierre de una faena. */
const CLOSURE_REFERENCE_TYPE = "worksite_closure"

interface SetWorksiteActiveInput {
  worksiteId: string
  activate: boolean
  reason?: string
  actorUserId: string
  actorEmail?: string
  scope: WorksiteScope
  /**
   * Devolver el saldo de bodega a Oficina como parte del cierre. Exige
   * `warehouse:adjust_stock` en el caller: mueve inventario real.
   */
  returnStockToOffice?: boolean
}

export interface WorksiteLifecycleResult {
  programsDropped: number
  capaCancelled: number
  obligationsCancelled: number
  stockReturned?: { products: number; units: number; officeName: string }
}

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

/**
 * Cerrar una faena con saldo lo deja atrapado: desaparece de Bodega (la vista
 * filtra faenas activas) y `applyMovementTx` rechaza todo movimiento sobre
 * faena inactiva, así que ni siquiera se puede ajustar a cero. Vaciarla es
 * requisito del cierre, no una recomendación.
 *
 * Las filas en cero son historial de un producto que estuvo ahí, no
 * existencias: no bloquean.
 */
async function assertWorksiteHasNoStock(tx: Tx, worksiteId: string, worksiteName: string) {
  const [balance] = await tx.select({
    products: sql<number>`count(*)::int`,
    units: sql<number>`coalesce(sum(${worksiteStock.quantity}), 0)::float`,
  }).from(worksiteStock).where(and(
    eq(worksiteStock.worksiteId, worksiteId),
    gt(worksiteStock.quantity, 0),
  ))

  if (!balance || balance.products === 0) return

  const units = Math.round(balance.units * 100) / 100
  throw new Error(
    `No se puede cerrar la faena "${worksiteName}": quedan ${balance.products} ` +
    `${balance.products === 1 ? "producto" : "productos"} con existencias (${units} en total). ` +
    "Marca \"Devolver el saldo a Oficina\" al cerrarla, o vacíala antes en Bodega: " +
    "una faena inactiva no admite movimientos de stock.",
  )
}

/**
 * Cerrar una faena con dotación deja a esos trabajadores inalcanzables sin
 * desactivarlos: siguen `is_active`, pero su `worksite_id` apunta a una faena
 * que ya no aparece en ningún selector de faena, así que no se les puede
 * entregar EPP —`registerWorkerStockDelivery` exige que la faena del trabajador
 * sea la de la bodega—, ni asignarlos, ni verlos en los padrones por faena.
 *
 * Es el mismo criterio que `assertWorksiteHasNoStock`: vaciar la faena es
 * requisito del cierre. Aquí no se puede ofrecer un equivalente a "devolver a
 * Oficina" porque a qué faena se traslada cada persona es una decisión de
 * negocio, no un default: se exige reasignarlos o darlos de baja antes.
 */
async function assertWorksiteHasNoActiveWorkers(tx: Tx, worksiteId: string, worksiteName: string) {
  const [dotacion] = await tx.select({ total: sql<number>`count(*)::int` })
    .from(workers)
    .where(and(eq(workers.worksiteId, worksiteId), eq(workers.isActive, true)))

  if (!dotacion || dotacion.total === 0) return

  throw new Error(
    `No se puede cerrar la faena "${worksiteName}": quedan ${dotacion.total} ` +
    `${dotacion.total === 1 ? "trabajador activo" : "trabajadores activos"} en su dotación. ` +
    "Reasígnalos a otra faena o dalos de baja en Trabajadores antes de cerrarla: " +
    "un trabajador en faena inactiva no puede recibir entregas ni aparecer en los padrones por faena.",
  )
}

/**
 * Devuelve todo el saldo de la faena a la bodega de Oficina, en las dos patas
 * de kardex que ya usa la guía de despacho interna: sale de la faena y entra en
 * Oficina. Vaciar con entregas ficticias o desechos también destraba el cierre,
 * pero deja escrito en el kardex algo que no ocurrió.
 *
 * Va en la misma transacción que el cierre: si la faena no llega a cerrarse, el
 * material no se movió.
 */
async function returnStockToOfficeTx(
  tx: Tx,
  worksite: { id: string; name: string },
  actor: { userId: string; userEmail?: string },
): Promise<WorksiteLifecycleResult["stockReturned"]> {
  const office = await resolveOfficeWorksite(tx)
  if (office.id === worksite.id) {
    throw new Error("La bodega de Oficina no puede devolverse el saldo a sí misma.")
  }

  // FOR UPDATE al leer: sin el lock, una recepción concurrente cambia la
  // cantidad entre esta lectura y el movimiento, y el traslado se emite por un
  // saldo que ya no existe.
  const rows = await tx
    .select({ productId: worksiteStock.productId, quantity: worksiteStock.quantity })
    .from(worksiteStock)
    .where(and(eq(worksiteStock.worksiteId, worksite.id), gt(worksiteStock.quantity, 0)))
    .for("update")

  if (rows.length === 0) return undefined

  for (const row of rows) {
    await applyMovementTx(tx, {
      worksiteId:    worksite.id,
      productId:     row.productId,
      type:          "egreso_traslado",
      quantity:      -row.quantity,
      referenceType: CLOSURE_REFERENCE_TYPE,
      referenceId:   worksite.id,
      performedBy:   actor.userId,
      userEmail:     actor.userEmail,
      reason:        `Cierre de faena ${worksite.name} · devolución a ${office.name}`,
    })
    await applyMovementTx(tx, {
      worksiteId:    office.id,
      productId:     row.productId,
      type:          "ingreso_traslado",
      quantity:      row.quantity,
      referenceType: CLOSURE_REFERENCE_TYPE,
      referenceId:   worksite.id,
      performedBy:   actor.userId,
      userEmail:     actor.userEmail,
      reason:        `Cierre de faena ${worksite.name} · ingreso desde la faena`,
    })
  }

  const units = rows.reduce((total, row) => total + row.quantity, 0)
  return { products: rows.length, units: Math.round(units * 100) / 100, officeName: office.name }
}

/**
 * Cambia el estado operativo de una faena junto con todos sus cierres
 * dependientes. Ningún paso queda confirmado si falla una transición CAPA,
 * una obligación, el audit log o el cambio final de la faena.
 */
export async function setWorksiteActive(input: SetWorksiteActiveInput): Promise<WorksiteLifecycleResult> {
  const reason = input.reason?.trim() ?? ""
  if (!input.activate && reason.length < 10) {
    throw new Error("Indica el motivo del cierre de faena (mínimo 10 caracteres).")
  }

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(worksites)
      .where(eq(worksites.id, input.worksiteId))
      .for("update")
      .limit(1)
    if (!current || !scopeAllows(input.scope, current.id)) {
      throw new Error("Faena no encontrada o fuera de alcance.")
    }
    if (current.isActive === input.activate) {
      return { programsDropped: 0, capaCancelled: 0, obligationsCancelled: 0 }
    }

    // Antes de cancelar nada: si el cierre se va a rechazar, que no haya CAPA ni
    // obligaciones que deshacer. La devolución va primero, porque su propósito
    // es justamente dejar la faena en cero.
    let stockReturned: WorksiteLifecycleResult["stockReturned"]
    if (!input.activate) {
      if (input.returnStockToOffice) {
        stockReturned = await returnStockToOfficeTx(tx, current, {
          userId: input.actorUserId,
          userEmail: input.actorEmail,
        })
      }
      await assertWorksiteHasNoStock(tx, current.id, current.name)
      await assertWorksiteHasNoActiveWorkers(tx, current.id, current.name)
    }

    const closureReason = `Cierre de faena: ${reason}`
    const programsDropped = input.activate
      ? []
      : await tx.update(pdtpProgramWorksites)
          .set({ isActive: false })
          .where(and(
            eq(pdtpProgramWorksites.worksiteId, current.id),
            eq(pdtpProgramWorksites.isActive, true),
          ))
          .returning({ programId: pdtpProgramWorksites.programId })

    const capaCancelled: string[] = []
    let obligationsCancelled = 0
    if (!input.activate) {
      const openActions = await tx.select().from(preventionCapaActions).where(and(
        eq(preventionCapaActions.worksiteId, current.id),
        inArray(preventionCapaActions.status, [...OPEN_CAPA_STATUSES]),
      ))
      for (const action of openActions) {
        await transitionCapaActionWithClient(tx, {
          actionId: action.id,
          expectedVersion: action.version,
          toStatus: "cancelled",
          reason: closureReason,
        }, {
          ctx: { userId: input.actorUserId },
          scope: input.scope,
          permissions: ["prevention:capa:manage"],
        })
        capaCancelled.push(action.code)
      }

      const cancelled = await tx.update(pdtpObligations).set({
        status: "cancelled",
        cancelledByUserId: input.actorUserId,
        cancelledAt: new Date().toISOString(),
        cancellationReason: closureReason,
        updatedAt: new Date().toISOString(),
      }).where(and(
        eq(pdtpObligations.worksiteId, current.id),
        inArray(pdtpObligations.status, [...OPEN_OBLIGATION_STATUSES]),
      )).returning({ id: pdtpObligations.id })
      obligationsCancelled = cancelled.length
    }

    await tx.update(worksites).set({
      isActive: input.activate,
      updatedAt: new Date().toISOString(),
    }).where(eq(worksites.id, current.id))

    if (input.activate) {
      /* Las casillas del programa —capacitación, simulacros y actas del CGRD—
       * nacen con la faena y dentro de la misma transacción. Una faena activa
       * sin casillas no tiene cómo mostrar que algo no se hizo. */
      await ensurePreventionProgramSlotsForWorksiteTx(tx, current.id)
    }

    await recordAudit({
      userId: input.actorUserId,
      userEmail: input.actorEmail,
      action: "update",
      entityType: "worksite",
      entityId: current.id,
      entityCode: current.code,
      oldState: { isActive: current.isActive },
      newState: {
        isActive: input.activate,
        ...(input.activate ? {} : { closureReason: reason }),
        ...(programsDropped.length > 0
          ? { pdtpProgramsDropped: programsDropped.map((row) => row.programId) }
          : {}),
        ...(capaCancelled.length > 0 ? { capaCancelled } : {}),
        ...(obligationsCancelled > 0 ? { pdtpObligationsCancelled: obligationsCancelled } : {}),
        ...(stockReturned ? { stockReturnedToOffice: stockReturned } : {}),
      },
    }, tx)

    return {
      programsDropped: programsDropped.length,
      capaCancelled: capaCancelled.length,
      obligationsCancelled,
      stockReturned,
    }
  })
}
