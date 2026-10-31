import Link from "next/link"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { FuelTerm } from "@/components/combustibles/fuel-glossary"
import type { MediumCrossRow } from "@/lib/combustibles/control/queries/reconciliation"
import { litersText, pctText } from "../_components/format"

/** Por debajo de esto la diferencia entre lo informado y lo registrado se dice «coincide». */
const MATCH_PCT = 1

/**
 * La frase que abre la vista: la mayor diferencia entre lo que informa el
 * proveedor y lo registrado en terreno, o que coinciden. Un medio sin informe no
 * entra al cálculo (no es un 0 %), pero se cuenta aparte.
 */
export function mediumAnswer(rows: MediumCrossRow[]): string | null {
  if (rows.length === 0) return null
  const compared = rows.filter((row) => row.reportedLiters !== null && row.differencePct !== null)
  const withoutReport = rows.filter((row) => row.reportedLiters === null).length
  const tail = withoutReport > 0 ? ` ${withoutReport === 1 ? "Un medio no tiene" : `${withoutReport} medios no tienen`} informe del proveedor, así que no se puede cruzar.` : ""
  const worst = [...compared].sort((a, b) => Math.abs(b.differencePct ?? 0) - Math.abs(a.differencePct ?? 0))[0]
  if (!worst) return `Ningún medio tiene informe del proveedor en este período: no hay con qué cruzar lo registrado en terreno.`
  if (Math.abs(worst.differencePct ?? 0) < MATCH_PCT) return `Lo registrado en terreno y lo que informa cada proveedor coinciden: la diferencia es menor a ${MATCH_PCT} %.${tail}`
  return `La mayor diferencia está en ${worst.name}: informó ${litersText(worst.reportedLiters)} y en terreno se registraron ${litersText(worst.fieldLiters)} (${pctText(Math.abs(worst.differencePct ?? 0))}).${tail}`
}

/** C-03: lo registrado en terreno frente a lo que informa el proveedor o la tarjeta, por medio. */
export function MediumSection({ rows, cargasHref, fuentesHref }: { rows: MediumCrossRow[]; cargasHref?: string; fuentesHref?: string | null }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        title="No hay cargas en terreno ni informes del proveedor en este período"
        description="Cada carga lleva el medio por donde llegó el combustible (tarjeta, surtidor, estanque…); sin él no se puede cruzar con lo que informa el proveedor. Registra las cargas con su medio o importa lo que informó el proveedor."
        action={cargasHref ? <Button asChild variant="secondary" size="sm"><Link href={cargasHref}>Ver las cargas del período</Link></Button> : undefined}
        secondaryAction={fuentesHref ? <Button asChild variant="ghost" size="sm"><Link href={fuentesHref}>Ir a Fuentes de datos</Link></Button> : undefined}
      />
    )
  }
  return (
    <TableRoot aria-label="Cruce por medio de suministro">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead><FuelTerm term="De dónde salió" /></TableHead>
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
