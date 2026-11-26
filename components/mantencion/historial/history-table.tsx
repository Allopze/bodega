import Link from "next/link"
import { ArrowDown, ArrowUp } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { formatHours } from "@/lib/mantencion/format"
import {
  HISTORY_SOURCE_LABELS, NO_EQUIPMENT_KEY, groupHistoryRows, historyHref, type HistoryParams, type HistorySort,
} from "@/lib/mantencion/history-view"
import type { MaintenanceHistoryRow } from "@/lib/services/mantencion/maintenance-work"
import { formatDate } from "@/lib/utils"
import { ActionTypeBadge } from "./action-type-badge"
import { responsibleText, workshopText } from "./history-format"
import { HistoryPreviewButton } from "./history-preview"

const WARNING_TEXT = "text-xs text-[var(--color-warning-ink)]"

/** Lo que dice la fila de «sin equipo» o «sin faena»: pendiente de conciliar en «Respuestas de formularios». */
function ReviewNotes({ row }: { row: MaintenanceHistoryRow }) {
  const { detail } = row
  if (!detail.unlinkedEquipment && !detail.unlinkedWorksite && !detail.qualityNotes) return null
  return (
    <>
      {detail.unlinkedEquipment && <span className={`block ${WARNING_TEXT}`}>Equipo sin identificar</span>}
      {detail.unlinkedWorksite && <span className={`block ${WARNING_TEXT}`}>Faena sin identificar</span>}
      {detail.qualityNotes && <span className={`line-clamp-1 ${WARNING_TEXT}`} title={detail.qualityNotes}>Observación de calidad: {detail.qualityNotes}</span>}
    </>
  )
}

const DASH = "—"

/**
 * Cabecera ordenable: un enlace a la misma lista con otro orden (el orden va en la URL y lo aplica el servidor sobre
 * todas las filas, no sólo las de la página). Con agrupación activa el orden lo manda el grupo y la cabecera es texto.
 */
function SortHead({ label, sort, params, sortable, className }: { label: string; sort: HistorySort; params: HistoryParams; sortable: boolean; className?: string }) {
  const active = params.sort === sort
  const ariaSort = active && sortable ? (params.dir === "asc" ? "ascending" : "descending") : "none"
  if (!sortable) return <TableHead className={className}>{label}</TableHead>
  const nextDir = active ? (params.dir === "asc" ? "desc" : "asc") : sort === "fecha" ? "desc" : "asc"
  const Icon = params.dir === "asc" ? ArrowUp : ArrowDown
  return (
    <TableHead aria-sort={ariaSort} className={className}>
      <Link href={historyHref(params, { sort, dir: nextDir })} scroll={false} className="inline-flex items-center gap-1 hover:underline">
        {label}
        {active && <Icon size={12} weight="bold" aria-hidden />}
      </Link>
    </TableHead>
  )
}

function DesktopRow({ row }: { row: MaintenanceHistoryRow }) {
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap align-top">
        <span className="block">{formatDate(row.date)}</span>
        <span className="block text-xs text-[var(--color-text-muted)]">{HISTORY_SOURCE_LABELS[row.source]}</span>
      </TableCell>
      <TableCell className="align-top">
        <span className="block font-semibold text-[var(--color-text)]">{row.equipmentLabel}</span>
        <span className="block text-xs text-[var(--color-text-muted)]">{row.worksiteName ?? "Sin faena"}</span>
        <ReviewNotes row={row} />
      </TableCell>
      <TableCell className="align-top"><ActionTypeBadge type={row.actionType} /></TableCell>
      <TableCell className="max-w-sm align-top">
        <HistoryPreviewButton row={row} visibleText={row.detail.description || "No informado"}>
          <span className="line-clamp-2">{row.detail.description || "No informado"}</span>
        </HistoryPreviewButton>
      </TableCell>
      <TableCell className="whitespace-nowrap align-top">{row.detail.reading ?? DASH}</TableCell>
      <TableCell className="whitespace-nowrap align-top">{workshopText(row)}</TableCell>
      <TableCell className="whitespace-nowrap align-top">{row.laborHours === null ? DASH : formatHours(row.laborHours)}</TableCell>
      <TableCell className="align-top">{responsibleText(row)}</TableCell>
      <TableCell className="whitespace-nowrap text-right align-top">
        <Link
          href={row.detail.href}
          className="text-sm font-semibold text-[var(--color-primary-ink)] hover:underline"
          aria-label={`Abrir la ficha del trabajo de ${row.equipmentLabel} del ${formatDate(row.date)}`}
        >
          Abrir
        </Link>
      </TableCell>
    </TableRow>
  )
}

function MobileCard({ row }: { row: MaintenanceHistoryRow }) {
  return (
    <li>
      <ResponsiveDataListCard
        // La lista es el contenido de la página: sus tarjetas cuelgan del h1.
        headingLevel={2}
        title={row.equipmentLabel}
        description={`${row.worksiteName ?? "Sin faena"} · ${formatDate(row.date)} · ${HISTORY_SOURCE_LABELS[row.source]}`}
        status={<ActionTypeBadge type={row.actionType} />}
        actions={(
          <div className="grid grid-cols-2 gap-2">
            <HistoryPreviewButton
              row={row}
              className="inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-strong)] px-3 text-sm font-medium text-[var(--color-text)]"
            >
              Vista previa
            </HistoryPreviewButton>
            <Button asChild variant="secondary" className="h-11">
              <Link href={row.detail.href} aria-label={`Abrir la ficha del trabajo de ${row.equipmentLabel} del ${formatDate(row.date)}`}>Abrir la ficha</Link>
            </Button>
          </div>
        )}
      >
        <ResponsiveDataListField label="Lectura">{row.detail.reading ?? DASH}</ResponsiveDataListField>
        <ResponsiveDataListField label="Días en taller">{workshopText(row)}</ResponsiveDataListField>
        <ResponsiveDataListField label="Horas hombre">{row.laborHours === null ? DASH : formatHours(row.laborHours)}</ResponsiveDataListField>
        <ResponsiveDataListField label="Responsable">{responsibleText(row)}</ResponsiveDataListField>
        <ResponsiveDataListField label="Trabajo" className="col-span-2">
          <span className="line-clamp-3 whitespace-pre-wrap break-words">{row.detail.description || "No informado"}</span>
        </ResponsiveDataListField>
        {(row.detail.unlinkedEquipment || row.detail.unlinkedWorksite || row.detail.qualityNotes) && (
          <ResponsiveDataListField label="Revisar" className="col-span-2"><ReviewNotes row={row} /></ResponsiveDataListField>
        )}
      </ResponsiveDataListCard>
    </li>
  )
}

/**
 * Los trabajos de la página (ya filtrados, ordenados y paginados por quien llama): tarjetas en móvil y tabla en
 * escritorio. Con `params.group`, las filas van bajo un encabezado por equipo o por mes.
 */
export function HistoryTable({ rows, params }: { rows: readonly MaintenanceHistoryRow[]; params: HistoryParams }) {
  const groups = params.group ? groupHistoryRows(rows, params.group) : [{ key: "", label: "", rows: [...rows] }]
  const sortable = !params.group
  return (
    <>
      <ul aria-label="Trabajos de mantención como tarjetas" className="grid gap-3 md:hidden">
        {groups.flatMap((group) => [
          ...(params.group ? [<li key={`g-${group.key}`} className="pt-1 text-sm font-semibold text-[var(--color-text)]">{group.label} <span className="font-normal text-[var(--color-text-muted)]">· {group.rows.length}</span></li>] : []),
          ...group.rows.map((row) => <MobileCard key={row.id} row={row} />),
        ])}
      </ul>

      <div className="hidden md:block">
        <TableRoot aria-label="Trabajos de mantención">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead label="Fecha" sort="fecha" params={params} sortable={sortable} />
                <SortHead label="Equipo" sort="equipo" params={params} sortable={sortable} />
                <SortHead label="Tipo" sort="tipo" params={params} sortable={sortable} />
                <TableHead>Trabajo</TableHead>
                <TableHead>Lectura</TableHead>
                <SortHead label="Días en taller" sort="dias" params={params} sortable={sortable} />
                <SortHead label="Horas hombre" sort="horas" params={params} sortable={sortable} />
                <TableHead>Responsable</TableHead>
                <TableHead><span className="sr-only">Ficha</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.flatMap((group) => [
                ...(params.group ? [(
                  <TableRow key={`g-${group.key}`} className="bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]">
                    <TableCell colSpan={9} className="py-2 text-sm font-semibold">
                      {params.group === "equipo" && group.key !== NO_EQUIPMENT_KEY
                        ? <Link href={historyHref(params, { vehicleId: group.key, group: null })} className="hover:underline">{group.label}</Link>
                        : group.label}
                      <span className="ml-2 font-normal text-[var(--color-text-muted)]">{group.rows.length} {group.rows.length === 1 ? "trabajo en esta página" : "trabajos en esta página"}</span>
                    </TableCell>
                  </TableRow>
                )] : []),
                ...group.rows.map((row) => <DesktopRow key={row.id} row={row} />),
              ])}
            </TableBody>
          </Table>
        </TableRoot>
      </div>
    </>
  )
}
