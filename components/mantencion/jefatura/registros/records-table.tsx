import type { ReactNode } from "react"
import Link from "next/link"
import { CaretDown, CaretUp, CaretUpDown } from "@phosphor-icons/react/dist/ssr"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { executorText, formatReading, plural, recordKindText } from "@/lib/mantencion/format"
import type { RecordListRow } from "@/lib/services/mantencion/records-query"
import { recordDetailHref, type RecordSortKey, type SortDirection } from "@/lib/services/mantencion/records-filters"
import { formatDate } from "@/lib/utils"

interface SortableColumn {
  key: RecordSortKey
  label: string
}

const SORTABLE: Record<string, SortableColumn> = {
  folio: { key: "folio", label: "Folio" },
  fecha: { key: "fecha", label: "Fecha" },
  faena: { key: "faena", label: "Faena" },
  equipo: { key: "equipo", label: "Equipo" },
  lectura: { key: "lectura", label: "Lectura" },
}

/** Lo que pide atención va en tono de señal (nunca rojo: el rojo es de lo anulado); lo resuelto, apagado. */
const ATTENTION = "font-medium text-[var(--color-signal-ink)]"
const QUIET = "text-[var(--color-text-muted)]"

const LIST = new Intl.ListFormat("es", { style: "long", type: "conjunction" })

function alertNames(row: RecordListRow): string[] {
  const names: string[] = []
  if (row.alerts.jump) names.push("salto de lectura")
  if (row.alerts.outOfWorksite) names.push("fuera de faena")
  if (row.alerts.manualSchedule) names.push("pauta a mano")
  if (row.alerts.duplicate) names.push("duplicado")
  return names
}

/**
 * Estado de un registro en lo mínimo que decide qué hacer con él: UNA línea
 * principal —cómo salió el trabajo— y, como mucho, una secundaria con lo que
 * requiere atención o ya se resolvió (sin actualizar, observado, revisado,
 * alertas). Antes la celda mezclaba cuatro dimensiones en textos de colores y
 * chips de dos estilos. La revisión «Pendiente» no se pinta: es lo normal y las
 * pestañas ya cuentan lo que falta.
 */
export function RecordState({ row }: { row: RecordListRow }) {
  if (row.status === "anulado") {
    return (
      <div className="flex flex-col items-start gap-1">
        <Badge variant="danger" size="sm">Anulado</Badge>
        <span className={`text-xs ${QUIET}`}>No cuenta en los cálculos</span>
      </div>
    )
  }

  let primary: ReactNode
  if (row.kind === "P") {
    primary = row.notDoneCount > 0
      ? <span className={ATTENTION}>{plural(row.notDoneCount, "ítem no realizado", "ítems no realizados")}</span>
      : <span className={QUIET}>Completa</span>
  } else if (row.workshop) {
    const days = row.workshop.daysStopped
    primary = <span className={ATTENTION}>En taller · {days ? plural(days, "día", "días") : "desde hoy"}</span>
  } else {
    primary = <span className={QUIET}>Cerrada</span>
  }

  const notes: ReactNode[] = []
  if (row.workshop?.stale) notes.push(<span key="stale" className={ATTENTION}>Sin actualizar</span>)
  if (row.review === "observado") notes.push(<span key="review" className={ATTENTION}>Observado</span>)
  if (row.review === "revisado") notes.push(<span key="review" className="font-medium text-[var(--color-success-ink)]">Revisado</span>)
  const alerts = alertNames(row)
  if (alerts.length > 0) notes.push(<span key="alerts">{alerts.length === 1 ? "Alerta" : "Alertas"}: {LIST.format(alerts)}</span>)

  return (
    <div className="flex flex-col gap-0.5">
      <span>{primary}</span>
      {notes.length > 0 && (
        <span className={`text-xs ${QUIET}`}>
          {notes.map((note, index) => (
            <span key={index}>{index > 0 && " · "}{note}</span>
          ))}
        </span>
      )}
    </div>
  )
}

function equipmentLabel(row: RecordListRow) {
  const equipment = row.equipment
  const showPlate = !equipment.noPlate && equipment.plate !== equipment.code
  return (
    <>
      <span className="font-semibold">{equipment.code}</span>
      {showPlate && <span className="text-[var(--color-text-muted)]"> · {equipment.plate}</span>}
    </>
  )
}

function ExecutorLine({ row }: { row: RecordListRow }) {
  if (row.executorKind === "yo") return null
  return (
    <div className="text-xs text-[var(--color-text-muted)]">
      {executorText({ executorKind: row.executorKind, registeredByName: row.registeredByName, executorName: row.executorName })}
    </div>
  )
}

/**
 * Lista de «Registros». Es un componente de servidor. En escritorio, una tabla
 * cuyos encabezados ordenables son enlaces que cambian `orden`/`dir` en la URL
 * (`replace`, sin mover el scroll) —el orden lo resuelve la base, igual que la
 * paginación—. Bajo `md`, la misma lista como tarjetas con una acción de 44 px:
 * una tabla de ocho columnas en 390 px sólo dejaba ver Folio, Fecha y Faena.
 * Ambas quedan en el DOM (ver «Locators in this repository» de AGENTS.md).
 *
 * Cada enlace al detalle lleva `?lista=` con los filtros y el orden de la lista,
 * para que el detalle ofrezca anterior y siguiente dentro de ella.
 */
export function RecordsTable({
  rows,
  sort,
  dir,
  sortHref,
  listQuery,
}: {
  rows: RecordListRow[]
  sort: RecordSortKey
  dir: SortDirection
  /** URL de la misma lista ordenada por esa columna (alterna el sentido si ya estaba activa). */
  sortHref: (key: RecordSortKey) => string
  /** Los filtros y el orden de la lista, para que el detalle sepa de dónde se llegó. */
  listQuery: string
}) {
  const header = (column: SortableColumn) => {
    const active = sort === column.key
    const Icon = !active ? CaretUpDown : dir === "asc" ? CaretUp : CaretDown
    return (
      <TableHead key={column.key} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
        <Link href={sortHref(column.key)} replace scroll={false} className="inline-flex items-center gap-1 hover:text-[var(--color-text)]">
          {column.label}
          <Icon size={12} aria-hidden weight={active ? "bold" : "regular"} />
          <span className="sr-only">{active ? `, orden ${dir === "asc" ? "ascendente" : "descendente"}` : ", ordenar"}</span>
        </Link>
      </TableHead>
    )
  }

  return (
    <>
      <ul aria-label="Registros de mantención como tarjetas" className="grid gap-3 md:hidden">
        {rows.map((row) => {
          const folio = row.folio ?? "Sin folio"
          return (
            <li key={row.id}>
              <ResponsiveDataListCard
                title={<span className="font-mono text-[13px] font-semibold">{folio}</span>}
                description={<><span className="whitespace-nowrap font-mono tabular-nums">{formatDate(row.workDate)}</span> · {row.worksiteName}</>}
                actions={(
                  <Button asChild variant="secondary" size="sm" className="w-full">
                    <Link href={recordDetailHref(row.id, listQuery)} aria-label={`Ver el registro ${folio}`}>Ver el registro</Link>
                  </Button>
                )}
              >
                <ResponsiveDataListField label="Equipo"><span className="font-mono text-[13px] text-[var(--color-text)]">{equipmentLabel(row)}</span></ResponsiveDataListField>
                <ResponsiveDataListField label="Tipo"><span className="text-[var(--color-text)]">{recordKindText(row.kind, row.intervalValue, row.unit)}</span></ResponsiveDataListField>
                <ResponsiveDataListField label="Hecho por">
                  <span className="text-[var(--color-text)]">{row.executorName}</span>
                  <ExecutorLine row={row} />
                </ResponsiveDataListField>
                <ResponsiveDataListField label="Lectura"><span className="whitespace-nowrap font-mono text-[13px] tabular-nums text-[var(--color-text)]">{formatReading(row.reading, row.unit)}</span></ResponsiveDataListField>
                <ResponsiveDataListField label="Estado" className="col-span-2"><RecordState row={row} /></ResponsiveDataListField>
              </ResponsiveDataListCard>
            </li>
          )
        })}
      </ul>

      <TableRoot className="hidden md:block" aria-label="Registros de mantención">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {header(SORTABLE.folio!)}
              {header(SORTABLE.fecha!)}
              {header(SORTABLE.faena!)}
              {header(SORTABLE.equipo!)}
              <TableHead>Tipo</TableHead>
              <TableHead>Hecho por</TableHead>
              {header(SORTABLE.lectura!)}
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className={row.status === "anulado" ? "bg-[var(--color-surface-2)]/60" : undefined}>
                <TableCell className="whitespace-nowrap">
                  <Link
                    href={recordDetailHref(row.id, listQuery)}
                    className="font-mono text-[13px] font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline"
                    aria-label={`Ver el registro ${row.folio ?? "sin folio"}`}
                  >
                    {row.folio ?? "Sin folio"}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-[13px] tabular-nums">{formatDate(row.workDate)}</TableCell>
                <TableCell>{row.worksiteName}</TableCell>
                <TableCell className="whitespace-nowrap font-mono text-[13px]">{equipmentLabel(row)}</TableCell>
                <TableCell className="whitespace-nowrap">{recordKindText(row.kind, row.intervalValue, row.unit)}</TableCell>
                <TableCell>
                  <div>{row.executorName}</div>
                  <ExecutorLine row={row} />
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-[13px] tabular-nums">{formatReading(row.reading, row.unit)}</TableCell>
                <TableCell><RecordState row={row} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
    </>
  )
}
