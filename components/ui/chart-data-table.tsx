import { cn } from "@/lib/utils"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export interface ChartDataTableRow {
  /** Primera columna: qué representa la fila (mes, faena, categoría…). */
  label: string
  /** Resto de columnas, ya formateadas. El componente no inventa unidades. */
  values: (string | number)[]
}

interface ChartDataTableProps {
  /** Nombra el gráfico que esta tabla traduce. */
  title: string
  /** Encabezado de la primera columna. */
  groupLabel: string
  /** Encabezados del resto de columnas, en el mismo orden que `values`. */
  columns: string[]
  rows: ChartDataTableRow[]
  /**
   * La conclusión que el gráfico responde, en una frase. Va **antes** del
   * gráfico porque es lo que la mayoría viene a buscar; el gráfico es el
   * detalle, no la respuesta.
   */
  conclusion: string
  /** Período, unidad o alcance de los datos. */
  caption?: string
  /** Columnas que se alinean a la derecha por ser numéricas. */
  numericFrom?: number
  className?: string
}

/**
 * Lectura equivalente de un gráfico (TASK-UI-015).
 *
 * Un gráfico es el único canal de su dato: quien usa lector de pantalla, quien
 * no distingue las series por color y quien mira una pantalla de 320 px se
 * quedan sin la cifra. La auditoría pedía "resumen/tablas equivalentes" y
 * "color no es el único canal", y hasta ahora sólo Combustibles lo cumplía con
 * un componente propio atado a pesos y litros.
 *
 * Éste es el mismo contrato sin ese supuesto: recibe filas ya formateadas, así
 * que sirve a porcentajes, tasas, conteos o montos sin que el componente
 * decida la unidad. La tabla vive dentro de un `<details>` para no competir con
 * el gráfico, y es operable con teclado por serlo.
 */
export function ChartDataTable({
  title,
  groupLabel,
  columns,
  rows,
  conclusion,
  caption,
  numericFrom = 0,
  className,
}: ChartDataTableProps) {
  return (
    <section className={cn("mt-4 border-t border-[var(--color-border)] pt-3", className)} aria-label={`Resumen de ${title}`}>
      <p className="text-sm text-[var(--color-text)]">
        <span className="font-semibold">Lectura rápida. </span>
        {conclusion}
      </p>
      {caption && <p className="mt-1 text-xs text-[var(--color-text-muted)]">{caption}</p>}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium text-[var(--color-primary)] underline-offset-4 hover:underline">
          {rows.length === 0
            ? "Tabla equivalente: sin datos"
            : `Tabla equivalente: ${rows.length} ${rows.length === 1 ? "fila" : "filas"}`}
        </summary>
        <div className="mt-3 overflow-x-auto">
          <Table className="min-w-[420px]">
            <TableHeader>
              <TableRow>
                <TableHead>{groupLabel}</TableHead>
                {columns.map((column, index) => (
                  <TableHead key={column} className={index >= numericFrom ? "text-right" : undefined}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length + 1} className="py-4 text-center text-sm text-[var(--color-text-muted)]">
                    Sin datos para los filtros aplicados.
                  </TableCell>
                </TableRow>
              ) : rows.map((row, rowIndex) => (
                <TableRow key={`${row.label}-${rowIndex}`}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  {row.values.map((value, index) => (
                    <TableCell
                      key={`${columns[index] ?? index}`}
                      className={index >= numericFrom ? "text-right font-mono text-sm" : undefined}
                    >
                      {value}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </details>
    </section>
  )
}
