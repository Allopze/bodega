import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableCellNum, TableFooter, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import type { SealJustificationRow, SupervisorSealRow } from "@/lib/combustibles/control/queries/seals"
import { formatDateTime } from "@/lib/utils"
import { litersText } from "../_components/format"

const MISSING_LABEL = { removed: "Sin sello retirado", installed: "Sin sello nuevo", both: "Sin ningún sello" } as const

function countLabel(count: number): string {
  const text = count >= 20 ? `${count}+` : String(count)
  return `${text} ${count === 1 ? "carga" : "cargas"} sin sello`
}

/** Cifra que solo se destaca (rojo + texto) cuando es mayor que cero. */
function Alert({ value, label }: { value: number; label: string }) {
  if (value === 0) return <span className="text-[var(--color-text-muted)]">0</span>
  return <span className="font-semibold text-[var(--color-danger-ink)]" aria-label={`${value} ${label}`}>{value}</span>
}

/** «1 carga» / «5 cargas». */
const cargas = (count: number) => `${count} ${count === 1 ? "carga" : "cargas"}`

/**
 * La frase que abre la vista: cuántas cargas se registraron y a cuántas les
 * faltó un sello o se les cortó la cadena. `periodPhrase` es «en octubre».
 */
export function sealsAnswer(rows: Array<Pick<SupervisorSealRow, "loads" | "withoutRemovedSeal" | "withoutInstalledSeal" | "chainBreaks">>, periodPhrase: string): string {
  const total = rows.reduce((acc, row) => ({
    loads: acc.loads + row.loads, removed: acc.removed + row.withoutRemovedSeal, installed: acc.installed + row.withoutInstalledSeal, chain: acc.chain + row.chainBreaks,
  }), { loads: 0, removed: 0, installed: 0, chain: 0 })
  if (total.loads === 0) return `No hay cargas en terreno ${periodPhrase}.`
  const lead = `${periodPhrase.charAt(0).toUpperCase()}${periodPhrase.slice(1)} se registraron ${cargas(total.loads)} en terreno.`
  const problems = [
    total.removed > 0 ? `a ${cargas(total.removed)} les faltó el sello retirado` : null,
    total.installed > 0 ? `a ${cargas(total.installed)} les faltó el sello nuevo` : null,
    total.chain > 0 ? `${total.chain === 1 ? "una tiene" : `${total.chain} tienen`} la cadena de sellos rota` : null,
  ].filter((item): item is string => item !== null)
  if (problems.length === 0) return `${lead} Todas tienen sus sellos y la cadena está completa.`
  const text = (problems.length === 1 ? problems[0] : `${problems.slice(0, -1).join(", ")} y ${problems[problems.length - 1]}`) ?? ""
  return `${lead} ${text.charAt(0).toUpperCase()}${text.slice(1)}.`
}

/** C-04, C-05 y C-06 en una tabla; debajo, las justificaciones por supervisor. */
export function SupervisorsSection({ rows, justifications, cargasHref }: { rows: SupervisorSealRow[]; justifications: SealJustificationRow[]; cargasHref?: string }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        title="No hay cargas en terreno en este período"
        description="Cuando los supervisores registren cargas, aparecerán aquí con los sellos que les faltaron y las cadenas que se cortaron."
        action={cargasHref ? <Button asChild variant="secondary" size="sm"><Link href={cargasHref}>Ver las cargas del período</Link></Button> : undefined}
      />
    )
  }
  const total = rows.reduce((acc, row) => ({
    loads: acc.loads + row.loads, liters: acc.liters + row.liters,
    removed: acc.removed + row.withoutRemovedSeal, installed: acc.installed + row.withoutInstalledSeal, chain: acc.chain + row.chainBreaks,
  }), { loads: 0, liters: 0, removed: 0, installed: 0, chain: 0 })
  const byKey = new Map<string, SealJustificationRow[]>()
  for (const item of justifications) byKey.set(item.supervisorKey, [...(byKey.get(item.supervisorKey) ?? []), item])
  const withReasons = rows.filter((row) => byKey.has(row.key))

  return (
    <div className="space-y-6">
      <TableRoot aria-label="Cargas y sellos por supervisor">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supervisor</TableHead>
              <TableHead className="text-right">Cargas</TableHead>
              <TableHead className="text-right">Litros</TableHead>
              <TableHead className="text-right" title="Cargas iniciadas sin sello retirado">Sin sello retirado</TableHead>
              <TableHead className="text-right" title="Cargas terminadas sin sello nuevo instalado">Sin sello nuevo</TableHead>
              <TableHead className="text-right" title="Cargas cuyo sello retirado no es el instalado en la carga anterior del equipo">Cadena rota</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCellNum>{row.loads}</TableCellNum>
                <TableCellNum>{litersText(row.liters)}</TableCellNum>
                <TableCellNum><Alert value={row.withoutRemovedSeal} label="cargas sin sello retirado" /></TableCellNum>
                <TableCellNum><Alert value={row.withoutInstalledSeal} label="cargas sin sello nuevo" /></TableCellNum>
                <TableCellNum><Alert value={row.chainBreaks} label="cadenas de sellos rotas" /></TableCellNum>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="font-semibold">
              <TableCell>Total</TableCell>
              <TableCellNum>{total.loads}</TableCellNum>
              <TableCellNum>{litersText(total.liters)}</TableCellNum>
              <TableCellNum>{total.removed}</TableCellNum>
              <TableCellNum>{total.installed}</TableCellNum>
              <TableCellNum>{total.chain}</TableCellNum>
            </TableRow>
          </TableFooter>
        </Table>
        <p className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-muted)]">El último sello de cada equipo no cuenta como cadena rota: todavía no hay una carga siguiente que lo retire.</p>
      </TableRoot>

      {withReasons.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Justificaciones de cargas sin sello</h3>
          <p className="mb-2 text-xs text-[var(--color-text-muted)]">Las 20 más recientes de cada supervisor, con el motivo que declaró.</p>
          <div className="divide-y divide-[var(--color-border)] rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
            {withReasons.map((row) => (
              <details key={row.key} className="group px-4 py-3">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]">
                  <span className="min-w-0 truncate">{row.name}</span>
                  <Badge variant="danger">{countLabel(byKey.get(row.key)!.length)}</Badge>
                </summary>
                <ul className="mt-2 space-y-2 text-sm">
                  {byKey.get(row.key)!.map((item) => (
                    <li key={item.submissionId} className="grid gap-x-4 gap-y-0.5 sm:grid-cols-[9rem_6rem_9rem_minmax(0,1fr)]">
                      <span className="tabular-nums text-[var(--color-text-muted)]">{formatDateTime(item.loadedAt)}</span>
                      <span className="font-medium">{item.equipment}</span>
                      <span className="text-[var(--color-text-muted)]">{MISSING_LABEL[item.missing]}</span>
                      <span className={item.reason ? "text-[var(--color-text)]" : "text-[var(--color-text-muted)]"}>{item.reason ?? "Sin motivo registrado"}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
