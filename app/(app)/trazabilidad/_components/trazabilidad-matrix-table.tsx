import Link from "next/link"
import { StateBadge } from "@/components/states/state-badge"
import { formatQty } from "@/lib/utils"
import {
  TableRoot, Table, TableHeader, TableBody,
  TableRow, TableHead, TableCell, TableCellNum, TableCaption,
} from "@/components/ui/table"
import { Warning, ArrowSquareOut } from "@phosphor-icons/react/dist/ssr"
import type { MatrixRow } from "@/lib/services/trazabilidad-matrix"

interface Props {
  rows: MatrixRow[]
}

export function TrazabilidadMatrixTable({ rows }: Props) {
  return (
    <TableRoot stickyHeader className="hidden md:block">
      <Table>
        <TableCaption className="sr-only">
          Matriz de trazabilidad de ítems por producto, faena, solicitud, cantidades y estado.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Producto</TableHead>
            <TableHead>Faena</TableHead>
            <TableHead>Solicitud</TableHead>
            <TableHead className="text-right">Solicitado</TableHead>
            <TableHead className="text-right">Aprobado</TableHead>
            <TableHead className="text-right">En OC</TableHead>
            <TableHead className="text-right">Recibido</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.itemId}
              data-alert={row.alert ? "true" : undefined}
              className={row.alert
                ? "bg-[var(--color-signal-tint)] ring-1 ring-inset ring-[var(--color-signal-line)]"
                : undefined}
            >
              <TableCell className="max-w-[220px]">
                <Link
                  href={`/trazabilidad/${row.itemId}`}
                  className="font-medium text-[var(--color-primary)] hover:underline underline-offset-2 truncate block"
                  title={row.productName}
                >
                  {row.productName}
                </Link>
                {row.productSku && (
                  <div className="text-xs text-[var(--color-text-subtle)] font-mono">{row.productSku}</div>
                )}
              </TableCell>

              <TableCell className="text-sm text-[var(--color-text-muted)] whitespace-nowrap">
                {row.worksiteName}
              </TableCell>

              <TableCell>
                <Link
                  href={`/solicitudes/${row.requestId}`}
                  className="inline-flex items-center gap-1 text-sm text-[var(--color-primary)] hover:underline underline-offset-2"
                >
                  {row.requestCode}
                  <ArrowSquareOut className="h-3 w-3 shrink-0" aria-hidden />
                </Link>
              </TableCell>

              <TableCellNum>{formatQty(row.requested, row.uom)}</TableCellNum>

              <TableCellNum>
                {row.approved !== null ? formatQty(row.approved, row.uom) : (
                  <span className="text-[var(--color-text-subtle)]">—</span>
                )}
              </TableCellNum>

              <TableCellNum>
                <span className={row.alert ? "font-semibold text-[var(--color-signal-ink)]" : undefined}>
                  {formatQty(row.inOc, row.uom)}
                </span>
                {row.alert && (
                  <Warning
                    weight="fill"
                    className="inline ml-1 h-3.5 w-3.5 text-[var(--color-signal-ink)]"
                    aria-label={`Faltan ${formatQty((row.approved ?? 0) - row.inOc, row.uom)} en OC`}
                  />
                )}
              </TableCellNum>

              <TableCellNum>{formatQty(row.received, row.uom)}</TableCellNum>

              <TableCell>
                <StateBadge state={row.status} entity="item" size="sm" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableRoot>
  )
}
