import "server-only"
import type { Session } from "next-auth"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"

/**
 * Lo que falta pagar (Panel, paso 5, y Pagos › Estados de cuenta). Exige el
 * contrato monetario global (`assertFuelCostAccess({ global: true })`).
 * Contrato de la Fase 0; el cuerpo lo implementa la línea L7.
 */
export interface PayablesSummary {
  pendingAmount: number
  overdueAmount: number
  /** Estados de cuenta con saldo, ordenados por vencimiento. */
  dueStatements: { statementId: string; supplierName: string; month: string; pendingAmount: number; dueDate: string | null; overdue: boolean }[]
  /** Meses del período con cargas facturadas que todavía no tienen estado de cuenta. */
  monthsWithoutStatement: { supplierId: string; supplierName: string; month: string; loads: number; totalAmount: number }[]
}

export async function getPayablesSummary(session: Session, period: ResolvedFuelPeriod): Promise<PayablesSummary> {
  void session; void period
  // TODO(L7)
  return { pendingAmount: 0, overdueAmount: 0, dueStatements: [], monthsWithoutStatement: [] }
}
