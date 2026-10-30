import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { executorText, formatHours, formatNumber, formatReading, plural, recordKindText } from "@/lib/mantencion/format"
import type { LifeRow, LifeTotals } from "@/lib/services/mantencion/equipment-life"
import { formatDate } from "@/lib/utils"
import { RecordStatusBadges } from "../shared/record-badges"
import { SectionCard } from "../shared/section-card"

export interface EquipmentLifeData {
  rows: LifeRow[]
  totals: LifeTotals
  hasMore: boolean
  /** Cuántas filas se piden hoy; «Mostrar más» agrega otra tanda. */
  limit: number
}

export const LIFE_PAGE_SIZE = 20

/** «12 mantenciones · 3 correctivas · 40 h de taller». Sólo cuentan las vigentes: una anulada no ocurrió. */
function totalsText(totals: LifeTotals): string {
  const parts = [
    plural(totals.active, "mantención vigente", "mantenciones vigentes"),
    plural(totals.activeCorrective, "correctiva", "correctivas"),
    `${formatHours(totals.activeHours)} de taller`,
  ]
  if (totals.voided > 0) parts.push(`${plural(totals.voided, "anulada", "anuladas")} (no se cuentan)`)
  return parts.join(" · ")
}

function workshopText(row: LifeRow): string {
  if (row.kind !== "C") return "—"
  if (!row.inWorkshop) return "No"
  const days = row.daysInWorkshop != null ? plural(row.daysInWorkshop, "día", "días") : "sin fecha de ingreso"
  return row.workshopExitDate ? `Sí · ${days}` : `Sí · ${days} · sigue en taller`
}

/**
 * Una sola etiqueta por fila, con el mismo criterio que la lista de registros:
 * anulado, observado o revisado cuando lo son, y «Vigente» para el resto. La
 * revisión «Pendiente» no se pinta —es el estado por omisión, y la lista de
 * registros tampoco lo muestra—; antes «Vigente» y «PENDIENTE» convivían en la
 * misma celda con dos estilos.
 */
function LifeStatus({ row }: { row: LifeRow }) {
  if (row.status === "anulado" || row.review !== "pendiente") return <RecordStatusBadges status={row.status} review={row.review} />
  return <Badge variant="outline" size="sm">Vigente</Badge>
}

/**
 * Hoja de vida del equipo: todas sus mantenciones, vigentes y anuladas (éstas
 * marcadas), dentro del alcance de lectura de quien mira. Reemplaza a «Registros
 * recientes»: es la misma lista, completa y con más columnas.
 */
export function EquipmentLifeSection({ life, code }: { life: EquipmentLifeData; code: string }) {
  const { rows, totals, hasMore, limit } = life
  return (
    <SectionCard title="Hoja de vida" description={rows.length ? totalsText(totals) : "Historial de mantenciones del equipo"}>
      {rows.length === 0 ? (
        <EmptyState
          compact
          title="Este equipo aún no tiene mantenciones"
          description="Aparecen aquí cuando el mecánico firma una preventiva o una correctiva desde la app. Si esperabas verlas y no están, puede que pertenezcan a una faena que tu perfil no alcanza."
        />
      ) : (
        <>
          {/* La tabla sangra hasta el borde de la tarjeta: sin su propio marco, para no dibujar un borde dentro del borde. */}
          <TableRoot aria-label={`Mantenciones del equipo ${code}`} className="-mx-5 w-auto rounded-none border-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Folio</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Lectura</TableHead>
                  <TableHead>Hecho por</TableHead>
                  <TableHead>Horas</TableHead>
                  <TableHead>En taller</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className={row.status === "anulado" ? "text-[var(--color-text-muted)]" : undefined}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{formatDate(row.workDate)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Link href={`/mantencion/registros/${row.id}`} className="inline-flex min-h-11 items-center font-mono text-xs font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline sm:min-h-0">
                        {row.folio ?? "Sin folio"}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className={row.status === "anulado" ? "line-through" : undefined}>{recordKindText(row.kind, row.intervalValue, row.unit)}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{formatReading(row.reading, row.unit)}</TableCell>
                    <TableCell className="min-w-48 text-xs">{executorText(row)}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{row.hours != null ? formatHours(row.hours) : "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{workshopText(row)}</TableCell>
                    <TableCell><LifeStatus row={row} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-text-muted)]">
            <span>Mostrando {formatNumber(rows.length)} de {formatNumber(totals.active + totals.voided)}</span>
            {hasMore && (
              <Link
                href={`?vida=${limit + LIFE_PAGE_SIZE}`}
                replace
                scroll={false}
                className="inline-flex min-h-11 items-center font-semibold text-[var(--color-primary-ink)] hover:underline sm:min-h-0"
              >
                Mostrar más
              </Link>
            )}
          </div>
        </>
      )}
    </SectionCard>
  )
}
