import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { executorText, formatHours, formatNumber, formatReading, plural, recordKindText } from "@/lib/mantencion/format"
import type { LifeRow, LifeTotals, LifeWorkOrders } from "@/lib/services/mantencion/equipment-life"
import { formatDate, formatDateTime } from "@/lib/utils"
import { MetaBadge } from "@/components/states/state-badge"
import { OT_STATE_META, workOrderTypeText } from "../ot/ot-labels"
import { RecordStatusBadges } from "../shared/record-badges"
import { SectionCard } from "../shared/section-card"

export interface EquipmentLifeData {
  rows: LifeRow[]
  totals: LifeTotals
  hasMore: boolean
  /** Cuántas filas se piden hoy; «Mostrar más» agrega otra tanda. */
  limit: number
  /** Órdenes de trabajo del equipo. `null` (o ausente) = sin permiso de OT: la sección no se dibuja. */
  workOrders?: LifeWorkOrders | null
  historical?: { total: number; vehicleId: string }
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
function MaintenanceLifeSection({ life, code }: { life: EquipmentLifeData; code: string }) {
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
          {/* Bajo md, una tarjeta por mantención: ocho columnas no caben en 390 px (auditoría 2026-11-13, M13). */}
          <ul aria-label={`Mantenciones del equipo ${code} como tarjetas`} className="grid gap-3 md:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <ResponsiveDataListCard
                  title={(
                    <Link href={`/mantencion/registros/${row.id}`} className="font-mono text-sm font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline">
                      {row.folio ?? "Sin folio"}
                    </Link>
                  )}
                  description={`${formatDate(row.workDate)} · ${recordKindText(row.kind, row.intervalValue, row.unit)}`}
                  status={<LifeStatus row={row} />}
                  className={row.status === "anulado" ? "text-[var(--color-text-muted)]" : undefined}
                >
                  <ResponsiveDataListField label="Lectura"><span className="font-mono tabular-nums">{formatReading(row.reading, row.unit)}</span></ResponsiveDataListField>
                  <ResponsiveDataListField label="Horas"><span className="font-mono tabular-nums">{row.hours != null ? formatHours(row.hours) : "—"}</span></ResponsiveDataListField>
                  <ResponsiveDataListField label="Hecho por">{executorText(row)}</ResponsiveDataListField>
                  <ResponsiveDataListField label="En taller">{workshopText(row)}</ResponsiveDataListField>
                </ResponsiveDataListCard>
              </li>
            ))}
          </ul>
          {/* La tabla sangra hasta el borde de la tarjeta y no lleva marco propio: un borde dentro del borde es una tarjeta dentro de otra. */}
          <TableRoot aria-label={`Mantenciones del equipo ${code}`} framed={false} className="-mx-5 hidden w-auto md:block">
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

function stayText(row: LifeWorkOrders["rows"][number]): string {
  if (row.daysInWorkshop == null) return "—"
  return row.daysInWorkshop === 0 ? "Desde hoy" : plural(row.daysInWorkshop, "día", "días")
}

/**
 * «Órdenes de trabajo» de la hoja de vida: folio (enlace), estado, ingreso →
 * salida y días en taller. Va debajo de la hoja de mantenciones: ésta es la
 * historia del taller; aquélla, de lo que se firmó. Sólo se dibuja para quien
 * tiene permiso de OT (`null` = sin permiso).
 */
function EquipmentWorkOrdersSection({ workOrders, code }: { workOrders: LifeWorkOrders | null; code: string }) {
  if (!workOrders) return null
  const { rows, total } = workOrders
  return (
    <SectionCard
      title="Órdenes de trabajo"
      description={rows.length ? `${plural(total, "orden", "órdenes")} de reparación o mantención en taller` : "Reparaciones y mantenciones pedidas al taller"}
      action={total > rows.length ? (
        <Link href={`/mantencion/ot?estado=abiertas&q=${encodeURIComponent(code)}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-primary-ink)] hover:underline sm:min-h-0">
          Ver todas en la lista de órdenes
        </Link>
      ) : undefined}
    >
      {rows.length === 0 ? (
        <EmptyState
          compact
          title="Este equipo aún no tiene órdenes de trabajo"
          description="Aparecen aquí cuando se pide una reparación o una mantención en el taller para este equipo."
        />
      ) : (
        <>
        <ul aria-label={`Órdenes de trabajo del equipo ${code} como tarjetas`} className="grid gap-3 md:hidden">
          {rows.map((row) => (
            <li key={row.id}>
              <ResponsiveDataListCard
                title={(
                  <Link href={`/mantencion/ot/${row.id}`} className="font-mono text-sm font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline">
                    {row.folio}
                  </Link>
                )}
                description={workOrderTypeText(row)}
                status={<MetaBadge meta={OT_STATE_META[row.status]} size="sm" />}
              >
                <ResponsiveDataListField label="Ingreso → salida" className="col-span-2">
                  <span className="font-mono tabular-nums">
                    {row.workshopEntryAt
                      ? `${formatDateTime(row.workshopEntryAt)} → ${row.workshopExitAt ? formatDateTime(row.workshopExitAt) : "sigue en taller"}`
                      : `Pedida el ${formatDate(row.requestDate)}`}
                  </span>
                </ResponsiveDataListField>
                <ResponsiveDataListField label="Días en taller">{stayText(row)}</ResponsiveDataListField>
              </ResponsiveDataListCard>
            </li>
          ))}
        </ul>
        <TableRoot aria-label={`Órdenes de trabajo del equipo ${code}`} framed={false} className="-mx-5 hidden w-auto md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Folio</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Ingreso → salida</TableHead>
                <TableHead>Días en taller</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap">
                    <Link href={`/mantencion/ot/${row.id}`} className="inline-flex min-h-11 items-center font-mono text-xs font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline sm:min-h-0">
                      {row.folio}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{workOrderTypeText(row)}</TableCell>
                  <TableCell><MetaBadge meta={OT_STATE_META[row.status]} size="sm" /></TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">
                    {row.workshopEntryAt
                      ? `${formatDateTime(row.workshopEntryAt)} → ${row.workshopExitAt ? formatDateTime(row.workshopExitAt) : "sigue en taller"}`
                      : <span className="text-[var(--color-text-muted)]">Pedida el {formatDate(row.requestDate)}</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{stayText(row)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableRoot>
        </>
      )}
    </SectionCard>
  )
}

/**
 * Hoja de vida del equipo: las mantenciones firmadas y, debajo, las órdenes de
 * trabajo del taller (sólo para quien tiene permiso de OT).
 */
export function EquipmentLifeSection({ life, code }: { life: EquipmentLifeData; code: string }) {
  return (
    <div className="flex flex-col gap-5">
      <MaintenanceLifeSection life={life} code={code} />
      {!!life.historical?.total && <SectionCard title="Historial anterior" description={`${plural(life.historical.total, "trabajo registrado", "trabajos registrados")} en formularios anteriores`}>
        <Link href={`/mantencion/registros/historicos?equipo=${encodeURIComponent(life.historical.vehicleId)}`} className="text-sm font-semibold text-[var(--color-primary-ink)] hover:underline">Ver el historial anterior de este equipo</Link>
      </SectionCard>}
      <EquipmentWorkOrdersSection workOrders={life.workOrders ?? null} code={code} />
    </div>
  )
}
