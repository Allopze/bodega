import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { and, asc, desc, inArray, lte, or } from "drizzle-orm"
import { db } from "@/db"
import { fuelMonthlyStatements, fuelSuppliers } from "@/db/schema"
import { can, requirePermission } from "@/lib/auth/can"
import { assertFuelCostAccess } from "@/lib/operational-control/capabilities"
import { fuelMonthLabel } from "@/lib/combustibles/calculations"
import { toStatementMonths } from "@/lib/combustibles/period"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import { getPayablesSummary, statementWithBalanceSql, type PayablesSummary } from "@/lib/combustibles/payables-summary"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { FUEL_CARRY_PARAMS, pagosNavItems } from "@/lib/combustibles/section-nav"
import { formatCLP, formatDate, formatDateRelative, todayInChile } from "@/lib/utils"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SectionNav } from "@/components/ui/section-nav"
import { createSettleTracker } from "../settle-tracker"
import { NewStatementDialog } from "./new-statement-dialog"
import { StatementsTable } from "./statements-table"

export const metadata: Metadata = { title: "Estados de cuenta" }

type SearchParams = Record<string, string | string[] | undefined>

const NO_PAYABLES: PayablesSummary = { pendingAmount: 0, overdueAmount: 0, dueStatements: [], monthsWithoutStatement: [] }

/**
 * Pagos › Estados de cuenta (antes «Cuenta corriente»): el resumen mensual de cada
 * proveedor, con lo que se debe y lo pagado. Sólo para rol global con costos
 * (`assertFuelCostAccess({ global: true })`). Muestra los estados de cuenta de los
 * meses del período y, además, los de meses anteriores que todavía tienen saldo:
 * una deuda no desaparece porque el período cambie.
 */
export default async function EstadosCuentaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view", FUEL_PATHS.pagos); assertFuelCostAccess(session, { global: true }) } catch { redirect("/forbidden") }
  const period = await resolveFuelPeriodForPage(session, await searchParams)
  const months = toStatementMonths(period)
  const lastMonth = months[months.length - 1] ?? todayInChile().slice(0, 7)
  const today = todayInChile()
  const { track, degraded, total: trackedTotal } = createSettleTracker()

  const [statements, suppliers, payables] = await Promise.all([
    track(
      db.query.fuelMonthlyStatements.findMany({
        where: or(
          inArray(fuelMonthlyStatements.month, months),
          and(statementWithBalanceSql(), lte(fuelMonthlyStatements.month, lastMonth)),
        ),
        with: { supplier: true, payments: true },
        orderBy: [desc(fuelMonthlyStatements.month), asc(fuelMonthlyStatements.fuelSupplierId)],
      }),
      [],
      "estados-lista",
    ),
    track(db.select({ id: fuelSuppliers.id, name: fuelSuppliers.name }).from(fuelSuppliers).orderBy(fuelSuppliers.name), [] as Array<{ id: string; name: string }>, "estados-proveedores"),
    track(getPayablesSummary(session, period), NO_PAYABLES, "estados-saldos"),
  ])

  const canManage = can(session, "combustibles:manage_statements")
  // Al abrir el diálogo desde la cabecera: el último mes del período si ya terminó; si no, el mes anterior (lo que se cierra ahora).
  const defaultMonth = lastMonth < today.slice(0, 7) ? lastMonth : undefined

  return (
    <PageContainer>
      <PageHeader
        title="Estados de cuenta"
        description="El resumen mensual de cada proveedor, con lo que se debe y lo pagado"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Facturas y pagos", href: FUEL_PATHS.pagos }, { label: "Estados de cuenta" }]} />}
        actions={
          <FuelHeaderActions period={period} granularity="month">
            {canManage && <NewStatementDialog suppliers={suppliers} defaultMonth={defaultMonth} />}
          </FuelHeaderActions>
        }
      />

      <SectionNav items={pagosNavItems(session)} activeKey="estados" ariaLabel="Pagos" carryParams={FUEL_CARRY_PARAMS} />
      <DegradedDataBanner degraded={degraded} total={trackedTotal()} />

      {!degraded.includes("estados-saldos") && <PayablesSentence payables={payables} today={today} />}
      <p className="mb-4 text-xs text-[var(--color-text-muted)]">
        Se muestran los estados de cuenta {period.isWholeMonths && months.length === 1 ? `de ${fuelMonthLabel(months[0] ?? "")}` : `de los meses que toca ${period.label}`} y los de meses anteriores que todavía tienen saldo.
      </p>

      {degraded.includes("estados-lista") ? null : (
        <StatementsTable
          statements={statements}
          missing={payables.monthsWithoutStatement}
          suppliers={suppliers}
          canManage={canManage}
          today={today}
        />
      )}
    </PageContainer>
  )
}

/** Lo que se debe, lo que ya venció, lo que vence primero y lo que falta crear: una frase, no cuatro tiles. */
function PayablesSentence({ payables, today }: { payables: PayablesSummary; today: string }) {
  const { pendingAmount, overdueAmount, dueStatements, monthsWithoutStatement } = payables
  const next = dueStatements.find((statement) => statement.dueDate !== null)
  const nextText = next?.dueDate
    ? next.overdue
      ? `El más atrasado: ${next.supplierName} de ${fuelMonthLabel(next.month).toLowerCase()}, vencido ${formatDateRelative(next.dueDate, today)}.`
      : `El próximo vence el ${formatDate(next.dueDate)} (${formatDateRelative(next.dueDate, today)}): ${next.supplierName} de ${fuelMonthLabel(next.month).toLowerCase()}.`
    : null
  const missing = monthsWithoutStatement.map((m) => `${m.supplierName} ${fuelMonthLabel(m.month).toLowerCase()}`)
  const missingClosed = monthsWithoutStatement.every((m) => m.monthClosed !== false)

  if (dueStatements.length === 0 && missing.length === 0) return null

  return (
    <div className="mb-3 space-y-1 text-sm text-[var(--color-text)]">
      {dueStatements.length > 0 ? (
        <p>
          Se debe <strong className="font-mono font-semibold tabular-nums">{formatCLP(pendingAmount)}</strong>{" "}
          en {dueStatements.length} {dueStatements.length === 1 ? "estado de cuenta" : "estados de cuenta"}
          {overdueAmount > 0 ? <>, de los cuales <strong className="font-mono font-semibold tabular-nums text-[var(--color-danger-ink)]">{formatCLP(overdueAmount)}</strong> ya venció</> : null}
          {"."}
          {nextText ? ` ${nextText}` : null}
        </p>
      ) : (
        <p>No hay saldo por pagar en los estados de cuenta.</p>
      )}
      {missing.length > 0 && (
        <p>
          {missing.join(", ")} todavía {missing.length === 1 ? "no tiene" : "no tienen"} estado de cuenta:{" "}
          {missingClosed ? "créalo para dejar el mes cerrado" : "créalo al cerrar el mes"}.
        </p>
      )}
    </div>
  )
}
