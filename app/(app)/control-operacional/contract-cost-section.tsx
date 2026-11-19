import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import type { CostComponent } from "@/lib/contracts/cost-attribution"
import type { ContractCostBreakdown, ContractCostRow, ContractCostStatus } from "@/lib/services/contracts/contract-costs"
import type { OperationalControlPeriod } from "@/lib/services/operational-control"
import { formatCLP, formatDate } from "@/lib/utils"

/** Columnas de costo en el orden del Panel; cada una sólo existe si la sesión puede ver ese componente. */
const COMPONENT_COLUMNS: readonly { key: CostComponent; label: string }[] = [
  { key: "fuel", label: "Combustible" },
  { key: "workOrders", label: "Mano de obra (OT)" },
  { key: "purchases", label: "Compras" },
]

const STATUS_LABEL: Record<ContractCostStatus, string> = { active: "Vigente", suspended: "Suspendido", closed: "Cerrado" }

/** «—» cuando el valor no está disponible: nunca un $0 inventado. */
function money(value: number | null): string {
  return value === null ? "—" : formatCLP(value)
}

function contractHref(period: OperationalControlPeriod, contractId: string): string {
  return `/control-operacional?desde=${period.from}&hasta=${period.to}&contrato=${encodeURIComponent(contractId)}`
}

/**
 * «Costo por contrato» del Panel operacional (diseño § 8.3): una tabla por faena,
 * con una fila por contrato más las cubetas «Sin contrato», «Por repartir» y
 * «Compras sin equipo». Es una tabla, no tiles (A1). Las cifras salen de
 * `getContractCostBreakdown`, que reparte las mismas partidas del costo por equipo.
 */
export function ContractCostSection({
  breakdown,
  period,
  selectedContractId,
}: {
  breakdown: ContractCostBreakdown
  period: OperationalControlPeriod
  selectedContractId: string | null
}) {
  const columns = COMPONENT_COLUMNS.filter((column) => breakdown.availability[column.key])
  if (breakdown.worksites.length === 0 || columns.length === 0) return null

  // La fila de la faena abarca todo salvo la columna «Total», donde va su subtotal.
  const labelSpan = 3 + columns.length

  const renderRow = (row: ContractCostRow, index: number) => (
    <TableRow key={row.contractId ?? `${row.kind}-${index}`}>
      <TableCell>
        <span className="flex flex-wrap items-center gap-1.5">
          {row.kind === "contract" && row.contractId ? (
            <Link
              href={contractHref(period, row.contractId)}
              scroll={false}
              aria-current={row.contractId === selectedContractId ? "true" : undefined}
              className="font-medium text-[var(--color-primary-ink)] underline-offset-4 hover:underline"
            >
              {row.label}
            </Link>
          ) : (
            <span className="text-[var(--color-text-muted)]">{row.label}</span>
          )}
          {row.kind === "contract" && row.status && row.status !== "active" && (
            <Badge variant="neutral" size="sm">{STATUS_LABEL[row.status]}</Badge>
          )}
        </span>
      </TableCell>
      <TableCell className="text-[var(--color-text-muted)]">{row.clientName ?? "—"}</TableCell>
      <TableCellNum>{row.kind === "pending" || row.kind === "no_equipment" ? "—" : row.vehicleCount}</TableCellNum>
      {columns.map((column) => (
        <TableCellNum key={column.key}>{money(row[column.key])}</TableCellNum>
      ))}
      <TableCellNum>
        <span className="inline-flex items-center justify-end gap-1.5">
          {row.partial && <Badge variant="warning" size="sm">parcial</Badge>}
          {money(row.total)}
        </span>
      </TableCellNum>
    </TableRow>
  )

  return (
    <section aria-labelledby="costo-por-contrato" className="mb-4">
      <Card>
        <CardHeader>
          <CardTitle as="h2" id="costo-por-contrato">Costo por contrato</CardTitle>
          <CardDescription>
            {formatDate(period.from)} – {formatDate(period.to)}. Cada costo va al contrato vigente del equipo el día en que ocurrió.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {breakdown.worksites.map((worksite) => (
            <TableRoot key={worksite.worksiteId} framed={false} aria-label={`Costo por contrato en ${worksite.worksiteName}`}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contrato</TableHead>
                    <TableHead>Mandante</TableHead>
                    <TableHead className="text-right">Equipos</TableHead>
                    {columns.map((column) => (
                      <TableHead key={column.key} className="text-right">{column.label}</TableHead>
                    ))}
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-[var(--color-surface-2)]">
                    <TableCell colSpan={labelSpan} className="font-semibold">{worksite.worksiteName}</TableCell>
                    <TableCellNum className="font-semibold">
                      <span className="inline-flex items-center justify-end gap-1.5">
                        {worksite.partial && <Badge variant="warning" size="sm">parcial</Badge>}
                        {money(worksite.total)}
                      </span>
                    </TableCellNum>
                  </TableRow>
                  {worksite.rows.map(renderRow)}
                </TableBody>
              </Table>
            </TableRoot>
          ))}
        </CardContent>
      </Card>
    </section>
  )
}
