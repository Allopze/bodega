import * as React from "react"
import { Badge } from "@/components/ui/badge"
import {
  TableRoot, Table, TableHeader, TableBody,
  TableRow, TableHead, TableCell, TableCellNum,
} from "@/components/ui/table"
import { formatQty } from "@/lib/utils"

export interface OcProgressRow {
  id:            string
  productName:   string
  unitOfMeasure: string
  ordered:       number
  received:      number
  invoiced:      number
}

/** Estado consolidado de un ítem según recibido y facturado vs pedido. */
function itemState(row: OcProgressRow): { label: string; variant: "success" | "warning" | "signal" } {
  const fullyReceived = row.received >= row.ordered
  const fullyInvoiced = row.invoiced >= row.ordered
  if (fullyReceived && fullyInvoiced) return { label: "Completo", variant: "success" }
  if (row.received > 0 || row.invoiced > 0) return { label: "Parcial", variant: "warning" }
  return { label: "Pendiente", variant: "signal" }
}

/**
 * Avance por ítem: pedido / recibido en faena / facturado / pendiente, en una
 * sola vista. Reemplaza el cruce manual entre detalle de OC, recepción y
 * facturación que antes obligaba a saltar entre 3 pantallas.
 */
export function OcProgressTable({ rows }: { rows: OcProgressRow[] }) {
  // A-31: la pestaña dice "Facturación 1" y esta columna puede decir "0" para la
  // misma OC, porque una factura registrada no asigna cantidades a los ítems
  // hasta que se concilia. Sin decirlo, se lee como dos datos en conflicto.
  const hasUninvoicedLines = rows.some((row) => row.invoiced === 0)
  return (
    <TableRoot>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Producto</TableHead>
            <TableHead className="text-right">Pedido</TableHead>
            <TableHead className="text-right">Recibido</TableHead>
            <TableHead className="text-right">Facturado</TableHead>
            <TableHead className="text-right">Pendiente</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const pending = Math.max(0, row.ordered - row.received)
            const state = itemState(row)
            return (
              <TableRow key={row.id}>
                <TableCell className="font-medium text-[var(--color-text)]">{row.productName}</TableCell>
                <TableCellNum>{formatQty(row.ordered, row.unitOfMeasure)}</TableCellNum>
                <TableCellNum>{formatQty(row.received, row.unitOfMeasure)}</TableCellNum>
                <TableCellNum>{formatQty(row.invoiced, row.unitOfMeasure)}</TableCellNum>
                <TableCellNum
                  className={pending > 0 ? "text-[var(--color-warning-ink)]" : undefined}
                >
                  {formatQty(pending, row.unitOfMeasure)}
                </TableCellNum>
                <TableCell>
                  <Badge variant={state.variant} size="sm" dot>{state.label}</Badge>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {hasUninvoicedLines && (
        <p className="mt-2 px-1 text-xs text-[var(--color-text-subtle)]">
          <strong className="font-medium">Facturado</strong> cuenta cantidades ya conciliadas contra líneas de la OC.
          Una factura puede estar registrada en la pestaña Facturación y aún no tener cantidades asignadas.
        </p>
      )}
    </TableRoot>
  )
}
