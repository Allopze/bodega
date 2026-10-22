import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableCellNum, TableFooter, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { formatQty } from "@/lib/utils"
import type { Crosstab } from "@/lib/combustibles/control/view-helpers"

const liters = (value: number | undefined) => (value === undefined ? "—" : formatQty(value, undefined, { maximumFractionDigits: 0 }))

/**
 * Tabla cruzada faena × medio de suministro, en litros. La usan G-03 (km/L) y
 * G-04 (L/h): las columnas son los medios que de verdad aparecen, con total por
 * faena, total por medio y total general. Números a la derecha, totales en negrita.
 */
export function OverviewCrosstab({ crosstab, label, emptyText }: { crosstab: Crosstab; label: string; emptyText: string }) {
  if (crosstab.rows.length === 0) {
    return <EmptyState compact title="Sin cargas para mostrar" description={emptyText} />
  }
  return (
    <TableRoot aria-label={label}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Faena</TableHead>
            {crosstab.columns.map((column) => <TableHead key={column.key} className="text-right">{column.label}</TableHead>)}
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {crosstab.rows.map((row) => (
            <TableRow key={row.worksiteId}>
              <TableCell className="font-medium">{row.worksiteName}</TableCell>
              {crosstab.columns.map((column) => (
                <TableCellNum key={column.key} className={row.cells[column.key] === undefined ? "text-[var(--color-text-faint)]" : undefined}>
                  {liters(row.cells[column.key])}
                </TableCellNum>
              ))}
              <TableCellNum className="font-bold">{liters(row.total)}</TableCellNum>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow className="hover:bg-transparent">
            <TableCell className="font-bold">Total</TableCell>
            {crosstab.columns.map((column) => <TableCellNum key={column.key} className="font-bold">{liters(crosstab.columnTotals[column.key])}</TableCellNum>)}
            <TableCellNum className="font-bold">{liters(crosstab.grandTotal)}</TableCellNum>
          </TableRow>
        </TableFooter>
      </Table>
    </TableRoot>
  )
}
