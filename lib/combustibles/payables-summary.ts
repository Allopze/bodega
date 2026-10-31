import "server-only"
import type { Session } from "next-auth"
import { and, asc, count, eq, inArray, isNull, lte, notExists, notInArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelLoads, fuelMonthlyStatements, fuelSuppliers } from "@/db/schema"
import { assertFuelCostAccess } from "@/lib/operational-control/capabilities"
import { accountableFuelLoadsWhere } from "@/lib/combustibles/load-status"
import { statementPendingAmount } from "@/lib/combustibles/calculations"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { todayInChile } from "@/lib/utils"

/**
 * Lo que falta pagar (Panel, paso 5, y Pagos › Estados de cuenta). Exige el
 * contrato monetario global (`assertFuelCostAccess({ global: true })`).
 *
 * Una deuda no es un flujo: lo que se debe se debe aunque el período elegido ya
 * haya pasado. Por eso `dueStatements`, `pendingAmount` y `overdueAmount` miran
 * todos los estados de cuenta con saldo **de los meses hasta el fin del
 * período** (el saldo es el de hoy), no sólo los del período. En cambio
 * `monthsWithoutStatement` sí es del período: los meses que el período toca y
 * que todavía no tienen estado de cuenta.
 */
export interface PayablesSummary {
  pendingAmount: number
  overdueAmount: number
  /** Estados de cuenta con saldo, ordenados por vencimiento. */
  dueStatements: { statementId: string; supplierName: string; month: string; pendingAmount: number; dueDate: string | null; overdue: boolean }[]
  /**
   * Meses del período con cargas facturadas que todavía no tienen estado de
   * cuenta. `monthClosed` dice si el mes ya terminó: crear el estado de cuenta
   * antes deja fuera las cargas que se registren después.
   */
  monthsWithoutStatement: { supplierId: string; supplierName: string; month: string; loads: number; totalAmount: number; monthClosed?: boolean }[]
}

/** Estados de cuenta que todavía deben algo: ni pagados ni anulados, y con saldo. */
export function statementWithBalanceSql() {
  return and(
    notInArray(fuelMonthlyStatements.status, ["paid", "cancelled"]),
    sql`${fuelMonthlyStatements.totalAmount} - ${fuelMonthlyStatements.paidAmount} > 0`,
  )
}

export async function getPayablesSummary(session: Session, period: ResolvedFuelPeriod): Promise<PayablesSummary> {
  assertFuelCostAccess(session, { global: true })

  const today = todayInChile()
  const currentMonth = today.slice(0, 7)
  const lastMonth = period.monthKeys[period.monthKeys.length - 1] ?? currentMonth

  const [withBalance, unassigned] = await Promise.all([
    db
      .select({
        statementId: fuelMonthlyStatements.id,
        supplierName: fuelSuppliers.name,
        month: fuelMonthlyStatements.month,
        totalAmount: fuelMonthlyStatements.totalAmount,
        paidAmount: fuelMonthlyStatements.paidAmount,
        dueDate: fuelMonthlyStatements.dueDate,
      })
      .from(fuelMonthlyStatements)
      .innerJoin(fuelSuppliers, eq(fuelSuppliers.id, fuelMonthlyStatements.fuelSupplierId))
      .where(and(statementWithBalanceSql(), lte(fuelMonthlyStatements.month, lastMonth)))
      // Sin fecha de vencimiento al final: lo que vence primero es lo urgente.
      .orderBy(sql`${fuelMonthlyStatements.dueDate} asc nulls last`, asc(fuelMonthlyStatements.month), asc(fuelSuppliers.name)),
    db
      .select({
        supplierId: fuelLoads.fuelSupplierId,
        supplierName: fuelSuppliers.name,
        month: fuelLoads.month,
        loads: count(),
        totalAmount: sql<string>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
      })
      .from(fuelLoads)
      .innerJoin(fuelSuppliers, eq(fuelSuppliers.id, fuelLoads.fuelSupplierId))
      .where(and(
        accountableFuelLoadsWhere(),
        isNull(fuelLoads.statementId),
        inArray(fuelLoads.month, period.monthKeys),
        // Si el mes ya tiene su estado de cuenta (de cualquier estado: la acción
        // que crea uno nuevo también lo rechaza), lo que quede suelto son cargas
        // tardías y no «un mes sin estado de cuenta».
        notExists(
          db.select({ one: sql`1` }).from(fuelMonthlyStatements).where(and(
            eq(fuelMonthlyStatements.month, fuelLoads.month),
            eq(fuelMonthlyStatements.fuelSupplierId, fuelLoads.fuelSupplierId),
          )),
        ),
      ))
      .groupBy(fuelLoads.fuelSupplierId, fuelSuppliers.name, fuelLoads.month)
      .orderBy(asc(fuelLoads.month), asc(fuelSuppliers.name)),
  ])

  const dueStatements = withBalance.map((row) => ({
    statementId: row.statementId,
    supplierName: row.supplierName,
    month: row.month,
    pendingAmount: statementPendingAmount(row),
    dueDate: row.dueDate,
    overdue: row.dueDate !== null && row.dueDate < today,
  }))

  return {
    pendingAmount: dueStatements.reduce((sum, row) => sum + row.pendingAmount, 0),
    overdueAmount: dueStatements.filter((row) => row.overdue).reduce((sum, row) => sum + row.pendingAmount, 0),
    dueStatements,
    monthsWithoutStatement: unassigned.map((row) => ({
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      month: row.month,
      loads: Number(row.loads),
      totalAmount: Number(row.totalAmount),
      monthClosed: row.month < currentMonth,
    })),
  }
}
