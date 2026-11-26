import Link from "next/link"
import { HistoricalFilters } from "@/components/mantencion/jefatura/registros/historical-filters"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { ServerPagination } from "@/components/ui/server-pagination"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { ACTION_TYPE_LABELS, type ActionTypeOrUnknown } from "@/lib/mantencion/action-type"
import { FORMS_CUTOVER_DATE, FORMS_LAST_COUNTED_DATE } from "@/lib/mantencion/forms-cutover"
import { formatHours, plural } from "@/lib/mantencion/format"
import { HISTORY_PATH } from "@/lib/mantencion/history-view"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import type { MantViewer } from "@/lib/services/mantencion/access"
import { listHistoricalRecords } from "@/lib/services/mantencion/historical-import"
import { formatDate } from "@/lib/utils"

const WARNING_TEXT = "text-xs text-[var(--color-warning-ink)]"

/** El tipo normalizado del consolidado; en las filas que sólo vienen del formulario, el texto que escribieron. */
function actionLabel(row: { actionType: string | null; kindText: string }): string {
  if (row.actionType && row.actionType in ACTION_TYPE_LABELS) return ACTION_TYPE_LABELS[row.actionType as ActionTypeOrUnknown]
  return row.kindText || "No informada"
}
/** La faena por su nombre; el texto crudo del formulario sólo cuando no se resolvió. */
const worksiteLabel = (row: { worksiteName: string | null; worksiteText: string }) => row.worksiteName || row.worksiteText
/** Fecha de ingreso; si falta, el día del envío, dicho como tal. */
const entryLabel = (row: { entryDate: string | null; submittedAt: string }) => row.entryDate ? formatDate(row.entryDate) : row.submittedAt ? `Enviado el ${formatDate(row.submittedAt)}` : "Fecha no informada"
const hoursLabel = (row: { laborHours: number | null; hoursText: string }) => (row.laborHours !== null ? formatHours(row.laborHours) : row.hoursText.trim() || "—")

type Raw = Record<string, string | string[] | undefined>
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? ""

/**
 * «Respuestas de formularios»: cada respuesta de los formularios de Google tal como se guardó, SIN el corte ni el
 * descarte de pruebas del Historial de mantenciones. Es el lugar donde se concilian el equipo y la faena que no se
 * pudieron identificar (`?vinculo=`) y donde se ven las respuestas posteriores al corte y las posibles pruebas.
 * Es la lista plana de siempre: se conserva tal cual para que la conciliación no cambie.
 */
export async function FormsResponsesView({ viewer, raw, canImport }: { viewer: MantViewer; raw: Raw; canImport: boolean }) {
  const search = first(raw.q).slice(0, 100)
  const vehicleId = first(raw.equipo).slice(0, 64)
  const pendingParam = first(raw.vinculo)
  const pending = pendingParam === "equipment" || pendingParam === "conflict" || pendingParam === "worksite" ? pendingParam : undefined
  const page = Number(first(raw.page))
  const from = first(raw.desde).slice(0, 10)
  const to = first(raw.hasta).slice(0, 10)
  const worksiteId = first(raw.faena).slice(0, 64)
  const list = await listHistoricalRecords(viewer, { search, vehicleId, page, pending, from, to, worksiteId })
  const period = list.applied.from || list.applied.to
    ? `${list.applied.from ? `desde el ${formatDate(list.applied.from)}` : ""}${list.applied.from && list.applied.to ? " " : ""}${list.applied.to ? `hasta el ${formatDate(list.applied.to)}` : ""}`
    : ""
  const pagination = resolvePagination({ pageParam: String(list.page), totalItems: list.total, pageSize: list.pageSize })
  const filtered = Boolean(search || vehicleId || pending || list.applied.from || list.applied.to || list.applied.worksite)
  const base = `${HISTORY_PATH}?vista=formularios`

  return (
    <>
      <HistoricalFilters worksiteName={list.applied.worksite?.name} />

      <p className="mb-3 text-sm text-[var(--color-text-muted)]">
        {plural(list.total, "respuesta", "respuestas")} {vehicleId ? "de este equipo" : "de los formularios"}
        {list.applied.worksite ? ` en ${list.applied.worksite.name}` : ""}{period ? ` ${period}` : ""}. Se muestran todas tal como se guardaron, también las posibles pruebas y las posteriores al corte. En el Panel y en el Historial de mantenciones cuentan hasta el {formatDate(FORMS_LAST_COUNTED_DATE)}, salvo posible prueba; desde el {formatDate(FORMS_CUTOVER_DATE)} la plataforma reemplaza a los formularios.
      </p>

      {list.rows.length === 0 ? (
        <EmptyState
          title="No hay respuestas para mostrar"
          description={filtered ? "Prueba con otra búsqueda o quita los filtros para ver todas las respuestas." : "Se llenan al importar un archivo de respuestas de formularios."}
          action={filtered
            ? <Button asChild variant="secondary"><Link href={base}>Ver todas las respuestas</Link></Button>
            : canImport ? <Button asChild><Link href={`${HISTORY_PATH}/importar`}>Importar respuestas de formularios</Link></Button> : undefined}
        />
      ) : (
        <>
          <ul aria-label="Respuestas de formularios como tarjetas" className="grid gap-3 md:hidden">
            {list.rows.map((row) => (
              <li key={row.sourceKey}>
                <ResponsiveDataListCard
                  // La lista es el contenido de la página: sus tarjetas cuelgan del h1 (paso 6).
                  headingLevel={2}
                  title={row.equipmentText || "Sin equipo"}
                  description={`${worksiteLabel(row) || "Sin faena"} · ${entryLabel(row)}`}
                  actions={(
                    <Button asChild variant="secondary" size="sm" className="w-full">
                      <Link href={`${HISTORY_PATH}/${row.sourceKey}`} aria-label={`Ver el trabajo de ${row.equipmentText || "equipo no informado"}, orden ${row.orderText || "sin número"}`}>Ver el trabajo</Link>
                    </Button>
                  )}
                >
                  <ResponsiveDataListField label="Acción">{actionLabel(row)}</ResponsiveDataListField>
                  <ResponsiveDataListField label="Orden">{row.orderText || "No informada"}</ResponsiveDataListField>
                  <ResponsiveDataListField label="Horas hombre">{hoursLabel(row)}</ResponsiveDataListField>
                  <ResponsiveDataListField label="Contrato">{row.contractText || "—"}</ResponsiveDataListField>
                  {(row.isTest || row.qualityNotes) && (
                    <ResponsiveDataListField label="Revisar" className="col-span-2">
                      <span className="flex flex-wrap items-center gap-2">
                        {row.isTest && <Badge variant="warning">Posible prueba</Badge>}
                        {row.qualityNotes && <span className="text-[var(--color-warning-ink)]">{row.qualityNotes}</span>}
                      </span>
                    </ResponsiveDataListField>
                  )}
                  <ResponsiveDataListField label="Trabajo" className="col-span-2">
                    <span className="whitespace-pre-wrap break-words">{row.description || "No informado"}</span>
                  </ResponsiveDataListField>
                  {(!row.vehicleId || !row.worksiteId) && (
                    <ResponsiveDataListField label="Por completar" className="col-span-2">
                      <span className="text-[var(--color-warning-ink)]">
                        {[!row.vehicleId ? "Equipo sin identificar" : "", !row.worksiteId ? "Faena sin identificar" : ""].filter(Boolean).join(" · ")}
                      </span>
                    </ResponsiveDataListField>
                  )}
                </ResponsiveDataListCard>
              </li>
            ))}
          </ul>

          <div className="hidden md:block">
            <TableRoot aria-label="Respuestas de formularios">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha de ingreso</TableHead>
                    <TableHead>Equipo</TableHead>
                    <TableHead>Faena</TableHead>
                    <TableHead>Acción</TableHead>
                    <TableHead>Trabajo</TableHead>
                    <TableHead>Horas hombre</TableHead>
                    <TableHead>Contrato</TableHead>
                    <TableHead>Orden</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.rows.map((row) => (
                    <TableRow key={row.sourceKey}>
                      <TableCell className="whitespace-nowrap">{entryLabel(row)}</TableCell>
                      <TableCell>
                        <Link href={`${HISTORY_PATH}/${row.sourceKey}`} className="font-semibold text-[var(--color-primary-ink)] hover:underline">{row.equipmentText || "Sin equipo"}</Link>
                        {!row.vehicleId && <span className={`block ${WARNING_TEXT}`}>Equipo sin identificar</span>}
                        {row.isTest && <Badge variant="warning" className="mt-1">Posible prueba</Badge>}
                      </TableCell>
                      <TableCell>
                        {worksiteLabel(row) || "No informada"}
                        {!row.worksiteId && <span className={`block ${WARNING_TEXT}`}>Faena sin identificar</span>}
                      </TableCell>
                      <TableCell>{actionLabel(row)}</TableCell>
                      <TableCell className="max-w-sm">
                        <span className="line-clamp-2">{row.description || "No informado"}</span>
                        {row.qualityNotes && <span className={`line-clamp-1 ${WARNING_TEXT}`} title={row.qualityNotes}>Observación de calidad: {row.qualityNotes}</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{hoursLabel(row)}</TableCell>
                      <TableCell>{row.contractText || "—"}</TableCell>
                      <TableCell>{row.orderText || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableRoot>
          </div>
          <ServerPagination pagination={pagination} hrefForPage={(target) => buildPaginationHref(HISTORY_PATH, raw, target)} />
        </>
      )}
    </>
  )
}
