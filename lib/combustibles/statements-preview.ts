import type { Session } from "next-auth"
import { and, asc, count, eq, isNull, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { fuelLoads, fuelMonthlyStatements, fuelSuppliers } from "@/db/schema"
import { assertFuelCostAccess } from "@/lib/operational-control/capabilities"
import { accountableFuelLoadsWhere } from "@/lib/combustibles/load-status"
import { calculateStatementTotals, statementPendingAmount } from "@/lib/combustibles/calculations"
import { todayInChile } from "@/lib/utils"

/**
 * Vista previa de un estado de cuenta mensual: lo que «Crear estado de cuenta»
 * va a guardar, antes de guardarlo. Es el paso de confirmación de la pantalla
 * (no hay un segundo diálogo), así que tiene que coincidir con la acción:
 * `createMonthlyStatementAction` usa el mismo predicado de cargas
 * (`statementCandidateLoadsWhere`) y los mismos totales
 * (`calculateStatementTotals`), y la prueba PGlite `fuel-statements-preview`
 * compara ambos de punta a punta.
 */

export interface StatementCandidateInput {
  /** "YYYY-MM". */
  month: string
  fuelSupplierId: string
}

export const STATEMENT_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export interface StatementPreview {
  month: string
  fuelSupplierId: string
  supplierName: string | null
  /** Cargas que entrarían: contabilizables (registradas y conciliadas) y todavía sin estado de cuenta. */
  loads: number
  /** Primera y última fecha de carga que entra; `null` si no hay ninguna. */
  firstLoadDate: string | null
  lastLoadDate: string | null
  equipmentCount: number
  totals: ReturnType<typeof calculateStatementTotals>
  /** Ya existe el estado de cuenta de ese mes y proveedor: la acción rechazaría uno nuevo. */
  existing: {
    id: string
    status: string
    totalAmount: number
    paidAmount: number
    pendingAmount: number
    dueDate: string | null
  } | null
  /** Cargas del mes y proveedor que no entran, y por qué. */
  excluded: { draft: number; cancelled: number; alreadyInStatement: number }
  /** El mes todavía no termina: las cargas que se registren después quedarán fuera. */
  monthInProgress: boolean
}

/**
 * Cargas que entrarían a un estado de cuenta nuevo. Predicado único de la vista
 * previa y de la acción: un estado de cuenta cobra consumo real, así que no
 * arrastra borradores ni anuladas, ni cargas que ya están en otro estado.
 */
export function statementCandidateLoadsWhere(input: StatementCandidateInput): SQL {
  return and(
    accountableFuelLoadsWhere(),
    eq(fuelLoads.month, input.month),
    eq(fuelLoads.fuelSupplierId, input.fuelSupplierId),
    isNull(fuelLoads.statementId),
  ) as SQL
}

/**
 * Exige el mismo contrato que crear el estado de cuenta: costos y alcance
 * global. Nunca cruza faenas con un rol acotado, porque ese rol ni siquiera
 * puede abrir la pantalla.
 */
export async function previewMonthlyStatement(session: Session, input: StatementCandidateInput): Promise<StatementPreview> {
  assertFuelCostAccess(session, { global: true })
  if (!STATEMENT_MONTH_RE.test(input.month)) throw new Error("Mes inválido")

  const [supplier, existing, candidates, otherLoads] = await Promise.all([
    db.query.fuelSuppliers.findFirst({ where: eq(fuelSuppliers.id, input.fuelSupplierId), columns: { name: true } }),
    db.query.fuelMonthlyStatements.findFirst({
      where: and(eq(fuelMonthlyStatements.month, input.month), eq(fuelMonthlyStatements.fuelSupplierId, input.fuelSupplierId)),
    }),
    db
      .select({
        loadDate: fuelLoads.loadDate,
        vehicleId: fuelLoads.vehicleId,
        liters: fuelLoads.liters,
        baseAmount: fuelLoads.baseAmount,
        iecTotal: fuelLoads.iecTotal,
        ivaAmount: fuelLoads.ivaAmount,
        totalAmount: fuelLoads.totalAmount,
      })
      .from(fuelLoads)
      .where(statementCandidateLoadsWhere(input))
      .orderBy(asc(fuelLoads.loadDate)),
    // Lo que queda fuera: todo lo del mes y proveedor que NO cumple el predicado.
    db
      .select({ status: fuelLoads.status, assigned: sql<boolean>`${fuelLoads.statementId} is not null`, total: count() })
      .from(fuelLoads)
      .where(and(
        eq(fuelLoads.month, input.month),
        eq(fuelLoads.fuelSupplierId, input.fuelSupplierId),
        sql`not (${statementCandidateLoadsWhere(input)})`,
      ))
      .groupBy(fuelLoads.status, sql`${fuelLoads.statementId} is not null`),
  ])

  const excluded = { draft: 0, cancelled: 0, alreadyInStatement: 0 }
  for (const row of otherLoads) {
    const n = Number(row.total)
    if (row.status === "draft") excluded.draft += n
    else if (row.status === "cancelled") excluded.cancelled += n
    else if (row.assigned) excluded.alreadyInStatement += n
  }

  return {
    month: input.month,
    fuelSupplierId: input.fuelSupplierId,
    supplierName: supplier?.name ?? null,
    loads: candidates.length,
    firstLoadDate: candidates[0]?.loadDate ?? null,
    lastLoadDate: candidates[candidates.length - 1]?.loadDate ?? null,
    equipmentCount: new Set(candidates.map((load) => load.vehicleId)).size,
    totals: calculateStatementTotals(candidates),
    existing: existing
      ? {
          id: existing.id,
          status: existing.status,
          totalAmount: existing.totalAmount,
          paidAmount: existing.paidAmount,
          pendingAmount: statementPendingAmount(existing),
          dueDate: existing.dueDate,
        }
      : null,
    excluded,
    monthInProgress: input.month >= todayInChile().slice(0, 7),
  }
}
