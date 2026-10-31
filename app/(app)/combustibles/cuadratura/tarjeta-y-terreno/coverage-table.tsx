import Link from "next/link"
import { MetaBadge } from "@/components/states/state-badge"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import type { CardFieldCoverage, TaeCopecReconciliationRow } from "@/lib/combustibles/tae-copec-reconciliation"
import { fuelEquipmentHref } from "@/lib/combustibles/routes"
import { formatQty } from "@/lib/utils"
import { litersText, monthText } from "../_components/format"

export type CoverageFilter = "ambos" | "tarjeta" | "terreno"

export const COVERAGE_FILTER_LABEL: Record<CoverageFilter, string> = { ambos: "En ambos", tarjeta: "Sólo tarjeta", terreno: "Sólo terreno" }
export const COVERAGE_BY_FILTER: Record<CoverageFilter, TaeCopecReconciliationRow["coverage"]> = { ambos: "both_channels", tarjeta: "tct_only", terreno: "tae_only" }

const COVERAGE_BADGE: Record<TaeCopecReconciliationRow["coverage"], { label: string; variant: "primary" | "warning" | "info" }> = {
  both_channels: { label: "En ambos", variant: "primary" },
  tct_only: { label: "Sólo tarjeta", variant: "warning" },
  tae_only: { label: "Sólo terreno", variant: "info" },
}

/**
 * La frase que abre la vista, en el sentido que pide la pregunta: de lo que
 * informó la tarjeta, cuánto quedó registrado en terreno.
 */
export function coverageAnswer(coverage: CardFieldCoverage, multipleMonths: boolean): string {
  if (coverage.cardRows === 0) return "La tarjeta no informó ningún equipo en este período; sólo hay cargas registradas en terreno."
  const noun = multipleMonths ? "equipos por mes" : coverage.cardRows === 1 ? "equipo" : "equipos"
  const pct = formatQty(coverage.coveragePct ?? 0, undefined, { maximumFractionDigits: 0 })
  const litersPart = coverage.coveredLitersPct === null
    ? ""
    : `: ${litersText(coverage.coveredCardLiters)} de los ${litersText(coverage.cardLiters)} que informó (${formatQty(coverage.coveredLitersPct, undefined, { maximumFractionDigits: 0 })} %)`
  const onlyCard = coverage.cardOnly === 0 ? "" : ` ${coverage.cardOnly} ${coverage.cardOnly === 1 ? "aparece" : "aparecen"} sólo en la tarjeta.`
  return `La tarjeta informó ${coverage.cardRows} ${noun} y ${coverage.both} (${pct} %) ${coverage.both === 1 ? "también tiene" : "también tienen"} cargas registradas en terreno${litersPart}.${onlyCard}`
}

/** Un equipo por mes: lo registrado en terreno y lo que informó la tarjeta, lado a lado. */
export function CoverageTable({ rows }: { rows: TaeCopecReconciliationRow[] }) {
  return (
    <TableRoot aria-label="Cobertura de la tarjeta en terreno, por equipo y mes">
      <Table className="min-w-[860px]">
        <TableHeader>
          <TableRow>
            <TableHead>Mes</TableHead>
            <TableHead>Faena</TableHead>
            <TableHead>Equipo</TableHead>
            <TableHead className="text-right">En terreno</TableHead>
            <TableHead className="text-right">Tarjeta diésel</TableHead>
            <TableHead className="text-right">Tarjeta BlueMax</TableHead>
            <TableHead>Aparece en</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const badge = COVERAGE_BADGE[row.coverage]
            return (
              <TableRow key={`${row.month}:${row.worksiteId}:${row.vehicleId}`}>
                <TableCell className="whitespace-nowrap">{monthText(row.month)}</TableCell>
                <TableCell>{row.worksiteName}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <Link href={fuelEquipmentHref(row.vehicleId)} className="font-medium text-[var(--color-text)] underline-offset-4 hover:underline">{row.equipment}</Link>
                  {row.plate && row.plate !== row.equipment ? <span className="block text-xs text-[var(--color-text-muted)]">{row.plate}</span> : null}
                </TableCell>
                <TableCellNum>
                  {row.taeLoads > 0 ? litersText(row.taeLiters) : "—"}
                  {row.taeLoads > 0 ? <span className="block text-xs text-[var(--color-text-muted)]">{row.taeLoads} {row.taeLoads === 1 ? "carga" : "cargas"}</span> : null}
                </TableCellNum>
                <TableCellNum>{row.tctDieselLiters > 0 ? litersText(row.tctDieselLiters) : "—"}</TableCellNum>
                <TableCellNum>{row.tctBlueMaxLiters > 0 ? litersText(row.tctBlueMaxLiters) : "—"}</TableCellNum>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    <MetaBadge meta={badge} />
                    {row.tctPartial ? <MetaBadge meta={{ label: "Parcial", variant: "outline" }} title="Hay un registro de la tarjeta del período que se extiende más allá del rango; sus litros no se suman para no sobreestimarlo. Amplía el período para verlos completos." /> : null}
                  </span>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableRoot>
  )
}
