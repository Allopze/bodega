import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableCellNum, TableFooter, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { FuelTerm } from "@/components/combustibles/fuel-glossary"
import {
  reconciliationVerdict,
  type MandanteMonthSummary,
  type MandanteReconciliationDetail,
  type ReconciliationTone,
} from "@/lib/combustibles/control/queries/reconciliation-summary"
import { litersText, monthText, pctText } from "../_components/format"

const TONE_BADGE: Record<ReconciliationTone, "success" | "danger" | "neutral"> = { ok: "success", over: "danger", idle: "neutral" }

const upperFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

/**
 * La frase que abre la pantalla: cuántos cuadran y, si alguno no, el peor en
 * palabras («A CMPC Santa Fe le faltan 1.320 L (3,1 %), sobre su tolerancia de 2 %»).
 * `rows` viene con lo que no cuadra primero; `periodPhrase` es «en octubre», «en el 4.º trimestre».
 */
export function mandanteAnswer(rows: MandanteReconciliationDetail[], periodPhrase: string): string {
  const measured = rows.filter((row) => row.overTolerance !== null)
  const first = measured[0]
  if (!first) return `No hay entradas ni entregas ${periodPhrase} que cuadrar.`
  const over = measured.filter((row) => row.overTolerance)
  const opening = measured.length === 1
    ? `${upperFirst(periodPhrase)}, ${first.name} ${over.length > 0 ? "no cuadra" : "cuadra"}.`
    : `${upperFirst(periodPhrase)} cuadran ${measured.length - over.length} de ${measured.length} mandantes.`
  const worst = over[0]
  if (!worst) return opening
  const sentence = lowerFirst(reconciliationVerdict(worst).sentence)
  const single = measured.length === 1
  const missing = worst.inLiters > 0 && worst.differenceLiters > 0
  const tail = missing
    ? (single ? `Le ${sentence}` : `A ${worst.name} le ${sentence}`)
    : (single ? upperFirst(sentence) : `${worst.name}: ${sentence}`)
  return `${opening} ${tail}`
}

/** Todos los mandantes con su tolerancia y su estado en palabras; cada fila lleva a su detalle mes a mes. */
export function MandantesTable({ rows, selectedId, hrefFor }: { rows: MandanteReconciliationDetail[]; selectedId: string | null; hrefFor: (mandanteId: string) => string }) {
  return (
    <TableRoot aria-label="Cuadratura por mandante">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead><FuelTerm term="Mandante" /></TableHead>
            <TableHead className="text-right" title="Entradas importadas y totales de proveedores y tarjetas">Entró</TableHead>
            <TableHead className="text-right" title="Lo cargado en surtidores fijos y estaciones con tarjeta">Entregado directo</TableHead>
            <TableHead className="text-right" title="Lo cargado desde camión surtidor, estanque de camioneta o bidón">Vía estanque</TableHead>
            <TableHead className="text-right" title="Entró menos lo entregado, y su porcentaje sobre lo que entró">Diferencia</TableHead>
            <TableHead className="text-right"><FuelTerm term="Tolerancia" /></TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const verdict = reconciliationVerdict(row)
            const selected = row.mandanteId === selectedId
            return (
              <TableRow key={row.mandanteId} data-selected={selected || undefined} className={selected ? "bg-[var(--color-surface-2)]" : undefined}>
                <TableCell className="min-w-44">
                  <Link href={hrefFor(row.mandanteId)} className="font-medium text-[var(--color-text)] underline-offset-4 hover:underline" aria-label={`Ver ${row.name} mes a mes`}>{row.name}</Link>
                  <span className="block text-xs text-[var(--color-text-muted)]">{row.worksiteNames.length > 0 ? row.worksiteNames.join(", ") : "Sin faenas asignadas"}</span>
                </TableCell>
                <TableCellNum>{row.hasMovement ? litersText(row.inLiters) : "—"}</TableCellNum>
                <TableCellNum>{row.hasMovement ? litersText(row.directLiters) : "—"}</TableCellNum>
                <TableCellNum>{row.hasMovement ? litersText(row.viaTankLiters) : "—"}</TableCellNum>
                <TableCellNum>{row.hasMovement ? `${litersText(row.differenceLiters)} · ${pctText(row.differencePct)}` : "—"}</TableCellNum>
                <TableCellNum>{pctText(row.tolerancePct)}</TableCellNum>
                <TableCell className="min-w-56 whitespace-normal">
                  <Badge variant={TONE_BADGE[verdict.tone]}>{verdict.label}</Badge>
                  <span className="mt-1 block text-xs text-[var(--color-text-muted)]">{verdict.sentence}</span>
                  {row.overTolerance === false && row.monthsOverTolerance.length > 0 ? (
                    <span className="mt-1 block text-xs text-[var(--color-danger-ink)]">
                      {row.monthsOverTolerance.length === 1 ? "Un mes quedó fuera" : `${row.monthsOverTolerance.length} meses quedaron fuera`} de tolerancia: {row.monthsOverTolerance.map(monthText).join(", ")}.
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <p className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-muted)]">
        Diferencia = entró − entregado; el % es sobre lo que entró. Directo es lo cargado en surtidores fijos y estaciones con tarjeta; vía estanque, lo cargado desde camión surtidor, estanque de camioneta o bidón.
      </p>
    </TableRoot>
  )
}

function monthStatus(month: MandanteMonthSummary) {
  if (month.overTolerance === null) return <span className="text-[var(--color-text-muted)]">Sin movimiento</span>
  return month.overTolerance ? <Badge variant="danger">Fuera de tolerancia</Badge> : <Badge variant="success">Cuadra</Badge>
}

/** El detalle de un mandante, mes a mes, con cada mes contra su tolerancia. */
export function MandanteMonths({ row }: { row: MandanteReconciliationDetail }) {
  return (
    <TableRoot aria-label={`${row.name}, mes a mes`}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Mes</TableHead>
            <TableHead className="text-right">Entró</TableHead>
            <TableHead className="text-right">Entregado</TableHead>
            <TableHead className="text-right">Diferencia</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {row.months.map((month) => (
            <TableRow key={month.month}>
              <TableCell className="whitespace-nowrap">{monthText(month.month)}</TableCell>
              <TableCellNum>{month.overTolerance === null ? "—" : litersText(month.inLiters)}</TableCellNum>
              <TableCellNum>{month.overTolerance === null ? "—" : litersText(month.deliveredLiters)}</TableCellNum>
              <TableCellNum>{month.overTolerance === null ? "—" : `${litersText(month.differenceLiters)} · ${pctText(month.differencePct)}`}</TableCellNum>
              <TableCell>{monthStatus(month)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        {row.months.length > 1 ? (
          <TableFooter>
            <TableRow className="font-semibold">
              <TableCell>Total</TableCell>
              <TableCellNum>{litersText(row.inLiters)}</TableCellNum>
              <TableCellNum>{litersText(row.deliveredLiters)}</TableCellNum>
              <TableCellNum>{`${litersText(row.differenceLiters)} · ${pctText(row.differencePct)}`}</TableCellNum>
              <TableCell />
            </TableRow>
          </TableFooter>
        ) : null}
      </Table>
      {row.assumedDirectLiters > 0 ? (
        <p className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-muted)]">
          {litersText(row.assumedDirectLiters)} de cargas en un punto sin tipo definido se cuentan como entregadas directo. Defínelo en Ajustes › Puntos de carga y QR para que la separación sea exacta.
        </p>
      ) : null}
    </TableRoot>
  )
}

/** Lo que conviene mirar cuando un mandante no cuadra: enlaces reales a las pantallas donde se arregla. */
export function WhatToCheck({ row, links }: { row: MandanteReconciliationDetail; links: { cargas: string; fuentes: string | null; estanques: string } }) {
  const noInput = row.inLiters <= 0
  const items = [
    { href: links.cargas, title: "Cargas en terreno sin registrar", hint: "Si faltan registros de días o puntos de carga, lo entregado queda corto." },
    ...(links.fuentes ? [{ href: links.fuentes, title: noInput ? "Entradas que faltan" : "Despachos de otro mes", hint: noInput ? "No hay ninguna entrada en el período: importa los despachos del surtidor o la tarjeta." : "Un archivo del surtidor puede traer despachos del mes anterior o del siguiente." }] : []),
    { href: links.estanques, title: "Merma del estanque", hint: "Sin aforo físico no se distingue una merma de una carga no registrada." },
  ]
  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {items.map((item) => (
        <li key={item.title}>
          <Link href={item.href} className="block py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]">
            <span className="font-medium text-[var(--color-primary-ink)] underline-offset-4 hover:underline">{item.title}</span>
            <span className="block text-xs text-[var(--color-text-muted)]">{item.hint}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

