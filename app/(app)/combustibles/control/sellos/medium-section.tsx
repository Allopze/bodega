import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import type { MediumCrossRow } from "@/lib/combustibles/control/queries/reconciliation"
import { litersText, pctText } from "./format"

/** C-03: lo registrado en terreno frente a lo que informa el proveedor o la tarjeta, por medio. */
export function MediumSection({ rows }: { rows: MediumCrossRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">No hay cargas en terreno ni informes de proveedor en este período. Asigna el medio de suministro al registrar cada carga para poder cruzarlas.</p>
  }
  return (
    <TableRoot aria-label="Cruce por medio de suministro">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Medio de suministro</TableHead>
            <TableHead className="text-right">Registrado en terreno</TableHead>
            <TableHead className="text-right">Informado por el proveedor</TableHead>
            <TableHead className="text-right" title="Informado por el proveedor menos registrado en terreno">Diferencia</TableHead>
            <TableHead className="text-right">Diferencia %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.mediumId ?? "none"}>
              <TableCell className="font-medium">{row.name}</TableCell>
              <TableCellNum>
                {litersText(row.fieldLiters)}
                <span className="ml-1.5 text-xs text-[var(--color-text-muted)]">({row.fieldLoads} {row.fieldLoads === 1 ? "carga" : "cargas"})</span>
              </TableCellNum>
              {row.reportedLiters === null ? (
                <TableCell colSpan={3} className="text-right text-[var(--color-text-muted)]">Sin informe del proveedor</TableCell>
              ) : (
                <>
                  <TableCellNum>{litersText(row.reportedLiters)}</TableCellNum>
                  <TableCellNum>{litersText(row.differenceLiters)}</TableCellNum>
                  <TableCellNum>{pctText(row.differencePct)}</TableCellNum>
                </>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-muted)]">Diferencia = informado por el proveedor − registrado en terreno; el % es sobre lo informado.</p>
    </TableRoot>
  )
}
