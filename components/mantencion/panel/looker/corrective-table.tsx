import { EmptyState } from "@/components/ui/empty-state"
import { ServerPagination } from "@/components/ui/server-pagination"
import { Table, TableBody, TableCaption, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { historyHref, parseHistoryParams } from "@/lib/mantencion/history-view"
import { resolvePagination } from "@/lib/pagination"
import { equipmentAction, workAction } from "@/lib/services/mantencion/looker/filter-hrefs"
import type { CorrectivePage, CorrectiveWorkRow } from "@/lib/services/mantencion/looker/types"
import { cn, formatDate, formatQty, todayInChile } from "@/lib/utils"
import { CrossFilterRow } from "./cross-filter-row"
import { EquipmentCell } from "./equipment-cell"
import { FilterToggle } from "./filter-toggle"
import { WorkPhoto } from "./work-photo"

const SOURCE_LABEL = { ot: "OT", historial: "Formulario", registro: "Registro" } as const

/** El texto bajo la fecha: «OT 33843», «Formulario 33844», «Registro REG-0012». */
function referenceText(row: CorrectiveWorkRow): string {
  return `${SOURCE_LABEL[row.source]} ${row.reference || "sin folio"}`
}

function readingText(row: CorrectiveWorkRow): string {
  if (row.reading != null) return `${formatQty(row.reading)} ${row.unit === "h" ? "h" : "km"}`
  return row.readingText ?? "—"
}

function hoursText(row: CorrectiveWorkRow): string {
  return row.hours == null ? "—" : `${formatQty(row.hours, undefined, { maximumFractionDigits: 1 })} h`
}

/** El respaldo de un trabajo: «Sin foto» va en aviso sólo si debería traerla (los formularios anteriores no traen foto). */
function BackupCell({ row }: { row: CorrectiveWorkRow }) {
  return (
    <WorkPhoto
      photoId={row.photoId}
      photoUrl={row.photoUrl}
      alt={`${row.plate || row.code || "equipo"} del ${formatDate(row.date)}`}
      compact
      missingTone={row.source === "historial" ? "muted" : "warn"}
    />
  )
}

/**
 * Tabla «Trabajos del período» de Correctivo. Escritorio: tabla con la fila clicable (filtra por el trabajo, `x_ot`);
 * móvil: una tarjeta por trabajo, con los mismos controles. Las dos vistas se dibujan y el CSS muestra una (como
 * `DataTable renderMobileCard`); `DataTable` pagina y busca en el cliente y aquí la página y el filtro viven en la URL.
 *
 * Un elemento nunca navega y filtra a la vez: la patente enlaza al historial del equipo con el período y la faena del
 * trabajo, el embudo filtra el panel por el equipo y el folio filtra por el trabajo (es el camino por teclado de la fila).
 */
export function CorrectiveWorkTable({
  page,
  unit,
  period,
  hrefForPage,
  selectedWorkId,
}: {
  page: CorrectivePage
  unit: "km" | "h"
  /** El período del panel: el enlace de la patente abre el historial del equipo en ese mismo rango. */
  period: { from: string; to: string }
  hrefForPage: (page: number) => string
  selectedWorkId: string | null
}) {
  if (page.rows.length === 0) {
    return (
      <EmptyState
        compact
        title="Sin trabajos correctivos con estos filtros"
        description="Prueba con otro período, otra faena u otro equipo. Una OT entra cuando registra el ingreso a taller."
      />
    )
  }
  const pagination = resolvePagination({ pageParam: String(page.page), totalItems: page.total, pageSize: page.pageSize })
  const base = parseHistoryParams({}, todayInChile())
  const historyOf = (row: CorrectiveWorkRow) => row.vehicleId
    ? historyHref(base, { vehicleId: row.vehicleId, worksiteId: row.worksiteId, from: period.from, to: period.to, period: "personalizado" })
    : null
  const subOf = (row: CorrectiveWorkRow) => [row.code && row.code !== row.plate ? row.code : null, row.typeName || null].filter(Boolean).join(" · ")
  const equipmentOf = (row: CorrectiveWorkRow) => (
    <EquipmentCell
      plate={row.plate}
      code={row.code}
      sub={subOf(row)}
      href={historyOf(row)}
      linkTitle="Abrir el historial de este equipo"
      {...(row.vehicleId ? { filterAction: equipmentAction(row.vehicleId, false) } : {})}
    />
  )
  const toggleOf = (row: CorrectiveWorkRow, className?: string) => (
    <FilterToggle
      action={workAction(row.id, selectedWorkId === row.id)}
      aria-label={`Filtrar el panel por el trabajo ${referenceText(row)}`}
      className={cn("text-2xs text-[var(--color-text-muted)]", className)}
    >
      {referenceText(row)}
    </FilterToggle>
  )

  return (
    <>
      <TableRoot framed={false} className="hidden md:block">
        <Table className="text-xs">
          <TableCaption className="sr-only">Trabajos correctivos del período</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Ingreso</TableHead>
              <TableHead>Equipo</TableHead>
              <TableHead className="text-right">{unit === "km" ? "Odómetro" : "Horómetro"}</TableHead>
              <TableHead>Trabajo realizado</TableHead>
              <TableHead>Conductor</TableHead>
              <TableHead className="text-right">Horas</TableHead>
              <TableHead>Respaldo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.rows.map((row) => (
              <CrossFilterRow key={row.id} action={workAction(row.id, selectedWorkId === row.id)} active={selectedWorkId === row.id} className="align-top">
                <TableCell nowrap className="align-top">
                  <span className="block font-mono text-xs">{formatDate(row.date)}</span>
                  {toggleOf(row, "-ml-1 font-mono")}
                </TableCell>
                <TableCell className="min-w-40 align-top">{equipmentOf(row)}</TableCell>
                <TableCellNum className="align-top text-xs">{readingText(row)}</TableCellNum>
                <TableCell className="min-w-64 max-w-md whitespace-pre-line align-top text-xs">{row.workPerformed || "—"}</TableCell>
                <TableCell className="min-w-32 align-top text-xs">{row.drivers.join(", ") || "—"}</TableCell>
                <TableCellNum className="align-top text-xs">{hoursText(row)}</TableCellNum>
                <TableCell className="align-top"><BackupCell row={row} /></TableCell>
              </CrossFilterRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>

      <ul aria-label="Trabajos correctivos del período" className="divide-y divide-[var(--color-border)] md:hidden">
        {page.rows.map((row) => (
          <li
            key={row.id}
            data-selected={selectedWorkId === row.id ? "true" : undefined}
            className="flex flex-col gap-2 px-4 py-3 data-[selected=true]:bg-[var(--color-primary-tint)]/50"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="block font-mono text-xs">{formatDate(row.date)}</span>
                {toggleOf(row, "-ml-1 min-h-11 font-mono")}
              </div>
              <BackupCell row={row} />
            </div>
            {equipmentOf(row)}
            <p className="whitespace-pre-line text-xs">{row.workPerformed || "—"}</p>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-[var(--color-text-muted)]">
              <span className="font-mono">{unit === "km" ? "Odómetro" : "Horómetro"} {readingText(row)}</span>
              <span className="font-mono">{hoursText(row)}</span>
              {row.drivers.length > 0 && <span>Conductor: {row.drivers.join(", ")}</span>}
            </p>
          </li>
        ))}
      </ul>
      <ServerPagination pagination={pagination} hrefForPage={hrefForPage} />
    </>
  )
}
