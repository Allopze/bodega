import { ArrowDown, ArrowRight } from "@phosphor-icons/react/dist/ssr"
import { Callout } from "@/components/ui/callout"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableCellNum, TableFooter, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import type { FlowTotals, ReconciliationFlow } from "@/lib/combustibles/control/queries/reconciliation"
import { litersText, monthText, pctText } from "./format"

interface Props {
  flow: ReconciliationFlow
  /** Tolerancia del mandante elegido; `null` si no hay mandante. */
  tolerancePct: number | null
  mandanteName: string | null
  /** El usuario ve solo parte de las faenas (S-12). */
  partialScope: boolean
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--color-text)]">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{hint}</p> : null}
    </div>
  )
}

function Joint({ children }: { children: string }) {
  return (
    <>
      <ArrowRight aria-hidden className="hidden self-center text-[var(--color-text-faint)] md:block" size={20} />
      <ArrowDown aria-hidden className="text-[var(--color-text-faint)] md:hidden" size={20} />
      <span className="sr-only">{children}</span>
    </>
  )
}

export function FlowSection({ flow, tolerancePct, mandanteName, partialScope }: Props) {
  const { totals } = flow
  const scopeText = partialScope ? "en tus faenas" : "en las faenas del alcance"
  const empty = totals.inputLiters === 0 && totals.deliveredLiters === 0
  const noInput = totals.inputLiters === 0 && totals.deliveredLiters > 0

  if (empty) {
    return <p className="text-sm text-[var(--color-text-muted)]">No hay entradas ni entregas registradas {scopeText} en este período. Prueba con otro mes o revisa que las faenas del mandante tengan cargas en terreno.</p>
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.5fr)_auto_minmax(0,1fr)]">
        <Figure label="Entrada" value={litersText(totals.inputLiters)} hint="Entradas importadas y tarjetas del proveedor" />
        <Joint>pasa a</Joint>
        <div className="grid min-w-0 grid-cols-2 gap-x-4">
          <Figure label="Entregado directo" value={litersText(totals.directLiters)} />
          <Figure label="Entregado vía estanque" value={litersText(totals.viaTankLiters)} />
        </div>
        <Joint>y da una</Joint>
        <Figure
          label="Diferencia"
          value={litersText(totals.differenceLiters)}
          hint={totals.differencePct === null ? "Sin entrada para calcular el %" : `${pctText(totals.differencePct)} de la entrada`}
        />
      </div>

      {totals.overTolerance && tolerancePct !== null ? (
        <Callout tone="danger" role="alert" title={`La diferencia supera la tolerancia del mandante (${pctText(tolerancePct)})`}>
          {noInput
            ? `Se entregaron ${litersText(totals.deliveredLiters)} y no hay ninguna entrada registrada en el período. Importa las entradas del medio de suministro o revisa las cargas.`
            : `Entraron ${litersText(totals.inputLiters)} y se entregaron ${litersText(totals.deliveredLiters)}: la diferencia es ${litersText(totals.differenceLiters)} (${pctText(totals.differencePct)}).`}
        </Callout>
      ) : tolerancePct !== null ? (
        <p className="text-sm text-[var(--color-text-muted)]">Dentro de la tolerancia de {mandanteName} ({pctText(tolerancePct)}).</p>
      ) : (
        <p className="text-sm text-[var(--color-text-muted)]">Elige un mandante en los filtros para comparar la diferencia con su tolerancia.</p>
      )}

      <p className="text-xs text-[var(--color-text-muted)]">
        Diferencia = entrada − entregado. Directo es lo cargado en surtidores fijos y estaciones con tarjeta; vía estanque, lo cargado desde camión surtidor, estanque de camioneta o bidón.
        {flow.assumedDirectLiters > 0 ? ` ${litersText(flow.assumedDirectLiters)} de cargas en punto «TAE», «Otro» o sin lugar de carga se cuentan como directas.` : ""}
      </p>

      <MonthTable months={flow.months} totals={totals} showStatus={tolerancePct !== null} />
    </div>
  )
}

function MonthTable({ months, totals, showStatus }: { months: ReconciliationFlow["months"]; totals: FlowTotals; showStatus: boolean }) {
  return (
    <TableRoot aria-label="Conciliación por mes">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Mes</TableHead>
            <TableHead className="text-right">Entrada</TableHead>
            <TableHead className="text-right">Directo</TableHead>
            <TableHead className="text-right">Vía estanque</TableHead>
            <TableHead className="text-right">Diferencia</TableHead>
            <TableHead className="text-right">Diferencia %</TableHead>
            {showStatus ? <TableHead>Estado</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {months.map((row) => (
            <TableRow key={row.month}>
              <TableCell className="whitespace-nowrap">{monthText(row.month)}</TableCell>
              <TableCellNum>{litersText(row.inputLiters)}</TableCellNum>
              <TableCellNum>{litersText(row.directLiters)}</TableCellNum>
              <TableCellNum>{litersText(row.viaTankLiters)}</TableCellNum>
              <TableCellNum>{litersText(row.differenceLiters)}</TableCellNum>
              <TableCellNum>{pctText(row.differencePct)}</TableCellNum>
              {showStatus ? (
                <TableCell>
                  {row.overTolerance === null ? <span className="text-[var(--color-text-muted)]">—</span>
                    : row.overTolerance ? <Badge variant="danger">Fuera de tolerancia</Badge>
                      : <Badge variant="neutral">Dentro</Badge>}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow className="font-semibold">
            <TableCell>Total</TableCell>
            <TableCellNum>{litersText(totals.inputLiters)}</TableCellNum>
            <TableCellNum>{litersText(totals.directLiters)}</TableCellNum>
            <TableCellNum>{litersText(totals.viaTankLiters)}</TableCellNum>
            <TableCellNum>{litersText(totals.differenceLiters)}</TableCellNum>
            <TableCellNum>{pctText(totals.differencePct)}</TableCellNum>
            {showStatus ? <TableCell /> : null}
          </TableRow>
        </TableFooter>
      </Table>
    </TableRoot>
  )
}
